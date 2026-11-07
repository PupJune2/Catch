// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorMessage } from '@/api/client';
import { REPORT_KINDS, type Line, type ReportKind, type Tracking } from '@/api/contract';
import { api } from '@/api/endpoints';
import { useI18n, type TKey } from '@/i18n';
import { addMinutes, formatTime, shortStopName } from '@/lib/format';
import { kindsForBody } from '@/lib/kinds';
import { KindMultiSelect } from './kinds';
import { colors, radius, spacing } from '@/theme';
import { LineBadge } from './transit';
import { AppText, Button, Chip, ChipRow, ErrorBox, Toggle } from './ui';

export interface TrackingContext {
  line: Line;
  tripId?: string;
  headsign?: string;
  directionId?: string;
  /** Abfahrtszeit der konkreten Fahrt (falls bekannt) */
  departureTime?: string;
}

const STARTS: { key: TKey; min: number }[] = [
  { key: 'sheet.start.now', min: 0 },
  { key: 'sheet.start.in15', min: 15 },
  { key: 'sheet.start.in30', min: 30 },
  { key: 'sheet.start.in60', min: 60 },
];
const DURATIONS: { key: TKey; min: number }[] = [
  { key: 'sheet.dur.1', min: 60 },
  { key: 'sheet.dur.2', min: 120 },
  { key: 'sheet.dur.3', min: 180 },
];

/** Unteres Sheet: Live-Tracking für eine Linie (oder eine konkrete Fahrt) starten. */
export function TrackingSheet({
  visible,
  context,
  onClose,
  onCreated,
}: {
  visible: boolean;
  context: TrackingContext | null;
  onClose: () => void;
  onCreated: (t: Tracking) => void;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const hasTrip = !!context?.departureTime;
  const [forTrip, setForTrip] = useState(hasTrip);
  const [startMin, setStartMin] = useState(0);
  const [duration, setDuration] = useState(120);
  const [bothDirections, setBothDirections] = useState(false);
  const [kinds, setKinds] = useState<ReportKind[]>([...REPORT_KINDS]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setForTrip(!!context?.departureTime);
      setKinds([...REPORT_KINDS]);
      setError(null);
    }
  }, [visible, context?.departureTime]);

  if (!context) return null;

  let startsAt: string;
  let endsAt: string;
  if (forTrip && context.departureTime) {
    startsAt = addMinutes(context.departureTime, -30);
    endsAt = addMinutes(context.departureTime, 90);
  } else {
    startsAt = addMinutes(new Date(), startMin);
    endsAt = addMinutes(startsAt, duration);
  }

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const tracking = await api.createTracking({
        line: context.line,
        tripId: forTrip ? context.tripId : undefined,
        headsign: context.headsign || undefined,
        directionId: context.directionId || undefined,
        bothDirections,
        kinds: kindsForBody(kinds),
        startsAt,
        endsAt,
      });
      onCreated(tracking);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.close')} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <LineBadge line={context.line} size="lg" showIcon />
            <View style={{ flex: 1 }}>
              <AppText variant="h2">{t('common.liveTracking')}</AppText>
              <AppText variant="small" muted numberOfLines={1}>
                {context.headsign ? t('sheet.direction', { stop: shortStopName(context.headsign) }) : t('sheet.allTrips')}
              </AppText>
            </View>
          </View>

          <AppText variant="body" muted>
            {t('sheet.explain')}
          </AppText>

          {hasTrip ? (
            <ChipRow>
              <Chip
                label={t('sheet.myTrip', { time: formatTime(context.departureTime) })}
                selected={forTrip}
                onPress={() => setForTrip(true)}
                color={colors.cyan}
              />
              <Chip label={t('sheet.pickPeriod')} selected={!forTrip} onPress={() => setForTrip(false)} color={colors.cyan} />
            </ChipRow>
          ) : null}

          {!forTrip ? (
            <>
              <AppText variant="caption" muted>
                {t('sheet.startLabel')}
              </AppText>
              <ChipRow>
                {STARTS.map((s) => (
                  <Chip key={s.key} label={t(s.key)} selected={startMin === s.min} onPress={() => setStartMin(s.min)} color={colors.cyan} />
                ))}
              </ChipRow>
              <AppText variant="caption" muted>
                {t('sheet.durationLabel')}
              </AppText>
              <ChipRow>
                {DURATIONS.map((d) => (
                  <Chip key={d.key} label={t(d.key)} selected={duration === d.min} onPress={() => setDuration(d.min)} color={colors.cyan} />
                ))}
              </ChipRow>
            </>
          ) : null}

          <KindMultiSelect value={kinds} onChange={setKinds} />

          {context.headsign ? (
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">{t('sheet.bothDirections')}</AppText>
                <AppText variant="small" muted>
                  {t('sheet.bothHint')}
                </AppText>
              </View>
              <Toggle value={bothDirections} onChange={setBothDirections} accessibilityLabel={t('sheet.bothDirections')} />
            </View>
          ) : null}

          <View style={styles.summary}>
            <AppText variant="smallStrong" color={colors.cyan}>
              {t('sheet.activeRange', { from: formatTime(startsAt), to: formatTime(endsAt) })}
            </AppText>
          </View>

          {error ? <ErrorBox message={error} /> : null}
          <Button title={t('sheet.startButton')} icon="radio" variant="cyan" size="lg" loading={busy} onPress={create} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summary: { backgroundColor: 'rgba(46,200,230,0.12)', borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' },
});
