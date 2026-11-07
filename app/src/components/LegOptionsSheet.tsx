// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorMessage } from '@/api/client';
import type { Journey, Leg } from '@/api/contract';
import { api } from '@/api/endpoints';
import { useI18n } from '@/i18n';
import { delayMinutes, formatDuration, formatTime, shortStopName } from '@/lib/format';
import { nextChangeWith, placeParam, rebuildJourney, RebuildError, type ChangeTone } from '@/lib/journeyEdit';
import { trackLabel } from '@/lib/track';
import { colors, radius, spacing } from '@/theme';
import { LineBadge } from './transit';
import { AppText, ErrorBox } from './ui';

const MIN = 60_000;
/** So viele frühere / spätere Fahrten zeigen (die nächsten an der aktuellen). */
const MAX_EARLIER = 8;
const MAX_LATER = 6;

const sameRide = (a: Leg, b: Leg) =>
  (!!a.tripId && a.tripId === b.tripId) || (a.line?.key === b.line?.key && a.plannedDeparture === b.plannedDeparture);

export const changeToneColor: Record<ChangeTone, { fg: string; bg: string }> = {
  ok: { fg: colors.textMuted, bg: colors.surface },
  tight: { fg: colors.orange, bg: 'rgba(255,122,26,0.16)' },
  missed: { fg: colors.danger, bg: 'rgba(255,107,91,0.16)' },
};

/**
 * "Andere Fahrt wählen" für einen Abschnitt einer Verbindung (Bearbeiten-Modus):
 * Direktfahrten zwischen denselben Haltestellen, früher und später. Nach der Auswahl
 * wird die Verbindung davor/danach automatisch angepasst (lib/journeyEdit).
 */
