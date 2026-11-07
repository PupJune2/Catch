// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import type { Departure, Stop } from '@/api/contract';
import { api } from '@/api/endpoints';
import { EmptyState } from '@/components/EmptyState';
import { DepartureRow } from '@/components/rows';
import { Screen, StackHeader } from '@/components/Screen';
import { StopPicker } from '@/components/StopPicker';
import { useToast } from '@/components/Toast';
import { TrackingSheet, type TrackingContext } from '@/components/TrackingSheet';
import { AppText, Button, ErrorBox } from '@/components/ui';
import { useI18n } from '@/i18n';
import { shortStopName } from '@/lib/format';
import { useNow } from '@/lib/useAsync';
import { colors, radius, spacing } from '@/theme';

/** "Linie + Uhrzeit wählen": Haltestelle → Abfahrt → Live-Tracking. */
export default function NewTrackingScreen() {
  const toast = useToast();
  const { t } = useI18n();
  const now = useNow(30000);
  const [pickerOpen, setPickerOpen] = useState(true);
  const [station, setStation] = useState<Stop | null>(null);
  const [deps, setDeps] = useState<Departure[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<TrackingContext | null>(null);

  const load = async (s: Stop) => {
    setStation(s);
    setLoading(true);
    setError(null);
    try {
      const r = await api.departures(s.id, undefined, 60);
      setDeps(r.departures);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/live'));

  return (
    <Screen>
      <StackHeader title={t('track.title')} onBack={close} />
      <AppText variant="title">{t('track.which')}</AppText>
      <Button
        title={station ? shortStopName(station.name) : t('track.pickStop')}
        icon="map-pin"
        variant="secondary"
        onPress={() => setPickerOpen(true)}
      />
      {error ? <ErrorBox message={error} onRetry={station ? () => load(station) : undefined} /> : null}
      {loading ? <ActivityIndicator color={colors.lime} /> : null}
      {deps && deps.length > 0 ? (
        <>
          <AppText variant="small" muted>
            {t('track.tapHint')}
          </AppText>
          <View style={styles.list}>
            {deps.map((d) => (
              <DepartureRow
                key={`${d.tripId}-${d.plannedTime}`}
                dep={d}
                now={now}
                onPress={() =>
                  setCtx({
                    line: d.line,
                    tripId: d.tripId,
                    headsign: d.headsign,
                    directionId: d.directionId,
                    departureTime: d.time,
                  })
                }
              />
            ))}
          </View>
        </>
      ) : null}
      {deps && deps.length === 0 ? <EmptyState title={t('track.noDepTitle')} text={t('track.noDepText')} /> : null}
      {!station && !pickerOpen ? (
        <EmptyState title={t('track.boardTitle')} text={t('track.boardText')} />
      ) : null}

      <StopPicker visible={pickerOpen} title={t('track.boardTitle')} onClose={() => setPickerOpen(false)} onSelect={load} />
      <TrackingSheet
        visible={!!ctx}
        context={ctx}
        onClose={() => setCtx(null)}
        onCreated={() => {
          toast(t('journey.trackingStarted'), 'success');
          close();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 6, gap: 0, marginTop: -spacing.xs },
});
