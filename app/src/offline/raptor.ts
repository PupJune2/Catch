// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Offline-Routenplanung auf dem Gerät (RAPTOR, Delling/Pajor/Werneck 2012) auf einem
 * Fahrplanpaket von GET /v1/offline/regions/:id. Reines TypeScript – keine App-Abhängigkeiten,
 * damit es auch in Tests / Node läuft.
 *
 * Ergebnis sind normale `Journey`-Objekte (mit `offline: true`), die die vorhandene
 * Verbindungsansicht anzeigen kann. Ohne Echtzeit: Zeiten = Fahrplan.
 */
import type { Journey, Leg, Mode, OfflinePackage, Stop, Stopover } from '../api/contract';

// --- Zeitzone Europe/Berlin ohne Intl (Hermes-sicher) ---------------------------------------

function lastSundayUtc(year: number, month: number): number {
  const d = new Date(Date.UTC(year, month + 1, 0)); // letzter Tag des Monats
  return Date.UTC(year, month, d.getUTCDate() - d.getUTCDay(), 1); // 01:00 UTC
}

/** UTC-Versatz von Europe/Berlin in Millisekunden zu einem Zeitpunkt. */
export function berlinOffsetMs(utcMs: number): number {
  const y = new Date(utcMs).getUTCFullYear();
  const summer = utcMs >= lastSundayUtc(y, 2) && utcMs < lastSundayUtc(y, 9);
  return (summer ? 2 : 1) * 3600_000;
}

/** Lokale Mitternacht (Europe/Berlin) eines Tages "YYYY-MM-DD" + dayOffset als UTC-ms. */
export function berlinMidnight(ymd: string, dayOffset = 0): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d + dayOffset);
  return utcMidnight - berlinOffsetMs(utcMidnight - 3600_000);
}

// --- Vorbereitung ------------------------------------------------------------------------------

interface PatternData {
  stops: Int32Array;
  t0: Int32Array;
  prof: Int32Array;
  svc: Int32Array;
  route: Int32Array;
  head: Int32Array;
  /** größte Fahrzeit vom 1. bis zum letzten Halt (für die Suche nach dem frühesten Zug) */
  maxSpan: number;
}

export interface PlaceGroup {
  /** Anzeigename */
  name: string;
  lat: number;
  lon: number;
  /** alle Halte (Bahnsteige/Steige) dieser Station */
  stops: number[];
  modes: Mode[];
}

export interface PreparedPackage {
  pkg: OfflinePackage;
  regionId: string;
  lat: Float64Array;
  lon: Float64Array;
  patterns: PatternData[];
  /** je Halt: flach [Muster, Position, Muster, Position, …] */
  stopPatterns: Int32Array[];
  /** je Halt: flach [Ziel, Sekunden, …] */
  transfers: Int32Array[];
  arrOff: Int32Array[];
  depOff: Int32Array[];
  groups: PlaceGroup[];
  /** Halt → Gruppe */
  groupOf: Int32Array;
  firstDayMs: number;
  days: number;
}

const ALL_MODES: Mode[] = ['LONG_DISTANCE', 'REGIONAL', 'SUBURBAN', 'SUBWAY', 'TRAM', 'BUS', 'FERRY', 'OTHER'];

