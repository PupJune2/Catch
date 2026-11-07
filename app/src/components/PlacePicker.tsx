// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, errorMessage } from '@/api/client';
import { geoPlaceId, type Place } from '@/api/contract';
import { api } from '@/api/endpoints';
import { t as tGlobal, useI18n, type TKey } from '@/i18n';
import { getCoordsIfPermitted, getCurrentCoords, locationDeniedText, type Coords } from '@/lib/location';
import {
  isFavorite,
  placeTitle,
  savedPlaces,
  slotLabel,
  useSavedPlaces,
  type PlaceChoice,
  type PlaceSlot,
  type SavedPlaces,
} from '@/lib/places';
import { useDebounced } from '@/lib/useAsync';
import { searchOfflineStops } from '@/offline/engine';
import { isNetworkError, knownOffline } from '@/offline/network';
import { offlineStorage, useInstalledRegions } from '@/offline/storage';
import { colors, radius, spacing } from '@/theme';
import { ModeIcon } from './transit';
import { AppText, Button, Chip, ChipRow, ErrorBox, IconButton, Input, Notice } from './ui';

type FeatherName = ComponentProps<typeof Feather>['name'];

/**
 * Zuletzt bekannte Position – nur, wenn der Standort ohnehin schon erlaubt ist (keine Nachfrage).
 * Damit rankt die Suche Treffer in der Nähe zuerst ("Weseler Straße 108" in Münster statt Bünde).
 */
let knownCoords: { coords: Coords; at: number } | null = null;
const COORDS_MAX_AGE = 5 * 60_000;

function freshCoords(): Coords | null {
  return knownCoords && Date.now() - knownCoords.at < COORDS_MAX_AGE ? knownCoords.coords : null;
}

function cityOf(name: string): string | null {
  const m = name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : null;
}

const SLOT_ICON: Record<PlaceSlot, FeatherName> = { home: 'home', work: 'briefcase' };
const SLOTS: PlaceSlot[] = ['home', 'work'];

function truncate(s: string, max = 22): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// ---------------------------------------------------------------------------
// Zeile + Icon
// ---------------------------------------------------------------------------

/** Kachel mit Icon je Art: Haltestelle (Verkehrsmittel), Adresse (Pin), Ort (Fahne), Zuhause/Arbeit. */
export function PlaceIcon({ place, slot, bg }: { place: Place; slot?: PlaceSlot | null; bg?: string }) {
  let icon: ReactNode;
  if (slot) icon = <Feather name={SLOT_ICON[slot]} size={17} color={colors.lime} />;
  else if (place.kind === 'STOP') icon = <ModeIcon mode={place.modes?.[0] ?? 'OTHER'} size={18} color={colors.lime} />;
  else if (place.kind === 'ADDRESS') icon = <Feather name="map-pin" size={17} color={colors.cyan} />;
  else icon = <Feather name="flag" size={17} color={colors.lilac} />;
  return <View style={[styles.rowIcon, bg ? { backgroundColor: bg } : null]}>{icon}</View>;
}

function usePlaceDetail() {
  const { t, locale } = useI18n();
  return (place: Place): string => {
    const where = place.detail ?? (place.kind === 'STOP' ? cityOf(place.name) : null) ?? t(`place.kind.${place.kind}` as TKey);
    let dist: string | null = null;
    if (place.distance !== undefined) {
      const m = Math.round(place.distance);
      if (m < 1000) dist = t('stop.distance', { m });
      else {
        let km = String(Math.round(m / 100) / 10);
        try {
          km = (m / 1000).toLocaleString(locale, { maximumFractionDigits: m >= 10000 ? 0 : 1 });
        } catch {
          // Engine ohne Intl → Rohwert
        }
        dist = t('place.km', { km });
      }
    }
    return [where, dist].filter(Boolean).join(' · ');
  };
}

