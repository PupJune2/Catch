// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Erzeugt realistische Demo-Meldungen für einige Berliner Linien (letzte 30 Tage),
 * damit Statistiken & Hotspots in der App sofort etwas zeigen.
 *
 *   npm run seed:demo            (nur mit AUTH_MODE=dev)
 *   npm run seed:demo -- --clear (Demo-Daten wieder entfernen)
 *
 * Holt echte Linien und Haltestellen aus der Fahrplanauskunft (MOTIS).
 */
import { loadConfig } from '../config.js';
import type { Stop } from '../contract.js';
import { MotisClient } from '../transit/motis.js';
import { departureFromStopTime, tripFromItinerary } from '../transit/mapping.js';
import { upsertLine } from '../services/reports.js';
import { createPool } from './pool.js';
import { migrate } from './migrate.js';

const cfg = loadConfig();
if (cfg.AUTH_MODE !== 'dev' && !process.argv.includes('--force')) {
  console.error('Demo-Daten nur im Entwicklungsmodus (AUTH_MODE=dev) – oder mit --force.');
  process.exit(1);
}

const db = createPool(cfg.DATABASE_URL);
await migrate(db, () => {});

if (process.argv.includes('--clear')) {
  await db.query(`DELETE FROM reports WHERE user_id LIKE 'demo-%'`);
  await db.query(`DELETE FROM users WHERE id LIKE 'demo-%'`);
  console.log('Demo-Daten entfernt.');
  await db.end();
  process.exit(0);
}

const motis = new MotisClient({ baseUrl: cfg.MOTIS_URL, userAgent: cfg.TRANSIT_USER_AGENT, timeoutMs: 20_000 });

/** Pro Linie: Abfahrtshaltestelle, Hotspot-Halte (Namensteil) und typische Uhrzeiten. */
const PLAN = [
  { stopQuery: 'U Kottbusser Tor', line: 'U8', hot: ['Moritzplatz', 'Kottbusser Tor'], peaks: [8 * 60 + 15, 17 * 60 + 40], n: 38 },
  { stopQuery: 'U Kottbusser Tor', line: 'U1', hot: ['Görlitzer Bahnhof', 'Schlesisches Tor'], peaks: [9 * 60, 19 * 60 + 30], n: 22 },
  { stopQuery: 'S+U Alexanderplatz', line: 'U2', hot: ['Alexanderplatz', 'Rosa-Luxemburg-Platz'], peaks: [7 * 60 + 45], n: 17 },
  { stopQuery: 'S+U Hauptbahnhof', line: 'M41', hot: ['Potsdamer Platz', 'Hauptbahnhof'], peaks: [15 * 60 + 20], n: 12 },
  { stopQuery: 'U Hermannplatz', line: 'U7', hot: ['Hermannplatz', 'Rathaus Neukölln'], peaks: [22 * 60 + 50], n: 9 },
];

function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Zeitpunkt vor `daysAgo` Tagen zur Berliner Ortszeit `minutes` (ungefähr, für Demo ausreichend). */
function berlinTime(daysAgo: number, minutes: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  const offset = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', timeZoneName: 'shortOffset' })
    .formatToParts(d).find((p) => p.type === 'timeZoneName')?.value.replace('GMT', '') || 1);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + (minutes - offset * 60) * 60_000);
}

