// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Pendler-Modus im Hintergrund (läuft jede Minute):
 *
 *  1. Strecken mit laufendem Zeitfenster suchen (Berliner Zeit, gestern/heute/morgen).
 *  2. Verbindung planen bzw. neu planen (alle 10 Min., kurz vor dem Losgehen alle 5 Min.,
 *     nach der ersten Abfahrt nicht mehr) und die automatischen Trackings anpassen →
 *     Meldungen auf diesen Linien lösen über die normale Alarm-Kette Pushes aus.
 *  3. "Zeit zu gehen": genau eine Push X Min. vor dem Losgehen, höchstens eine Aktualisierung
 *     bei ≥ 3 Min. Verschiebung, eine Push bei Ausfall der ersten Fahrt.
 *
 * Billig und robust: eine SQL-Abfrage pro Durchlauf, begrenzte Zahl von MOTIS-Anfragen,
 * Fehler einzelner Strecken (DB/MOTIS) werden protokolliert und im nächsten Durchlauf erneut versucht.
 * Uhr und Push-Versand sind für Tests ersetzbar.
 */
import type { CommutePlan, CommutePushData, Line } from '../contract.js';
import type { Deps } from '../deps.js';
import { DEFAULT_LANG, t, type Lang } from '../i18n.js';
import { canonicalStopId } from '../transit/mapping.js';
import type { MotisClient } from '../transit/motis.js';
import type { PushNotice } from './notifier.js';
import {
  activeOccurrence,
  berlinClock,
  decideReminder,
  leaveInfo,
  nearbyWeekdayMask,
  needsReplan,
  stateFor,
  type NotifyState,
  type Occurrence,
} from './commuteTime.js';
import {
  compactPlan,
  firstTripId,
  occurrenceOpts,
  planOccurrence,
  scheduleOf,
  syncCommuteTrackings,
  type CommuteRow,
  type PlanResult,
} from './commutes.js';
import { shortStopName } from './stats.js';

const MIN = 60_000;

export type CommuteJobDeps = Pick<Deps, 'db' | 'motis' | 'push' | 'log'>;

export interface TickOptions {
  /** höchstens so viele MOTIS-Planungen pro Durchlauf (Rest im nächsten) */
  maxPlans?: number;
  /** gleichzeitige Planungen */
  concurrency?: number;
}

export interface TickStats {
  candidates: number;
  due: number;
  planned: number;
  failed: number;
  reminders: number;
  updates: number;
  cancellations: number;
}

// --- Texte -------------------------------------------------------------------------------

/** "Bus 15", "Tram 4", sonst der Linienname ("U8", "RE7"). */
export function lineLabel(lang: Lang, line: Pick<Line, 'name' | 'mode'>): string {
  if (/^\d/.test(line.name)) {
    if (line.mode === 'BUS') return t(lang, 'line_bus', { name: line.name });
    if (line.mode === 'TRAM') return t(lang, 'line_tram', { name: line.name });
  }
  return line.name;
}

function pushData(event: CommutePushData['event'], commuteId: string, plan: CommutePlan): Record<string, string> {
  const data: CommutePushData = {
    type: 'commute',
    event,
    commuteId,
    day: plan.day,
    leaveAt: plan.leaveAt,
    departure: plan.firstDeparture ?? plan.journey.departure,
    line: plan.firstLine?.name ?? '',
    lineKey: plan.firstLine?.key ?? '',
  };
  return { ...data };
}

function legParams(lang: Lang, plan: CommutePlan) {
  const delay = plan.delayMin && plan.delayMin > 0 ? t(lang, 'commute_delay', { n: plan.delayMin }) : '';
  return {
    line: plan.firstLine ? lineLabel(lang, plan.firstLine) : '',
    time: plan.firstDeparture ? berlinClock(Date.parse(plan.firstDeparture)) : '',
    stop: shortStopName(plan.firstStop?.name ?? ''),
    leave: berlinClock(Date.parse(plan.leaveAt)),
    delay,
  };
}

/** "To work: time to leave" · "Bus 15 at 07:42 from Weseler Straße (+2 min) · 4 min walk" */
export function leaveNotice(lang: Lang, name: string, commuteId: string, plan: CommutePlan): PushNotice {
  const p = legParams(lang, plan);
  const walkMin = leaveInfo(plan.journey).walkMin;
  const message = plan.firstLine
    ? t(lang, 'commute_leave_body', { ...p, walk: walkMin > 0 ? t(lang, 'commute_walk', { min: walkMin }) : '' })
    : t(lang, 'commute_walk_body', { leave: p.leave, min: plan.journey.durationMin });
  return { title: t(lang, 'commute_leave_title', { name }), message, data: pushData('leave', commuteId, plan) };
}

