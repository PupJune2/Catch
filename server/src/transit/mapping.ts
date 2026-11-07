// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/** Umwandlung der MOTIS-Rohdaten in das App-Format (contract.ts). */
import { geoPlaceId, type Departure, type Journey, type Leg, type Line, type MapStop, type Mode, type Place, type Stop, type Stopover, type Trip } from '../contract.js';
import { makeLineKey, mapMode } from './lineKey.js';
import type { MotisGeocodeMatch, MotisItinerary, MotisLeg, MotisMapStop, MotisPlace, MotisRouteInfo, MotisStopTime } from './motis.js';

/** Stations-ID (Elternhaltestelle statt einzelnem Gleis/Steig). */
export function stationId(p: Pick<MotisPlace, 'stopId' | 'parentId'>): string {
  return p.parentId || stripPlatform(p.stopId ?? '');
}

function stripPlatform(id: string): string {
  return id.replace(/::\d+$/, '');
}

/**
 * Feed-übergreifender Schlüssel einer Haltestelle für Vergleiche.
 * Deutsche Haltestellen haben eine DHID (z. B. "de:11000:900013102"), die in allen
 * GTFS-Feeds gleich ist – MOTIS stellt aber den Feed-Namen voran ("de-VBB_…", "de-DELFI_…").
 */
export function canonicalStopId(id: string | null | undefined): string | null {
  if (!id) return null;
  const dhid = /(?:^|_)((?:de|at|ch):\d{3,5}:\d+)/.exec(id);
  if (dhid) return dhid[1];
  return stripPlatform(id);
}

/** "U Kottbusser Tor (Berlin)" bleibt so – der Ort in Klammern hilft bei gleichnamigen Halten. */
export function stopFromPlace(p: MotisPlace): Stop {
  return {
    id: stationId(p),
    name: p.name,
    lat: round6(p.lat),
    lon: round6(p.lon),
    ...(p.modes ? { modes: uniqueModes(p.modes) } : {}),
  };
}

export function stopFromGeocode(m: MotisGeocodeMatch, origin?: { lat: number; lon: number }): Stop {
  const stop: Stop = { id: m.id, name: m.name, lat: round6(m.lat), lon: round6(m.lon) };
  if (m.modes) stop.modes = uniqueModes(m.modes);
  if (origin) stop.distance = Math.round(haversineMeters(origin.lat, origin.lon, m.lat, m.lon));
  return stop;
}

