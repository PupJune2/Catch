// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Live-Tracking: Nutzer abonnieren eine Linie für ein Zeitfenster. Kommt in diesem
 * Zeitraum eine passende Meldung, gibt es Push + In-App-Popup.
 */
import { z } from 'zod';
import type { Report, Tracking, TrackingAlert } from '../contract.js';
import type { Deps } from '../deps.js';
import type { Db } from '../db/pool.js';
import { HttpError, parse } from '../http.js';
import { alertTitle, DEFAULT_LANG, t, type Lang } from '../i18n.js';
import { canonicalStopId } from '../transit/mapping.js';
import { REPORT_SELECT, reportFromRow, summariesFor, upsertLine, type ReportRow } from './reports.js';
import { lineSchema, normalizeLine } from './schemas.js';
import { REPORT_KINDS, type ReportKind } from '../contract.js';
import { shortStopName } from './stats.js';
import { getTrust } from './trust.js';

const MAX_ACTIVE_TRACKINGS = 10;
const MAX_DURATION_H = 6;

const createTrackingSchema = z
  .object({
    line: lineSchema,
    directionId: z.string().max(20).optional(),
    headsign: z.string().max(200).optional(),
    tripId: z.string().max(300).optional(),
    bothDirections: z.boolean().optional(),
    kinds: z.array(z.enum(REPORT_KINDS as [ReportKind, ...ReportKind[]])).max(5).optional(),
    fromStop: z.object({ id: z.string().max(200), name: z.string().max(200) }).optional(),
    toStop: z.object({ id: z.string().max(200), name: z.string().max(200) }).optional(),
    stopIds: z.array(z.string().max(200)).max(200).optional(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
  })
  .refine((b) => Date.parse(b.endsAt) > Date.parse(b.startsAt), { message: 'end must be after start', path: ['endsAt'] })
  .refine((b) => Date.parse(b.endsAt) - Date.parse(b.startsAt) <= MAX_DURATION_H * 3600_000, {
    message: `at most ${MAX_DURATION_H} hours`,
    path: ['endsAt'],
  })
  .refine((b) => Date.parse(b.endsAt) > Date.now(), { message: 'time window is in the past', path: ['endsAt'] });

interface TrackingRow {
  id: string;
  user_id: string;
  line_key: string;
  direction_id: string | null;
  headsign: string | null;
  trip_id: string | null;
  both_directions: boolean;
  kinds: ReportKind[];
  from_stop_id: string | null;
  from_stop_name: string | null;
  to_stop_id: string | null;
  to_stop_name: string | null;
  stop_ids: string[];
  starts_at: Date;
  ends_at: Date;
  created_at: Date;
  line_name: string;
  line_mode: string;
  line_operator: string | null;
  line_color: string | null;
  line_text_color: string | null;
  alert_count?: string;
}

const TRACKING_SELECT = `
  SELECT t.*, l.name AS line_name, l.mode AS line_mode, l.operator AS line_operator,
         l.color AS line_color, l.text_color AS line_text_color,
         (SELECT count(*) FROM tracking_alerts a WHERE a.tracking_id = t.id) AS alert_count
  FROM trackings t JOIN lines l ON l.line_key = t.line_key`;

function trackingFromRow(r: TrackingRow, now = Date.now()): Tracking {
  const line: Tracking['line'] = { key: r.line_key, name: r.line_name, mode: r.line_mode as Tracking['line']['mode'] };
  if (r.line_operator) line.operator = r.line_operator;
  if (r.line_color) line.color = r.line_color;
  if (r.line_text_color) line.textColor = r.line_text_color;
  return {
    id: String(r.id),
    lineKey: r.line_key,
    line,
    directionId: r.direction_id,
    headsign: r.headsign,
    tripId: r.trip_id,
    bothDirections: r.both_directions,
    kinds: r.kinds ?? [],
    fromStop: r.from_stop_id && r.from_stop_name ? { id: r.from_stop_id, name: r.from_stop_name } : null,
    toStop: r.to_stop_id && r.to_stop_name ? { id: r.to_stop_id, name: r.to_stop_name } : null,
    startsAt: r.starts_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
    createdAt: r.created_at.toISOString(),
    active: r.starts_at.getTime() <= now && r.ends_at.getTime() >= now,
    alertCount: Number(r.alert_count ?? 0),
  };
}

export async function createTracking(deps: Deps, uid: string, input: unknown): Promise<Tracking> {
  const body = parse(createTrackingSchema, input);
  const { db } = deps;
  const { rows: cnt } = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM trackings WHERE user_id = $1 AND ends_at >= now() AND source = 'manual'",
    [uid],
  );
  if (Number(cnt[0]?.n ?? 0) >= MAX_ACTIVE_TRACKINGS) {
    throw new HttpError(429, 'too_many_trackings', 'too_many_trackings', { max: MAX_ACTIVE_TRACKINGS });
  }
  const line = normalizeLine(body.line);
  await upsertLine(db, line);
  const stopIds = [...new Set((body.stopIds ?? []).map((s) => canonicalStopId(s)).filter((s): s is string => !!s))];
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO trackings (user_id, line_key, direction_id, headsign, trip_id, both_directions,
        from_stop_id, from_stop_name, to_stop_id, to_stop_name, stop_ids, starts_at, ends_at, kinds)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      uid, line.key, body.directionId ?? null, body.headsign ?? null, body.tripId ?? null, body.bothDirections ?? false,
      body.fromStop?.id ?? null, body.fromStop?.name ?? null, body.toStop?.id ?? null, body.toStop?.name ?? null,
      stopIds, body.startsAt, body.endsAt,
      // alle Arten gewählt = leer speichern (dann kommen auch künftige Arten automatisch dazu)
      body.kinds && body.kinds.length < REPORT_KINDS.length ? [...new Set(body.kinds)] : [],
    ],
  );
  const created = await db.query<TrackingRow>(`${TRACKING_SELECT} WHERE t.id = $1`, [rows[0].id]);
  const tracking = trackingFromRow(created.rows[0]);
  tracking.summary = (await summariesFor(deps, [tracking.lineKey])).get(tracking.lineKey);
  return tracking;
}

