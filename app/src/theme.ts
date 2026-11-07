// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import type { ActivityLevel, Mode } from '@/api/contract';
import { t, type TKey } from '@/i18n';

/** Farb-Tokens – dunkles Navy (Bild 1) mit Status-Farben. */
export const colors = {
  bg: '#16203A',
  raised: '#22304F',
  surface: '#22304F',
  surfaceAlt: '#2B3B60',
  surfaceDeep: '#111A30',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',
  text: '#FFFFFF',
  textMuted: '#8C97B2',
  textFaint: '#5E6A88',
  textOnLight: '#14203A',
  textOnLightMuted: 'rgba(20,32,58,0.62)',

  lime: '#C7E8A5',
  lilac: '#C9BBDA',
  orange: '#FF7A1A',
  cyan: '#2EC8E6',
  cream: '#FFF4EE',
  ghostFill: '#2F2C33',

  danger: '#FF6B5B',
  overlay: 'rgba(8,12,24,0.72)',
} as const;

export const spacing = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, xxxl: 40 } as const;

export const radius = { sm: 12, md: 18, card: 24, lg: 28, pill: 999 } as const;

export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

/** Status → Farbe & Label (Meldungslage einer Linie). */
// Labels als Getter: liefern immer die aktuelle App-Sprache.
export const levelStyle: Record<ActivityLevel, { color: string; label: string; short: string }> = {
  calm: { color: colors.lime, get label() { return t('level.calm'); }, get short() { return t('level.calm.short'); } },
  frequent: { color: colors.lilac, get label() { return t('level.frequent'); }, get short() { return t('level.frequent.short'); } },
  active: { color: colors.orange, get label() { return t('level.active'); }, get short() { return t('level.active.short'); } },
};

/** Fallback-Linienfarben, falls der Datensatz keine liefert. */
export const modeColor: Record<Mode, string> = {
  BUS: '#A5027D',
  TRAM: '#D82020',
  SUBWAY: '#115D91',
  SUBURBAN: '#008D4F',
  REGIONAL: '#EC0016',
  LONG_DISTANCE: '#3C3C3C',
  FERRY: '#309FD1',
  OTHER: '#5E6A88',
};

/**
 * Kartenfarbe je Verkehrsmittel (Körper der Status-Karten, weiße Schrift darauf).
 * Wie modeColor, nur dort etwas dunkler, wo weiße Schrift sonst unter 4,5:1 Kontrast fiele
 * (Tram, S-Bahn, Regionalzug, Fähre).
 */
export const modeSurface: Record<Mode, string> = {
  BUS: '#A5027D',
  TRAM: '#C41C1C',
  SUBWAY: '#115D91',
  SUBURBAN: '#007A45',
  REGIONAL: '#D30014',
  LONG_DISTANCE: '#3C3C3C',
  FERRY: '#1A759F',
  OTHER: '#5E6A88',
};

/** Verkehrsmittel-Name in der aktuellen Sprache. */
export function modeLabel(mode: Mode | 'WALK'): string {
  return t(`mode.${mode}` as TKey);
}

export const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.25,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 8,
} as const;
