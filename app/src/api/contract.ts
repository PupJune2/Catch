// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * API-Vertrag zwischen App und Server.
 *
 * Diese Datei ist die "Single Source of Truth" für alle Datenformate.
 * Eine identische Kopie liegt in `app/src/api/contract.ts` – bei Änderungen
 * bitte beide Dateien synchron halten (oder `npm run sync-contract` im
 * Server-Ordner ausführen).
 *
 * Alle Zeitangaben sind ISO-8601-Strings in UTC (z. B. "2026-11-06T19:31:00Z").
 */

/** Verkehrsmittel-Gruppen, wie die App sie darstellt. */
export type Mode =
  | 'BUS'
  | 'TRAM'
  | 'SUBWAY'
  | 'SUBURBAN'
  | 'REGIONAL'
  | 'LONG_DISTANCE'
  | 'FERRY'
  | 'OTHER';

/** Haltestelle (immer auf Stations-Ebene, nicht einzelne Gleise/Steige). */
export interface Stop {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
  modes?: Mode[];
  /** Entfernung in Metern (nur bei Umkreissuchen). */
  distance?: number;
}

/**
 * Ergebnis der Von/Nach-Suche: Haltestelle, Adresse oder Ort (POI).
 * `id` kann direkt als `from`/`to` an GET /v1/journeys übergeben werden:
 * bei Haltestellen die Stop-ID, sonst "geo:<lat>,<lon>".
 */
export type PlaceKind = 'STOP' | 'ADDRESS' | 'POI';

export interface Place {
  kind: PlaceKind;
  id: string;
  /** "S+U Alexanderplatz Bhf (Berlin)", "Weseler Straße 108", "Schloss Münster" */
  name: string;
  /** Zusatzzeile, z. B. "48151 Münster" oder "Berlin, Mitte". */
  detail?: string;
  lat: number;
  lon: number;
  /** Nur bei Haltestellen. */
  modes?: Mode[];
  /** Entfernung in Metern (nur wenn lat/lon mitgeschickt wurden). */
  distance?: number;
}

/** "geo:52.52,13.41" für Adressen/Orte/eigenen Standort als Start oder Ziel. */
export function geoPlaceId(lat: number, lon: number): string {
  return `geo:${lat.toFixed(6)},${lon.toFixed(6)}`;
}

/** Haltestelle für die Karte (GET /v1/map). */
export interface MapStop {
  /** Für GET /v1/departures?stopId=… */
  id: string;
  name: string;
  lat: number;
  lon: number;
  modes: Mode[];
  /** Gleis / Steig dieses Punkts, z. B. "17" oder "D1" (falls der Punkt ein einzelner Bahnsteig ist). */
  track?: string;
}

export interface MapResponse {
  /** Leer, wenn der Ausschnitt zu groß ist (dann `stopsHidden: true`). */
  stops: MapStop[];
  stopsHidden: boolean;
  /** Aktuelle Hinweise im Ausschnitt (Standard: letzte 120 Minuten). */
  reports: Report[];
}

/** Eine Linie, z. B. "U8" der BVG. */
export interface Line {
  /**
   * Stabiler App-Schlüssel, z. B. "subway:u8:berliner-verkehrsbetriebe".
   * Wird vom Server berechnet. Immer mit encodeURIComponent in URLs verwenden.
   */
  key: string;
  /** Anzeigename, z. B. "U8", "M41", "RE1", "ICE 597". */
  name: string;
  mode: Mode;
  operator?: string;
  /** Linienfarbe als Hex inkl. "#", falls bekannt. */
  color?: string;
  textColor?: string;
  /**
   * Rufbus / Anruf-Sammel-Taxi (AST) / TaxiBus / Anruflinie: fährt nur nach vorheriger
   * Bestellung beim Betreiber (Telefon/App, meist 30–60 Min. vorher).
   */
  onDemand?: boolean;
}