export async function listTrackings(deps: Pick<Deps, 'db' | 'cfg'>, uid: string): Promise<Tracking[]> {
  const { rows } = await deps.db.query<TrackingRow>(
    // Automatische Trackings des Pendler-Modus (source = 'commute') zeigt die App bei den Pendelstrecken
    `${TRACKING_SELECT} WHERE t.user_id = $1 AND t.source = 'manual' AND t.ends_at >= now() - interval '2 hours'
     ORDER BY t.starts_at ASC LIMIT 50`,
    [uid],
  );
  const trackings = rows.map((r) => trackingFromRow(r));
  const summaries = await summariesFor(deps, trackings.map((t) => t.lineKey));
  for (const t of trackings) t.summary = summaries.get(t.lineKey);
  return trackings;
}

export async function deleteTracking(db: Db, uid: string, id: string): Promise<void> {
  const res = await db.query('DELETE FROM trackings WHERE id = $1 AND user_id = $2', [id, uid]);
  if (res.rowCount === 0) throw new HttpError(404, 'not_found', 'tracking_not_found');
}

// --- Abgleich Meldung ↔ Trackings --------------------------------------------------------

export interface TrackingCandidate {
  id: string;
  userId: string;
  lineKey: string;
  directionId: string | null;
  bothDirections: boolean;
  stopIds: string[];
  /** leer = alle Arten */
  kinds?: ReportKind[];
}

/**
 * Entscheidet, ob eine Meldung für ein Tracking relevant ist.
 * - Gleiche Linie: Richtung muss passen (außer "beide Richtungen" oder Richtung unbekannt).
 * - Gleicher Linienname, anderer Betreiber-Schlüssel (z. B. dieselbe Linie aus zwei
 *   Datenquellen): nur, wenn die gemeldeten Halte auf dem eigenen Abschnitt liegen.
 */
