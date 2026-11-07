// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import type { Departure, Journey, Stop } from '@/api/contract';
import { api } from '@/api/endpoints';
import { DateTimeSheet, WhenField, type When } from '@/components/DateTimePicker';
import { sameDay, startOfDay } from '@/components/DayStrip';
import { EmptyState } from '@/components/EmptyState';
import { DepartureRow, JourneyCard } from '@/components/rows';
import { PlacePicker } from '@/components/PlacePicker';
import { Screen } from '@/components/Screen';
import { StopPicker } from '@/components/StopPicker';
import { AppText, Button, Chip, ChipRow, ErrorBox, Notice, SkeletonList } from '@/components/ui';
import { useI18n, type TKey } from '@/i18n';
import { formatDateLong, formatDayMonth, shortStopName } from '@/lib/format';
import { openDepartureLine } from '@/lib/navigation';
import {
  choiceTitle,
  journeyName,
  placeTitle,
  placeToStop,
  savedPlaces,
  slotLabel,
  useSavedPlaces,
  type PlaceChoice,
  type PlaceSlot,
} from '@/lib/places';
import { journeyStore } from '@/lib/store';
import { useNow } from '@/lib/useAsync';
import { planOfflineJourneys, type OfflineFailure } from '@/offline/engine';
import { isNetworkError, knownOffline } from '@/offline/network';
import { regionDaysLeft, useInstalledRegions, type InstalledRegion } from '@/offline/storage';
import { colors, radius, spacing } from '@/theme';
import { AddToWidgetButton } from '@/widget/AddToWidgetButton';

type Tab = 'journeys' | 'departures';
type Which = 'search' | 'earlier' | 'later';

interface OfflineResultInfo {
  region: InstalledRegion;
  /** true = automatisch, weil keine Verbindung bestand */
  auto: boolean;
}

interface OfflineFailInfo {
  reason: OfflineFailure;
  region?: InstalledRegion;
  auto: boolean;
}
type PickerTarget = 'from' | 'to' | 'station' | null;

function roundedNow(): { h: number; m: number } {
  const d = new Date();
  const m = Math.ceil(d.getMinutes() / 5) * 5;
  return m === 60 ? { h: (d.getHours() + 1) % 24, m: 0 } : { h: d.getHours(), m };
}

