// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Empfangene E-Mails (Resend Receiving) – reine Hilfsfunktionen ohne Datenbank:
 *  - Webhook-Signatur prüfen (Resend signiert mit Svix: HMAC-SHA256 über "id.timestamp.rohdaten")
 *  - Inhalt einer empfangenen Mail aufbereiten: nur reiner Text (HTML wird hier in Text umgewandelt
 *    und NIE als HTML angezeigt), Anhänge nur als Metadaten
 *  - Antwort-Header (In-Reply-To/References), Betreff "Re: …", Sprache erraten
 * Datenbank und Abruf bei Resend: services/inbox.ts
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Lang } from '../i18n.js';

/** Webhook-Ereignisse für empfangene Mails (Domain-Empfang bzw. Resend Inboxes). */
export const INBOUND_EVENTS: readonly string[] = ['email.received', 'inbox.email.received'];
/** Zeitstempel eines Webhooks darf höchstens so weit abweichen (Schutz vor Wiederholung). */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
/** Gespeicherter Text einer Mail: höchstens so viele Zeichen (~100 KB). */
export const MAIL_TEXT_MAX = 100_000;
/** HTML wird vor dem Umwandeln auf diese Länge gekürzt (Schutz vor riesigen Mails). */
const HTML_INPUT_MAX = 2_000_000;

// --- Webhook-Signatur (Svix) ------------------------------------------------------------------

/** Schlüssel aus "whsec_<base64>"; null = kein gültiges Secret. */
export function webhookKey(secret: string): Buffer | null {
  const s = secret.trim();
  if (!/^whsec_[A-Za-z0-9+/=]{20,}$/.test(s)) return null;
  const key = Buffer.from(s.slice(6), 'base64');
  return key.length >= 15 ? key : null;
}

/** Signatur wie Svix sie bildet ("v1,<base64>") – für Tests und eigene Probe-Webhooks. */
export function signWebhook(secret: string, id: string, timestamp: number | string, body: string | Buffer): string {
  const key = webhookKey(secret);
  if (!key) throw new Error('Ungültiges Webhook-Secret');
  return 'v1,' + createHmac('sha256', key).update(`${id}.${timestamp}.`).update(body).digest('base64');
}

export type WebhookCheck =
  | { ok: true; id: string; timestamp: number }
  | { ok: false; reason: 'not_configured' | 'missing_headers' | 'bad_timestamp' | 'expired' | 'bad_signature' };

/**
 * Prüft einen Webhook: Header svix-id, svix-timestamp, svix-signature ("v1,<sig> v1,<sig> …").
 * `body` sind die unveränderten Rohdaten der Anfrage. Vergleich in konstanter Zeit.
 */
export function verifyWebhook(
  secret: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  body: string | Buffer,
  nowMs = Date.now(),
): WebhookCheck {
  const key = webhookKey(secret);
  if (!key) return { ok: false, reason: 'not_configured' };
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || id.length > 256 || signature.length > 4096) return { ok: false, reason: 'missing_headers' };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'bad_timestamp' };
  const ts = Number(timestamp);
  if (Math.abs(nowMs / 1000 - ts) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: 'expired' };
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(body).digest();
  for (const part of signature.trim().split(/\s+/)) {
    const comma = part.indexOf(',');
    if (comma < 0 || part.slice(0, comma) !== 'v1') continue;
    const given = Buffer.from(part.slice(comma + 1), 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true, id, timestamp: ts };
  }
  return { ok: false, reason: 'bad_signature' };
}

// --- Text ---------------------------------------------------------------------------------------

/** Steuer- und Richtungszeichen raus (außer Zeilenumbruch/Tab), Zeilenenden glätten, max. 2 Leerzeilen. */
export function cleanMailText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Text auf `max` Zeichen kürzen (ohne ein Surrogat-Paar zu zerschneiden). */
export function capText(s: string, max = MAIL_TEXT_MAX): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  let cut = max;
  const c = s.charCodeAt(cut - 1);
  if (c >= 0xd800 && c <= 0xdbff) cut--;
  return { text: s.slice(0, cut), truncated: true };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·', laquo: '«', raquo: '»',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  euro: '€', pound: '£', yen: '¥', cent: '¢', copy: '©', reg: '®', trade: '™', deg: '°', times: '×', divide: '÷',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  eacute: 'é', egrave: 'è', ecirc: 'ê', aacute: 'á', agrave: 'à', acirc: 'â', ccedil: 'ç', ntilde: 'ñ',
  oacute: 'ó', iacute: 'í', uacute: 'ú', shy: '', zwnj: '', zwj: '',
};

