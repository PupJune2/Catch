// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Offline-Routenplanung in der App: wählt das passende heruntergeladene Paket, lädt es bei
 * Bedarf (höchstens 2 vorbereitete Pakete im Speicher – sie sind groß) und rechnet mit
 * raptor.ts. Ergebnis sind normale Journey-Objekte mit `offline: true` (Fahrplan, ohne Echtzeit).
 */
import { geoPlaceId, type Journey, type OfflinePackage, type Place, type PlaceKind } from '@/api/contract';
import { shortStopName } from '@/lib/format';
import {
  berlinMidnight,
  endpointsNear,
  endpointsOfGroup,
  haversineM,
  planOffline,
  preparePackage,
  searchStops,
  type Endpoint,
  type PlaceGroup,
  type PointLabel,
  type PreparedPackage,
} from './raptor';
import { offlineStorage, regionCovers, regionDaysLeft, type InstalledRegion } from './storage';

/** Start/Ziel – wie `Place` aus der Suche (Haltestelle, Adresse, Ort, Zuhause, Standort). */
export interface PlaceLike {
  kind: PlaceKind;
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export type OfflineFailure =
  /** kein heruntergeladenes Paket deckt Start und Ziel ab */
  | 'no_package'
  /** Start und Ziel liegen in verschiedenen Paketen */
  | 'different_packages'
  /** Paket abgelaufen */
  | 'expired'
  /** gewählter Tag liegt außerhalb der Gültigkeit */
  | 'out_of_range'
  /** keine Haltestelle in Gehweite von Start oder Ziel */
  | 'no_stops'
  /** im Fahrplan keine Verbindung gefunden */
  | 'no_connection'
  /** Paket konnte nicht gelesen werden */
  | 'load_failed';

export type OfflinePlanResult =
  | { ok: true; journeys: Journey[]; region: InstalledRegion }
  | { ok: false; reason: OfflineFailure; region?: InstalledRegion };

/** Haltestellen: Gruppen mit passendem Namen in diesem Umkreis zählen als "dieselbe Haltestelle". */
const STOP_MATCH_M = 400;
/** Adressen/Orte: Haltestellen in Gehweite */
const WALK_M = 1200;
const MAX_PREPARED = 2;

/** Erst den Spinner zeichnen lassen, dann rechnen (Rechnen blockiert den JS-Thread). */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      setTimeout(resolve, 0);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
    setTimeout(go, 50);
  });
}

// ---------------------------------------------------------------------------
// Pakete laden (mit kleinem Cache)
// ---------------------------------------------------------------------------

/** Einfügereihenfolge = zuletzt benutzt am Ende */
const prepared = new Map<string, { builtAt: string; promise: Promise<PreparedPackage> }>();
/** Haltestellen-Gruppen je Paket für die Suche (klein, bleibt auch nach dem Verdrängen des Pakets) */
const stopIndex = new Map<string, { builtAt: string; groups: PlaceGroup[] }>();

function loadPrepared(region: InstalledRegion): Promise<PreparedPackage> {
  const hit = prepared.get(region.id);
  if (hit && hit.builtAt === region.builtAt) {
    prepared.delete(region.id);
    prepared.set(region.id, hit);
    return hit.promise;
  }
  const promise = (async () => {
    await yieldToUi();
    const text = await offlineStorage.read(region.id);
    if (!text) {
      // Datei fehlt (z. B. vom System/Nutzer gelöscht) → nicht mehr als installiert führen
      await offlineStorage.remove(region.id).catch(() => undefined);
      throw new Error('offline package missing');
    }
    await yieldToUi();
    const pkg = JSON.parse(text) as OfflinePackage;
    const pp = preparePackage(pkg);
    stopIndex.set(region.id, { builtAt: region.builtAt, groups: pp.groups });
    return pp;
  })();
  prepared.set(region.id, { builtAt: region.builtAt, promise });
  promise.catch(() => {
    if (prepared.get(region.id)?.promise === promise) prepared.delete(region.id);
  });
  while (prepared.size > MAX_PREPARED) {
    const oldest = prepared.keys().next().value;
    if (oldest === undefined) break;
    prepared.delete(oldest);
  }
  return promise;
}

async function stopGroupsOf(region: InstalledRegion): Promise<PlaceGroup[]> {
  const idx = stopIndex.get(region.id);
  if (idx && idx.builtAt === region.builtAt) return idx.groups;
  return (await loadPrepared(region)).groups;
}

// ---------------------------------------------------------------------------
// Paket-Auswahl
// ---------------------------------------------------------------------------

