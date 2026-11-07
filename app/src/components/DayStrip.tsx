// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useI18n, type TKey } from '@/i18n';
import { colors, fonts, radius } from '@/theme';
import { AppText } from './ui';

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Tages-Auswahl wie in Bild 1 ("12 Wed" in Lime). */
export function DayStrip({ value, onChange, days = 14 }: { value: Date; onChange: (d: Date) => void; days?: number }) {
  const { t } = useI18n();
  const today = startOfDay(new Date());
  const items = Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {items.map((d, i) => {
        const selected = sameDay(d, value);
        return (
          <Pressable
            key={d.toISOString()}
            onPress={() => onChange(d)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={({ pressed }) => [styles.day, selected && styles.daySelected, pressed && { opacity: 0.8 }]}>
            <AppText
              style={[styles.dayNum, { color: selected ? colors.textOnLight : colors.text, opacity: selected ? 1 : 0.85 }]}>
              {d.getDate()}
            </AppText>
            <AppText variant="small" color={selected ? colors.textOnLight : colors.textMuted}>
              {i === 0 ? t('common.today') : t(`wd.${d.getDay()}` as TKey)}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Uhrzeit-Auswahl mit ±-Schritten (funktioniert identisch auf iOS, Android und Web). */
export function TimeStepper({
  hours,
  minutes,
  onChange,
  step = 10,
}: {
  hours: number;
  minutes: number;
  onChange: (h: number, m: number) => void;
  step?: number;
}) {
  const { t } = useI18n();
  const shift = (delta: number) => {
    let total = hours * 60 + minutes + delta;
    total = ((total % 1440) + 1440) % 1440;
    onChange(Math.floor(total / 60), total % 60);
  };
  return (
    <View style={styles.stepper}>
      <Pressable onPress={() => shift(-step)} hitSlop={6} style={styles.stepBtn} accessibilityLabel={t('day.earlier', { n: step })}>
        <Feather name="minus" size={18} color={colors.text} />
      </Pressable>
      <AppText style={styles.time}>
        {pad(hours)}:{pad(minutes)}
      </AppText>
      <Pressable onPress={() => shift(step)} hitSlop={6} style={styles.stepBtn} accessibilityLabel={t('day.later', { n: step })}>
        <Feather name="plus" size={18} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 10, paddingVertical: 6, paddingHorizontal: 2, alignItems: 'center' },
  day: {
    width: 62,
    height: 86,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(17,26,48,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  daySelected: { backgroundColor: colors.lime, height: 102 },
  dayNum: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceDeep,
    borderRadius: radius.pill,
    height: 48,
    paddingHorizontal: 6,
    gap: 4,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  time: { fontFamily: fonts.bold, fontSize: 18, minWidth: 64, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
