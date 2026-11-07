// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Automatische Aktualisierung heruntergeladener Offline-Fahrpläne.
 *
 * Läuft von drei Stellen aus (alle teilen dieselbe Prüfung und dieselben Sperren):
 *  - Hintergrund-Task (expo-background-task → WorkManager auf Android, BGTaskScheduler auf iOS), etwa täglich
 *  - beim App-Start und wenn die App wieder in den Vordergrund kommt (falls das System Hintergrund-Arbeit drosselt)
 *  - im Web nur beim Start (dort gibt es keinen Hintergrund-Task)
 *
 * Regeln:
 *  - nur wenn die Einstellung an ist (Standard: an) und mindestens eine Stadt installiert ist
 *  - nur im WLAN/Ethernet (App: expo-network). Nie über mobile Daten. Im Web: nicht bei
 *    navigator.connection.type "cellular" oder aktivem Datensparmodus.
 *  - höchstens einmal am Tag (MIN_GAP_MS – etwas unter 24 h, damit ein täglicher Hintergrund-Lauf,
 *    der ein paar Minuten zu früh kommt, nicht einen ganzen Tag überspringt)
 *  - Pakete nacheinander; bei 429 (Download-Limit des Servers) sofort aufhören
 *  - Fehler werden nur still vermerkt (keine Toasts, keine Push-Nachrichten)
 *
 * Zustand (klein): AsyncStorage "catch.offline.auto.v1" (im Web localStorage).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { ApiError } from '@/api/client';
import { downloadRegion, fetchRegionIndex, updateAvailable } from './downloads';
import { forgetPrepared } from './engine';
import { offlineStorage } from './storage';

export const AUTO_UPDATE_KEY = 'catch.offline.auto.v1';
/** Mindestabstand zwischen zwei automatischen Prüfungen. */
export const MIN_GAP_MS = 20 * 3600_000;
/** Nach einem fehlgeschlagenen Versuch frühestens so viel später erneut. */
const ERROR_RETRY_MS = 3600_000;

export interface AutoUpdateState {
  /** Einstellung "Automatisch im WLAN aktualisieren" (Standard: an) */
  enabled: boolean;
  /** Letzte echte Prüfung (Städte-Liste geladen), ISO */
  lastCheckAt: string | null;
  /** Letzte automatische Aktualisierung mindestens einer Stadt, ISO */
  lastUpdateAt: string | null;
  /** Namen der dabei aktualisierten Städte */
  lastUpdated: string[];
  /** Letzter Versuch fehlgeschlagen (wird beim nächsten Erfolg zurückgesetzt) */
  lastError: string | null;
  lastErrorAt: string | null;
}

export type AutoUpdateTrigger = 'background' | 'foreground' | 'start';

export type AutoUpdateOutcome =
  | 'disabled'
  | 'nothing_installed'
  | 'too_soon'
  | 'not_wifi'
  | 'offline'
  | 'up_to_date'
  | 'updated'
  | 'failed'
  | 'busy';

const DEFAULTS: AutoUpdateState = {
  enabled: true,
  lastCheckAt: null,
  lastUpdateAt: null,
  lastUpdated: [],
  lastError: null,
  lastErrorAt: null,
};

let state: AutoUpdateState = DEFAULTS;
let loaded = false;
let loadPromise: Promise<AutoUpdateState> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function log(...args: unknown[]) {
  if (__DEV__) console.log('[offline-auto]', ...args);
}

async function load(): Promise<AutoUpdateState> {
  try {
    const raw = await AsyncStorage.getItem(AUTO_UPDATE_KEY);
    const data = raw ? (JSON.parse(raw) as Partial<AutoUpdateState>) : null;
    if (data && typeof data === 'object') {
      state = {
        enabled: data.enabled !== false,
        lastCheckAt: typeof data.lastCheckAt === 'string' ? data.lastCheckAt : null,
        lastUpdateAt: typeof data.lastUpdateAt === 'string' ? data.lastUpdateAt : null,
        lastUpdated: Array.isArray(data.lastUpdated) ? data.lastUpdated.filter((n) => typeof n === 'string') : [],
        lastError: typeof data.lastError === 'string' ? data.lastError : null,
        lastErrorAt: typeof data.lastErrorAt === 'string' ? data.lastErrorAt : null,
      };
    }
  } catch {
    state = DEFAULTS;
  }
  loaded = true;
  // Neues Objekt, damit useSyncExternalStore auch ohne gespeicherte Werte neu rendert
  state = { ...state };
  emit();
  return state;
}

function ensureLoaded(): Promise<AutoUpdateState> {
  if (loaded) return Promise.resolve(state);
  if (!loadPromise) loadPromise = load();
  return loadPromise;
}

async function patch(p: Partial<AutoUpdateState>): Promise<void> {
  await ensureLoaded();
  state = { ...state, ...p };
  emit();
  await AsyncStorage.setItem(AUTO_UPDATE_KEY, JSON.stringify(state)).catch(() => undefined);
}

export function getAutoUpdateState(): Promise<AutoUpdateState> {
  return ensureLoaded();
}

