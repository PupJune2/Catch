// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Offline-Fahrpläne auf dem Gerät: Pakete + Metadaten.
 *
 * - Pakete (1–8 MB JSON je Stadt): App → <documentDirectory>/offline/<id>.json (expo-file-system),
 *   Web → IndexedDB. Siehe packageFiles(.native).ts. Atomar geschrieben (temp → umbenennen).
 * - Metadaten der installierten Pakete (klein): AsyncStorage "catch.offline.v1" (im Web localStorage).
 *   So kennt die App Gebiet, Gültigkeit und Größe, ohne ein Paket zu laden.
 *
 * Reihenfolge: erst Datei, dann Metadaten (beim Löschen umgekehrt). Verwaiste Dateien
 * (z. B. App-Abbruch zwischen den beiden Schritten) werden beim ersten Laden aufgeräumt.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { getLang, localeOf } from '@/i18n';
import { daysLeft, haversineM } from './raptor';
import { packageFiles } from './packageFiles';

export interface InstalledRegion {
  id: string;
  name: string;
  /** Mittelpunkt + Radius des Gebiets (für die Auswahl ohne das Paket zu laden) */
  lat: number;
  lon: number;
  radiusKm: number;
  builtAt: string;
  /** Erster und letzter gültiger Tag (Europe/Berlin), YYYY-MM-DD */
  validFrom: string;
  validUntil: string;
  days: number;
  /** Download-Größe (gzip) und Größe auf dem Gerät */
  sizeBytes: number;
  rawBytes: number;
  stops: number;
  trips: number;
  /** Quellenangabe (Lizenz: muss sichtbar bleiben) */
  attribution: string;
  installedAt: string;
}

const STORAGE_KEY = 'catch.offline.v1';

interface State {
  loaded: boolean;
  installed: InstalledRegion[];
}

let state: State = { loaded: false, installed: [] };
let loadPromise: Promise<InstalledRegion[]> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setInstalled(installed: InstalledRegion[]) {
  state = { loaded: true, installed: [...installed].sort((a, b) => a.name.localeCompare(b.name)) };
  emit();
}

function persist(): Promise<void> {
  return AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ regions: state.installed })).catch(() => undefined);
}

function isRegion(r: unknown): r is InstalledRegion {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.lat === 'number' &&
    typeof o.lon === 'number' &&
    typeof o.radiusKm === 'number' &&
    typeof o.builtAt === 'string' &&
    typeof o.validFrom === 'string' &&
    typeof o.days === 'number'
  );
}

async function load(): Promise<InstalledRegion[]> {
  let regions: InstalledRegion[] = [];
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const data = raw ? (JSON.parse(raw) as { regions?: unknown[] }) : null;
    regions = (data?.regions ?? []).filter(isRegion).map((r) => ({
      ...r,
      validUntil: r.validUntil || r.validFrom,
      sizeBytes: r.sizeBytes || 0,
      rawBytes: r.rawBytes || 0,
      stops: r.stops || 0,
      trips: r.trips || 0,
      attribution: r.attribution || '',
      installedAt: r.installedAt || r.builtAt,
    }));
  } catch {
    regions = [];
  }
  // Aufräumen: Dateien ohne Metadaten löschen, Metadaten ohne Datei vergessen
  try {
    const files = new Set(await packageFiles.list());
    for (const id of files) {
      if (!regions.some((r) => r.id === id)) await packageFiles.remove(id).catch(() => undefined);
    }
    const kept = regions.filter((r) => files.has(r.id));
    if (kept.length !== regions.length) {
      regions = kept;
      state = { ...state, installed: kept };
      await persist();
    }
  } catch {
    // Speicher (noch) nicht erreichbar – Metadaten trotzdem anzeigen
  }
  setInstalled(regions);
  return state.installed;
}

export const offlineStorage = {
  /** Metadaten laden (einmal je App-Start, inkl. Aufräumen). */
  ensureLoaded(): Promise<InstalledRegion[]> {
    if (state.loaded) return Promise.resolve(state.installed);
    if (!loadPromise) loadPromise = load();
    return loadPromise;
  },

  list(): InstalledRegion[] {
    return state.installed;
  },

  get(id: string): InstalledRegion | undefined {
    return state.installed.find((r) => r.id === id);
  },

  /** Paket speichern (ersetzt eine ältere Version derselben Stadt). */
  async save(meta: InstalledRegion, text: string): Promise<void> {
    await this.ensureLoaded();
    await packageFiles.write(meta.id, text);
    setInstalled([...state.installed.filter((r) => r.id !== meta.id), meta]);
    await persist();
  },

  read(id: string): Promise<string | null> {
    return packageFiles.read(id);
  },

  async remove(id: string): Promise<void> {
    await this.ensureLoaded();
    setInstalled(state.installed.filter((r) => r.id !== id));
    await persist();
    await packageFiles.remove(id).catch(() => undefined);
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  void offlineStorage.ensureLoaded();
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  return state;
}

/** Installierte Pakete (Metadaten), aktualisiert sich bei jeder Änderung. */
export function useInstalledRegions(): { loaded: boolean; installed: InstalledRegion[] } {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// ---------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------

/** Tage bis zum Ablauf (0 = heute letzter Tag, < 0 = abgelaufen). */
export function regionDaysLeft(r: Pick<InstalledRegion, 'validFrom' | 'days'>, now = Date.now()): number {
  return daysLeft(r, now);
}

/** Liegt der Punkt im Gebiet des Pakets? (wie raptor.covers, aber nur mit Metadaten) */
export function regionCovers(r: Pick<InstalledRegion, 'lat' | 'lon' | 'radiusKm'>, lat: number, lon: number): boolean {
  return haversineM(lat, lon, r.lat, r.lon) <= r.radiusKm * 1000 + 500;
}

/** Belegter Speicher aller Pakete (entpackt, so liegen sie auf dem Gerät). */
export function storageUsed(regions: InstalledRegion[]): number {
  return regions.reduce((sum, r) => sum + (r.rawBytes || 0), 0);
}

/** 742416 → "0.7 MB" / "0,7 MB", 120000 → "120 KB" */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  if (mb < 0.95) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  const digits = mb >= 100 ? 0 : 1;
  let s = mb.toFixed(digits);
  try {
    s = mb.toLocaleString(localeOf(getLang()), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  } catch {
    // Engine ohne Intl → Punkt als Dezimaltrenner
  }
  return `${s} MB`;
}