for (let i = 1; i <= 8; i++) {
  await db.query(`INSERT INTO users (id, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [`demo-${i}`, `Demo ${i}`]);
}

let total = 0;
/** Hinweis-Art + passende Merkmale (gewichtet: Verspätung/Überfüllung kommen am häufigsten vor). */
const DEMO_MIX: Array<[string, string[]]> = [
  ['DELAY', ['DELAY_UP_TO_5']],
  ['CROWDED', ['FULL']],
  ['DELAY', ['DELAY_5_TO_15']],
  ['CHECK', ['IN_VEHICLE']],
  ['CROWDED', ['VERY_FULL']],
  ['DISRUPTION', ['DOORS']],
  ['DELAY', ['DELAY_OVER_15']],
  ['CANCELLED', ['NOT_RUNNING']],
  ['CHECK', ['AT_STOP']],
  ['DISRUPTION', ['CLIMATE']],
];

for (const p of PLAN) {
  const stop = (await motis.geocodeStops(p.stopQuery)).find((m) => m.type === 'STOP');
  if (!stop) {
    console.warn(`Haltestelle nicht gefunden: ${p.stopQuery}`);
    continue;
  }
  const deps = (await motis.stopTimes({ stopId: stop.id, n: 80 })).stopTimes.map(departureFromStopTime);
  const dep = deps.find((d) => d.line.name === p.line);
  if (!dep) {
    console.warn(`Linie ${p.line} nicht an ${stop.name} gefunden`);
    continue;
  }
  const trip = tripFromItinerary(await motis.trip(dep.tripId), dep.tripId);
  await upsertLine(db, trip.line);
  const stops = trip.stopovers.map((s) => s.stop);
  const hotIdx = stops.findIndex((s) => p.hot.some((h) => s.name.includes(h)));

  for (let k = 0; k < p.n; k++) {
    // 70 % am Hotspot, sonst irgendwo auf der Strecke
    let i = hotIdx >= 0 && Math.random() < 0.7 ? hotIdx : Math.floor(Math.random() * (stops.length - 1));
    i = Math.max(0, Math.min(stops.length - 2, i));
    const [prev, next]: Stop[] = Math.random() < 0.5 ? [stops[i], stops[i + 1]] : [stops[i + 1], stops[i]];
    const peak = p.peaks[k % p.peaks.length];
    const minutes = Math.round(peak + gauss() * 35);
    const daysAgo = Math.floor(Math.random() * 29) + 1;
    // Mischung der Hinweis-Arten: Verspätungen und Überfüllung am häufigsten
    const [kind, tags] = DEMO_MIX[k % DEMO_MIX.length];
    const forward = prev === stops[i];
    await db.query(
      `INSERT INTO reports (user_id, line_key, direction_id, headsign, prev_stop_id, prev_stop_name, prev_lat, prev_lon,
         next_stop_id, next_stop_name, next_lat, next_lon, tags, reported_at, created_at, confirmations, kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16)`,
      [
        `demo-${(k % 8) + 1}`, trip.line.key,
        forward ? (trip.directionId ?? null) : trip.directionId === '0' ? '1' : '0',
        forward ? trip.headsign : stops[0].name,
        prev.id, prev.name, prev.lat ?? null, prev.lon ?? null,
        next.id, next.name, next.lat ?? null, next.lon ?? null,
        tags, berlinTime(daysAgo, minutes), Math.floor(Math.random() * 4), kind,
      ],
    );
    total++;
  }
  console.log(`✓ ${trip.line.name} (${trip.line.key}): ${p.n} Meldungen`);
}

// Eine "gerade eben"-Meldung, damit der Status "gerade gemeldet" sichtbar ist
const first = await db.query<{ line_key: string }>(`SELECT line_key FROM lines WHERE name = 'U8' LIMIT 1`);
if (first.rows[0]) {
  await db.query(
    `INSERT INTO reports (user_id, line_key, direction_id, headsign, prev_stop_id, prev_stop_name, prev_lat, prev_lon,
       next_stop_id, next_stop_name, next_lat, next_lon, tags, reported_at, created_at, confirmations, kind)
     SELECT 'demo-1', line_key, direction_id, headsign, prev_stop_id, prev_stop_name, prev_lat, prev_lon,
            next_stop_id, next_stop_name, next_lat, next_lon, ARRAY['DELAY_5_TO_15'],
            now() - interval '4 minutes', now() - interval '4 minutes', 2, 'DELAY'
     FROM reports WHERE line_key = $1 AND user_id LIKE 'demo-%' LIMIT 1`,
    [first.rows[0].line_key],
  );
  total++;
}

console.log(`Fertig: ${total} Demo-Meldungen angelegt.`);
await db.end();
