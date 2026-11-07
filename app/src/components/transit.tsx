// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { ActivityLevel, Line, Mode, ReportKind } from '@/api/contract';
import { t } from '@/i18n';
import { KIND_ICON } from '@/lib/kinds';
import { trackInfo, type TrackLabelOptions } from '@/lib/track';
import { colors, fonts, levelStyle, modeColor } from '@/theme';
import { AppText } from './ui';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const modeIcons: Record<Mode | 'WALK', IconName> = {
  BUS: 'bus',
  TRAM: 'tram',
  SUBWAY: 'subway-variant',
  SUBURBAN: 'train-variant',
  REGIONAL: 'train',
  LONG_DISTANCE: 'train-car',
  FERRY: 'ferry',
  OTHER: 'transit-connection-variant',
  WALK: 'walk',
};

export function ModeIcon({ mode, size = 20, color = colors.text }: { mode: Mode | 'WALK'; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={modeIcons[mode] ?? 'transit-connection-variant'} size={size} color={color} />;
}

function normalizeHex(c?: string): string | undefined {
  if (!c) return undefined;
  const v = c.startsWith('#') ? c : `#${c}`;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined;
}

function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 170;
}

/** Linien-Pill in Linienfarbe, z. B. [U8]. Optional mit Status-Punkt. */
export function LineBadge({
  line,
  size = 'md',
  level,
  kind,
  showIcon = false,
  style,
}: {
  line: Pick<Line, 'name' | 'mode' | 'color' | 'textColor' | 'onDemand'>;
  size?: 'sm' | 'md' | 'lg';
  level?: ActivityLevel;
  /** Art des neuesten Hinweises: wird bei "gerade gemeldet" als kleines Icon im Punkt gezeigt */
  kind?: ReportKind | null;
  showIcon?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = normalizeHex(line.color) ?? modeColor[line.mode] ?? modeColor.OTHER;
  const fg = normalizeHex(line.textColor) ?? (isLight(bg) ? colors.textOnLight : '#FFFFFF');
  const h = size === 'lg' ? 34 : size === 'sm' ? 22 : 28;
  const fs = size === 'lg' ? 16 : size === 'sm' ? 11.5 : 13.5;
  return (
    <View style={[styles.badgeWrap, style]}>
      <View style={[styles.badge, { backgroundColor: bg, height: h, paddingHorizontal: size === 'sm' ? 7 : 10 }]}>
        {showIcon ? <ModeIcon mode={line.mode} size={fs + 2} color={fg} /> : null}
        {/* Rufbus/AST: nur nach Bestellung */}
        {line.onDemand ? <Feather name="phone-call" size={fs - 1} color={fg} accessibilityLabel={t('onDemand.badge')} /> : null}
        <AppText style={{ fontFamily: fonts.extrabold, fontSize: fs, lineHeight: fs + 4, color: fg }} numberOfLines={1}>
          {line.name}
        </AppText>
      </View>
      {level === 'active' && kind ? (
        <View style={[styles.kindDot, { backgroundColor: levelStyle.active.color }]}>
          <MaterialCommunityIcons name={KIND_ICON[kind]} size={10} color={colors.textOnLight} />
        </View>
      ) : level ? (
        <StatusDot level={level} style={styles.dot} />
      ) : null}
    </View>
  );
}

/**
 * Gleis / Steig als kleine Marke, z. B. [Gl. 9] oder [Steig B1].
 * Gleiswechsel: orange "Gl. 9 (statt 7)".
 * `onColor` = auf farbigem Kartenkörper (Status-Karte in Fahrzeugfarbe).
 */
export function TrackTag({
  mode,
  track,
  plannedTrack,
  short,
  context,
  onColor = false,
  style,
}: {
  mode: Mode | 'WALK' | null | undefined;
  track?: string | null;
  plannedTrack?: string | null;
  onColor?: boolean;
  style?: StyleProp<ViewStyle>;
} & TrackLabelOptions) {
  const info = trackInfo(mode, track, plannedTrack, { short, context });
  if (!info) return null;
  const bg = info.changed
    ? onColor
      ? colors.orange
      : 'rgba(255,122,26,0.18)'
    : onColor
      ? 'rgba(255,255,255,0.18)'
      : 'rgba(255,255,255,0.10)';
  const fg = info.changed ? (onColor ? colors.textOnLight : colors.orange) : colors.text;
  return (
    <View style={[styles.track, { backgroundColor: bg }, style]} accessibilityLabel={info.text}>
      <AppText style={[styles.trackText, { color: fg }]} numberOfLines={1}>
        {info.text}
      </AppText>
    </View>
  );
}

export function StatusDot({ level, size = 10, style }: { level: ActivityLevel; size?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: levelStyle[level].color,
          borderWidth: 2,
          borderColor: colors.bg,
        },
        style,
      ]}
    />
  );
}

/** Gedrehtes Quadrat mit Icon (Bild 1). */
export function DiamondIcon({
  mode,
  size = 62,
  bg = colors.bg,
  iconColor,
  plain = false,
}: {
  mode: Mode | 'WALK';
  size?: number;
  bg?: string;
  iconColor: string;
  /** true = Icon direkt auf der Raute (ohne farbige Kachel) */
  plain?: boolean;
}) {
  const inner = size / Math.SQRT2;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: inner,
          height: inner,
          borderRadius: inner * 0.28,
          backgroundColor: bg,
          transform: [{ rotate: '45deg' }],
        }}
      />
      {plain ? (
        <ModeIcon mode={mode} size={22} color={iconColor} />
      ) : (
        <View style={[styles.iconTile, { backgroundColor: iconColor }]}>
          <ModeIcon mode={mode} size={19} color={bg} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badgeWrap: { flexDirection: 'row', alignSelf: 'flex-start' },
  badge: {
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 34,
  },
  dot: { position: 'absolute', top: -3, right: -3 },
  kindDot: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconTile: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  track: { borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2, flexShrink: 0 },
  trackText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'] },
});