export function preparePackage(pkg: OfflinePackage): PreparedPackage {
  const n = pkg.stops.length;
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  pkg.stops.forEach((s, i) => {
    lat[i] = s[1] / 1e5;
    lon[i] = s[2] / 1e5;
  });

  // Fahrzeitprofile → kumulierte Ankunfts-/Abfahrtsversätze je Position
  const arrOff: Int32Array[] = [];
  const depOff: Int32Array[] = [];
  for (const p of pkg.profiles) {
    const len = p.length / 2 + 1;
    const a = new Int32Array(len);
    const d = new Int32Array(len);
    for (let i = 1; i < len; i++) {
      a[i] = d[i - 1] + p[2 * (i - 1)];
      d[i] = a[i] + p[2 * (i - 1) + 1];
    }
    arrOff.push(a);
    depOff.push(d);
  }

  const counts = new Int32Array(n);
  const stopModes: Set<Mode>[] = Array.from({ length: n }, () => new Set<Mode>());
  const patterns: PatternData[] = pkg.patterns.map((pt) => {
    const m = pt.trips.length;
    const t0 = new Int32Array(m);
    const prof = new Int32Array(m);
    const svc = new Int32Array(m);
    const route = new Int32Array(m);
    const head = new Int32Array(m);
    let maxSpan = 0;
    pt.trips.forEach((t, k) => {
      route[k] = t[0];
      head[k] = t[1];
      svc[k] = t[2];
      t0[k] = t[3];
      prof[k] = t[4];
      const off = depOff[t[4]];
      if (off && off[off.length - 1] > maxSpan) maxSpan = off[off.length - 1];
      const mode = pkg.routes[t[0]]?.[1];
      if (mode) for (const s of pt.stops) stopModes[s].add(mode as Mode);
    });
    for (const s of pt.stops) counts[s]++;
    return { stops: Int32Array.from(pt.stops), t0, prof, svc, route, head, maxSpan };
  });
  const stopPatterns: Int32Array[] = Array.from({ length: n }, (_, s) => new Int32Array(counts[s] * 2));
  const fill = new Int32Array(n);
  patterns.forEach((pt, pi) => {
    pt.stops.forEach((s, pos) => {
      stopPatterns[s][fill[s]++] = pi;
      stopPatterns[s][fill[s]++] = pos;
    });
  });

  const tCount = new Int32Array(n);
  for (const [a] of pkg.transfers) tCount[a]++;
  const transfers: Int32Array[] = Array.from({ length: n }, (_, s) => new Int32Array(tCount[s] * 2));
  const tFill = new Int32Array(n);
  for (const [a, b, sec] of pkg.transfers) {
    transfers[a][tFill[a]++] = b;
    transfers[a][tFill[a]++] = sec;
  }

  // Gruppen für die Suche: Station (Elternhaltestelle) oder gleicher Name in < 300 m
  const groups: PlaceGroup[] = [];
  const groupOf = new Int32Array(n).fill(-1);
  const byStation = new Map<number, number>();
  const byName = new Map<string, number[]>();
  pkg.stops.forEach((s, i) => {
    if (!pkg.patterns.length || stopPatterns[i].length === 0) return; // ohne Abfahrten nicht anbieten
    let g = -1;
    if (s[4] >= 0) g = byStation.get(s[4]) ?? -1;
    if (g < 0) {
      for (const cand of byName.get(s[0]) ?? []) {
        const gr = groups[cand];
        if (Math.abs(gr.lat - lat[i]) < 0.003 && Math.abs(gr.lon - lon[i]) < 0.0045) {
          g = cand;
          break;
        }
      }
    }
    if (g < 0) {
      g = groups.length;
      const st = s[4] >= 0 ? pkg.stations[s[4]] : null;
      groups.push({ name: st ? st[0] : s[0], lat: st ? st[1] / 1e5 : lat[i], lon: st ? st[2] / 1e5 : lon[i], stops: [], modes: [] });
      if (s[4] >= 0) byStation.set(s[4], g);
      const list = byName.get(s[0]) ?? [];
      list.push(g);
      byName.set(s[0], list);
    }
    groups[g].stops.push(i);
    groupOf[i] = g;
  });
  for (const gr of groups) {
    const ms = new Set<Mode>();
    for (const s of gr.stops) for (const m of stopModes[s]) ms.add(m);
    gr.modes = ALL_MODES.filter((m) => ms.has(m));
  }

  return {
    pkg,
    regionId: pkg.region.id,
    lat,
    lon,
    patterns,
    stopPatterns,
    transfers,
    arrOff,
    depOff,
    groups,
    groupOf,
    firstDayMs: berlinMidnight(pkg.validFrom),
    days: pkg.days,
  };
}

// --- Suche nach Haltestellen -------------------------------------------------------------------

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(hbf|hauptbf)\b/g, 'hauptbahnhof')
    .replace(/\bbf\b/g, 'bahnhof')
    .replace(/str\b\.?/g, 'strasse')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Haltestellen im Paket nach Namen (alle Wörter müssen vorkommen). */
