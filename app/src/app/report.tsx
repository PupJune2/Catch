// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ApiError, errorMessage } from '@/api/client';
import type { Departure, Report, ReportKind, ReportTag, Stop, Trip } from '@/api/contract';
import { REPORT_KINDS, TAGS_BY_KIND } from '@/api/contract';
import { api } from '@/api/endpoints';
import { EmptyState } from '@/components/EmptyState';
import { GhostLogo } from '@/components/GhostLogo';
import { KindBadge, KindIcon, KindTile } from '@/components/kinds';
import { DepartureRow } from '@/components/rows';
import { Screen, StackHeader } from '@/components/Screen';
import { StopPicker } from '@/components/StopPicker';
import { ThrottledNotice } from '@/components/TrustBadge';
import { LineBadge, TrackTag } from '@/components/transit';
import { AppText, Button, Chip, ChipRow, ErrorBox, Notice, SkeletonList } from '@/components/ui';
import { useI18n, type TKey } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { formatTime, shortStopName } from '@/lib/format';
import { KIND_COLOR, kindLabel, kindQuestion, kindSubmit } from '@/lib/kinds';
import { segmentText, tagLabel } from '@/lib/labels';
import { getCurrentCoords, locationDeniedText } from '@/lib/location';
import { openLine } from '@/lib/navigation';
import { useNow } from '@/lib/useAsync';
import { colors, radius, spacing } from '@/theme';

type Step = 'kind' | 'pick' | 'stops' | 'details' | 'done';
type Role = 'prev' | 'next';

const WHEN: { key: TKey; min: number }[] = [
  { key: 'report.when.now', min: 0 },
  { key: 'report.when.5', min: 5 },
  { key: 'report.when.15', min: 15 },
  { key: 'report.when.30', min: 30 },
];

