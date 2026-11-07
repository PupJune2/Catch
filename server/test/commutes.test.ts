// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { describe, expect, it } from 'vitest';
import { WEEKDAYS_ALL, WEEKDAYS_MON_FRI, type CommutePlan, type Journey, type Leg, type Report } from '../src/contract.js';
import {
  activeOccurrence,
  addDays,
  berlinClock,
  berlinDay,
  berlinToUtc,
  decideReminder,
  hasWeekday,
  leaveInfo,
  nearbyWeekdayMask,
  needsReplan,
  nextOccurrence,
  pickJourney,
  stateFor,
  weekdayIndex,
  type CommuteSchedule,
  type NotifyState,
} from '../src/services/commuteTime.js';
import { compactPlan, desiredTrackings, planOccurrence } from '../src/services/commutes.js';
import { cancelNotice, leaveNotice, lineLabel, tripCancelled, updateNotice } from '../src/services/commuteJob.js';
import { alertTexts } from '../src/services/trackings.js';
import type { MotisItinerary, MotisLeg, MotisPlanResponse } from '../src/transit/motis.js';

const MIN = 60_000;
/** Berliner Ortszeit → ms (Kurzform für die Tests) */
const at = (day: string, time: string) => berlinToUtc(day, time);
const iso = (ms: number) => new Date(ms).toISOString();

const weekdays: CommuteSchedule = { weekdays: WEEKDAYS_MON_FRI, time: '07:30', timeMode: 'depart', active: true };

describe('Berliner Zeit', () => {
  it('rechnet Winter- und Sommerzeit um', () => {
    expect(iso(at('2026-11-09', '07:30'))).toBe('2026-11-09T06:30:00.000Z'); // MEZ
    expect(iso(at('2026-07-06', '07:30'))).toBe('2026-07-06T05:30:00.000Z'); // MESZ
    expect(berlinClock(Date.parse('2026-11-09T06:42:00Z'))).toBe('07:42');
    expect(berlinClock(Date.parse('2026-07-06T22:05:00Z'))).toBe('00:05');
  });
  it('Zeitumstellung: Tag davor/danach, Lücke im Frühjahr, doppelte Stunde im Herbst', () => {
    expect(iso(at('2026-03-28', '07:30'))).toBe('2026-03-28T06:30:00.000Z');
    expect(iso(at('2026-03-29', '07:30'))).toBe('2026-03-29T05:30:00.000Z');
    expect(iso(at('2026-03-29', '02:30'))).toBe('2026-03-29T01:30:00.000Z'); // gibt es nicht → 03:30 MESZ
    expect(iso(at('2026-10-25', '02:30'))).toBe('2026-10-25T00:30:00.000Z'); // erste (Sommerzeit-)Variante
    expect(iso(at('2026-10-25', '07:30'))).toBe('2026-10-25T06:30:00.000Z');
    expect(iso(at('2026-10-24', '07:30'))).toBe('2026-10-24T05:30:00.000Z');
  });
  it('Kalendertag und Wochentag in Berlin (nicht UTC)', () => {
    expect(berlinDay(Date.parse('2026-11-08T23:30:00Z'))).toBe('2026-11-09'); // 00:30 in Berlin
    expect(berlinDay(Date.parse('2026-07-05T22:30:00Z'))).toBe('2026-07-06');
    expect(weekdayIndex('2026-11-09')).toBe(0); // Montag
    expect(weekdayIndex('2026-11-08')).toBe(6); // Sonntag
    expect(hasWeekday(WEEKDAYS_MON_FRI, '2026-11-13')).toBe(true); // Freitag
    expect(hasWeekday(WEEKDAYS_MON_FRI, '2026-11-14')).toBe(false); // Samstag
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    // Sonntag: gestern Sa, heute So, morgen Mo
    expect(nearbyWeekdayMask(at('2026-11-08', '12:00'))).toBe((1 << 5) | (1 << 6) | (1 << 0));
  });
});

