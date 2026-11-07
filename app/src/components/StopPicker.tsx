// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorMessage } from '@/api/client';
import type { Stop } from '@/api/contract';
import { api } from '@/api/endpoints';
import { shortStopName } from '@/lib/format';
import { getCurrentCoords, locationDeniedText } from '@/lib/location';
import { useDebounced } from '@/lib/useAsync';
import { colors, radius, spacing } from '@/theme';
import { ModeIcon } from './transit';
import { AppText, Button, ErrorBox, IconButton, Input, Notice } from './ui';
import { useI18n } from '@/i18n';

function cityOf(name: string): string | null {
  const m = name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : null;
}

export function StopRow({ stop, onPress }: { stop: Stop; onPress: () => void }) {
  const { t } = useI18n();
  const city = cityOf(stop.name);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}>
      <View style={styles.rowIcon}>
        <ModeIcon mode={stop.modes?.[0] ?? 'OTHER'} size={18} color={colors.lime} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {shortStopName(stop.name)}
        </AppText>
        <AppText variant="small" muted numberOfLines={1}>
          {[city, stop.distance !== undefined ? t('stop.distance', { m: Math.round(stop.distance) }) : null]
            .filter(Boolean)
            .join(' · ') || t('stop.generic')}
        </AppText>
      </View>
      {stop.modes?.length ? (
        <View style={styles.modes}>
          {stop.modes.slice(0, 3).map((m) => (
            <ModeIcon key={m} mode={m} size={15} color={colors.textMuted} />
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

/** Vollbild-Auswahl einer Haltestelle: Suche mit Autovervollständigung + "In der Nähe". */
export function StopPicker({
  visible,
  title,
  onClose,
  onSelect,
  allowNearby = true,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSelect: (stop: Stop) => void;
  allowNearby?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 250);
  const [results, setResults] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<Stop[] | null>(null);
  const [nearbyState, setNearbyState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [nearbyMsg, setNearbyMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setResults([]);
      setError(null);
    }
  }, [visible]);

  useEffect(() => {
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api
      .searchStops(q, ctrl.signal)
      .then((r) => setResults(r.stops))
      .catch((e) => {
        if ((e as Error)?.name !== 'AbortError') setError(errorMessage(e));
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [q]);

  const loadNearby = async () => {
    setNearbyState('loading');
    setNearbyMsg(null);
    const loc = await getCurrentCoords();
    if (!loc.ok) {
      setNearbyState('error');
      setNearbyMsg(locationDeniedText());
      return;
    }
    try {
      const r = await api.nearbyStops(loc.coords.lat, loc.coords.lon);
      setNearby(r.stops);
      setNearbyState('idle');
    } catch (e) {
      setNearbyState('error');
      setNearbyMsg(errorMessage(e));
    }
  };

  const pick = (s: Stop) => {
    onSelect(s);
    onClose();
  };

  const showNearby = q.length < 2;
  const data = showNearby ? nearby ?? [] : results;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.head}>
          <IconButton icon="x" accessibilityLabel={t('common.close')} onPress={onClose} />
          <AppText variant="h3" style={{ flex: 1, textAlign: 'center', marginRight: 42 }}>
            {title}
          </AppText>
        </View>
        <Input
          icon="search"
          placeholder={t('stop.searchPlaceholder')}
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          containerStyle={{ marginTop: spacing.md }}
        />
        {error ? <ErrorBox message={error} /> : null}
        {showNearby && allowNearby ? (
          <View style={{ gap: spacing.sm }}>
            {nearby === null ? (
              <Button
                title={t('stop.nearbyButton')}
                icon="navigation"
                variant="light"
                loading={nearbyState === 'loading'}
                onPress={loadNearby}
              />
            ) : (
              <AppText variant="caption" muted>
                {t('stop.nearby')}
              </AppText>
            )}
            {nearbyMsg ? <Notice icon="map-pin" text={nearbyMsg} /> : null}
          </View>
        ) : null}
        {loading ? <ActivityIndicator color={colors.lime} style={{ marginTop: spacing.md }} /> : null}
        <FlatList
          data={data}
          keyExtractor={(s) => s.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          renderItem={({ item }) => <StopRow stop={item} onPress={() => pick(item)} />}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={
            !loading && q.length >= 2 && !error ? (
              <View style={styles.empty}>
                <Feather name="map-pin" size={22} color={colors.textMuted} />
                <AppText variant="small" muted center>
                  {t('stop.notFound', { q })}
                </AppText>
              </View>
            ) : undefined
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg, gap: spacing.md },
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
  sep: { height: 1, backgroundColor: colors.border, marginLeft: 58 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: spacing.xl },
});
