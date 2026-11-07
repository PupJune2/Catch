// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Moderations-Entscheidungen mit Begründung (DSA Art. 17):
 *  - jede Einschränkung (Meldung ausgeblendet/gelöscht, Konto gesperrt, Melden gedrosselt) wird
 *    in moderation_decisions gespeichert – von Hand (Admin) oder automatisch (Markierungen,
 *    Widersprüche, Drosselung)
 *  - die betroffene Person bekommt automatisch eine Catch-Mail in ihrer Sprache mit Grund und
 *    Widerspruchsweg (nur mit E-Mail-Adresse und eingerichtetem Resend, höchstens 5 pro Tag)
 *  - ein Fehler beim Versand blockiert nie die Entscheidung selbst (Protokoll: mail_failed)
 */
import { audit } from '../admin/service.js';
import type { ReportKind } from '../contract.js';
import type { Db } from '../db/pool.js';
import type { Deps } from '../deps.js';
import { parseLang, type Lang } from '../i18n.js';
import {
  decisionMail,
  objectionRoute,
  type DecisionAction,
  type DecisionReason,
  type ReportInfo,
} from '../mail/moderation.js';
import { createResendSender, mailConfigured, type MailSender } from '../mail/resend.js';
import {
  getTrust,
  shouldThrottle,
  throttleInputs,
  THROTTLE_DAYS,
  THROTTLED_COOLDOWN_MINUTES,
  THROTTLED_REPORTS_PER_DAY,
  type Trust,
} from './trust.js';

/** Höchstens so viele Begründungs-Mails pro Konto und 24 Stunden (Sperren/Entsperren zählen nicht). */
export const MAILS_PER_USER_PER_DAY = 5;
/** Entscheidungen werden nach so vielen Tagen gelöscht. */
export const DECISION_RETENTION_DAYS = 365;

export type MailStatus = 'PENDING' | 'SENT' | 'NO_EMAIL' | 'NOT_CONFIGURED' | 'RATE_LIMITED' | 'FAILED' | 'NOT_NEEDED';

export interface DecisionInput {
  userId: string | null;
  reportId?: string | null;
  report?: ReportInfo | null;
  action: DecisionAction;
  reason: DecisionReason;
  note?: string | null;
  detail?: Record<string, unknown> | null;
  automated: boolean;
  adminUid?: string | null;
}

export interface Decision {
  id: string;
  createdAt: string;
  userId: string | null;
  reportId: string | null;
  report: ReportInfo | null;
  action: DecisionAction;
  reason: DecisionReason;
  note: string | null;
  detail: Record<string, unknown> | null;
  automated: boolean;
  adminUid: string | null;
  mailStatus: MailStatus;
}

interface DecisionRow {
  id: string;
  created_at: Date;
  user_id: string | null;
  report_id: string | null;
  report_info: ReportInfo | null;
  action: DecisionAction;
  reason: DecisionReason;
  note: string | null;
  detail: Record<string, unknown> | null;
  automated: boolean;
  admin_uid: string | null;
  mail_status: MailStatus;
}

function decisionFromRow(r: DecisionRow): Decision {
  return {
    id: String(r.id),
    createdAt: r.created_at.toISOString(),
    userId: r.user_id,
    reportId: r.report_id === null ? null : String(r.report_id),
    report: r.report_info,
    action: r.action,
    reason: r.reason,
    note: r.note,
    detail: r.detail,
    automated: r.automated,
    adminUid: r.admin_uid,
    mailStatus: r.mail_status,
  };
}

// --- Versand ---------------------------------------------------------------------------------

const senders = new WeakMap<object, MailSender>();

/** Mail-Versand (in Tests über deps.mail ersetzbar). */
export function mailSender(deps: Pick<Deps, 'cfg' | 'mail'>): MailSender {
  if (deps.mail) return deps.mail;
  let s = senders.get(deps.cfg);
  if (!s) {
    s = createResendSender(deps.cfg);
    senders.set(deps.cfg, s);
  }
  return s;
}

/** Können Catch-Mails verschickt werden? */
export function canMail(deps: Pick<Deps, 'cfg' | 'mail'>): boolean {
  return Boolean(deps.mail) || mailConfigured(deps.cfg);
}