export function searchStops(pp: Pick<PreparedPackage, 'groups'>, query: string, limit = 12): PlaceGroup[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const scored: Array<[number, PlaceGroup]> = [];
  for (const g of pp.groups) {
    const name = norm(g.name);
    if (!words.every((w) => name.includes(w))) continue;
    // Wortanfang > irgendwo; kürzere Namen und viele Linien zuerst
    const starts = words.filter((w) => name.startsWith(w) || name.includes(` ${w}`)).length;
    scored.push([starts * 100 - name.length + Math.min(g.stops.length, 10), g]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((x) => x[1]);
}

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

export interface Endpoint {
  stop: number;
  walkSec: number;
}

/** Halte in Gehweite einer Koordinate (z. B. "Zuhause"), mit Gehzeit. */
export function endpointsNear(pp: PreparedPackage, lat: number, lon: number, maxM = 1200, max = 25): Endpoint[] {
  const out: Array<Endpoint & { m: number }> = [];
  for (let i = 0; i < pp.lat.length; i++) {
    if (Math.abs(pp.lat[i] - lat) > 0.012 || Math.abs(pp.lon[i] - lon) > 0.018) continue;
    if (pp.stopPatterns[i].length === 0) continue;
    const m = haversineM(lat, lon, pp.lat[i], pp.lon[i]);
    if (m <= maxM) out.push({ stop: i, walkSec: Math.round((m * 1.3) / 1.2), m });
  }
  return out.sort((a, b) => a.m - b.m).slice(0, max).map(({ stop, walkSec }) => ({ stop, walkSec }));
}

/** Alle Halte einer Gruppe (Station) als Start/Ziel ohne Fußweg. */
export function endpointsOfGroup(g: PlaceGroup): Endpoint[] {
  return g.stops.map((stop) => ({ stop, walkSec: 0 }));
}

/** Liegt die Koordinate im Paket (für die automatische Auswahl)? */
export function covers(pp: PreparedPackage, lat: number, lon: number): boolean {
  return haversineM(lat, lon, pp.pkg.region.lat, pp.pkg.region.lon) <= pp.pkg.region.radiusKm * 1000 + 500;
}

// --- RAPTOR ------------------------------------------------------------------------------------

type Parent =
  | { k: 'access'; walkSec: number }
  | { k: 'ride'; p: number; trip: number; base: number; board: number; alight: number }
  | { k: 'walk'; from: number; sec: number };

interface RoundResult {
  arrival: number;
  rounds: number;
  target: Endpoint;
  labels: Float64Array[];
  parents: Array<Map<number, Parent>>;
}

const CHANGE_SEC = 60; // Mindestumstieg am selben Bahnsteig/Steig

function serviceOn(pp: PreparedPackage, svc: number, day: number): boolean {
  if (day < 0 || day >= pp.days) return false;
  return ((pp.pkg.services[svc] >>> day) & 1) === 1;
}

function dayIndex(pp: PreparedPackage, ms: number): number {
  return Math.floor((ms + berlinOffsetMs(ms) - (pp.firstDayMs + berlinOffsetMs(pp.firstDayMs))) / 86_400_000);
}

/** Frühester Zug des Musters, der an Position `pos` ab `minMs` abfährt (über Betriebstage). */
function earliestTrip(pp: PreparedPackage, p: number, pos: number, minMs: number): { trip: number; base: number; dep: number } | null {
  const pt = pp.patterns[p];
  const d = dayIndex(pp, minMs);
  let best: { trip: number; base: number; dep: number } | null = null;
  for (let sd = d - 1; sd <= d + 1; sd++) {
    if (sd < 0 || sd >= pp.days) continue;
    const base = berlinMidnight(pp.pkg.validFrom, sd);
    const minSec = (minMs - base) / 1000;
    // Binärsuche: erster Zug mit t0 >= minSec - maxSpan
    const lowT0 = minSec - pt.maxSpan;
    let lo = 0;
    let hi = pt.t0.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pt.t0[mid] < lowT0) lo = mid + 1;
      else hi = mid;
    }
    for (let k = lo; k < pt.t0.length; k++) {
      const depMs = base + (pt.t0[k] + pp.depOff[pt.prof[k]][pos]) * 1000;
      if (best && base + pt.t0[k] * 1000 >= best.dep) break; // alle weiteren fahren später ab
      if (depMs < minMs) continue;
      if (!serviceOn(pp, pt.svc[k], sd)) continue;
      if (!best || depMs < best.dep) best = { trip: k, base, dep: depMs };
    }
  }
  return best;
}