export default function ReportScreen() {
  const params = useLocalSearchParams<{ tripId?: string }>();
  const { user } = useAuth();
  const { t } = useI18n();
  const now = useNow(30000);

  // Schritt 1: Was ist los? (Art des Hinweises)
  const [step, setStep] = useState<Step>('kind');
  const [kind, setKind] = useState<ReportKind | null>(null);

  // Schritt 2: Linie wählen
  const [candidates, setCandidates] = useState<Departure[] | null>(null);
  const [candState, setCandState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [candMsg, setCandMsg] = useState<string | null>(null);
  const [station, setStation] = useState<Stop | null>(null);
  const [stationDeps, setStationDeps] = useState<Departure[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Schritt 3: Fahrt + Haltestellen
  const [selected, setSelected] = useState<Departure | null>(null);
  const [tripId, setTripId] = useState<string | null>(params.tripId ?? null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [tripState, setTripState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [tripError, setTripError] = useState<string | null>(null);
  const [prevIdx, setPrevIdx] = useState<number | null>(null);
  const [nextIdx, setNextIdx] = useState<number | null>(null);
  const [role, setRole] = useState<Role>('prev');
  const [fallbackStop, setFallbackStop] = useState<Stop | null>(null);
  const [tripRetry, setTripRetry] = useState(0);

  // Schritt 4: Details (nur die Merkmale, die zur Art passen)
  const [tags, setTags] = useState<ReportTag[]>([]);
  const [minutesAgo, setMinutesAgo] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Automatische Drosselung (wiederholt umstrittene Meldungen) → eigener Hinweis statt Fehlerbox
  const [throttled, setThrottled] = useState(false);
  const [created, setCreated] = useState<Report | null>(null);

  const loadCandidates = async () => {
    setCandState('loading');
    setCandMsg(null);
    const loc = await getCurrentCoords();
    if (!loc.ok) {
      setCandState('error');
      setCandMsg(locationDeniedText());
      return;
    }
    try {
      const r = await api.reportCandidates(loc.coords.lat, loc.coords.lon);
      setCandidates(r.departures);
      setCandState('idle');
    } catch (e) {
      setCandState('error');
      setCandMsg(errorMessage(e));
    }
  };

  useEffect(() => {
    // Linien in der Nähe schon laden, während die Art gewählt wird
    if (user && !params.tripId && candidates === null && candState === 'idle') loadCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Fahrt laden, sobald eine gewählt ist
  useEffect(() => {
    if (!tripId || !user) return;
    let cancelled = false;
    setTripState('loading');
    setTripError(null);
    api
      .trip(tripId)
      .then((tr) => {
        if (cancelled) return;
        setTrip(tr);
        setPrevIdx(tr.position.prevIndex);
        setNextIdx(tr.position.nextIndex);
        setRole(tr.position.prevIndex === null ? 'prev' : 'next');
        setTripState('idle');
      })
      .catch((e) => {
        if (cancelled) return;
        setTripState('error');
        setTripError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [tripId, user, tripRetry]);

  const chooseKind = (k: ReportKind) => {
    if (k !== kind) setTags([]);
    setKind(k);
    setStep(params.tripId ? 'stops' : 'pick');
  };

  const toggleTag = (tag: ReportTag) => {
    // Verspätung: genau eine Stufe; sonst mehrere Merkmale möglich
    if (kind === 'DELAY') setTags((prev) => (prev.includes(tag) ? [] : [tag]));
    else setTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));
  };

  const pickDeparture = (d: Departure) => {
    setSelected(d);
    setTrip(null);
    setPrevIdx(null);
    setNextIdx(null);
    setFallbackStop(null);
    setTripId(d.tripId);
    setStep('stops');
  };

  const pickStation = async (s: Stop) => {
    setStation(s);
    setStationDeps(null);
    try {
      const r = await api.departures(s.id, new Date(Date.now() - 20 * 60000).toISOString(), 40);
      setStationDeps(r.departures);
    } catch (e) {
      setCandMsg(errorMessage(e));
      setStationDeps([]);
    }
  };

  const tapStop = (i: number) => {
    if (role === 'prev') {
      setPrevIdx(i);
      if (nextIdx !== null && nextIdx <= i) setNextIdx(trip && i + 1 < trip.stopovers.length ? i + 1 : null);
      setRole('next');
    } else {
      setNextIdx(i);
      if (prevIdx !== null && prevIdx >= i) setPrevIdx(i > 0 ? i - 1 : null);
    }
  };

  const line = trip?.line ?? selected?.line ?? null;
  const headsign = trip?.headsign ?? selected?.headsign;
  const prevStop: Stop | null = trip && prevIdx !== null ? trip.stopovers[prevIdx]?.stop ?? null : fallbackStop;
  const nextStop: Stop | null = trip && nextIdx !== null ? trip.stopovers[nextIdx]?.stop ?? null : null;

  const submit = async () => {
    if (!line || !kind) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await api.createReport({
        kind,
        line,
        tripId: trip?.id ?? tripId ?? undefined,
        directionId: trip?.directionId ?? selected?.directionId,
        headsign: headsign || undefined,
        prevStop,
        nextStop,
        tags: tags.filter((tag) => TAGS_BY_KIND[kind].includes(tag)),
        minutesAgo,
      });
      setCreated(r);
      setStep('done');
    } catch (e) {
      setSubmitError(errorMessage(e));
      setThrottled(e instanceof ApiError && e.code === 'throttled');
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  // --- Login nötig ---------------------------------------------------------
  if (!user) {
    return (
      <Screen>
        <StackHeader title={t('report.title')} onBack={close} />
        <View style={{ alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxl }}>
          <GhostLogo size={96} />
          <AppText variant="title" center>
            {t('report.loginTitle')}
          </AppText>
          <AppText variant="body" muted center style={{ maxWidth: 320 }}>
            {t('report.loginText')}
          </AppText>
          <Button
            title={t('profile.signInOrRegister')}
            size="lg"
            onPress={() => router.push({ pathname: '/login', params: { reason: t('report.loginReason') } })}
          />
        </View>
      </Screen>
    );
  }

  // --- Fertig --------------------------------------------------------------
  if (step === 'done' && created) {
    return (
      <Screen
        footer={
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button
              title={t('report.viewLine')}
              variant="secondary"
              onPress={() => {
                close();
                openLine(created.line);
              }}
              style={{ flex: 1 }}
            />
            <Button title={t('report.done')} onPress={close} style={{ flex: 1 }} />
          </View>
        }>
        <View style={{ alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxxl * 1.5 }}>
          <View style={styles.doneRing}>
            <GhostLogo size={110} />
          </View>
          <AppText variant="display" center>
            {t('report.thanks')}
          </AppText>
          <AppText variant="body" muted center style={{ maxWidth: 320 }}>
            {t('report.liveNow', { line: created.line.name })}
          </AppText>
          <View style={styles.doneCard}>
            <LineBadge line={created.line} showIcon />
            <View style={{ flex: 1, gap: 6 }}>
              <AppText variant="bodyStrong" numberOfLines={2}>
                {segmentText(created)}
              </AppText>
              <KindBadge kind={created.kind ?? kind ?? 'CHECK'} />
            </View>
          </View>
        </View>
      </Screen>
    );
  }

  const stepIndex = step === 'kind' ? 0 : step === 'pick' ? 1 : step === 'stops' ? 2 : 3;
  const accent = kind ? KIND_COLOR[kind] : colors.orange;

  return (
    <Screen
      footer={
        step === 'stops' ? (
          <Button
            title={t('report.next')}
            icon="arrow-right"
            size="lg"
            disabled={!prevStop && !nextStop}
            onPress={() => setStep('details')}
          />
        ) : step === 'details' && kind ? (
          <Button title={kindSubmit(kind)} icon="send" variant="danger" size="lg" loading={submitting} onPress={submit} />
        ) : undefined
      }>
      <StackHeader
        title={t('report.title')}
        subtitle={t('report.step', { n: stepIndex + 1 })}
        onBack={() => {
          if (step === 'details') setStep('stops');
          else if (step === 'stops') setStep(params.tripId ? 'kind' : 'pick');
          else if (step === 'pick') setStep('kind');
          else close();
        }}
      />
      <View style={styles.progress}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.progressSeg, i <= stepIndex && { backgroundColor: colors.orange }]} />
        ))}
      </View>

      {/* ---------------- Schritt 1: Art ---------------- */}
      {step === 'kind' ? (
        <>
          <AppText variant="title">{t('report.whatSeen')}</AppText>
          <View style={{ gap: spacing.sm }}>
            {REPORT_KINDS.map((k) => (
              <KindTile key={k} kind={k} selected={kind === k} onPress={() => chooseKind(k)} />
            ))}
          </View>
          <Notice icon="shield" text={t('common.ticketHint')} />
        </>
      ) : null}

      {/* ---------------- Schritt 2: Linie ---------------- */}
      {step === 'pick' ? (
        <>
          <AppText variant="title">{t('report.whichLine')}</AppText>
          {!station ? (
            <>
              <View style={styles.rowHead}>
                <Feather name="navigation" size={14} color={colors.lime} />
                <AppText variant="smallStrong" color={colors.lime} style={{ flex: 1 }}>
                  {t('report.nearby')}
                </AppText>
                {candidates ? (
                  <Pressable onPress={loadCandidates} hitSlop={8}>
                    <Feather name="refresh-cw" size={16} color={colors.textMuted} />
                  </Pressable>
                ) : null}
              </View>
              {candState === 'loading' ? <SkeletonList count={4} height={58} /> : null}
              {candMsg ? <Notice icon="map-pin" text={candMsg} /> : null}
              {candidates && candidates.length > 0 ? (
                <View style={styles.list}>
                  {candidates.map((d) => (
                    <DepartureRow key={`${d.tripId}-${d.plannedTime}`} dep={d} now={now} showStop onPress={() => pickDeparture(d)} />
                  ))}
                </View>
              ) : null}
              {candidates && candidates.length === 0 ? (
                <EmptyState title={t('report.nothingTitle')} text={t('report.nothingText')} size={52} />
              ) : null}
            </>
          ) : (
            <>
              <View style={styles.rowHead}>
                <Feather name="map-pin" size={14} color={colors.cyan} />
                <AppText variant="smallStrong" color={colors.cyan} style={{ flex: 1 }} numberOfLines={1}>
                  {t('report.departuresAt', { stop: shortStopName(station.name) })}
                </AppText>
                <Pressable
                  onPress={() => {
                    setStation(null);
                    setStationDeps(null);
                  }}
                  hitSlop={8}>
                  <AppText variant="smallStrong" color={colors.textMuted}>
                    {t('report.backToNearby')}
                  </AppText>
                </Pressable>
              </View>
              {stationDeps === null ? <ActivityIndicator color={colors.lime} /> : null}
              {stationDeps && stationDeps.length > 0 ? (
                <View style={styles.list}>
                  {stationDeps.map((d) => (
                    <DepartureRow key={`${d.tripId}-${d.plannedTime}`} dep={d} now={now} onPress={() => pickDeparture(d)} />
                  ))}
                </View>
              ) : null}
            </>
          )}
          <Button title={t('report.searchStop')} icon="search" variant="secondary" onPress={() => setPickerOpen(true)} />
          <StopPicker visible={pickerOpen} title={t('report.whereAreYou')} onClose={() => setPickerOpen(false)} onSelect={pickStation} />
        </>
      ) : null}

      {/* ---------------- Schritt 3: Haltestellen ---------------- */}
      {step === 'stops' ? (
        <>
          <View style={styles.lineHead}>
            {line ? <LineBadge line={line} size="lg" showIcon /> : null}
            <AppText variant="h2" style={{ flex: 1 }} numberOfLines={2}>
              {headsign ? `→ ${shortStopName(headsign)}` : t('report.loadingTrip')}
            </AppText>
          </View>
          <AppText variant="title">{t('report.whereExactly')}</AppText>
          <View style={styles.roles}>
            <RoleBox
              label={t('report.prevStop')}
              value={prevStop ? shortStopName(prevStop.name) : t('report.tapHint')}
              active={role === 'prev'}
              color={colors.lime}
              onPress={() => setRole('prev')}
            />
            <RoleBox
              label={t('report.nextStop')}
              value={nextStop ? shortStopName(nextStop.name) : t('report.tapHint')}
              active={role === 'next'}
              color={colors.orange}
              onPress={() => setRole('next')}
            />
          </View>
          <Notice text={t('report.estimateHint')} />

          {tripState === 'loading' ? <SkeletonList count={6} height={44} /> : null}
          {tripState === 'error' ? (
            <View style={{ gap: spacing.sm }}>
              <ErrorBox message={tripError ?? t('report.tripFailed')} onRetry={() => setTripRetry((n) => n + 1)} />
              {selected ? (
                <Button
                  title={t('report.onlyStop', { stop: shortStopName(selected.stop.name) })}
                  variant="secondary"
                  onPress={() => {
                    setFallbackStop(selected.stop);
                    setStep('details');
                  }}
                />
              ) : null}
            </View>
          ) : null}

          {trip ? (
            <View style={styles.stopList}>
              {trip.stopovers.map((so, i) => {
                const isPrev = i === prevIdx;
                const isNext = i === nextIdx;
                const between = prevIdx !== null && nextIdx !== null && i > prevIdx && i < nextIdx;
                const passed = trip.position.prevIndex !== null && i <= trip.position.prevIndex;
                const time = so.departure ?? so.arrival ?? so.plannedDeparture ?? so.plannedArrival;
                return (
                  <Pressable key={`${so.stop.id}-${i}`} onPress={() => tapStop(i)} style={({ pressed }) => [styles.stopRow, pressed && { backgroundColor: colors.surfaceAlt }]}>
                    <View style={styles.rail}>
                      <View style={[styles.railLine, i === 0 && { top: '50%' }, i === trip.stopovers.length - 1 && { bottom: '50%' }, (between || isPrev) && { backgroundColor: colors.orange }]} />
                      <View
                        style={[
                          styles.railDot,
                          passed && { backgroundColor: colors.textFaint },
                          isPrev && { backgroundColor: colors.lime, width: 16, height: 16, borderRadius: 8 },
                          isNext && { backgroundColor: colors.orange, width: 16, height: 16, borderRadius: 8 },
                        ]}
                      />
                    </View>
                    <AppText variant="mono" muted style={{ width: 50, fontSize: 13 }}>
                      {formatTime(time)}
                    </AppText>
                    <AppText
                      variant={isPrev || isNext ? 'bodyStrong' : 'body'}
                      color={isPrev ? colors.lime : isNext ? colors.orange : passed ? colors.textMuted : colors.text}
                      style={{ flex: 1 }}
                      numberOfLines={1}>
                      {shortStopName(so.stop.name)}
                    </AppText>
                    <TrackTag mode={trip.line.mode} track={so.track} plannedTrack={so.plannedTrack} short />
                    {isPrev ? <Tag text={t('report.tagPrev')} color={colors.lime} /> : null}
                    {isNext ? <Tag text={t('report.tagNext')} color={colors.orange} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </>
      ) : null}

      {/* ---------------- Schritt 4: Details ---------------- */}
      {step === 'details' && kind ? (
        <>
          <AppText variant="title">{kindQuestion(kind)}</AppText>
          <View style={[styles.summaryCard, { backgroundColor: accent }]}>
            {line ? <LineBadge line={line} size="lg" showIcon /> : null}
            <View style={{ flex: 1 }}>
              <View style={styles.summaryKind}>
                <KindIcon kind={kind} size={15} color={colors.textOnLight} />
                <AppText variant="caption" color={colors.textOnLight}>
                  {kindLabel(kind)}
                </AppText>
              </View>
              <AppText variant="bodyStrong" color={colors.textOnLight} numberOfLines={2}>
                {segmentText({ prevStop, nextStop })}
              </AppText>
              {headsign ? (
                <AppText variant="small" color={colors.textOnLightMuted} numberOfLines={1}>
                  {t('report.direction', { stop: shortStopName(headsign) })}
                </AppText>
              ) : null}
            </View>
          </View>

          <View style={{ gap: spacing.sm }}>
            <AppText variant="caption" muted>
              {t('report.where')}
            </AppText>
            <ChipRow>
              {TAGS_BY_KIND[kind].map((tag) => (
                <Chip key={tag} label={tagLabel(tag)} selected={tags.includes(tag)} color={accent} onPress={() => toggleTag(tag)} />
              ))}
            </ChipRow>
          </View>

          <View style={{ gap: spacing.sm }}>
            <AppText variant="caption" muted>
              {t('report.whenLabel')}
            </AppText>
            <ChipRow>
              {WHEN.map((w) => (
                <Chip key={w.key} label={t(w.key)} selected={minutesAgo === w.min} color={accent} onPress={() => setMinutesAgo(w.min)} />
              ))}
            </ChipRow>
          </View>

          {submitError ? throttled ? <ThrottledNotice message={submitError} /> : <ErrorBox message={submitError} /> : null}
          <Notice
            icon="eye-off"
            text={t('report.privacy')}
          />
        </>
      ) : null}
    </Screen>
  );
}

function RoleBox({ label, value, active, color, onPress }: { label: string; value: string; active: boolean; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.roleBox, active && { borderColor: color, backgroundColor: `${color}1F` }]}>
      <AppText variant="caption" color={active ? color : colors.textMuted}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" numberOfLines={2}>
        {value}
      </AppText>
    </Pressable>
  );
}

function Tag({ text, color }: { text: string; color: string }) {
  return (
    <View style={[styles.tag, { backgroundColor: color }]}>
      <AppText variant="smallStrong" color={colors.textOnLight} style={{ fontSize: 11 }}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: 6, marginTop: -spacing.sm },
  progressSeg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.surfaceAlt },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: -spacing.sm },
  list: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 6 },
  lineHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  roles: { flexDirection: 'row', gap: spacing.sm },
  roleBox: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: 4,
    minHeight: 76,
  },
  stopList: { backgroundColor: colors.surface, borderRadius: radius.card, paddingVertical: 6, paddingHorizontal: 6 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 46, paddingRight: 10, borderRadius: 12 },
  rail: { width: 28, height: '100%', alignItems: 'center', justifyContent: 'center' },
  railLine: { position: 'absolute', top: 0, bottom: 0, width: 3, backgroundColor: colors.surfaceAlt, borderRadius: 2 },
  railDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.text },
  tag: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  summaryKind: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.orange,
    borderRadius: radius.card,
    padding: spacing.lg,
  },
  doneRing: {
    width: 180,
    height: 180,
    borderRadius: 60,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  doneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    alignSelf: 'stretch',
    marginTop: spacing.md,
  },
});
