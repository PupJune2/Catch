// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { router } from 'expo-router';
import { View } from 'react-native';

import { MAX_COMMUTES } from '@/api/contract';
import { CommuteCard } from '@/components/CommuteCard';
import { useCommuteList, useOpenCommuteJourney } from '@/components/CommuteSections';
import { EmptyState } from '@/components/EmptyState';
import { Screen, StackHeader } from '@/components/Screen';
import { AppText, Button, ErrorBox, IconButton, Notice, SkeletonList } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useNow } from '@/lib/useAsync';
import { spacing } from '@/theme';

/** "Meine Pendelstrecken": gespeicherte Strecken mit Status, nächster Verbindung und Bearbeiten. */
export default function CommutesScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const now = useNow(30_000);
  const list = useCommuteList();
  const { open, opening } = useOpenCommuteJourney();

  const commutes = list.data?.commutes ?? [];
  const canAdd = commutes.length < MAX_COMMUTES;
  const add = () => router.push('/commute-edit');

  if (!user) {
    return (
      <Screen>
        <StackHeader title={t('commute.title')} />
        <EmptyState
          title={t('live.signInTitle')}
          text={t('commute.signInText')}
          action={t('home.signIn')}
          onAction={() => router.push({ pathname: '/login', params: { reason: t('commute.loginReason') } })}
        />
      </Screen>
    );
  }

  return (
    <Screen
      refreshing={list.loading && !!list.data}
      onRefresh={() => list.reload()}
      footer={canAdd && commutes.length > 0 ? <Button title={t('commute.add')} icon="plus" size="lg" onPress={add} /> : undefined}>
      <StackHeader
        title={t('commute.title')}
        right={canAdd ? <IconButton icon="plus" accessibilityLabel={t('commute.add')} onPress={add} /> : undefined}
      />
      <AppText variant="body" muted>
        {t('commute.intro')}
      </AppText>

      {list.error ? <ErrorBox message={list.error} onRetry={() => list.reload()} /> : null}
      {list.loading && !list.data ? <SkeletonList count={2} height={170} /> : null}
      {list.data && commutes.length === 0 ? (
        <EmptyState title={t('commute.emptyTitle')} text={t('commute.emptyText')} action={t('commute.add')} onAction={add} />
      ) : null}

      <View style={{ gap: spacing.md }}>
        {commutes.map((c) => (
          <CommuteCard
            key={c.id}
            commute={c}
            now={now}
            onPress={() => router.push({ pathname: '/commute-edit', params: { id: c.id } })}
            onShowJourney={c.active ? () => open(c) : undefined}
            loadingJourney={opening === c.id}
          />
        ))}
      </View>

      {!canAdd ? <Notice icon="info" text={t('commute.max', { max: MAX_COMMUTES })} /> : null}
      <Notice icon="lock" text={t('commute.privacy')} />
    </Screen>
  );
}
