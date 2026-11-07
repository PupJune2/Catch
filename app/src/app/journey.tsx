// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { REPORT_KINDS, type Journey, type Leg, type Report, type ReportKind } from '@/api/contract';
import { api } from '@/api/endpoints';
import { EmptyState } from '@/components/EmptyState';
import { KindIcon, KindMultiSelect } from '@/components/kinds';
import { changeToneColor, LegOptionsSheet } from '@/components/LegOptionsSheet';
import { Screen, StackHeader } from '@/components/Screen';
import { StatusCard } from '@/components/StatusCard';
import { TimelineItem } from '@/components/Timeline';
import { useToast } from '@/components/Toast';
import { ModeIcon, TrackTag } from '@/components/transit';
import { AppText, Button, Notice } from '@/components/ui';
import { t as tGlobal, useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { saveJourneyAsCommute } from '@/lib/commutes';
import { changesOf, type ChangeInfo } from '@/lib/journeyEdit';
import { addMinutes, delayMinutes, formatDay, formatDuration, formatTime, relativeTime, shortStopName } from '@/lib/format';
import { kindLabel, kindOf, kindsForBody } from '@/lib/kinds';
import { levelOf, summaryText } from '@/lib/labels';
import { showJourneyOnMap } from '@/lib/mapStore';
import { openLine } from '@/lib/navigation';
import { requireLogin } from '@/lib/requireLogin';
import { journeyStore } from '@/lib/store';
import { trackLabel } from '@/lib/track';
import { useNow } from '@/lib/useAsync';
import { useWatchLines } from '@/realtime/RealtimeProvider';
import { colors, levelStyle, spacing } from '@/theme';

function legTab(leg: Leg, now: number): string {
  const s = leg.summary;
  // Gerade gemeldet: im Reiter nur die Art (die Zeit steht unten in der Karte)
  if (s?.level === 'active') return s.lastKind ? kindLabel(s.lastKind) : levelStyle.active.label;
  return levelStyle[levelOf(s)].label;
}

export default function JourneyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { t, tn } = useI18n();
  const toast = useToast();
  const now = useNow(30000);
  const [journey, setJourney] = useState<Journey | undefined>(() => journeyStore.get(id));
  const [busy, setBusy] = useState(false);
  const [kinds, setKinds] = useState<ReportKind[]>([...REPORT_KINDS]);
  // Bearbeiten: Fahrt antippen → frühere/spätere wählen; `original` für "zurück zum Original"
  const [editing, setEditing] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [original, setOriginal] = useState<Journey | null>(null);
  const changes = useMemo(() => changesOf(journey?.legs ?? []), [journey]);

  const transitLegs = journey?.legs.filter((l) => !l.walking && l.line) ?? [];
  // Offline berechnet (Fahrplan auf dem Gerät): keine Live-Daten, kein Tracking, keine Karte
  const offline = journey?.offline === true;
  const lineKeys = offline ? [] : transitLegs.map((l) => l.line!.key);

  // Live: neue Meldung auf einer der Linien → Status sofort aktualisieren
  useWatchLines(lineKeys, (r: Report) => {
    setJourney((prev) =>
      prev
        ? {
            ...prev,
            legs: prev.legs.map((l) =>
              l.line?.key === r.lineKey && l.summary
                ? {
                    ...l,
                    summary: {
                      ...l.summary,
                      level: 'active',
                      recentCount: l.summary.recentCount + 1,
                      lastReportAt: r.reportedAt,
                      lastKind: kindOf(r),
                      count30d: l.summary.count30d + 1,
                    },
                  }
                : l,
            ),
          }
        : prev,
    );
    toast(tGlobal('journey.newReport', { line: r.line.name }), 'error');
  });

  if (!journey) {
    return (
      <Screen>
        <StackHeader title={t('journey.title')} />
        <EmptyState
          title={t('journey.goneTitle')}
          text={t('journey.goneText')}
          action={t('journey.toSearch')}
          onAction={() => router.replace('/search')}
        />
      </Screen>
    );
  }

  const startTracking = async () => {
    if (!requireLogin(user, t('journey.loginReason'))) return;
    setBusy(true);
    try {
      for (const leg of transitLegs) {
        await api.createTracking({
          line: leg.line!,
          tripId: leg.tripId,
          directionId: leg.directionId,
          headsign: leg.headsign,
          fromStop: leg.from,
          toStop: leg.to,
          stopIds: leg.stopovers?.map((s) => s.stop.id) ?? [leg.from.id, leg.to.id],
          kinds: kindsForBody(kinds),
          startsAt: addMinutes(leg.departure, -30),
          endsAt: addMinutes(leg.arrival, 5),
        });
      }
      toast(
        transitLegs.length > 1 ? t('journey.trackingStartedMany', { n: transitLegs.length }) : t('journey.trackingStarted'),
        'success',
      );
      router.navigate('/live');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const first = journey.legs[0];
  const last = journey.legs[journey.legs.length - 1];

  const replaceJourney = (next: Journey, toastText: string) => {
    journeyStore.put(next);
    setJourney(next);
    router.setParams({ id: next.id });
    toast(toastText, 'success');
  };

  const onPicked = (next: Journey) => {
    setOriginal((o) => o ?? journey);
    setEditIndex(null);
    const diff = Math.round((Date.parse(next.departure) - Date.parse(journey.departure)) / 60000);
    replaceJourney(
      next,
      diff < 0
        ? t('journey.editedEarlier', { min: formatDuration(-diff) })
        : diff > 0
          ? t('journey.editedLater', { min: formatDuration(diff) })
          : t('journey.edited'),
    );
  };

  const resetJourney = () => {
    if (!original) return;
    replaceJourney(original, t('journey.edited'));
    setOriginal(null);
  };

  /**
   * Umstiegs-Hinweis. Antippen öffnet die Auswahl: bei knappem Umstieg für die ankommende
   * Fahrt (früher ankommen), sonst für die abfahrende (Wartezeit verkürzen).
   */
  const changePill = (c: ChangeInfo) => {
    const tone = changeToneColor[c.tone];
    const parts = [t('journey.change', { stop: shortStopName(c.stop.name), min: formatDuration(Math.max(0, c.totalMin)) })];
    if (c.walkMin > 0) parts.push(t('journey.changeWalk', { min: formatDuration(c.walkMin) }));
    if (c.tone === 'tight') parts.push(t('journey.changeTight'));
    if (c.tone === 'missed') parts.push(t('journey.changeMissed'));
    const content = (
      <>
        <Feather name={c.tone === 'ok' ? 'shuffle' : 'alert-triangle'} size={14} color={tone.fg} />
        <AppText variant="smallStrong" color={tone.fg} style={{ flexShrink: 1 }}>
          {parts.join(' · ')}
        </AppText>
        {offline ? null : <Feather name="edit-2" size={13} color={tone.fg} />}
      </>
    );
    if (offline) return <View style={[styles.change, { backgroundColor: tone.bg }]}>{content}</View>;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityHint={t('journey.changeEdit')}
        onPress={() => {
          setEditing(true);
          setEditIndex(c.tone === 'ok' ? c.toIndex : c.fromIndex);
        }}
        style={({ pressed }) => [styles.change, { backgroundColor: tone.bg }, pressed && { opacity: 0.8 }]}>
        {content}
      </Pressable>
    );
  };

  const openMap = () => {
    showJourneyOnMap(journey);
    router.push('/map?focus=journey');
  };

  return (
    <Screen
      footer={
        offline ? undefined : (
          <Button
            title={t('journey.trackButton')}
            icon="radio"
            variant="cyan"
            size="lg"
            loading={busy}
            disabled={transitLegs.length === 0}
            onPress={startTracking}
          />
        )
      }>
      <StackHeader
        title={t('journey.yours')}
        subtitle={`${formatDay(journey.departure)} · ${formatDuration(journey.durationMin)} · ${
          journey.transfers === 0 ? t('journey.direct.lower') : tn('journey.transfers', journey.transfers)
        }`}
      />

      <View style={{ gap: 4 }}>
        <AppText variant="title" numberOfLines={2}>
          {shortStopName(first?.from.name)}
        </AppText>
        <AppText variant="title" color={colors.textMuted} numberOfLines={2}>
          → {shortStopName(last?.to.name)}
        </AppText>
        {offline ? (
          <View style={styles.offlineBadge}>
            <Feather name="wifi-off" size={14} color={colors.textOnLight} />
            <AppText variant="smallStrong" color={colors.textOnLight}>
              {t('offline.badge')}
            </AppText>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
            <Button title={t('place.showOnMap')} icon="map" variant="light" size="sm" full={false} onPress={openMap} />
            {/* Pendler-Modus: Start, Ziel und Uhrzeit dieser Verbindung als Strecke speichern */}
            <Button
              title={t('commute.saveFromJourney')}
              icon="repeat"
              variant="light"
              size="sm"
              full={false}
              onPress={() => saveJourneyAsCommute(journey, user)}
            />
            {transitLegs.length > 0 ? (
              <Button
                title={editing ? t('journey.editDone') : t('journey.edit')}
                icon={editing ? 'check' : 'edit-2'}
                variant={editing ? 'cyan' : 'light'}
                size="sm"
                full={false}
                onPress={() => setEditing((e) => !e)}
              />
            ) : null}
          </View>
        )}
      </View>

      {editing && !offline ? (
        <View style={styles.editBox}>
          <Notice icon="edit-2" text={t('journey.editHint')} color={colors.text} />
          <View style={styles.editActions}>
            {original ? (
              <Button title={t('journey.editReset')} icon="rotate-ccw" variant="light" size="sm" full={false} onPress={resetJourney} />
            ) : null}
            {/* Kurze Animation, wie das Ändern funktioniert (Hilfe & Tutorials) */}
            <Button
              title={t('help.watch')}
              icon="play-circle"
              variant="light"
              size="sm"
              full={false}
              onPress={() => router.push({ pathname: '/tutorial/[id]', params: { id: 'change-rides' } })}
            />
          </View>
        </View>
      ) : null}

      <View>
        {journey.legs.map((leg, i) => {
          const depDelay = delayMinutes(leg.plannedDeparture, leg.departure);
          const arrDelay = delayMinutes(leg.plannedArrival, leg.arrival);
          const isLast = i === journey.legs.length - 1;
          if (leg.walking || !leg.line) {
            // Fußweg: Start/Ziel mit Namen (bei Adressen der gewählte Name, z. B. "Weseler Straße 108"),
            // bei Haltestellen mit Gleis/Steig des anschließenden bzw. vorherigen Fahrzeugs.
            const prevMode = journey.legs[i - 1]?.line?.mode;
            const nextMode = journey.legs[i + 1]?.line?.mode;
            const fromTrack = trackLabel(prevMode ?? nextMode, leg.fromTrack ?? leg.fromPlannedTrack, { short: true });
            const toTrack = trackLabel(nextMode ?? prevMode, leg.toTrack ?? leg.toPlannedTrack, { short: true });
            // Umstieg mit Fußweg: Hinweis am ersten Fußweg zwischen den beiden Fahrten
            const walkChange = changes.find((c) => c.fromIndex === i - 1 && c.toIndex > i);
            return (
              <View key={i} style={styles.walk}>
                <View style={styles.walkIcon}>
                  <ModeIcon mode="WALK" size={18} color={colors.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="small" muted>
                    {t('journey.walk', { min: Math.max(1, leg.durationMin) })}
                    {leg.distanceM ? ` · ${Math.round(leg.distanceM)} m` : ''}
                  </AppText>
                  <AppText variant="smallStrong" numberOfLines={2}>
                    {shortStopName(leg.from.name)}
                    {fromTrack ? `, ${fromTrack}` : ''} → {shortStopName(leg.to.name)}
                    {toTrack ? `, ${toTrack}` : ''}
                  </AppText>
                  {walkChange ? <View style={{ marginTop: 6 }}>{changePill(walkChange)}</View> : null}
                </View>
              </View>
            );
          }
          const s = leg.summary;
          const level = levelOf(s);
          const stopsCount = Math.max(0, (leg.stopovers?.length ?? 2) - 1);
          // Umstieg direkt danach (ohne Fußweg dazwischen) statt der Trennlinie anzeigen
          const directChange = changes.find((c) => c.fromIndex === i && c.toIndex === i + 1);
          const editThis = () => setEditIndex(i);
          return (
            <View key={i}>
            <TimelineItem
              top={formatTime(leg.plannedDeparture)}
              topSub={depDelay > 0 ? `+${depDelay}` : undefined}
              bottom={formatTime(leg.plannedArrival)}
              bottomSub={arrDelay > 0 ? `+${arrDelay}` : undefined}
              separator={!isLast && !directChange}>
              <StatusCard
                tone={level}
                tab={offline ? t('offline.legTab') : legTab(leg, now)}
                tabIcon={
                  offline ? (
                    <Feather name="wifi-off" size={13} color={colors.textOnLight} />
                  ) : s?.level === 'active' && s.lastKind ? (
                    <KindIcon kind={s.lastKind} size={15} color={colors.textOnLight} />
                  ) : undefined
                }
                mode={leg.line.mode}
                title={`${leg.line.name} → ${shortStopName(leg.headsign)}`}
                subtitle={`${shortStopName(leg.from.name)} → ${shortStopName(leg.to.name)} · ${tn('journey.stops', stopsCount)}`}
                // Häufigkeit nur zeigen, wenn es überhaupt Meldungen gab ("0×" verwirrt nur)
                meta={
                  s && (s.count30d > 0 || s.level === 'active')
                    ? {
                        progress: s.level === 'active' ? 1 : Math.min(1, s.count30d / 20),
                        progressLabel: t('journey.count30', { n: s.count30d }),
                      }
                    : undefined
                }
                // Linienseite und Fahrtverlauf brauchen Internet (Offline-Linien haben keine Server-ID)
                onPress={
                  offline
                    ? undefined
                    : editing
                      ? editThis
                      : () => openLine(leg.line!, { tripId: leg.tripId, time: leg.departure, headsign: leg.headsign, directionId: leg.directionId })
                }
                onMenu={offline ? undefined : editing ? editThis : () => openLine(leg.line!)}
                menuIcon={editing ? 'edit-2' : 'chevron-right'}>
                {leg.fromTrack || leg.fromPlannedTrack || leg.toTrack || leg.toPlannedTrack ? (
                  // Gleis / Steig an Start und Ziel dieses Abschnitts ("ab Gleis 17", "an Steig B1")
                  <View style={styles.tracks}>
                    <TrackTag mode={leg.line.mode} track={leg.fromTrack} plannedTrack={leg.fromPlannedTrack} context="dep" onColor />
                    <TrackTag mode={leg.line.mode} track={leg.toTrack} plannedTrack={leg.toPlannedTrack} context="arr" onColor />
                  </View>
                ) : null}
                {leg.line.onDemand ? (
                  <View style={styles.onDemand}>
                    <Feather name="phone-call" size={13} color={colors.textOnLight} />
                    <AppText variant="smallStrong" color={colors.textOnLight} style={{ flex: 1 }}>
                      {t('onDemand.legHint')}
                    </AppText>
                  </View>
                ) : null}
                <AppText variant="smallStrong" color={colors.text}>
                  {offline ? t('offline.legText') : summaryText(s, now)}
                </AppText>
              </StatusCard>
            </TimelineItem>
            {directChange ? <View style={styles.changeRow}>{changePill(directChange)}</View> : null}
            </View>
          );
        })}
      </View>

      {transitLegs.length > 0 && !offline ? (
        <View style={styles.kindsBox}>
          <KindMultiSelect value={kinds} onChange={setKinds} />
        </View>
      ) : null}

      {offline ? <Notice icon="wifi-off" text={t('offline.journeyNote')} /> : <Notice text={t('journey.tip')} />}

      {!offline && editIndex !== null ? (
        <LegOptionsSheet
          key={`${journey.id}-${editIndex}`}
          journey={journey}
          index={editIndex}
          onClose={() => setEditIndex(null)}
          onPicked={onPicked}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  kindsBox: { backgroundColor: colors.surface, borderRadius: 24, padding: spacing.lg },
  editBox: { backgroundColor: colors.surface, borderRadius: 24, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.cyan },
  changeRow: { marginLeft: 64, marginVertical: spacing.md },
  editActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  onDemand: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: colors.cyan,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 6,
  },
  change: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.cyan,
  },
  walk: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingLeft: 8 },
  tracks: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  walkIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
