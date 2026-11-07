// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { z } from 'zod';
import type { Line, LineStats, Report, ReportSummary, ReportTag, Stop } from '../contract.js';
import { FLAG_REASONS, REPORT_KINDS, REPORT_TAGS, TAGS_BY_KIND, type FlagReason, type ReportKind } from '../contract.js';
import type { Deps } from '../deps.js';
import type { Db } from '../db/pool.js';
import { HttpError, parse } from '../http.js';
import type { Lang } from '../i18n.js';
import { isValidLineKey } from '../transit/lineKey.js';
import { canonicalStopId, haversineMeters, tripFromItinerary } from '../transit/mapping.js';
import { computeLineStats, type StatReport } from './stats.js';
import { lineSchema, normalizeLine, stopSchema } from './schemas.js';
import { checkThrottle, inBackground, onAutoHidden } from './moderation.js';
import {
  getTrust,
  THROTTLE_NET_DENIALS,
  THROTTLED_COOLDOWN_MINUTES,
  THROTTLED_REPORTS_PER_DAY,
  voteWeight,
  type TrustLevel,
} from './trust.js';

// --- Validierung ----------------------------------------------------------------

export const kindSchema = z.enum(REPORT_KINDS as [ReportKind, ...ReportKind[]]);

const createReportSchema = z
  .object({
    // Ältere App-Versionen schicken keine Art – das waren immer Kontrollen.
    kind: kindSchema.default('CHECK'),
    line: lineSchema,
    tripId: z.string().max(300).optional(),
    directionId: z.string().max(20).optional(),
    headsign: z.string().max(200).optional(),
    prevStop: stopSchema.nullish(),
    nextStop: stopSchema.nullish(),
    tags: z.array(z.enum(REPORT_TAGS as [ReportTag, ...ReportTag[]])).max(6).optional(),
    minutesAgo: z.number().int().min(0).max(60).optional(),
  })
  .refine((b) => b.prevStop || b.nextStop, { message: 'at least one stop is required', path: ['nextStop'] })
  .refine((b) => (b.tags ?? []).every((t) => TAGS_BY_KIND[b.kind].includes(t)), { message: 'tag does not fit this kind', path: ['tags'] });

export async function upsertLine(db: Db, line: Line): Promise<void> {
  await db.query(
    `INSERT INTO lines (line_key, name, mode, operator, color, text_color)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (line_key) DO UPDATE SET
       name = EXCLUDED.name,
       operator = COALESCE(EXCLUDED.operator, lines.operator),
       color = COALESCE(EXCLUDED.color, lines.color),
       text_color = COALESCE(EXCLUDED.text_color, lines.text_color),
       updated_at = now()`,
    [line.key, line.name, line.mode, line.operator ?? null, line.color ?? null, line.textColor ?? null],
  );
}

// --- Zeilen → API-Objekte ---------------------------------------------------------

export interface ReportRow {
  id: string;
  kind: ReportKind;
  user_id: string | null;
  line_key: string;
  direction_id: string | null;
  headsign: string | null;
  prev_stop_id: string | null;
  prev_stop_name: string | null;
  prev_lat: number | null;
  prev_lon: number | null;
  next_stop_id: string | null;
  next_stop_name: string | null;
  next_lat: number | null;
  next_lon: number | null;
  tags: string[];
  reported_at: Date;
  confirmations: number;
  denials: number;
  reporter_trust: number;
  line_name: string;
  line_mode: string;
  line_operator: string | null;
  line_color: string | null;
  line_text_color: string | null;
  my_vote: number | null;
}

/** SELECT für Meldungen inkl. Linie und eigener Stimme ($1 = UID des Betrachters oder NULL). */
export const REPORT_SELECT = `
  SELECT r.id, r.kind, r.user_id, r.line_key, r.direction_id, r.headsign,
         r.prev_stop_id, r.prev_stop_name, r.prev_lat, r.prev_lon,
         r.next_stop_id, r.next_stop_name, r.next_lat, r.next_lon,
         r.tags, r.reported_at, r.confirmations, r.denials, r.reporter_trust,
         l.name AS line_name, l.mode AS line_mode, l.operator AS line_operator,
         l.color AS line_color, l.text_color AS line_text_color,
         v.value AS my_vote
  FROM reports r
  JOIN lines l ON l.line_key = r.line_key
  LEFT JOIN report_votes v ON v.report_id = r.id AND v.user_id = $1`;