/** HTML-Entitäten in Text (nur für die Umwandlung – das Ergebnis ist reiner Text). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/g, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '';
      if (cp < 32 && cp !== 9 && cp !== 10) return cp === 13 ? '' : ' ';
      return String.fromCodePoint(cp);
    }
    return NAMED_ENTITIES[e] ?? m;
  });
}

const DROP_TAGS = new Set(['script', 'style', 'head', 'title', 'template', 'noscript', 'svg', 'math', 'object', 'iframe', 'xml']);
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'table', 'thead', 'tbody', 'tfoot', 'tr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'address', 'center', 'form', 'fieldset', 'figure',
]);

/**
 * HTML → reiner Text. Einfacher, linearer Durchlauf (kein Regex über das ganze Dokument):
 * Skripte/Styles/Kopf fallen weg, Blöcke werden zu Zeilen, Links zu "Text (URL)", Entitäten werden
 * aufgelöst. Das Ergebnis wird im Admin-Bereich nur als Text angezeigt.
 */
export function htmlToPlainText(htmlRaw: string): string {
  const s = htmlRaw.length > HTML_INPUT_MAX ? htmlRaw.slice(0, HTML_INPUT_MAX) : htmlRaw;
  const lower = s.toLowerCase();
  const n = s.length;
  let out = '';
  let i = 0;
  let pre = 0;
  let lastGt = -1;
  const links: Array<{ href: string | null; start: number }> = [];
  const text = (seg: string) => {
    if (!seg) return;
    out += decodeEntities(pre > 0 ? seg : seg.replace(/[ \t\r\n\f]+/g, ' '));
  };
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      text(s.slice(i));
      break;
    }
    text(s.slice(i, lt));
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    // Erstes ">" nach lt (gemerkt, damit "a < b < c" nicht quadratisch wird)
    const gt = lastGt > lt ? lastGt : s.indexOf('>', lt + 1);
    lastGt = gt;
    if (gt < 0) {
      text(s.slice(lt));
      break;
    }
    const m = /^(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(s.slice(lt + 1, Math.min(gt, lt + 40)));
    if (!m) {
      // "<!doctype …>", "<?xml …?>" überspringen, sonst ist "<" normaler Text
      if (s[lt + 1] === '!' || s[lt + 1] === '?') {
        i = gt + 1;
      } else {
        text('<');
        i = lt + 1;
      }
      continue;
    }
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    i = gt + 1;
    if (DROP_TAGS.has(name)) {
      if (!closing && s[gt - 1] !== '/') {
        const end = lower.indexOf('</' + name, gt + 1);
        if (end < 0) {
          i = n;
        } else {
          const endGt = s.indexOf('>', end);
          i = endGt < 0 ? n : endGt + 1;
        }
      }
      continue;
    }
    if (name === 'br') out += '\n';
    else if (name === 'hr') out += '\n――――――\n';
    else if (name === 'li') out += closing ? '' : '\n• ';
    else if (name === 'td' || name === 'th') out += closing ? '' : ' ';
    else if (BLOCK_TAGS.has(name)) {
      out += '\n';
      if (name === 'pre') pre = Math.max(0, pre + (closing ? -1 : 1));
    } else if (name === 'img' && !closing) {
      const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(s.slice(lt, gt));
      const a = decodeEntities(alt?.[1] ?? alt?.[2] ?? '').trim();
      if (a) out += `[${a.slice(0, 100)}]`;
    } else if (name === 'a') {
      if (!closing) {
        const h = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(s.slice(lt, gt));
        const href = h ? decodeEntities(h[1] ?? h[2] ?? h[3] ?? '').trim() : null;
        links.push({ href: href && /^(https?:|mailto:)/i.test(href) ? href.slice(0, 500) : null, start: out.length });
      } else {
        const l = links.pop();
        if (l?.href) {
          const label = out.slice(l.start).trim();
          const bare = l.href.replace(/^mailto:/i, '');
          if (!label) out += bare;
          else if (!label.includes(bare) && !bare.includes(label)) out += ` (${bare})`;
        }
      }
    }
  }
  return cleanMailText(
    out
      .split('\n')
      .map((l) => l.replace(/^[ \t]+|[ \t]+$/g, ''))
      .join('\n'),
  );
}

// --- Adressen, Header, Prüfergebnisse --------------------------------------------------------------

export interface MailAddress {
  address: string;
  name: string | null;
}