export function listInstalled(): Promise<InstalledRegion[]> {
  return offlineStorage.ensureLoaded();
}

/** Pakete, die den Punkt abdecken – kleinstes Gebiet zuerst (ohne ein Paket zu laden). */
export async function findPackagesFor(lat: number, lon: number): Promise<InstalledRegion[]> {
  const installed = await offlineStorage.ensureLoaded();
  return installed.filter((r) => regionCovers(r, lat, lon)).sort((a, b) => a.radiusKm - b.radiusKm);
}

export async function findPackageFor(lat: number, lon: number): Promise<InstalledRegion | null> {
  return (await findPackagesFor(lat, lon))[0] ?? null;
}

type RegionPick = { ok: true; region: InstalledRegion } | { ok: false; reason: OfflineFailure; region?: InstalledRegion };

function pickRegion(installed: InstalledRegion[], a: PlaceLike, b: PlaceLike, now = Date.now()): RegionPick {
  const both = installed
    .filter((r) => regionCovers(r, a.lat, a.lon) && regionCovers(r, b.lat, b.lon))
    // Gültige vor abgelaufenen, dann das kleinste Gebiet (schneller, genauer)
    .sort((x, y) => Number(regionDaysLeft(x, now) < 0) - Number(regionDaysLeft(y, now) < 0) || x.radiusKm - y.radiusKm);
  if (both.length) {
    const region = both[0];
    return regionDaysLeft(region, now) < 0 ? { ok: false, reason: 'expired', region } : { ok: true, region };
  }
  const fromAny = installed.some((r) => regionCovers(r, a.lat, a.lon));
  const toAny = installed.some((r) => regionCovers(r, b.lat, b.lon));
  return { ok: false, reason: fromAny && toAny ? 'different_packages' : 'no_package' };
}

/** Deckt ein installiertes Paket Start und Ziel ab? (schnell, ohne zu laden) */
export function canPlanOffline(a: PlaceLike, b: PlaceLike): boolean {
  return pickRegion(offlineStorage.list(), a, b).ok;
}

// ---------------------------------------------------------------------------
// Start/Ziel → Halte im Paket
// ---------------------------------------------------------------------------

function matchStopGroups(pp: PreparedPackage, place: PlaceLike): PlaceGroup[] {
  const names = [...new Set([place.name, shortStopName(place.name)])];
  for (const n of names) {
    const hits = searchStops(pp, n, 40).filter((g) => haversineM(g.lat, g.lon, place.lat, place.lon) <= STOP_MATCH_M);
    if (hits.length) return hits;
  }
  return [];
}

function endpointsFor(pp: PreparedPackage, place: PlaceLike): { eps: Endpoint[]; label: PointLabel } {
  const label: PointLabel = { name: place.name, lat: place.lat, lon: place.lon };
  if (place.kind === 'STOP') {
    // Haltestelle aus der Online-Suche oder der Offline-Suche: gleiche Station im Paket
    const groups = matchStopGroups(pp, place);
    if (groups.length) return { eps: groups.flatMap(endpointsOfGroup), label };
    const near = endpointsNear(pp, place.lat, place.lon, STOP_MATCH_M);
    if (near.length) return { eps: near, label };
  }
  // Adresse, Ort, Zuhause, aktueller Standort: Halte in Gehweite (mit Fußweg)
  return { eps: endpointsNear(pp, place.lat, place.lon, WALK_M), label };
}

// ---------------------------------------------------------------------------
// Planen
// ---------------------------------------------------------------------------

export interface OfflinePlanOptions {
  /** Ankunft statt Abfahrt (RAPTOR sucht vorwärts → mehrere Zeitfenster davor) */
  arriveBy?: boolean;
  /** "Früher"/"Später" ab vorhandenen Ergebnissen */
  page?: { dir: 'earlier' | 'later'; journeys: Journey[] };
  count?: number;
}

const depMs = (j: Journey) => Date.parse(j.departure);
const arrMs = (j: Journey) => Date.parse(j.arrival);

function uniqueSorted(list: Journey[]): Journey[] {
  const seen = new Set<string>();
  return list
    .filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)))
    .sort((a, b) => depMs(a) - depMs(b) || arrMs(a) - arrMs(b));
}

/**
 * Verbindungen offline berechnen. `timeMs` = gewünschte Abfahrt (bzw. Ankunft bei arriveBy).
 * Liefert Journeys oder einen Grund, warum es offline nicht geht.
 */