function uniqueModes(modes: string[]): Mode[] {
  return [...new Set(modes.map(mapMode))];
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function hex(color?: string): string | undefined {
  if (!color) return undefined;
  const c = color.replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(c) ? `#${c.toLowerCase()}` : undefined;
}

/** Liniename für die Anzeige. Fernverkehr: Zugnummer ("ICE 597"), sonst Kurzname ("U8"). */
export function lineName(r: MotisRouteInfo, mode: Mode): string {
  if (mode === 'LONG_DISTANCE') return (r.displayName || r.routeShortName || r.tripShortName || '?').trim();
  return (r.routeShortName || r.displayName || r.tripShortName || r.routeLongName || '?').trim();
}

/**
 * Typische Namen von Bedarfsverkehren: "AST", "AST71", "ALF", "Rufbus", "TaxiBus", "RUF 5",
 * "TB271" (TaxiBus), "333AL" (Anruflinie), "572TB".
 */
const ON_DEMAND_NAME = /^(AST|ALF|ALT|RUF|RUFBUS|TAXIBUS|ANRUFBUS|ANRUF|BEDARF|TB)(\d|$)|^\d+(AL|TB|AST|ALT)$/i;
/** Namen, die allein nichts unterscheiden (alle AST-Gebiete einer Stadt heißen "AST"). */
const GENERIC_ON_DEMAND = /^(AST|ALF|ALT|RUF|RUFBUS|TAXIBUS|ANRUFBUS)$/i;

/**
 * Rufbus/AST/TaxiBus – fährt nur nach Bestellung?
 *
 * Reihenfolge der Hinweise (aus den echten DELFI-/NWL-Daten):
 * 1. Route-ID mit Kategorie "|Bedarf|" (NWL, z. B. T65 Dülmen) → ja.
 * 2. Typischer Name (AST, TaxiBus "TB271" …) oder Ziel "Taxibus"/"Rufbus" → ja.
 * 3. route_type 715 / MOTIS-Modus ODM → ja, außer die Route ist ausdrücklich als "|Bus|"
 *    eingeordnet: NWL nutzt 715 auch für Bürgerbusse mit festem Fahrplan (B1/B2 Dülmen).
 */
export function isOnDemand(r: Pick<MotisRouteInfo, 'mode' | 'routeType' | 'routeId' | 'headsign'>, name: string): boolean {
  const id = r.routeId ?? '';
  if (/\|Bedarf\|/i.test(id)) return true;
  if (ON_DEMAND_NAME.test(name.replace(/[\s-]+/g, ''))) return true;
  if (/taxi\s?bus|rufbus|anrufbus|anruf-?sammel/i.test(r.headsign ?? '')) return true;
  if (r.mode === 'FLEX') return true;
  if (r.mode === 'ODM' || r.routeType === 715) return !/\|Bus\|/i.test(id);
  return false;
}

/**
 * Gebietskürzel aus der Route-ID, z. B. "…|Bedarf|AST:WIN_715" → "WIN".
 * Damit werden gleichnamige AST-Gebiete nicht zu einer Linie zusammengeworfen.
 */
function onDemandArea(routeId: string | undefined): string | null {
  const m = /\|[A-Za-z]+:([A-Za-z0-9]{1,12})_\d+$/.exec(routeId ?? '');
  return m ? m[1] : null;
}

export function lineFromRoute(r: MotisRouteInfo): Line {
  const mode = mapMode(r.mode);
  const name = lineName(r, mode);
  const operator = r.agencyName?.trim() || undefined;
  const onDemand = isOnDemand(r, name);
  const area = onDemand && GENERIC_ON_DEMAND.test(name) ? onDemandArea(r.routeId) : null;
  const line: Line = { key: makeLineKey(mode, area ? `${name} ${area}` : name, operator), name, mode };
  if (operator) line.operator = operator;
  if (onDemand) line.onDemand = true;
  const color = hex(r.routeColor);
  if (color) {
    line.color = color;
    line.textColor = hex(r.routeTextColor) ?? '#ffffff';
  }
  return line;
}

function delayMinutes(planned?: string, actual?: string): number | null {
  if (!planned || !actual) return null;
  return Math.round((Date.parse(actual) - Date.parse(planned)) / 60_000);
}

export function departureFromStopTime(st: MotisStopTime): Departure {
  const planned = st.place.scheduledDeparture ?? st.place.scheduledArrival ?? '';
  const actual = st.place.departure ?? st.place.arrival ?? planned;
  const dep: Departure = {
    tripId: st.tripId ?? '',
    line: lineFromRoute(st),
    headsign: st.headsign ?? '',
    stop: stopFromPlace(st.place),
    plannedTime: planned,
    time: actual,
    delayMin: st.realTime ? delayMinutes(planned, actual) : null,
    realtime: !!st.realTime,
    cancelled: !!(st.cancelled || st.tripCancelled || st.place.cancelled),
  };
  if (st.directionId) dep.directionId = st.directionId;
  if (st.place.track) dep.track = st.place.track;
  if (st.place.scheduledTrack) dep.plannedTrack = st.place.scheduledTrack;
  return dep;
}

export function stopoverFromPlace(p: MotisPlace): Stopover {
  const so: Stopover = { stop: stopFromPlace(p) };
  if (p.scheduledArrival) so.plannedArrival = p.scheduledArrival;
  if (p.arrival) so.arrival = p.arrival;
  if (p.scheduledDeparture) so.plannedDeparture = p.scheduledDeparture;
  if (p.departure) so.departure = p.departure;
  if (p.track) so.track = p.track;
  if (p.scheduledTrack) so.plannedTrack = p.scheduledTrack;
  if (p.cancelled) so.cancelled = true;
  return so;
}

function legStopovers(l: MotisLeg): Stopover[] {
  return [l.from, ...(l.intermediateStops ?? []), l.to].map(stopoverFromPlace);
}

/** MOTIS nennt Koordinaten-Start/-Ziel "START"/"END" – durch den Namen aus der Suche ersetzen. */
export interface PlaceNames {
  from?: string;
  to?: string;
}

function placeLabel(p: MotisPlace, names: PlaceNames | undefined): string {
  if (p.name === 'START') return names?.from || p.name;
  if (p.name === 'END') return names?.to || p.name;
  return p.name;
}

export function legFromMotis(l: MotisLeg, names?: PlaceNames): Leg {
  const walking = l.mode === 'WALK' || l.mode === 'BIKE' || l.mode === 'CAR';
  const leg: Leg = {
    mode: walking ? 'WALK' : mapMode(l.mode),
    walking,
    from: { ...stopFromPlace(l.from), name: placeLabel(l.from, names) },
    to: { ...stopFromPlace(l.to), name: placeLabel(l.to, names) },
    plannedDeparture: l.scheduledStartTime,
    departure: l.startTime,
    plannedArrival: l.scheduledEndTime,
    arrival: l.endTime,
    durationMin: Math.round(l.duration / 60),
  };
  if (l.distance !== undefined) leg.distanceM = Math.round(l.distance);
  if (l.from.track) leg.fromTrack = l.from.track;
  if (l.from.scheduledTrack) leg.fromPlannedTrack = l.from.scheduledTrack;
  if (l.to.track) leg.toTrack = l.to.track;
  if (l.to.scheduledTrack) leg.toPlannedTrack = l.to.scheduledTrack;
  if (l.legGeometry?.points) leg.geometry = { polyline: l.legGeometry.points, precision: l.legGeometry.precision ?? 6 };
  if (!walking) {
    leg.line = lineFromRoute(l);
    leg.headsign = l.headsign ?? '';
    if (l.directionId) leg.directionId = l.directionId;
    if (l.tripId) leg.tripId = l.tripId;
    leg.realtime = !!l.realTime;
    leg.stopovers = legStopovers(l);
  }
  return leg;
}

export function journeyFromItinerary(it: MotisItinerary, index: number, names?: PlaceNames): Journey {
  const legs = it.legs.map((l) => legFromMotis(l, names));
  return {
    id: it.id ?? `${it.startTime}-${index}`,
    departure: it.startTime,
    arrival: it.endTime,
    durationMin: Math.round(it.duration / 60),
    transfers: it.transfers,
    legs,
  };
}

/** Schätzt anhand der Uhrzeit, zwischen welchen Halten sich das Fahrzeug befindet. */
export function estimatePosition(stopovers: Stopover[], now: number = Date.now()): Trip['position'] {
  let prevIndex: number | null = null;
  for (let i = 0; i < stopovers.length; i++) {
    const s = stopovers[i];
    const dep = s.departure ?? s.plannedDeparture ?? s.arrival ?? s.plannedArrival;
    if (dep && Date.parse(dep) <= now) prevIndex = i;
  }
  if (prevIndex === null) return { prevIndex: null, nextIndex: stopovers.length ? 0 : null };
  const nextIndex = prevIndex + 1 < stopovers.length ? prevIndex + 1 : null;
  return { prevIndex, nextIndex };
}

export function tripFromItinerary(it: MotisItinerary, tripId: string, now?: number): Trip {
  const leg = it.legs.find((l) => l.mode !== 'WALK') ?? it.legs[0];
  if (!leg) throw new Error('Fahrt ohne Abschnitte');
  const stopovers = legStopovers(leg);
  const trip: Trip = {
    id: tripId,
    line: lineFromRoute(leg),
    headsign: leg.headsign ?? '',
    stopovers,
    position: estimatePosition(stopovers, now),
  };
  if (leg.directionId) trip.directionId = leg.directionId;
  return trip;
}

// --- Orte (Von/Nach-Suche) und Karte ------------------------------------------------------

const PLACE_KIND: Record<MotisGeocodeMatch['type'], Place['kind']> = { STOP: 'STOP', ADDRESS: 'ADDRESS', PLACE: 'POI' };

/** Ortsname aus den Verwaltungsgebieten: das von MOTIS als Standard markierte (meist die Stadt). */
function cityOf(m: MotisGeocodeMatch): string | undefined {
  const areas = m.areas ?? [];
  return (areas.find((a) => a.default) ?? areas.find((a) => a.adminLevel === 8) ?? areas.find((a) => a.adminLevel === 6))?.name;
}

export function placeFromGeocode(m: MotisGeocodeMatch, origin?: { lat: number; lon: number }): Place {
  const kind = PLACE_KIND[m.type] ?? 'POI';
  const city = cityOf(m);
  const p: Place = {
    kind,
    id: kind === 'STOP' && m.id ? m.id : geoPlaceId(m.lat, m.lon),
    name: m.name,
    lat: round6(m.lat),
    lon: round6(m.lon),
  };
  const detail = kind === 'ADDRESS' ? [m.zip, city].filter(Boolean).join(' ') : city;
  if (detail && !m.name.includes(detail)) p.detail = detail;
  if (m.modes?.length) p.modes = uniqueModes(m.modes);
  if (origin) p.distance = Math.round(haversineMeters(origin.lat, origin.lon, m.lat, m.lon));
  return p;
}

/** "geo:52.5,13.4" oder "52.5,13.4" → "52.5,13.4" für MOTIS; Stop-IDs bleiben unverändert. */
export function motisPlaceParam(id: string): string {
  const m = /^(?:geo:)?(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(id.trim());
  if (!m) return id;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return id;
  return `${lat},${lon}`;
}

/** Bahnsteige/Steige einer Station zusammenfassen, wenn sie dicht beieinander liegen. */
export function mapStopsFromMotis(raw: MotisMapStop[]): MapStop[] {
  const out = new Map<string, MapStop>();
  for (const s of raw) {
    if (!s.stopId) continue;
    // Haltestellen mit gemeinsamer Station (Bahnhof) → ein Punkt; einzelne Bussteige bleiben einzeln
    const key = s.parentId || s.stopId;
    const modes = uniqueModes(s.modes ?? []);
    const prev = out.get(key);
    if (prev) {
      for (const m of modes) if (!prev.modes.includes(m)) prev.modes.push(m);
      delete prev.track;
      continue;
    }
    const stop: MapStop = { id: key, name: s.name, lat: round6(s.lat), lon: round6(s.lon), modes };
    if (!s.parentId && s.track) stop.track = s.track;
    out.set(key, stop);
  }
  return [...out.values()];
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * "Andere Fahrt wählen": aus einer Direktsuche (maxTransfers=0) die Fahrten zwischen zwei
 * Haltestellen. Nur Verbindungen mit genau einem Fahrzeug; kurze Wege am Bahnhof (z. B. zu
 * einem anderen Steig derselben Station) sind erlaubt, längere Fußwege nicht. Ergebnis nach
 * Abfahrt sortiert, jede Fahrt nur einmal, nur Abfahrten im Zeitfenster [earliest, latest].
 */
export function directLegOptions(
  itineraries: MotisItinerary[],
  window: { earliest: number; latest: number },
  maxWalkSec = 300,
): Leg[] {
  const seen = new Set<string>();
  const out: Leg[] = [];
  for (const it of itineraries) {
    const rides = it.legs.filter((l) => l.mode !== 'WALK' && l.mode !== 'BIKE' && l.mode !== 'CAR');
    if (rides.length !== 1) continue;
    const walkSec = it.legs.filter((l) => !rides.includes(l)).reduce((s, l) => s + (l.duration ?? 0), 0);
    if (walkSec > maxWalkSec) continue;
    const leg = legFromMotis(rides[0]);
    const dep = Date.parse(leg.plannedDeparture);
    if (!(dep >= window.earliest && dep <= window.latest)) continue;
    const key = leg.tripId ?? `${leg.line?.key}|${leg.plannedDeparture}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(leg);
  }
  return out.sort((a, b) => Date.parse(a.departure) - Date.parse(b.departure));
}