describe('Zeitfenster', () => {
  it('öffnet 90 Min. vor dem Losgehen, nur an gewählten Tagen', () => {
    expect(activeOccurrence(weekdays, at('2026-11-09', '05:59'))).toBeNull();
    const occ = activeOccurrence(weekdays, at('2026-11-09', '06:00'));
    expect(occ?.day).toBe('2026-11-09');
    expect(occ?.targetAt).toBe(at('2026-11-09', '07:30'));
    expect(activeOccurrence(weekdays, at('2026-11-14', '07:00'))).toBeNull(); // Samstag
    expect(activeOccurrence({ ...weekdays, active: false }, at('2026-11-09', '07:00'))).toBeNull();
  });
  it('schließt nach Ankunft + 15 Min., sobald eine Verbindung bekannt ist', () => {
    const plan = { day: '2026-11-09', leaveAt: at('2026-11-09', '07:35'), arrival: at('2026-11-09', '08:05') };
    expect(activeOccurrence(weekdays, at('2026-11-09', '08:20'), { plan })?.day).toBe('2026-11-09');
    expect(activeOccurrence(weekdays, at('2026-11-09', '08:21'), { plan })).toBeNull();
  });
  it('funktioniert über die Zeitumstellung hinweg (Montag nach der Umstellung)', () => {
    const occ = activeOccurrence(weekdays, Date.parse('2026-03-30T04:00:00Z')); // 06:00 MESZ
    expect(occ?.targetAt).toBe(Date.parse('2026-03-30T05:30:00Z'));
    expect(activeOccurrence(weekdays, Date.parse('2026-03-30T03:59:00Z'))).toBeNull();
  });
  it('"Ankunft bis" öffnet um die Fahrtdauer früher', () => {
    const arrive: CommuteSchedule = { ...weekdays, time: '09:00', timeMode: 'arrive' };
    expect(activeOccurrence(arrive, at('2026-11-09', '05:29'), { durationMin: 120 })).toBeNull();
    expect(activeOccurrence(arrive, at('2026-11-09', '05:30'), { durationMin: 120 })?.day).toBe('2026-11-09');
    // ohne bekannte Dauer: 60 Min. angenommen
    expect(activeOccurrence(arrive, at('2026-11-09', '06:30'))?.day).toBe('2026-11-09');
  });
  it('Fahrt über Mitternacht gehört zum Vortag', () => {
    const late: CommuteSchedule = { weekdays: WEEKDAYS_ALL, time: '23:50', timeMode: 'depart', active: true };
    const plan = { day: '2026-11-09', leaveAt: at('2026-11-09', '23:48'), arrival: at('2026-11-10', '00:30') };
    expect(activeOccurrence(late, at('2026-11-10', '00:20'), { plan })?.day).toBe('2026-11-09');
  });
  it('nächster Termin: heute, sonst der nächste gewählte Tag', () => {
    expect(nextOccurrence(weekdays, at('2026-11-09', '05:00'))?.targetAt).toBe(at('2026-11-09', '07:30'));
    expect(nextOccurrence(weekdays, at('2026-11-13', '10:00'))?.targetAt).toBe(at('2026-11-16', '07:30')); // Fr → Mo
    expect(nextOccurrence({ ...weekdays, active: false }, at('2026-11-09', '05:00'))).toBeNull();
  });
});

// --- Verbindungen --------------------------------------------------------------------------

function leg(p: Omit<Partial<Leg>, 'from' | 'to'> & { from: string; to: string; dep: number; arr: number; planned?: number }): Leg {
  const walking = !p.line;
  return {
    mode: walking ? 'WALK' : p.line!.mode,
    walking,
    from: { id: p.from, name: p.from },
    to: { id: p.to, name: p.to },
    plannedDeparture: iso(p.planned ?? p.dep),
    departure: iso(p.dep),
    plannedArrival: iso(p.arr),
    arrival: iso(p.arr),
    durationMin: Math.round((p.arr - p.dep) / MIN),
    ...(p.line ? { line: p.line, tripId: p.tripId ?? 'trip', realtime: p.realtime ?? true, headsign: 'Hbf', directionId: '0' } : {}),
    ...(p.stopovers ? { stopovers: p.stopovers } : {}),
  };
}

const bus15 = { key: 'bus:15:stadtwerke-muenster', name: '15', mode: 'BUS' as const };
const D = '2026-11-09';

function journey(id: string, legs: Leg[], transfers = 0): Journey {
  return {
    id,
    departure: legs[0].departure,
    arrival: legs[legs.length - 1].arrival,
    durationMin: Math.round((Date.parse(legs[legs.length - 1].arrival) - Date.parse(legs[0].departure)) / MIN),
    transfers,
    legs,
  };
}

