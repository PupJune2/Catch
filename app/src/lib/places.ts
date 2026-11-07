// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Gespeicherte Orte für die Von/Nach-Suche: "Zuhause", "Arbeit", ein paar Favoriten
 * und die zuletzt genutzten Orte.
 *
 * Datenschutz: liegt AUSSCHLIESSLICH auf dem Gerät (AsyncStorage, im Web localStorage)
 * und wird nie an den Server geschickt. Nur der Suchtext und – beim Planen – die gewählten
 * Start-/Ziel-Koordinaten gehen wie jede Suche an unseren Server.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { Mode, Place, PlaceKind, Stop } from '@/api/contract';
import { t } from '@/i18n';
import { shortStopName } from './format';

export type PlaceSlot = 'home' | 'work';

export interface SavedPlaces {
  home: Place | null;
  work: Place | null;
  favorites: Place[];
  /** Zuletzt genutzt, neueste zuerst. */
  recent: Place[];
}

/** Auswahl im Von/Nach-Feld. `current` = "Aktueller Standort" (Name = ermittelte Adresse). */
export interface PlaceChoice {
  place: Place;
  current?: boolean;
}

const STORAGE_KEY = 'catch.places.v1';
export const MAX_RECENT = 5;
export const MAX_FAVORITES = 8;

const EMPTY: SavedPlaces = { home: null, work: null, favorites: [], recent: [] };

let state: SavedPlaces = EMPTY;
let loaded = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

const KINDS: ReadonlySet<string> = new Set<PlaceKind>(['STOP', 'ADDRESS', 'POI']);

/** Nur bekannte Felder übernehmen – gespeicherte Daten könnten aus einer älteren Version stammen. */
function clean(raw: unknown): Place | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || !p.name) return null;
  if (typeof p.kind !== 'string' || !KINDS.has(p.kind)) return null;
  if (typeof p.lat !== 'number' || typeof p.lon !== 'number' || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  const out: Place = { kind: p.kind as PlaceKind, id: p.id, name: p.name.slice(0, 160), lat: p.lat, lon: p.lon };
  if (typeof p.detail === 'string' && p.detail) out.detail = p.detail.slice(0, 160);
  if (Array.isArray(p.modes)) out.modes = p.modes.filter((m): m is Mode => typeof m === 'string');
  return out;
}

function cleanList(raw: unknown, max: number): Place[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const r of raw) {
    const p = clean(r);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
    if (out.length >= max) break;
  }
  return out;
}

function emit() {
  for (const l of listeners) l();
}

function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const data = JSON.parse(raw) as Partial<Record<keyof SavedPlaces, unknown>>;
        state = {
          home: clean(data.home),
          work: clean(data.work),
          favorites: cleanList(data.favorites, MAX_FAVORITES),
          recent: cleanList(data.recent, MAX_RECENT),
        };
      })
      .catch(() => undefined)
      .finally(() => {
        loaded = true;
        emit();
      });
  }
  return loadPromise;
}

/** Erst laden, dann ändern – sonst würde ein früher Schreibzugriff gespeicherte Orte überschreiben. */
function update(fn: (prev: SavedPlaces) => SavedPlaces): Promise<void> {
  return ensureLoaded().then(() => {
    state = fn(state);
    emit();
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => undefined);
  });
}

function strip(place: Place): Place {
  // Entfernung gilt nur für die eine Suche → nicht mitspeichern
  return clean(place) ?? place;
}

export const savedPlaces = {
  setSlot(slot: PlaceSlot, place: Place | null) {
    return update((s) => ({ ...s, [slot]: place ? strip(place) : null }));
  },
  addFavorite(place: Place) {
    return update((s) => ({
      ...s,
      favorites: [strip(place), ...s.favorites.filter((p) => p.id !== place.id)].slice(0, MAX_FAVORITES),
    }));
  },
  removeFavorite(id: string) {
    return update((s) => ({ ...s, favorites: s.favorites.filter((p) => p.id !== id) }));
  },
  /** Zuletzt genutzt: vorne einfügen, Duplikate entfernen, max. 5. */
  pushRecent(place: Place) {
    return update((s) => ({
      ...s,
      recent: [strip(place), ...s.recent.filter((p) => p.id !== place.id)].slice(0, MAX_RECENT),
    }));
  },
  removeRecent(id: string) {
    return update((s) => ({ ...s, recent: s.recent.filter((p) => p.id !== id) }));
  },
  clearRecent() {
    return update((s) => ({ ...s, recent: [] }));
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  void ensureLoaded();
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  return state;
}

/** Gespeicherte Orte (aktualisiert sich bei jeder Änderung, in allen Komponenten). */
export function useSavedPlaces(): SavedPlaces {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function slotOf(saved: SavedPlaces, id: string): PlaceSlot | null {
  if (saved.home?.id === id) return 'home';
  if (saved.work?.id === id) return 'work';
  return null;
}

export function isFavorite(saved: SavedPlaces, id: string): boolean {
  return saved.favorites.some((p) => p.id === id);
}

export function slotLabel(slot: PlaceSlot): string {
  return slot === 'home' ? t('place.home') : t('place.work');
}

/** Anzeigename: bei Haltestellen ohne Orts-Zusatz in Klammern. */
export function placeTitle(place: Place | null | undefined): string {
  if (!place) return t('common.unknown');
  return place.kind === 'STOP' ? shortStopName(place.name) : place.name;
}

/** Titel im Von/Nach-Feld: "Aktueller Standort" statt der ermittelten Adresse. */
export function choiceTitle(choice: PlaceChoice | null | undefined): string {
  if (!choice) return t('common.unknown');
  return choice.current ? t('place.currentLocation') : placeTitle(choice.place);
}

/** Name, den der Server für Fußwege zu/von Koordinaten verwendet (nur bei Adressen/Orten nötig). */
export function journeyName(choice: PlaceChoice): string | undefined {
  if (choice.place.kind === 'STOP') return undefined;
  return choice.place.name.slice(0, 120);
}

export function placeToStop(place: Place): Stop {
  return { id: place.id, name: place.name, lat: place.lat, lon: place.lon, modes: place.modes };
}
