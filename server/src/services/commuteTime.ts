// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Pendler-Modus: reine Zeit- und Auswahl-Logik (ohne DB/Netz, gut testbar).
 *
 * Alle Termine gelten in Europe/Berlin (inkl. Sommer-/Winterzeit). Ein Termin ("Occurrence")
 * ist ein Kalendertag + die gespeicherte Uhrzeit. Um ihn herum gibt es ein Zeitfenster, in dem
 * der Server die Verbindung plant, die Linien automatisch beobachtet und erinnert.
 */
import type { CommutePlan, CommuteTimeMode, Journey, Leg } from '../contract.js';

export const TZ = 'Europe/Berlin';
const MIN = 60_000;

/** Fenster öffnet so lange vor dem (geschätzten) Losgehen. */
export const WINDOW_BEFORE_MIN = 90;
/** Fenster schließt so lange nach der Ankunft. */
export const WINDOW_AFTER_ARRIVAL_MIN = 15;
/** Ohne Plan: so lange nach dem Termin wird es noch versucht. */
const NO_PLAN_GRACE_MIN = { depart: 60, arrive: 15 } as const;
/** Geschätzte Fahrtdauer, solange noch keine Verbindung bekannt ist ("Ankunft bis"). */
export const DEFAULT_DURATION_MIN = 60;
/** Puffer zwischen "Losgehen" und dem Fußweg zur ersten Haltestelle. */
export const LEAVE_BUFFER_MIN = 1;
/** Ab so vielen Minuten Verschiebung nach der Erinnerung gibt es eine kurze Aktualisierung. */
export const UPDATE_SHIFT_MIN = 3;
/**
 * Neu planen: normal alle 10 Min., in der heißen Phase vor dem Losgehen alle 5 Min.
 * Bewusst sparsam – jede Neuplanung ist eine Anfrage an Transitous (freier Dienst mit Fair-Use).
 */
export const REPLAN_NORMAL_MIN = 10;
export const REPLAN_HOT_MIN = 5;
export const HOT_PHASE_MIN = 20;

// --- Berliner Ortszeit --------------------------------------------------------------------

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export interface LocalParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