/** Fußweg 6 Min. + Bus 15 */
function busJourney(id: string, walkStart: string, dep: string, arr: string, plannedDep = dep): Journey {
  return journey(id, [
    leg({ from: 'Weseler Straße 108', to: 'Weseler Straße', dep: at(D, walkStart), arr: at(D, dep) }),
    leg({ from: 'Weseler Straße', to: 'Hbf', dep: at(D, dep), arr: at(D, arr), planned: at(D, plannedDep), line: bus15, tripId: `t-${id}` }),
  ]);
}

describe('Verbindung wählen', () => {
  it('depart: kurz nach der Uhrzeit, früher zählt doppelt', () => {
    const js = [busJourney('a', '07:18', '07:24', '07:40'), busJourney('b', '07:27', '07:33', '07:49'), busJourney('c', '07:39', '07:45', '08:01')];
    expect(pickJourney(js.map((journey) => ({ journey })), at(D, '07:30'), 'depart')?.id).toBe('b');
    const close = [busJourney('early', '07:28', '07:34', '07:50'), busJourney('late', '07:36', '07:42', '07:58')];
    expect(pickJourney(close.map((journey) => ({ journey })), at(D, '07:30'), 'depart')?.id).toBe('early'); // 2 Min. früher < 6 Min. später
  });
  it('arrive: Ankunft möglichst knapp vor der Uhrzeit', () => {
    const js = [busJourney('a', '07:20', '07:26', '07:40'), busJourney('b', '07:35', '07:41', '07:55'), busJourney('c', '07:45', '07:51', '08:05')];
    expect(pickJourney(js.map((journey) => ({ journey })), at(D, '08:00'), 'arrive')?.id).toBe('b');
  });
  it('ausgefallene Verbindungen nur, wenn es nichts anderes gibt', () => {
    const js = [busJourney('x', '07:27', '07:33', '07:49'), busJourney('y', '07:39', '07:45', '08:01')];
    expect(pickJourney([{ journey: js[0], cancelled: true }, { journey: js[1] }], at(D, '07:30'), 'depart')?.id).toBe('y');
    expect(pickJourney([{ journey: js[0], cancelled: true }], at(D, '07:30'), 'depart')?.id).toBe('x');
    expect(pickJourney([], at(D, '07:30'), 'depart')).toBeNull();
  });
});

describe('Losgeh-Zeit', () => {
  it('erste Abfahrt (Echtzeit) − Fußweg − 1 Min. Puffer', () => {
    const j = busJourney('a', '07:36', '07:42', '07:58', '07:40'); // Bus 2 Min. verspätet
    const info = leaveInfo(j);
    expect(berlinClock(info.leaveAt)).toBe('07:35');
    expect(info.walkMin).toBe(6);
    expect(info.delayMin).toBe(2);
    expect(info.first?.line?.name).toBe('15');
  });
  it('ohne Fußweg und ohne Echtzeit', () => {
    const j = journey('s', [leg({ from: 'A', to: 'B', dep: at(D, '07:42'), arr: at(D, '07:50'), line: bus15, realtime: false })]);
    const info = leaveInfo(j);
    expect(berlinClock(info.leaveAt)).toBe('07:41');
    expect(info.delayMin).toBeNull();
  });
  it('nur zu Fuß', () => {
    const j = journey('w', [leg({ from: 'A', to: 'B', dep: at(D, '07:40'), arr: at(D, '08:00') })]);
    const info = leaveInfo(j);
    expect(info.first).toBeNull();
    expect(berlinClock(info.leaveAt)).toBe('07:39');
  });
});

function planOf(j: Journey, extra: Partial<CommutePlan> = {}): CommutePlan {
  const info = leaveInfo(j);
  return {
    day: D,
    targetAt: iso(at(D, '07:30')),
    journey: j,
    leaveAt: iso(info.leaveAt),
    firstLine: info.first?.line ?? null,
    firstDeparture: info.first?.departure ?? null,
    firstStop: info.first?.from ?? null,
    delayMin: info.delayMin,
    watchUntil: iso(Date.parse(j.arrival) + 15 * MIN),
    computedAt: iso(at(D, '06:00')),
    ...extra,
  };
}

