// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Pendler-Modus: gespeicherte Strecken ("Zuhause → Arbeit, werktags 7:30").
 *
 * Catch plant die Verbindung zu jedem Termin selbst (MOTIS, mit Echtzeit), beobachtet ihre Linien
 * über automatische Trackings (source = 'commute') und schickt eine "Zeit zu gehen"-Erinnerung.
 * Der Hintergrund-Job steht in commuteJob.ts, die reine Zeitlogik in commuteTime.ts.
 *
 * Datenschutz: Start und Ziel (bei Adressen inkl. Koordinaten) liegen dafür auf dem Server –
 * gelöscht mit der Strecke oder dem Konto.
 */
import { z } from 'zod';
import {
  geoPlaceId,
  MAX_COMMUTES,
  REPORT_KINDS,
  type Commute,
  type CommutePlace,
  type CommutePlan,
  type CommutePreview,
  type CommuteTimeMode,
  type Journey,
  type ReportKind,
} from '../contract.js';
import type { Deps } from '../deps.js';
import type { Db } from '../db/pool.js';
import { HttpError, parse } from '../http.js';
import type { Lang } from '../i18n.js';
import { canonicalStopId, journeyFromItinerary, motisPlaceParam } from '../transit/mapping.js';
import type { MotisClient, MotisItinerary } from '../transit/motis.js';
import {
  activeOccurrence,
  leaveInfo,
  nextOccurrence,
  pickJourney,
  WINDOW_AFTER_ARRIVAL_MIN,
  type CommuteSchedule,
  type JourneyCandidate,
  type NotifyState,
  type Occurrence,
  type PlanTimes,
} from './commuteTime.js';
import { summariesFor, upsertLine } from './reports.js';

const MIN = 60_000;

// --- Eingaben ----------------------------------------------------------------------------

const placeSchema = z
  .object({
    kind: z.enum(['STOP', 'ADDRESS', 'POI']),
    id: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(160),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  })
  .transform((p): CommutePlace => {
    const lat = Math.round(p.lat * 1e6) / 1e6;
    const lon = Math.round(p.lon * 1e6) / 1e6;
    // Haltestellen behalten ihre ID, alles andere wird über die Koordinate geplant
    const isStop = p.kind === 'STOP' && !p.id.startsWith('geo:');
    return { kind: p.kind, id: isStop ? p.id : geoPlaceId(lat, lon), name: p.name, lat, lon };
  });

const kindsSchema = z.array(z.enum(REPORT_KINDS as [ReportKind, ...ReportKind[]])).max(5);

const fields = {
  name: z.string().trim().min(1).max(40),
  from: placeSchema,
  to: placeSchema,
  weekdays: z.number().int().min(1).max(127),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM'),
  timeMode: z.enum(['depart', 'arrive']),
  active: z.boolean(),
  kinds: kindsSchema,
  remindMinutes: z.number().int().min(1).max(60).nullable(),
};

const createSchema = z.object({
  ...fields,
  timeMode: fields.timeMode.default('depart'),
  active: fields.active.optional(),
  kinds: fields.kinds.optional(),
  remindMinutes: fields.remindMinutes.optional(),
});

const updateSchema = z.object({
  name: fields.name.optional(),
  from: fields.from.optional(),
  to: fields.to.optional(),
  weekdays: fields.weekdays.optional(),
  time: fields.time.optional(),
  timeMode: fields.timeMode.optional(),
  active: fields.active.optional(),
  kinds: fields.kinds.optional(),
  remindMinutes: fields.remindMinutes.optional(),
});

/** Alle Arten gewählt = leer speichern (dann kommen künftige Arten automatisch dazu). */
function normKinds(kinds: ReportKind[] | undefined): ReportKind[] {
  if (!kinds || kinds.length >= REPORT_KINDS.length) return [];
  return REPORT_KINDS.filter((k) => kinds.includes(k));
}

function samePlace(a: CommutePlace, b: CommutePlace): boolean {
  if (a.id === b.id) return true;
  return Math.abs(a.lat - b.lat) < 0.0002 && Math.abs(a.lon - b.lon) < 0.0003;
}

// --- Zeilen ------------------------------------------------------------------------------

export interface CommuteRow {
  id: string;
  user_id: string;
  name: string;
  from_place: CommutePlace;
  to_place: CommutePlace;
  weekdays: number;
  time: string;
  time_mode: CommuteTimeMode;
  active: boolean;
  kinds: ReportKind[];
  remind_minutes: number | null;
  plan: CommutePlan | null;
  planned_at: Date | null;
  last_duration_min: number | null;
  notify_state: NotifyState | null;
  created_at: Date;
  updated_at: Date;
  alert_count?: string;
  lang?: Lang;
}