export function LegOptionsSheet({
  journey,
  index,
  onClose,
  onPicked,
}: {
  journey: Journey;
  /** Index des Abschnitts in journey.legs. Die Komponente wird je Öffnen neu eingehängt (key). */
  index: number;
  onClose: () => void;
  onPicked: (next: Journey) => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { t } = useI18n();
  const leg = journey.legs[index];
  const [options, setOptions] = useState<Leg[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picking, setPicking] = useState<Leg | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const scroll = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const scrolled = useRef(false);

  useEffect(() => {
    if (!leg) return;
    let alive = true;
    const from = placeParam(leg.from);
    const to = placeParam(leg.to);
    const load = from && to ? api.legOptions({ from, to, time: leg.plannedDeparture }).then((r) => r.options) : Promise.resolve([]);
    load
      .then((found) => {
        if (!alive) return;
        const now = Date.now();
        // Schon abgefahrene Fahrten weglassen (die aktuelle bleibt immer drin)
        const list = found.filter((o) => sameRide(o, leg) || Date.parse(o.departure) >= now - MIN);
        if (!list.some((o) => sameRide(o, leg))) list.push(leg);
        list.sort((a, b) => Date.parse(a.departure) - Date.parse(b.departure));
        const cur = list.findIndex((o) => sameRide(o, leg));
        setOptions(list.slice(Math.max(0, cur - MAX_EARLIER), cur + 1 + MAX_LATER));
      })
      .catch((e) => alive && setLoadError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [leg, reload]);

  if (!leg?.line) return null;

  const retry = () => {
    setLoadError(null);
    setReload((n) => n + 1);
  };

  const pick = async (option: Leg) => {
    setPicking(option);
    setPickError(null);
    try {
      const next = await rebuildJourney(journey, index, option, api.journeys);
      onPicked(next);
    } catch (e) {
      setPickError(
        e instanceof RebuildError ? t(e.part === 'before' ? 'legOptions.failBefore' : 'legOptions.failAfter') : errorMessage(e),
      );
    } finally {
      setPicking(null);
    }
  };

  const close = () => {
    if (!picking) onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={t('common.close')} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg, maxHeight: height * 0.85 }]}>
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <View style={styles.icon}>
              <Feather name="shuffle" size={20} color={colors.textOnLight} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="h2">{t('legOptions.title')}</AppText>
              <AppText variant="small" muted numberOfLines={2}>
                {shortStopName(leg.from.name)} → {shortStopName(leg.to.name)}
              </AppText>
            </View>
          </View>
          <AppText variant="small" muted>
            {t('legOptions.text')}
          </AppText>

          {loadError ? <ErrorBox message={loadError} onRetry={retry} /> : null}
          {!options && !loadError ? <ActivityIndicator color={colors.lime} style={{ marginVertical: spacing.lg }} /> : null}
          {options && options.length <= 1 ? (
            <AppText variant="small" muted center style={{ marginVertical: spacing.md }}>
              {t('legOptions.empty')}
            </AppText>
          ) : null}
          {pickError ? <ErrorBox message={pickError} /> : null}

          {options && options.length > 0 ? (
            <ScrollView ref={scroll} style={styles.list} contentContainerStyle={{ paddingHorizontal: spacing.md }}>
              {options.map((o, i) => {
                const current = sameRide(o, leg);
                const diffMin = Math.round((Date.parse(o.departure) - Date.parse(leg.departure)) / MIN);
                const change = current ? null : nextChangeWith(journey.legs, index, o);
                const hasNext = journey.legs.some((l, j) => j > index && !l.walking && l.line);
                const depDelay = delayMinutes(o.plannedDeparture, o.departure);
                const arrDelay = delayMinutes(o.plannedArrival, o.arrival);
                const track = trackLabel(o.line?.mode, o.fromTrack ?? o.fromPlannedTrack, { short: true });
                const busy = picking !== null && sameRide(picking, o);
                const durationMin = Math.round((Date.parse(o.arrival) - Date.parse(o.departure)) / MIN);
                return (
                  <Pressable
                    key={`${o.tripId ?? ''}-${o.plannedDeparture}`}
                    onLayout={(e) => {
                      // Beim Öffnen zur aktuellen Fahrt scrollen – zwei frühere Fahrten bleiben ganz sichtbar
                      if (current && !scrolled.current) {
                        scrolled.current = true;
                        scroll.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - e.nativeEvent.layout.height * 2), animated: false });
                      }
                    }}
                    disabled={current || picking !== null}
                    onPress={() => pick(o)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: current, busy }}
                    style={({ pressed }) => [styles.row, i > 0 && styles.rowBorder, pressed && { opacity: 0.75 }]}>
                    <View style={styles.times}>
                      <AppText variant="mono" style={styles.time}>
                        {formatTime(o.plannedDeparture)}
                        {depDelay > 0 ? <AppText variant="small" color={colors.orange}>{` +${depDelay}`}</AppText> : null}
                      </AppText>
                      <AppText variant="mono" muted style={styles.time}>
                        {formatTime(o.plannedArrival)}
                        {arrDelay > 0 ? <AppText variant="small" color={colors.orange}>{` +${arrDelay}`}</AppText> : null}
                      </AppText>
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={styles.lineRow}>
                        <LineBadge line={o.line!} size="sm" level={o.summary?.level} kind={o.summary?.lastKind} />
                        <AppText variant="smallStrong" numberOfLines={1} style={{ flex: 1 }}>
                          {shortStopName(o.headsign)}
                        </AppText>
                      </View>
                      <AppText variant="small" muted numberOfLines={1}>
                        {[track, formatDuration(durationMin)].filter(Boolean).join(' · ')}
                      </AppText>
                    </View>
                    <View style={styles.right}>
                      {busy ? (
                        <ActivityIndicator color={colors.lime} />
                      ) : current ? (
                        <View style={styles.currentPill}>
                          <AppText variant="smallStrong" color={colors.textOnLight}>
                            {t('legOptions.current')}
                          </AppText>
                        </View>
                      ) : (
                        <>
                          <AppText variant="smallStrong" color={diffMin < 0 ? colors.lime : colors.text}>
                            {t(diffMin < 0 ? 'legOptions.earlier' : 'legOptions.later', { min: formatDuration(Math.abs(diffMin)) })}
                          </AppText>
                          {change ? (
                            <AppText variant="small" color={changeToneColor[change.tone].fg}>
                              {t('legOptions.change', { min: formatDuration(change.totalMin) })}
                            </AppText>
                          ) : hasNext ? (
                            <AppText variant="small" color={colors.cyan}>
                              {t('legOptions.newConnection')}
                            </AppText>
                          ) : null}
                        </>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
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
  icon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.cyan, alignItems: 'center', justifyContent: 'center' },
  list: { backgroundColor: colors.surfaceDeep, borderRadius: radius.md, flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  times: { width: 64, gap: 2 },
  time: { fontSize: 15 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  right: { alignItems: 'flex-end', gap: 2, minWidth: 96 },
  currentPill: { backgroundColor: colors.lime, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
});