describe('Erinnerung', () => {
  const plan = planOf(busJourney('a', '07:36', '07:42', '07:58', '07:40')); // los um 07:35
  it('genau zur Minute: Losgehen − Vorlauf', () => {
    expect(decideReminder({ day: D }, plan, at(D, '07:24'), 10)).toBeNull();
    expect(decideReminder({ day: D }, plan, at(D, '07:25'), 10)).toBe('remind');
    expect(decideReminder({ day: D }, plan, at(D, '07:25'), null)).toBeNull(); // Erinnerung aus
  });
  it('nicht doppelt, eine Aktualisierung ab 3 Min. Verschiebung', () => {
    const reminded: NotifyState = { day: D, remindedAt: iso(at(D, '07:25')), leaveAt: plan.leaveAt, departure: plan.firstDeparture!, tripId: 't-a' };
    expect(decideReminder(reminded, plan, at(D, '07:27'), 10)).toBeNull();
    const shift2 = planOf(busJourney('a', '07:38', '07:44', '08:00', '07:40'));
    expect(decideReminder(reminded, shift2, at(D, '07:28'), 10)).toBeNull();
    const shift3 = planOf(busJourney('a', '07:39', '07:45', '08:01', '07:40'));
    expect(decideReminder(reminded, shift3, at(D, '07:28'), 10)).toBe('update');
    expect(decideReminder({ ...reminded, updateSentAt: iso(at(D, '07:28')) }, shift3, at(D, '07:30'), 10)).toBeNull();
    expect(decideReminder({ ...reminded, cancelSentAt: iso(at(D, '07:28')) }, shift3, at(D, '07:30'), 10)).toBeNull();
  });
  it('zu spät (erste Fahrt weg) → keine Erinnerung mehr', () => {
    expect(decideReminder({ day: D }, plan, at(D, '07:42'), 10)).toBeNull(); // Bus fährt gerade
    expect(decideReminder({ day: D }, plan, at(D, '07:38'), 10)).toBe('remind'); // spät, aber Bus noch nicht weg
  });
  it('Stand vom Vortag zählt nicht', () => {
    const old: NotifyState = { day: '2026-11-06', remindedAt: '2026-11-06T06:25:00Z' };
    expect(stateFor(old, D)).toEqual({ day: D });
    expect(stateFor({ day: D, remindedAt: 'x' }, D).remindedAt).toBe('x');
  });
  it('neu planen: 10 Min., heiße Phase 5 Min., nach der Abfahrt gar nicht', () => {
    const p = at(D, '06:30');
    expect(needsReplan(null, null, at(D, '06:30'), 10)).toBe(true);
    expect(needsReplan(plan, p, at(D, '06:35'), 10)).toBe(false);
    expect(needsReplan(plan, p, at(D, '06:40'), 10)).toBe(true);
    expect(needsReplan(plan, at(D, '07:20'), at(D, '07:22'), 10)).toBe(false);
    expect(needsReplan(plan, at(D, '07:20'), at(D, '07:25'), 10)).toBe(true);
    expect(needsReplan(plan, at(D, '07:20'), at(D, '07:43'), 10)).toBe(false);
  });
});

// --- Planen mit (gefälschtem) MOTIS ---------------------------------------------------------

function motisLeg(p: { mode: string; from: string; fromId?: string; to: string; toId?: string; start: string; end: string; sched?: string; line?: string; tripId?: string; cancelled?: boolean }): MotisLeg {
  return {
    mode: p.mode,
    from: { name: p.from, stopId: p.fromId, lat: 51.95, lon: 7.61 },
    to: { name: p.to, stopId: p.toId, lat: 51.96, lon: 7.63 },
    duration: (at(D, p.end) - at(D, p.start)) / 1000,
    startTime: iso(at(D, p.start)),
    endTime: iso(at(D, p.end)),
    scheduledStartTime: iso(at(D, p.sched ?? p.start)),
    scheduledEndTime: iso(at(D, p.end)),
    ...(p.line ? { routeShortName: p.line, agencyName: 'Stadtwerke Münster', tripId: p.tripId, realTime: true, headsign: 'Hbf', directionId: '1' } : {}),
    ...(p.cancelled ? { cancelled: true } : {}),
    intermediateStops: p.line ? [{ name: 'Mitte', stopId: 'de-DELFI_de:05515:40123:1:1', lat: 51.955, lon: 7.62 }] : undefined,
  };
}

