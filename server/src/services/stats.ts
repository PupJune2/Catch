// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Die "smarte" Auswertung der Meldungen einer Linie – reine Funktionen, gut testbar.
 */
import type { Hotspot, LineStats, Stop, TimeWindow } from '../contract.js';
import { canonicalStopId } from '../transit/mapping.js';
import { DEFAULT_LANG, kindWord, t, type Lang } from '../i18n.js';
import { REPORT_KINDS, type ReportKind } from '../contract.js';

export const TIME_ZONE = 'Europe/Berlin';
const MINUTES_PER_DAY = 1440;
/** Ab dieser Bündelung (0..1) ist eine Durchschnittszeit aussagekräftig. */
export const CONFIDENT = 0.35;

export interface StatReport {
  reportedAt: Date;
  prevStop: Stop | null;
  nextStop: Stop | null;
  directionId: string | null;
  headsign: string | null;
}

// --- Zeit-Hilfen --------------------------------------------------------------

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});
const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** Minuten seit Mitternacht (Ortszeit) und Wochentag (0 = Montag). */
export function localTime(d: Date): { minutes: number; weekday: number } {
  let hour = 0;
  let minute = 0;
  let weekday = 0;
  for (const p of partsFormatter.formatToParts(d)) {
    if (p.type === 'hour') hour = Number(p.value);
    else if (p.type === 'minute') minute = Number(p.value);
    else if (p.type === 'weekday') weekday = WEEKDAY_INDEX[p.value] ?? 0;
  }
  return { minutes: hour * 60 + minute, weekday };
}