export function matchTracking(
  t: TrackingCandidate,
  report: Pick<Report, 'lineKey' | 'directionId' | 'prevStop' | 'nextStop'> & { kind?: ReportKind },
): { match: boolean; onMySegment: boolean } {
  if (t.kinds && t.kinds.length > 0 && report.kind && !t.kinds.includes(report.kind)) return { match: false, onMySegment: false };
  const reportStops = [report.prevStop?.id, report.nextStop?.id].map((s) => canonicalStopId(s)).filter((s): s is string => !!s);
  const mine = new Set(t.stopIds);
  const onMySegment = mine.size > 0 && reportStops.some((s) => mine.has(s));

  if (t.lineKey === report.lineKey) {
    const directionKnown = !!t.directionId && !!report.directionId;
    if (!t.bothDirections && directionKnown && t.directionId !== report.directionId) return { match: false, onMySegment: false };
    return { match: true, onMySegment };
  }
  const [modeA, nameA] = t.lineKey.split(':');
  const [modeB, nameB] = report.lineKey.split(':');
  if (modeA === modeB && nameA === nameB && onMySegment) return { match: true, onMySegment: true };
  return { match: false, onMySegment: false };
}

export function alertTexts(
  report: Report,
  onMySegment: boolean,
  lang: Lang = DEFAULT_LANG,
  now = Date.now(),
  /** Pendler-Modus: Name der Strecke vor den Titel ("To work: Delay on 15") */
  commuteName?: string | null,
): { title: string; message: string } {
  const base = alertTitle(lang, report.kind ?? 'CHECK', report.line.name, onMySegment);
  const title = commuteName ? t(lang, 'commute_alert_title', { name: commuteName, title: base }) : base;
  const a = report.prevStop ? shortStopName(report.prevStop.name) : null;
  const b = report.nextStop ? shortStopName(report.nextStop.name) : null;
  const where = a && b ? t(lang, 'alert_between', { a, b }) : t(lang, 'alert_at', { a: a ?? b ?? '?' });
  const dir = report.headsign ? t(lang, 'alert_direction', { dir: shortStopName(report.headsign) }) : '';
  const ago = Math.round((now - Date.parse(report.reportedAt)) / 60_000);
  const when = ago <= 1 ? t(lang, 'just_now') : t(lang, 'minutes_ago', { n: ago });
  return { title, message: `${where}${dir} · ${when}` };
}

/**
 * Nach jeder neuen Meldung: Beobachter der Linie (WebSocket) informieren und
 * passende Live-Trackings alarmieren. Läuft im Hintergrund, blockiert die Antwort nicht.
 */
export function onReportCreated(deps: Deps, report: Report, reporterUid: string, opts: { holdAlerts?: boolean } = {}): void {
  deps.hub.broadcastReport({ ...report, myVote: undefined, isMine: undefined });
  // Vertrauen: Meldungen von Konten mit deutlich negativem Vertrauen alarmieren erst nach einer Bestätigung
  if (opts.holdAlerts) return;
  notifyTrackers(deps, report, reporterUid).catch((err) => deps.log.error({ err }, 'Benachrichtigung fehlgeschlagen'));
}

/**
 * Nach einer Bestätigung ("noch da"): zurückgehaltene Alarme einer Meldung jetzt verschicken –
 * aber nur, wenn die bestätigende Person selbst nicht deutlich negatives Vertrauen hat.
 * Gibt die Anzahl der Alarme zurück.
 */
export async function releaseHeldAlerts(deps: Deps, reportId: string, voterUid: string): Promise<number> {
  const { db } = deps;
  const held = await db.query<{ alerts_held: boolean }>('SELECT alerts_held FROM reports WHERE id = $1', [reportId]);
  if (!held.rows[0]?.alerts_held) return 0;
  if ((await getTrust(db, voterUid)).negative) return 0;
  const upd = await db.query<{ user_id: string | null }>(
    'UPDATE reports SET alerts_held = false WHERE id = $1 AND alerts_held AND NOT hidden RETURNING user_id',
    [reportId],
  );
  if (!upd.rows[0]) return 0;
  const { rows } = await db.query<ReportRow>(`${REPORT_SELECT} WHERE r.id = $2`, [null, reportId]);
  if (!rows[0]) return 0;
  return notifyTrackers(deps, reportFromRow(rows[0], null), upd.rows[0].user_id ?? '');
}

