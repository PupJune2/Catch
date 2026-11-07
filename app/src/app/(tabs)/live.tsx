// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import type { TrackingAlert } from '@/api/contract';
import { api } from '@/api/endpoints';
import { LiveCommuteSection } from '@/components/CommuteSections';
import { EmptyState } from '@/components/EmptyState';
import { KindIcon } from '@/components/kinds';
import { TrackingCard } from '@/components/rows';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { LineBadge } from '@/components/transit';
import { AppText, Button, ErrorBox, IconButton, Notice, SectionHeader, SkeletonList } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { confirm } from '@/lib/confirm';
import { relativeTime } from '@/lib/format';
import { KIND_COLOR, kindLabel, kindOf } from '@/lib/kinds';
import { segmentText } from '@/lib/labels';
import { openLine } from '@/lib/navigation';
import { useAsync, useNow } from '@/lib/useAsync';
import { useRealtime } from '@/realtime/RealtimeProvider';
import { colors, radius, spacing } from '@/theme';

export default function LiveScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { connected, onAlert } = useRealtime();
  const toast = useToast();
  const now = useNow(20000);

  const trackings = useAsync(() => api.trackings(), [user?.uid], !!user);
  const alerts = useAsync(() => api.alerts(), [user?.uid], !!user);
  const reloadT = trackings.reload;
  const reloadA = alerts.reload;

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      reloadT(true);
      reloadA(true);
    }, [user, reloadT, reloadA]),
  );

  useEffect(
    () =>
      onAlert(() => {
        reloadT(true);
        reloadA(true);
      }),
    [onAlert, reloadT, reloadA],
  );

  const remove = async (id: string) => {
    const ok = await confirm(t('live.endTitle'), t('live.endText'), t('live.endConfirm'), true);
    if (!ok) return;
    try {
      await api.deleteTracking(id);
      trackings.setData((prev) => (prev ? { trackings: prev.trackings.filter((tr) => tr.id !== id) } : prev));
      toast(t('live.ended'), 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const header = (
    <View style={{ gap: spacing.md, paddingBottom: spacing.sm }}>
      <View style={styles.headRow}>
        <AppText variant="title" style={{ flex: 1 }}>
          {t('common.liveTracking')}
        </AppText>
        <View style={[styles.conn, { borderColor: connected ? colors.cyan : colors.borderStrong }]}>
          <View style={[styles.connDot, { backgroundColor: connected ? colors.cyan : colors.textFaint }]} />
          <AppText variant="smallStrong" color={connected ? colors.cyan : colors.textMuted}>
            {connected ? t('live.connected') : t('live.offline')}
          </AppText>
        </View>
        <IconButton icon="map" size={40} accessibilityLabel={t('map.liveA11y')} onPress={() => router.push('/map')} />
      </View>
      <AppText variant="body" muted>
        {t('live.intro')}
      </AppText>
      <Button
        title={t('live.new')}
        icon="plus"
        variant="cyan"
        size="lg"
        onPress={() =>
          user ? router.push('/track-new') : router.push({ pathname: '/login', params: { reason: t('live.loginReason') } })
        }
      />
    </View>
  );

  if (!user) {
    return (
      <Screen withTabBar header={header}>
        <EmptyState
          title={t('live.signInTitle')}
          text={t('live.signInText')}
          action={t('home.signIn')}
          onAction={() => router.push('/login')}
        />
      </Screen>
    );
  }

  const list = trackings.data?.trackings ?? [];
  const alertList = alerts.data?.alerts ?? [];

  return (
    <Screen
      withTabBar
      header={header}
      refreshing={trackings.loading && !!trackings.data}
      onRefresh={() => {
        trackings.reload();
        alerts.reload(true);
      }}>
      {/* Pendler-Modus: automatisch beobachtete Strecken über den manuellen Trackings */}
      <LiveCommuteSection />

      <View>
        <SectionHeader title={t('live.activeSection')} />
        {trackings.error ? <ErrorBox message={trackings.error} onRetry={() => trackings.reload()} /> : null}
        {trackings.loading && !trackings.data ? <SkeletonList count={2} /> : null}
        {trackings.data && list.length === 0 ? (
          <EmptyState
            title={t('live.emptyTitle')}
            text={t('live.emptyText')}
          />
        ) : null}
        <View style={{ gap: spacing.md }}>
          {list.map((tr) => (
            <TrackingCard key={tr.id} tracking={tr} now={now} onPress={() => openLine(tr.line)} onDelete={() => remove(tr.id)} />
          ))}
        </View>
      </View>

      <View>
        <SectionHeader title={t('live.recentAlerts')} />
        {alerts.data && alertList.length === 0 ? (
          <AppText variant="small" muted>
            {t('live.noAlerts')}
          </AppText>
        ) : null}
        <View style={{ gap: spacing.sm }}>
          {alertList.map((a) => (
            <AlertRow key={a.id} alert={a} now={now} />
          ))}
        </View>
      </View>

      <Notice
        icon="bell"
        text={t('live.tip')}
      />
    </Screen>
  );
}

function AlertRow({ alert, now }: { alert: TrackingAlert; now: number }) {
  const { t } = useI18n();
  const kind = kindOf(alert.report);
  return (
    <Pressable onPress={() => openLine(alert.report.line)} style={({ pressed }) => [styles.alert, pressed && { opacity: 0.85 }]}>
      <LineBadge line={alert.report.line} />
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {segmentText(alert.report)}
        </AppText>
        <View style={styles.alertMeta}>
          <KindIcon kind={kind} size={14} />
          <AppText variant="small" muted numberOfLines={1} style={{ flex: 1 }}>
            <AppText variant="smallStrong" color={KIND_COLOR[kind]}>
              {kindLabel(kind)}
            </AppText>
            {' · '}
            {relativeTime(alert.createdAt, now)}
            {alert.onMySegment ? t('live.onYourSection') : ''}
          </AppText>
        </View>
      </View>
      {alert.onMySegment ? <View style={styles.hot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  conn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  connDot: { width: 8, height: 8, borderRadius: 4 },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  alertMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  hot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.orange },
});