/**
 * Art eines Hinweises aus der Community. Reihenfolge = Reihenfolge in der App.
 *   DELAY      Verspätung
 *   CANCELLED  Ausfall / fährt nicht / Ersatzverkehr
 *   CROWDED    Überfüllung
 *   DISRUPTION Störung / Defekt (Türen, Klima, Aufzug …)
 *   CHECK      Fahrkartenkontrolle
 */
export type ReportKind = 'DELAY' | 'CANCELLED' | 'CROWDED' | 'DISRUPTION' | 'CHECK';
export const REPORT_KINDS: ReportKind[] = ['DELAY', 'CANCELLED', 'CROWDED', 'DISRUPTION', 'CHECK'];

/**
 * calm     = in letzter Zeit ruhig (keine Hinweise in der letzten Stunde)
 * frequent = auf dieser Linie gibt es regelmäßig Hinweise (letzte 30 Tage)
 * active   = gerade eben (letzte 60 Min.) etwas gemeldet
 */
export type ActivityLevel = 'calm' | 'frequent' | 'active';

/** Kompakte Hinweis-Lage einer Linie, mit der Abfahrten/Verbindungen angereichert werden. */
export interface ReportSummary {
  lineKey: string;
  /** Hinweise (alle Arten) in den letzten 60 Minuten. */
  recentCount: number;
  /** Davon je Art (nur Arten mit mindestens einem Hinweis). */
  recentByKind: Partial<Record<ReportKind, number>>;
  lastReportAt: string | null;
  /** Art des neuesten Hinweises (letzte 30 Tage). */
  lastKind: ReportKind | null;
  /** Hinweise (alle Arten) in den letzten 30 Tagen. */
  count30d: number;
  count30dByKind: Partial<Record<ReportKind, number>>;
  level: ActivityLevel;
}

export interface Departure {
  tripId: string;
  line: Line;
  headsign: string;
  directionId?: string;
  /** Wo die Abfahrt stattfindet. */
  stop: Stop;
  plannedTime: string;
  /** Prognostizierte Zeit (= plannedTime ohne Echtzeitdaten). */
  time: string;
  delayMin: number | null;
  realtime: boolean;
  /** Gleis (Bahn) bzw. Steig/Haltestellen-Nummer (Bus/Tram), z. B. "17" oder "D1". */
  track?: string;
  /** Planmäßiges Gleis – weicht es von `track` ab, wurde das Gleis geändert. */
  plannedTrack?: string;
  cancelled: boolean;
  summary?: ReportSummary;
}

export interface Stopover {
  stop: Stop;
  plannedArrival?: string;
  arrival?: string;
  plannedDeparture?: string;
  departure?: string;
  track?: string;
  plannedTrack?: string;
  cancelled?: boolean;
}

export interface Trip {
  id: string;
  line: Line;
  headsign: string;
  directionId?: string;
  stopovers: Stopover[];
  /**
   * Geschätzte aktuelle Position anhand der Uhrzeit:
   * prevIndex = zuletzt verlassene Haltestelle, nextIndex = nächste Haltestelle.
   */
  position: { prevIndex: number | null; nextIndex: number | null };
  summary?: ReportSummary;
}

export interface Leg {
  mode: Mode | 'WALK';
  walking: boolean;
  from: Stop;
  to: Stop;
  plannedDeparture: string;
  departure: string;
  plannedArrival: string;
  arrival: string;
  durationMin: number;
  distanceM?: number;
  /** Abfahrts-Gleis / -Steig am Start dieses Abschnitts (z. B. "17", "D1"). */
  fromTrack?: string;
  fromPlannedTrack?: string;
  /** Ankunfts-Gleis / -Steig am Ziel dieses Abschnitts. */
  toTrack?: string;
  toPlannedTrack?: string;
  /** Streckenverlauf für die Karte: kodierte Polyline (Google-Format) mit `precision` Nachkommastellen. */
  geometry?: { polyline: string; precision: number };
  // Nur bei Fahrten (nicht bei Fußwegen):
  line?: Line;
  headsign?: string;
  directionId?: string;
  tripId?: string;
  realtime?: boolean;
  /** Alle Halte dieses Abschnitts inkl. Start und Ziel. */
  stopovers?: Stopover[];
  summary?: ReportSummary;
}