/** Alarmiert alle passenden, gerade aktiven Live-Trackings. Gibt die Anzahl zurück. */
export async function notifyTrackers(deps: Deps, report: Report, reporterUid: string): Promise<number> {
  const { db } = deps;
  const [mode, name] = report.lineKey.split(':');
  const { rows } = await db.query<{
    id: string;
    user_id: string;
    line_key: string;
    direction_id: string | null;
    both_directions: boolean;
    stop_ids: string[];
    kinds: ReportKind[];
    lang: Lang;
    commute_id: string | null;
    commute_name: string | null;
  }>(
    `SELECT t.id, t.user_id, t.line_key, t.direction_id, t.both_directions, t.stop_ids, t.kinds, u.lang,
            t.commute_id, c.name AS commute_name
     FROM trackings t JOIN users u ON u.id = t.user_id
     LEFT JOIN commutes c ON c.id = t.commute_id
     WHERE (t.line_key = $1 OR t.line_key LIKE $2)
       AND t.user_id <> $3 AND t.starts_at <= now() AND t.ends_at >= now()`,
    [report.lineKey, `${mode}:${name}:%`, reporterUid],
  );

  let sent = 0;
  for (const row of rows) {
    const { match, onMySegment } = matchTracking(
      {
        id: String(row.id),
        userId: row.user_id,
        lineKey: row.line_key,
        directionId: row.direction_id,
        bothDirections: row.both_directions,
        stopIds: row.stop_ids,
        kinds: row.kinds,
      },
      report,
    );
    if (!match) continue;
    const ins = await db.query<{ id: string; created_at: Date }>(
      `INSERT INTO tracking_alerts (tracking_id, user_id, report_id, on_my_segment)
       VALUES ($1, $2, $3, $4) ON CONFLICT (tracking_id, report_id) DO NOTHING RETURNING id, created_at`,
      [row.id, row.user_id, report.id, onMySegment],
    );
    if (!ins.rows[0]) continue;
    const { title, message } = alertTexts(report, onMySegment, row.lang, Date.now(), row.commute_name);
    const alert: TrackingAlert = {
      id: String(ins.rows[0].id),
      trackingId: String(row.id),
      report: { ...report, myVote: null, isMine: false },
      onMySegment,
      title,
      message,
      createdAt: ins.rows[0].created_at.toISOString(),
    };
    if (row.commute_id) {
      alert.commuteId = String(row.commute_id);
      alert.commuteName = row.commute_name;
    }
    deps.hub.sendToUser(row.user_id, { type: 'alert', alert });
    deps.push.sendAlert(db, row.user_id, alert).catch((err) => deps.log.warn({ err }, 'Push fehlgeschlagen'));
    sent++;
  }
  return sent;
}

export async function listAlerts(db: Db, uid: string, lang: Lang = DEFAULT_LANG): Promise<TrackingAlert[]> {
  const { rows } = await db.query<
    ReportRow & { alert_id: string; tracking_id: string; on_my_segment: boolean; alert_created_at: Date; commute_id: string | null; commute_name: string | null }
  >(
    `SELECT x.*, a.id AS alert_id, a.tracking_id, a.on_my_segment, a.created_at AS alert_created_at,
            tr.commute_id, c.name AS commute_name
     FROM tracking_alerts a
     JOIN LATERAL (${REPORT_SELECT} WHERE r.id = a.report_id) x ON true
     LEFT JOIN trackings tr ON tr.id = a.tracking_id
     LEFT JOIN commutes c ON c.id = tr.commute_id
     WHERE a.user_id = $1 AND a.created_at >= now() - interval '24 hours'
     ORDER BY a.created_at DESC LIMIT 50`,
    [uid],
  );
  return rows.map((r) => {
    const report = reportFromRow(r, uid);
    const { title, message } = alertTexts(report, r.on_my_segment, lang, Date.now(), r.commute_name);
    const alert: TrackingAlert = {
      id: String(r.alert_id),
      trackingId: String(r.tracking_id),
      report,
      onMySegment: r.on_my_segment,
      title,
      message,
      createdAt: r.alert_created_at.toISOString(),
    };
    if (r.commute_id) {
      alert.commuteId = String(r.commute_id);
      alert.commuteName = r.commute_name;
    }
    return alert;
  });
}
