// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Departure, Journey, MapStop, Mode, Report, ReportKind } from '@/api/contract';
import { api } from '@/api/endpoints';
import { KindBadge, KindFilterChips } from '@/components/kinds';
import { MapCanvas, type MapCanvasHandle } from '@/components/MapCanvas';
import { useToast } from '@/components/Toast';
import { LineBadge, ModeIcon } from '@/components/transit';
import { AppText, Button, ErrorBox, Skeleton } from '@/components/ui';
import { API_URL, MAP_URL } from '@/config';
import { t as translate, useI18n } from '@/i18n';
import { formatTime, relativeTime, shortStopName } from '@/lib/format';
import { kindOf } from '@/lib/kinds';
import { segmentText, tagsText } from '@/lib/labels';
import { getCoordsIfPermitted, getCurrentCoords, locationDeniedText, watchCoords, type Coords } from '@/lib/location';
import type { LatLon, MapInMessage, MapOutMessage } from '@/lib/mapProtocol';
import { takeJourneyForMap } from '@/lib/mapStore';
import { openDepartureLine, openLine } from '@/lib/navigation';
import { useAsync, useNow } from '@/lib/useAsync';
import { colors, modeColor, modeLabel, radius, shadow, spacing } from '@/theme';
import { AddToWidgetButton } from '@/widget/AddToWidgetButton';

type Selection = { type: 'report'; report: Report } | { type: 'stop'; stop: MapStop } | null;

/** Letzter Kartenausschnitt – beim nächsten Öffnen geht es dort weiter (nur im Speicher). */
let lastView: { center: LatLon; zoom: number } | null = null;

/** Platz für die Karten-Attribution (OpenFreeMap/OSM) unter den Knöpfen – muss sichtbar bleiben. */
const ATTRIBUTION_SPACE = 34;

const RAIL: Mode[] = ['SUBWAY', 'SUBURBAN', 'REGIONAL', 'LONG_DISTANCE'];
const MODE_ORDER: Mode[] = ['LONG_DISTANCE', 'REGIONAL', 'SUBURBAN', 'SUBWAY', 'TRAM', 'FERRY', 'BUS', 'OTHER'];

/**
 * Karte: aktuelle Hinweise der Community, Haltestellen in der Nähe, eigener Standort und –
 * mit ?focus=journey (vorher showJourneyOnMap(journey)) – der Verlauf einer Verbindung.
 * Die Karte selbst ist die Seite website/map/ (MapLibre), siehe components/MapCanvas.
 */
