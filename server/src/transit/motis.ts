// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Schlanker Client für die MOTIS-API (https://github.com/motis-project/motis).
 *
 * Funktioniert mit der öffentlichen Instanz https://api.transitous.org
 * (deutschlandweite Daten inkl. Bus/Tram/U-Bahn + Echtzeit) und mit einer
 * selbst gehosteten MOTIS-Instanz auf dem eigenen Server.
 */
import { LRUCache } from 'lru-cache';

// --- Rohdaten-Typen (nur die Felder, die wir benutzen) ----------------------

export interface MotisPlace {
  name: string;
  stopId?: string;
  parentId?: string;
  lat: number;
  lon: number;
  arrival?: string;
  departure?: string;
  scheduledArrival?: string;
  scheduledDeparture?: string;
  track?: string;
  scheduledTrack?: string;
  cancelled?: boolean;
  modes?: string[];
}

export interface MotisRouteInfo {
  mode: string;
  /** GTFS route_type (z. B. 3 = Bus, 715 = Bedarfsverkehr) */
  routeType?: number;
  realTime?: boolean;
  headsign?: string;
  tripId?: string;
  routeId?: string;
  directionId?: string;
  routeColor?: string;
  routeTextColor?: string;
  agencyName?: string;
  agencyId?: string;
  routeShortName?: string;
  routeLongName?: string;
  tripShortName?: string;
  displayName?: string;
  cancelled?: boolean;
  tripCancelled?: boolean;
}

export interface MotisStopTime extends MotisRouteInfo {
  place: MotisPlace;
}

export interface MotisLeg extends MotisRouteInfo {
  from: MotisPlace;
  to: MotisPlace;
  duration: number;
  startTime: string;
  endTime: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  distance?: number;
  intermediateStops?: MotisPlace[];
  legGeometry?: { points: string; precision?: number; length?: number };
}

export interface MotisItinerary {
  id?: string;
  duration: number;
  startTime: string;
  endTime: string;
  transfers: number;
  legs: MotisLeg[];
}

export interface MotisGeocodeMatch {
  type: 'STOP' | 'ADDRESS' | 'PLACE';
  name: string;
  id: string;
  lat: number;
  lon: number;
  modes?: string[];
  country?: string;
  street?: string;
  houseNumber?: string;
  zip?: string;
  areas?: Array<{ name: string; adminLevel?: number; matched?: boolean; default?: boolean }>;
}

export interface MotisMapStop {
  name: string;
  stopId?: string;
  parentId?: string;
  lat: number;
  lon: number;
  track?: string;
  modes?: string[];
}

export interface MotisStopTimesResponse {
  stopTimes: MotisStopTime[];
  place?: MotisPlace;
  previousPageCursor?: string;
  nextPageCursor?: string;
}

export interface MotisPlanResponse {
  itineraries: MotisItinerary[];
  previousPageCursor?: string;
  nextPageCursor?: string;
}

// --- Client -----------------------------------------------------------------