function raptor(pp: PreparedPackage, origins: Endpoint[], targets: Endpoint[], departMs: number, maxRides: number): RoundResult[] {
  const n = pp.lat.length;
  const labels: Float64Array[] = [];
  const parents: Array<Map<number, Parent>> = [];
  const best = new Float64Array(n).fill(Infinity);
  const targetWalk = new Map<number, number>();
  for (const t of targets) targetWalk.set(t.stop, Math.min(targetWalk.get(t.stop) ?? Infinity, t.walkSec));
  let bestTarget = Infinity;
  const results: RoundResult[] = [];

  const l0 = new Float64Array(n).fill(Infinity);
  const p0 = new Map<number, Parent>();
  let marked: number[] = [];
  for (const o of origins) {
    const t = departMs + o.walkSec * 1000;
    if (t < l0[o.stop]) {
      l0[o.stop] = t;
      best[o.stop] = t;
      p0.set(o.stop, { k: 'access', walkSec: o.walkSec });
      marked.push(o.stop);
    }
  }
  // Fußwege vom Start (z. B. anderer Bahnsteig derselben Station)
  for (const s of [...marked]) {
    const tr = pp.transfers[s];
    for (let j = 0; j < tr.length; j += 2) {
      const to = tr[j];
      const t = l0[s] + tr[j + 1] * 1000;
      if (t < l0[to]) {
        l0[to] = t;
        best[to] = t;
        p0.set(to, { k: 'walk', from: s, sec: tr[j + 1] });
        marked.push(to);
      }
    }
  }
  labels.push(l0);
  parents.push(p0);

  for (let k = 1; k <= maxRides && marked.length; k++) {
    const prev = labels[k - 1];
    const cur = Float64Array.from(prev);
    const par = new Map<number, Parent>();
    const queue = new Map<number, number>();
    for (const s of marked) {
      const sp = pp.stopPatterns[s];
      for (let j = 0; j < sp.length; j += 2) {
        const q = queue.get(sp[j]);
        if (q === undefined || sp[j + 1] < q) queue.set(sp[j], sp[j + 1]);
      }
    }
    const improved: number[] = [];
    for (const [p, start] of queue) {
      const pt = pp.patterns[p];
      let trip = -1;
      let base = 0;
      let board = -1;
      for (let i = start; i < pt.stops.length; i++) {
        const s = pt.stops[i];
        if (trip >= 0) {
          const arr = base + (pt.t0[trip] + pp.arrOff[pt.prof[trip]][i]) * 1000;
          if (arr < best[s] && arr < bestTarget) {
            cur[s] = arr;
            best[s] = arr;
            par.set(s, { k: 'ride', p, trip, base, board, alight: i });
            improved.push(s);
          }
        }
        const ready = prev[s];
        if (ready < Infinity) {
          const minDep = ready + (k > 1 ? CHANGE_SEC * 1000 : 0);
          const curDep = trip >= 0 ? base + (pt.t0[trip] + pp.depOff[pt.prof[trip]][i]) * 1000 : Infinity;
          if (minDep <= curDep) {
            const e = earliestTrip(pp, p, i, minDep);
            if (e && e.dep < curDep) {
              trip = e.trip;
              base = e.base;
              board = i;
            }
          }
        }
      }
    }
    // Fußwege von verbesserten Halten
    const next = new Set<number>(improved);
    for (const s of improved) {
      const tr = pp.transfers[s];
      for (let j = 0; j < tr.length; j += 2) {
        const to = tr[j];
        const t = cur[s] + tr[j + 1] * 1000;
        if (t < best[to] && t < bestTarget) {
          cur[to] = t;
          best[to] = t;
          par.set(to, { k: 'walk', from: s, sec: tr[j + 1] });
          next.add(to);
        }
      }
    }
    labels.push(cur);
    parents.push(par);
    marked = [...next];
    // Ziel erreicht?
    let roundBest: { arrival: number; target: Endpoint } | null = null;
    for (const [stop, walk] of targetWalk) {
      if (!par.has(stop)) continue;
      const arr = cur[stop] + walk * 1000;
      if (arr < bestTarget && (!roundBest || arr < roundBest.arrival)) roundBest = { arrival: arr, target: { stop, walkSec: walk } };
    }
    if (roundBest) {
      bestTarget = roundBest.arrival;
      results.push({ arrival: roundBest.arrival, rounds: k, target: roundBest.target, labels, parents });
    }
  }
  return results;
}

// --- Ergebnis in App-Format ---------------------------------------------------------------------

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function stopOf(pp: PreparedPackage, i: number): Stop {
  const s = pp.pkg.stops[i];
  return { id: `off:${pp.regionId}:${i}`, name: s[0], lat: pp.lat[i], lon: pp.lon[i] };
}

export interface PointLabel {
  name: string;
  lat: number;
  lon: number;
}

