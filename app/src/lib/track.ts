// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Gleis / Steig / Anleger – eine Stelle für Beschriftung und Gleiswechsel.
 *
 *   Bahn (Fern-, Regional-, S-, U-Bahn)  → "Gl. 17" / "Gleis 17"   (en: "Pl. 17" / "Platform 17")
 *   Bus, Tram, Sonstiges                 → "Steig B1"              (en: "Stop B1")
 *   Fähre                                → "Anleger 2"             (en: "Pier 2")
 *
 * Weicht das aktuelle Gleis vom planmäßigen ab, ist es ein Gleiswechsel ("Gl. 9 (statt 7)").
 */
import type { Mode } from '@/api/contract';
import { t, type TKey } from '@/i18n';

export type TrackKind = 'rail' | 'stop' | 'pier';

const RAIL_MODES: ReadonlySet<string> = new Set<Mode>(['LONG_DISTANCE', 'REGIONAL', 'SUBURBAN', 'SUBWAY']);

export function trackKind(mode: Mode | 'WALK' | null | undefined): TrackKind {
  if (mode && RAIL_MODES.has(mode)) return 'rail';
  if (mode === 'FERRY') return 'pier';
  return 'stop';
}

export interface TrackLabelOptions {
  /** Kurzform für enge Zeilen ("Gl. 9" statt "Gleis 9"). */
  short?: boolean;
  /** Im Verlauf einer Fahrt: "ab Gleis 17" (dep) / "an Steig B1" (arr). */
  context?: 'dep' | 'arr';
}

/** Beschriftung eines Gleises/Steigs je Verkehrsmittel. Leer, wenn kein Gleis bekannt ist. */
export function trackLabel(mode: Mode | 'WALK' | null | undefined, track: string | null | undefined, opts: TrackLabelOptions = {}): string {
  const value = track?.trim();
  if (!value) return '';
  const kind = trackKind(mode);
  const key = opts.context ? `track.${opts.context}.${kind}` : `track.${kind}${opts.short ? '.short' : ''}`;
  return t(key as TKey, { track: value });
}

function norm(v: string): string {
  return v.trim().toUpperCase();
}

/** true, wenn das aktuelle Gleis vom planmäßigen abweicht. */
export function trackChanged(d: { track?: string | null; plannedTrack?: string | null }): boolean {
  return !!d.track?.trim() && !!d.plannedTrack?.trim() && norm(d.track) !== norm(d.plannedTrack);
}

export interface TrackInfo {
  /** Anzeigetext inkl. Gleiswechsel, z. B. "Gl. 9 (statt 7)". */
  text: string;
  /** Nur die Beschriftung ohne Wechsel-Hinweis, z. B. "Gl. 9". */
  label: string;
  changed: boolean;
  planned?: string;
}

/**
 * Alles für die Anzeige: aktuelles Gleis (oder planmäßiges, falls kein aktuelles bekannt ist)
 * plus Gleiswechsel-Hinweis. null = kein Gleis bekannt.
 */
export function trackInfo(
  mode: Mode | 'WALK' | null | undefined,
  track: string | null | undefined,
  plannedTrack: string | null | undefined,
  opts: TrackLabelOptions = {},
): TrackInfo | null {
  const shown = track?.trim() || plannedTrack?.trim();
  if (!shown) return null;
  const label = trackLabel(mode, shown, opts);
  const changed = trackChanged({ track, plannedTrack });
  const planned = plannedTrack?.trim() || undefined;
  return {
    label,
    changed,
    planned,
    text: changed && planned ? t('track.changed', { label, planned }) : label,
  };
}