export default function MapScreen() {
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const { t, tn, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const mapRef = useRef<MapCanvasHandle>(null);

  const [journey] = useState<Journey | null>(() => (focus === 'journey' ? takeJourneyForMap() : null));
  const [kind, setKind] = useState<ReportKind | null>(null);
  const [counts, setCounts] = useState<Partial<Record<ReportKind, number>> | undefined>(undefined);
  const [total, setTotal] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [user, setUser] = useState<Coords | null>(null);
  const [locating, setLocating] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [headerH, setHeaderH] = useState(0);
  const [cardH, setCardH] = useState(0);

  // Vor "ready" gehen Nachrichten verloren (Seite lädt noch) – alles Nötige steckt dann in "init"
  const readyRef = useRef(false);
  const post = useCallback((msg: MapInMessage) => {
    if (readyRef.current) mapRef.current?.post(msg);
  }, []);

  // Immer die aktuellen Werte für "init" (die Seite kann jederzeit neu laden und "ready" senden)
  // Unten von der App überdeckt: Safe-Area + ggf. die Karte mit Details (Attribution rutscht darüber)
  const bottomInset = insets.bottom + (selection ? cardH + spacing.sm : 0);
  const latest = useRef({ lang, kind, user, journey, headerH, bottomInset });
  latest.current = { lang, kind, user, journey, headerH, bottomInset };

  const sendInit = useCallback(() => {
    const s = latest.current;
    // Ausschnitt: Verbindung > zuletzt angesehen > eigener Standort > (Seite: Deutschland)
    const view = s.journey
      ? null
      : (lastView ?? (s.user ? { center: { lat: s.user.lat, lon: s.user.lon }, zoom: 15 } : null));
    readyRef.current = true;
    post({
      type: 'init',
      lang: s.lang,
      apiBase: API_URL,
      center: view?.center,
      zoom: view?.zoom,
      user: s.user,
      journey: s.journey,
      kinds: s.kind ? [s.kind] : null,
      padding: { top: s.headerH, bottom: s.bottomInset },
    });
  }, [post]);

  // --- Standort: ohne Nachfrage, wenn schon erlaubt; danach laufend aktualisieren
  const stopWatch = useRef<(() => void) | null>(null);
  const watching = useRef(false);
  const mounted = useRef(true);
  const startWatch = useCallback(async () => {
    if (watching.current) return;
    watching.current = true;
    const stop = await watchCoords((c) => {
      setUser(c);
      post({ type: 'user', lat: c.lat, lon: c.lon, accuracy: c.accuracy });
    });
    if (mounted.current) stopWatch.current = stop;
    else stop();
  }, [post]);

  useEffect(() => {
    mounted.current = true;
    getCoordsIfPermitted().then((c) => {
      if (!mounted.current || !c) return;
      setUser(c);
      post({ type: 'user', lat: c.lat, lon: c.lon, accuracy: c.accuracy });
      // Erster Besuch ohne Verbindung: zum eigenen Standort (falls noch nicht von Hand bewegt)
      if (!journey && !lastView) post({ type: 'fit', center: { lat: c.lat, lon: c.lon }, zoom: 15, ifUntouched: true });
      startWatch();
    });
    return () => {
      mounted.current = false;
      stopWatch.current?.();
      stopWatch.current = null;
      watching.current = false;
    };
  }, [journey, post, startWatch]);

  // Kommt die Seite nicht hoch (offline, Server weg), Hinweis mit "Erneut"
  useEffect(() => {
    if (ready || loadError) return;
    const timer = setTimeout(() => setLoadError(true), 20000);
    return () => clearTimeout(timer);
  }, [ready, loadError]);

  useEffect(() => {
    if (ready) post({ type: 'kinds', kinds: kind ? [kind] : null });
  }, [kind, ready, post]);

  useEffect(() => {
    if (ready) post({ type: 'lang', lang });
  }, [lang, ready, post]);

  useEffect(() => {
    if (ready) post({ type: 'padding', top: headerH, bottom: bottomInset });
  }, [headerH, bottomInset, ready, post]);

  const closeCard = useCallback(() => {
    setSelection(null);
    post({ type: 'select', selection: null });
  }, [post]);

  // Android-Zurück: erst die Karte unten schließen
  useEffect(() => {
    if (!selection) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeCard();
      return true;
    });
    return () => sub.remove();
  }, [selection, closeCard]);

  const onMapMessage = useCallback(
    (msg: MapOutMessage) => {
      switch (msg.type) {
        case 'ready':
          readyRef.current = false; // Seite (neu) geladen – erst nach "init" wieder senden
          setReady(true);
          setLoadError(false);
          sendInit();
          break;
        case 'moved':
          lastView = { center: msg.center, zoom: msg.zoom };
          break;
        case 'data':
          setCounts(msg.counts);
          setTotal(msg.total);
          break;
        case 'report':
          setSelection({ type: 'report', report: msg.report });
          break;
        case 'stop':
          setSelection({ type: 'stop', stop: msg.stop });
          break;
        case 'tap':
          setSelection(null);
          break;
        case 'longpress':
          // Noch keine Aktion (z. B. "Route von hier") – Protokoll ist vorbereitet
          break;
        case 'error':
          if (__DEV__) console.warn('[map]', msg.message);
          break;
      }
    },
    [sendInit],
  );

  const locate = async () => {
    if (locating) return;
    setLocating(true);
    const r = await getCurrentCoords();
    setLocating(false);
    if (!r.ok) {
      toast(locationDeniedText(), 'error');
      return;
    }
    setUser(r.coords);
    post({ type: 'user', lat: r.coords.lat, lon: r.coords.lon, accuracy: r.coords.accuracy });
    post({ type: 'fit', center: { lat: r.coords.lat, lon: r.coords.lon } });
    startWatch();
  };

  const retry = () => {
    readyRef.current = false;
    setLoadError(false);
    setReady(false);
    mapRef.current?.reload();
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  // Anzahl im Ausschnitt – bei aktivem Filter nur diese Art
  const shown = total === null ? null : kind ? (counts?.[kind] ?? 0) : total;
  const subtitle = journey
    ? journeySummary(journey)
    : shown === null
      ? ' '
      : shown === 0
        ? t('map.noTipsInView')
        : tn('map.tipsInView', shown);

  return (
    <View style={styles.root}>
      <MapCanvas ref={mapRef} url={MAP_URL} onMessage={onMapMessage} onLoadError={() => setLoadError(true)} style={StyleSheet.absoluteFill} />

      {/* Kopf: Zurück, Titel, Filter nach Art */}
      <View
        style={[styles.header, { paddingTop: insets.top + spacing.xs }]}
        onLayout={(e) => setHeaderH(Math.round(e.nativeEvent.layout.height))}>
        <View style={styles.headerRow}>
          <FloatingButton icon="arrow-left" onPress={back} label={t('common.back')} flat />
          <View style={{ flex: 1 }}>
            <AppText variant="h3" numberOfLines={1}>
              {journey ? t('map.journeyTitle') : t('map.title')}
            </AppText>
            <AppText variant="small" muted numberOfLines={1}>
              {subtitle}
            </AppText>
          </View>
        </View>
        <View style={styles.chips}>
          <KindFilterChips value={kind} onChange={setKind} counts={counts} />
        </View>
      </View>

      {/* Schwebende Knöpfe rechts unten */}
      <View
        pointerEvents="box-none"
        style={[styles.fabs, { bottom: bottomInset + ATTRIBUTION_SPACE }]}>
        {journey ? (
          <FloatingButton icon="maximize" label={t('map.fitRoute')} onPress={() => post({ type: 'fit', target: 'journey' })} />
        ) : null}
        <FloatingButton
          icon="navigation"
          label={locating ? t('map.locating') : t('map.locate')}
          onPress={locate}
          loading={locating}
          active={!!user}
        />
      </View>

      {/* Karte unten: Hinweis oder Haltestelle */}
      {selection ? (
        <View
          style={[styles.card, { bottom: insets.bottom + spacing.sm }]}
          onLayout={(e) => setCardH(Math.round(e.nativeEvent.layout.height))}>
          {selection.type === 'report' ? (
            <TipCard report={selection.report} onClose={closeCard} />
          ) : (
            <StopCard stop={selection.stop} onClose={closeCard} />
          )}
        </View>
      ) : null}

      {loadError ? (
        <View style={styles.errorWrap} pointerEvents="box-none">
          <View style={styles.errorCard}>
            <Feather name="map" size={28} color={colors.textMuted} />
            <AppText variant="h3" center>
              {t('map.loadError')}
            </AppText>
            <AppText variant="small" muted center>
              {t('map.loadErrorText')}
            </AppText>
            <Button title={t('common.retry')} icon="refresh-cw" full={false} onPress={retry} style={{ marginTop: spacing.xs }} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function journeySummary(j: Journey): string {
  const first = j.legs[0];
  const last = j.legs[j.legs.length - 1];
  if (!first || !last) return '';
  return `${shortStopName(first.from.name)} → ${shortStopName(last.to.name)} · ${formatTime(j.departure)}–${formatTime(j.arrival)}`;
}

// ---------------------------------------------------------------------------
// Knöpfe
// ---------------------------------------------------------------------------

function FloatingButton({
  icon,
  label,
  onPress,
  loading,
  active,
  flat,
}: {
  icon: ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
  loading?: boolean;
  active?: boolean;
  /** ohne Schatten (im Kopfbereich) */
  flat?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!loading }}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.fab, !flat && shadow, flat && styles.fabFlat, pressed && { opacity: 0.8 }]}>
      {loading ? (
        <ActivityIndicator color={colors.lime} />
      ) : (
        <Feather name={icon} size={19} color={active ? colors.cyan : colors.text} />
      )}
    </Pressable>
  );
}

