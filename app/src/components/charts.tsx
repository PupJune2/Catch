// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { StyleSheet, View } from 'react-native';

import type { TimeWindow } from '@/api/contract';
import { useI18n, type TKey } from '@/i18n';
import { colors, radius, spacing } from '@/theme';
import { AppText } from './ui';

// ---------------------------------------------------------------------------
// StatStrip (Bild 3: dunkler Streifen mit 3 Werten)
// ---------------------------------------------------------------------------

export interface Stat {
  value: string;
  label: string;
  color?: string;
}

export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <View style={styles.strip}>
      {stats.map((s, i) => (
        <View key={s.label} style={[styles.stat, i > 0 && styles.statDivider]}>
          <AppText variant="title" color={s.color ?? colors.text} numberOfLines={1} adjustsFontSizeToFit>
            {s.value}
          </AppText>
          <AppText variant="small" muted numberOfLines={1}>
            {s.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stunden-Diagramm
// ---------------------------------------------------------------------------

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function hourInWindows(hour: number, windows: TimeWindow[]): boolean {
  const start = hour * 60;
  const end = start + 60;
  return windows.some((w) => {
    const a = toMinutes(w.from);
    let b = toMinutes(w.to);
    if (b <= a) b += 1440; // über Mitternacht
    const overlaps = (s: number, e: number) => s < b && e > a;
    return overlaps(start, end) || overlaps(start + 1440, end + 1440);
  });
}

export function HourChart({
  byHour,
  peakWindows = [],
  height = 96,
  currentHour,
}: {
  byHour: number[];
  peakWindows?: TimeWindow[];
  height?: number;
  currentHour?: number;
}) {
  const { t } = useI18n();
  const max = Math.max(1, ...byHour);
  return (
    <View>
      <View style={[styles.bars, { height }]}>
        {byHour.map((v, h) => {
          const peak = hourInWindows(h, peakWindows);
          const barH = v === 0 ? 3 : Math.max(6, (v / max) * height);
          return (
            <View key={h} style={styles.barCol}>
              <View
                style={{
                  height: barH,
                  borderRadius: 4,
                  backgroundColor: peak ? colors.lime : v === 0 ? colors.surfaceAlt : colors.lilac,
                  opacity: v === 0 ? 0.6 : 1,
                  borderWidth: h === currentHour ? 1.5 : 0,
                  borderColor: colors.cyan,
                }}
              />
            </View>
          );
        })}
      </View>
      <View style={styles.axis}>
        {['0', '6', '12', '18', '24'].map((l) => (
          <AppText key={l} variant="small" muted style={{ fontSize: 11 }}>
            {t('chart.hour', { h: l })}
          </AppText>
        ))}
      </View>
    </View>
  );
}

const WEEKDAY_KEYS = [0, 1, 2, 3, 4, 5, 6].map((i) => `wdm.${i}` as TKey);

export function WeekdayChart({ byWeekday }: { byWeekday: number[] }) {
  const { t } = useI18n();
  const WEEKDAYS = WEEKDAY_KEYS.map((k) => t(k));
  const max = Math.max(1, ...byWeekday);
  const top = byWeekday.indexOf(Math.max(...byWeekday));
  return (
    <View style={styles.weekRow}>
      {WEEKDAYS.map((d, i) => {
        const v = byWeekday[i] ?? 0;
        const isTop = v > 0 && i === top;
        return (
          <View key={d} style={styles.weekCol}>
            <AppText variant="smallStrong" color={isTop ? colors.lime : colors.textMuted} style={{ fontSize: 11 }}>
              {v}
            </AppText>
            <View style={styles.weekTrack}>
              <View
                style={{
                  height: `${Math.max(v === 0 ? 4 : 12, (v / max) * 100)}%`,
                  width: '100%',
                  borderRadius: 8,
                  backgroundColor: isTop ? colors.lime : v === 0 ? colors.surfaceAlt : colors.lilac,
                }}
              />
            </View>
            <AppText variant="smallStrong" muted>
              {d}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

/** Horizontaler Balken (z. B. für Hotspots). */
export function MiniBar({ value, max, color = colors.orange }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.max(0.06, value / max) : 0;
  return (
    <View style={styles.miniTrack}>
      <View style={[styles.miniFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceDeep,
    borderRadius: radius.card,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
  stat: { flex: 1, paddingHorizontal: spacing.sm, gap: 2 },
  statDivider: { borderLeftWidth: 1, borderLeftColor: colors.borderStrong },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  barCol: { flex: 1, justifyContent: 'flex-end' },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  weekRow: { flexDirection: 'row', gap: 8 },
  weekCol: { flex: 1, alignItems: 'center', gap: 6 },
  weekTrack: { height: 72, width: '100%', justifyContent: 'flex-end' },
  miniTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  miniFill: { height: '100%', borderRadius: 3 },
});