function buildJourney(
  pp: PreparedPackage,
  r: RoundResult,
  departMs: number,
  from: PointLabel | null,
  to: PointLabel | null,
): Journey | null {
  const legs: Leg[] = [];
  let k = r.rounds;
  let s = r.target.stop;
  let guard = 0;
  while (guard++ < 200) {
    const p = r.parents[k].get(s);
    if (!p) {
      if (k === 0) return null;
      k--;
      continue;
    }
    if (p.k === 'access') {
      if (p.walkSec > 0 && from) {
        const arr = r.labels[0][s];
        legs.unshift(walkLeg({ id: 'start', name: from.name, lat: from.lat, lon: from.lon }, stopOf(pp, s), arr - p.walkSec * 1000, arr, from, pp.lat[s], pp.lon[s]));
      }
      break;
    }
    if (p.k === 'walk') {
      const arr = r.labels[k][s];
      legs.unshift(walkLeg(stopOf(pp, p.from), stopOf(pp, s), arr - p.sec * 1000, arr));
      s = p.from;
      continue;
    }
    // Fahrt
    const pt = pp.patterns[p.p];
    const t0 = pt.t0[p.trip];
    const prof = pt.prof[p.trip];
    const route = pp.pkg.routes[pt.route[p.trip]];
    const stopovers: Stopover[] = [];
    for (let i = p.board; i <= p.alight; i++) {
      const si = pt.stops[i];
      const so: Stopover = { stop: stopOf(pp, si) };
      const a = iso(p.base + (t0 + pp.arrOff[prof][i]) * 1000);
      const d = iso(p.base + (t0 + pp.depOff[prof][i]) * 1000);
      if (i > p.board) so.plannedArrival = so.arrival = a;
      if (i < p.alight) so.plannedDeparture = so.departure = d;
      const track = pp.pkg.stops[si][3];
      if (track) so.track = so.plannedTrack = track;
      stopovers.push(so);
    }
    const dep = p.base + (t0 + pp.depOff[prof][p.board]) * 1000;
    const arr = p.base + (t0 + pp.arrOff[prof][p.alight]) * 1000;
    const fromIdx = pt.stops[p.board];
    const toIdx = pt.stops[p.alight];
    const mode = (route?.[1] ?? 'OTHER') as Mode;
    const leg: Leg = {
      mode,
      walking: false,
      from: stopOf(pp, fromIdx),
      to: stopOf(pp, toIdx),
      plannedDeparture: iso(dep),
      departure: iso(dep),
      plannedArrival: iso(arr),
      arrival: iso(arr),
      durationMin: Math.round((arr - dep) / 60_000),
      line: {
        key: `offline:${mode.toLowerCase()}:${(route?.[0] ?? '?').toLowerCase().replace(/\s+/g, '')}`,
        name: route?.[0] ?? '?',
        mode,
        ...(route?.[4] ? { operator: route[4] } : {}),
        ...(route?.[2] ? { color: route[2], textColor: route[3] || '#ffffff' } : {}),
        ...(route?.[5] === 1 ? { onDemand: true } : {}),
      },
      headsign: pp.pkg.headsigns[pt.head[p.trip]] ?? '',
      realtime: false,
      stopovers,
    };
    const ft = pp.pkg.stops[fromIdx][3];
    const tt = pp.pkg.stops[toIdx][3];
    if (ft) leg.fromTrack = leg.fromPlannedTrack = ft;
    if (tt) leg.toTrack = leg.toPlannedTrack = tt;
    legs.unshift(leg);
    s = fromIdx;
    k--;
  }
  if (!legs.some((l) => !l.walking)) return null;
  // Aufeinanderfolgende Fußwege zu einem zusammenfassen
  for (let i = legs.length - 1; i > 0; i--) {
    if (legs[i].walking && legs[i - 1].walking) {
      const a = legs[i - 1];
      const b = legs[i];
      legs.splice(i - 1, 2, {
        ...a,
        to: b.to,
        arrival: b.arrival,
        plannedArrival: b.plannedArrival,
        durationMin: Math.max(1, Math.round((Date.parse(b.arrival) - Date.parse(a.departure)) / 60_000)),
        distanceM: (a.distanceM ?? 0) + (b.distanceM ?? 0) || undefined,
      });
    }
  }
  // Zu Fuß vom Start: so losgehen, dass man pünktlich zur ersten Abfahrt da ist
  if (legs[0].walking && legs[1] && !legs[1].walking) {
    const endMs = Date.parse(legs[1].departure);
    const dur = (legs[0].durationMin ?? 1) * 60_000;
    legs[0] = { ...legs[0], departure: iso(endMs - dur), plannedDeparture: iso(endMs - dur), arrival: iso(endMs), plannedArrival: iso(endMs) };
  }
  // Fußweg zum Ziel
  if (r.target.walkSec > 0 && to) {
    const last = legs[legs.length - 1];
    const startMs = Date.parse(last.arrival);
    legs.push(walkLeg(last.to, { id: 'ziel', name: to.name, lat: to.lat, lon: to.lon }, startMs, startMs + r.target.walkSec * 1000));
  }
  const first = legs[0];
  const last = legs[legs.length - 1];
  const rides = legs.filter((l) => !l.walking).length;
  void departMs;
  return {
    id: `offline-${first.departure}-${legs.map((l) => (l.walking ? 'w' : l.line!.name)).join('-')}`,
    offline: true,
    departure: first.departure,
    arrival: last.arrival,
    durationMin: Math.round((Date.parse(last.arrival) - Date.parse(first.departure)) / 60_000),
    transfers: Math.max(0, rides - 1),
    legs,
  };
}

