// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Datum & Uhrzeit wählen: ein kompaktes Feld ("Heute, 19:25 · Abfahrt") öffnet ein Sheet mit
 * Schnellwahl (Jetzt, In 15 Min …), Monatskalender und Stunden-/Minuten-Raster.
 * Jede Uhrzeit ist mit zwei Taps erreicht – identisch auf Android, iOS und Web.
 */
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { localeOf, useI18n, type TKey } from '@/i18n';
import { colors, fonts, radius, spacing } from '@/theme';
import { sameDay, startOfDay } from './DayStrip';
import { AppText, Button } from './ui';

export interface When {
  /** Tag (lokale Mitternacht) */
  day: Date;
  hours: number;
  minutes: number;
  /** "Jetzt": Uhrzeit läuft mit (keine feste Zeit an den Server) */
  isNow: boolean;
  arriveBy: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Jetzt, auf die nächsten 5 Minuten gerundet. */
export function nowWhen(arriveBy = false): When {
  const d = new Date();
  const total = Math.ceil((d.getHours() * 60 + d.getMinutes()) / 5) * 5;
  const day = startOfDay(d);
  if (total >= 1440) day.setDate(day.getDate() + 1);
  return { day, hours: Math.floor(total / 60) % 24, minutes: total % 60, isNow: true, arriveBy };
}

function addMinutes(base: Date, min: number): { day: Date; hours: number; minutes: number } {
  const d = new Date(base.getTime() + min * 60_000);
  const m = Math.round(d.getMinutes() / 5) * 5;
  d.setMinutes(m, 0, 0);
  return { day: startOfDay(d), hours: d.getHours(), minutes: d.getMinutes() };
}

/** "Heute" / "Morgen" / "Mo, 9.11." */
function dayLabel(day: Date, t: (k: TKey, p?: Record<string, string | number>) => string): string {
  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (sameDay(day, today)) return t('common.today');
  if (sameDay(day, tomorrow)) return t('when.tomorrow');
  return `${t(`wd.${day.getDay()}` as TKey)}, ${day.getDate()}.${day.getMonth() + 1}.`;
}

// ---------------------------------------------------------------------------
// Feld im Formular
// ---------------------------------------------------------------------------

export function WhenField({ value, showArriveBy, onPress }: { value: When; showArriveBy: boolean; onPress: () => void }) {
  const { t } = useI18n();
  const main = value.isNow && sameDay(value.day, new Date()) ? t('search.now') : `${dayLabel(value.day, t)}, ${pad(value.hours)}:${pad(value.minutes)}`;
  const sub = showArriveBy ? (value.arriveBy ? t('search.arrival') : t('search.departure')) : t('when.departures');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('when.fieldA11y')}: ${main}, ${sub}`}
      onPress={onPress}
      style={({ pressed }) => [styles.field, pressed && { opacity: 0.85 }]}>
      <View style={styles.fieldIcon}>
        <Feather name="clock" size={18} color={colors.textOnLight} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {main}
        </AppText>
        <AppText variant="small" muted>
          {sub}
        </AppText>
      </View>
      <Feather name="chevron-down" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

type Panel = 'time' | 'date';

export function DateTimeSheet({
  initial,
  showArriveBy,
  onClose,
  onApply,
}: {
  initial: When;
  showArriveBy: boolean;
  onClose: () => void;
  onApply: (v: When) => void;
}) {
  const { t, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [draft, setDraft] = useState<When>(initial);
  const [panel, setPanel] = useState<Panel>('time');
  const [month, setMonth] = useState(() => new Date(initial.day.getFullYear(), initial.day.getMonth(), 1));

  const set = (patch: Partial<When>) => setDraft((d) => ({ ...d, ...patch, isNow: patch.isNow ?? false }));
  const today = startOfDay(new Date());

  // Schnellwahl
  const presets: { key: string; label: string; apply: () => void; selected: boolean }[] = [
    { key: 'now', label: t('search.now'), apply: () => setDraft(nowWhen(draft.arriveBy)), selected: draft.isNow },
    ...[15, 30, 60].map((min) => ({
      key: `in${min}`,
      label: t('when.in', { time: min < 60 ? t('time.min', { n: min }) : t('time.h', { n: 1 }) }),
      apply: () => set(addMinutes(new Date(), min)),
      selected: false,
    })),
    ...[7, 17].map((h) => {
      const day = new Date(today);
      day.setDate(today.getDate() + 1);
      return {
        key: `tomorrow${h}`,
        label: t('when.tomorrowAt', { time: `${pad(h)}:00` }),
        apply: () => set({ day, hours: h, minutes: 0 }),
        selected: !draft.isNow && sameDay(draft.day, day) && draft.hours === h && draft.minutes === 0,
      };
    }),
  ];

  const monthTitle = new Intl.DateTimeFormat(localeOf(lang), { month: 'long', year: 'numeric' }).format(new Date(month.getFullYear(), month.getMonth(), 15));
  const canPrev = month > new Date(today.getFullYear(), today.getMonth(), 1);
  const shiftMonth = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  // Kalender, Woche beginnt am Montag
  const lead = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  while (cells.length % 7) cells.push(null);
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((d) => t(`wd.${d}` as TKey));

  const timeText = `${pad(draft.hours)}:${pad(draft.minutes)}`;
  const applyLabel = draft.isNow && sameDay(draft.day, new Date()) ? t('search.now') : `${dayLabel(draft.day, t)}, ${timeText}`;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.close')} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg, maxHeight: height * 0.92 }]}>
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <AppText variant="h2" style={{ flex: 1 }}>
              {t('when.title')}
            </AppText>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.close')}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ gap: spacing.md }} showsVerticalScrollIndicator={false}>
            {showArriveBy ? (
              <View style={styles.segment} accessibilityRole="radiogroup">
                {([false, true] as const).map((v) => (
                  <Pressable
                    key={String(v)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: draft.arriveBy === v }}
                    onPress={() => setDraft((d) => ({ ...d, arriveBy: v }))}
                    style={[styles.segmentItem, draft.arriveBy === v && styles.segmentOn]}>
                    <AppText variant="bodyStrong" color={draft.arriveBy === v ? colors.textOnLight : colors.text}>
                      {v ? t('search.arrival') : t('search.departure')}
                    </AppText>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={styles.presets}>
              {presets.map((p) => (
                <Pressable
                  key={p.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: p.selected }}
                  onPress={p.apply}
                  style={({ pressed }) => [styles.preset, p.selected && styles.presetOn, pressed && { opacity: 0.8 }]}>
                  <AppText variant="smallStrong" color={p.selected ? colors.textOnLight : colors.text}>
                    {p.label}
                  </AppText>
                </Pressable>
              ))}
            </View>

            {/* Datum | Uhrzeit – antippen wechselt das Raster darunter */}
            <View style={styles.cards}>
              {(['date', 'time'] as const).map((p) => (
                <Pressable
                  key={p}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: panel === p }}
                  onPress={() => setPanel(p)}
                  style={[styles.card, panel === p && styles.cardOn]}>
                  <Feather name={p === 'date' ? 'calendar' : 'clock'} size={16} color={panel === p ? colors.lime : colors.textMuted} />
                  <View style={{ flex: 1 }}>
                    <AppText variant="small" muted>
                      {p === 'date' ? t('when.date') : t('when.time')}
                    </AppText>
                    <AppText style={styles.cardValue} numberOfLines={1}>
                      {p === 'date' ? dayLabel(draft.day, t) : timeText}
                    </AppText>
                  </View>
                </Pressable>
              ))}
            </View>

            {panel === 'date' ? (
              <View style={styles.panel}>
                <View style={styles.monthRow}>
                  <Pressable onPress={() => shiftMonth(-1)} disabled={!canPrev} hitSlop={10} accessibilityLabel={t('when.prevMonth')} style={{ opacity: canPrev ? 1 : 0.3 }}>
                    <Feather name="chevron-left" size={22} color={colors.text} />
                  </Pressable>
                  <AppText variant="bodyStrong" style={{ flex: 1, textAlign: 'center' }}>
                    {monthTitle}
                  </AppText>
                  <Pressable onPress={() => shiftMonth(1)} hitSlop={10} accessibilityLabel={t('when.nextMonth')}>
                    <Feather name="chevron-right" size={22} color={colors.text} />
                  </Pressable>
                </View>
                <View style={styles.grid7}>
                  {weekdays.map((w, i) => (
                    <AppText key={i} variant="small" muted style={styles.weekday}>
                      {w}
                    </AppText>
                  ))}
                  {cells.map((d, i) => {
                    if (!d) return <View key={`e${i}`} style={styles.dayCell} />;
                    const past = d < today;
                    const selected = sameDay(d, draft.day);
                    const isToday = sameDay(d, today);
                    return (
                      <Pressable
                        key={d.toISOString()}
                        disabled={past}
                        accessibilityRole="button"
                        accessibilityState={{ selected, disabled: past }}
                        onPress={() => {
                          set({ day: d });
                          setPanel('time');
                        }}
                        style={styles.dayCell}>
                        <View style={[styles.dayInner, isToday && styles.today, selected && styles.dayOn]}>
                          <AppText
                            variant="bodyStrong"
                            color={selected ? colors.textOnLight : past ? colors.textFaint : colors.text}
                            style={{ fontVariant: ['tabular-nums'] }}>
                            {d.getDate()}
                          </AppText>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : (
              <View style={styles.panel}>
                <AppText variant="small" muted>
                  {t('when.hour')}
                </AppText>
                <View style={styles.grid6}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <GridButton key={h} label={pad(h)} selected={!draft.isNow && draft.hours === h} onPress={() => set({ hours: h })} />
                  ))}
                </View>
                <AppText variant="small" muted style={{ marginTop: spacing.xs }}>
                  {t('when.minute')}
                </AppText>
                <View style={styles.grid6}>
                  {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
                    <GridButton key={m} label={`:${pad(m)}`} selected={!draft.isNow && draft.minutes === m} onPress={() => set({ minutes: m })} />
                  ))}
                </View>
              </View>
            )}
          </ScrollView>

          <Button title={`${t('when.apply')} · ${applyLabel}`} icon="check" size="lg" onPress={() => onApply(draft)} />
        </View>
      </View>
    </Modal>
  );
}

/** Eine Zelle im 6er-Raster (Stunden 4 × 6, Minuten 2 × 6). */
function GridButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <View style={styles.gridCell}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={onPress}
        style={({ pressed }) => [styles.gridBtn, selected && styles.gridOn, pressed && { opacity: 0.8 }]}>
        <AppText style={[styles.gridText, { color: selected ? colors.textOnLight : colors.text }]}>{label}</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceDeep,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  fieldIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.raised,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  segment: { flexDirection: 'row', backgroundColor: colors.surfaceDeep, borderRadius: radius.pill, padding: 4 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.pill },
  segmentOn: { backgroundColor: colors.lime },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  preset: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
  presetOn: { backgroundColor: colors.lime },
  cards: { flexDirection: 'row', gap: spacing.sm },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceDeep,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardOn: { borderColor: colors.lime },
  cardValue: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, color: colors.text, fontVariant: ['tabular-nums'] },
  panel: { backgroundColor: colors.surfaceDeep, borderRadius: radius.md, padding: spacing.sm, gap: 6 },
  monthRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 4 },
  grid7: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', paddingVertical: 4 },
  dayCell: { width: `${100 / 7}%`, height: 40, alignItems: 'center', justifyContent: 'center' },
  dayInner: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 1.5, borderColor: colors.lime },
  dayOn: { backgroundColor: colors.lime },
  grid6: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 },
  gridCell: { width: `${100 / 6}%`, padding: 3 },
  gridBtn: {
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridOn: { backgroundColor: colors.lime },
  gridText: { fontFamily: fonts.bold, fontSize: 15, fontVariant: ['tabular-nums'] },
});
