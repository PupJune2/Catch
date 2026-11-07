// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Baut Offline-Fahrpläne (ein Paket je Stadt/Region) aus dem deutschlandweiten GTFS-Feed
 * von gtfs.de (DELFI e.V., CC BY 4.0).
 *
 *   node dist/offline/build.js --zip /var/lib/catch-junify/gtfs/de.zip --out /var/lib/catch-junify/offline
 *   [--regions muenster,berlin] [--regions-file /etc/catch-junify/offline-regions.json] [--tmp DIR]
 *
 * Speicherschonend: Der Feed wird nicht entpackt, sondern gestreamt (unzip -p). Die 2 GB große
 * stop_times.txt wird EINMAL gelesen und nur die Zeilen der Regionen in Zwischendateien geschrieben;
 * danach wird jede Region einzeln verarbeitet.
 *
 * Paketformat (JSON, Version 1) – siehe OfflinePackage unten. Zeiten sind Sekunden seit
 * Mitternacht des Betriebstags (können > 24 h sein). services[i] ist eine Bitmaske:
 * Bit d = an Tag validFrom + d gültig.
 */
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { DEFAULT_REGIONS, OFFLINE_DAYS, OFFLINE_FORMAT_VERSION, type OfflineRegion } from './regions.js';

// --- Paketformat: siehe contract.ts (OfflinePackage, OfflineIndexEntry) ----------------------
import type { OfflineIndexEntry, OfflineMode, OfflinePackage } from '../contract.js';
import { isOnDemand } from '../transit/mapping.js';
export type { OfflineIndexEntry, OfflineMode, OfflinePackage };

// --- Hilfen ---------------------------------------------------------------------------------

/** Einfacher CSV-Zeilenparser mit Anführungszeichen ("a,b" und "" als Escape). */
export function parseCsvLine(line: string): string[] {
  if (!line.includes('"')) return line.split(',');
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

async function* zipLines(zip: string, file: string): AsyncGenerator<string> {
  const child = spawn('unzip', ['-p', zip, file], { stdio: ['ignore', 'pipe', 'inherit'] });
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of rl) yield line;
  await new Promise<void>((resolve, reject) => {
    if (child.exitCode !== null) return child.exitCode === 0 ? resolve() : reject(new Error(`unzip ${file}: ${child.exitCode}`));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`unzip ${file}: ${code}`))));
  });
}

async function* csv(zip: string, file: string): AsyncGenerator<Record<string, string>> {
  let header: string[] | null = null;
  for await (const raw of zipLines(zip, file)) {
    const line = raw.replace(/^﻿/, '');
    if (!line) continue;
    const cols = parseCsvLine(line);
    if (!header) {
      header = cols.map((h) => h.trim());
      continue;
    }
    const rec: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) rec[header[i]] = cols[i] ?? '';
    yield rec;
  }
}