export function scheduleOf(r: Pick<CommuteRow, 'weekdays' | 'time' | 'time_mode' | 'active'>): CommuteSchedule {
  return { weekdays: r.weekdays, time: r.time, timeMode: r.time_mode, active: r.active };
}

export function planTimes(plan: CommutePlan | null | undefined): PlanTimes | null {
  if (!plan) return null;
  return { day: plan.day, leaveAt: Date.parse(plan.leaveAt), arrival: Date.parse(plan.journey.arrival) };
}

export function occurrenceOpts(r: Pick<CommuteRow, 'plan' | 'last_duration_min'>) {
  return { durationMin: r.last_duration_min, plan: planTimes(r.plan) };
}

export function commuteFromRow(r: CommuteRow, now = Date.now()): Commute {
  const sched = scheduleOf(r);
  const opts = occurrenceOpts(r);
  const next = nextOccurrence(sched, now, opts);
  const running = activeOccurrence(sched, now, opts);
  const plan = r.plan && next && r.plan.day === next.day && now <= Date.parse(r.plan.watchUntil) ? r.plan : null;
  const state = r.notify_state ?? {};
  return {
    id: String(r.id),
    name: r.name,
    from: r.from_place,
    to: r.to_place,
    weekdays: r.weekdays,
    time: r.time,
    timeMode: r.time_mode,
    active: r.active,
    kinds: r.kinds ?? [],
    remindMinutes: r.remind_minutes,
    nextAt: next ? new Date(next.targetAt).toISOString() : null,
    watching: !!running && !!plan && plan.day === running.day,
    plan,
    alertCount: Number(r.alert_count ?? 0),
    remindedAt: next && state.day === next.day ? (state.remindedAt ?? null) : null,
    createdAt: r.created_at.toISOString(),
  };
}

const COMMUTE_SELECT = `
  SELECT c.*,
         (SELECT count(*) FROM tracking_alerts a JOIN trackings tr ON tr.id = a.tracking_id
           WHERE tr.commute_id = c.id AND a.created_at >= now() - interval '24 hours') AS alert_count
  FROM commutes c`;

/** Meldungslage an die Abschnitte der Verbindung hängen (für den Status in der App). */
async function withSummaries(deps: Pick<Deps, 'db' | 'cfg'>, commutes: Array<{ plan: CommutePlan | null }>): Promise<void> {
  const legs = commutes.flatMap((c) => c.plan?.journey.legs ?? []).filter((l) => l.line);
  if (legs.length === 0) return;
  const map = await summariesFor(deps, legs.map((l) => l.line!.key));
  for (const l of legs) l.summary = map.get(l.line!.key);
}

// --- CRUD --------------------------------------------------------------------------------

export async function listCommutes(deps: Pick<Deps, 'db' | 'cfg'>, uid: string, now = Date.now()): Promise<Commute[]> {
  const { rows } = await deps.db.query<CommuteRow>(`${COMMUTE_SELECT} WHERE c.user_id = $1 ORDER BY c.created_at ASC`, [uid]);
  const list = rows.map((r) => commuteFromRow(r, now));
  await withSummaries(deps, list);
  return list;
}

async function getRow(db: Db, uid: string, id: string): Promise<CommuteRow> {
  const { rows } = await db.query<CommuteRow>(`${COMMUTE_SELECT} WHERE c.id = $1 AND c.user_id = $2`, [id, uid]);
  if (!rows[0]) throw new HttpError(404, 'not_found', 'commute_not_found');
  return rows[0];
}

export async function getCommute(deps: Pick<Deps, 'db' | 'cfg'>, uid: string, id: string): Promise<Commute> {
  const c = commuteFromRow(await getRow(deps.db, uid, id));
  await withSummaries(deps, [c]);
  return c;
}

