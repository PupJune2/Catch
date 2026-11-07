// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useI18n } from '@/i18n';
import { colors, fonts, shadow } from '@/theme';
import { AppText } from './ui';

type IconName = ComponentProps<typeof Feather>['name'];

interface TabButtonProps extends TabTriggerSlotProps {
  icon: IconName;
  label: string;
}

// React 19: `ref` wird als normale Prop durchgereicht (TabTrigger asChild).
function TabButton({ icon, label, isFocused, ref, ...props }: TabButtonProps) {
  return (
    <Pressable
      {...props}
      // Typ-Eigenheit von expo-router/ui: der Ref zeigt zur Laufzeit auf eine View
      ref={ref as never}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!isFocused }}
      style={({ pressed }) => [styles.tab, pressed && { opacity: 0.7 }]}>
      {/*
        Markierung als eigene, bei Fokus neu eingehängte View mit festem Radius:
        Auf Android (Fabric) ging der borderRadius verloren, wenn nur die Hintergrundfarbe
        einer bestehenden View nachträglich gesetzt wurde → eckiges Rechteck.
        Zusätzlich schneidet der Container mit overflow: 'hidden' rund zu.
      */}
      <View style={styles.iconWrap}>
        {isFocused ? <View style={styles.activePill} /> : null}
        <Feather name={icon} size={20} color={isFocused ? colors.textOnLight : colors.textMuted} />
      </View>
      <AppText style={[styles.label, { color: isFocused ? colors.text : colors.textMuted }]}>{label}</AppText>
    </Pressable>
  );
}

/** Untere Navigation (Bild 3) mit erhöhtem "Melden"-Knopf in der Mitte. */
export function TabBar() {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  return (
    <View pointerEvents="box-none" style={[styles.host, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.bar}>
        <TabTrigger name="index" asChild>
          <TabButton icon="home" label={t('tabs.home')} />
        </TabTrigger>
        <TabTrigger name="search" asChild>
          <TabButton icon="search" label={t('tabs.search')} />
        </TabTrigger>
        <View style={styles.centerSlot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('tabs.reportA11y')}
            onPress={() => router.push('/report')}
            style={({ pressed }) => [styles.centerBtn, pressed && { transform: [{ scale: 0.94 }] }]}>
            <Feather name="plus" size={28} color={colors.textOnLight} />
          </Pressable>
          <AppText style={[styles.label, { color: colors.text, marginTop: 4 }]}>{t('tabs.report')}</AppText>
        </View>
        <TabTrigger name="live" asChild>
          <TabButton icon="radio" label={t('tabs.live')} />
        </TabTrigger>
        <TabTrigger name="profile" asChild>
          <TabButton icon="user" label={t('tabs.profile')} />
        </TabTrigger>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14 },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.surfaceDeep,
    borderRadius: 30,
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
    ...shadow,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  iconWrap: {
    width: 44,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activePill: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 44,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.lime,
  },
  label: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14 },
  centerSlot: { flex: 1, alignItems: 'center' },
  centerBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginTop: -30,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: colors.bg,
  },
});