function CloseButton({ onPress }: { onPress: () => void }) {
  const { t } = useI18n();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('map.closeCard')} onPress={onPress} hitSlop={10} style={styles.close}>
      <Feather name="x" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Hinweis
// ---------------------------------------------------------------------------

function TipCard({ report, onClose }: { report: Report; onClose: () => void }) {
  const { t, tn } = useI18n();
  const now = useNow(30000);
  const kind = kindOf(report);
  const tags = tagsText(report.tags ?? []);
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.cardTop}>
        <KindBadge kind={kind} />
        <AppText variant="small" muted style={{ flex: 1 }} numberOfLines={1}>
          {relativeTime(report.reportedAt, now)}
        </AppText>
        <CloseButton onPress={onClose} />
      </View>
      <View style={styles.lineRow}>
        <LineBadge line={report.line} />
        <AppText variant="h3" style={{ flex: 1 }} numberOfLines={1}>
          {report.headsign ? `→ ${shortStopName(report.headsign)}` : modeLabel(report.line.mode)}
        </AppText>
      </View>
      <View style={{ gap: 2 }}>
        <AppText variant="bodyStrong">{segmentText(report)}</AppText>
        {tags ? (
          <AppText variant="small" muted>
            {tags}
          </AppText>
        ) : null}
        {report.confirmations > 0 ? (
          <View style={styles.confirmRow}>
            <Feather name="check-circle" size={14} color={colors.lime} />
            <AppText variant="small" color={colors.lime}>
              {tn('map.confirmed', report.confirmations)}
            </AppText>
          </View>
        ) : null}
      </View>
      <Button title={t('map.openLine')} icon="arrow-right" onPress={() => openLine(report.line)} style={{ marginTop: spacing.xxs }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Haltestelle mit nächsten Abfahrten
// ---------------------------------------------------------------------------

function mainMode(modes: Mode[] | undefined): Mode {
  return MODE_ORDER.find((m) => modes?.includes(m)) ?? 'BUS';
}

/** "Gleis 5" / "Steig D1" (de) bzw. "Platform 5" (en); kurz: "Gl. 5" / "Pl. 5" */
function trackLabel(track: string, mode: Mode, short = false): string {
  const rail = RAIL.includes(mode);
  const key = short ? (rail ? 'map.trackShort' : 'map.trackShortBus') : rail ? 'map.platform' : 'map.platformBus';
  return translate(key, { track });
}

function StopCard({ stop, onClose }: { stop: MapStop; onClose: () => void }) {
  const { t } = useI18n();
  const now = useNow(30000);
  const deps = useAsync(() => api.departures(stop.id, undefined, 24), [stop.id]);
  const mode = mainMode(stop.modes);
  const upcoming = (deps.data?.departures ?? []).filter((d) => new Date(d.time).getTime() > now - 60_000).slice(0, 6);
  const facts = [
    stop.track ? trackLabel(stop.track, mode) : null,
    ...MODE_ORDER.filter((m) => stop.modes?.includes(m)).map((m) => modeLabel(m)),
  ].filter(Boolean);

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.cardTop}>
        <View style={[styles.stopIcon, { backgroundColor: modeColor[mode] }]}>
          <ModeIcon mode={mode} size={20} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="h3" numberOfLines={2}>
            {shortStopName(stop.name)}
          </AppText>
          <AppText variant="small" muted numberOfLines={1}>
            {facts.join(' · ')}
          </AppText>
        </View>
        <CloseButton onPress={onClose} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xxs }}>
        <AppText variant="caption" muted style={{ flex: 1 }}>
          {t('map.nextDepartures')}
        </AppText>
        {/* Homescreen-Widget (nur Android-App) */}
        <AddToWidgetButton stop={{ id: stop.id, name: stop.name, modes: stop.modes }} />
      </View>
      {deps.error ? <ErrorBox message={deps.error} onRetry={() => deps.reload()} /> : null}
      {deps.loading && !deps.data ? (
        <View style={{ gap: spacing.xs }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={36} />
          ))}
        </View>
      ) : null}
      {deps.data && upcoming.length === 0 ? (
        <AppText variant="small" muted>
          {t('map.noDepartures')}
        </AppText>
      ) : null}
      {upcoming.length > 0 ? (
        <ScrollView style={{ maxHeight: 6 * 46 }} showsVerticalScrollIndicator={false}>
          {upcoming.map((d) => (
            <DepartureLine key={`${d.tripId}-${d.plannedTime}`} dep={d} highlightTrack={stop.track} />
          ))}
        </ScrollView>
      ) : null}
      {stop.track && upcoming.some((d) => d.track === stop.track) ? (
        <AppText variant="small" muted style={{ fontSize: 12 }}>
          {t('map.thisPlatform')}
        </AppText>
      ) : null}
    </View>
  );
}

