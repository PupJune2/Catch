// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Daten für das Homescreen-Widget: nächste Abfahrten an der gewählten Haltestelle und die
 * Hinweis-Lage der hervorgehobenen Linie. Läuft im Widget-Task (Headless JS) und in der App.
 *
 *  - GET /v1/departures?stopId=…&n=12 (ohne Login; enthält `summary` je Linie)
 *  - fehlt die hervorgehobene Linie in diesen Abfahrten: GET /v1/lines/:key/stats (+ neuester
 *    Hinweis, falls gerade etwas gemeldet wurde)
 *  - letzter Erfolg wird zwischengespeichert ("catch.widget.cache.v1"), damit das Widget ohne
 *    Netz die (noch kommenden) Abfahrten des letzten Stands zeigen kann.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ActivityLevel, Departure, LineStats, Report, ReportKind, ReportSummary, Stop } from '@/api/contract';
import { API_URL } from '@/config';
import type { Lang } from '@/i18n';
import type { WidgetConfig, WidgetLine } from './config';

const CACHE_KEY = 'catch.widget.cache.v1';
const LANG_KEY = 'catch.lang';
const TIMEOUT_MS = 12_000;
/** So viele Abfahrten laden – mehr als angezeigt, damit die hervorgehobene Linie oft dabei ist. */
const FETCH_N = 12;

export interface WidgetDeparture {
  tripId: string;
  plannedTime: string;
  time: string;
  delayMin: number | null;
  realtime: boolean;
  cancelled: boolean;
  line: WidgetLine;
  headsign: string;
  track?: string;
  plannedTrack?: string;
  level: ActivityLevel;
  /** Art des neuesten Hinweises, wenn auf der Linie gerade (60 Min.) etwas gemeldet wurde */
  activeKind: ReportKind | null;
}

export interface WidgetLineStatus {
  line: WidgetLine;
  level: ActivityLevel;
  lastKind: ReportKind | null;
  lastReportAt: string | null;
  recentCount: number;
}

export interface WidgetSnapshot {
  stopId: string;
  stopName: string;
  fetchedAt: string;
  departures: WidgetDeparture[];
  lineStatus: WidgetLineStatus | null;
}

/** App-Sprache aus dem Speicher (der Widget-Task hat keinen I18nProvider). */
export async function readLang(): Promise<Lang> {
  try {
    const v = await AsyncStorage.getItem(LANG_KEY);
    return v === 'de' ? 'de' : 'en';
  } catch {
    return 'en';
  }
}

async function getJson<T>(path: string, lang: Lang): Promise<T> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { Accept: 'application/json', 'Accept-Language': lang },
      signal: ctrl?.signal,
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function activeKindOf(s: ReportSummary | undefined): ReportKind | null {
  return s?.level === 'active' ? (s.lastKind ?? null) : null;
}

function compact(d: Departure): WidgetDeparture {
  return {
    tripId: d.tripId,
    plannedTime: d.plannedTime,
    time: d.time,
    delayMin: d.delayMin,
    realtime: d.realtime,
    cancelled: d.cancelled,
    line: { key: d.line.key, name: d.line.name, mode: d.line.mode, color: d.line.color, textColor: d.line.textColor },
    headsign: d.headsign,
    track: d.track,
    plannedTrack: d.plannedTrack,
    level: d.summary?.level ?? 'calm',
    activeKind: activeKindOf(d.summary),
  };
}

async function fetchLineStatus(line: WidgetLine, lang: Lang): Promise<WidgetLineStatus> {
  const key = encodeURIComponent(line.key);
  const stats = await getJson<LineStats>(`/v1/lines/${key}/stats?days=30`, lang);
  let lastKind: ReportKind | null = null;
  if (stats.level === 'active') {
    try {
      const r = await getJson<{ reports: Report[] }>(`/v1/lines/${key}/reports?days=1&limit=1`, lang);
      lastKind = r.reports[0]?.kind ?? null;
    } catch {
      lastKind = null;
    }
  }
  return { line, level: stats.level, lastKind, lastReportAt: stats.lastReportAt, recentCount: stats.recentCount };
}

/** Frische Daten vom Server. Wirft bei fehlendem Netz/Fehler. */
export async function fetchSnapshot(config: WidgetConfig, lang: Lang): Promise<WidgetSnapshot> {
  if (!config.stop) throw new Error('no_stop');
  const res = await getJson<{ stop: Stop | null; departures: Departure[] }>(
    `/v1/departures?stopId=${encodeURIComponent(config.stop.id)}&n=${FETCH_N}`,
    lang,
  );
  const departures = (res.departures ?? []).map(compact);
  let lineStatus: WidgetLineStatus | null = null;
  if (config.line) {
    const dep = (res.departures ?? []).find((d) => d.line.key === config.line?.key && d.summary);
    if (dep?.summary) {
      lineStatus = {
        line: config.line,
        level: dep.summary.level,
        lastKind: dep.summary.lastKind,
        lastReportAt: dep.summary.lastReportAt,
        recentCount: dep.summary.recentCount,
      };
    } else {
      // Linie fährt hier gerade nicht (oder ohne Lage) → Lage direkt abfragen; Fehler sind hier nicht schlimm
      lineStatus = await fetchLineStatus(config.line, lang).catch(() => null);
    }
  }
  const snap: WidgetSnapshot = {
    stopId: config.stop.id,
    stopName: config.stop.name || res.stop?.name || '',
    fetchedAt: new Date().toISOString(),
    departures,
    lineStatus,
  };
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(snap)).catch(() => undefined);
  return snap;
}

/** Letzter gespeicherter Stand – nur wenn er zur aktuellen Auswahl passt. */
export async function readCachedSnapshot(config: WidgetConfig): Promise<WidgetSnapshot | null> {
  if (!config.stop) return null;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as WidgetSnapshot;
    if (snap.stopId !== config.stop.id || !Array.isArray(snap.departures)) return null;
    // Andere Linie hervorgehoben als beim Speichern → deren Lage nicht zeigen
    if (snap.lineStatus && snap.lineStatus.line.key !== config.line?.key) snap.lineStatus = null;
    return snap;
  } catch {
    return null;
  }
}

/** Noch nicht abgefahrene Abfahrten (Prognose-Zeit, 1 Minute Kulanz). */
export function upcoming(departures: WidgetDeparture[], now: number): WidgetDeparture[] {
  return departures.filter((d) => new Date(d.time).getTime() > now - 60_000);
}
