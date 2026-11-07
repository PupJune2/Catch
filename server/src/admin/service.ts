// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/** Datenbank-Abfragen für den Admin-Bereich (Konten, Hinweise, Feedback, Protokoll). Postfach: services/inbox.ts */
import type { Db } from '../db/pool.js';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// --- Protokoll ------------------------------------------------------------------------------

export async function audit(
  db: Db,
  e: { uid: string | null; action: string; target?: string | null; detail?: Record<string, unknown> | null; ip?: string | null },
): Promise<void> {
  await db.query('INSERT INTO admin_audit (uid, action, target, detail, ip) VALUES ($1, $2, $3, $4, $5)', [
    e.uid,
    e.action,
    e.target ?? null,
    e.detail ? JSON.stringify(e.detail) : null,
    e.ip ?? null,
  ]);
}

export async function listAudit(db: Db, limit: number) {
  const { rows } = await db.query<{ id: string; at: Date; uid: string | null; action: string; target: string | null; detail: unknown; ip: string | null }>(
    'SELECT id, at, uid, action, target, detail, ip FROM admin_audit ORDER BY at DESC LIMIT $1',
    [limit],
  );
  return rows.map((r) => ({ id: String(r.id), at: iso(r.at), uid: r.uid, action: r.action, target: r.target, detail: r.detail, ip: r.ip }));
}

// --- Übersicht ------------------------------------------------------------------------------

export async function overview(db: Db) {
  const { rows } = await db.query<Record<string, string>>(`
    SELECT
      (SELECT count(*) FROM users) AS users,
      (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days') AS users_new_7d,
      (SELECT count(*) FROM users WHERE last_seen_at > now() - interval '24 hours') AS users_active_24h,
      (SELECT count(*) FROM users WHERE banned) AS users_banned,
      (SELECT count(*) FROM reports) AS reports,
      (SELECT count(*) FROM reports WHERE reported_at > now() - interval '24 hours') AS reports_24h,
      (SELECT count(*) FROM reports WHERE flags > 0 AND NOT hidden) AS reports_flagged,
      (SELECT count(*) FROM reports WHERE hidden) AS reports_hidden,
      (SELECT count(*) FROM trackings WHERE ends_at > now()) AS trackings_active,
      (SELECT count(*) FROM devices) AS devices,
      (SELECT count(*) FROM feedback WHERE status = 'NEW') AS feedback_new,
      (SELECT count(*) FROM feedback) AS feedback_total,
      (SELECT count(*) FROM inbound_emails WHERE status = 'NEW') AS inbox_new,
      (SELECT count(*) FROM inbound_emails WHERE content_status = 'FETCH_FAILED') AS inbox_failed
  `);
  const byKind = await db.query<{ kind: string; n: string }>(
    `SELECT kind, count(*) AS n FROM reports WHERE reported_at > now() - interval '24 hours' GROUP BY kind`,
  );
  const r = rows[0];
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    users: { total: n('users'), new7d: n('users_new_7d'), active24h: n('users_active_24h'), banned: n('users_banned') },
    reports: {
      total: n('reports'),
      last24h: n('reports_24h'),
      flagged: n('reports_flagged'),
      hidden: n('reports_hidden'),
      byKind24h: Object.fromEntries(byKind.rows.map((x) => [x.kind, Number(x.n)])),
    },
    trackingsActive: n('trackings_active'),
    devices: n('devices'),
    feedback: { new: n('feedback_new'), total: n('feedback_total') },
    inbox: { new: n('inbox_new'), fetchFailed: n('inbox_failed') },
  };
}

// --- Hinweise (Meldungen) -------------------------------------------------------------------

export type ReportView = 'recent' | 'flagged' | 'hidden';

interface AdminReportRow {
  id: string;
  kind: string;
  line_key: string;
  line_name: string | null;
  line_mode: string | null;
  headsign: string | null;
  prev_stop_name: string | null;
  next_stop_name: string | null;
  tags: string[];
  reported_at: Date;
  created_at: Date;
  confirmations: number;
  denials: number;
  flags: number;
  hidden: boolean;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  user_banned: boolean | null;
  flag_reasons: Array<{ reason: string; at: string }> | null;
  reporter_trust: number;
  alerts_held: boolean;
  reviewed_at: Date | null;
}