export function berlinParts(ms: number): LocalParts {
  const p: Record<string, number> = {};
  for (const part of partsFmt.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { y: p.year, m: p.month, d: p.day, hh: p.hour % 24, mm: p.minute, ss: p.second };
}

/** Abstand Berlin − UTC in Minuten zum Zeitpunkt ms (60 im Winter, 120 im Sommer). */
export function berlinOffsetMin(ms: number): number {
  const p = berlinParts(ms);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MIN);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" des Berliner Kalendertags. */
export function berlinDay(ms: number): string {
  const p = berlinParts(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** Tag ± n Kalendertage ("2026-03-28" + 1 → "2026-03-29"). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Wochentag als Index Mo = 0 … So = 6. */
export function weekdayIndex(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function hasWeekday(mask: number, day: string): boolean {
  return (mask & (1 << weekdayIndex(day))) !== 0;
}

/**
 * Berliner Ortszeit → UTC-Millisekunden. In der Umstellungsnacht im Frühjahr (02:00–03:00 gibt
 * es nicht) landet die Zeit eine Stunde später, im Herbst (02:00–03:00 doppelt) auf der ersten.
 */
export function berlinToUtc(day: string, time: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  // Zwei Durchläufe: erst mit dem Offset der naiven Zeit, dann mit dem am Ergebnis
  let ts = naive - berlinOffsetMin(naive) * MIN;
  const off2 = berlinOffsetMin(ts);
  ts = naive - off2 * MIN;
  // Herbst: die frühere (Sommerzeit-)Variante nehmen, falls sie dieselbe Ortszeit ergibt
  const earlier = ts - 60 * MIN;
  const e = berlinParts(earlier);
  if (e.hh === hh && e.mm === mm && `${e.y}-${pad(e.m)}-${pad(e.d)}` === day) return earlier;
  return ts;
}

/** "07:42" in Berliner Zeit. */
export function berlinClock(ms: number): string {
  const p = berlinParts(ms);
  return `${pad(p.hh)}:${pad(p.mm)}`;
}

// --- Termine und Zeitfenster ----------------------------------------------------------------

export interface CommuteSchedule {
  weekdays: number;
  time: string;
  timeMode: CommuteTimeMode;
  active: boolean;
}

export interface Occurrence {
  day: string;
  /** gewünschte Abfahrt (depart) bzw. Ankunft (arrive) */
  targetAt: number;
  /** ab hier wird geplant/beobachtet */
  windowStart: number;
  /** bis hier wird beobachtet */
  windowEnd: number;
}

export interface PlanTimes {
  day: string;
  /** Losgehen */
  leaveAt: number;
  /** Ankunft am Ziel */
  arrival: number;
}

/**
 * Zeitfenster eines Termins. Ist für den Tag schon eine Verbindung bekannt, richtet es sich
 * nach ihr (Losgehen − 90 Min. bis Ankunft + 15 Min.), sonst nach der Uhrzeit.
 */
export function occurrenceFor(c: CommuteSchedule, day: string, opts: { durationMin?: number | null; plan?: PlanTimes | null } = {}): Occurrence {
  const targetAt = berlinToUtc(day, c.time);
  const duration = Math.max(5, opts.durationMin ?? DEFAULT_DURATION_MIN);
  const estLeave = c.timeMode === 'depart' ? targetAt : targetAt - duration * MIN;
  const plan = opts.plan && opts.plan.day === day ? opts.plan : null;
  const leave = plan ? Math.min(plan.leaveAt, estLeave) : estLeave;
  const windowStart = leave - WINDOW_BEFORE_MIN * MIN;
  const windowEnd = plan
    ? Math.max(plan.arrival, targetAt) + WINDOW_AFTER_ARRIVAL_MIN * MIN
    : c.timeMode === 'depart'
      ? targetAt + (duration + NO_PLAN_GRACE_MIN.depart) * MIN
      : targetAt + NO_PLAN_GRACE_MIN.arrive * MIN;
  return { day, targetAt, windowStart, windowEnd };
}

/**
 * Der Termin, dessen Fenster gerade läuft (gestern/heute/morgen – für Fahrten über Mitternacht).
 * null = gerade nichts zu tun.
 */
export function activeOccurrence(
  c: CommuteSchedule,
  now: number,
  opts: { durationMin?: number | null; plan?: PlanTimes | null } = {},
): Occurrence | null {
  if (!c.active) return null;
  const today = berlinDay(now);
  for (const day of [addDays(today, -1), today, addDays(today, 1)]) {
    if (!hasWeekday(c.weekdays, day)) continue;
    const occ = occurrenceFor(c, day, opts);
    if (now >= occ.windowStart && now <= occ.windowEnd) return occ;
  }
  return null;
}

/**
 * Nächster Termin, dessen Ziel-Uhrzeit noch nicht vorbei ist (oder dessen Fenster gerade läuft).
 * Sucht bis zu 8 Tage voraus.
 */
export function nextOccurrence(
  c: CommuteSchedule,
  now: number,
  opts: { durationMin?: number | null; plan?: PlanTimes | null } = {},
): Occurrence | null {
  if (!c.active || (c.weekdays & 0x7f) === 0) return null;
  const running = activeOccurrence(c, now, opts);
  if (running) return running;
  const today = berlinDay(now);
  for (let i = 0; i <= 8; i++) {
    const day = addDays(today, i);
    if (!hasWeekday(c.weekdays, day)) continue;
    const occ = occurrenceFor(c, day, opts);
    if (occ.targetAt >= now) return occ;
  }
  return null;
}

/** Bitmaske der Kalendertage gestern/heute/morgen – für die Vorauswahl in SQL. */
export function nearbyWeekdayMask(now: number): number {
  const today = berlinDay(now);
  return [addDays(today, -1), today, addDays(today, 1)].reduce((m, d) => m | (1 << weekdayIndex(d)), 0);
}

// --- Verbindung auswählen und Losgeh-Zeit -------------------------------------------------

export interface JourneyCandidate {
  journey: Journey;
  /** irgendeine Fahrt der Verbindung fällt laut Echtzeit aus */
  cancelled?: boolean;
}

/**
 * Wählt die Verbindung, die der gewünschten Zeit am nächsten kommt:
 *  - depart: Abfahrt möglichst kurz nach der Uhrzeit (früher zählt doppelt – man ist ja noch nicht da)
 *  - arrive: Ankunft möglichst kurz vor der Uhrzeit (zu spät zählt dreifach)
 * Dazu ein kleiner Malus für deutlich längere Fahrten, ausgefallene Verbindungen nur als Notlösung.
 */
export function pickJourney(candidates: JourneyCandidate[], targetAt: number, mode: CommuteTimeMode): Journey | null {
  const usable = candidates.filter((c) => c.journey.legs.length > 0);
  if (usable.length === 0) return null;
  const minDuration = Math.min(...usable.map((c) => c.journey.durationMin));
  let best: { j: Journey; cost: number } | null = null;
  for (const c of usable) {
    const j = c.journey;
    const t = Date.parse(mode === 'depart' ? j.departure : j.arrival);
    const diffMin = (t - targetAt) / MIN;
    let cost: number;
    if (mode === 'depart') cost = diffMin >= 0 ? diffMin : -diffMin * 2;
    else cost = diffMin <= 0 ? -diffMin : diffMin * 3;
    cost += Math.max(0, j.durationMin - minDuration) * 0.5;
    cost += j.transfers * 2;
    if (c.cancelled) cost += 1000;
    if (!best || cost < best.cost) best = { j, cost };
  }
  return best?.j ?? null;
}

export interface LeaveInfo {
  leaveAt: number;
  /** erste Fahrt (kein Fußweg) */
  first: Leg | null;
  firstIndex: number;
  /** Fußweg bis zur ersten Fahrt (Minuten) */
  walkMin: number;
  delayMin: number | null;
}

/** Losgehen = erste Abfahrt (mit Echtzeit) − Fußweg davor − 1 Min. Puffer, auf die Minute abgerundet. */
export function leaveInfo(journey: Journey): LeaveInfo {
  const idx = journey.legs.findIndex((l) => !l.walking && !!l.line);
  if (idx < 0) {
    const start = Date.parse(journey.departure);
    return { leaveAt: floorMin(start - LEAVE_BUFFER_MIN * MIN), first: null, firstIndex: -1, walkMin: journey.durationMin, delayMin: null };
  }
  const first = journey.legs[idx];
  let walkMs = 0;
  for (const l of journey.legs.slice(0, idx)) {
    const d = Date.parse(l.arrival) - Date.parse(l.departure);
    walkMs += Number.isFinite(d) && d > 0 ? d : l.durationMin * MIN;
  }
  const dep = Date.parse(first.departure);
  const planned = Date.parse(first.plannedDeparture);
  const delayMin = first.realtime && Number.isFinite(planned) ? Math.round((dep - planned) / MIN) : null;
  return {
    leaveAt: floorMin(dep - walkMs - LEAVE_BUFFER_MIN * MIN),
    first,
    firstIndex: idx,
    walkMin: Math.round(walkMs / MIN),
    delayMin,
  };
}

function floorMin(ms: number): number {
  return Math.floor(ms / MIN) * MIN;
}

/** Wann neu geplant werden soll. Nach der ersten Abfahrt nicht mehr (man sitzt schon drin). */
export function needsReplan(plan: CommutePlan | null, plannedAt: number | null, now: number, remindMinutes: number | null): boolean {
  if (!plan || plannedAt === null) return true;
  const firstDep = plan.firstDeparture ? Date.parse(plan.firstDeparture) : Date.parse(plan.journey.departure);
  if (now >= firstDep) return false;
  const leaveAt = Date.parse(plan.leaveAt);
  const hot = Math.max(HOT_PHASE_MIN, (remindMinutes ?? 0) + 5);
  const interval = now >= leaveAt - hot * MIN ? REPLAN_HOT_MIN : REPLAN_NORMAL_MIN;
  return now - plannedAt >= interval * MIN - 5_000;
}

// --- Erinnerungen (genau eine, plus höchstens eine Aktualisierung) --------------------------

/** Benachrichtigungs-Stand je Termin (commutes.notify_state). */
export interface NotifyState {
  day?: string;
  /** Erinnerung verschickt (ISO) */
  remindedAt?: string;
  /** Losgeh-Zeit, die in der Erinnerung stand (ISO) */
  leaveAt?: string;
  /** Abfahrt der ersten Fahrt aus der Erinnerung (ISO) */
  departure?: string;
  /** Fahrt-ID der ersten Fahrt aus der Erinnerung */
  tripId?: string;
  updateSentAt?: string;
  cancelSentAt?: string;
}

/** Stand für einen anderen Termin zählt nicht. */
export function stateFor(state: NotifyState | null | undefined, day: string): NotifyState {
  return state && state.day === day ? state : { day };
}

export type ReminderDecision = 'remind' | 'update' | null;

/**
 * - remind: einmal, sobald jetzt ≥ Losgehen − Vorlauf (und die erste Fahrt noch nicht weg ist)
 * - update: einmal, wenn sich die Losgeh-Zeit danach um ≥ 3 Min. verschoben hat
 */
export function decideReminder(state: NotifyState, plan: CommutePlan, now: number, remindMinutes: number | null): ReminderDecision {
  if (!remindMinutes) return null;
  const leaveAt = Date.parse(plan.leaveAt);
  const firstDep = plan.firstDeparture ? Date.parse(plan.firstDeparture) : Date.parse(plan.journey.departure);
  // Erste Fahrt (fast) weg → keine Erinnerung mehr
  if (now > firstDep - MIN) return null;
  if (!state.remindedAt) return now >= leaveAt - remindMinutes * MIN ? 'remind' : null;
  if (state.updateSentAt || state.cancelSentAt || !state.leaveAt) return null;
  const shift = Math.abs(leaveAt - Date.parse(state.leaveAt)) / MIN;
  return shift >= UPDATE_SHIFT_MIN ? 'update' : null;
}
