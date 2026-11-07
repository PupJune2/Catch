// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import * as Location from 'expo-location';

import { t } from '@/i18n';

export interface Coords {
  lat: number;
  lon: number;
  /** Genauigkeit in Metern (falls bekannt). */
  accuracy?: number;
}

function toCoords(pos: Location.LocationObject): Coords {
  const { latitude, longitude, accuracy } = pos.coords;
  return accuracy != null && accuracy > 0 ? { lat: latitude, lon: longitude, accuracy } : { lat: latitude, lon: longitude };
}

export type LocationResult = { ok: true; coords: Coords } | { ok: false; reason: 'denied' | 'unavailable' };

/** Fragt (nur im Vordergrund) nach dem Standort. Liefert nie einen Fehler, sondern einen Grund. */
export async function getCurrentCoords(): Promise<LocationResult> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return { ok: false, reason: 'denied' };
    const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 }).catch(() => null);
    if (last) return { ok: true, coords: toCoords(last) };
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { ok: true, coords: toCoords(pos) };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** Ohne Nachfrage: nur wenn die Berechtigung schon erteilt ist. */
export async function getCoordsIfPermitted(): Promise<Coords | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const res = await getCurrentCoords();
    return res.ok ? res.coords : null;
  } catch {
    return null;
  }
}

/**
 * Laufende Standort-Updates (z. B. für die Karte) – nur, wenn die Berechtigung schon erteilt ist,
 * fragt also nie nach. Liefert eine Funktion zum Beenden.
 */
export async function watchCoords(onCoords: (c: Coords) => void): Promise<() => void> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return () => undefined;
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: 10, timeInterval: 5000 },
      (pos) => onCoords(toCoords(pos)),
    );
    return () => sub.remove();
  } catch {
    return () => undefined;
  }
}

export function locationDeniedText(): string {
  return t('location.denied');
}
