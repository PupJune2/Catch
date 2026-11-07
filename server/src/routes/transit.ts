// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Departure, JourneysResponse, LegOptionsResponse, MapResponse, Place, Stop, Trip } from '../contract.js';
import type { Deps } from '../deps.js';
import { parse } from '../http.js';
import {
  canonicalStopId,
  departureFromStopTime,
  directLegOptions,
  haversineMeters,
  journeyFromItinerary,
  mapStopsFromMotis,
  motisPlaceParam,
  placeFromGeocode,
  stopFromGeocode,
  stopFromPlace,
  tripFromItinerary,
} from '../transit/mapping.js';
import { kindSchema, recentReports, summariesFor } from '../services/reports.js';
import { isCoordinate, LONG_WALK_MAX_SEC, needsLongWalk, pickLongWalk } from '../transit/longWalk.js';

const latLon = {
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
};

function dedupeStops(stops: Stop[]): Stop[] {
  const seen = new Set<string>();
  return stops.filter((s) => {
    const k = canonicalStopId(s.id) ?? s.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function transitRoutes(app: FastifyInstance, deps: Deps) {
  const { motis } = deps;

  /** Hängt an alles mit einer Linie die aktuelle Meldungslage an. */
  async function withSummaries<T extends { line?: { key: string }; summary?: unknown }>(items: T[]): Promise<T[]> {
    const map = await summariesFor(deps, items.map((i) => i.line?.key ?? '').filter(Boolean));
    for (const i of items) if (i.line) i.summary = map.get(i.line.key);
    return items;
  }

  app.get('/v1/stops/search', async (req) => {
    const q = parse(z.object({ q: z.string().trim().min(2).max(100) }), req.query);
    const matches = await motis.geocodeStops(q.q);
    const stops = dedupeStops(matches.filter((m) => m.type === 'STOP').map((m) => stopFromGeocode(m)));
    return { stops: stops.slice(0, 12) };
  });

  /** Von/Nach-Suche: Haltestellen, Adressen (Straße + Hausnummer) und Orte. */
  app.get('/v1/places/search', async (req) => {
    const q = parse(
      z.object({ q: z.string().trim().min(2).max(120), lat: latLon.lat.optional(), lon: latLon.lon.optional() }),
      req.query,
    );
    const near = q.lat !== undefined && q.lon !== undefined ? { lat: q.lat, lon: q.lon } : undefined;
    const matches = await motis.geocodeAll(q.q, near);
    const seen = new Set<string>();
    const places: Place[] = [];
    for (const m of matches) {
      const p = placeFromGeocode(m, near);
      // Doppelte Haltestellen (gleiche DHID aus mehreren Feeds) und doppelte Adressen weglassen
      const key = p.kind === 'STOP' ? `s:${canonicalStopId(p.id) ?? p.id}` : `${p.kind}:${p.name}|${p.detail ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      places.push(p);
      if (places.length >= 12) break;
    }
    return { places };
  });

  /** Adresse zu einer Koordinate (z. B. "Mein Standort" oder langer Druck auf die Karte). */
  app.get('/v1/places/reverse', async (req) => {
    const q = parse(z.object(latLon), req.query);
    const matches = await motis.reverseGeocodeAll(q.lat, q.lon);
    const best =
      matches.find((m) => m.type === 'ADDRESS') ?? matches.find((m) => m.type === 'PLACE') ?? matches.find((m) => m.type === 'STOP');
    if (!best) return { place: null };
    const p = placeFromGeocode(best, q);
    // Start/Ziel ist die angefragte Koordinate, der Name nur die Beschriftung
    if (p.kind !== 'STOP') {
      p.lat = q.lat;
      p.lon = q.lon;
      p.id = `geo:${q.lat.toFixed(6)},${q.lon.toFixed(6)}`;
    }
    return { place: p };
  });

  /**
   * Karte: Haltestellen (nur bei kleinem Ausschnitt) und aktuelle Hinweise im Ausschnitt.
   * Ausschnitt als minLat/minLon/maxLat/maxLon.
   */
  app.get('/v1/map', async (req): Promise<MapResponse> => {
    const q = parse(
      z.object({
        minLat: latLon.lat,
        minLon: latLon.lon,
        maxLat: latLon.lat,
        maxLon: latLon.lon,
        minutes: z.coerce.number().int().min(15).max(24 * 60).default(120),
        kind: kindSchema.optional(),
      }),
      req.query,
    );
    const minLat = Math.min(q.minLat, q.maxLat);
    const maxLat = Math.max(q.minLat, q.maxLat);
    const minLon = Math.min(q.minLon, q.maxLon);
    const maxLon = Math.max(q.minLon, q.maxLon);
    // Haltestellen nur bis ca. 6 × 6 km – sonst wären es Tausende
    const small = maxLat - minLat <= 0.06 && maxLon - minLon <= 0.09;
    const [stops, reports] = await Promise.all([
      small ? motis.mapStops({ lat: minLat, lon: minLon }, { lat: maxLat, lon: maxLon }).then(mapStopsFromMotis) : Promise.resolve([]),
      recentReports(
        deps.db,
        {
          minutes: q.minutes,
          lat: (minLat + maxLat) / 2,
          lon: (minLon + maxLon) / 2,
          // Radius so, dass der ganze Ausschnitt abgedeckt ist; Feinfilter unten
          radiusKm: Math.min(200, (haversineMeters(minLat, minLon, maxLat, maxLon) / 1000) * 0.55 + 0.5),
          kind: q.kind,
        },
        req.user?.uid ?? null,
      ),
    ]);
    const inBox = (lat?: number, lon?: number) => lat !== undefined && lon !== undefined && lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
    return {
      stops: stops.slice(0, 400),
      stopsHidden: !small,
      reports: reports.filter((r) => inBox(r.nextStop?.lat, r.nextStop?.lon) || inBox(r.prevStop?.lat, r.prevStop?.lon)).slice(0, 300),
    };
  });

  app.get('/v1/stops/nearby', async (req) => {
    const q = parse(z.object({ ...latLon, radius: z.coerce.number().int().min(50).max(3000).default(800) }), req.query);
    const matches = await motis.reverseGeocodeStops(q.lat, q.lon);
    const stops = dedupeStops(
      matches
        .filter((m) => m.type === 'STOP')
        .map((m) => stopFromGeocode(m, q))
        .filter((s) => (s.distance ?? 0) <= q.radius)
        .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0)),
    );
    return { stops: stops.slice(0, 15) };
  });

  app.get('/v1/departures', async (req) => {
    const q = parse(
      z.object({
        stopId: z.string().min(1).max(200),
        time: z.string().datetime({ offset: true }).optional(),
        n: z.coerce.number().int().min(1).max(100).default(40),
      }),
      req.query,
    );
    const res = await motis.stopTimes({ stopId: q.stopId, time: q.time, n: q.n });
    const departures = await withSummaries(res.stopTimes.filter((st) => st.tripId).map(departureFromStopTime));
    return { stop: res.place ? stopFromPlace(res.place) : null, departures };
  });

  app.get('/v1/journeys', async (req): Promise<JourneysResponse> => {
    const q = parse(
      z.object({
        // Stop-ID oder "geo:<lat>,<lon>" (Adresse, Ort, eigener Standort)
        from: z.string().min(1).max(200),
        to: z.string().min(1).max(200),
        // Beschriftung für Start/Ziel bei Koordinaten (sonst "START"/"END")
        fromName: z.string().trim().max(120).optional(),
        toName: z.string().trim().max(120).optional(),
        time: z.string().datetime({ offset: true }).optional(),
        arriveBy: z.enum(['true', 'false']).optional(),
        cursor: z.string().max(4000).optional(),
      }),
      req.query,
    );
    const from = motisPlaceParam(q.from);
    const to = motisPlaceParam(q.to);
    const arriveBy = q.arriveBy === 'true';
    const res = await motis.plan({ from, to, time: q.time, arriveBy, pageCursor: q.cursor });
    const names = { from: q.fromName, to: q.toName };
    let journeys = res.itineraries.map((it, i) => journeyFromItinerary(it, i, names));
    let notice: JourneysResponse['notice'];

    // Adresse auf dem Land: fährt stundenlang nichts, zusätzlich mit bis zu 60 Min. Fußweg suchen
    const fromGeo = isCoordinate(from);
    const toGeo = isCoordinate(to);
    const requestedAt = q.time ? Date.parse(q.time) : Date.now();
    if (!q.cursor && !arriveBy && (fromGeo || toGeo) && needsLongWalk(journeys, requestedAt)) {
      const alt = await motis
        .plan({
          from,
          to,
          time: q.time,
          maxPreTransitSec: fromGeo ? LONG_WALK_MAX_SEC : undefined,
          maxPostTransitSec: toGeo ? LONG_WALK_MAX_SEC : undefined,
        })
        .catch(() => null);
      const extra = alt ? pickLongWalk(journeys, alt.itineraries.map((it, i) => journeyFromItinerary(it, i, names)), requestedAt) : [];
      if (extra.length) {
        journeys = [...extra, ...journeys];
        notice = 'longWalk';
      }
    }

    const legs = journeys.flatMap((j) => j.legs);
    await withSummaries(legs);
    const out: JourneysResponse = { journeys };
    if (notice) out.notice = notice;
    if (res.previousPageCursor) out.earlierCursor = res.previousPageCursor;
    if (res.nextPageCursor) out.laterCursor = res.nextPageCursor;
    return out;
  });

  /**
   * Andere Fahrten für einen Abschnitt ("früheren Zug nehmen, damit der Umstieg reicht"):
   * Direktfahrten von `from` nach `to`, die zwischen `before` Minuten vor und `after` Minuten
   * nach `time` abfahren.
   */
  app.get('/v1/journeys/leg-options', async (req): Promise<LegOptionsResponse> => {
    const q = parse(
      z.object({
        from: z.string().min(1).max(200),
        to: z.string().min(1).max(200),
        time: z.string().datetime({ offset: true }),
        before: z.coerce.number().int().min(0).max(240).default(120),
        after: z.coerce.number().int().min(0).max(240).default(90),
      }),
      req.query,
    );
    const at = Date.parse(q.time);
    // Auf die Minute runden → gleiche Anfragen treffen den Cache
    const earliest = Math.floor((at - q.before * 60_000) / 60_000) * 60_000;
    const latest = at + q.after * 60_000;
    const res = await motis.planDirect({
      from: motisPlaceParam(q.from),
      to: motisPlaceParam(q.to),
      time: new Date(earliest).toISOString(),
      windowSec: Math.ceil((latest - earliest) / 1000),
    });
    const options = directLegOptions(res.itineraries, { earliest, latest }).slice(0, 30);
    await withSummaries(options);
    return { options };
  });

  app.get('/v1/trip', async (req): Promise<Trip> => {
    const q = parse(z.object({ id: z.string().min(1).max(300) }), req.query);
    const trip = tripFromItinerary(await motis.trip(q.id), q.id);
    await withSummaries([trip]);
    return trip;
  });

  /**
   * "In welcher Linie sitzt du gerade?" – alle Fahrten, die in den letzten/nächsten
   * 20 Minuten Haltestellen im Umkreis von ~500 m anfahren.
   */
  app.get('/v1/report-candidates', async (req) => {
    const q = parse(z.object(latLon), req.query);
    const now = Date.now();
    // Zwischen zwei Bahnhöfen ist der nächste Halt oft > 500 m entfernt → großzügiger Radius,
    // dafür Bewertung nach Entfernung UND Zeitabstand.
    const res = await motis.stopTimes({
      center: { lat: q.lat, lon: q.lon },
      radius: 1200,
      time: new Date(now - 20 * 60_000).toISOString(),
      window: 40 * 60,
      n: 150,
    });
    /** Kleiner = wahrscheinlicher. 1 Minute Zeitabstand ≈ 150 m Entfernung. */
    const score = (d: Departure) => {
      const minutes = Math.abs(Date.parse(d.time) - now) / 60_000;
      const meters = d.stop.lat !== undefined && d.stop.lon !== undefined ? haversineMeters(q.lat, q.lon, d.stop.lat, d.stop.lon) : 600;
      return minutes + meters / 150;
    };
    const byTrip = new Map<string, { d: Departure; s: number }>();
    for (const st of res.stopTimes) {
      if (!st.tripId || st.mode === 'WALK') continue;
      const d = departureFromStopTime(st);
      if (d.cancelled) continue;
      const s = score(d);
      const prev = byTrip.get(d.tripId);
      if (!prev || s < prev.s) byTrip.set(d.tripId, { d, s });
    }
    const departures = [...byTrip.values()]
      .sort((a, b) => a.s - b.s)
      .slice(0, 30)
      .map(({ d }) => {
        if (d.stop.lat !== undefined && d.stop.lon !== undefined) d.stop.distance = Math.round(haversineMeters(q.lat, q.lon, d.stop.lat, d.stop.lon));
        return d;
      });
    return { departures: await withSummaries(departures) };
  });
}