export function updateNotice(lang: Lang, name: string, commuteId: string, plan: CommutePlan): PushNotice {
  const p = legParams(lang, plan);
  const message = plan.firstLine ? t(lang, 'commute_update_body', p) : t(lang, 'commute_walk_body', { leave: p.leave, min: plan.journey.durationMin });
  return { title: t(lang, 'commute_update_title', { name }), message, data: pushData('update', commuteId, plan) };
}

export function cancelNotice(lang: Lang, name: string, commuteId: string, cancelledLine: string, plan: CommutePlan | null): PushNotice {
  const title = t(lang, 'commute_cancel_title', { line: cancelledLine, name });
  if (!plan || !plan.firstLine) {
    return { title, message: t(lang, 'commute_cancel_none'), data: plan ? pushData('cancelled', commuteId, plan) : { type: 'commute', event: 'cancelled', commuteId } };
  }
  return { title, message: t(lang, 'commute_cancel_body', legParams(lang, plan)), data: pushData('cancelled', commuteId, plan) };
}

// --- Ausfall der Fahrt aus der Erinnerung ------------------------------------------------

/** Fällt die Fahrt (ganz oder am Einstiegshalt) laut Echtzeit aus? Fehler → nein. */
export async function tripCancelled(motis: Pick<MotisClient, 'trip'>, tripId: string, boardingStopId: string | null): Promise<boolean> {
  try {
    const it = await motis.trip(tripId);
    const leg = it.legs.find((l) => l.mode !== 'WALK') ?? it.legs[0];
    if (!leg) return false;
    if (leg.cancelled || leg.tripCancelled) return true;
    const board = canonicalStopId(boardingStopId);
    if (!board) return false;
    return [leg.from, ...(leg.intermediateStops ?? []), leg.to].some(
      (p) => p.cancelled && (canonicalStopId(p.stopId) === board || canonicalStopId(p.parentId) === board),
    );
  } catch {
    return false;
  }
}

// --- Ein Durchlauf -----------------------------------------------------------------------

/** Benachrichtigungs-Stand nur ändern, wenn er seit dem Lesen gleich geblieben ist (keine doppelten Pushes). */
async function claimState(deps: CommuteJobDeps, id: string, before: NotifyState | null, next: NotifyState): Promise<boolean> {
  const res = await deps.db.query(
    `UPDATE commutes SET notify_state = $2::jsonb WHERE id = $1 AND notify_state = $3::jsonb RETURNING id`,
    [id, JSON.stringify(next), JSON.stringify(before ?? {})],
  );
  return (res.rowCount ?? 0) > 0;
}

async function send(deps: CommuteJobDeps, uid: string, notice: PushNotice): Promise<void> {
  if (!deps.push.sendNotice) return;
  await deps.push.sendNotice(deps.db, uid, notice).catch((err) => deps.log.warn({ err }, 'Pendler-Push fehlgeschlagen'));
}

class Budget {
  constructor(private left: number) {}
  take(): boolean {
    if (this.left <= 0) return false;
    this.left--;
    return true;
  }
}

async function processCommute(deps: CommuteJobDeps, row: CommuteRow, occ: Occurrence, now: number, budget: Budget, stats: TickStats): Promise<void> {
  const id = String(row.id);
  const lang = row.lang ?? DEFAULT_LANG;
  let plan: CommutePlan | null = row.plan && row.plan.day === occ.day ? row.plan : null;
  let dbState: NotifyState | null = row.notify_state ?? {};
  let state = stateFor(dbState, occ.day);
  const plannedAt = plan && row.planned_at ? row.planned_at.getTime() : null;

  if (needsReplan(plan, plannedAt, now, row.remind_minutes) && budget.take()) {
    let res: PlanResult | null;
    try {
      res = await planOccurrence(deps.motis, { from: row.from_place, to: row.to_place, timeMode: row.time_mode }, occ, now);
    } catch (err) {
      stats.failed++;
      deps.log.warn({ err: (err as Error).message, commute: id }, 'Pendler: Planung fehlgeschlagen');
      res = null;
      if (!plan) return;
    }
    if (res) {
      stats.planned++;
      // Fällt die Fahrt aus der Erinnerung aus? → einmal Bescheid geben, mit der neuen Verbindung
      const oldTrip = state.tripId;
      const newTrip = firstTripId(res.plan);
      if (
        state.remindedAt && oldTrip && !state.cancelSentAt && oldTrip !== newTrip &&
        state.departure && Date.parse(state.departure) > now &&
        (res.cancelledTrips.has(oldTrip) || (!res.tripIds.has(oldTrip) && (await tripCancelled(deps.motis, oldTrip, plan?.firstStop?.id ?? null))))
      ) {
        const next: NotifyState = {
          ...state,
          cancelSentAt: new Date(now).toISOString(),
          leaveAt: res.plan.leaveAt,
          departure: res.plan.firstDeparture ?? undefined,
          tripId: newTrip ?? undefined,
        };
        if (await claimState(deps, id, dbState, next)) {
          const cancelledLine = plan?.firstLine ? lineLabel(lang, plan.firstLine) : '';
          await send(deps, row.user_id, cancelNotice(lang, row.name, id, cancelledLine, res.plan));
          stats.cancellations++;
          dbState = next;
          state = next;
        }
      }
      plan = res.plan;
      await deps.db.query('UPDATE commutes SET plan = $2, planned_at = $3, last_duration_min = $4 WHERE id = $1', [
        id, JSON.stringify(compactPlan(plan)), new Date(now), Math.min(600, plan.journey.durationMin),
      ]);
      await syncCommuteTrackings(deps.db, { id, userId: row.user_id, kinds: row.kinds ?? [] }, plan, occ, now);
    }
  }
  if (!plan) return;

  const decision = decideReminder(state, plan, now, row.remind_minutes);
  if (!decision) return;
  const at = new Date(now).toISOString();
  const next: NotifyState =
    decision === 'remind'
      ? { day: occ.day, remindedAt: at, leaveAt: plan.leaveAt, departure: plan.firstDeparture ?? plan.journey.departure, tripId: firstTripId(plan) ?? undefined }
      : { ...state, updateSentAt: at, leaveAt: plan.leaveAt, departure: plan.firstDeparture ?? plan.journey.departure, tripId: firstTripId(plan) ?? undefined };
  if (!(await claimState(deps, id, dbState, next))) return;
  if (decision === 'remind') {
    await send(deps, row.user_id, leaveNotice(lang, row.name, id, plan));
    stats.reminders++;
  } else {
    await send(deps, row.user_id, updateNotice(lang, row.name, id, plan));
    stats.updates++;
  }
}