function DepartureLine({ dep, highlightTrack }: { dep: Departure; highlightTrack?: string }) {
  const { t } = useI18n();
  const delay = dep.delayMin ?? 0;
  const trackChanged = !!dep.track && !!dep.plannedTrack && dep.track !== dep.plannedTrack;
  const mine = !!highlightTrack && dep.track === highlightTrack;
  return (
    <Pressable
      onPress={() => openDepartureLine(dep)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.dep, pressed && { backgroundColor: colors.surfaceAlt }]}>
      <View style={styles.depTime}>
        <AppText variant="mono" style={[{ fontSize: 14 }, dep.cancelled && styles.strike]}>
          {formatTime(dep.plannedTime)}
        </AppText>
        {dep.cancelled ? (
          <AppText variant="smallStrong" color={colors.orange} style={{ fontSize: 11 }}>
            {t('dep.cancelled')}
          </AppText>
        ) : delay > 0 ? (
          <AppText variant="smallStrong" color={colors.orange} style={{ fontSize: 11 }}>
            +{delay}
          </AppText>
        ) : dep.realtime ? (
          <AppText variant="smallStrong" color={colors.lime} style={{ fontSize: 11 }}>
            +0
          </AppText>
        ) : null}
      </View>
      <LineBadge line={dep.line} size="sm" />
      <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1, fontSize: 14 }}>
        {shortStopName(dep.headsign)}
      </AppText>
      {dep.track ? (
        <View style={[styles.track, mine && styles.trackMine, trackChanged && styles.trackChanged]}>
          <AppText
            variant="smallStrong"
            color={mine ? colors.textOnLight : trackChanged ? colors.orange : colors.text}
            style={{ fontSize: 11.5 }}
            numberOfLines={1}>
            {trackLabel(dep.track, dep.line.mode, true)}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    backgroundColor: 'rgba(22,32,58,0.95)',
    borderBottomLeftRadius: radius.card,
    borderBottomRightRadius: radius.card,
    ...shadow,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  chips: { paddingLeft: spacing.md },
  fabs: { position: 'absolute', right: spacing.md, gap: spacing.sm, alignItems: 'flex-end' },
  fab: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabFlat: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surfaceAlt, borderWidth: 0 },
  card: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  stopIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  dep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 46,
    paddingVertical: 4,
    paddingHorizontal: spacing.xs,
    marginHorizontal: -spacing.xs,
    borderRadius: radius.sm,
  },
  depTime: { width: 46 },
  strike: { textDecorationLine: 'line-through', color: colors.textMuted },
  track: {
    paddingHorizontal: 8,
    height: 24,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 96,
  },
  trackMine: { backgroundColor: colors.lime },
  trackChanged: { borderWidth: 1, borderColor: colors.orange },
  errorWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  errorCard: {
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.xl,
    maxWidth: 340,
    ...shadow,
  },
});