export interface Journey {
  id: string;
  /** true = offline auf dem Gerät berechnet (Fahrplan ohne Echtzeit) */
  offline?: boolean;
  /**
   * Mit langem Fußweg (bis 60 Min.) am Start/Ziel – nur angeboten, wenn es sonst stundenlang
   * nichts gibt (ländliche Gegend, Wochenende). longWalkMin = längster Fußweg in Minuten.
   */
  longWalk?: boolean;
  longWalkMin?: number;
  departure: string;
  arrival: string;
  durationMin: number;
  transfers: number;
  legs: Leg[];
}

// ---------------------------------------------------------------------------
// Offline-Fahrpläne (GET /v1/offline/regions, GET /v1/offline/regions/:id)
// ---------------------------------------------------------------------------

/**
 * Kompaktes Fahrplanpaket einer Stadt/Region (Version 1). Zeiten = Sekunden seit Mitternacht
 * des Betriebstags (können > 24 h sein). services[i] ist eine Bitmaske: Bit d = an Tag
 * validFrom + d gültig.
 */
export type OfflineMode = 'BUS' | 'TRAM' | 'SUBWAY' | 'SUBURBAN' | 'REGIONAL' | 'LONG_DISTANCE' | 'FERRY' | 'OTHER';

export interface OfflinePackage {
  v: number;
  region: { id: string; name: string; lat: number; lon: number; radiusKm: number };
  builtAt: string;
  /** Erster Tag (Europe/Berlin), YYYY-MM-DD */
  validFrom: string;
  days: number;
  attribution: string;
  /** [Name, lat·1e5, lon·1e5, Gleis/Steig ("" wenn keins), Index der Station oder -1] */
  stops: Array<[string, number, number, string, number]>;
  /** Stationen (Elternhaltestellen): [Name, lat·1e5, lon·1e5] */
  stations: Array<[string, number, number]>;
  /** [Linienname, Modus, Farbe, Textfarbe, Betreiber, Rufbus (1 = vorher bestellen; fehlt bei älteren Paketen)] */
  routes: Array<[string, OfflineMode, string, string, string] | [string, OfflineMode, string, string, string, number]>;
  headsigns: string[];
  /** Bitmaske je Verkehrstag-Muster */
  services: number[];
  /** Fahrzeitprofile: [Halt 1 Ankunft-Δ, Halt 1 Aufenthalt, Halt 2 …] relativ zur Abfahrt am ersten Halt */
  profiles: number[][];
  /** Muster = gleiche Haltfolge. trips: [route, headsign, service, Abfahrt am 1. Halt (s), profile] – nach Abfahrt sortiert */
  patterns: Array<{ stops: number[]; trips: Array<[number, number, number, number, number]> }>;
  /** Fußwege: [von, nach, Sekunden] (beide Richtungen enthalten) */
  transfers: Array<[number, number, number]>;
}

export interface OfflineIndexEntry {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  v: number;
  builtAt: string;
  validFrom: string;
  validUntil: string;
  /** Größe beim Herunterladen (gzip) und entpackt */
  sizeBytes: number;
  rawBytes: number;
  stops: number;
  trips: number;
}

export interface OfflineRegionsResponse {
  /** false, wenn der Server (noch) keine Pakete hat */
  available: boolean;
  builtAt?: string;
  attribution?: string;
  regions: OfflineIndexEntry[];
}

export interface JourneysResponse {
  journeys: Journey[];
  earlierCursor?: string;
  laterCursor?: string;
  /**
   * 'longWalk': In den nächsten Stunden gab es nichts mit kurzem Fußweg – die Liste enthält
   * zusätzlich Verbindungen mit langem Fußweg (Journey.longWalk). Oft fährt dort ein AST/Rufbus,
   * der nicht in den offenen Fahrplandaten steht.
   */
  notice?: 'longWalk';
}

/**
 * GET /v1/journeys/leg-options – andere Fahrten für einen Abschnitt einer Verbindung:
 * alle Direktfahrten (ohne Umstieg) zwischen denselben zwei Haltestellen, sortiert nach Abfahrt.
 */