/** Ein Durchlauf des Jobs. `now` ist ersetzbar (Tests, Szenarien). */
export async function runCommuteTick(deps: CommuteJobDeps, now = Date.now(), opts: TickOptions = {}): Promise<TickStats> {
  const stats: TickStats = { candidates: 0, due: 0, planned: 0, failed: 0, reminders: 0, updates: 0, cancellations: 0 };
  const { rows } = await deps.db.query<CommuteRow>(
    `SELECT c.*, u.lang FROM commutes c JOIN users u ON u.id = c.user_id
     WHERE c.active AND (c.weekdays & $1) <> 0 AND NOT u.banned`,
    [nearbyWeekdayMask(now)],
  );
  stats.candidates = rows.length;
  const due: Array<{ row: CommuteRow; occ: Occurrence; urgency: number }> = [];
  for (const row of rows) {
    const occ = activeOccurrence(scheduleOf(row), now, occurrenceOpts(row));
    if (!occ) continue;
    const leave = row.plan && row.plan.day === occ.day ? Date.parse(row.plan.leaveAt) : occ.targetAt;
    due.push({ row, occ, urgency: leave });
  }
  stats.due = due.length;
  // Wer zuerst los muss, kommt zuerst dran
  due.sort((a, b) => a.urgency - b.urgency);
  const budget = new Budget(opts.maxPlans ?? 30);
  const queue = [...due];
  const workers = Array.from({ length: Math.max(1, opts.concurrency ?? 3) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        await processCommute(deps, item.row, item.occ, now, budget, stats);
      } catch (err) {
        stats.failed++;
        deps.log.warn({ err, commute: String(item.row.id) }, 'Pendler: Durchlauf für Strecke fehlgeschlagen');
      }
    }
  });
  await Promise.all(workers);
  return stats;
}

export interface CommuteScheduler {
  stop(): void;
  /** Sofort einen Durchlauf (überspringt, wenn gerade einer läuft). */
  runNow(): Promise<TickStats | null>;
}

/** Startet den Job (Standard: jede Minute, erster Lauf nach 10 s). */
export function startCommuteScheduler(
  deps: CommuteJobDeps,
  opts: TickOptions & { intervalMs?: number; firstDelayMs?: number; now?: () => number } = {},
): CommuteScheduler {
  let running = false;
  const clock = opts.now ?? Date.now;
  const runNow = async (): Promise<TickStats | null> => {
    if (running) return null;
    running = true;
    try {
      const stats = await runCommuteTick(deps, clock(), opts);
      if (stats.planned || stats.reminders || stats.failed) deps.log.info?.({ ...stats }, 'Pendler-Job');
      return stats;
    } catch (err) {
      // z. B. Datenbank kurz weg → im nächsten Durchlauf erneut
      deps.log.warn({ err }, 'Pendler-Job fehlgeschlagen');
      return null;
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void runNow(), opts.firstDelayMs ?? 10_000);
  const timer = setInterval(() => void runNow(), opts.intervalMs ?? MIN);
  first.unref?.();
  timer.unref?.();
  return {
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
    runNow,
  };
}