function rowStop(id: string | null, name: string | null, lat: number | null, lon: number | null): Stop | null {
  if (!id || !name) return null;
  const s: Stop = { id, name };
  if (lat !== null) s.lat = lat;
  if (lon !== null) s.lon = lon;
  return s;
}

export function lineFromRow(row: Pick<ReportRow, 'line_key' | 'line_name' | 'line_mode' | 'line_operator' | 'line_color' | 'line_text_color'>): Line {
  const line: Line = { key: row.line_key, name: row.line_name, mode: row.line_mode as Line['mode'] };
  if (row.line_operator) line.operator = row.line_operator;
  if (row.line_color) line.color = row.line_color;
  if (row.line_text_color) line.textColor = row.line_text_color;
  return line;
}

export function reportFromRow(row: ReportRow, viewerUid: string | null): Report {
  const report: Report = {
    id: String(row.id),
    kind: row.kind,
    lineKey: row.line_key,
    line: lineFromRow(row),
    directionId: row.direction_id,
    headsign: row.headsign,
    prevStop: rowStop(row.prev_stop_id, row.prev_stop_name, row.prev_lat, row.prev_lon),
    nextStop: rowStop(row.next_stop_id, row.next_stop_name, row.next_lat, row.next_lon),
    reportedAt: row.reported_at.toISOString(),
    tags: row.tags as ReportTag[],
    confirmations: row.confirmations,
    denials: row.denials,
  };
  // Nur die Vertrauensstufe des Meldenden, nie die Person
  if (row.reporter_trust !== undefined && row.reporter_trust !== null) report.reporterTrust = row.reporter_trust as TrustLevel;
  if (viewerUid) {
    report.myVote = (row.my_vote as 1 | -1 | null) ?? null;
    report.isMine = row.user_id === viewerUid;
  }
  return report;
}

async function getReport(db: Db, id: string, viewerUid: string | null): Promise<Report> {
  const { rows } = await db.query<ReportRow>(`${REPORT_SELECT} WHERE r.id = $2`, [viewerUid, id]);
  if (!rows[0]) throw new HttpError(404, 'not_found', 'report_not_found');
  return reportFromRow(rows[0], viewerUid);
}

// --- Zusammenfassungen für Abfahrten/Verbindungen -------------------------------------

/** Hinweis-Lage für viele Linien auf einmal (eine SQL-Abfrage, aufgeteilt nach Art). */
export async function summariesFor(deps: Pick<Deps, 'db' | 'cfg'>, lineKeys: string[]): Promise<Map<string, ReportSummary>> {
  const keys = [...new Set(lineKeys)].filter(Boolean);
  const result = new Map<string, ReportSummary>();
  for (const k of keys) {
    result.set(k, {
      lineKey: k, recentCount: 0, recentByKind: {}, lastReportAt: null, lastKind: null, count30d: 0, count30dByKind: {}, level: 'calm',
    });
  }
  if (keys.length === 0) return result;
  const { rows } = await deps.db.query<{ line_key: string; kind: ReportKind; recent: string; total: string; last: Date | null }>(
    `SELECT line_key, kind,
            count(*) FILTER (WHERE reported_at >= now() - make_interval(mins => $2)) AS recent,
            count(*) AS total,
            max(reported_at) AS last
     FROM reports
     WHERE line_key = ANY($1) AND NOT hidden AND NOT alerts_held AND reported_at >= now() - interval '30 days'
     GROUP BY line_key, kind`,
    [keys, deps.cfg.RECENT_MINUTES],
  );
  for (const r of rows) {
    const sum = result.get(r.line_key)!;
    const recent = Number(r.recent);
    const total = Number(r.total);
    sum.recentCount += recent;
    sum.count30d += total;
    if (recent > 0) sum.recentByKind[r.kind] = recent;
    sum.count30dByKind[r.kind] = total;
    if (r.last && (!sum.lastReportAt || r.last.toISOString() > sum.lastReportAt)) {
      sum.lastReportAt = r.last.toISOString();
      sum.lastKind = r.kind;
    }
  }
  for (const sum of result.values()) {
    sum.level = sum.recentCount > 0 ? 'active' : sum.count30d >= deps.cfg.FREQUENT_THRESHOLD ? 'frequent' : 'calm';
  }
  return result;
}