/** Schnappschuss einer Meldung für Mail und Admin-Ansicht (null = gibt es nicht). */
export async function reportInfo(db: Db, reportId: string): Promise<{ userId: string | null; info: ReportInfo } | null> {
  const { rows } = await db.query<{
    user_id: string | null;
    kind: ReportKind;
    line_name: string | null;
    headsign: string | null;
    prev_stop_name: string | null;
    next_stop_name: string | null;
    reported_at: Date;
  }>(
    `SELECT r.user_id, r.kind, l.name AS line_name, r.headsign, r.prev_stop_name, r.next_stop_name, r.reported_at
     FROM reports r LEFT JOIN lines l ON l.line_key = r.line_key WHERE r.id = $1`,
    [reportId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    userId: r.user_id,
    info: {
      kind: r.kind,
      line: r.line_name,
      headsign: r.headsign,
      prevStop: r.prev_stop_name,
      nextStop: r.next_stop_name,
      reportedAt: r.reported_at.toISOString(),
    },
  };
}

async function sendDecisionMail(deps: Deps, d: Decision): Promise<MailStatus> {
  const { db, cfg, log } = deps;
  if (d.action === 'REPORT_UNHIDE') return 'NOT_NEEDED';
  if (!d.userId) return 'NO_EMAIL';
  const { rows } = await db.query<{ email: string | null; lang: string | null }>('SELECT email, lang FROM users WHERE id = $1', [d.userId]);
  const email = rows[0]?.email?.trim();
  if (!email) return 'NO_EMAIL';
  if (!canMail(deps)) return 'NOT_CONFIGURED';
  if (d.action !== 'USER_BAN' && d.action !== 'USER_UNBAN') {
    const sent = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM moderation_decisions
       WHERE user_id = $1 AND mail_status = 'SENT' AND created_at >= now() - interval '24 hours'`,
      [d.userId],
    );
    if (Number(sent.rows[0]?.n ?? 0) >= MAILS_PER_USER_PER_DAY) return 'RATE_LIMITED';
  }
  const lang: Lang = parseLang(rows[0]?.lang) ?? 'en';
  const mail = decisionMail(
    lang,
    {
      action: d.action,
      reason: d.reason,
      note: d.note,
      automated: d.automated,
      report: d.report,
      hideReports: Boolean(d.detail?.hideReports),
      until: typeof d.detail?.until === 'string' ? d.detail.until : null,
      limits: { perDay: THROTTLED_REPORTS_PER_DAY, cooldownMinutes: THROTTLED_COOLDOWN_MINUTES, days: THROTTLE_DAYS },
      objection: objectionRoute(cfg),
    },
    cfg.CATCH_PUBLIC_URL,
  );
  if (!mail) return 'NOT_NEEDED';
  try {
    await mailSender(deps)({ to: email, ...mail });
    return 'SENT';
  } catch (err) {
    const message = (err as Error).message?.slice(0, 200) ?? 'unknown';
    log.error({ err: message, decision: d.id }, 'Begründungs-Mail konnte nicht gesendet werden');
    await audit(db, { uid: null, action: 'mail_failed', target: d.userId, detail: { decision: d.id, action: d.action, error: message } }).catch(() => undefined);
    return 'FAILED';
  }
}

/**
 * Entscheidung speichern und die betroffene Person per Mail informieren.
 * `waitForMail: false` (automatische Fälle während einer Nutzer-Anfrage): Mail im Hintergrund.
 * Wirft nur, wenn die Entscheidung selbst nicht gespeichert werden kann.
 */
export async function recordDecision(deps: Deps, input: DecisionInput, opts: { waitForMail?: boolean } = {}): Promise<Decision> {
  const { db, log } = deps;
  const { rows } = await db.query<DecisionRow>(
    `INSERT INTO moderation_decisions (user_id, report_id, report_info, action, reason, note, detail, automated, admin_uid, mail_status)
     VALUES ((SELECT id FROM users WHERE id = $1), $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.userId,
      input.reportId ?? null,
      input.report ? JSON.stringify(input.report) : null,
      input.action,
      input.reason,
      input.note?.trim() ? input.note.trim().slice(0, 300) : null,
      input.detail ? JSON.stringify(input.detail) : null,
      input.automated,
      input.adminUid ?? null,
      input.action === 'REPORT_UNHIDE' ? 'NOT_NEEDED' : 'PENDING',
    ],
  );
  const decision = decisionFromRow(rows[0]);
  if (decision.mailStatus !== 'PENDING') return decision;
  const deliver = async () => {
    let status: MailStatus;
    try {
      status = await sendDecisionMail(deps, decision);
    } catch (err) {
      log.error({ err }, 'Begründungs-Mail: Fehler');
      status = 'FAILED';
    }
    await db.query('UPDATE moderation_decisions SET mail_status = $2 WHERE id = $1', [decision.id, status]);
    decision.mailStatus = status;
    return decision;
  };
  if (opts.waitForMail === false) {
    deliver().catch((err) => log.error({ err }, 'Begründungs-Mail: Status nicht gespeichert'));
    return decision;
  }
  return deliver();
}

export async function listDecisions(db: Db, o: { uid?: string; limit: number }): Promise<Decision[]> {
  const { rows } = await db.query<DecisionRow>(
    `SELECT * FROM moderation_decisions WHERE ($1::text IS NULL OR user_id = $1) ORDER BY created_at DESC, id DESC LIMIT $2`,
    [o.uid ?? null, o.limit],
  );
  return rows.map(decisionFromRow);
}

export async function deleteOldDecisions(db: Db): Promise<void> {
  await db.query(`DELETE FROM moderation_decisions WHERE created_at < now() - make_interval(days => $1)`, [DECISION_RETENTION_DAYS]);
}

// --- Automatische Entscheidungen -----------------------------------------------------------

/** Meldung wurde automatisch ausgeblendet (Markierungen oder Widersprüche) → Entscheidung + Mail. */
export async function onAutoHidden(deps: Deps, reportId: string, reason: 'FLAGGED' | 'DISPUTED'): Promise<void> {
  const r = await reportInfo(deps.db, reportId);
  if (!r) return;
  const decision = await recordDecision(
    deps,
    { userId: r.userId, reportId, report: r.info, action: 'REPORT_HIDE', reason, automated: true },
    { waitForMail: false },
  );
  await audit(deps.db, { uid: null, action: 'auto_report_hide', target: reportId, detail: { reason, decision: decision.id, user: r.userId } });
  if (r.userId) await checkThrottle(deps, r.userId);
}

/**
 * Prüft, ob ein Konto gedrosselt werden muss (wiederholt umstrittene Meldungen), und drosselt es
 * dann für THROTTLE_DAYS Tage. Gibt das Ende einer aktiven Drosselung zurück (null = keine).
 */
export async function checkThrottle(deps: Deps, uid: string, known?: Trust): Promise<Date | null> {
  const { db } = deps;
  const trust = known ?? (await getTrust(db, uid));
  if (trust.restrictedUntil) return trust.restrictedUntil;
  const inputs = await throttleInputs(db, uid, trust.restrictionLiftedAt);
  if (!shouldThrottle(inputs)) return null;
  const until = new Date(Date.now() + THROTTLE_DAYS * 86_400_000);
  const upd = await db.query<{ restricted_until: Date }>(
    `UPDATE users SET restricted_until = $2
     WHERE id = $1 AND NOT banned AND (restricted_until IS NULL OR restricted_until <= now())
     RETURNING restricted_until`,
    [uid, until],
  );
  if (!upd.rows[0]) {
    // Gleichzeitig schon gedrosselt (oder gesperrt)
    const cur = await db.query<{ restricted_until: Date | null }>('SELECT restricted_until FROM users WHERE id = $1', [uid]);
    const u = cur.rows[0]?.restricted_until ?? null;
    return u && u.getTime() > Date.now() ? u : null;
  }
  const decision = await recordDecision(
    deps,
    {
      userId: uid,
      action: 'USER_THROTTLE',
      reason: 'DISPUTED',
      automated: true,
      detail: { until: until.toISOString(), ...inputs },
    },
    { waitForMail: false },
  );
  await audit(db, { uid: null, action: 'auto_user_throttle', target: uid, detail: { decision: decision.id, until: until.toISOString(), ...inputs } });
  return until;
}

/** Admin hebt eine Drosselung auf. false = es war keine aktiv (oder Konto unbekannt). */
export async function liftThrottle(db: Db, uid: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE users SET restricted_until = NULL, restriction_lifted_at = now()
     WHERE id = $1 AND restricted_until > now()`,
    [uid],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Hintergrund-Aufgabe ohne die Anfrage zu blockieren. */
export function inBackground(deps: Pick<Deps, 'log'>, what: string, p: Promise<unknown>): void {
  p.catch((err) => deps.log.error({ err }, `Moderation (${what}) fehlgeschlagen`));
}
