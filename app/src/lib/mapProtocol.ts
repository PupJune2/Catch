// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Nachrichten zwischen App und Kartenseite (website/map/map.js).
 *
 * Transport:
 *  - Android/iOS (react-native-webview): App → Seite per `webView.postMessage(JSON-String)`
 *    (Android feuert das Event auf `document`, iOS auf `window`); Seite → App per
 *    `window.ReactNativeWebView.postMessage(JSON-String)`.
 *  - Web (iframe): beide Richtungen per `window.postMessage(objekt, origin)`; die App prüft die
 *    Origin der Kartenseite, die Seite nimmt nur Nachrichten von `window.parent` an (Origin der
 *    ersten Nachricht bzw. `ancestorOrigins`).
 *
 * Ablauf: Seite sendet `ready` → App antwortet mit `init` (auch nach einem Neuladen der Seite wieder).
 */
import type { Journey, MapStop, Report, ReportKind } from '@/api/contract';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface MapBounds {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

/** Von App-Elementen überdeckte Ränder in px (für Hinweise, Attribution, "Route einpassen"). */
export interface MapPadding {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export type MapSelection = { type: 'report' | 'stop'; id: string } | null;

/** App → Karte */
export type MapInMessage =
  | {
      type: 'init';
      lang: 'en' | 'de';
      /** Nur gleiche Origin wie die Kartenseite wird genutzt (CSP connect-src 'self'), sonst deren eigene Origin. */
      apiBase?: string;
      center?: LatLon;
      zoom?: number;
      user?: (LatLon & { accuracy?: number }) | null;
      journey?: Journey | null;
      /** null/leer = alle Arten */
      kinds?: ReportKind[] | null;
      padding?: MapPadding;
    }
  | { type: 'user'; lat: number; lon: number; accuracy?: number }
  | { type: 'kinds'; kinds: ReportKind[] | null }
  | { type: 'journey'; journey: Journey | null; fit?: boolean }
  | {
      type: 'fit';
      target?: 'journey' | 'user';
      center?: LatLon;
      zoom?: number;
      bounds?: MapBounds;
      animate?: boolean;
      /** Nur ausführen, wenn die Karte noch nicht von Hand bewegt wurde. */
      ifUntouched?: boolean;
    }
  | ({ type: 'padding' } & MapPadding)
  | { type: 'select'; selection: MapSelection }
  | { type: 'lang'; lang: 'en' | 'de' }
  | { type: 'refresh' };

/** Karte → App */
export type MapOutMessage =
  | { type: 'ready' }
  | { type: 'moved'; center: LatLon; zoom: number; bounds: MapBounds }
  /** Nach jedem Laden: Anzahl Hinweise je Art im Ausschnitt (ungefiltert). */
  | { type: 'data'; counts: Partial<Record<ReportKind, number>>; total: number; stopsHidden: boolean }
  | { type: 'report'; report: Report }
  | { type: 'stop'; stop: MapStop }
  /** Tippen auf eine freie Stelle */
  | { type: 'tap'; lat: number; lon: number }
  | { type: 'longpress'; lat: number; lon: number }
  | { type: 'error'; message: string };

const OUT_TYPES = new Set<MapOutMessage['type']>(['ready', 'moved', 'data', 'report', 'stop', 'tap', 'longpress', 'error']);

/** Nachricht der Karte prüfen (String oder Objekt) – Unbekanntes wird verworfen. */
export function parseMapMessage(data: unknown): MapOutMessage | null {
  let msg = data;
  if (typeof msg === 'string') {
    try {
      msg = JSON.parse(msg);
    } catch {
      return null;
    }
  }
  if (!msg || typeof msg !== 'object') return null;
  const type = (msg as { type?: unknown }).type;
  if (typeof type !== 'string' || !OUT_TYPES.has(type as MapOutMessage['type'])) return null;
  const m = msg as MapOutMessage;
  if (m.type === 'report' && (!m.report || typeof m.report.id !== 'string' || !m.report.line)) return null;
  if (m.type === 'stop' && (!m.stop || typeof m.stop.id !== 'string' || typeof m.stop.name !== 'string')) return null;
  return m;
}

/** "https://junify.live/map/" → "https://junify.live" */
export function originOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/i.exec(url);
  return m ? m[0].toLowerCase() : '';
}