function itin(walkStart: string, dep: string, arr: string, tripId: string, opts: { sched?: string; cancelled?: boolean } = {}): MotisItinerary {
  const legs = [
    motisLeg({ mode: 'WALK', from: 'START', to: 'Weseler Straße', toId: 'de-DELFI_de:05515:40456:1:2', start: walkStart, end: dep }),
    motisLeg({
      mode: 'BUS', from: 'Weseler Straße', fromId: 'de-DELFI_de:05515:40456:1:2', to: 'Münster Hbf', toId: 'de-DELFI_de:05515:41000:4:B1',
      start: dep, end: arr, sched: opts.sched, line: '15', tripId, cancelled: opts.cancelled,
    }),
  ];
  return { duration: (at(D, arr) - at(D, walkStart)) / 1000, startTime: legs[0].startTime, endTime: legs[1].endTime, transfers: 0, legs };
}

const home = { kind: 'ADDRESS' as const, id: 'geo:51.948454,7.614490', name: 'Weseler Straße 108', lat: 51.948454, lon: 7.61449 };
const hbf = { kind: 'STOP' as const, id: 'de-DELFI_de:05515:41000_G', name: 'Münster Hbf', lat: 51.9567, lon: 7.635 };

describe('Planen', () => {
  it('fragt ab 10 Min. vorher, wählt passend, ignoriert Ausfälle, merkt sich die Fahrten', async () => {
    const calls: Array<{ from: string; to: string; time?: string; arriveBy?: boolean }> = [];
    const motis = {
      plan: async (q: { from: string; to: string; time?: string; arriveBy?: boolean }): Promise<MotisPlanResponse> => {
        calls.push(q);
        return {
          itineraries: [
            itin('07:21', '07:27', '07:41', 'trip-a'),
            itin('07:27', '07:33', '07:47', 'trip-x', { cancelled: true }),
            itin('07:36', '07:42', '07:56', 'trip-b', { sched: '07:40' }),
          ],
        };
      },
    };
    const occ = activeOccurrence(weekdays, at(D, '06:30'))!;
    const res = await planOccurrence(motis, { from: home, to: hbf, timeMode: 'depart' }, occ, at(D, '06:30'));
    expect(calls[0]).toMatchObject({ from: '51.948454,7.61449', to: 'de-DELFI_de:05515:41000_G', arriveBy: false, time: iso(at(D, '07:20')) });
    // 07:21 (9 Min. früher, ×2 = 18) vs. 07:33 ausgefallen vs. 07:36 (6 Min. später)
    expect(res?.plan.journey.legs[1].tripId).toBe('trip-b');
    expect(res?.plan.journey.legs[0].from.name).toBe('Weseler Straße 108'); // statt "START"
    expect(berlinClock(Date.parse(res!.plan.leaveAt))).toBe('07:35');
    expect(res?.plan.delayMin).toBe(2);
    expect(res?.plan.firstLine?.name).toBe('15');
    expect(res?.cancelledTrips.has('trip-x')).toBe(true);
    expect(res?.tripIds.has('trip-a')).toBe(true);
    // Für die DB ohne Geometrie
    expect(compactPlan(res!.plan).journey.legs.every((l) => !('geometry' in l))).toBe(true);
  });
  it('"Ankunft bis": nicht mehr erreichbar → nächste Verbindung ab jetzt', async () => {
    const calls: Array<{ arriveBy?: boolean; time?: string }> = [];
    const motis = {
      plan: async (q: { arriveBy?: boolean; time?: string }): Promise<MotisPlanResponse> => {
        calls.push(q);
        return { itineraries: q.arriveBy ? [itin('07:00', '07:06', '07:20', 'gone')] : [itin('07:40', '07:46', '08:00', 'next')] };
      },
    };
    const arrive: CommuteSchedule = { ...weekdays, time: '07:30', timeMode: 'arrive' };
    const occ = activeOccurrence(arrive, at(D, '07:20'))!;
    const res = await planOccurrence(motis, { from: home, to: hbf, timeMode: 'arrive' }, occ, at(D, '07:20'));
    expect(calls.map((c) => c.arriveBy)).toEqual([true, false]);
    expect(res?.plan.journey.legs[1].tripId).toBe('next');
  });
  it('automatische Trackings: je Fahrt, Halte als DHID, ab Fensterbeginn bis Ankunft + 10 Min.', async () => {
    const motis = { plan: async (): Promise<MotisPlanResponse> => ({ itineraries: [itin('07:36', '07:42', '07:56', 'trip-b')] }) };
    const occ = activeOccurrence(weekdays, at(D, '06:30'))!;
    const res = await planOccurrence(motis, { from: home, to: hbf, timeMode: 'depart' }, occ, at(D, '06:30'));
    const ts = desiredTrackings(res!.plan, occ);
    expect(ts).toHaveLength(1);
    expect(ts[0].leg.line?.key).toBe(bus15.key);
    expect(ts[0].stopIds).toEqual(['de:05515:40456', 'de:05515:40123', 'de:05515:41000']);
    expect(ts[0].startsAt.getTime()).toBe(occ.windowStart);
    expect(ts[0].endsAt.getTime()).toBe(at(D, '08:06'));
  });
  it('Ausfall der Fahrt erkennen (ganz oder am Einstiegshalt)', async () => {
    const trip = (cancelled: { trip?: boolean; stop?: boolean }) => ({
      trip: async (): Promise<MotisItinerary> => {
        const it = itin('07:36', '07:42', '07:56', 'trip-b');
        const bus = it.legs[1];
        if (cancelled.trip) bus.tripCancelled = true;
        if (cancelled.stop) bus.from.cancelled = true;
        return { ...it, legs: [bus] };
      },
    });
    expect(await tripCancelled(trip({ trip: true }), 'trip-b', null)).toBe(true);
    expect(await tripCancelled(trip({ stop: true }), 'trip-b', 'de-DELFI_de:05515:40456')).toBe(true);
    expect(await tripCancelled(trip({}), 'trip-b', 'de-DELFI_de:05515:40456')).toBe(false);
    expect(await tripCancelled({ trip: async () => Promise.reject(new Error('down')) }, 'trip-b', null)).toBe(false);
  });
});