function headerIndex(zip: string, file: string): Promise<string[]> {
  return (async () => {
    for await (const line of zipLines(zip, file)) return parseCsvLine(line.replace(/^﻿/, '')).map((h) => h.trim());
    return [];
  })();
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function gtfsSeconds(t: string): number {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

/** GTFS route_type (Basis + erweitert) + Name → App-Modus */
export function modeOf(routeType: number, name: string): OfflineMode {
  const n = name.toUpperCase();
  if (routeType === 101 || routeType === 102 || /^(ICE|IC|EC|ECE|TGV|RJX?|NJ|EN|FLX)\b/.test(n)) return 'LONG_DISTANCE';
  if (routeType === 109 || (routeType === 2 && /^S\s?\d/.test(n))) return 'SUBURBAN';
  if (routeType === 2 || (routeType >= 100 && routeType < 200)) return 'REGIONAL';
  if (routeType === 1 || (routeType >= 400 && routeType < 500)) return 'SUBWAY';
  if (routeType === 0 || (routeType >= 900 && routeType < 1000)) return 'TRAM';
  if (routeType === 3 || routeType === 11 || (routeType >= 200 && routeType < 300) || (routeType >= 700 && routeType < 800)) return 'BUS';
  if (routeType === 4 || routeType === 1000 || routeType === 1200) return 'FERRY';
  return 'OTHER';
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Heutiges Datum in Europe/Berlin als UTC-Mitternacht (nur zum Rechnen mit Tagen). */
function berlinToday(now = new Date()): Date {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(`${s}T00:00:00Z`);
}

function gtfsDate(s: string): Date {
  return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
}

// --- Aufbau ---------------------------------------------------------------------------------

interface StopRec {
  id: string;
  name: string;
  lat: number;
  lon: number;
  parent: string;
  track: string;
  locType: string;
  regions: number; // Bitmaske
  num: number;
}

export interface BuildOptions {
  zip: string;
  out: string;
  tmp?: string;
  regions?: OfflineRegion[];
  log?: (msg: string) => void;
  now?: Date;
}

export async function buildOffline(opts: BuildOptions): Promise<OfflineIndexEntry[]> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const regions = opts.regions ?? DEFAULT_REGIONS;
  if (regions.length > 30) throw new Error('Höchstens 30 Regionen');
  const tmp = opts.tmp ?? join(opts.out, '.tmp');
  mkdirSync(opts.out, { recursive: true });
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const t0 = Date.now();
  const sec = () => `${Math.round((Date.now() - t0) / 1000)} s`;

  // 1) Haltestellen in den Regionen
  const stops = new Map<string, StopRec>();
  const byNum: StopRec[] = [];
  for await (const r of csv(opts.zip, 'stops.txt')) {
    const lat = Number(r.stop_lat);
    const lon = Number(r.stop_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    let mask = 0;
    regions.forEach((reg, i) => {
      if (Math.abs(lat - reg.lat) < 1 && Math.abs(lon - reg.lon) < 1.5 && haversineKm(lat, lon, reg.lat, reg.lon) <= reg.radiusKm) mask |= 1 << i;
    });
    if (!mask) continue;
    stops.set(r.stop_id, {
      id: r.stop_id,
      name: r.stop_name,
      lat,
      lon,
      parent: r.parent_station ?? '',
      track: (r.platform_code ?? '').trim(),
      locType: r.location_type ?? '',
      regions: mask,
      num: stops.size,
    });
  }
  for (const st of stops.values()) byNum[st.num] = st;
  log(`Haltestellen in Regionen: ${stops.size} (${sec()})`);

  // 2) stop_times einmal lesen, Zeilen je Region in Zwischendateien
  const files: WriteStream[] = regions.map((_, i) => createWriteStream(join(tmp, `st-${i}.csv`)));
  const header = await headerIndex(opts.zip, 'stop_times.txt');
  const iTrip = header.indexOf('trip_id');
  const iArr = header.indexOf('arrival_time');
  const iDep = header.indexOf('departure_time');
  const iStop = header.indexOf('stop_id');
  const iSeq = header.indexOf('stop_sequence');
  const iHead = header.indexOf('stop_headsign');
  const iPick = header.indexOf('pickup_type');
  const iDrop = header.indexOf('drop_off_type');
  let n = 0;
  let first = true;
  const buffers: string[][] = regions.map(() => []);
  const flush = async (i: number) => {
    if (!buffers[i].length) return;
    const chunk = buffers[i].join('');
    buffers[i] = [];
    if (!files[i].write(chunk)) await new Promise<void>((res) => files[i].once('drain', () => res()));
  };
  for await (const line of zipLines(opts.zip, 'stop_times.txt')) {
    if (first) {
      first = false;
      continue;
    }
    n++;
    // Schnellprüfung ohne komplettes Parsen: stop_id steht vor den (evtl. gequoteten) Textspalten
    let p = 0;
    for (let k = 0; k < iStop && p >= 0; k++) p = line.indexOf(',', p) + 1 || -1;
    if (p < 0) continue;
    const e = line.indexOf(',', p);
    let stopId = line.slice(p, e < 0 ? undefined : e);
    if (stopId.startsWith('"')) stopId = parseCsvLine(line)[iStop];
    const s = stops.get(stopId);
    if (!s) continue;
    const cols = parseCsvLine(line);
    // Halte ohne Ein- UND Ausstieg überspringen
    if (cols[iPick] === '1' && cols[iDrop] === '1') continue;
    const rec = `${cols[iTrip]}\t${cols[iArr]}\t${cols[iDep]}\t${s.num}\t${cols[iSeq]}\t${iHead >= 0 ? cols[iHead] : ''}\n`;
    for (let i = 0; i < regions.length; i++) {
      if (s.regions & (1 << i)) {
        buffers[i].push(rec);
        if (buffers[i].length >= 5000) await flush(i);
      }
    }
    if (n % 5_000_000 === 0) log(`  stop_times: ${(n / 1e6).toFixed(0)} Mio. Zeilen (${sec()})`);
  }
  for (let i = 0; i < regions.length; i++) {
    await flush(i);
    await new Promise<void>((res) => files[i].end(() => res()));
  }
  log(`stop_times gelesen: ${n} Zeilen (${sec()})`);

  // 3) Linien + Betreiber (klein, komplett laden)
  const agencies = new Map<string, string>();
  for await (const r of csv(opts.zip, 'agency.txt')) agencies.set(r.agency_id, r.agency_name);
  const routesAll = new Map<string, OfflinePackage['routes'][number]>();
  for await (const r of csv(opts.zip, 'routes.txt')) {
    const name = (r.route_short_name || r.route_long_name || '?').trim();
    const color = /^[0-9a-fA-F]{6}$/.test(r.route_color ?? '') ? `#${r.route_color.toLowerCase()}` : '';
    const text = /^[0-9a-fA-F]{6}$/.test(r.route_text_color ?? '') ? `#${r.route_text_color.toLowerCase()}` : '';
    const type = Number(r.route_type);
    const mode = modeOf(type, name);
    const agency = agencies.get(r.agency_id) ?? '';
    // Rufbus/AST (route_type 715 oder typischer Name): 6. Feld = 1 → App zeigt "vorher bestellen"
    const onDemand = isOnDemand({ mode: '', routeType: type, routeId: r.route_id }, name);
    routesAll.set(r.route_id, onDemand ? [name, mode, color, text, agency, 1] : [name, mode, color, text, agency]);
  }

  // 4) Verkehrstage (für alle Regionen gemeinsam)
  const day0 = berlinToday(opts.now);
  const days = OFFLINE_DAYS;
  const dayIndex = (d: Date) => Math.round((d.getTime() - day0.getTime()) / 86_400_000);
  const serviceMask = new Map<string, number>();
  const WD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for await (const r of csv(opts.zip, 'calendar.txt')) {
    const start = gtfsDate(r.start_date);
    const end = gtfsDate(r.end_date);
    let mask = 0;
    for (let d = 0; d < days; d++) {
      const date = new Date(day0.getTime() + d * 86_400_000);
      if (date < start || date > end) continue;
      if (r[WD[date.getUTCDay()]] === '1') mask |= 1 << d;
    }
    serviceMask.set(r.service_id, mask);
  }
  for await (const r of csv(opts.zip, 'calendar_dates.txt')) {
    const d = dayIndex(gtfsDate(r.date));
    if (d < 0 || d >= days) {
      if (!serviceMask.has(r.service_id)) serviceMask.set(r.service_id, 0);
      continue;
    }
    const m = serviceMask.get(r.service_id) ?? 0;
    serviceMask.set(r.service_id, r.exception_type === '1' ? m | (1 << d) : m & ~(1 << d));
  }
  log(`Verkehrstage: ${serviceMask.size} Muster (${sec()})`);

  // 5) Fahrten → Linie + Verkehrstage: je Region nur die dort vorkommenden Fahrten (spart Speicher)
  const tripInfoFor = async (file: string): Promise<Map<string, [string, string]>> => {
    const needed = new Set<string>();
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) needed.add(line.slice(0, line.indexOf('\t')));
    const info = new Map<string, [string, string]>();
    for await (const r of csv(opts.zip, 'trips.txt')) {
      if (!needed.has(r.trip_id)) continue;
      if (!(serviceMask.get(r.service_id) ?? 0)) continue; // fährt in den nächsten Tagen nicht
      info.set(r.trip_id, [r.route_id, r.service_id]);
    }
    return info;
  };

  // 6) Je Region ein Paket
  const index: OfflineIndexEntry[] = [];
  for (let i = 0; i < regions.length; i++) {
    const reg = regions[i];
    const file = join(tmp, `st-${i}.csv`);
    const entry = await buildRegion(reg, file, byNum, routesAll, await tripInfoFor(file), serviceMask, day0, opts.out);
    rmSync(file, { force: true });
    index.push(entry);
    log(`✓ ${reg.name}: ${entry.stops} Halte, ${entry.trips} Fahrten, ${(entry.sizeBytes / 1e6).toFixed(1)} MB (${sec()})`);
  }
  const idx = { v: OFFLINE_FORMAT_VERSION, builtAt: new Date().toISOString(), attribution: ATTRIBUTION, regions: index };
  writeFileSync(join(opts.out, 'index.json.tmp'), JSON.stringify(idx, null, 1));
  renameSync(join(opts.out, 'index.json.tmp'), join(opts.out, 'index.json'));
  rmSync(tmp, { recursive: true, force: true });
  log(`Fertig: ${index.length} Regionen (${sec()})`);
  return index;
}

const ATTRIBUTION = 'Fahrplandaten: DELFI e.V. über gtfs.de (CC BY 4.0)';

async function buildRegion(
  reg: OfflineRegion,
  file: string,
  byNum: StopRec[],
  routesAll: Map<string, OfflinePackage['routes'][number]>,
  tripInfo: Map<string, [string, string]>,
  serviceMask: Map<string, number>,
  day0: Date,
  out: string,
): Promise<OfflineIndexEntry> {
  // Fahrten der Region einlesen
  // Je Fahrt ein flaches Zahlen-Array [seq, arr, dep, stopNum, seq, arr, dep, stopNum, …] – spart viel Speicher
  const trips = new Map<string, number[]>();
  const heads = new Map<string, string>();
  const allStops = { get: (num: string | number) => byNum[Number(num)] };
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const [trip, arr, dep, stop, seq, head] = line.split('\t');
    if (!tripInfo.has(trip)) continue;
    let flat = trips.get(trip);
    if (!flat) trips.set(trip, (flat = []));
    flat.push(Number(seq), gtfsSeconds(arr || dep), gtfsSeconds(dep || arr), Number(stop));
    if (head && !heads.has(trip)) heads.set(trip, head);
  }

  // Elternstationen per ID finden (Stationen liegen ebenfalls in byNum)
  const parentById = new Map<string, StopRec>();
  for (const st of byNum) if (st && (st.locType === '1' || !st.parent)) parentById.set(st.id, st);
  const parentOf = (id: string) => parentById.get(id);

  // Indizes
  const stopIdx = new Map<string, number>();
  const stationIdx = new Map<string, number>();
  const stopsOut: OfflinePackage['stops'] = [];
  const stationsOut: OfflinePackage['stations'] = [];
  const stopIndexOf = (id: string): number => {
    let k = stopIdx.get(id);
    if (k !== undefined) return k;
    const s = byNum[Number(id)];
    let st = -1;
    if (s.parent) {
      st = stationIdx.get(s.parent) ?? -1;
      if (st < 0) {
        const p = parentOf(s.parent);
        if (p) {
          st = stationsOut.length;
          stationsOut.push([p.name, Math.round(p.lat * 1e5), Math.round(p.lon * 1e5)]);
          stationIdx.set(s.parent, st);
        }
      }
    }
    k = stopsOut.length;
    stopsOut.push([s.name, Math.round(s.lat * 1e5), Math.round(s.lon * 1e5), s.track, st]);
    stopIdx.set(id, k);
    return k;
  };
  const routeIdx = new Map<string, number>();
  const routesOut: OfflinePackage['routes'] = [];
  const headIdx = new Map<string, number>();
  const headsOut: string[] = [];
  const svcIdx = new Map<string, number>();
  const svcOut: number[] = [];
  const profIdx = new Map<string, number>();
  const profOut: number[][] = [];
  const patterns = new Map<string, { stops: number[]; trips: Array<[number, number, number, number, number]> }>();

  let tripCount = 0;
  for (const [tripId, flat] of trips) {
    if (flat.length < 8) continue;
    // [seq, arr, dep, stop] → nach seq sortiert
    type E = [number, number, string, number, string];
    const list: E[] = [];
    for (let k = 0; k < flat.length; k += 4) list.push([flat[k + 1], flat[k + 2], String(flat[k + 3]), flat[k], '']);
    list.sort((a, b) => a[3] - b[3]);
    const [routeId, serviceId] = tripInfo.get(tripId)!;
    const route = routesAll.get(routeId);
    if (!route) continue;
    let r = routeIdx.get(routeId);
    if (r === undefined) {
      r = routesOut.length;
      routesOut.push(route);
      routeIdx.set(routeId, r);
    }
    const headText = heads.get(tripId) || allStops.get(list[list.length - 1][2])?.name || '';
    let h = headIdx.get(headText);
    if (h === undefined) {
      h = headsOut.length;
      headsOut.push(headText);
      headIdx.set(headText, h);
    }
    let sv = svcIdx.get(serviceId);
    if (sv === undefined) {
      sv = svcOut.length;
      svcOut.push(serviceMask.get(serviceId) ?? 0);
      svcIdx.set(serviceId, sv);
    }
    const seqStops = list.map((e) => stopIndexOf(e[2]));
    const t0 = list[0][1];
    const prof: number[] = [];
    for (let k = 1; k < list.length; k++) {
      prof.push(list[k][0] - list[k - 1][1], list[k][1] - list[k][0]);
    }
    const pk = prof.join(',');
    let p = profIdx.get(pk);
    if (p === undefined) {
      p = profOut.length;
      profOut.push(prof);
      profIdx.set(pk, p);
    }
    const key = seqStops.join(',');
    let pat = patterns.get(key);
    if (!pat) patterns.set(key, (pat = { stops: seqStops, trips: [] }));
    pat.trips.push([r, h, sv, t0, p]);
    tripCount++;
  }
  trips.clear();
  heads.clear();
  const patternsOut = [...patterns.values()].map((p) => ({ stops: p.stops, trips: p.trips.sort((a, b) => a[3] - b[3]) }));

  // Fußwege zwischen nahen Halten (Raster ~ 250 m)
  const transfers: OfflinePackage['transfers'] = [];
  const MAX_M = 400;
  const cell = (lat: number, lon: number) => `${Math.floor(lat / 0.0025)}:${Math.floor(lon / 0.004)}`;
  const grid = new Map<string, number[]>();
  stopsOut.forEach((s, k) => {
    const c = cell(s[1] / 1e5, s[2] / 1e5);
    let g = grid.get(c);
    if (!g) grid.set(c, (g = []));
    g.push(k);
  });
  stopsOut.forEach((s, a) => {
    const la = s[1] / 1e5;
    const lo = s[2] / 1e5;
    const ci = Math.floor(la / 0.0025);
    const cj = Math.floor(lo / 0.004);
    for (let di = -2; di <= 2; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const b of grid.get(`${ci + di}:${cj + dj}`) ?? []) {
          if (b === a) continue;
          const t = stopsOut[b];
          const m = haversineKm(la, lo, t[1] / 1e5, t[2] / 1e5) * 1000;
          const sameStation = s[4] >= 0 && s[4] === t[4];
          if (m > MAX_M && !sameStation) continue;
          // Gehen ~1,1 m/s auf Umwegen (Faktor 1,3), plus Umsteigepuffer
          const seconds = Math.round((m * 1.3) / 1.1) + (sameStation ? 90 : 120);
          transfers.push([a, b, Math.min(seconds, 900)]);
        }
      }
    }
  });

  const validFrom = ymd(day0);
  const pkg: OfflinePackage = {
    v: OFFLINE_FORMAT_VERSION,
    region: reg,
    builtAt: new Date().toISOString(),
    validFrom,
    days: OFFLINE_DAYS,
    attribution: ATTRIBUTION,
    stops: stopsOut,
    stations: stationsOut,
    routes: routesOut,
    headsigns: headsOut,
    services: svcOut,
    profiles: profOut,
    patterns: patternsOut,
    transfers,
  };
  const raw = Buffer.from(JSON.stringify(pkg));
  const gz = gzipSync(raw, { level: 9 });
  const name = `${reg.id}.json`;
  writeFileSync(join(out, `${name}.gz.tmp`), gz);
  renameSync(join(out, `${name}.gz.tmp`), join(out, `${name}.gz`));
  const until = new Date(day0.getTime() + (OFFLINE_DAYS - 1) * 86_400_000);
  return {
    id: reg.id,
    name: reg.name,
    lat: reg.lat,
    lon: reg.lon,
    radiusKm: reg.radiusKm,
    v: OFFLINE_FORMAT_VERSION,
    builtAt: pkg.builtAt,
    validFrom,
    validUntil: ymd(until),
    sizeBytes: gz.length,
    rawBytes: raw.length,
    stops: stopsOut.length,
    trips: tripCount,
  };
}