function adminReport(r: AdminReportRow) {
  return {
    id: String(r.id),
    kind: r.kind,
    lineKey: r.line_key,
    line: r.line_name ? { name: r.line_name, mode: r.line_mode } : null,
    headsign: r.headsign,
    prevStop: r.prev_stop_name,
    nextStop: r.next_stop_name,
    tags: r.tags ?? [],
    reportedAt: iso(r.reported_at),
    createdAt: iso(r.created_at),
    confirmations: r.confirmations,
    denials: r.denials,
    flags: r.flags,
    hidden: r.hidden,
    user: r.user_id ? { uid: r.user_id, name: r.user_name, email: r.user_email, banned: Boolean(r.user_banned) } : null,
    flagReasons: r.flag_reasons ?? [],
    reporterTrust: r.reporter_trust,
    alertsHeld: r.alerts_held,
    reviewedAt: iso(r.reviewed_at),
  };
}

const REPORT_SELECT = `
  SELECT r.id, r.kind, r.line_key, l.name AS line_name, l.mode AS line_mode, r.headsign,
         r.prev_stop_name, r.next_stop_name, r.tags, r.reported_at, r.created_at,
         r.confirmations, r.denials, r.flags, r.hidden, r.reporter_trust, r.alerts_held, r.reviewed_at,
         r.user_id, u.display_name AS user_name, u.email AS user_email, u.banned AS user_banned,
         (SELECT json_agg(json_build_object('reason', f.reason, 'at', f.created_at) ORDER BY f.created_at DESC)
            FROM report_flags f WHERE f.report_id = r.id) AS flag_reasons
  FROM reports r
  LEFT JOIN lines l ON l.line_key = r.line_key
  LEFT JOIN users u ON u.id = r.user_id`;