const EMAIL_RE = /^[^\s<>@",;]+@[^\s<>@",;]+\.[^\s<>@",;]+$/;

export function isEmailAddress(s: string): boolean {
  return s.length <= 254 && EMAIL_RE.test(s);
}

function cleanName(raw: string): string | null {
  const n = cleanMailText(raw.replace(/^\s*"(.*)"\s*$/, '$1').replace(/\\"/g, '"')).replace(/\s+/g, ' ').trim();
  return n ? n.slice(0, 200) : null;
}

/** "Anna <anna@x.de>", "anna@x.de" oder { email, name } → { address, name }. */
export function parseAddress(v: unknown): MailAddress | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const address = typeof o.email === 'string' ? o.email : typeof o.address === 'string' ? o.address : '';
    if (!isEmailAddress(address.trim())) return null;
    return { address: address.trim().slice(0, 254), name: typeof o.name === 'string' ? cleanName(o.name) : null };
  }
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, 1000);
  const m = /^(.*?)<\s*([^<>\s]+)\s*>\s*$/.exec(s);
  if (m && isEmailAddress(m[2])) return { address: m[2], name: cleanName(m[1]) };
  return isEmailAddress(s) ? { address: s, name: null } : null;
}

export function formatAddress(a: MailAddress): string {
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

/** Liste von Adressen (Array oder kommagetrennt) → ["Name <a@b>", …], höchstens 20. */
export function addressList(v: unknown): string[] {
  const items = Array.isArray(v) ? v.slice(0, 50) : typeof v === 'string' ? v.slice(0, 5000).split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/) : v ? [v] : [];
  return items
    .map((x) => parseAddress(x))
    .filter((x): x is MailAddress => Boolean(x))
    .slice(0, 20)
    .map(formatAddress);
}

/** Header als { name: wert } (Kleinbuchstaben) – Resend liefert ein Objekt oder eine Liste. */
export function headerMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: unknown, val: unknown) => {
    if (typeof k !== 'string') return;
    const key = k.trim().toLowerCase();
    const value = Array.isArray(val) ? val.filter((x) => typeof x === 'string').join(', ') : typeof val === 'string' ? val : null;
    if (!key || value === null || key in out) return;
    out[key] = value;
  };
  if (Array.isArray(v)) {
    for (const h of v) if (h && typeof h === 'object') put((h as Record<string, unknown>).name ?? (h as Record<string, unknown>).key, (h as Record<string, unknown>).value);
  } else if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) put(k, val);
  }
  return out;
}

/** Diese Header werden gespeichert (für die Detail-Ansicht). */
const KEEP_HEADERS = [
  'date', 'reply-to', 'return-path', 'sender', 'auto-submitted', 'precedence', 'x-autoreply', 'x-autorespond',
  'x-auto-response-suppress', 'list-id', 'list-unsubscribe', 'x-mailer', 'user-agent', 'x-spam-status', 'x-spam-flag',
  'authentication-results', 'received-spf',
];

export function pickHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEEP_HEADERS) if (h[k]) out[k] = cleanMailText(h[k]).replace(/\s+/g, ' ').slice(0, k === 'authentication-results' ? 1000 : 300);
  return out;
}

/** Automatische Antwort (Abwesenheitsnotiz, Liste, Bulk)? */
export function isAutoReply(h: Record<string, string> | null | undefined): boolean {
  if (!h) return false;
  const auto = (h['auto-submitted'] ?? '').trim().toLowerCase();
  return (
    (auto !== '' && auto !== 'no') ||
    /^(auto_reply|bulk|junk|list)$/i.test((h.precedence ?? '').trim()) ||
    Boolean(h['x-autoreply'] || h['x-autorespond'])
  );
}

export interface MailAuth {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
}

function verdict(v: unknown): string | null {
  if (typeof v === 'string') return v.trim().toLowerCase().replace(/[^a-z_-]/g, '').slice(0, 20) || null;
  if (typeof v === 'boolean') return v ? 'pass' : 'fail';
  if (Array.isArray(v)) {
    const all = v.map(verdict).filter((x): x is string => Boolean(x));
    return all.includes('pass') ? 'pass' : (all[0] ?? null);
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return verdict(o.result ?? o.status ?? o.verdict ?? o.value ?? null);
  }
  return null;
}

/** SPF/DKIM/DMARC aus `authentication` (Resend), sonst aus dem Header Authentication-Results. */
export function normalizeAuth(v: unknown, headers: Record<string, string> = {}): MailAuth {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const ar = headers['authentication-results'] ?? '';
  const fromHeader = (k: string) => verdict(new RegExp(`\\b${k}\\s*=\\s*([a-z]+)`, 'i').exec(ar)?.[1] ?? null);
  return {
    spf: verdict(o.spf) ?? fromHeader('spf') ?? verdict(headers['received-spf']?.split(/\s/)[0] ?? null),
    dkim: verdict(o.dkim) ?? fromHeader('dkim'),
    dmarc: verdict(o.dmarc) ?? fromHeader('dmarc'),
  };
}