export interface LegOptionsResponse {
  options: Leg[];
}

/**
 * Vordefinierte Merkmale je Art – bewusst KEIN Freitext und KEINE Beschreibung von Personen
 * (Datenschutz/Persönlichkeitsrechte).
 */
export type ReportTag =
  // DELAY
  | 'DELAY_UP_TO_5' // bis 5 Min.
  | 'DELAY_5_TO_15' // 5–15 Min.
  | 'DELAY_OVER_15' // mehr als 15 Min.
  // CANCELLED
  | 'NOT_RUNNING' // fällt aus / kommt nicht
  | 'REPLACEMENT_SERVICE' // Ersatzverkehr
  | 'SKIPS_STOPS' // hält nicht überall
  // CROWDED
  | 'FULL' // voll
  | 'VERY_FULL' // sehr voll, kaum Platz
  | 'NO_BIKE_SPACE' // kein Platz für Rad/Kinderwagen
  // DISRUPTION
  | 'DOORS' // Türstörung
  | 'CLIMATE' // Klima/Heizung
  | 'ACCESSIBILITY' // Aufzug/Rampe/Einstieg
  | 'OTHER_DEFECT' // sonstige Störung
  // CHECK
  | 'IN_VEHICLE' // im Fahrzeug
  | 'AT_STOP' // an der Haltestelle / am Bahnsteig
  | 'EXIT_CHECK' // beim Aussteigen
  // Veraltet: nur noch in alten Meldungen enthalten, werden nicht mehr angenommen
  | 'PLAIN_CLOTHES'
  | 'UNIFORM'
  | 'LARGE_GROUP';

/** Welche Merkmale zu welcher Art gehören (nur diese werden beim Melden angenommen). */
export const TAGS_BY_KIND: Record<ReportKind, ReportTag[]> = {
  DELAY: ['DELAY_UP_TO_5', 'DELAY_5_TO_15', 'DELAY_OVER_15'],
  CANCELLED: ['NOT_RUNNING', 'REPLACEMENT_SERVICE', 'SKIPS_STOPS'],
  CROWDED: ['FULL', 'VERY_FULL', 'NO_BIKE_SPACE'],
  DISRUPTION: ['DOORS', 'CLIMATE', 'ACCESSIBILITY', 'OTHER_DEFECT'],
  CHECK: ['IN_VEHICLE', 'AT_STOP', 'EXIT_CHECK'],
};

/** Alle aktuell gültigen Merkmale. */
export const REPORT_TAGS: ReportTag[] = REPORT_KINDS.flatMap((k) => TAGS_BY_KIND[k]);

/** Gründe für "Inhalt melden". */
export type FlagReason = 'WRONG' | 'SPAM' | 'INAPPROPRIATE' | 'OTHER';
export const FLAG_REASONS: FlagReason[] = ['WRONG', 'SPAM', 'INAPPROPRIATE', 'OTHER'];

export interface FlagReportBody {
  reason: FlagReason;
}

export interface Report {
  id: string;
  kind: ReportKind;
  lineKey: string;
  line: Line;
  directionId?: string | null;
  headsign?: string | null;
  prevStop: Stop | null;
  nextStop: Stop | null;
  reportedAt: string;
  tags: ReportTag[];
  confirmations: number;
  denials: number;
  /** Nur gesetzt, wenn eingeloggt. */
  myVote?: 1 | -1 | null;
  isMine?: boolean;
}

export interface CreateReportBody {
  /** Art des Hinweises. Fehlt sie (ältere App-Versionen), gilt 'CHECK'. */
  kind?: ReportKind;
  /** Linie, wie sie vom Server geliefert wurde. */
  line: Line;
  /** Wenn bekannt: der Server validiert Linie und Halte dann gegen die echte Fahrt. */
  tripId?: string;
  directionId?: string;
  headsign?: string;
  /** Mindestens eine der beiden Haltestellen ist Pflicht. */
  prevStop?: Stop | null;
  nextStop?: Stop | null;
  tags?: ReportTag[];
  /** Beobachtet vor X Minuten (0–60). Standard 0 = jetzt. */
  minutesAgo?: number;
}