export async function listReports(
  db: Db,
  o: { view: ReportView; kind?: string; uid?: string; q?: string; limit: number; offset: number },
) {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (o.view === 'flagged') where.push('r.flags > 0 AND NOT r.hidden');
  if (o.view === 'hidden') where.push('r.hidden');
  if (o.kind) where.push(`r.kind = ${p(o.kind)}`);
  if (o.uid) where.push(`r.user_id = ${p(o.uid)}`);
  if (o.q) {
    const like = p(`%${o.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    where.push(`(l.name ILIKE ${like} OR r.prev_stop_name ILIKE ${like} OR r.next_stop_name ILIKE ${like} OR r.id::text = ${p(o.q)})`);
  }
  const order =
    o.view === 'flagged'
      ? 'ORDER BY (SELECT max(f.created_at) FROM report_flags f WHERE f.report_id = r.id) DESC NULLS LAST, r.id DESC'
      : 'ORDER BY r.reported_at DESC, r.id DESC';
  const sql = `${REPORT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ${order} LIMIT ${p(o.limit + 1)} OFFSET ${p(o.offset)}`;
  const { rows } = await db.query<AdminReportRow>(sql, params);
  return { items: rows.slice(0, o.limit).map(adminReport), hasMore: rows.length > o.limit };
}

/**
 * Ausblenden / wieder einblenden bzw. Markierungen verwerfen (setzt Markierungen zurück und merkt
 * sich die Prüfung: Widersprüche blenden die Meldung danach nicht mehr automatisch aus).
 * Liefert, ob die Meldung vorher ausgeblendet war; null = nicht gefunden.
 */
export async function setReportHidden(db: Db, id: string, hidden: boolean): Promise<{ wasHidden: boolean } | null> {
  const before = await db.query<{ hidden: boolean }>('SELECT hidden FROM reports WHERE id = $1', [id]);
  if (!before.rows[0]) return null;
  if (!hidden) await db.query('DELETE FROM report_flags WHERE report_id = $1', [id]);
  await db.query(
    hidden
      ? 'UPDATE reports SET hidden = true WHERE id = $1'
      : 'UPDATE reports SET hidden = false, flags = 0, reviewed_at = now() WHERE id = $1',
    [id],
  );
  return { wasHidden: before.rows[0].hidden };
}

export async function deleteReport(db: Db, id: string): Promise<boolean> {
  const res = await db.query('DELETE FROM reports WHERE id = $1', [id]);
  return (res.rowCount ?? 0) > 0;
}

// --- Konten ---------------------------------------------------------------------------------

interface AdminUserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: Date;
  last_seen_at: Date | null;
  banned: boolean;
  lang: string | null;
  terms_accepted_at: Date | null;
  restricted_until: Date | null;
  reports: string;
  reports_hidden: string;
  flags_received: string;
  devices: string;
  feedback: string;
}

function adminUser(u: AdminUserRow) {
  return {
    uid: u.id,
    email: u.email,
    name: u.display_name,
    createdAt: iso(u.created_at),
    lastSeenAt: iso(u.last_seen_at),
    banned: u.banned,
    lang: u.lang,
    termsAcceptedAt: iso(u.terms_accepted_at),
    restrictedUntil: u.restricted_until && u.restricted_until.getTime() > Date.now() ? iso(u.restricted_until) : null,
    reports: Number(u.reports),
    reportsHidden: Number(u.reports_hidden),
    flagsReceived: Number(u.flags_received),
    devices: Number(u.devices),
    feedback: Number(u.feedback),
  };
}

const USER_SELECT = `
  SELECT u.id, u.email, u.display_name, u.created_at, u.last_seen_at, u.banned, u.lang, u.terms_accepted_at, u.restricted_until,
         (SELECT count(*) FROM reports r WHERE r.user_id = u.id) AS reports,
         (SELECT count(*) FROM reports r WHERE r.user_id = u.id AND r.hidden) AS reports_hidden,
         (SELECT coalesce(sum(r.flags), 0) FROM reports r WHERE r.user_id = u.id) AS flags_received,
         (SELECT count(*) FROM devices d WHERE d.user_id = u.id) AS devices,
         (SELECT count(*) FROM feedback f WHERE f.user_id = u.id) AS feedback
  FROM users u`;

export async function listUsers(db: Db, o: { q?: string; filter: 'all' | 'banned' | 'flagged' | 'restricted'; limit: number; offset: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (o.filter === 'banned') where.push('u.banned');
  if (o.filter === 'flagged') where.push('EXISTS (SELECT 1 FROM reports r WHERE r.user_id = u.id AND r.flags > 0)');
  if (o.filter === 'restricted') where.push('u.restricted_until > now()');
  if (o.q) {
    const like = p(`%${o.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    where.push(`(u.id = ${p(o.q)} OR u.email ILIKE ${like} OR u.display_name ILIKE ${like})`);
  }
  const sql = `${USER_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY u.last_seen_at DESC NULLS LAST, u.created_at DESC LIMIT ${p(o.limit + 1)} OFFSET ${p(o.offset)}`;
  const { rows } = await db.query<AdminUserRow>(sql, params);
  return { items: rows.slice(0, o.limit).map(adminUser), hasMore: rows.length > o.limit };
}

export async function getUser(db: Db, uid: string) {
  const { rows } = await db.query<AdminUserRow>(`${USER_SELECT} WHERE u.id = $1`, [uid]);
  return rows[0] ? adminUser(rows[0]) : null;
}

/** Sperren (optional alle Hinweise ausblenden) / entsperren. false = nicht gefunden. */
export async function setBanned(db: Db, uid: string, banned: boolean, hideReports = false): Promise<boolean> {
  const res = await db.query('UPDATE users SET banned = $2 WHERE id = $1', [uid, banned]);
  if ((res.rowCount ?? 0) === 0) return false;
  if (banned) {
    await db.query('DELETE FROM devices WHERE user_id = $1', [uid]);
    await db.query('DELETE FROM trackings WHERE user_id = $1', [uid]);
    if (hideReports) await db.query('UPDATE reports SET hidden = true WHERE user_id = $1', [uid]);
  }
  return true;
}

export async function resetName(db: Db, uid: string): Promise<boolean> {
  const res = await db.query('UPDATE users SET display_name = NULL WHERE id = $1', [uid]);
  return (res.rowCount ?? 0) > 0;
}

/**
 * Catch-Daten des Kontos löschen (wie "Konto löschen" in der App): Geräte, Trackings, Stimmen weg,
 * Hinweise bleiben anonymisiert. Das Firebase-Konto selbst bleibt unangetastet – es kann zu
 * anderen Diensten im selben Firebase-Projekt gehören. Dauerhaft fernhalten: sperren statt löschen.
 */
export async function deleteUserData(db: Db, uid: string, deleteReports: boolean): Promise<boolean> {
  if (deleteReports) await db.query('DELETE FROM reports WHERE user_id = $1', [uid]);
  const res = await db.query('DELETE FROM users WHERE id = $1', [uid]);
  return (res.rowCount ?? 0) > 0;
}

// --- Feedback -------------------------------------------------------------------------------

export type FeedbackStatus = 'NEW' | 'READ' | 'DONE';

export async function listFeedback(db: Db, o: { status?: FeedbackStatus; limit: number; offset: number }) {
  const params: unknown[] = [];
  let where = '';
  if (o.status) {
    params.push(o.status);
    where = 'WHERE f.status = $1';
  }
  params.push(o.limit + 1, o.offset);
  const { rows } = await db.query<{
    id: string;
    created_at: Date;
    user_id: string | null;
    category: string;
    message: string;
    rating: number | null;
    allow_contact: boolean;
    app_version: string | null;
    platform: string | null;
    lang: string | null;
    status: FeedbackStatus;
    user_name: string | null;
    user_email: string | null;
    replies: Array<{ id: number; at: string; by: string | null; message: string }> | null;
  }>(
    `SELECT f.*, u.display_name AS user_name, u.email AS user_email,
            (SELECT json_agg(json_build_object('id', x.id, 'at', x.created_at, 'by', x.admin_uid, 'message', x.message) ORDER BY x.created_at)
               FROM feedback_replies x WHERE x.feedback_id = f.id) AS replies
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     ${where} ORDER BY f.created_at DESC, f.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    items: rows.slice(0, o.limit).map((f) => ({
      id: String(f.id),
      createdAt: iso(f.created_at),
      category: f.category,
      message: f.message,
      rating: f.rating,
      allowContact: f.allow_contact,
      appVersion: f.app_version,
      platform: f.platform,
      lang: f.lang,
      status: f.status,
      // E-Mail nur, wenn die Person einer Antwort zugestimmt hat
      user: f.user_id ? { uid: f.user_id, name: f.user_name, email: f.allow_contact ? f.user_email : null } : null,
      // Antwort per Mail nur mit Zustimmung und vorhandener Adresse
      canReply: Boolean(f.allow_contact && f.user_id && f.user_email),
      replies: (f.replies ?? []).map((x) => ({ id: String(x.id), at: x.at, by: x.by, message: x.message })),
    })),
    hasMore: rows.length > o.limit,
  };
}

export async function setFeedbackStatus(db: Db, id: string, status: FeedbackStatus): Promise<boolean> {
  const res = await db.query('UPDATE feedback SET status = $2 WHERE id = $1', [id, status]);
  return (res.rowCount ?? 0) > 0;
}

export async function deleteFeedback(db: Db, id: string): Promise<boolean> {
  const res = await db.query('DELETE FROM feedback WHERE id = $1', [id]);
  return (res.rowCount ?? 0) > 0;
}

/** Für die Antwort per Mail: Feedback inkl. Adresse (nur mit Zustimmung) und Sprache. */
export async function getFeedbackForReply(db: Db, id: string) {
  const { rows } = await db.query<{
    id: string;
    created_at: Date;
    message: string;
    allow_contact: boolean;
    lang: string | null;
    user_email: string | null;
    user_lang: string | null;
  }>(
    `SELECT f.id, f.created_at, f.message, f.allow_contact, f.lang, u.email AS user_email, u.lang AS user_lang
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.id = $1`,
    [id],
  );
  const f = rows[0];
  if (!f) return null;
  return {
    id: String(f.id),
    createdAt: f.created_at,
    message: f.message,
    email: f.allow_contact && f.user_email?.trim() ? f.user_email.trim() : null,
    lang: f.lang ?? f.user_lang,
  };
}

/** Antwort speichern und Feedback als erledigt markieren. */
export async function addFeedbackReply(db: Db, id: string, adminUid: string, message: string) {
  const { rows } = await db.query<{ id: string; created_at: Date }>(
    'INSERT INTO feedback_replies (feedback_id, admin_uid, message) VALUES ($1, $2, $3) RETURNING id, created_at',
    [id, adminUid, message],
  );
  await db.query(`UPDATE feedback SET status = 'DONE' WHERE id = $1`, [id]);
  return { id: String(rows[0].id), at: iso(rows[0].created_at), by: adminUid, message };
}