export async function createCommute(deps: Pick<Deps, 'db' | 'cfg'>, uid: string, input: unknown): Promise<Commute> {
  const body = parse(createSchema, input);
  if (samePlace(body.from, body.to)) throw new HttpError(400, 'invalid_input', 'commute_same_place');
  const { db } = deps;
  const { rows: cnt } = await db.query<{ n: string }>('SELECT count(*) AS n FROM commutes WHERE user_id = $1', [uid]);
  if (Number(cnt[0]?.n ?? 0) >= MAX_COMMUTES) {
    throw new HttpError(409, 'too_many_commutes', 'too_many_commutes', { max: MAX_COMMUTES });
  }
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO commutes (user_id, name, from_place, to_place, weekdays, time, time_mode, active, kinds, remind_minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      uid, body.name, JSON.stringify(body.from), JSON.stringify(body.to), body.weekdays, body.time, body.timeMode,
      body.active ?? true, normKinds(body.kinds), body.remindMinutes ?? null,
    ],
  );
  return getCommute(deps, uid, rows[0].id);
}

export async function updateCommute(deps: Pick<Deps, 'db' | 'cfg'>, uid: string, id: string, input: unknown): Promise<Commute> {
  const body = parse(updateSchema, input);
  const { db } = deps;
  const row = await getRow(db, uid, id);
  const from = body.from ?? row.from_place;
  const to = body.to ?? row.to_place;
  if ((body.from || body.to) && samePlace(from, to)) throw new HttpError(400, 'invalid_input', 'commute_same_place');

  const routeChanged =
    (body.from && body.from.id !== row.from_place.id) ||
    (body.to && body.to.id !== row.to_place.id) ||
    (body.weekdays !== undefined && body.weekdays !== row.weekdays) ||
    (body.time !== undefined && body.time !== row.time) ||
    (body.timeMode !== undefined && body.timeMode !== row.time_mode);
  const deactivated = body.active === false && row.active;
  const kinds = body.kinds !== undefined ? normKinds(body.kinds) : row.kinds;

  await db.query(
    `UPDATE commutes SET name = $3, from_place = $4, to_place = $5, weekdays = $6, time = $7, time_mode = $8,
        active = $9, kinds = $10, remind_minutes = $11, updated_at = now()
        ${routeChanged ? `, plan = NULL, planned_at = NULL, notify_state = '{}'` : ''}
        ${body.from || body.to ? ', last_duration_min = NULL' : ''}
     WHERE id = $1 AND user_id = $2`,
    [
      id, uid, body.name ?? row.name, JSON.stringify(from), JSON.stringify(to), body.weekdays ?? row.weekdays,
      body.time ?? row.time, body.timeMode ?? row.time_mode, body.active ?? row.active, kinds,
      body.remindMinutes !== undefined ? body.remindMinutes : row.remind_minutes,
    ],
  );
  if (routeChanged || deactivated) {
    // Laufende automatische Trackings passen nicht mehr – der Job legt sie bei Bedarf neu an
    await db.query('DELETE FROM trackings WHERE commute_id = $1 AND ends_at > now()', [id]);
  } else if (body.kinds !== undefined) {
    await db.query('UPDATE trackings SET kinds = $2 WHERE commute_id = $1 AND ends_at > now()', [id, kinds]);
  }
  return getCommute(deps, uid, id);
}

export async function deleteCommute(db: Db, uid: string, id: string): Promise<void> {
  // Automatische Trackings und deren Alarme hängen per ON DELETE CASCADE dran
  const res = await db.query('DELETE FROM commutes WHERE id = $1 AND user_id = $2', [id, uid]);
  if (res.rowCount === 0) throw new HttpError(404, 'not_found', 'commute_not_found');
}

/** Nächste Verbindung jetzt live planen (auch für ausgeschaltete Strecken – als Vorschau). */
export async function previewCommute(deps: Pick<Deps, 'db' | 'cfg' | 'motis'>, uid: string, id: string, now = Date.now()): Promise<CommutePreview> {
  const row = await getRow(deps.db, uid, id);
  const sched = { ...scheduleOf(row), active: true };
  const occ = nextOccurrence(sched, now, occurrenceOpts(row));
  if (!occ) throw new HttpError(404, 'not_found', 'commute_not_found');
  const res = await planOccurrence(deps.motis, { from: row.from_place, to: row.to_place, timeMode: row.time_mode }, occ, now);
  if (res) {
    await withSummaries(deps, [res]);
    // Fahrtdauer merken → "Ankunft bis"-Strecken öffnen ihr Zeitfenster passend früh
    await deps.db.query('UPDATE commutes SET last_duration_min = $2 WHERE id = $1', [id, Math.min(600, res.plan.journey.durationMin)]);
  }
  return { commuteId: String(row.id), day: occ.day, targetAt: new Date(occ.targetAt).toISOString(), plan: res?.plan ?? null };
}

// --- Planen ------------------------------------------------------------------------------