export async function planOfflineJourneys(
  from: PlaceLike,
  to: PlaceLike,
  timeMs: number,
  opts: OfflinePlanOptions = {},
): Promise<OfflinePlanResult> {
  const count = opts.count ?? 5;
  const installed = await offlineStorage.ensureLoaded();
  const pick = pickRegion(installed, from, to);
  if (!pick.ok) return pick;
  const region = pick.region;

  const firstMs = berlinMidnight(region.validFrom);
  const endMs = berlinMidnight(region.validFrom, region.days);
  if (timeMs >= endMs || timeMs < firstMs - 6 * 3600_000) return { ok: false, reason: 'out_of_range', region };

  let pp: PreparedPackage;
  try {
    pp = await loadPrepared(region);
  } catch {
    return { ok: false, reason: 'load_failed', region };
  }
  await yieldToUi();

  const a = endpointsFor(pp, from);
  const b = endpointsFor(pp, to);
  if (!a.eps.length || !b.eps.length) return { ok: false, reason: 'no_stops', region };
  const run = (t: number, n = count) => planOffline(pp, a.eps, b.eps, Math.max(t, firstMs), { count: n, fromLabel: a.label, toLabel: b.label });

  let journeys: Journey[] = [];
  const page = opts.page;
  if (page && page.journeys.length) {
    const shown = new Set(page.journeys.map((j) => j.id));
    if (page.dir === 'later') {
      const last = Math.max(...page.journeys.map(depMs));
      journeys = run(last + 60_000).filter((j) => !shown.has(j.id));
    } else {
      const first = Math.min(...page.journeys.map(depMs));
      for (const backMin of [60, 180]) {
        const found = run(first - backMin * 60_000, count + 3).filter((j) => depMs(j) < first && !shown.has(j.id));
        if (found.length) {
          journeys = found.slice(-count);
          break;
        }
      }
    }
  } else if (opts.arriveBy) {
    // Rückwärts in Zeitfenstern: Verbindungen, die rechtzeitig ankommen – die spätesten zuerst gewinnen
    let found: Journey[] = [];
    for (const backMin of [45, 120, 240]) {
      found = uniqueSorted([...found, ...run(timeMs - backMin * 60_000, count + 3).filter((j) => arrMs(j) <= timeMs)]);
      if (found.length >= 3) break;
    }
    journeys = found.slice(-count);
  } else {
    journeys = run(timeMs);
  }

  journeys = uniqueSorted(journeys);
  if (!journeys.length) return { ok: false, reason: 'no_connection', region };
  return { ok: true, journeys, region };
}

// ---------------------------------------------------------------------------
// Haltestellen-Suche ohne Internet (für den Von/Nach-Picker)
// ---------------------------------------------------------------------------

/**
 * Haltestellen in allen installierten Paketen. Ergebnis als `Place` (kind STOP, id "geo:lat,lon",
 * damit derselbe Ort später auch online geplant werden kann). `detail` = Name des Pakets.
 */
export async function searchOfflineStops(query: string, near?: { lat: number; lon: number } | null, limit = 12): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const installed = await offlineStorage.ensureLoaded();
  if (!installed.length) return [];
  // Paket am eigenen Standort zuerst
  const regions = [...installed].sort((x, y) => {
    if (!near) return 0;
    return Number(!regionCovers(x, near.lat, near.lon)) - Number(!regionCovers(y, near.lat, near.lon)) || x.radiusKm - y.radiusKm;
  });
  const out: Place[] = [];
  const seen = new Set<string>();
  for (const region of regions) {
    let groups: PlaceGroup[];
    try {
      groups = await stopGroupsOf(region);
    } catch {
      continue;
    }
    for (const g of searchStops({ groups }, q, limit)) {
      // Überlappende Pakete (z. B. Düsseldorf/Ruhr) liefern dieselbe Station mehrfach
      const key = `${g.name.toLowerCase()}|${g.lat.toFixed(3)}|${g.lon.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const place: Place = { kind: 'STOP', id: geoPlaceId(g.lat, g.lon), name: g.name, detail: region.name, lat: g.lat, lon: g.lon, modes: g.modes };
      if (near) place.distance = haversineM(near.lat, near.lon, g.lat, g.lon);
      out.push(place);
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

/** Cache leeren (z. B. nach dem Löschen eines Pakets, um Speicher freizugeben). */
export function forgetPrepared(id?: string) {
  if (id) {
    prepared.delete(id);
    stopIndex.delete(id);
  } else {
    prepared.clear();
    stopIndex.clear();
  }
}
