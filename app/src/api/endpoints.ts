// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { request } from './client';
import type {
  CreateFeedbackBody,
  CreateFeedbackResponse,
  CreateReportBody,
  CreateTrackingBody,
  Departure,
  FlagReason,
  JourneysResponse,
  LegOptionsResponse,
  LineStats,
  Me,
  Place,
  Report,
  ReportKind,
  Stop,
  Tracking,
  TrackingAlert,
  Trip,
  UpdateMeBody,
} from './contract';
import type { Commute, CommutePreview, CreateCommuteBody, UpdateCommuteBody } from './contract';

const line = (key: string) => `/v1/lines/${encodeURIComponent(key)}`;

export const api = {
  // --- Fahrplan --------------------------------------------------------------
  searchStops: (q: string, signal?: AbortSignal) =>
    request<{ stops: Stop[] }>('/v1/stops/search', { query: { q }, signal }),

  nearbyStops: (lat: number, lon: number, radius = 800) =>
    request<{ stops: Stop[] }>('/v1/stops/nearby', { query: { lat, lon, radius } }),

  departures: (stopId: string, time?: string, n = 40) =>
    request<{ stop: Stop | null; departures: Departure[] }>('/v1/departures', { query: { stopId, time, n } }),

  /** Von/Nach-Suche: Haltestellen, Adressen und Orte. lat/lon (falls bekannt) = Nahes zuerst. */
  searchPlaces: (q: string, near?: { lat: number; lon: number } | null, signal?: AbortSignal) =>
    request<{ places: Place[] }>('/v1/places/search', { query: { q, lat: near?.lat, lon: near?.lon }, signal }),

  /** Adresse zu einer Position ("Aktueller Standort"). id = "geo:<lat>,<lon>" des angefragten Punkts. */
  reversePlace: (lat: number, lon: number, signal?: AbortSignal) =>
    request<{ place: Place | null }>('/v1/places/reverse', { query: { lat, lon }, signal }),

  /**
   * from/to: Stop-ID oder "geo:<lat>,<lon>".
   * fromName/toName: Beschriftung von Start/Ziel bei Koordinaten (z. B. "Weseler Straße 108").
   */
  journeys: (params: {
    from: string;
    to: string;
    fromName?: string;
    toName?: string;
    time?: string;
    arriveBy?: boolean;
    cursor?: string;
  }) =>
    request<JourneysResponse>('/v1/journeys', {
      query: {
        from: params.from,
        to: params.to,
        fromName: params.fromName,
        toName: params.toName,
        time: params.time,
        arriveBy: params.arriveBy ? 'true' : undefined,
        cursor: params.cursor,
      },
    }),

  /**
   * Andere Fahrten für einen Abschnitt einer Verbindung: Direktfahrten zwischen denselben
   * Haltestellen, die bis zu `before` Min. vor bzw. `after` Min. nach `time` abfahren.
   */
  legOptions: (params: { from: string; to: string; time: string; before?: number; after?: number }) =>
    request<LegOptionsResponse>('/v1/journeys/leg-options', { query: params }),

  trip: (id: string) => request<Trip>('/v1/trip', { query: { id } }),

  reportCandidates: (lat: number, lon: number) =>
    request<{ departures: Departure[] }>('/v1/report-candidates', { query: { lat, lon } }),

  // --- Linien & Meldungen ----------------------------------------------------
  /** kind = nur diese Art auswerten (fehlt = alle Arten). */
  lineStats: (key: string, days = 30, directionId?: string, kind?: ReportKind | null) =>
    request<LineStats>(`${line(key)}/stats`, { query: { days, directionId, kind: kind ?? undefined } }),

  lineReports: (key: string, params: { days?: number; limit?: number; before?: string; kind?: ReportKind | null } = {}) =>
    request<{ reports: Report[] }>(`${line(key)}/reports`, {
      query: { days: params.days, limit: params.limit, before: params.before, kind: params.kind ?? undefined },
      auth: 'optional',
    }),

  recentReports: (params: { lat?: number; lon?: number; radiusKm?: number; minutes?: number; kind?: ReportKind } = {}) =>
    request<{ reports: Report[] }>('/v1/reports/recent', { query: params, auth: 'optional' }),

  createReport: (body: CreateReportBody) =>
    request<Report>('/v1/reports', { method: 'POST', body, auth: 'required' }),

  vote: (reportId: string, value: 1 | -1) =>
    request<Report>(`/v1/reports/${encodeURIComponent(reportId)}/vote`, {
      method: 'POST',
      body: { value },
      auth: 'required',
    }),

  /** "Inhalt melden" – nicht für eigene Meldungen (Server antwortet dann 400). */
  flagReport: (reportId: string, reason: FlagReason) =>
    request<void>(`/v1/reports/${encodeURIComponent(reportId)}/flag`, {
      method: 'POST',
      body: { reason },
      auth: 'required',
    }),

  deleteReport: (reportId: string) =>
    request<void>(`/v1/reports/${encodeURIComponent(reportId)}`, { method: 'DELETE', auth: 'required' }),

  // --- Live-Tracking ---------------------------------------------------------
  trackings: () => request<{ trackings: Tracking[] }>('/v1/trackings', { auth: 'required' }),

  createTracking: (body: CreateTrackingBody) =>
    request<Tracking>('/v1/trackings', { method: 'POST', body, auth: 'required' }),

  deleteTracking: (id: string) =>
    request<void>(`/v1/trackings/${encodeURIComponent(id)}`, { method: 'DELETE', auth: 'required' }),

  alerts: () => request<{ alerts: TrackingAlert[] }>('/v1/alerts', { auth: 'required' }),

  // --- Pendler-Modus (Strecken liegen auf dem Server, damit er sie im Hintergrund beobachten kann) ---
  commutes: () => request<{ commutes: Commute[] }>('/v1/commutes', { auth: 'required' }),

  createCommute: (body: CreateCommuteBody) =>
    request<Commute>('/v1/commutes', { method: 'POST', body, auth: 'required' }),

  updateCommute: (id: string, body: UpdateCommuteBody) =>
    request<Commute>(`/v1/commutes/${encodeURIComponent(id)}`, { method: 'PATCH', body, auth: 'required' }),

  deleteCommute: (id: string) =>
    request<void>(`/v1/commutes/${encodeURIComponent(id)}`, { method: 'DELETE', auth: 'required' }),

  /** Nächste Verbindung jetzt live geplant (mit Echtzeit und Streckenverlauf). */
  commutePreview: (id: string) =>
    request<CommutePreview>(`/v1/commutes/${encodeURIComponent(id)}/preview`, { auth: 'required' }),

  // --- Konto & Geräte --------------------------------------------------------
  /**
   * Passwort-Reset-Mail über den Server (eigenes Design, Resend). Ohne Login; Sprache über Accept-Language.
   * 204 auch, wenn es das Konto nicht gibt · 503 mail_not_configured · 429 · 400 ungültige E-Mail.
   */
  requestPasswordReset: (email: string) =>
    request<void>('/v1/auth/password-reset', { method: 'POST', body: { email }, auth: 'none' }),

  me: () => request<Me>('/v1/me', { auth: 'required' }),

  updateMe: (body: UpdateMeBody) => request<Me>('/v1/me', { method: 'PATCH', body, auth: 'required' }),

  acceptTerms: () => request<Me>('/v1/me', { method: 'PATCH', body: { acceptTerms: true }, auth: 'required' }),

  deleteMe: () => request<void>('/v1/me', { method: 'DELETE', auth: 'required' }),

  registerDevice: (token: string, platform: 'ios' | 'android' | 'web') =>
    request<void>('/v1/devices', { method: 'POST', body: { token, platform }, auth: 'required' }),

  unregisterDevice: (token: string) =>
    request<void>('/v1/devices', { method: 'DELETE', body: { token }, auth: 'required' }),

  // --- Feedback --------------------------------------------------------------
  /** Feedback an das Catch-Team. Login optional – mit Konto wird es dem Konto zugeordnet. */
  sendFeedback: (body: CreateFeedbackBody) =>
    request<CreateFeedbackResponse>('/v1/feedback', { method: 'POST', body, auth: 'optional' }),
};