describe('Pendler-Texte', () => {
  const plan = planOf(busJourney('a', '07:36', '07:42', '07:58', '07:40'));
  it('Zeit zu gehen (EN/DE) mit Verspätung und Fußweg', () => {
    const en = leaveNotice('en', 'To work', '7', { ...plan, firstStop: { id: 's', name: 'Weseler Straße (Münster)' } });
    expect(en.title).toBe('To work: time to leave');
    expect(en.message).toBe('Bus 15 at 07:42 from Weseler Straße (+2 min) · 6 min walk');
    expect(en.data).toMatchObject({ type: 'commute', event: 'leave', commuteId: '7', day: D, lineKey: bus15.key });
    const de = leaveNotice('de', 'Zur Arbeit', '7', plan);
    expect(de.title).toBe('Zur Arbeit: Zeit loszugehen');
    expect(de.message).toBe('Bus 15 um 07:42 ab Weseler Straße (+2 Min.) · 6 Min. Fußweg');
  });
  it('Aktualisierung und Ausfall', () => {
    expect(updateNotice('en', 'To work', '7', plan).message).toBe('Leave at 07:35 now: Bus 15 at 07:42 from Weseler Straße (+2 min)');
    const c = cancelNotice('de', 'Zur Arbeit', '7', 'Bus 15', plan);
    expect(c.title).toBe('Bus 15 fällt aus – Zur Arbeit');
    expect(c.message).toBe('Nächste Möglichkeit: Bus 15 um 07:42 ab Weseler Straße, los um 07:35');
    expect(cancelNotice('en', 'To work', '7', 'Bus 15', null).message).toContain('No alternative');
  });
  it('Linienbezeichnung', () => {
    expect(lineLabel('en', { name: '15', mode: 'BUS' })).toBe('Bus 15');
    expect(lineLabel('de', { name: '4', mode: 'TRAM' })).toBe('Tram 4');
    expect(lineLabel('de', { name: 'U8', mode: 'SUBWAY' })).toBe('U8');
    expect(lineLabel('de', { name: 'R22', mode: 'BUS' })).toBe('R22');
  });
  it('Alarm aus dem Pendler-Modus mit Namen der Strecke', () => {
    const report = {
      id: '1', kind: 'DELAY', lineKey: bus15.key, line: bus15, prevStop: { id: 'a', name: 'Weseler Straße' }, nextStop: null,
      reportedAt: new Date().toISOString(), tags: [], confirmations: 0, denials: 0,
    } as Report;
    expect(alertTexts(report, true, 'en', Date.now(), 'To work').title).toBe('To work: Delay on your section – 15');
    expect(alertTexts(report, false, 'de', Date.now(), null).title).toBe('Verspätung auf 15');
  });
});