/** Welche Prüfungen fehlgeschlagen sind (für das ⚠ im Admin-Bereich). */
export function authWarnings(a: Partial<MailAuth> | null | undefined): Array<keyof MailAuth> {
  if (!a) return [];
  return (['spf', 'dkim', 'dmarc'] as const).filter((k) => /^(fail|softfail|hardfail|permerror)$/.test(String(a[k] ?? '')));
}

export interface MailAttachment {
  id: string | null;
  filename: string | null;
  contentType: string | null;
  size: number | null;
  inline: boolean;
}

/** Nur Metadaten der Anhänge – Inhalte werden nie geladen oder gespeichert. */
export function attachmentMeta(v: unknown): MailAttachment[] {
  if (!Array.isArray(v)) return [];
  const str = (x: unknown, max: number) => (typeof x === 'string' && x.trim() ? cleanMailText(x).replace(/\s+/g, ' ').slice(0, max) : null);
  return v.slice(0, 50).map((a) => {
    const o = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
    const size = typeof o.size === 'number' && Number.isFinite(o.size) && o.size >= 0 ? Math.round(o.size) : null;
    return {
      id: str(o.id, 100),
      filename: str(o.filename ?? o.name, 200),
      contentType: str(o.content_type ?? o.contentType, 100),
      size,
      inline: String(o.content_disposition ?? '').toLowerCase() === 'inline',
    };
  });
}

// --- Message-IDs, Antwort-Header, Betreff ---------------------------------------------------------

const MSGID_RE = /<[\x21-\x3b\x3d\x3f-\x7e]{1,250}>/g;

/** Message-IDs ("<…>") aus einem Header; nur druckbares ASCII, keine Leerzeichen. */
export function parseMessageIds(v: string | null | undefined): string[] {
  return v ? (v.match(MSGID_RE) ?? []) : [];
}

export function normalizeMessageId(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  const wrapped = s.startsWith('<') ? s : `<${s}>`;
  return /^<[\x21-\x3b\x3d\x3f-\x7e]{1,250}>$/.test(wrapped) ? wrapped : null;
}

/**
 * Header für eine Antwort im selben Thread (RFC 5322): In-Reply-To = Message-ID der empfangenen
 * Mail, References = deren References (bzw. In-Reply-To) + ihre Message-ID. Höchstens 10 IDs
 * (die erste bleibt, wie üblich).
 */
export function threadHeaders(
  messageId: string | null | undefined,
  references?: string | null,
  inReplyTo?: string | null,
): Record<string, string> {
  const mid = normalizeMessageId(messageId);
  if (!mid) return {};
  let refs = parseMessageIds(references);
  if (!refs.length) refs = parseMessageIds(inReplyTo).slice(0, 1);
  const all = [...new Set([...refs.filter((r) => r !== mid), mid])];
  const kept = all.length > 10 ? [all[0], ...all.slice(-9)] : all;
  return { 'In-Reply-To': mid, References: kept.join(' ') };
}

const REPLY_PREFIX = /^\s*(re|aw|antw|sv|vs|wg|fw|fwd)\s*(\[\d+\]|\(\d+\))?\s*:/i;

/** "Re: <Betreff>" ohne doppeltes Präfix; Steuerzeichen raus, höchstens 200 Zeichen. */
export function replySubject(subject: string | null | undefined, lang: Lang): string {
  const s = (subject ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!s) return lang === 'de' ? 'Re: Deine Nachricht an Catch' : 'Re: Your message to Catch';
  return /^\s*(re|aw|antw|sv|vs)\s*(\[\d+\]|\(\d+\))?\s*:/i.test(s) ? s : `Re: ${s}`;
}

/** Betreff ohne "Re:/AW:/Fwd:"-Präfixe (z. B. zum Gruppieren). */
export function baseSubject(subject: string | null | undefined): string {
  let s = (subject ?? '').trim();
  while (REPLY_PREFIX.test(s)) s = s.replace(REPLY_PREFIX, '').trim();
  return s;
}

const QUOTE_HEADER = /^(on|am)\s.{4,300}\s(wrote|schrieb[^:]{0,200}):\s*$/i;
const QUOTE_SEPARATORS = [
  /^-{2,}\s*(original message|ursprüngliche nachricht|forwarded message|weitergeleitete nachricht)\s*-{2,}\s*$/i,
  /^_{10,}\s*$/,
];