export default function SearchScreen() {
  const now = useNow(30000);
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('journeys');
  const [picker, setPicker] = useState<PickerTarget>(null);

  // Start/Ziel: Haltestelle, Adresse, Ort oder aktueller Standort
  const [from, setFrom] = useState<PlaceChoice | null>(null);
  const [to, setTo] = useState<PlaceChoice | null>(null);
  const [station, setStation] = useState<Stop | null>(null);
  const saved = useSavedPlaces();

  const [day, setDay] = useState<Date>(startOfDay(new Date()));
  const initial = roundedNow();
  const [hours, setHours] = useState(initial.h);
  const [minutes, setMinutes] = useState(initial.m);
  const [useNowTime, setUseNowTime] = useState(true);
  const [whenOpen, setWhenOpen] = useState(false);
  const [arriveBy, setArriveBy] = useState(false);
  const when: When = { day, hours, minutes, isNow: useNowTime && sameDay(day, new Date()), arriveBy };

  const [journeys, setJourneys] = useState<Journey[] | null>(null);
  const [cursors, setCursors] = useState<{ earlier?: string; later?: string }>({});
  const [departures, setDepartures] = useState<Departure[] | null>(null);
  const [loading, setLoading] = useState<false | Which>(false);
  const [error, setError] = useState<string | null>(null);

  // Offline-Fahrpläne: erzwungen (Chip) oder automatisch bei fehlender Verbindung
  const { installed } = useInstalledRegions();
  const [offlineMode, setOfflineMode] = useState(false);
  const [offlineResult, setOfflineResult] = useState<OfflineResultInfo | null>(null);
  // Server hat zusätzlich Verbindungen mit langem Fußweg geliefert (ländliches Ziel, nichts in den nächsten Stunden)
  const [longWalkNotice, setLongWalkNotice] = useState(false);
  const [offlineFail, setOfflineFail] = useState<OfflineFailInfo | null>(null);
  const [offlinePaging, setOfflinePaging] = useState({ earlier: true, later: true });
  const [boardOffline, setBoardOffline] = useState(false);

  // Nach einer neuen Suche automatisch zu den Ergebnissen scrollen
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const resultsY = useRef(0);
  const contentY = useRef(0);
  const [scrollTick, setScrollTick] = useState(0);
  useEffect(() => {
    if (scrollTick === 0) return;
    const timer = setTimeout(
      () => scrollRef.current?.scrollTo({ y: Math.max(0, contentY.current + resultsY.current - 12), animated: true }),
      60,
    );
    return () => clearTimeout(timer);
  }, [scrollTick]);

  const timeIso = (): string | undefined => {
    if (useNowTime && sameDay(day, new Date())) return undefined;
    const d = new Date(day);
    d.setHours(hours, minutes, 0, 0);
    return d.toISOString();
  };

  const searchTimeMs = (): number => {
    const iso = timeIso();
    return iso ? Date.parse(iso) : Date.now();
  };

  /** Offline auf dem Gerät rechnen (Fahrplan ohne Echtzeit). */
  const runOffline = async (which: Which, auto: boolean) => {
    if (!from || !to) return;
    const res = await planOfflineJourneys(from.place, to.place, searchTimeMs(), {
      arriveBy,
      page: which === 'search' ? undefined : { dir: which, journeys: journeys ?? [] },
    });
    if (!res.ok) {
      if (which === 'search') {
        setJourneys(null);
        setOfflineResult(null);
        setOfflineFail({ reason: res.reason, region: res.region, auto });
      } else {
        // Keine weiteren Verbindungen in dieser Richtung
        setOfflinePaging((p) => ({ ...p, [which]: false }));
      }
      return;
    }
    setCursors({});
    setOfflineFail(null);
    setOfflineResult({ region: res.region, auto: which === 'search' ? auto : (offlineResult?.auto ?? auto) });
    setLongWalkNotice(false);
    setJourneys((prev) => {
      if (which === 'earlier') return [...res.journeys, ...(prev ?? [])];
      if (which === 'later') return [...(prev ?? []), ...res.journeys];
      return res.journeys;
    });
    if (which === 'search') {
      setOfflinePaging({ earlier: true, later: true });
      setScrollTick((n) => n + 1);
    }
  };

  const searchJourneys = async (which: Which = 'search', forceOffline = offlineMode) => {
    if (!from || !to) {
      setError(t('search.pickBoth'));
      return;
    }
    if (from.place.id === to.place.id) {
      setError(t('search.same'));
      return;
    }
    setError(null);
    if (which === 'search') setOfflineFail(null);
    setLoading(which);
    try {
      // Weitere Ergebnisse dort holen, wo die bisherigen herkommen
      if (forceOffline || (which !== 'search' && offlineResult)) {
        await runOffline(which, false);
        return;
      }
      if (which === 'search' && knownOffline()) {
        await runOffline(which, true);
        return;
      }
      const cursor = which === 'earlier' ? cursors.earlier : which === 'later' ? cursors.later : undefined;
      let res: Awaited<ReturnType<typeof api.journeys>>;
      try {
        res = await api.journeys({
          from: from.place.id,
          to: to.place.id,
          // Beschriftung der Fußwege bei Adressen/Orten ("Weseler Straße 108" statt "START")
          fromName: journeyName(from),
          toName: journeyName(to),
          time: cursor ? undefined : timeIso(),
          arriveBy,
          cursor,
        });
      } catch (e) {
        // Keine Verbindung → mit heruntergeladenem Fahrplan auf dem Gerät weiter
        if (which === 'search' && isNetworkError(e)) {
          await runOffline(which, true);
          return;
        }
        throw e;
      }
      setOfflineResult(null);
      if (which === 'search') setLongWalkNotice(res.notice === 'longWalk');
      setCursors((prev) => ({
        earlier: which === 'later' ? prev.earlier : res.earlierCursor,
        later: which === 'earlier' ? prev.later : res.laterCursor,
      }));
      setJourneys((prev) => {
        if (which === 'earlier') return [...res.journeys, ...(prev ?? [])];
        if (which === 'later') return [...(prev ?? []), ...res.journeys];
        return res.journeys;
      });
      if (which === 'search') setScrollTick((n) => n + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const toggleOffline = () => {
    const next = !offlineMode;
    setOfflineMode(next);
    // Vorhandene Ergebnisse gleich im neuen Modus neu suchen
    if (from && to && (journeys || offlineFail)) void searchJourneys('search', next);
  };

  const loadDepartures = async (s: Stop | null = station) => {
    if (!s) {
      setError(t('search.pickStop'));
      return;
    }
    setError(null);
    setBoardOffline(false);
    setLoading('search');
    try {
      const res = await api.departures(s.id, timeIso());
      setDepartures(res.departures);
      setScrollTick((n) => n + 1);
    } catch (e) {
      // Abfahrtstafeln gibt es nur online (Echtzeit) – Hinweis auf die Offline-Planung
      if (isNetworkError(e)) setBoardOffline(true);
      else setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const onPickedStation = (s: Stop) => {
    setStation(s);
    loadDepartures(s);
  };

  // Deep-Link vom Homescreen-Widget: catch://search?board=<stopId>&boardName=<Name> → Abfahrtstafel
  const { board, boardName } = useLocalSearchParams<{ board?: string; boardName?: string }>();
  useEffect(() => {
    if (!board) return;
    setTab('departures');
    onPickedStation({ id: board, name: boardName || board });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  const resetResults = () => {
    setJourneys(null);
    setOfflineResult(null);
    setOfflineFail(null);
  };

  const onPickedPlace = (c: PlaceChoice) => {
    if (picker === 'from') setFrom(c);
    else if (picker === 'to') setTo(c);
    resetResults();
  };

  /** Schnellwahl (Zuhause/Arbeit/Favorit): füllt das erste leere Feld, sonst das Ziel. */
  const quickPick = (c: PlaceChoice) => {
    if (!from) setFrom(c);
    else setTo(c);
    resetResults();
    savedPlaces.pushRecent(c.place);
  };

  const swap = () => {
    setFrom(to);
    setTo(from);
    resetResults();
  };

  const switchTab = (next: Tab) => {
    // Abfahrtstafel gibt es nur für Haltestellen: Start übernehmen, wenn er eine ist
    // (Offline gefundene Haltestellen haben nur Koordinaten – für die Tafel braucht es eine echte ID)
    if (next === 'departures' && !station && from?.place.kind === 'STOP' && !from.place.id.startsWith('geo:')) {
      setStation(placeToStop(from.place));
    }
    setTab(next);
  };

  const quick: { key: string; label: string; icon: 'home' | 'briefcase' | 'star'; choice: PlaceChoice }[] = [
    ...(['home', 'work'] as PlaceSlot[]).flatMap((slot) => {
      const p = saved[slot];
      return p ? [{ key: slot, label: slotLabel(slot), icon: slot === 'home' ? ('home' as const) : ('briefcase' as const), choice: { place: p } }] : [];
    }),
    ...saved.favorites.slice(0, 3).map((p) => ({
      key: p.id,
      label: placeTitle(p).length > 20 ? `${placeTitle(p).slice(0, 19).trimEnd()}…` : placeTitle(p),
      icon: 'star' as const,
      choice: { place: p },
    })),
  ];

  // Datum UND Uhrzeit der Suche (vorher stand bei anderen Tagen nur das Datum da)
  const timeLabel =
    useNowTime && sameDay(day, new Date())
      ? t('search.now')
      : `${formatDateLong(day)}, ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  return (
    <Screen
      withTabBar
      scrollRef={scrollRef}
      onContentLayout={(y) => (contentY.current = y)}
      header={
        <View style={{ gap: spacing.lg, paddingBottom: spacing.sm }}>
          <AppText variant="title">{tab === 'journeys' ? t('search.titleJourneys') : t('search.titleDepartures')}</AppText>
          <ChipRow>
            <Chip label={t('search.tabJourney')} icon="git-commit" selected={tab === 'journeys'} onPress={() => switchTab('journeys')} />
            <Chip label={t('search.tabBoard')} icon="clock" selected={tab === 'departures'} onPress={() => switchTab('departures')} />
          </ChipRow>

          {tab === 'journeys' ? (
            <View style={{ gap: spacing.sm }}>
              <View>
                <View style={styles.fields}>
                  <PlaceField
                    label={t('search.from')}
                    choice={from}
                    placeholder={t('search.fromPh')}
                    onPress={() => setPicker('from')}
                    dotColor={colors.lime}
                  />
                  <View style={styles.fieldDivider} />
                  <PlaceField
                    label={t('search.to')}
                    choice={to}
                    placeholder={t('search.toPh')}
                    onPress={() => setPicker('to')}
                    dotColor={colors.orange}
                  />
                </View>
                <Pressable onPress={swap} style={styles.swap} accessibilityLabel={t('search.swap')}>
                  <Feather name="repeat" size={18} color={colors.textOnLight} style={{ transform: [{ rotate: '90deg' }] }} />
                </Pressable>
              </View>
              {quick.length > 0 ? (
                // Gespeicherte Orte (nur auf dem Gerät) als Schnellwahl
                <ChipRow>
                  {quick.map((q) => (
                    <Chip
                      key={q.key}
                      label={q.label}
                      icon={q.icon}
                      selected={from?.place.id === q.choice.place.id || to?.place.id === q.choice.place.id}
                      onPress={() => quickPick(q.choice)}
                    />
                  ))}
                </ChipRow>
              ) : null}
            </View>
          ) : (
            <View style={styles.fields}>
              <StopField
                label={t('search.stop')}
                stop={station}
                placeholder={t('search.stopPh')}
                onPress={() => setPicker('station')}
                dotColor={colors.cyan}
              />
            </View>
          )}

          {/* Wann: ein Feld, das den Datum-/Uhrzeit-Dialog öffnet */}
          <View style={styles.timeRow}>
            <View style={{ flex: 1, minWidth: 200 }}>
              <WhenField value={when} showArriveBy={tab === 'journeys'} onPress={() => setWhenOpen(true)} />
            </View>
            {!when.isNow ? (
              <Chip
                label={t('search.now')}
                selected={false}
                onPress={() => {
                  const r = roundedNow();
                  setDay(startOfDay(new Date()));
                  setHours(r.h);
                  setMinutes(r.m);
                  setUseNowTime(true);
                }}
              />
            ) : null}
            {tab === 'journeys' && (installed.length > 0 || offlineMode) ? (
              // Offline erzwingen (schlechte Verbindung, zum Ausprobieren)
              <Chip label={t('offline.chip')} icon="wifi-off" color={colors.cyan} selected={offlineMode} onPress={toggleOffline} />
            ) : null}
          </View>
          {whenOpen ? (
            <DateTimeSheet
              initial={when}
              showArriveBy={tab === 'journeys'}
              onClose={() => setWhenOpen(false)}
              onApply={(v) => {
                setDay(v.day);
                setHours(v.hours);
                setMinutes(v.minutes);
                setUseNowTime(v.isNow);
                setArriveBy(v.arriveBy);
                setWhenOpen(false);
              }}
            />
          ) : null}

          <Button
            title={tab === 'journeys' ? t('search.findJourneys') : t('search.showDepartures')}
            icon="search"
            size="lg"
            loading={loading === 'search'}
            onPress={() => (tab === 'journeys' ? searchJourneys('search') : loadDepartures())}
          />
        </View>
      }>
      {error ? <ErrorBox message={error} /> : null}

      {tab === 'journeys' ? (
        <View style={{ gap: spacing.md }} onLayout={(e) => (resultsY.current = e.nativeEvent.layout.y)}>
          {loading === 'search' && !journeys ? <SkeletonList count={3} height={150} /> : null}
          {offlineFail && loading !== 'search' ? <OfflineFailBox info={offlineFail} /> : null}
          {journeys && journeys.length > 0 ? (
            <>
              <View style={styles.resultsHead}>
                <AppText variant="h2" style={{ flex: 1 }} numberOfLines={1}>
                  {choiceTitle(from)} → {choiceTitle(to)}
                </AppText>
              </View>
              <AppText variant="small" muted style={{ marginTop: -spacing.sm }}>
                {timeLabel} · {arriveBy ? t('search.arrival') : t('search.departure')}
                {offlineResult ? '' : ` · ${t('search.statusHint')}`}
              </AppText>
              {offlineResult ? <OfflineBanner info={offlineResult} /> : null}
              {longWalkNotice && !offlineResult ? (
                <Notice icon="info" text={t('search.longWalkNotice')} color={colors.orange} style={styles.longWalkNotice} />
              ) : null}
              {cursors.earlier || (offlineResult && offlinePaging.earlier) ? (
                <Button
                  title={t('search.earlier')}
                  icon="chevron-up"
                  variant="secondary"
                  size="sm"
                  loading={loading === 'earlier'}
                  onPress={() => searchJourneys('earlier')}
                />
              ) : null}
              {journeys.map((j) => (
                <JourneyCard
                  key={j.id}
                  journey={j}
                  now={now}
                  onPress={() => router.push({ pathname: '/journey', params: { id: journeyStore.put(j) } })}
                />
              ))}
              {cursors.later || (offlineResult && offlinePaging.later) ? (
                <Button
                  title={t('search.later')}
                  icon="chevron-down"
                  variant="secondary"
                  size="sm"
                  loading={loading === 'later'}
                  onPress={() => searchJourneys('later')}
                />
              ) : null}
            </>
          ) : null}
          {journeys && journeys.length === 0 ? (
            <EmptyState title={t('search.noneTitle')} text={t('search.noneText')} />
          ) : null}
          {!journeys && !offlineFail && loading !== 'search' ? (
            <EmptyState
              title={t('search.planTitle')}
              text={t('search.planText')}
            />
          ) : null}
        </View>
      ) : (
        <View onLayout={(e) => (resultsY.current = e.nativeEvent.layout.y)}>
          {loading === 'search' ? <ActivityIndicator color={colors.lime} style={{ marginVertical: spacing.lg }} /> : null}
          {boardOffline && loading !== 'search' ? (
            <OfflineNotice
              icon="wifi-off"
              title={t('offline.boardTitle')}
              text={installed.length ? t('offline.boardText') : t('offline.boardTextNone')}
              action={t('offline.toSettings')}
              onAction={() => router.push('/offline')}
            />
          ) : null}
          {departures && departures.length > 0 && station ? (
            <AddToWidgetButton stop={station} style={{ alignSelf: 'flex-end', marginBottom: spacing.sm }} />
          ) : null}
          {departures && departures.length > 0 ? (
            <View style={styles.board}>
              {departures.map((d) => (
                <DepartureRow
                  key={`${d.tripId}-${d.plannedTime}`}
                  dep={d}
                  now={now}
                  onPress={() => openDepartureLine(d)}
                />
              ))}
            </View>
          ) : null}
          {departures && departures.length === 0 ? (
            <EmptyState title={t('search.noDepTitle')} text={t('search.noDepText')} />
          ) : null}
          {!departures && !boardOffline && loading !== 'search' ? (
            <EmptyState title={t('search.boardTitle')} text={t('search.boardText')} />
          ) : null}
        </View>
      )}

      {/* Start/Ziel: Adressen, Orte, Haltestellen · Abfahrtstafel: nur Haltestellen */}
      <PlacePicker
        visible={picker === 'from' || picker === 'to'}
        title={picker === 'to' ? t('search.pickerTo') : t('search.pickerFrom')}
        onClose={() => setPicker(null)}
        onSelect={onPickedPlace}
      />
      <StopPicker visible={picker === 'station'} title={t('search.stop')} onClose={() => setPicker(null)} onSelect={onPickedStation} />
    </Screen>
  );
}

/** "Offline · Fahrplan ohne Echtzeit" über den offline berechneten Verbindungen. */
function OfflineBanner({ info }: { info: OfflineResultInfo }) {
  const { t, tn } = useI18n();
  const left = regionDaysLeft(info.region);
  const until = formatDayMonth(`${info.region.validUntil}T12:00:00Z`);
  return (
    <View style={styles.offlineBanner}>
      <View style={styles.offlineIcon}>
        <Feather name="wifi-off" size={16} color={colors.textOnLight} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="smallStrong">{t('offline.banner')}</AppText>
        <AppText variant="small" muted>
          {t(info.auto ? 'offline.bannerAuto' : 'offline.bannerManual', { name: info.region.name, date: until })}
          {left <= 2 && left >= 0 ? ` ${left === 0 ? t('offline.expiresToday') : tn('offline.expiresIn', left)}.` : ''}
        </AppText>
      </View>
    </View>
  );
}

const FAIL_TEXT: Record<OfflineFailure, TKey> = {
  no_package: 'offline.fail.no_package',
  different_packages: 'offline.fail.different_packages',
  expired: 'offline.fail.expired',
  out_of_range: 'offline.fail.out_of_range',
  no_stops: 'offline.fail.no_stops',
  no_connection: 'offline.fail.no_connection',
  load_failed: 'offline.fail.load_failed',
};

/** Offline geht es nicht: Grund + Weg zu den Offline-Fahrplänen. */
function OfflineFailBox({ info }: { info: OfflineFailInfo }) {
  const { t } = useI18n();
  const name = info.region?.name ?? '';
  const params = {
    name,
    from: info.region ? formatDayMonth(`${info.region.validFrom}T12:00:00Z`) : '',
    until: info.region ? formatDayMonth(`${info.region.validUntil}T12:00:00Z`) : '',
  };
  const settings = info.reason !== 'no_connection' && info.reason !== 'no_stops';
  return (
    <OfflineNotice
      icon={info.auto ? 'wifi-off' : 'map'}
      title={info.auto ? t('offline.fail.titleNetwork') : t('offline.fail.title')}
      text={t(FAIL_TEXT[info.reason], params)}
      action={settings ? t('offline.toSettings') : undefined}
      onAction={settings ? () => router.push('/offline') : undefined}
    />
  );
}

function OfflineNotice({
  icon,
  title,
  text,
  action,
  onAction,
}: {
  icon: 'wifi-off' | 'map';
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.offlineFail}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Feather name={icon} size={18} color={colors.cyan} style={{ marginTop: 2 }} />
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="bodyStrong">{title}</AppText>
          <AppText variant="small" muted>
            {text}
          </AppText>
        </View>
      </View>
      {action && onAction ? (
        <Button title={action} icon="download-cloud" variant="light" size="sm" full={false} onPress={onAction} style={{ marginLeft: 28 }} />
      ) : null}
    </View>
  );
}

/** Von/Nach-Feld: Name + Zusatz (z. B. "Weseler Straße 108  48151 Münster"), Icon je Art. */
function PlaceField({
  label,
  choice,
  placeholder,
  onPress,
  dotColor,
}: {
  label: string;
  choice: PlaceChoice | null;
  placeholder: string;
  onPress: () => void;
  dotColor: string;
}) {
  const place = choice?.place;
  // Beim aktuellen Standort steht die ermittelte Adresse als Zusatz
  const detail = choice?.current ? (place && place.name !== choiceTitle(choice) ? place.name : undefined) : place?.detail;
  const icon = !choice
    ? null
    : choice.current
      ? 'navigation'
      : place?.kind === 'ADDRESS'
        ? 'map-pin'
        : place?.kind === 'POI'
          ? 'flag'
          : null;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.field, pressed && { opacity: 0.8 }]}>
      <View style={[styles.fieldDot, { borderColor: dotColor }]} />
      <View style={{ flex: 1 }}>
        <AppText variant="caption" muted>
          {label}
        </AppText>
        <View style={styles.fieldValue}>
          {icon ? <Feather name={icon} size={13} color={colors.textMuted} /> : null}
          <AppText variant="bodyStrong" color={choice ? colors.text : colors.textFaint} numberOfLines={1} style={{ flexShrink: 1 }}>
            {choice ? choiceTitle(choice) : placeholder}
            {detail ? (
              <AppText variant="small" muted>
                {'  '}
                {detail}
              </AppText>
            ) : null}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

function StopField({
  label,
  stop,
  placeholder,
  onPress,
  dotColor,
}: {
  label: string;
  stop: Stop | null;
  placeholder: string;
  onPress: () => void;
  dotColor: string;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.field, pressed && { opacity: 0.8 }]}>
      <View style={[styles.fieldDot, { borderColor: dotColor }]} />
      <View style={{ flex: 1 }}>
        <AppText variant="caption" muted>
          {label}
        </AppText>
        <AppText variant="bodyStrong" color={stop ? colors.text : colors.textFaint} numberOfLines={1}>
          {stop ? shortStopName(stop.name) : placeholder}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  longWalkNotice: { backgroundColor: 'rgba(255,122,26,0.12)', borderRadius: radius.md, padding: spacing.md },
  fields: { backgroundColor: colors.surfaceDeep, borderRadius: radius.card, paddingHorizontal: spacing.md },
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 14, paddingRight: 56 },
  fieldDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
  fieldValue: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  fieldDivider: { height: 1, backgroundColor: colors.border, marginLeft: 26, marginRight: 56 },
  swap: {
    position: 'absolute',
    right: 14,
    top: '50%',
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  resultsHead: { flexDirection: 'row', alignItems: 'center' },
  board: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 6 },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(46,200,230,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(46,200,230,0.35)',
  },
  offlineIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineFail: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(46,200,230,0.35)',
  },
});