export interface TimeWindow {
  /** "HH:MM" Ortszeit (Europe/Berlin) */
  from: string;
  to: string;
  count: number;
  /** Anteil an allen Meldungen, 0..1 */
  share: number;
}

export interface Hotspot {
  /** Die beiden Haltestellen, zwischen denen kontrolliert wurde (ungerichtet). */
  stopA: Stop | null;
  stopB: Stop | null;
  count: number;
  /** Durchschnittliche Uhrzeit "HH:MM" für diesen Abschnitt. */
  averageTime: string | null;
  lastReportAt: string;
}

export interface LineStats {
  lineKey: string;
  /** null, wenn die Linie noch nie gemeldet wurde. */
  line: Line | null;
  /** Für welche Art die Auswertung gilt (null = alle Arten, Parameter ?kind=). */
  kind: ReportKind | null;
  /** Anzahl Hinweise je Art im Zeitraum (unabhängig vom Filter). */
  byKind: Record<ReportKind, number>;
  days: number;
  total: number;
  recentCount: number;
  lastReportAt: string | null;
  level: ActivityLevel;
  /**
   * Zirkulärer Mittelwert der Uhrzeiten (23:50 und 00:10 ergeben 00:00, nicht 12:00).
   * confidence 0..1: wie stark sich die Meldungen um diese Uhrzeit bündeln.
   */
  averageTime: {
    time: string;
    minutes: number;
    confidence: number;
    spreadMinutes: number | null;
  } | null;
  /** Die Zeitfenster mit den meisten Hinweisen (max. 2). */
  peakWindows: TimeWindow[];
  /** 24 Werte: Meldungen je Stunde (Ortszeit). */
  byHour: number[];
  /** 7 Werte: Mo..So */
  byWeekday: number[];
  /** Häufigste Abschnitte, absteigend. */
  hotspots: Hotspot[];
  /** Häufigste einzelne Haltestellen. */
  topStops: Array<{ stop: Stop; count: number }>;
  directions: Array<{ directionId: string | null; headsign: string | null; count: number }>;
  /** Zusammenfassung in einem Satz, auf Deutsch. */
  insight: string;
}

export interface Tracking {
  id: string;
  lineKey: string;
  line: Line;
  directionId?: string | null;
  headsign?: string | null;
  tripId?: string | null;
  bothDirections: boolean;
  /** Bei welchen Arten alarmiert wird (leer = alle). */
  kinds: ReportKind[];
  fromStop?: Stop | null;
  toStop?: Stop | null;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  active: boolean;
  alertCount: number;
  /** Aktuelle Meldungslage der Linie. */
  summary?: ReportSummary;
}

export interface CreateTrackingBody {
  line: Line;
  directionId?: string;
  headsign?: string;
  tripId?: string;
  /** Auch Meldungen in Gegenrichtung melden. Standard false. */
  bothDirections?: boolean;
  /** Nur bei diesen Arten alarmieren (leer/fehlt = alle). */
  kinds?: ReportKind[];
  /** Eigener Abschnitt (Einstieg/Ausstieg). */
  fromStop?: Stop;
  toStop?: Stop;
  /** Alle Halt-IDs des eigenen Abschnitts → Alarm "auf deinem Abschnitt". */
  stopIds?: string[];
  startsAt: string;
  endsAt: string;
}

export interface TrackingAlert {
  id: string;
  trackingId: string;
  report: Report;
  /** true, wenn die Meldung auf dem eigenen Abschnitt liegt. */
  onMySegment: boolean;
  title: string;
  message: string;
  createdAt: string;
  /** Gesetzt, wenn der Alarm aus dem Pendler-Modus kommt (automatisches Tracking einer Pendelstrecke). */
  commuteId?: string | null;
  commuteName?: string | null;
}