function PlaceRow({
  place,
  title,
  detail,
  slot,
  offline,
  onPress,
  onMore,
}: {
  place: Place;
  title?: string;
  detail?: string;
  slot?: PlaceSlot | null;
  /** aus einem Offline-Fahrplan (ohne Internet gefunden) */
  offline?: boolean;
  onPress: () => void;
  onMore?: () => void;
}) {
  const { t } = useI18n();
  const detailOf = usePlaceDetail();
  const name = title ?? placeTitle(place);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onMore}
      delayLongPress={450}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}>
      <PlaceIcon place={place} slot={slot} />
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {name}
        </AppText>
        <View style={styles.detailRow}>
          {offline ? (
            // Aus einem Offline-Fahrplan (ohne Internet gefunden)
            <View style={styles.offlineTag}>
              <Feather name="wifi-off" size={10} color={colors.cyan} />
              <AppText variant="smallStrong" color={colors.cyan} style={styles.offlineTagText}>
                {t('offline.tag')}
              </AppText>
            </View>
          ) : null}
          <AppText variant="small" muted numberOfLines={1} style={{ flexShrink: 1 }}>
            {detail ?? detailOf(place)}
          </AppText>
        </View>
      </View>
      {place.kind === 'STOP' && place.modes?.length ? (
        <View style={styles.modes}>
          {place.modes.slice(0, 3).map((m) => (
            <ModeIcon key={m} mode={m} size={15} color={colors.textMuted} />
          ))}
        </View>
      ) : null}
      {onMore ? (
        <Pressable onPress={onMore} hitSlop={10} accessibilityLabel={t('place.actions', { name })} style={styles.more}>
          <Feather name="more-horizontal" size={20} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function SectionCaption({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.caption}>
      <AppText variant="caption" muted style={{ flex: 1 }}>
        {title}
      </AppText>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <AppText variant="smallStrong" color={colors.lime}>
            {action}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const Sep = () => <View style={styles.sep} />;

// ---------------------------------------------------------------------------
// Aktionen (Zuhause/Arbeit/Favorit) als unteres Sheet innerhalb des Pickers
// ---------------------------------------------------------------------------

interface SheetTarget {
  place: Place;
  from: 'result' | 'recent' | 'saved';
}

interface SheetAction {
  key: string;
  icon: FeatherName;
  label: string;
  sub?: string;
  danger?: boolean;
  run: () => void;
}

function ActionSheet({
  target,
  saved,
  onClose,
  onFlash,
  onAssign,
}: {
  target: SheetTarget;
  saved: SavedPlaces;
  onClose: () => void;
  onFlash: (msg: string) => void;
  onAssign: (slot: PlaceSlot) => void;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const detailOf = usePlaceDetail();
  const { place, from } = target;
  const actions: SheetAction[] = [];

  for (const slot of SLOTS) {
    const current = saved[slot];
    if (current?.id === place.id) {
      if (from === 'saved') {
        actions.push({
          key: `change-${slot}`,
          icon: 'edit-2',
          label: t('place.changeSlot', { slot: slotLabel(slot) }),
          run: () => onAssign(slot),
        });
      }
      actions.push({
        key: `remove-${slot}`,
        icon: SLOT_ICON[slot],
        label: t(slot === 'home' ? 'place.removeHome' : 'place.removeWork'),
        danger: true,
        run: () => {
          savedPlaces.setSlot(slot, null);
          onFlash(t('place.removed'));
        },
      });
    } else {
      actions.push({
        key: `save-${slot}`,
        icon: SLOT_ICON[slot],
        label: t(slot === 'home' ? 'place.saveHome' : 'place.saveWork'),
        sub: current ? t('place.replaces', { name: placeTitle(current) }) : undefined,
        run: () => {
          savedPlaces.setSlot(slot, place);
          onFlash(t('place.savedAs', { slot: slotLabel(slot) }));
        },
      });
    }
  }
  if (isFavorite(saved, place.id)) {
    actions.push({
      key: 'unfav',
      icon: 'star',
      label: t('place.removeFavorite'),
      danger: true,
      run: () => {
        savedPlaces.removeFavorite(place.id);
        onFlash(t('place.removed'));
      },
    });
  } else {
    actions.push({
      key: 'fav',
      icon: 'star',
      label: t('place.addFavorite'),
      run: () => {
        savedPlaces.addFavorite(place);
        onFlash(t('place.favoriteAdded'));
      },
    });
  }
  if (from === 'recent') {
    actions.push({
      key: 'unrecent',
      icon: 'clock',
      label: t('place.removeRecent'),
      danger: true,
      run: () => savedPlaces.removeRecent(place.id),
    });
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.backdrop]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.handle} />
        <View style={styles.sheetHead}>
          <PlaceIcon place={place} bg={colors.surfaceDeep} />
          <View style={{ flex: 1 }}>
            <AppText variant="h3" numberOfLines={2}>
              {placeTitle(place)}
            </AppText>
            <AppText variant="small" muted numberOfLines={1}>
              {detailOf(place)}
            </AppText>
          </View>
        </View>
        <View style={styles.actions}>
          {actions.map((a, i) => (
            <Pressable
              key={a.key}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                a.run();
              }}
              style={({ pressed }) => [styles.action, i > 0 && styles.actionBorder, pressed && { opacity: 0.75 }]}>
              <Feather name={a.icon} size={18} color={a.danger ? colors.orange : colors.lime} />
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong" color={a.danger ? colors.orange : colors.text}>
                  {a.label}
                </AppText>
                {a.sub ? (
                  <AppText variant="small" muted numberOfLines={1}>
                    {a.sub}
                  </AppText>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
        <Notice icon="lock" text={t('place.deviceOnly')} />
        <Button title={t('common.cancel')} variant="secondary" onPress={onClose} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------

/**
 * Vollbild-Auswahl für Start/Ziel: Haltestellen, Adressen (Straße + Hausnummer) und Orte,
 * dazu "Aktueller Standort", Zuhause/Arbeit/Favoriten und zuletzt genutzte Orte.
 * Gespeicherte Orte liegen nur auf dem Gerät (siehe lib/places.ts).
 * Für reine Haltestellen-Auswahl (Melden, Live-Tracking, Abfahrtstafel) → StopPicker.
 */
export function PlacePicker({
  visible,
  title,
  onClose,
  onSelect,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSelect: (choice: PlaceChoice) => void;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const saved = useSavedPlaces();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 250);
  /** offline = ohne Internet aus den heruntergeladenen Fahrplänen gesucht */
  const [results, setResults] = useState<{ q: string; places: Place[]; offline?: boolean } | null>(null);
  const [netFail, setNetFail] = useState(false);
  const { installed } = useInstalledRegions();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  /** "Zuhause festlegen": der nächste gewählte Ort wird gespeichert statt übernommen. */
  const [assign, setAssign] = useState<PlaceSlot | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setResults(null);
      setError(null);
      setNetFail(false);
      setLocMsg(null);
      setSheet(null);
      setAssign(null);
      setFlash(null);
      return;
    }
    // Position nur nutzen, wenn sie ohnehin erlaubt ist – hier nie nachfragen.
    if (!freshCoords()) {
      getCoordsIfPermitted()
        .then((c) => {
          if (c) knownCoords = { coords: c, at: Date.now() };
        })
        .catch(() => undefined);
    }
  }, [visible]);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (q.length < 2) {
      setLoading(false);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setNetFail(false);
    // Ohne Internet: Haltestellen aus den heruntergeladenen Offline-Fahrplänen
    const offlineSearch = (e: unknown) =>
      searchOfflineStops(q, freshCoords()).then((places) => {
        if (ctrl.signal.aborted) return;
        if (places.length || offlineStorage.list().length > 0) setResults({ q, places, offline: true });
        else {
          setNetFail(true);
          setError(errorMessage(e));
        }
      });
    (knownOffline()
      ? offlineSearch(new ApiError(0, 'network', tGlobal('err.network')))
      : api
          .searchPlaces(q, freshCoords(), ctrl.signal)
          .then((r) => {
            if (!ctrl.signal.aborted) setResults({ q, places: r.places });
          })
          .catch((e) => {
            if (ctrl.signal.aborted || (e as Error)?.name === 'AbortError') return;
            if (isNetworkError(e)) return offlineSearch(e);
            setError(errorMessage(e));
          })
    )
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    // Veraltete Anfrage abbrechen, sobald weitergetippt wird
    return () => ctrl.abort();
  }, [q]);

  const showFlash = (msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2600);
  };

  const startAssign = (slot: PlaceSlot) => {
    setAssign(slot);
    setQuery('');
    setSheet(null);
  };

  const choose = (place: Place, current = false) => {
    if (assign) {
      savedPlaces.setSlot(assign, place);
      showFlash(t('place.savedAs', { slot: slotLabel(assign) }));
      setAssign(null);
      setQuery('');
      return;
    }
    if (!current) savedPlaces.pushRecent(place);
    onSelect({ place, current });
    onClose();
  };

  const pickCurrentLocation = async () => {
    setLocating(true);
    setLocMsg(null);
    const loc = await getCurrentCoords();
    if (!loc.ok) {
      setLocating(false);
      setLocMsg(locationDeniedText());
      return;
    }
    const { lat, lon } = loc.coords;
    knownCoords = { coords: loc.coords, at: Date.now() };
    // Ohne Adresse: "Aktueller Standort" mit Koordinaten
    let place: Place = { kind: 'ADDRESS', id: geoPlaceId(lat, lon), name: t('place.currentLocation'), lat, lon };
    try {
      const r = await api.reversePlace(lat, lon);
      if (r.place) place = { ...r.place, kind: r.place.kind === 'STOP' ? 'ADDRESS' : r.place.kind, id: geoPlaceId(lat, lon), lat, lon, modes: undefined, distance: undefined };
    } catch {
      // Adresse ist nur Beschriftung – Planung klappt auch ohne
    }
    setLocating(false);
    choose(place, true);
  };

  const searching = q.length >= 2 || query.trim().length >= 2;
  const list = results && results.q === q ? results.places : results?.places ?? [];
  const savedIds = new Set([saved.home?.id, saved.work?.id, ...saved.favorites.map((f) => f.id)].filter(Boolean) as string[]);
  const recent = saved.recent.filter((p) => !savedIds.has(p.id));
  const hasSaved = !!saved.home || !!saved.work || saved.favorites.length > 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={styles.root}>
        <View style={[styles.inner, { paddingTop: insets.top + spacing.sm }]}>
          <View style={styles.head}>
            <IconButton icon="x" accessibilityLabel={t('common.close')} onPress={onClose} />
            <AppText variant="h3" style={{ flex: 1, textAlign: 'center', marginRight: 42 }} numberOfLines={1}>
              {assign ? t('place.assignTitle', { slot: slotLabel(assign) }) : title}
            </AppText>
          </View>
          <Input
            icon="search"
            placeholder={t('place.searchPlaceholder')}
            value={query}
            onChangeText={setQuery}
            onClear={() => setQuery('')}
            autoFocus
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="search"
            containerStyle={{ marginTop: spacing.md }}
          />

          {assign ? (
            <View style={styles.assign}>
              <Feather name={SLOT_ICON[assign]} size={16} color={colors.lime} />
              <AppText variant="small" style={{ flex: 1 }}>
                {t('place.assignText', { slot: slotLabel(assign) })}
              </AppText>
              <Pressable onPress={() => setAssign(null)} hitSlop={8}>
                <AppText variant="smallStrong" color={colors.lime}>
                  {t('common.cancel')}
                </AppText>
              </Pressable>
            </View>
          ) : null}
          {flash ? <Notice icon="check-circle" text={flash} color={colors.lime} /> : null}

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl, gap: spacing.md }}>
            {searching ? (
              <>
                {error ? <ErrorBox message={error} /> : null}
                {netFail && installed.length === 0 ? <Notice icon="download-cloud" text={t('offline.pickerNoPackages')} /> : null}
                {results?.offline && !error ? (
                  <View style={styles.offlineNote}>
                    <Feather name="wifi-off" size={15} color={colors.cyan} style={{ marginTop: 1 }} />
                    <AppText variant="small" style={{ flex: 1 }}>
                      {t('offline.pickerOffline')}
                    </AppText>
                  </View>
                ) : null}
                {loading && list.length === 0 ? <ActivityIndicator color={colors.lime} style={{ marginTop: spacing.md }} /> : null}
                {list.length > 0 ? (
                  <View style={loading ? { opacity: 0.6 } : undefined}>
                    {list.map((p, i) => (
                      <View key={`${p.id}-${i}`}>
                        {i > 0 ? <Sep /> : null}
                        <PlaceRow
                          place={p}
                          slot={saved.home?.id === p.id ? 'home' : saved.work?.id === p.id ? 'work' : null}
                          offline={results?.offline}
                          onPress={() => choose(p)}
                          onMore={assign ? undefined : () => setSheet({ place: p, from: 'result' })}
                        />
                      </View>
                    ))}
                  </View>
                ) : null}
                {!loading && !error && results?.q === q && q.length >= 2 && list.length === 0 ? (
                  <View style={styles.empty}>
                    <Feather name="map-pin" size={22} color={colors.textMuted} />
                    <AppText variant="small" muted center>
                      {results.offline ? t('offline.pickerNotFound', { q }) : t('place.notFound', { q })}
                    </AppText>
                  </View>
                ) : null}
              </>
            ) : (
              <>
                {/* Schnellwahl: Zuhause, Arbeit, Favoriten */}
                {!assign ? (
                  <ChipRow>
                    {SLOTS.map((slot) => {
                      const p = saved[slot];
                      return p ? (
                        <Chip key={slot} label={slotLabel(slot)} icon={SLOT_ICON[slot]} onPress={() => choose(p)} />
                      ) : (
                        <Chip
                          key={slot}
                          label={t(slot === 'home' ? 'place.addHome' : 'place.addWork')}
                          icon="plus"
                          onPress={() => startAssign(slot)}
                          style={styles.chipEmpty}
                        />
                      );
                    })}
                    {saved.favorites.map((f) => (
                      <Chip key={f.id} label={truncate(placeTitle(f))} icon="star" onPress={() => choose(f)} />
                    ))}
                  </ChipRow>
                ) : null}

                <View>
                  <Pressable
                    onPress={locating ? undefined : pickCurrentLocation}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}>
                    <View style={[styles.rowIcon, { backgroundColor: colors.lime }]}>
                      <Feather name="navigation" size={17} color={colors.textOnLight} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppText variant="bodyStrong">{t('place.currentLocation')}</AppText>
                      <AppText variant="small" muted numberOfLines={1}>
                        {locating ? t('place.locating') : t('place.currentLocationHint')}
                      </AppText>
                    </View>
                    {locating ? <ActivityIndicator color={colors.lime} /> : null}
                  </Pressable>
                  {locMsg ? <Notice icon="map-pin" text={locMsg} style={{ paddingHorizontal: 8, marginTop: 4 }} /> : null}
                </View>

                {recent.length > 0 ? (
                  <View>
                    <SectionCaption title={t('place.recent')} action={t('place.clearRecent')} onAction={() => savedPlaces.clearRecent()} />
                    {recent.map((p, i) => (
                      <View key={p.id}>
                        {i > 0 ? <Sep /> : null}
                        <PlaceRow
                          place={p}
                          onPress={() => choose(p)}
                          onMore={assign ? undefined : () => setSheet({ place: p, from: 'recent' })}
                        />
                      </View>
                    ))}
                  </View>
                ) : null}

                {hasSaved && !assign ? (
                  <View>
                    <SectionCaption title={t('place.saved')} />
                    {SLOTS.map((slot) => {
                      const p = saved[slot];
                      if (!p) return null;
                      return (
                        <View key={slot}>
                          <PlaceRow
                            place={p}
                            slot={slot}
                            title={slotLabel(slot)}
                            detail={[placeTitle(p), p.detail].filter(Boolean).join(' · ')}
                            onPress={() => choose(p)}
                            onMore={() => setSheet({ place: p, from: 'saved' })}
                          />
                          <Sep />
                        </View>
                      );
                    })}
                    {saved.favorites.map((p) => (
                      <View key={p.id}>
                        <PlaceRow place={p} onPress={() => choose(p)} onMore={() => setSheet({ place: p, from: 'saved' })} />
                        <Sep />
                      </View>
                    ))}
                  </View>
                ) : null}

                <Notice
                  icon="lock"
                  text={hasSaved ? t('place.deviceOnly') : t('place.saveHint')}
                  style={{ paddingHorizontal: 8 }}
                />
              </>
            )}
          </ScrollView>
        </View>

        {sheet ? (
          <ActionSheet target={sheet} saved={saved} onClose={() => setSheet(null)} onFlash={showFlash} onAssign={startAssign} />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, paddingHorizontal: spacing.lg, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: radius.md,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modes: { flexDirection: 'row', gap: 4 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  offlineTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: 'rgba(46,200,230,0.14)',
  },
  offlineTagText: { fontSize: 11, lineHeight: 15 },
  offlineNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(46,200,230,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(46,200,230,0.35)',
  },
  more: { paddingLeft: 4, paddingVertical: 6 },
  sep: { height: 1, backgroundColor: colors.border, marginLeft: 58 },
  caption: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, marginBottom: 2 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: spacing.xl },
  chipEmpty: { borderStyle: 'dashed', borderColor: colors.borderStrong, backgroundColor: 'transparent' },
  assign: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(199,232,165,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(199,232,165,0.35)',
  },
  backdrop: { backgroundColor: colors.overlay, justifyContent: 'flex-end' },
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
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 14 },
  actionBorder: { borderTopWidth: 1, borderTopColor: colors.border },
});