export interface PlanResult {
  plan: CommutePlan;
  /** alle Fahrt-IDs in den Ergebnissen (zum Erkennen, ob eine Fahrt verschwunden ist) */
  tripIds: Set<string>;
  /** Fahrten, die laut Echtzeit ausfallen */
  cancelledTrips: Set<string>;
}

function rawCancelled(it: MotisItinerary): string[] {
  return it.legs
    .filter((l) => l.tripId && (l.cancelled || l.tripCancelled || l.from.cancelled || l.to.cancelled))
    .map((l) => l.tripId!);
}

function firstTripOf(j: Journey): string | null {
  return j.legs.find((l) => !l.walking && l.tripId)?.tripId ?? null;
}

export function firstTripId(plan: CommutePlan | null | undefined): string | null {
  return plan ? firstTripOf(plan.journey) : null;
}

/** Für die Datenbank: ohne Streckenverlauf (Geometrie) und ohne Meldungslage. */
export function compactPlan(plan: CommutePlan): CommutePlan {
  return {
    ...plan,
    journey: {
      ...plan.journey,
      legs: plan.journey.legs.map((l) => {
        const { geometry: _g, summary: _s, ...rest } = l;
        return rest;
      }),
    },
  };
}

/**
 * Plant einen Termin mit MOTIS und wählt die passende Verbindung.
 *  - depart: ab 10 Min. vor der Uhrzeit (falls schon später: ab jetzt)
 *  - arrive: Ankunft bis zur Uhrzeit; ist keine mehr erreichbar, die nächste ab jetzt
 * Verbindungen, deren Losgeh-Zeit schon vorbei ist, fallen raus. null = nichts gefunden.
 */
export async function planOccurrence(
  motis: Pick<MotisClient, 'plan'>,
  c: { from: CommutePlace; to: CommutePlace; timeMode: CommuteTimeMode },
  occ: Occurrence,
  now: number,
): Promise<PlanResult | null> {
  const names = { from: c.from.kind === 'STOP' ? undefined : c.from.name, to: c.to.kind === 'STOP' ? undefined : c.to.name };
  const tripIds = new Set<string>();
  const cancelledTrips = new Set<string>();

  const query = async (time: number, arriveBy: boolean): Promise<JourneyCandidate[]> => {
    const res = await motis.plan({
      from: motisPlaceParam(c.from.id),
      to: motisPlaceParam(c.to.id),
      time: new Date(Math.floor(time / MIN) * MIN).toISOString(),
      arriveBy,
    });
    return res.itineraries.map((it, i) => {
      const cancelled = rawCancelled(it);
      for (const id of cancelled) cancelledTrips.add(id);
      for (const l of it.legs) if (l.tripId) tripIds.add(l.tripId);
      return { journey: journeyFromItinerary(it, i, names), cancelled: cancelled.length > 0 };
    });
  };
  const reachable = (cands: JourneyCandidate[]) => cands.filter((x) => leaveInfo(x.journey).leaveAt >= now - 2 * MIN);

  let target = occ.targetAt;
  let mode = c.timeMode;
  let cands: JourneyCandidate[];
  if (mode === 'depart') {
    target = Math.max(occ.targetAt, now);
    cands = reachable(await query(Math.max(occ.targetAt - 10 * MIN, now - 2 * MIN), false));
  } else {
    cands = reachable(await query(occ.targetAt, true));
    if (cands.length === 0) {
      // Pünktlich klappt nicht mehr → die nächste Verbindung ab jetzt
      mode = 'depart';
      target = now;
      cands = reachable(await query(now, false));
    }
  }
  const journey = pickJourney(cands, target, mode);
  if (!journey) return null;
  const leave = leaveInfo(journey);
  const arrival = Date.parse(journey.arrival);
  const plan: CommutePlan = {
    day: occ.day,
    targetAt: new Date(occ.targetAt).toISOString(),
    journey,
    leaveAt: new Date(leave.leaveAt).toISOString(),
    firstLine: leave.first?.line ?? null,
    firstDeparture: leave.first?.departure ?? null,
    firstStop: leave.first?.from ?? null,
    delayMin: leave.delayMin,
    watchUntil: new Date(Math.max(arrival, occ.targetAt) + WINDOW_AFTER_ARRIVAL_MIN * MIN).toISOString(),
    computedAt: new Date(now).toISOString(),
  };
  return { plan, tripIds, cancelledTrips };
}

// --- Automatische Trackings --------------------------------------------------------------

