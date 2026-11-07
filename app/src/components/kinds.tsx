// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { REPORT_KINDS, type ReportKind } from '@/api/contract';
import { useI18n } from '@/i18n';
import { KIND_COLOR, KIND_ICON, kindHint, kindLabel } from '@/lib/kinds';
import { colors, radius, spacing } from '@/theme';
import { AppText } from './ui';

/** Icon einer Hinweis-Art (Standard: in ihrer Akzentfarbe). */
export function KindIcon({ kind, size = 16, color }: { kind: ReportKind; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={KIND_ICON[kind]} size={size} color={color ?? KIND_COLOR[kind]} />;
}

/** Kleine Pill: Icon + Label in der Akzentfarbe der Art (dunkle Schrift). */
export function KindBadge({ kind, style }: { kind: ReportKind; style?: StyleProp<ViewStyle> }) {
  useI18n();
  return (
    <View style={[styles.badge, { backgroundColor: KIND_COLOR[kind] }, style]}>
      <KindIcon kind={kind} size={14} color={colors.textOnLight} />
      <AppText variant="smallStrong" color={colors.textOnLight} numberOfLines={1}>
        {kindLabel(kind)}
      </AppText>
    </View>
  );
}

/** Große Auswahl-Kachel für Schritt 1 im Melden-Ablauf ("Was ist los?"). */
export function KindTile({ kind, onPress, selected }: { kind: ReportKind; onPress: () => void; selected?: boolean }) {
  useI18n();
  const color = KIND_COLOR[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        selected && { borderColor: color, backgroundColor: `${color}1A` },
        pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] },
      ]}>
      <View style={[styles.tileIcon, { backgroundColor: color }]}>
        <KindIcon kind={kind} size={26} color={colors.textOnLight} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="h3">{kindLabel(kind)}</AppText>
        <AppText variant="small" muted numberOfLines={2}>
          {kindHint(kind)}
        </AppText>
      </View>
      <Feather name="chevron-right" size={20} color={selected ? color : colors.textMuted} />
    </Pressable>
  );
}

function KindChip({
  kind,
  label,
  selected,
  onPress,
  count,
  check,
}: {
  kind: ReportKind | null;
  label: string;
  selected: boolean;
  onPress: () => void;
  count?: number;
  check?: boolean;
}) {
  const color = kind ? KIND_COLOR[kind] : colors.lime;
  const fg = selected ? colors.textOnLight : colors.text;
  return (
    <Pressable
      accessibilityRole={check ? 'checkbox' : 'button'}
      accessibilityState={check ? { checked: selected } : { selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected ? { backgroundColor: color, borderColor: color } : { backgroundColor: colors.surface },
        pressed && { opacity: 0.8 },
      ]}>
      {check ? (
        <Feather name={selected ? 'check' : 'plus'} size={14} color={selected ? colors.textOnLight : colors.textMuted} />
      ) : null}
      {kind ? <KindIcon kind={kind} size={15} color={selected ? colors.textOnLight : color} /> : null}
      <AppText variant="smallStrong" color={fg}>
        {label}
      </AppText>
      {count !== undefined ? (
        <View style={[styles.count, { backgroundColor: selected ? 'rgba(20,32,58,0.14)' : colors.surfaceAlt }]}>
          <AppText variant="smallStrong" color={selected ? colors.textOnLight : colors.textMuted} style={{ fontSize: 11.5 }}>
            {count}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Filter "Alle / Verspätung / …" mit Anzahl je Art (horizontal scrollbar). */
export function KindFilterChips({
  value,
  onChange,
  counts,
  style,
}: {
  value: ReportKind | null;
  onChange: (kind: ReportKind | null) => void;
  counts?: Partial<Record<ReportKind, number>>;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useI18n();
  const total = counts ? REPORT_KINDS.reduce((sum, k) => sum + (counts[k] ?? 0), 0) : undefined;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={t('kind.filterA11y')}
      style={[styles.scroll, style]}
      contentContainerStyle={styles.scrollContent}>
      <KindChip kind={null} label={t('kind.all')} selected={value === null} onPress={() => onChange(null)} count={total} />
      {REPORT_KINDS.map((k) => (
        <KindChip
          key={k}
          kind={k}
          label={kindLabel(k)}
          selected={value === k}
          onPress={() => onChange(value === k ? null : k)}
          count={counts ? (counts[k] ?? 0) : undefined}
        />
      ))}
    </ScrollView>
  );
}

/** Mehrfachauswahl "Alarm bei" – mindestens eine Art bleibt gewählt. */
export function KindMultiSelect({
  value,
  onChange,
  label,
}: {
  value: ReportKind[];
  onChange: (kinds: ReportKind[]) => void;
  label?: string;
}) {
  const { t } = useI18n();
  const toggle = (k: ReportKind) => {
    if (value.includes(k)) {
      if (value.length > 1) onChange(value.filter((x) => x !== k));
    } else {
      onChange(REPORT_KINDS.filter((x) => x === k || value.includes(x)));
    }
  };
  return (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="caption" muted>
        {label ?? t('kind.alertMe')}
      </AppText>
      <View style={styles.wrap}>
        {REPORT_KINDS.map((k) => (
          <KindChip key={k} kind={k} label={kindLabel(k)} selected={value.includes(k)} onPress={() => toggle(k)} check />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: spacing.md,
    minHeight: 78,
  },
  tileIcon: { width: 50, height: 50, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 0 },
  scrollContent: { gap: spacing.xs, paddingRight: spacing.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
