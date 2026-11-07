// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Zeile "Homescreen-Widget" im Profil → /widget. Android: Einrichtung; Web: Vorschau + Hinweis
 * auf die Android-App. Auf iOS gibt es (noch) kein Widget – dort nicht anzeigen.
 */
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Card, SectionHeader } from '@/components/ui';
import { useI18n } from '@/i18n';
import { shortStopName } from '@/lib/format';
import { colors, spacing } from '@/theme';
import { useWidgetConfig } from './config';
import { WIDGET_SUPPORTED } from './native';

export function WidgetCard() {
  const { t } = useI18n();
  const config = useWidgetConfig();
  if (Platform.OS === 'ios') return null;
  const text = !WIDGET_SUPPORTED
    ? t('widget.profileWeb')
    : config.stop
      ? t('widget.profileTextSet', { stop: shortStopName(config.stop.name) })
      : t('widget.profileText');
  return (
    <View>
      <SectionHeader title={t('widget.section')} />
      <Card style={styles.card}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/widget')}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
          <View style={styles.icon}>
            <Feather name="layout" size={18} color={colors.lime} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">{t('widget.title')}</AppText>
            <AppText variant="small" muted>
              {text}
            </AppText>
          </View>
          <Feather name="chevron-right" size={18} color={colors.textMuted} />
        </Pressable>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