/**
 * Nur die neue Nachricht: zitierte Zeilen ("> …") und alles ab "Am … schrieb …:" /
 * "On … wrote:" / "-----Original Message-----" / Outlook-Kopf ("Von: … Gesendet: …") fällt weg.
 * Ergebnis höchstens `max` Zeichen (mit "…").
 */
export function trimQuoted(text: string | null | undefined, max = 1500): string {
  const lines = (text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const next = (lines[i + 1] ?? '').trim();
    if (QUOTE_SEPARATORS.some((r) => r.test(l))) break;
    if (QUOTE_HEADER.test(l) || (/^(on|am)\s/i.test(l) && QUOTE_HEADER.test(`${l} ${next}`))) break;
    if (/^(from|von):\s/i.test(l) && /^(sent|gesendet|date|datum|to|an):\s/i.test(next)) break;
    if (l.startsWith('>')) continue;
    kept.push(lines[i]);
  }
  const s = cleanMailText(kept.join('\n'));
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, '') + ' …';
}

const DE_WORDS = new Set(
  ('und ich nicht ist das die der den dem ein eine einen mit hallo danke bitte mein meine meinen wurde wurden habe hast hat ' +
    'warum wieso weshalb gesperrt meldung meldungen grüße gruß liebe lieber sehr geehrte geehrter für auf zu es sie du dein deine ' +
    'wir uns auch aber schon noch kann können konto bei von sich wenn dass weil oder nur mir mich dir dich euch ihr gerne viele').split(' '),
);
const EN_WORDS = new Set(
  ('the and is not this that my i you your hello hi hey thanks thank please was were have has why account report reports ' +
    'regards dear with for are it we our us but also still be can could would should if because or only me to of in on ' +
    'blocked banned hidden best kind sincerely').split(' '),
);

/** Grobe Sprach-Erkennung (de/en) für die Antwort, wenn die Person kein Catch-Konto hat. */
export function detectLang(...parts: Array<string | null | undefined>): Lang {
  const raw = parts.filter(Boolean).join('\n');
  if (/^\s*(aw|antw|wg)\s*:/i.test(parts[0] ?? '')) return 'de';
  const words = trimQuoted(raw, 4000).toLowerCase().match(/[a-zäöüß]+/g) ?? [];
  let de = 0;
  let en = 0;
  for (const w of words) {
    if (DE_WORDS.has(w)) de++;
    if (EN_WORDS.has(w)) en++;
    if (/[äöüß]/.test(w)) de += 0.5;
  }
  return de > en ? 'de' : 'en';
}

// --- Inhalt einer empfangenen Mail (GET /emails/receiving/{id}) ------------------------------------

export interface ReceivedEmail {
  id: string;
  createdAt: Date | null;
  from: MailAddress | null;
  to: string[];
  cc: string[];
  replyTo: string[];
  subject: string | null;
  text: string;
  textTruncated: boolean;
  textFromHtml: boolean;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  auth: MailAuth;
  attachments: MailAttachment[];
  headers: Record<string, string>;
}

export function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function cleanSubject(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = cleanMailText(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 500) : null;
}

/** Antwort der Resend-API → aufbereitete Mail (fehlende Felder sind erlaubt). */
export function parseReceivedEmail(json: unknown, fallbackId: string): ReceivedEmail {
  let o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  if (!('subject' in o) && !('from' in o) && o.data && typeof o.data === 'object') o = o.data as Record<string, unknown>;
  const headers = headerMap(o.headers);
  const textRaw = typeof o.text === 'string' ? cleanMailText(o.text) : '';
  const html = typeof o.html === 'string' ? o.html : '';
  const fromHtml = !textRaw && Boolean(html.trim());
  const capped = capText(fromHtml ? htmlToPlainText(html) : textRaw);
  const ids = (k: string) => {
    const v = headers[k];
    const list = parseMessageIds(v);
    return list.length ? list.join(' ').slice(0, 4000) : null;
  };
  return {
    id: typeof o.id === 'string' && o.id ? o.id : fallbackId,
    createdAt: parseDate(o.created_at),
    from: parseAddress(o.from) ?? parseAddress(headers.from),
    to: addressList(o.to),
    cc: addressList(o.cc),
    replyTo: addressList(o.reply_to ?? headers['reply-to']),
    subject: cleanSubject(o.subject ?? headers.subject),
    text: capped.text,
    textTruncated: capped.truncated,
    textFromHtml: fromHtml,
    messageId: normalizeMessageId(typeof o.message_id === 'string' ? o.message_id : headers['message-id']),
    inReplyTo: ids('in-reply-to'),
    references: ids('references'),
    auth: normalizeAuth(o.authentication, headers),
    attachments: attachmentMeta(o.attachments),
    headers: pickHeaders(headers),
  };
}