export function formatHHMM(minutes: number): string {
  const m = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// --- Zirkulärer Mittelwert ------------------------------------------------------

/**
 * Durchschnittliche Uhrzeit auf dem 24-h-Kreis.
 * Ein normaler Mittelwert von 23:50 und 00:10 wäre 12:00 – falsch. Darum werden die
 * Uhrzeiten als Winkel betrachtet und als Vektoren gemittelt.
 *
 * confidence = Länge des mittleren Vektors (0 = gleichmäßig über den Tag verteilt,
 * 1 = alle zur selben Minute). spreadMinutes = zirkuläre Standardabweichung.
 */
export function circularMeanTime(minutesList: number[]): LineStats['averageTime'] {
  if (minutesList.length === 0) return null;
  let sumSin = 0;
  let sumCos = 0;
  for (const m of minutesList) {
    const a = (2 * Math.PI * m) / MINUTES_PER_DAY;
    sumSin += Math.sin(a);
    sumCos += Math.cos(a);
  }
  const n = minutesList.length;
  const r = Math.sqrt(sumSin ** 2 + sumCos ** 2) / n;
  if (r < 1e-9) return { time: '--:--', minutes: 0, confidence: 0, spreadMinutes: null };
  let angle = Math.atan2(sumSin, sumCos);
  if (angle < 0) angle += 2 * Math.PI;
  const minutes = Math.round((angle * MINUTES_PER_DAY) / (2 * Math.PI)) % MINUTES_PER_DAY;
  const spreadRad = Math.sqrt(-2 * Math.log(Math.min(1, r)));
  const spreadMinutes = Math.round((spreadRad * MINUTES_PER_DAY) / (2 * Math.PI));
  return {
    time: formatHHMM(minutes),
    minutes,
    confidence: Math.round(r * 100) / 100,
    spreadMinutes: spreadMinutes > 12 * 60 ? null : spreadMinutes,
  };
}

function confidentTime(minutes: number[]): string | null {
  const m = circularMeanTime(minutes);
  return m && (minutes.length < 3 || m.confidence >= CONFIDENT) ? m.time : null;
}

// --- Stoßzeiten -------------------------------------------------------------------

/**
 * Findet bis zu `max` nicht überlappende Zeitfenster (Standard 90 Min.) mit den meisten
 * Meldungen. Arbeitet auf 15-Minuten-Fächern und über Mitternacht hinweg.
 */
export function peakWindows(minutesList: number[], opts: { windowMinutes?: number; max?: number } = {}): TimeWindow[] {
  const total = minutesList.length;
  if (total === 0) return [];
  const bin = 15;
  const bins = MINUTES_PER_DAY / bin; // 96
  const width = Math.max(1, Math.round((opts.windowMinutes ?? 90) / bin));
  const max = opts.max ?? 2;
  const hist = new Array<number>(bins).fill(0);
  for (const m of minutesList) hist[Math.floor((((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY) / bin)]++;

  const sums = hist.map((_, start) => {
    let s = 0;
    for (let k = 0; k < width; k++) s += hist[(start + k) % bins];
    return s;
  });

  const used = new Array<boolean>(bins).fill(false);
  const result: TimeWindow[] = [];
  while (result.length < max) {
    let best = -1;
    for (let start = 0; start < bins; start++) {
      let free = true;
      for (let k = 0; k < width; k++) if (used[(start + k) % bins]) free = false;
      if (!free) continue;
      if (best === -1 || sums[start] > sums[best]) best = start;
    }
    if (best === -1) break;
    const count = sums[best];
    const first = result[0];
    // Zweites Fenster nur, wenn es wirklich auffällt
    if (count === 0 || (first && (count < 2 || count < first.count * 0.35))) break;

    // Fenster auf die tatsächlich belegten Fächer zuschneiden
    let lo = 0;
    let hi = width - 1;
    while (lo < hi && hist[(best + lo) % bins] === 0) lo++;
    while (hi > lo && hist[(best + hi) % bins] === 0) hi--;
    for (let k = 0; k < width; k++) used[(best + k) % bins] = true;
    result.push({
      from: formatHHMM((best + lo) * bin),
      to: formatHHMM((best + hi + 1) * bin),
      count,
      share: Math.round((count / total) * 100) / 100,
    });
  }
  return result;
}

// --- Hotspots -----------------------------------------------------------------------

/**
 * Häufigste Abschnitte. A→B und B→A zählen als derselbe Abschnitt ("zwischen A und B").
 * Haltestellen werden feed-übergreifend über ihre DHID verglichen.
 */
export function hotspots(reports: StatReport[], max = 5): Hotspot[] {
  const groups = new Map<string, { a: Stop | null; b: Stop | null; times: number[]; last: Date; count: number }>();
  for (const r of reports) {
    const ka = canonicalStopId(r.prevStop?.id) ?? '';
    const kb = canonicalStopId(r.nextStop?.id) ?? '';
    const [first, second] = ka <= kb ? [ka, kb] : [kb, ka];
    const key = `${first}|${second}`;
    let g = groups.get(key);
    if (!g) {
      const [a, b] = ka <= kb ? [r.prevStop, r.nextStop] : [r.nextStop, r.prevStop];
      g = { a, b, times: [], last: r.reportedAt, count: 0 };
      groups.set(key, g);
    }
    g.count++;
    g.times.push(localTime(r.reportedAt).minutes);
    if (r.reportedAt > g.last) g.last = r.reportedAt;
  }
  return [...groups.values()]
    .sort((x, y) => y.count - x.count || y.last.getTime() - x.last.getTime())
    .slice(0, max)
    .map((g) => {
      // Reihenfolge so, dass ein vorhandener Halt zuerst kommt
      const [stopA, stopB] = g.a ? [g.a, g.b] : [g.b, g.a];
      return {
        stopA: stopA ? publicStop(stopA) : null,
        stopB: stopB ? publicStop(stopB) : null,
        count: g.count,
        // Bei stark gestreuten Zeiten (z. B. morgens UND abends) wäre ein Mittelwert irreführend
        averageTime: confidentTime(g.times),
        lastReportAt: g.last.toISOString(),
      };
    });
}

function publicStop(s: Stop): Stop {
  const out: Stop = { id: s.id, name: s.name };
  if (s.lat !== undefined) out.lat = s.lat;
  if (s.lon !== undefined) out.lon = s.lon;
  return out;
}

export function topStops(reports: StatReport[], max = 5): Array<{ stop: Stop; count: number }> {
  const counts = new Map<string, { stop: Stop; count: number }>();
  for (const r of reports) {
    const seen = new Set<string>();
    for (const s of [r.prevStop, r.nextStop]) {
      const k = canonicalStopId(s?.id);
      if (!s || !k || seen.has(k)) continue;
      seen.add(k);
      const e = counts.get(k) ?? { stop: publicStop(s), count: 0 };
      e.count++;
      counts.set(k, e);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, max);
}

// --- Zusammenfassung ---------------------------------------------------------------

export function shortStopName(name: string): string {
  // "U Kottbusser Tor (Berlin)" → "Kottbusser Tor"
  return name
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/^(S\+U|U|S|Bhf\.?|Bf\.?)\s+/, '')
    .trim();
}

export function buildInsight(
  s: Pick<LineStats, 'total' | 'averageTime' | 'peakWindows' | 'hotspots' | 'days' | 'recentCount'> & { kind?: ReportKind | null },
  lang: Lang = DEFAULT_LANG,
): string {
  const kind = s.kind ?? null;
  if (s.total === 0) return t(lang, 'insight_none', { days: s.days, what: kindWord(lang, kind, false) });
  const parts: string[] = [];
  if (s.recentCount > 0) parts.push(t(lang, 'insight_active', { count: s.recentCount }));
  if (s.total < 3) {
    parts.push(t(lang, 'insight_too_few', { count: s.total, days: s.days }));
    return parts.join(' ');
  }
  const peak = s.peakWindows[0];
  const second = s.peakWindows[1];
  if (s.averageTime && s.averageTime.confidence >= CONFIDENT && peak) {
    parts.push(t(lang, 'insight_mostly', { What: kindWord(lang, kind), time: s.averageTime.time, from: peak.from, to: peak.to }));
  } else if (peak && second && peak.share + second.share >= 0.5) {
    const [a, b] = [peak, second].sort((x, y) => x.from.localeCompare(y.from));
    parts.push(t(lang, 'insight_two_peaks', { aFrom: a.from, aTo: a.to, bFrom: b.from, bTo: b.to }));
  } else if (peak && peak.share >= 0.3) {
    parts.push(t(lang, 'insight_peak', { from: peak.from, to: peak.to }));
  } else {
    parts.push(t(lang, 'insight_spread'));
  }
  const top = s.hotspots[0];
  if (top && top.count >= 2) {
    const names = [top.stopA, top.stopB].filter((x): x is Stop => !!x).map((x) => shortStopName(x.name));
    parts.push(
      names.length === 2
        ? t(lang, 'insight_hotspot_between', { a: names[0], b: names[1], count: top.count })
        : t(lang, 'insight_hotspot_at', { a: names[0], count: top.count }),
    );
  }
  return parts.join(' ');
}

/** Komplette Statistik aus den Meldungen eines Zeitraums. */
export function computeLineStats(
  reports: StatReport[],
  meta: {
    lineKey: string;
    days: number;
    recentMinutes: number;
    frequentThreshold: number;
    now?: Date;
    lang?: Lang;
    /** Für welche Art ausgewertet wird (null = alle) – steuert die Formulierung. */
    kind?: ReportKind | null;
    /** Anzahl je Art (für Filter-Chips); fehlt sie, wird sie aus den Meldungen gezählt. */
    byKind?: Record<ReportKind, number>;
  },
): Omit<LineStats, 'line'> {
  const now = meta.now ?? new Date();
  const recentFrom = now.getTime() - meta.recentMinutes * 60_000;
  const byHour = new Array<number>(24).fill(0);
  const byWeekday = new Array<number>(7).fill(0);
  const minutesList: number[] = [];
  let last: Date | null = null;
  let recentCount = 0;
  const dirs = new Map<string, { directionId: string | null; headsign: string | null; count: number }>();

  for (const r of reports) {
    const lt = localTime(r.reportedAt);
    minutesList.push(lt.minutes);
    byHour[Math.floor(lt.minutes / 60)]++;
    byWeekday[lt.weekday]++;
    if (!last || r.reportedAt > last) last = r.reportedAt;
    if (r.reportedAt.getTime() >= recentFrom) recentCount++;
    const dk = r.directionId ?? r.headsign ?? '?';
    const d = dirs.get(dk) ?? { directionId: r.directionId, headsign: r.headsign, count: 0 };
    d.count++;
    dirs.set(dk, d);
  }

  const total = reports.length;
  const averageTime = circularMeanTime(minutesList);
  const windows = peakWindows(minutesList);
  const spots = hotspots(reports);
  const level = recentCount > 0 ? 'active' : total >= meta.frequentThreshold ? 'frequent' : 'calm';
  const byKind = meta.byKind ?? (Object.fromEntries(REPORT_KINDS.map((k) => [k, 0])) as Record<ReportKind, number>);
  const base = {
    lineKey: meta.lineKey,
    kind: meta.kind ?? null,
    byKind,
    days: meta.days,
    total,
    recentCount,
    lastReportAt: last ? last.toISOString() : null,
    level,
    averageTime,
    peakWindows: windows,
    byHour,
    byWeekday,
    hotspots: spots,
    topStops: topStops(reports),
    directions: [...dirs.values()].sort((a, b) => b.count - a.count),
  } satisfies Omit<LineStats, 'line' | 'insight'>;
  return { ...base, insight: buildInsight(base, meta.lang) };
}
