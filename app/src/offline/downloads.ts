// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Städte-Liste vom Server, Herunterladen/Aktualisieren/Löschen von Offline-Fahrplänen.
 * Fortschritt laufender Downloads liegt hier (nicht im Screen), damit er beim Verlassen
 * und Wiederöffnen der Einstellungen erhalten bleibt.
 */
import { useSyncExternalStore } from 'react';

import { ApiError, request } from '@/api/client';
import type { OfflineIndexEntry, OfflinePackage, OfflineRegionsResponse } from '@/api/contract';
import { API_URL } from '@/config';
import { getLang, t } from '@/i18n';
import { berlinMidnight } from './raptor';
import { offlineStorage, regionDaysLeft, type InstalledRegion } from './storage';

/** Paketformate, die diese App-Version lesen kann. */
const SUPPORTED_VERSIONS = [1];
/** "Aktualisieren" anbieten, wenn das Paket in so vielen Tagen abläuft (und es ein neueres gibt). */
export const UPDATE_WITHIN_DAYS = 4;

export interface DownloadState {
  /** 0…1, bzw. null solange die Größe unbekannt ist */
  progress: number | null;
  phase: 'download' | 'save';
}

let downloads: Record<string, DownloadState> = {};
const running = new Map<string, Promise<InstalledRegion>>();
const listeners = new Set<() => void>();

function setDownload(id: string, d: DownloadState | null) {
  const next = { ...downloads };
  if (d) next[id] = d;
  else delete next[id];
  downloads = next;
  for (const l of listeners) l();
}

/** Laufende Downloads (id → Fortschritt). */
export function useDownloads(): Record<string, DownloadState> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => downloads,
    () => downloads,
  );
}

// ---------------------------------------------------------------------------
// Städte-Liste
// ---------------------------------------------------------------------------

let lastIndex: OfflineRegionsResponse | null = null;

/** Zuletzt geladene Städte-Liste dieser Sitzung (für sofortige Anzeige beim Wiederöffnen). */
export function cachedRegionIndex(): OfflineRegionsResponse | null {
  return lastIndex;
}

export async function fetchRegionIndex(): Promise<OfflineRegionsResponse> {
  const res = await request<OfflineRegionsResponse>('/v1/offline/regions');
  lastIndex = { ...res, regions: res.regions ?? [] };
  return lastIndex;
}

/** Gibt es auf dem Server eine neuere Version, die sich lohnt? */
export function updateAvailable(local: InstalledRegion, remote: OfflineIndexEntry | undefined, now = Date.now()): boolean {
  if (!remote) return false;
  if (remote.builtAt > local.builtAt) return true;
  return regionDaysLeft(local, now) <= UPDATE_WITHIN_DAYS && remote.validUntil > local.validUntil;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * GET als Text mit Fortschritt (XMLHttpRequest – fetch meldet in React Native keinen Fortschritt).
 * Der Server schickt gzip; Browser und OkHttp entpacken selbst.
 */
function fetchText(url: string, expectedRaw: number, onProgress: (p: number | null) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    // Manche Umgebungen zählen entpackte Bytes (ohne Gesamtgröße) – dann gegen die entpackte Größe rechnen
    let rawUnits = false;
    xhr.open('GET', url);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Accept-Language', getLang());
    xhr.responseType = 'text';
    xhr.timeout = 180_000;
    xhr.onprogress = (e) => {
      if (!rawUnits && e.lengthComputable && e.total > 0 && e.loaded <= e.total) onProgress(e.loaded / e.total);
      else {
        rawUnits = true;
        onProgress(expectedRaw > 0 ? Math.min(0.99, e.loaded / expectedRaw) : null);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText);
        return;
      }
      let message: string | undefined;
      try {
        message = (JSON.parse(xhr.responseText) as { message?: string }).message;
      } catch {
        message = undefined;
      }
      if (xhr.status === 429) message = t('offline.err.rateLimit');
      else if (xhr.status === 404) message = t('offline.err.gone');
      reject(new ApiError(xhr.status, `http_${xhr.status}`, message ?? t('err.unexpected', { status: xhr.status })));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', t('err.network')));
    xhr.ontimeout = () => reject(new ApiError(0, 'network', t('err.network')));
    xhr.send();
  });
}

function validate(data: unknown, id: string): OfflinePackage {
  const p = data as Partial<OfflinePackage> | null;
  if (!p || typeof p !== 'object' || typeof p.v !== 'number') throw new ApiError(0, 'offline_invalid', t('offline.err.invalid'));
  if (!SUPPORTED_VERSIONS.includes(p.v)) throw new ApiError(0, 'offline_version', t('offline.err.version'));
  if (
    p.region?.id !== id ||
    typeof p.validFrom !== 'string' ||
    typeof p.days !== 'number' ||
    !Array.isArray(p.stops) ||
    !Array.isArray(p.patterns) ||
    !Array.isArray(p.routes) ||
    !Array.isArray(p.transfers)
  ) {
    throw new ApiError(0, 'offline_invalid', t('offline.err.invalid'));
  }
  return p as OfflinePackage;
}

function lastDay(validFrom: string, days: number): string {
  // Mittag des letzten Tages → Datum unabhängig von der Zeitzone
  return new Date(berlinMidnight(validFrom, Math.max(0, days - 1)) + 12 * 3600_000).toISOString().slice(0, 10);
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/** Paket herunterladen (oder aktualisieren). Läuft schon ein Download dieser Stadt, wird er geteilt. */
export function downloadRegion(entry: OfflineIndexEntry, attribution?: string): Promise<InstalledRegion> {
  const existing = running.get(entry.id);
  if (existing) return existing;
  const job = (async () => {
    setDownload(entry.id, { progress: 0, phase: 'download' });
    try {
      const text = await fetchText(`${API_URL}/v1/offline/regions/${encodeURIComponent(entry.id)}`, entry.rawBytes, (progress) =>
        setDownload(entry.id, { progress, phase: 'download' }),
      );
      setDownload(entry.id, { progress: 1, phase: 'save' });
      await yieldToUi();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new ApiError(0, 'offline_invalid', t('offline.err.invalid'));
      }
      const pkg = validate(parsed, entry.id);
      const meta: InstalledRegion = {
        id: entry.id,
        name: entry.name || pkg.region.name,
        lat: pkg.region.lat,
        lon: pkg.region.lon,
        radiusKm: pkg.region.radiusKm,
        // Stand laut Städte-Liste (damit der Vergleich "neuere Version?" exakt passt)
        builtAt: entry.builtAt || pkg.builtAt,
        validFrom: pkg.validFrom,
        validUntil: lastDay(pkg.validFrom, pkg.days),
        days: pkg.days,
        sizeBytes: entry.sizeBytes,
        rawBytes: entry.rawBytes || text.length,
        stops: entry.stops || pkg.stops.length,
        trips: entry.trips,
        attribution: pkg.attribution || attribution || '',
        installedAt: new Date().toISOString(),
      };
      try {
        await offlineStorage.save(meta, text);
      } catch {
        throw new ApiError(0, 'offline_storage', t('offline.err.storage'));
      }
      return meta;
    } finally {
      setDownload(entry.id, null);
      running.delete(entry.id);
    }
  })();
  running.set(entry.id, job);
  return job;
}

export function deleteRegion(id: string): Promise<void> {
  return offlineStorage.remove(id);
}
