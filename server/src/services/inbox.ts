// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Postfach („Inbox" im Admin-Bereich): empfangene E-Mails über Resend Receiving.
 *
 * Ablauf:
 *  1. Resend schickt einen signierten Webhook (routes/inbound.ts). Gespeichert werden in einer
 *     Transaktion die Webhook-ID (gegen Doppel-Zustellung) und die Metadaten der Mail.
 *  2. Im Hintergrund wird der Inhalt abgerufen: GET /emails/receiving/{id}. Gespeichert wird nur
 *     reiner Text (HTML → Text), SPF/DKIM/DMARC, eine Auswahl an Headern und von Anhängen nur
 *     Name/Typ/Größe. Schlägt der Abruf fehl: FETCH_FAILED, später erneut (alle 5 Minuten mit
 *     wachsendem Abstand, oder per Button im Admin-Bereich).
 *  3. Die Absender-Adresse wird (ohne Groß-/Kleinschreibung) einem Catch-Konto zugeordnet.
 */
import type { Config } from '../config.js';
import type { Db } from '../db/pool.js';
import type { Deps } from '../deps.js';
import {
  addressList,
  authWarnings,
  cleanSubject,
  isAutoReply,
  normalizeMessageId,
  parseAddress,
  parseDate,
  parseReceivedEmail,
  trimQuoted,
  webhookKey,
  type MailAddress,
  type MailAttachment,
  type MailAuth,
  type ReceivedEmail,
} from '../mail/inbound.js';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const INBOX_STATUSES = ['NEW', 'READ', 'DONE', 'SPAM'] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];
export type ContentStatus = 'PENDING' | 'FETCHED' | 'FETCH_FAILED';
/** Höchstens so viele Abruf-Versuche automatisch (danach nur noch per Button). */
export const FETCH_MAX_ATTEMPTS = 8;
/** Empfangene Mails (und Antworten darauf) werden nach so vielen Tagen gelöscht. */
export const INBOX_RETENTION_DAYS = 365;

/** Ist der Empfang eingerichtet (gültiges Webhook-Secret)? */
export function inboundEnabled(cfg: Pick<Config, 'RESEND_WEBHOOK_SECRET'>): boolean {
  return webhookKey(cfg.RESEND_WEBHOOK_SECRET) !== null;
}

/** Key zum Lesen empfangener Mails: eigener Full-Access-Key, sonst der Versand-Key. */
export function inboundApiKey(cfg: Pick<Config, 'RESEND_INBOUND_API_KEY' | 'RESEND_API_KEY'>): string {
  return cfg.RESEND_INBOUND_API_KEY.trim() || cfg.RESEND_API_KEY.trim();
}

/** Konto mit dieser Adresse (zuletzt aktives, falls mehrere). */
const matchUser = (address: string) =>
  `(SELECT u.id FROM users u WHERE u.email IS NOT NULL AND lower(u.email) = lower(${address}) ORDER BY u.last_seen_at DESC NULLS LAST LIMIT 1)`;

// --- Webhook ------------------------------------------------------------------------------------

