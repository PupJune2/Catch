// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { Screen, StackHeader } from '@/components/Screen';
import { AppText } from '@/components/ui';
import { useI18n, type TKey } from '@/i18n';
import { tutorialById } from '@/tutorials';
import { TutorialPlayer } from '@/tutorials/Player';
import { colors, radius, spacing } from '@/theme';

/**
 * Ein Tutorial als Animation. URL: /tutorial/<id>?step=<n>
 * Der Schritt steht in der URL – nach einem Neuladen geht es genau dort weiter.
 */
export default function TutorialScreen() {
  const { id, step } = useLocalSearchParams<{ id: string; step?: string }>();
  const { t, lang } = useI18n();
  const tutorial = tutorialById(id);
  const onStep = useCallback((n: number) => router.setParams({ step: String(n) }), []);

  if (!tutorial) {
    return (
      <Screen>
        <StackHeader title={t('tutorial.title')} />
        <EmptyState title={t('tutorial.notFound')} action={t('help.title')} onAction={() => router.replace('/help')} />
      </Screen>
    );
  }

  const initial = Number.parseInt(step ?? '0', 10);

  return (
    <Screen>
      <StackHeader title={t('tutorial.title')} subtitle={t(`help.cat.${tutorial.category}` as TKey)} />
      <AppText variant="h2">{tutorial.question[lang]}</AppText>
      <TutorialPlayer key={tutorial.id} tutorial={tutorial} initialStep={Number.isFinite(initial) ? initial : 0} onStep={onStep} />
      <View style={styles.where}>
        <Feather name="map-pin" size={16} color={colors.lime} style={{ marginTop: 2 }} />
        <View style={{ flex: 1 }}>
          <AppText variant="smallStrong" color={colors.textMuted}>
            {t('help.where')}
          </AppText>
          <AppText variant="bodyStrong">{tutorial.where[lang]}</AppText>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  where: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
});