// --- Kommandozeile -------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function loadRegions(file?: string, only?: string): OfflineRegion[] {
  let regions = DEFAULT_REGIONS;
  if (file && existsSync(file)) regions = JSON.parse(readFileSync(file, 'utf8')) as OfflineRegion[];
  if (only) {
    const ids = only.split(',').map((s) => s.trim());
    regions = regions.filter((r) => ids.includes(r.id));
  }
  for (const r of regions) {
    if (!/^[a-z0-9-]{2,40}$/.test(r.id) || !(r.radiusKm > 0 && r.radiusKm <= 60)) throw new Error(`Ungültige Region: ${JSON.stringify(r)}`);
  }
  return regions;
}

if (process.argv[1] && /offline[\\/]build\.(js|ts)$/.test(process.argv[1])) {
  const zip = arg('zip');
  const out = arg('out');
  if (!zip || !out || !existsSync(zip)) {
    console.error('Verwendung: build.js --zip de.zip --out DIR [--regions id,id] [--regions-file datei.json] [--tmp DIR]');
    process.exit(2);
  }
  const regions = loadRegions(arg('regions-file') ?? process.env.OFFLINE_REGIONS_FILE, arg('regions'));
  console.log(`Feed: ${zip} (${(statSync(zip).size / 1e6).toFixed(0)} MB), Regionen: ${regions.map((r) => r.id).join(', ')}`);
  buildOffline({ zip, out, tmp: arg('tmp'), regions })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fehler:', err);
      process.exit(1);
    });
}
