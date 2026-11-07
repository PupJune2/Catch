// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Auswahl für das Homescreen-Widget (Android): eine Haltestelle + optional eine hervorgehobene Linie.
 *
 * Liegt in AsyncStorage, damit der Widget-Task (Headless JS, ohne laufende App) sie lesen kann.
 * Im Web/auf iOS wird die Auswahl auch gespeichert (Vorschau in den Einstellungen), es gibt dort
 * aber kein Widget.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { Line, Mode } from '@/api/contract';

export const WIDGET_CONFIG_KEY = 'catch.widget.v1';

export interface WidgetStop {
  id: string;
  name: string;
  modes?: Mode[];
}

export type WidgetLine = Pick<Line, 'key' | 'name' | 'mode' | 'color' | 'textColor'>;

export interface WidgetConfig {
  stop: WidgetStop | null;
  line: WidgetLine | null;
  updatedAt: string | null;
}

const EMPTY: WidgetConfig = { stop: null, line: null, updatedAt: null };

let state: WidgetConfig = EMPTY;
let loaded = false;
let loadPromise: Promise<WidgetConfig> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function parse(raw: string | null): WidgetConfig {
  if (!raw) return EMPTY;
  try {
    const d = JSON.parse(raw) as Partial<WidgetConfig>;
    const stop = d.stop && typeof d.stop.id === 'string' && typeof d.stop.name === 'string' ? d.stop : null;
    const line =
      d.line && typeof d.line.key === 'string' && typeof d.line.name === 'string' && typeof d.line.mode === 'string' ? d.line : null;
    return { stop, line, updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : null };
  } catch {
    return EMPTY;
  }
}

/** Frisch aus dem Speicher lesen (für den Widget-Task – dort gibt es keinen App-Zustand). */
export async function readWidgetConfig(): Promise<WidgetConfig> {
  try {
    return parse(await AsyncStorage.getItem(WIDGET_CONFIG_KEY));
  } catch {
    return EMPTY;
  }
}

function ensureLoaded(): Promise<WidgetConfig> {
  if (loaded) return Promise.resolve(state);
  if (!loadPromise) {
    loadPromise = readWidgetConfig().then((c) => {
      state = { ...c };
      loaded = true;
      emit();
      return c;
    });
  }
  return loadPromise;
}

export async function getWidgetConfig(): Promise<WidgetConfig> {
  return ensureLoaded();
}

export async function saveWidgetConfig(patch: Partial<Omit<WidgetConfig, 'updatedAt'>>): Promise<WidgetConfig> {
  await ensureLoaded();
  state = { ...state, ...patch, updatedAt: new Date().toISOString() };
  emit();
  await AsyncStorage.setItem(WIDGET_CONFIG_KEY, JSON.stringify(state)).catch(() => undefined);
  return state;
}

export function widgetLineOf(line: Line | WidgetLine): WidgetLine {
  return { key: line.key, name: line.name, mode: line.mode, color: line.color, textColor: line.textColor };
}

export function useWidgetConfig(): WidgetConfig & { loaded: boolean } {
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
