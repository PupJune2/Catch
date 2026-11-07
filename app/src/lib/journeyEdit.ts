// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Verbindung bearbeiten: einen Abschnitt durch eine andere Fahrt (früher/später) ersetzen.
 *
 * Beispiel: Der RE 42 kommt in Lage an und der Umstieg ist zu knapp → früheren RE 42 wählen.
 * Davor und danach bleibt alles, solange es noch passt:
 *  - Vorlauf (Fahrten davor): reicht die Zeit bis zur neuen Abfahrt nicht mehr, wird der Weg
 *    vom Start zur Abfahrtshaltestelle neu gesucht ("ankommen bis").
 *  - Nachlauf (Fahrten danach): kommt die neue Fahrt zu spät für den Anschluss, wird ab der
 *    Ankunftshaltestelle neu gesucht.
 * Reine Fußwege am Anfang/Ende werden einfach mitverschoben.
 */
import { geoPlaceId, type Journey, type JourneysResponse, type Leg, type Stop } from '@/api/contract';

const MIN = 60_000;
/** Mindestzeit zum Umsteigen, wenn wir selbst prüfen (am selben Bahnhof / nach dem Fußweg). */
const MIN_CHANGE_MS = 2 * MIN;
/** Ab hier (Minuten Puffer nach Abzug des Fußwegs) gilt ein Umstieg als knapp. */
export const TIGHT_CHANGE_MIN = 4;

export function isRide(leg: Leg | undefined): leg is Leg & { line: NonNullable<Leg['line']> } {
  return !!leg && !leg.walking && !!leg.line;
}

const ms = (iso: string) => Date.parse(iso);

/** Start/Ziel als Parameter für GET /v1/journeys: Stop-ID oder "geo:<lat>,<lon>" (Adresse). */
export function placeParam(stop: Stop): string | null {
  if (stop.id) return stop.id;
  if (stop.lat !== undefined && stop.lon !== undefined) return geoPlaceId(stop.lat, stop.lon);
  return null;
}

// ---------------------------------------------------------------------------
// Umstiege anzeigen
// ---------------------------------------------------------------------------

export type ChangeTone = 'ok' | 'tight' | 'missed';

export interface ChangeInfo {
  /** Index der ankommenden Fahrt */
  fromIndex: number;
  /** Index der abfahrenden Fahrt */
  toIndex: number;
  /** Wo umgestiegen wird (Abfahrtshaltestelle der nächsten Fahrt) */
  stop: Stop;
  /** Zeit zwischen Ankunft und Abfahrt (inkl. Fußweg), Minuten */
  totalMin: number;
  /** davon Fußweg, Minuten */
  walkMin: number;
  /** Puffer = Gesamtzeit − Fußweg */
  spareMin: number;
  tone: ChangeTone;
}

function changeTone(spareMin: number): ChangeTone {
  if (spareMin < 0) return 'missed';
  if (spareMin < TIGHT_CHANGE_MIN) return 'tight';
  return 'ok';
}

/** Alle Umstiege einer Verbindung (mit aktuellen Zeiten, also inkl. Verspätung). */
export function changesOf(legs: Leg[]): ChangeInfo[] {
  const out: ChangeInfo[] = [];
  let prev = -1;
  let walkMs = 0;
  legs.forEach((leg, i) => {
    if (!isRide(leg)) {
      if (prev >= 0) walkMs += Math.max(0, ms(leg.arrival) - ms(leg.departure));
      return;
    }
    if (prev >= 0) {
      const totalMin = Math.round((ms(leg.departure) - ms(legs[prev].arrival)) / MIN);
      const walkMin = Math.round(walkMs / MIN);
      const spareMin = totalMin - walkMin;
      out.push({ fromIndex: prev, toIndex: i, stop: leg.from, totalMin, walkMin, spareMin, tone: changeTone(spareMin) });
    }
    prev = i;
    walkMs = 0;
  });
  return out;
}

/**
 * Vorschau für eine Alternative in der Auswahl: Umstieg zur nächsten Fahrt, falls diese
 * unverändert erreichbar bleibt (sonst null → Anschluss wird neu gesucht).
 */
export function nextChangeWith(legs: Leg[], index: number, option: Leg): ChangeInfo | null {
  const after = legs.slice(index + 1);
  const nextRide = after.findIndex(isRide);
  if (nextRide < 0 || !keepsConnection(legs[index], after, nextRide, option)) return null;
  return changesOf([...legs.slice(0, index), option, ...after]).find((c) => c.toIndex === index + 1 + nextRide) ?? null;
}

/** Bleibt der Anschluss after[nextRide] erreichbar, wenn statt `old` die Fahrt `option` genommen wird? */
function keepsConnection(old: Leg, after: Leg[], nextRide: number, option: Leg): boolean {
  const origGap = ms(after[nextRide].departure) - ms(old.arrival);
  const needed = Math.min(origGap, walkMsOf(after.slice(0, nextRide)) + MIN_CHANGE_MS);
  return ms(after[nextRide].departure) - ms(option.arrival) >= needed;
}

// ---------------------------------------------------------------------------
// Neu zusammensetzen
// ---------------------------------------------------------------------------

export type RebuildFailure = 'before' | 'after';

export class RebuildError extends Error {
  constructor(public readonly part: RebuildFailure) {
    super(part === 'before' ? 'no connection to the new departure' : 'no connection after the new arrival');
  }
}

type JourneysFn = (params: {
  from: string;
  to: string;
  fromName?: string;
  toName?: string;
  time?: string;
  arriveBy?: boolean;
}) => Promise<JourneysResponse>;

function shiftIso(iso: string, deltaMs: number): string {
  return new Date(ms(iso) + deltaMs).toISOString();
}