export interface InboundEvent {
  webhookId: string;
  type: string;
  emailId: string | null;
  receivedAt: Date | null;
  from: MailAddress | null;
  to: string[];
  subject: string | null;
  messageId: string | null;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Webhook-Inhalt → Ereignis. Felder dürfen fehlen. Die E-Mail-ID kommt aus `data.email_id`,
 * `data.email.id` oder `data.id` (in dieser Reihenfolge – `data.id` ist die unsicherste Angabe).
 */
export function parseInboundEvent(webhookId: string, body: unknown): InboundEvent {
  const o = obj(body);
  const data = obj(o.data);
  const email = obj(data.email);
  const pick = (k: string) => data[k] ?? email[k];
  const rawId = data.email_id ?? email.id ?? data.id;
  const mid = pick('message_id');
  return {
    webhookId,
    type: typeof o.type === 'string' ? o.type : '',
    emailId: typeof rawId === 'string' && /^[\w.-]{1,128}$/.test(rawId) ? rawId : null,
    receivedAt: parseDate(pick('created_at')) ?? parseDate(o.created_at),
    from: parseAddress(pick('from')),
    to: addressList(pick('to')),
    subject: cleanSubject(pick('subject')),
    messageId: typeof mid === 'string' ? normalizeMessageId(mid) : null,
  };
}

/**
 * Webhook speichern. 'duplicate' = diese Webhook-ID kam schon einmal; 'known' = die Mail gibt es
 * schon (z. B. über ein zweites Ereignis); 'stored' = neu angelegt.
 */
export async function storeInboundEvent(db: Db, e: InboundEvent & { emailId: string }): Promise<'stored' | 'known' | 'duplicate'> {
  const now = Date.now();
  const at = e.receivedAt && e.receivedAt.getTime() < now + 86_400_000 && e.receivedAt.getTime() > now - 30 * 86_400_000 ? e.receivedAt : new Date(now);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const w = await client.query(
      'INSERT INTO inbound_webhooks (id, event_type, email_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING id',
      [e.webhookId.slice(0, 256), e.type.slice(0, 60), e.emailId],
    );
    if (!w.rowCount) {
      await client.query('ROLLBACK');
      return 'duplicate';
    }
    const m = await client.query(
      `INSERT INTO inbound_emails (id, received_at, event_type, from_address, from_name, to_addresses, subject, message_id, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${matchUser('$4::text')})
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [e.emailId, at, e.type.slice(0, 60), e.from?.address ?? null, e.from?.name ?? null, e.to, e.subject, e.messageId],
    );
    await client.query('COMMIT');
    return m.rowCount ? 'stored' : 'known';
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// --- Inhalt bei Resend abrufen ---------------------------------------------------------------------

export async function fetchReceivedEmail(
  cfg: Pick<Config, 'RESEND_API_URL' | 'RESEND_INBOUND_API_KEY' | 'RESEND_API_KEY'>,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ReceivedEmail> {
  const key = inboundApiKey(cfg);
  if (!key) throw new Error('Kein Resend-API-Key (RESEND_INBOUND_API_KEY bzw. RESEND_API_KEY)');
  const res = await fetchImpl(`${cfg.RESEND_API_URL.replace(/\/+$/, '')}/emails/receiving/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    const hint = res.status === 401 || res.status === 403 ? ' – der Key braucht „Full access" (RESEND_INBOUND_API_KEY)' : '';
    throw new Error(`Resend antwortet ${res.status}${hint}: ${body}`);
  }
  return parseReceivedEmail(await res.json(), id);
}

/**
 * Inhalt abrufen und speichern. Ohne `force` nur, solange er noch fehlt.
 * Liefert den neuen Stand; null = Mail unbekannt (oder schon abgerufen).
 */
export async function loadInboundContent(
  deps: Pick<Deps, 'cfg' | 'db' | 'log'>,
  id: string,
  opts: { force?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<ContentStatus | null> {
  const { db, cfg, log } = deps;
  const cur = await db.query(
    `UPDATE inbound_emails SET fetch_attempts = least(fetch_attempts + 1, 32000), last_fetch_at = now()
     WHERE id = $1 ${opts.force ? '' : `AND content_status <> 'FETCHED'`} RETURNING id`,
    [id],
  );
  if (!cur.rowCount) return null;
  let mail: ReceivedEmail;
  try {
    mail = await fetchReceivedEmail(cfg, id, opts.fetchImpl);
  } catch (err) {
    const message = ((err as Error).message ?? 'unknown').slice(0, 300);
    log.warn({ email: id, err: message }, 'Empfangene Mail: Inhalt nicht abrufbar');
    await db.query(`UPDATE inbound_emails SET content_status = 'FETCH_FAILED', fetch_error = $2 WHERE id = $1 AND content_status <> 'FETCHED'`, [id, message]);
    return 'FETCH_FAILED';
  }
  await db.query(
    `UPDATE inbound_emails SET
       content_status = 'FETCHED', fetch_error = NULL,
       from_address = coalesce($2, from_address),
       from_name = CASE WHEN $2::text IS NULL THEN from_name ELSE $3 END,
       to_addresses = CASE WHEN cardinality($4::text[]) > 0 THEN $4 ELSE to_addresses END,
       cc_addresses = $5, reply_to = $6,
       subject = coalesce($7, subject),
       body_text = $8, text_truncated = $9, text_from_html = $10,
       message_id = coalesce($11, message_id), in_reply_to = $12, references_header = $13,
       auth = $14, headers = $15, attachments = $16,
       user_id = coalesce(${matchUser('coalesce($2::text, inbound_emails.from_address)')}, user_id)
     WHERE id = $1`,
    [
      id,
      mail.from?.address ?? null,
      mail.from?.name ?? null,
      mail.to,
      mail.cc,
      mail.replyTo,
      mail.subject,
      mail.text,
      mail.textTruncated,
      mail.textFromHtml,
      mail.messageId,
      mail.inReplyTo,
      mail.references,
      JSON.stringify(mail.auth),
      JSON.stringify(mail.headers),
      JSON.stringify(mail.attachments),
    ],
  );
  return 'FETCHED';
}

/** Fehlende Inhalte erneut abrufen (mit wachsendem Abstand: 5, 20, 45 … Minuten, höchstens 4 h). */
export async function retryInboundContent(deps: Pick<Deps, 'cfg' | 'db' | 'log'>, fetchImpl?: typeof fetch): Promise<number> {
  const { rows } = await deps.db.query<{ id: string }>(
    `SELECT id FROM inbound_emails
     WHERE content_status <> 'FETCHED' AND fetch_attempts < $1
       AND (last_fetch_at IS NULL OR last_fetch_at < now() - make_interval(mins => least(5 * fetch_attempts * fetch_attempts, 240)))
     ORDER BY received_at LIMIT 20`,
    [FETCH_MAX_ATTEMPTS],
  );
  for (const r of rows) await loadInboundContent(deps, r.id, { fetchImpl });
  return rows.length;
}

// --- Admin-Bereich ------------------------------------------------------------------------------

interface InboxRow {
  id: string;
  received_at: Date;
  status: InboxStatus;
  content_status: ContentStatus;
  from_address: string | null;
  from_name: string | null;
  subject: string | null;
  head: string | null;
  auth: MailAuth | null;
  headers: Record<string, string> | null;
  attachment_count: number;
  user_id: string | null;
  user_name: string | null;
  user_banned: boolean | null;
  replies: string;
}

function snippet(text: string | null): string {
  const s = trimQuoted(text, 400).replace(/\s+/g, ' ').trim();
  return s.length > 200 ? s.slice(0, 200).replace(/\s+\S*$/, '') + ' …' : s;
}

function listItem(r: InboxRow) {
  return {
    id: r.id,
    receivedAt: iso(r.received_at),
    status: r.status,
    contentStatus: r.content_status,
    from: { address: r.from_address, name: r.from_name },
    subject: r.subject,
    snippet: snippet(r.head),
    authWarnings: authWarnings(r.auth),
    autoReply: isAutoReply(r.headers),
    attachmentCount: Number(r.attachment_count ?? 0),
    replies: Number(r.replies ?? 0),
    user: r.user_id ? { uid: r.user_id, name: r.user_name, banned: Boolean(r.user_banned) } : null,
  };
}

const LIST_SELECT = `
  SELECT e.id, e.received_at, e.status, e.content_status, e.from_address, e.from_name, e.subject, e.auth, e.headers,
         left(e.body_text, 1500) AS head, jsonb_array_length(e.attachments) AS attachment_count,
         e.user_id, u.display_name AS user_name, u.banned AS user_banned,
         (SELECT count(*) FROM inbound_replies r WHERE r.inbound_id = e.id AND r.mail_status = 'SENT') AS replies
  FROM inbound_emails e LEFT JOIN users u ON u.id = e.user_id`;

export async function listInbox(db: Db, o: { status?: InboxStatus; q?: string; limit: number; offset: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (o.status) where.push(`e.status = ${p(o.status)}`);
  if (o.q) {
    const like = p(`%${o.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    where.push(`(e.from_address ILIKE ${like} OR e.from_name ILIKE ${like} OR e.subject ILIKE ${like} OR e.body_text ILIKE ${like} OR e.id = ${p(o.q)})`);
  }
  const sql = `${LIST_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY e.received_at DESC, e.id DESC LIMIT ${p(o.limit + 1)} OFFSET ${p(o.offset)}`;
  const { rows } = await db.query<InboxRow>(sql, params);
  return { items: rows.slice(0, o.limit).map(listItem), hasMore: rows.length > o.limit };
}

interface DetailRow extends InboxRow {
  fetch_attempts: number;
  fetch_error: string | null;
  event_type: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  reply_to: string[];
  body_text: string | null;
  text_truncated: boolean;
  text_from_html: boolean;
  message_id: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  attachments: MailAttachment[];
  user_email: string | null;
  user_lang: string | null;
  user_restricted_until: Date | null;
  user_created_at: Date | null;
}

/** Alles zu einer Mail für die Detail-Ansicht; markiert NEU → GELESEN. null = gibt es nicht. */
export async function getInboxMail(db: Db, id: string) {
  // Konto evtl. erst nach der Mail angelegt → Zuordnung nachholen
  await db.query(
    `UPDATE inbound_emails SET user_id = ${matchUser('inbound_emails.from_address')} WHERE id = $1 AND user_id IS NULL AND from_address IS NOT NULL`,
    [id],
  );
  const { rows } = await db.query<DetailRow>(
    `SELECT e.*, NULL::text AS head, jsonb_array_length(e.attachments) AS attachment_count,
            u.display_name AS user_name, u.banned AS user_banned, u.email AS user_email, u.lang AS user_lang,
            u.restricted_until AS user_restricted_until, u.created_at AS user_created_at,
            (SELECT count(*) FROM inbound_replies r WHERE r.inbound_id = e.id AND r.mail_status = 'SENT') AS replies
     FROM inbound_emails e LEFT JOIN users u ON u.id = e.user_id WHERE e.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  if (r.status === 'NEW') {
    await db.query(`UPDATE inbound_emails SET status = 'READ' WHERE id = $1 AND status = 'NEW'`, [id]);
    r.status = 'READ';
  }
  const replies = await db.query<{ id: string; created_at: Date; admin_uid: string | null; message: string; lang: string | null; mail_status: string }>(
    'SELECT id, created_at, admin_uid, message, lang, mail_status FROM inbound_replies WHERE inbound_id = $1 ORDER BY created_at, id',
    [id],
  );
  const others = r.from_address
    ? await db.query<{ id: string; received_at: Date; subject: string | null; status: InboxStatus }>(
        `SELECT id, received_at, subject, status FROM inbound_emails
         WHERE lower(from_address) = lower($2) AND id <> $1 ORDER BY received_at DESC LIMIT 10`,
        [id, r.from_address],
      )
    : { rows: [] };
  return {
    ...listItem(r),
    snippet: undefined,
    fetchAttempts: r.fetch_attempts,
    fetchError: r.fetch_error,
    eventType: r.event_type,
    to: r.to_addresses ?? [],
    cc: r.cc_addresses ?? [],
    replyTo: r.reply_to ?? [],
    text: r.body_text,
    textTruncated: r.text_truncated,
    textFromHtml: r.text_from_html,
    messageId: r.message_id,
    inReplyTo: r.in_reply_to,
    references: r.references_header,
    auth: r.auth ?? { spf: null, dkim: null, dmarc: null },
    headers: r.headers ?? {},
    attachments: r.attachments ?? [],
    user: r.user_id
      ? {
          uid: r.user_id,
          name: r.user_name,
          email: r.user_email,
          banned: Boolean(r.user_banned),
          lang: r.user_lang,
          createdAt: iso(r.user_created_at),
          restrictedUntil: r.user_restricted_until && r.user_restricted_until.getTime() > Date.now() ? iso(r.user_restricted_until) : null,
        }
      : null,
    replies: replies.rows.map((x) => ({ id: String(x.id), at: iso(x.created_at), by: x.admin_uid, message: x.message, lang: x.lang, mailStatus: x.mail_status })),
    others: others.rows.map((x) => ({ id: x.id, receivedAt: iso(x.received_at), subject: x.subject, status: x.status })),
  };
}

/** Letztes Feedback des Kontos (für die Detail-Ansicht). */
export async function recentFeedback(db: Db, uid: string, limit = 10) {
  const { rows } = await db.query<{ id: string; created_at: Date; category: string; message: string; status: string }>(
    'SELECT id, created_at, category, message, status FROM feedback WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
    [uid, limit],
  );
  return rows.map((f) => ({ id: String(f.id), createdAt: iso(f.created_at), category: f.category, message: f.message.slice(0, 600), status: f.status }));
}

export async function setInboxStatus(db: Db, id: string, status: InboxStatus): Promise<boolean> {
  const res = await db.query('UPDATE inbound_emails SET status = $2 WHERE id = $1', [id, status]);
  return (res.rowCount ?? 0) > 0;
}

export async function deleteInboxMail(db: Db, id: string): Promise<boolean> {
  const res = await db.query('DELETE FROM inbound_emails WHERE id = $1', [id]);
  return (res.rowCount ?? 0) > 0;
}

/** Was die Antwort braucht: Adresse, Betreff, Original-Text, Message-IDs, Sprache des Kontos. */
export async function inboxForReply(db: Db, id: string) {
  const { rows } = await db.query<{
    id: string;
    received_at: Date;
    from_address: string | null;
    from_name: string | null;
    subject: string | null;
    body_text: string | null;
    message_id: string | null;
    in_reply_to: string | null;
    references_header: string | null;
    user_lang: string | null;
  }>(
    `SELECT e.id, e.received_at, e.from_address, e.from_name, e.subject, e.body_text, e.message_id, e.in_reply_to, e.references_header,
            u.lang AS user_lang
     FROM inbound_emails e LEFT JOIN users u ON u.id = e.user_id WHERE e.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    receivedAt: r.received_at,
    fromAddress: r.from_address,
    fromName: r.from_name,
    subject: r.subject,
    text: r.body_text ?? '',
    messageId: r.message_id,
    inReplyTo: r.in_reply_to,
    references: r.references_header,
    userLang: r.user_lang,
  };
}

/** Antwort speichern; verschickt → Mail „erledigt". */
export async function addInboxReply(
  db: Db,
  r: { inboundId: string; adminUid: string; message: string; lang: string; mailStatus: 'SENT' | 'FAILED'; resendId?: string | null },
) {
  const { rows } = await db.query<{ id: string; created_at: Date }>(
    `INSERT INTO inbound_replies (inbound_id, admin_uid, message, lang, mail_status, resend_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
    [r.inboundId, r.adminUid, r.message, r.lang, r.mailStatus, r.resendId ?? null],
  );
  if (r.mailStatus === 'SENT') await db.query(`UPDATE inbound_emails SET status = 'DONE' WHERE id = $1`, [r.inboundId]);
  return { id: String(rows[0].id), at: iso(rows[0].created_at), by: r.adminUid, message: r.message, lang: r.lang, mailStatus: r.mailStatus };
}