export class TransitError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export interface MotisClientOptions {
  baseUrl: string;
  userAgent: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

type Query = Record<string, string | number | boolean | undefined>;

export class MotisClient {
  private readonly cache = new LRUCache<string, { value: unknown }>({
    max: 5_000,
    ttl: 30_000,
  });
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: MotisClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** GET mit Cache (TTL in ms) und Zusammenlegen gleichzeitiger identischer Anfragen. */
  private async get<T>(path: string, query: Query, ttlMs: number): Promise<T> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v));
    const url = `${this.opts.baseUrl.replace(/\/$/, '')}${path}?${params}`;

    const hit = this.cache.get(url);
    if (hit) return hit.value as T;
    const running = this.inflight.get(url);
    if (running) return running as Promise<T>;

    const p = (async () => {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          headers: { 'User-Agent': this.opts.userAgent, Accept: 'application/json' },
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
      } catch (err) {
        throw new TransitError(`Fahrplanauskunft nicht erreichbar (${(err as Error).message})`, 503);
      }
      if (res.status === 404) throw new TransitError('Nicht gefunden', 404);
      if (res.status === 429) throw new TransitError('Fahrplanauskunft überlastet – bitte gleich nochmal versuchen', 503);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new TransitError(`Fahrplanauskunft-Fehler ${res.status}: ${text.slice(0, 200)}`, res.status >= 500 ? 502 : 400);
      }
      const value = (await res.json()) as T;
      this.cache.set(url, { value }, { ttl: ttlMs });
      return value;
    })();
    this.inflight.set(url, p);
    try {
      return await p;
    } finally {
      this.inflight.delete(url);
    }
  }

  geocodeStops(text: string): Promise<MotisGeocodeMatch[]> {
    return this.get('/api/v1/geocode', { text, type: 'STOP', language: 'de' }, 6 * 3600_000);
  }

  /** Haltestellen, Adressen und Orte; mit `near` werden Treffer in der Nähe bevorzugt. */
  geocodeAll(text: string, near?: { lat: number; lon: number }): Promise<MotisGeocodeMatch[]> {
    return this.get(
      '/api/v1/geocode',
      { text, language: 'de', place: near ? `${near.lat.toFixed(3)},${near.lon.toFixed(3)}` : undefined },
      6 * 3600_000,
    );
  }

  reverseGeocodeAll(lat: number, lon: number): Promise<MotisGeocodeMatch[]> {
    return this.get('/api/v1/reverse-geocode', { place: `${lat.toFixed(4)},${lon.toFixed(4)}` }, 3600_000);
  }

  /** Alle Haltestellen (einzelne Bahnsteige/Steige) in einem Kartenausschnitt. */
  mapStops(min: { lat: number; lon: number }, max: { lat: number; lon: number }): Promise<MotisMapStop[]> {
    const r = (n: number) => n.toFixed(3);
    return this.get('/api/v1/map/stops', { min: `${r(min.lat)},${r(min.lon)}`, max: `${r(max.lat)},${r(max.lon)}` }, 12 * 3600_000);
  }

  reverseGeocodeStops(lat: number, lon: number): Promise<MotisGeocodeMatch[]> {
    // Koordinaten auf ~10 m runden → bessere Cache-Trefferquote
    const place = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    return this.get('/api/v1/reverse-geocode', { place, type: 'STOP' }, 3600_000);
  }

  stopTimes(q: {
    stopId?: string;
    center?: { lat: number; lon: number };
    radius?: number;
    time?: string;
    n?: number;
    window?: number;
    both?: boolean;
  }): Promise<MotisStopTimesResponse> {
    return this.get(
      '/api/v6/stoptimes',
      {
        stopId: q.stopId,
        center: q.center ? `${q.center.lat.toFixed(4)},${q.center.lon.toFixed(4)}` : undefined,
        radius: q.radius,
        time: q.time,
        n: q.n ?? 40,
        window: q.window,
        both: q.both,
        language: 'de',
      },
      30_000,
    );
  }

  plan(q: {
    from: string;
    to: string;
    time?: string;
    arriveBy?: boolean;
    pageCursor?: string;
    /** Längster Fußweg am Start/Ziel in Sekunden (MOTIS-Standard: 900 = 15 Min.) */
    maxPreTransitSec?: number;
    maxPostTransitSec?: number;
  }): Promise<MotisPlanResponse> {
    return this.get(
      '/api/v6/plan',
      {
        fromPlace: q.from,
        toPlace: q.to,
        time: q.time,
        arriveBy: q.arriveBy,
        pageCursor: q.pageCursor,
        maxPreTransitTime: q.maxPreTransitSec,
        maxPostTransitTime: q.maxPostTransitSec,
        numItineraries: 6,
        language: 'de',
      },
      60_000,
    );
  }

  /**
   * Nur Direktfahrten (ohne Umstieg) zwischen zwei Haltestellen, die im Zeitfenster
   * [time, time + windowSec] abfahren – für "andere Fahrt wählen" in einer Verbindung.
   */
  planDirect(q: { from: string; to: string; time: string; windowSec: number }): Promise<MotisPlanResponse> {
    return this.get(
      '/api/v6/plan',
      {
        fromPlace: q.from,
        toPlace: q.to,
        time: q.time,
        maxTransfers: 0,
        searchWindow: q.windowSec,
        numItineraries: 1,
        // Fußweg-Direktverbindung interessiert hier nicht
        maxDirectTime: 0,
        language: 'de',
      },
      60_000,
    );
  }

  trip(tripId: string): Promise<MotisItinerary> {
    return this.get('/api/v6/trip', { tripId, language: 'de' }, 60_000);
  }
}