/** Fußweg zeitlich verschieben (Fahrten werden nie verschoben). */
function shiftLeg(leg: Leg, deltaMs: number): Leg {
  if (!deltaMs) return leg;
  return {
    ...leg,
    departure: shiftIso(leg.departure, deltaMs),
    plannedDeparture: shiftIso(leg.plannedDeparture, deltaMs),
    arrival: shiftIso(leg.arrival, deltaMs),
    plannedArrival: shiftIso(leg.plannedArrival, deltaMs),
  };
}

function walkMsOf(legs: Leg[]): number {
  return legs.reduce((s, l) => s + Math.max(0, ms(l.arrival) - ms(l.departure)), 0);
}

const usesTrip = (j: Journey, tripId: string | undefined) => !!tripId && j.legs.some((l) => l.tripId === tripId);

/** Teil vor der neuen Fahrt. */
async function rebuildBefore(legs: Leg[], index: number, option: Leg, journeys: JourneysFn): Promise<Leg[]> {
  const before = legs.slice(0, index);
  const old = legs[index];
  const lastRide = before.map(isRide).lastIndexOf(true);

  // Nur Fußweg (oder nichts) davor: mitverschieben, sodass er wieder genau passt
  if (lastRide < 0) return before.map((l) => shiftLeg(l, ms(option.departure) - ms(old.departure)));

  // Reicht die Zeit noch? (Fußwege zwischen letzter Fahrt und neuer Abfahrt + Mindestumstieg,
  // höchstens aber so viel, wie die ursprüngliche Verbindung selbst eingeplant hatte)
  const origGap = ms(old.departure) - ms(before[lastRide].arrival);
  const needed = Math.min(origGap, walkMsOf(before.slice(lastRide + 1)) + MIN_CHANGE_MS);
  if (ms(option.departure) - ms(before[lastRide].arrival) >= needed) return before;

  // Neu suchen: vom Start so, dass man rechtzeitig an der Abfahrtshaltestelle ist
  const start = before[0].from;
  const from = placeParam(start);
  if (!from || !old.from.id) throw new RebuildError('before');
  // Bekannten Fußweg am Bahnhof (z. B. Bussteig → Gleis) einplanen, mindestens aber den Mindestumstieg
  const latest = ms(option.departure) - Math.max(MIN_CHANGE_MS, walkMsOf(before.slice(lastRide + 1)) + MIN);
  const res = await journeys({
    from,
    to: old.from.id,
    fromName: start.name,
    time: new Date(latest).toISOString(),
    arriveBy: true,
  });
  const best = res.journeys
    .filter((j) => !j.offline && j.legs.length > 0 && ms(j.arrival) <= latest && !usesTrip(j, option.tripId))
    // möglichst spät los, dann wenig Umstiege
    .sort((a, b) => ms(b.departure) - ms(a.departure) || a.transfers - b.transfers)[0];
  if (!best) throw new RebuildError('before');
  return best.legs;
}

/** Teil nach der neuen Fahrt. */
async function rebuildAfter(legs: Leg[], index: number, option: Leg, journeys: JourneysFn): Promise<Leg[]> {
  const after = legs.slice(index + 1);
  const old = legs[index];
  const deltaArr = ms(option.arrival) - ms(old.arrival);
  const nextRide = after.findIndex(isRide);

  // Nur Fußweg (oder nichts) danach: mitverschieben
  if (nextRide < 0) return after.map((l) => shiftLeg(l, deltaArr));

  if (keepsConnection(old, after, nextRide, option)) {
    // Anschluss klappt weiterhin; Fußweg direkt nach der Ankunft beginnen lassen
    return [...after.slice(0, nextRide).map((l) => shiftLeg(l, deltaArr)), ...after.slice(nextRide)];
  }

  const end = after[after.length - 1].to;
  const to = placeParam(end);
  if (!to || !old.to.id) throw new RebuildError('after');
  // Bekannten Fußweg am Bahnhof (z. B. Gleis → Bussteig) einplanen, mindestens aber den Mindestumstieg
  const earliest = ms(option.arrival) + Math.max(MIN_CHANGE_MS, walkMsOf(after.slice(0, nextRide)) + MIN);
  const res = await journeys({
    from: old.to.id,
    to,
    toName: end.name,
    time: new Date(earliest).toISOString(),
  });
  const best = res.journeys
    .filter((j) => !j.offline && j.legs.length > 0 && ms(j.departure) >= earliest - MIN && !usesTrip(j, option.tripId))
    // möglichst früh da, dann wenig Umstiege, dann spät los
    .sort((a, b) => ms(a.arrival) - ms(b.arrival) || a.transfers - b.transfers || ms(b.departure) - ms(a.departure))[0];
  if (!best) throw new RebuildError('after');
  return best.legs;
}

/**
 * Ersetzt legs[index] durch `option` und passt Vor- und Nachlauf an.
 * Wirft RebuildError, wenn davor/danach keine passende Verbindung gefunden wird.
 */
export async function rebuildJourney(journey: Journey, index: number, option: Leg, journeys: JourneysFn): Promise<Journey> {
  const [before, after] = await Promise.all([
    rebuildBefore(journey.legs, index, option, journeys),
    rebuildAfter(journey.legs, index, option, journeys),
  ]);
  const legs = [...before, option, ...after];
  const departure = legs[0].departure;
  const arrival = legs[legs.length - 1].arrival;
  const baseId = journey.id.split('~')[0];
  return {
    id: `${baseId}~${(option.tripId ?? option.departure).slice(-24)}~${Date.now().toString(36)}`,
    departure,
    arrival,
    durationMin: Math.round((ms(arrival) - ms(departure)) / MIN),
    transfers: Math.max(0, legs.filter(isRide).length - 1),
    legs,
  };
}