function walkLeg(from: Stop, to: Stop, startMs: number, endMs: number, point?: PointLabel, toLat?: number, toLon?: number): Leg {
  const leg: Leg = {
    mode: 'WALK',
    walking: true,
    from,
    to,
    plannedDeparture: iso(startMs),
    departure: iso(startMs),
    plannedArrival: iso(endMs),
    arrival: iso(endMs),
    durationMin: Math.max(1, Math.round((endMs - startMs) / 60_000)),
  };
  const fl = point?.lat ?? from.lat;
  const fo = point?.lon ?? from.lon;
  const tl = toLat ?? to.lat;
  const to2 = toLon ?? to.lon;
  if (fl !== undefined && fo !== undefined && tl !== undefined && to2 !== undefined) leg.distanceM = Math.round(haversineM(fl, fo, tl, to2) * 1.3);
  return leg;
}

export interface PlanOptions {
  /** Anzahl Verbindungen (Standard 5) */
  count?: number;
  /** höchstens so viele Fahrten (= Umstiege + 1), Standard 5 */
  maxRides?: number;
  /** Beschriftung, wenn Start/Ziel eine Adresse/Koordinate ist */
  fromLabel?: PointLabel;
  toLabel?: PointLabel;
}

/**
 * Verbindungen ab `departMs`. Liefert mehrere aufeinanderfolgende Verbindungen
 * (jeweils die schnellste und – falls langsamer, aber mit weniger Umstiegen – Alternativen).
 */
export function planOffline(pp: PreparedPackage, origins: Endpoint[], targets: Endpoint[], departMs: number, opts: PlanOptions = {}): Journey[] {
  const count = opts.count ?? 5;
  const maxRides = opts.maxRides ?? 5;
  const out: Journey[] = [];
  const seen = new Set<string>();
  let t = departMs;
  for (let run = 0; run < count * 2 && out.length < count; run++) {
    const results = raptor(pp, origins, targets, t, maxRides);
    if (!results.length) break;
    let earliestDep = Infinity;
    for (const r of results) {
      const j = buildJourney(pp, r, t, opts.fromLabel ?? null, opts.toLabel ?? null);
      if (!j) continue;
      const firstRide = j.legs.find((l) => !l.walking)!;
      earliestDep = Math.min(earliestDep, Date.parse(firstRide.departure));
      // Gleiche Fahrten = gleiche Verbindung (egal, wann man losgeht)
      const key = j.legs.filter((l) => !l.walking).map((l) => `${l.line?.name}@${l.departure}`).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(j);
    }
    if (!Number.isFinite(earliestDep)) break;
    // Nächster Lauf: kurz nach der Abfahrt der eben gefundenen Verbindung
    const accessWalk = Math.min(...origins.map((o) => o.walkSec)) * 1000;
    t = Math.max(t + 60_000, earliestDep - accessWalk + 60_000);
  }
  return out.sort((a, b) => Date.parse(a.departure) - Date.parse(b.departure) || Date.parse(a.arrival) - Date.parse(b.arrival)).slice(0, count);
}

/** Wie lange ist das Paket noch gültig? (Tage ab heute, 0 = läuft heute ab, < 0 = abgelaufen) */
export function daysLeft(pkg: Pick<OfflinePackage, 'validFrom' | 'days'>, nowMs = Date.now()): number {
  const last = berlinMidnight(pkg.validFrom, pkg.days - 1);
  return Math.floor((last - berlinMidnight(new Date(nowMs + berlinOffsetMs(nowMs)).toISOString().slice(0, 10))) / 86_400_000);
}
