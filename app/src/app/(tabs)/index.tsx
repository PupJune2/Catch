// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { api } from '@/api/endpoints';
import type { Report } from '@/api/contract';
import { EmptyState } from '@/components/EmptyState';
import { FlagSheet } from '@/components/FlagSheet';
import { GhostLogo } from '@/components/GhostLogo';
import { HomeCommuteSection } from '@/components/CommuteSections';
import { ReportCard, TrackingCard, trackingStatus } from '@/components/rows';
import { Screen } from '@/components/Screen';
import { AppText, Button, Chip, ErrorBox, Notice, SectionHeader, SkeletonList } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { greeting } from '@/lib/format';
import { getCoordsIfPermitted, getCurrentCoords, type Coords } from '@/lib/location';
import { openLine } from '@/lib/navigation';
import { requireLogin } from '@/lib/requireLogin';
import { useAsync, useNow } from '@/lib/useAsync';
import { useRealtime } from '@/realtime/RealtimeProvider';
import { colors, radius, spacing } from '@/theme';

export default function HomeScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { connected, onAlert } = useRealtime();
  const now = useNow(30000);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locChecked, setLocChecked] = useState(false);
  const [flagging, setFlagging] = useState<Report | null>(null);

  useEffect(() => {
    getCoordsIfPermitted().then((c) => {
      setCoords(c);
      setLocChecked(true);
    });
  }, []);

  const recent = useAsync(
    () => api.recentReports(coords ? { lat: coords.lat, lon: coords.lon, radiusKm: 30, minutes: 120 } : { minutes: 120 }),
    [coords?.lat, coords?.lon],
    locChecked,
  );

  const trackings = useAsync(() => api.trackings(), [user?.uid], !!user);

  // Beim Zurückkehren auf den Tab und regelmäßig aktualisieren
  useFocusEffect(
    useCallback(() => {
      if (locChecked) recent.reload(true);
      if (user) trackings.reload(true);
      const timer = setInterval(() => recent.reload(true), 60_000);
      return () => clearInterval(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [locChecked, user?.uid]),
  );

  const reloadTrackings = trackings.reload;
  const loggedIn = !!user;
  useEffect(() => onAlert(() => (loggedIn ? reloadTrackings(true) : undefined)), [onAlert, reloadTrackings, loggedIn]);

  const useLocation = async () => {
    const r = await getCurrentCoords();
    if (r.ok) setCoords(r.coords);
  };

  const firstName = user?.displayName?.split(' ')[0];
  const activeTrackings = (trackings.data?.trackings ?? []).filter((tr) => trackingStatus(tr, now) !== 'abgelaufen');
  const reports = recent.data?.reports ?? [];

  return (
    <Screen
      withTabBar
      refreshing={recent.loading && !!recent.data}
      onRefresh={() => {
        recent.reload();
        if (user) trackings.reload(true);
      }}
      header={
        <View style={{ gap: spacing.lg, paddingBottom: spacing.sm }}>
          <View style={styles.brandRow}>
            <GhostLogo size={30} />
            <AppText variant="h2" style={{ flex: 1 }}>
              Catch
            </AppText>
            <View style={[styles.liveDot, { backgroundColor: connected ? colors.lime : colors.textFaint }]} />
            <Pressable
              onPress={() => router.push('/map')}
              style={({ pressed }) => [styles.mapButton, pressed && { opacity: 0.8 }]}
              accessibilityRole="button"
              accessibilityLabel={t('map.open')}>
              <Feather name="map" size={18} color={colors.text} />
            </Pressable>
            <Pressable
              onPress={() => router.push(user ? '/profile' : '/login')}
              style={styles.avatar}
              accessibilityLabel={user ? t('tabs.profile') : t('home.signIn')}>
              {user ? (
                <AppText variant="h3" color={colors.textOnLight}>
                  {(user.displayName ?? user.email ?? '?').charAt(0).toUpperCase()}
                </AppText>
              ) : (
                <Feather name="log-in" size={18} color={colors.textOnLight} />
              )}
            </Pressable>
          </View>

          <AppText variant="display">{firstName ? `${greeting()},\n${firstName}` : `${greeting()}!`}</AppText>

          <Pressable onPress={() => router.push('/search')} style={({ pressed }) => [styles.searchCard, pressed && { opacity: 0.85 }]}>
            <View style={styles.searchIcon}>
              <Feather name="search" size={18} color={colors.textOnLight} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">{t('home.whereTo')}</AppText>
              <AppText variant="small" muted>
                {t('home.whereToSub')}
              </AppText>
            </View>
            <Feather name="arrow-right" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
      }>
      {/* Pendler-Modus: nächste Strecke mit "Los um …" (lädt selbst) */}
      {user ? <HomeCommuteSection /> : null}

      {user && activeTrackings.length > 0 ? (
        <View>
          <SectionHeader title={t('home.yourTracking')} action={t('home.all')} onAction={() => router.push('/live')} />
          <View style={{ gap: spacing.md }}>
            {activeTrackings.slice(0, 2).map((tr) => (
              <TrackingCard
                key={tr.id}
                tracking={tr}
                now={now}
                onPress={() => openLine(tr.line)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View>
        <SectionHeader title={t('home.justReported')} action={t('map.onMap')} onAction={() => router.push('/map')} />
        <View style={styles.subRow}>
          <Feather name={coords ? 'map-pin' : 'globe'} size={14} color={colors.textMuted} />
          <AppText variant="small" muted style={{ flex: 1 }}>
            {coords ? t('home.radius') : t('home.germany')}
          </AppText>
          {!coords && locChecked ? <Chip label={t('home.nearMe')} icon="navigation" onPress={useLocation} /> : null}
        </View>

        {recent.error ? <ErrorBox message={recent.error} onRetry={() => recent.reload()} /> : null}
        {recent.loading && !recent.data ? <SkeletonList count={2} /> : null}
        {!recent.loading && !recent.error && reports.length === 0 ? (
          <EmptyState
            title={t('home.calmTitle')}
            text={t('home.calmText')}
          />
        ) : null}
        <View style={{ gap: spacing.md }}>
          {reports.slice(0, 8).map((r) => (
            <ReportCard
              key={r.id}
              report={r}
              now={now}
              onPress={() => openLine(r.line)}
              onLongPress={r.isMine ? undefined : () => requireLogin(user, t('flag.loginReason')) && setFlagging(r)}
            />
          ))}
        </View>
      </View>

      <View style={styles.ctaCard}>
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="h3" color={colors.textOnLight}>
            {t('home.ctaTitle')}
          </AppText>
          <AppText variant="small" color={colors.textOnLightMuted}>
            {t('home.ctaText')}
          </AppText>
        </View>
        <Button title={t('tabs.report')} icon="plus" variant="light" full={false} onPress={() => router.push('/report')} style={{ backgroundColor: colors.textOnLight }} />
      </View>

      <Notice
        icon="shield"
        text={t('common.ticketHint')}
        style={{ paddingHorizontal: spacing.xs }}
      />
      <FlagSheet report={flagging} onClose={() => setFlagging(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  mapButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceDeep,
    borderRadius: radius.pill,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 18,
  },
  searchIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -6, marginBottom: spacing.md },
  ctaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.orange,
    borderRadius: radius.card,
    padding: spacing.lg,
  },
});