// --- Melden ---------------------------------------------------------------------------------

/**
 * Neue Meldung. `alertsHeld`: Der Meldende hat deutlich negatives Vertrauen – Live-Alarme gehen
 * erst nach der ersten Bestätigung raus (siehe releaseHeldAlerts in trackings.ts).
 */
export async function createReport(deps: Deps, uid: string, input: unknown): Promise<{ report: Report; alertsHeld: boolean }> {
  const body = parse(createReportSchema, input);
  const { db, cfg } = deps;

  // Vertrauen + automatische Drosselung (wiederholt umstrittene Meldungen → strengere Limits)
  const trust = await getTrust(db, uid);
  const restrictedUntil = await checkThrottle(deps, uid, trust);
  if (restrictedUntil) {
    const { rows: r } = await db.query<{ today: string; recent: string }>(
      `SELECT count(*) AS today,
              count(*) FILTER (WHERE created_at >= now() - make_interval(mins => $2)) AS recent
       FROM reports WHERE user_id = $1 AND created_at >= now() - interval '24 hours'`,
      [uid, THROTTLED_COOLDOWN_MINUTES],
    );
    if (Number(r[0]?.today ?? 0) >= THROTTLED_REPORTS_PER_DAY || Number(r[0]?.recent ?? 0) > 0) {
      throw new HttpError(429, 'throttled', 'report_throttled', {
        until: restrictedUntil.toISOString(),
        max: THROTTLED_REPORTS_PER_DAY,
        minutes: THROTTLED_COOLDOWN_MINUTES,
      });
    }
  }

  let line = normalizeLine(body.line);
  let directionId = body.directionId ?? null;
  let headsign = body.headsign ?? null;
  let prevStop = body.prevStop ?? null;
  let nextStop = body.nextStop ?? null;

  // Wenn die Fahrt bekannt ist: Linie und Haltestellen gegen die echten Fahrplandaten prüfen.
  if (body.tripId) {
    try {
      const trip = tripFromItinerary(await deps.motis.trip(body.tripId), body.tripId);
      line = trip.line;
      directionId = trip.directionId ?? directionId;
      headsign = trip.headsign || headsign;
      const byKey = new Map(trip.stopovers.map((s) => [canonicalStopId(s.stop.id), s.stop]));
      const fix = (s: Stop | null): Stop | null => {
        if (!s) return null;
        const real = byKey.get(canonicalStopId(s.id));
        if (!real) throw new HttpError(400, 'stop_not_on_trip', 'stop_not_on_trip', { stop: s.name });
        return real;
      };
      prevStop = fix(prevStop);
      nextStop = fix(nextStop);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      deps.log.warn({ err, tripId: body.tripId }, 'Fahrt konnte nicht geprüft werden – nutze Angaben der App');
    }
  }

  // Sperrzeit gilt je Linie UND Art: Verspätung und Überfüllung derselben Fahrt dürfen beide gemeldet werden.
  const { rows: limits } = await db.query<{ today: string; same_line: string }>(
    `SELECT
       count(*) FILTER (WHERE created_at >= now() - interval '24 hours') AS today,
       count(*) FILTER (WHERE line_key = $2 AND kind = $4 AND created_at >= now() - make_interval(mins => $3)) AS same_line
     FROM reports WHERE user_id = $1 AND created_at >= now() - interval '24 hours'`,
    [uid, line.key, cfg.REPORT_COOLDOWN_MINUTES, body.kind],
  );
  if (Number(limits[0]?.same_line ?? 0) > 0) {
    throw new HttpError(429, 'cooldown', 'cooldown', { line: line.name });
  }
  if (Number(limits[0]?.today ?? 0) >= cfg.REPORTS_PER_DAY) {
    throw new HttpError(429, 'daily_limit', 'daily_limit');
  }

  await upsertLine(db, line);
  const minutesAgo = body.minutesAgo ?? 0;
  const tags = [...new Set(body.tags ?? [])];
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reports (user_id, kind, line_key, direction_id, headsign, trip_id,
        prev_stop_id, prev_stop_name, prev_lat, prev_lon,
        next_stop_id, next_stop_name, next_lat, next_lon,
        tags, reported_at, reporter_trust, alerts_held)
     VALUES ($1,$16,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now() - make_interval(mins => $15), $17, $18)
     RETURNING id`,
    [
      uid, line.key, directionId, headsign, body.tripId ?? null,
      prevStop?.id ?? null, prevStop?.name ?? null, prevStop?.lat ?? null, prevStop?.lon ?? null,
      nextStop?.id ?? null, nextStop?.name ?? null, nextStop?.lat ?? null, nextStop?.lon ?? null,
      tags, minutesAgo, body.kind, trust.level, trust.negative,
    ],
  );
  const report = await getReport(db, rows[0].id, uid);

  return { report, alertsHeld: trust.negative };
}

// --- Abstimmen / Löschen ----------------------------------------------------------------

export async function voteReport(deps: Deps, uid: string, reportId: string, value: 1 | -1): Promise<Report> {
  const { db } = deps;
  const { rows } = await db.query<{ user_id: string | null; reported_at: Date; hidden: boolean }>(
    'SELECT user_id, reported_at, hidden FROM reports WHERE id = $1',
    [reportId],
  );
  const r = rows[0];
  // Ausgeblendete Meldungen gibt es für andere nicht mehr
  if (!r || r.hidden) throw new HttpError(404, 'not_found', 'report_not_found');
  if (r.user_id === uid) throw new HttpError(400, 'own_report', 'own_report');
  if (Date.now() - r.reported_at.getTime() > 6 * 3600_000) {
    throw new HttpError(400, 'too_old', 'too_old');
  }
  // Stimmen von Konten mit deutlich negativem Vertrauen zählen fürs Ausblenden nur halb
  const voter = await getTrust(db, uid);
  await db.query(
    `INSERT INTO report_votes (report_id, user_id, value, weight) VALUES ($1, $2, $3, $4)
     ON CONFLICT (report_id, user_id) DO UPDATE SET value = EXCLUDED.value, weight = EXCLUDED.weight, created_at = now()`,
    [reportId, uid, value, voteWeight(voter.score)],
  );
  // Zähler neu berechnen (sichtbar: einfache Anzahl; fürs Ausblenden: gewichtet)
  const { rows: sums } = await db.query<{ c: number; d: number; wc: number; wd: number; reviewed_at: Date | null }>(
    `UPDATE reports SET confirmations = s.c, denials = s.d
     FROM (SELECT count(*) FILTER (WHERE value = 1) AS c, count(*) FILTER (WHERE value = -1) AS d,
                  coalesce(sum(weight) FILTER (WHERE value = 1), 0) AS wc,
                  coalesce(sum(weight) FILTER (WHERE value = -1), 0) AS wd
           FROM report_votes WHERE report_id = $1) s
     WHERE reports.id = $1
     RETURNING reports.confirmations AS c, reports.denials AS d, s.wc, s.wd, reports.reviewed_at`,
    [reportId],
  );
  const st = sums[0];
  if (value === -1 && st) {
    // Offensichtlich falsche Meldungen automatisch ausblenden – außer der Admin hat sie geprüft
    if (!st.reviewed_at && Number(st.wd) >= Number(st.wc) + 3) {
      const hid = await db.query('UPDATE reports SET hidden = true WHERE id = $1 AND NOT hidden RETURNING id', [reportId]);
      if (hid.rows[0]) inBackground(deps, 'auto-hide', onAutoHidden(deps, reportId, 'DISPUTED'));
    } else if (r.user_id && Number(st.d) - Number(st.c) >= THROTTLE_NET_DENIALS) {
      inBackground(deps, 'throttle', checkThrottle(deps, r.user_id));
    }
  }
  return getReport(db, reportId, uid);
}

// --- Inhalt melden (Moderation) ----------------------------------------------------------

/** Ab so vielen Markierungen verschiedener Nutzer wird eine Meldung automatisch ausgeblendet. */
export const FLAGS_TO_HIDE = 3;

export const flagSchema = z.object({ reason: z.enum(FLAG_REASONS as [FlagReason, ...FlagReason[]]) });

export async function flagReport(deps: Deps, uid: string, reportId: string, reason: FlagReason): Promise<void> {
  const { db } = deps;
  const { rows } = await db.query<{ user_id: string | null }>('SELECT user_id FROM reports WHERE id = $1', [reportId]);
  if (!rows[0]) throw new HttpError(404, 'not_found', 'report_not_found');
  if (rows[0].user_id === uid) throw new HttpError(400, 'own_report', 'own_report_flag');
  await db.query(
    `INSERT INTO report_flags (report_id, user_id, reason) VALUES ($1, $2, $3)
     ON CONFLICT (report_id, user_id) DO UPDATE SET reason = EXCLUDED.reason, created_at = now()`,
    [reportId, uid, reason],
  );
  await db.query(
    `UPDATE reports SET flags = s.n
     FROM (SELECT count(*) AS n FROM report_flags WHERE report_id = $1) s
     WHERE reports.id = $1`,
    [reportId],
  );
  // Ab FLAGS_TO_HIDE automatisch ausblenden → automatische Entscheidung + Mail an den Meldenden
  const hid = await db.query('UPDATE reports SET hidden = true WHERE id = $1 AND NOT hidden AND flags >= $2 RETURNING id', [reportId, FLAGS_TO_HIDE]);
  if (hid.rows[0]) inBackground(deps, 'auto-hide', onAutoHidden(deps, reportId, 'FLAGGED'));
}

export async function deleteOwnReport(db: Db, uid: string, reportId: string): Promise<void> {
  const res = await db.query(
    `DELETE FROM reports WHERE id = $1 AND user_id = $2 AND created_at >= now() - interval '15 minutes'`,
    [reportId, uid],
  );
  if (res.rowCount === 0) {
    throw new HttpError(404, 'not_found', 'report_not_deletable');
  }
}

// --- Lesen ------------------------------------------------------------------------------

export async function listLineReports(
  db: Db,
  lineKey: string,
  opts: { days: number; limit: number; before?: string; kind?: ReportKind },
  viewerUid: string | null,
): Promise<Report[]> {
  if (!isValidLineKey(lineKey)) throw new HttpError(400, 'invalid_line', 'invalid_line');
  const { rows } = await db.query<ReportRow>(
    `${REPORT_SELECT}
     WHERE r.line_key = $2 AND NOT r.hidden
       AND r.reported_at >= now() - make_interval(days => $3)
       AND ($4::timestamptz IS NULL OR r.reported_at < $4::timestamptz)
       AND ($6::text IS NULL OR r.kind = $6)
     ORDER BY r.reported_at DESC
     LIMIT $5`,
    [viewerUid, lineKey, opts.days, opts.before ?? null, opts.limit, opts.kind ?? null],
  );
  return rows.map((r) => reportFromRow(r, viewerUid));
}

export async function recentReports(
  db: Db,
  opts: { minutes: number; lat?: number; lon?: number; radiusKm: number; kind?: ReportKind },
  viewerUid: string | null,
): Promise<Report[]> {
  const params: unknown[] = [viewerUid, opts.minutes, opts.kind ?? null];
  let geo = '';
  if (opts.lat !== undefined && opts.lon !== undefined) {
    // Grobe Vorauswahl per Bounding-Box, exakte Entfernung danach in JS
    const dLat = opts.radiusKm / 111;
    const dLon = opts.radiusKm / (111 * Math.cos((opts.lat * Math.PI) / 180));
    params.push(opts.lat - dLat, opts.lat + dLat, opts.lon - dLon, opts.lon + dLon);
    geo = `AND (
      (r.prev_lat BETWEEN $4 AND $5 AND r.prev_lon BETWEEN $6 AND $7) OR
      (r.next_lat BETWEEN $4 AND $5 AND r.next_lon BETWEEN $6 AND $7))`;
  }
  const { rows } = await db.query<ReportRow>(
    `${REPORT_SELECT}
     WHERE NOT r.hidden AND r.reported_at >= now() - make_interval(mins => $2)
       AND ($3::text IS NULL OR r.kind = $3) ${geo}
     ORDER BY r.reported_at DESC LIMIT 100`,
    params,
  );
  let reports = rows.map((r) => reportFromRow(r, viewerUid));
  if (opts.lat !== undefined && opts.lon !== undefined) {
    const { lat, lon } = opts;
    reports = reports.filter((rep) =>
      [rep.prevStop, rep.nextStop].some(
        (s) => s?.lat !== undefined && s.lon !== undefined && haversineMeters(lat, lon, s.lat, s.lon) <= opts.radiusKm * 1000,
      ),
    );
  }
  return reports.slice(0, 50);
}

export async function getLineStats(
  deps: Pick<Deps, 'db' | 'cfg'>,
  lineKey: string,
  opts: { days: number; directionId?: string; kind?: ReportKind; lang?: Lang },
): Promise<LineStats> {
  if (!isValidLineKey(lineKey)) throw new HttpError(400, 'invalid_line', 'invalid_line');
  const { db, cfg } = deps;
  const lineRes = await db.query(
    `SELECT line_key, name AS line_name, mode AS line_mode, operator AS line_operator,
            color AS line_color, text_color AS line_text_color
     FROM lines WHERE line_key = $1`,
    [lineKey],
  );
  const { rows } = await db.query<{
    reported_at: Date;
    direction_id: string | null;
    headsign: string | null;
    prev_stop_id: string | null;
    prev_stop_name: string | null;
    prev_lat: number | null;
    prev_lon: number | null;
    next_stop_id: string | null;
    next_stop_name: string | null;
    next_lat: number | null;
    next_lon: number | null;
  }>(
    `SELECT reported_at, direction_id, headsign,
            prev_stop_id, prev_stop_name, prev_lat, prev_lon,
            next_stop_id, next_stop_name, next_lat, next_lon
     FROM reports
     WHERE line_key = $1 AND NOT hidden AND NOT alerts_held
       AND reported_at >= now() - make_interval(days => $2)
       AND ($3::text IS NULL OR direction_id = $3)
       AND ($4::text IS NULL OR kind = $4)
     ORDER BY reported_at DESC
     LIMIT 10000`,
    [lineKey, opts.days, opts.directionId ?? null, opts.kind ?? null],
  );
  // Anzahl je Art (für die Filter-Chips), unabhängig vom gewählten Filter
  const kindRes = await db.query<{ kind: ReportKind; n: string }>(
    `SELECT kind, count(*) AS n FROM reports
     WHERE line_key = $1 AND NOT hidden AND NOT alerts_held AND reported_at >= now() - make_interval(days => $2)
       AND ($3::text IS NULL OR direction_id = $3)
     GROUP BY kind`,
    [lineKey, opts.days, opts.directionId ?? null],
  );
  const byKind = Object.fromEntries(REPORT_KINDS.map((k) => [k, 0])) as Record<ReportKind, number>;
  for (const r of kindRes.rows) byKind[r.kind] = Number(r.n);
  const statReports: StatReport[] = rows.map((r) => ({
    reportedAt: r.reported_at,
    directionId: r.direction_id,
    headsign: r.headsign,
    prevStop: rowStop(r.prev_stop_id, r.prev_stop_name, r.prev_lat, r.prev_lon),
    nextStop: rowStop(r.next_stop_id, r.next_stop_name, r.next_lat, r.next_lon),
  }));
  const stats = computeLineStats(statReports, {
    lineKey,
    days: opts.days,
    recentMinutes: cfg.RECENT_MINUTES,
    frequentThreshold: cfg.FREQUENT_THRESHOLD,
    lang: opts.lang,
    kind: opts.kind ?? null,
    byKind,
  });
  return { ...stats, line: lineRes.rows[0] ? lineFromRow(lineRes.rows[0]) : null };
}

// --- Öffentliche Kennzahlen (Website) ------------------------------------------------

export interface PublicStats {
  reports24h: number;
  reports7d: number;
  lines24h: number;
  updatedAt: string;
}

let publicStatsCache: { value: PublicStats; until: number } | null = null;

/** Wenige Zahlen für die Startseite – 60 s gecacht, damit die Website die DB nicht belastet. */
export async function getPublicStats(db: Db): Promise<PublicStats> {
  const now = Date.now();
  if (publicStatsCache && publicStatsCache.until > now) return publicStatsCache.value;
  const { rows } = await db.query<{ r24: string; r7: string; l24: string }>(
    `SELECT count(*) FILTER (WHERE reported_at >= now() - interval '24 hours') AS r24,
            count(*) AS r7,
            count(DISTINCT line_key) FILTER (WHERE reported_at >= now() - interval '24 hours') AS l24
     FROM reports WHERE NOT hidden AND reported_at >= now() - interval '7 days'`,
  );
  const value: PublicStats = {
    reports24h: Number(rows[0]?.r24 ?? 0),
    reports7d: Number(rows[0]?.r7 ?? 0),
    lines24h: Number(rows[0]?.l24 ?? 0),
    updatedAt: new Date(now).toISOString(),
  };
  publicStatsCache = { value, until: now + 60_000 };
  return value;
}