// ---------------------------------------------------------------------------
// Pendler-Modus (GET/POST /v1/commutes, PATCH/DELETE /v1/commutes/:id, GET /v1/commutes/:id/preview)
// ---------------------------------------------------------------------------

/** depart = Losgehen um <time> · arrive = Ankommen bis <time> */
export type CommuteTimeMode = 'depart' | 'arrive';

/** Start/Ziel einer Pendelstrecke. Liegt (anders als gespeicherte Orte) auf dem Server. */
export interface CommutePlace {
  kind: PlaceKind;
  /** Stop-ID oder "geo:<lat>,<lon>" (Adresse, Ort) */
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/** Bitmaske der Wochentage: Bit 0 = Montag … Bit 6 = Sonntag. */
export const WEEKDAYS_MON_FRI = 0b0011111;
export const WEEKDAYS_ALL = 0b1111111;
export const MAX_COMMUTES = 5;
/** Erlaubte Vorlaufzeiten der Losgeh-Erinnerung (Minuten). */
export const COMMUTE_REMIND_OPTIONS = [5, 10, 15, 20] as const;

export interface CreateCommuteBody {
  /** z. B. "To work" / "Zur Arbeit" (1–40 Zeichen) */
  name: string;
  from: CommutePlace;
  to: CommutePlace;
  weekdays: number;
  /** "HH:MM" Ortszeit Europe/Berlin */
  time: string;
  timeMode: CommuteTimeMode;
  /** Standard true */
  active?: boolean;
  /** Bei welchen Arten alarmiert wird (leer/fehlt = alle). */
  kinds?: ReportKind[];
  /** Push X Minuten vor dem Losgehen (1–60); null/fehlt = keine Erinnerung. */
  remindMinutes?: number | null;
}

/** PATCH: alle Felder optional. */
export type UpdateCommuteBody = Partial<CreateCommuteBody>;

/** Vom Server berechnete Verbindung für einen Termin (mit Echtzeit). */
export interface CommutePlan {
  /** Termin (Europe/Berlin), YYYY-MM-DD */
  day: string;
  /** Gewünschte Abfahrt bzw. Ankunft dieses Termins (ISO) */
  targetAt: string;
  journey: Journey;
  /** Spätestens losgehen: erste Abfahrt − Fußweg − 1 Min. Puffer (ISO) */
  leaveAt: string;
  /** Erste Fahrt (nicht Fußweg) – null, wenn die Verbindung nur zu Fuß ist */
  firstLine: Line | null;
  firstDeparture: string | null;
  firstStop: Stop | null;
  /** Verspätung der ersten Fahrt laut Echtzeit (Minuten), null = keine Echtzeit */
  delayMin: number | null;
  /** Ende der automatischen Beobachtung (ISO) */
  watchUntil: string;
  computedAt: string;
}

export interface Commute {
  id: string;
  name: string;
  from: CommutePlace;
  to: CommutePlace;
  weekdays: number;
  time: string;
  timeMode: CommuteTimeMode;
  active: boolean;
  kinds: ReportKind[];
  remindMinutes: number | null;
  /** Nächster Termin (ISO), null wenn ausgeschaltet */
  nextAt: string | null;
  /** true = Zeitfenster läuft, die Linien der Verbindung werden gerade automatisch beobachtet */
  watching: boolean;
  /** Aktuelle Verbindung des laufenden/heutigen Termins (sonst null) */
  plan: CommutePlan | null;
  /** Alarme aus der automatischen Beobachtung in den letzten 24 h */
  alertCount: number;
  /** Erinnerung für den aktuellen Termin schon verschickt (ISO) */
  remindedAt: string | null;
  createdAt: string;
}

/** GET /v1/commutes/:id/preview – nächste Verbindung, jetzt live geplant. */
export interface CommutePreview {
  commuteId: string;
  day: string;
  targetAt: string;
  /** null = keine Verbindung gefunden */
  plan: CommutePlan | null;
}

/** Daten einer Pendler-Push (`data.type === 'commute'`), Werte als Strings. */
export interface CommutePushData {
  type: 'commute';
  /** leave = Zeit zu gehen · update = Verbindung hat sich verschoben · cancelled = Fahrt fällt aus */
  event: 'leave' | 'update' | 'cancelled';
  commuteId: string;
  day: string;
  leaveAt: string;
  departure: string;
  line: string;
  lineKey: string;
}

export interface Me {
  uid: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  reportsCount: number;
  confirmationsReceived: number;
  /** Vertrauensstufe 0..3 – steigt mit bestätigten Meldungen. */
  trustLevel: number;
  /** Wann die Nutzungsbedingungen akzeptiert wurden (null = noch nicht). */
  termsAcceptedAt: string | null;
}

/** PATCH /v1/me */
export interface UpdateMeBody {
  displayName?: string;
  /** true = Nutzungsbedingungen akzeptieren (setzt termsAcceptedAt, falls noch leer). */
  acceptTerms?: true;
}

// ---------------------------------------------------------------------------
// Vertrauen & Moderation (ergänzt Report und Me per Interface-Merging)
// ---------------------------------------------------------------------------

/**
 * Vertrauensstufe 0..3 aus der Vorgeschichte der letzten 90 Tage (Bestätigungen +,
 * Widersprüche −, Markierungen −−, ausgeblendete Meldungen −−−, etwas Aktivität und Kontoalter).
 *   0 = neu / niedrig → Meldung gilt als "unbestätigt", bis jemand sie bestätigt
 *   1 = normal
 *   2, 3 = vertrauenswürdig → kleines Abzeichen "vertrauenswürdig"
 */
export type TrustLevel = 0 | 1 | 2 | 3;

export interface Report {
  /** Vertrauensstufe des Meldenden zum Zeitpunkt der Meldung – nur die Stufe, nie die Person. */
  reporterTrust?: TrustLevel;
}

export interface Me {
  /** Melden ist automatisch eingeschränkt (wiederholt umstrittene Meldungen) bis … (null = nein). */
  restrictedUntil?: string | null;
  /** true = deine Meldungen alarmieren andere erst, wenn jemand sie bestätigt hat. */
  alertsNeedConfirmation?: boolean;
}

// ---------------------------------------------------------------------------
// Feedback an das Catch-Team (POST /v1/feedback, Login optional)
// ---------------------------------------------------------------------------

export type FeedbackCategory = 'BUG' | 'IDEA' | 'PRAISE' | 'OTHER';
export const FEEDBACK_CATEGORIES: FeedbackCategory[] = ['BUG', 'IDEA', 'PRAISE', 'OTHER'];

/** Grenzen für den Feedback-Text (Zeichen). */
export const FEEDBACK_MIN_LENGTH = 3;
export const FEEDBACK_MAX_LENGTH = 2000;

export interface CreateFeedbackBody {
  category: FeedbackCategory;
  /** Freitext, 3–2000 Zeichen. Wird nur dem Betreiber gezeigt, nie öffentlich. */
  message: string;
  /** Optionale Bewertung der App, 1–5 Sterne. */
  rating?: 1 | 2 | 3 | 4 | 5;
  /** Nur mit Konto: Darf das Team per E-Mail antworten? (Standard false) */
  allowContact?: boolean;
  /** z. B. "0.1.0 (6)" – hilft bei Fehlerberichten. */
  appVersion?: string;
  platform?: 'ios' | 'android' | 'web';
}
/** Antwort: 201 { id } */
export interface CreateFeedbackResponse {
  id: string;
}

// ---------------------------------------------------------------------------
// WebSocket  (wss://<server>/v1/ws)
// ---------------------------------------------------------------------------

export type WsClientMessage =
  | { type: 'auth'; token: string; lang?: 'en' | 'de' }
  | { type: 'watch'; lineKeys: string[] }
  | { type: 'ping' };

export type WsServerMessage =
  | { type: 'hello'; uid: string | null }
  | { type: 'alert'; alert: TrackingAlert }
  | { type: 'report'; report: Report }
  | { type: 'pong' }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Fehlerformat (alle Endpunkte)
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  /** Deutsche, anzeigbare Fehlermeldung. */
  message: string;
}