/** Vor der Abfahrt so lange beobachten (mindestens ab Fensterbeginn). */
const TRACK_BEFORE_MIN = 60;
const TRACK_AFTER_MIN = 10;

interface DesiredTracking {
  key: string;
  leg: Journey['legs'][number];
  stopIds: string[];
  startsAt: Date;
  endsAt: Date;
}

function trackingKey(lineKey: string, directionId: string | null | undefined, from: string | null, to: string | null): string {
  return [lineKey, directionId ?? '', canonicalStopId(from) ?? '', canonicalStopId(to) ?? ''].join('|');
}

/** Gewünschte Trackings: eins je Fahrt der Verbindung (Linie, Richtung, eigener Abschnitt). */
export function desiredTrackings(plan: CommutePlan, occ: Pick<Occurrence, 'windowStart'>): DesiredTracking[] {
  return plan.journey.legs
    .filter((l) => !l.walking && l.line)
    .map((leg) => {
      const dep = Date.parse(leg.departure);
      const arr = Date.parse(leg.arrival);
      const ids = (leg.stopovers?.map((s) => s.stop.id) ?? [leg.from.id, leg.to.id]).map((s) => canonicalStopId(s)).filter((s): s is string => !!s);
      return {
        key: trackingKey(leg.line!.key, leg.directionId, leg.from.id, leg.to.id),
        leg,
        stopIds: [...new Set(ids)].slice(0, 200),
        startsAt: new Date(Math.min(occ.windowStart, dep - TRACK_BEFORE_MIN * MIN)),
        endsAt: new Date(Math.max(arr, dep) + TRACK_AFTER_MIN * MIN),
      };
    });
}

/**
 * Bringt die automatischen Trackings einer Strecke auf den Stand der Verbindung:
 * gleiche Linie/Richtung/Abschnitt → aktualisieren (Alarme bleiben erhalten), sonst ersetzen.
 */
export async function syncCommuteTrackings(
  db: Db,
  c: { id: string; userId: string; kinds: ReportKind[] },
  plan: CommutePlan,
  occ: Pick<Occurrence, 'windowStart'>,
  now: number,
): Promise<{ inserted: number; updated: number; deleted: number }> {
  const desired = desiredTrackings(plan, occ);
  const { rows: existing } = await db.query<{ id: string; line_key: string; direction_id: string | null; from_stop_id: string | null; to_stop_id: string | null }>(
    'SELECT id, line_key, direction_id, from_stop_id, to_stop_id FROM trackings WHERE commute_id = $1 AND ends_at > $2 ORDER BY id',
    [c.id, new Date(now)],
  );
  const free = new Map<string, string[]>();
  for (const e of existing) {
    const k = trackingKey(e.line_key, e.direction_id, e.from_stop_id, e.to_stop_id);
    free.set(k, [...(free.get(k) ?? []), String(e.id)]);
  }
  let inserted = 0;
  let updated = 0;
  for (const d of desired) {
    const leg = d.leg;
    const match = free.get(d.key)?.shift();
    if (match) {
      await db.query(
        `UPDATE trackings SET trip_id = $2, headsign = $3, stop_ids = $4, starts_at = $5, ends_at = $6, kinds = $7,
            from_stop_name = $8, to_stop_name = $9 WHERE id = $1`,
        [match, leg.tripId ?? null, leg.headsign ?? null, d.stopIds, d.startsAt, d.endsAt, c.kinds, leg.from.name, leg.to.name],
      );
      updated++;
      continue;
    }
    await upsertLine(db, leg.line!);
    await db.query(
      `INSERT INTO trackings (user_id, line_key, direction_id, headsign, trip_id, both_directions,
          from_stop_id, from_stop_name, to_stop_id, to_stop_name, stop_ids, starts_at, ends_at, kinds, source, commute_id)
       VALUES ($1,$2,$3,$4,$5,false,$6,$7,$8,$9,$10,$11,$12,$13,'commute',$14)`,
      [
        c.userId, leg.line!.key, leg.directionId ?? null, leg.headsign ?? null, leg.tripId ?? null,
        leg.from.id || null, leg.from.name, leg.to.id || null, leg.to.name, d.stopIds, d.startsAt, d.endsAt, c.kinds, c.id,
      ],
    );
    inserted++;
  }
  const stale = [...free.values()].flat();
  if (stale.length) await db.query('DELETE FROM trackings WHERE id = ANY($1::bigint[])', [stale]);
  return { inserted, updated, deleted: stale.length };
}