export async function setAutoUpdateEnabled(enabled: boolean): Promise<void> {
  await patch({ enabled });
}

/** Einstellung + letzter Lauf für die Anzeige (aktualisiert sich bei jeder Änderung). */
export function useAutoUpdateState(): AutoUpdateState & { loaded: boolean } {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      void ensureLoaded();
      return () => {
        listeners.delete(l);
      };
    },
    () => state,
    () => state,
  );
  return { ...s, loaded };
}

// ---------------------------------------------------------------------------
// Netz
// ---------------------------------------------------------------------------

type WebConnection = { type?: string; saveData?: boolean };

/** Ist jetzt ein (wahrscheinlich) ungetaktetes Netz da? */
export async function onUnmeteredNetwork(): Promise<'ok' | 'not_wifi' | 'offline'> {
  if (Platform.OS === 'web') {
    if (typeof navigator === 'undefined') return 'offline';
    if (navigator.onLine === false) return 'offline';
    // Network Information API: nur Chrome/Android kennt den Typ – Desktop-Browser melden keinen
    const conn = (navigator as Navigator & { connection?: WebConnection }).connection;
    if (conn?.saveData) return 'not_wifi';
    if (conn?.type === 'cellular') return 'not_wifi';
    return 'ok';
  }
  try {
    const net = await Network.getNetworkStateAsync();
    if (!net.isConnected || net.isInternetReachable === false) return 'offline';
    if (net.type === Network.NetworkStateType.WIFI || net.type === Network.NetworkStateType.ETHERNET) return 'ok';
    return 'not_wifi';
  } catch {
    // Netzstatus unbekannt → lieber nichts herunterladen
    return 'not_wifi';
  }
}

// ---------------------------------------------------------------------------
// Lauf
// ---------------------------------------------------------------------------

let running: Promise<AutoUpdateOutcome> | null = null;

function isRateLimited(e: unknown): boolean {
  return e instanceof ApiError && e.status === 429;
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}:${e.code}`;
  if (e instanceof Error) return e.message.slice(0, 120);
  return 'unknown';
}

async function run(trigger: AutoUpdateTrigger, now: number): Promise<AutoUpdateOutcome> {
  const s = await ensureLoaded();
  if (!s.enabled) return 'disabled';
  const installed = await offlineStorage.ensureLoaded();
  if (installed.length === 0) return 'nothing_installed';
  if (s.lastCheckAt && now - new Date(s.lastCheckAt).getTime() < MIN_GAP_MS) return 'too_soon';
  // Nach einem Fehler (Server nicht erreichbar o. Ä.) frühestens nach einer Stunde wieder
  if (s.lastErrorAt && now - new Date(s.lastErrorAt).getTime() < ERROR_RETRY_MS) return 'too_soon';

  const net = await onUnmeteredNetwork();
  if (net !== 'ok') return net;

  log(`check (${trigger})`);
  let index;
  try {
    index = await fetchRegionIndex();
  } catch (e) {
    // Kein Netz trotz WLAN (Captive Portal o. Ä.) → nicht als Prüfung zählen, nächstes Mal wieder
    log('index failed', errorText(e));
    await patch({ lastError: errorText(e), lastErrorAt: new Date(now).toISOString() });
    return 'failed';
  }
  if (!index.available) {
    await patch({ lastCheckAt: new Date(now).toISOString() });
    return 'up_to_date';
  }

  const remote = new Map(index.regions.map((r) => [r.id, r]));
  const due = installed.filter((r) => updateAvailable(r, remote.get(r.id), now));
  const updated: string[] = [];
  let failure: unknown = null;
  // Nacheinander – schont Speicher und das Download-Limit (30/h je IP)
  for (const r of due) {
    const entry = remote.get(r.id);
    if (!entry) continue;
    try {
      const meta = await downloadRegion(entry, index.attribution);
      forgetPrepared(entry.id);
      updated.push(meta.name);
      log('updated', entry.id);
    } catch (e) {
      failure = e;
      log('download failed', entry.id, errorText(e));
      if (isRateLimited(e)) break;
    }
  }

  const iso = new Date(now).toISOString();
  await patch({
    // Teilweise fehlgeschlagen → trotzdem als Prüfung zählen (nicht stündlich neu versuchen)
    lastCheckAt: iso,
    ...(updated.length ? { lastUpdateAt: iso, lastUpdated: updated } : {}),
    lastError: failure ? errorText(failure) : null,
    lastErrorAt: failure ? iso : null,
  });
  if (updated.length) return 'updated';
  return failure ? 'failed' : 'up_to_date';
}

/**
 * Prüft (höchstens einmal am Tag, nur im WLAN) und aktualisiert installierte Städte.
 * Läuft schon ein Lauf, wird kein zweiter gestartet. Wirft nie.
 */
export function runAutoUpdate(trigger: AutoUpdateTrigger, now = Date.now()): Promise<AutoUpdateOutcome> {
  if (running) return Promise.resolve<AutoUpdateOutcome>('busy');
  running = run(trigger, now)
    .catch((e: unknown) => {
      log('unexpected', errorText(e));
      return 'failed' as const;
    })
    .finally(() => {
      running = null;
    });
  return running;
}
