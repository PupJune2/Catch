// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import type { OfflineIndexEntry, OfflineRegionsResponse } from '@/api/contract';
import { Screen, StackHeader } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { AppText, Button, Card, ErrorBox, Notice, SectionHeader, Skeleton, Toggle } from '@/components/ui';
import { useI18n } from '@/i18n';
import { confirm } from '@/lib/confirm';
import { formatDayMonth, formatTime } from '@/lib/format';
import { useNow } from '@/lib/useAsync';
import {
  cachedRegionIndex,
  deleteRegion,
  downloadRegion,
  fetchRegionIndex,
  updateAvailable,
  useDownloads,
  UPDATE_WITHIN_DAYS,
  type DownloadState,
} from '@/offline/downloads';
import { runAutoUpdate, setAutoUpdateEnabled, useAutoUpdateState } from '@/offline/autoUpdate';
import { syncBackgroundUpdateTask } from '@/offline/backgroundTask';
import { forgetPrepared } from '@/offline/engine';
import { isNetworkError, knownOffline } from '@/offline/network';
import { formatBytes, regionDaysLeft, storageUsed, useInstalledRegions, type InstalledRegion } from '@/offline/storage';
import { colors, radius, spacing } from '@/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];
type IndexState = 'loading' | 'ok' | 'offline' | 'error';

/** 11404 → "11.404" / "11,404" */
function formatCount(n: number, locale: string): string {
  try {
    return n.toLocaleString(locale);
  } catch {
    return String(n);
  }
}

/** "2026-11-20" → "20.11." / "20/11" */
function dayLabel(ymd: string): string {
  return formatDayMonth(`${ymd}T12:00:00Z`);
}

interface IndexResult {
  state: IndexState;
  index?: OfflineRegionsResponse;
  error?: string;
}

/** Städte-Liste vom Server – oder "offline" (dann zeigt der Screen nur die installierten Städte). */
async function loadIndexResult(): Promise<IndexResult> {
  // Ohne Netz nicht die (evtl. vom Browser gecachte) Liste zeigen
  if (knownOffline()) return { state: 'offline' };
  try {
    return { state: 'ok', index: await fetchRegionIndex() };
  } catch (e) {
    return isNetworkError(e) ? { state: 'offline' } : { state: 'error', error: errorMessage(e) };
  }
}

/**
 * Einstellungen → Offline-Fahrpläne: Städte herunterladen, aktualisieren, löschen.
 * Ohne Internet: nur die installierten Städte (aus den Metadaten auf dem Gerät).
 */
export default function OfflineScreen() {
  const { t, tn, locale } = useI18n();
  const toast = useToast();
  const now = useNow(60_000);
  const stopsText = (n: number) => tn('offline.stops', n, { count: formatCount(n, locale) });
  const { loaded, installed } = useInstalledRegions();
  const downloads = useDownloads();
  const [index, setIndex] = useState<OfflineRegionsResponse | null>(() => cachedRegionIndex());
  const [indexState, setIndexState] = useState<IndexState>(() => (cachedRegionIndex() ? 'ok' : 'loading'));
  const [indexError, setIndexError] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);

  const applyIndex = useCallback((r: IndexResult) => {
    if (r.index) setIndex(r.index);
    setIndexState(r.state);
    setIndexError(r.error ?? null);
  }, []);

  const loadIndex = useCallback(() => loadIndexResult().then(applyIndex), [applyIndex]);

  useEffect(() => {
    let alive = true;
    void loadIndexResult().then((r) => {
      if (alive) applyIndex(r);
    });
    return () => {
      alive = false;
    };
  }, [applyIndex]);

  const remote = new Map((index?.regions ?? []).map((r) => [r.id, r]));
  const online = indexState === 'ok';
  const updates = online ? installed.filter((r) => updateAvailable(r, remote.get(r.id), now)) : [];
  const available = online ? (index?.regions ?? []).filter((r) => !installed.some((i) => i.id === r.id)) : [];
  const attribution = index?.attribution || installed.find((r) => r.attribution)?.attribution || '';
  const used = storageUsed(installed);

  const download = async (entry: OfflineIndexEntry, isUpdate: boolean) => {
    try {
      const meta = await downloadRegion(entry, index?.attribution);
      // Altes Paket nicht im Speicher behalten
      forgetPrepared(entry.id);
      toast(t(isUpdate ? 'offline.updated' : 'offline.downloaded', { name: meta.name }), 'success');
      return true;
    } catch (e) {
      toast(errorMessage(e), 'error');
      // Ohne Netz: Liste neu prüfen, damit die Ansicht in den Offline-Modus wechselt
      if (isNetworkError(e)) void loadIndex();
      return false;
    }
  };

  const updateAll = async () => {
    setUpdatingAll(true);
    try {
      // Nacheinander – schont Speicher und das Download-Limit
      for (const r of updates) {
        const entry = remote.get(r.id);
        if (entry && !(await download(entry, true))) break;
      }
    } finally {
      setUpdatingAll(false);
    }
  };

  const remove = async (r: InstalledRegion) => {
    const ok = await confirm(t('offline.deleteTitle', { name: r.name }), t('offline.deleteText'), t('offline.delete'), true);
    if (!ok) return;
    try {
      await deleteRegion(r.id);
      forgetPrepared(r.id);
      toast(t('offline.deleted', { name: r.name }), 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <Screen refreshing={false} onRefresh={() => void loadIndex()}>
      <StackHeader onBack={() => (router.canGoBack() ? router.back() : router.replace('/profile'))} />

      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Feather name="download-cloud" size={24} color={colors.textOnLight} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="title" accessibilityRole="header">
            {t('offline.title')}
          </AppText>
          <AppText variant="body" muted>
            {t('offline.intro')}
          </AppText>
        </View>
      </View>

      <Card style={{ gap: spacing.md }}>
        <Notice icon="clock" text={t('offline.noLive')} />
        <Notice icon="calendar" text={t('offline.validity')} />
        <Notice icon="lock" text={t('offline.private')} />
      </Card>

      {indexState === 'offline' ? (
        <View style={styles.offlineBox}>
          <Feather name="wifi-off" size={18} color={colors.cyan} />
          <AppText variant="small" style={{ flex: 1 }}>
            {t('offline.youreOffline')}
          </AppText>
          <Pressable onPress={() => void loadIndex()} hitSlop={8}>
            <AppText variant="smallStrong" color={colors.lime}>
              {t('common.retry')}
            </AppText>
          </Pressable>
        </View>
      ) : null}
      {indexState === 'error' && indexError ? <ErrorBox message={indexError} onRetry={() => void loadIndex()} /> : null}
      {online && index && !index.available ? <Notice icon="info" text={t('offline.notAvailable')} /> : null}

      {/* Auf dem Gerät */}
      <View>
        <SectionHeader title={t('offline.installed')} />
        {!loaded ? (
          <Skeleton height={72} style={{ borderRadius: radius.card }} />
        ) : installed.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Feather name="map" size={20} color={colors.textMuted} />
            <AppText variant="small" muted style={{ flex: 1 }}>
              {online || indexState === 'loading' ? t('offline.noneInstalled') : t('offline.noneInstalledOffline')}
            </AppText>
          </Card>
        ) : (
          <Card style={styles.list}>
            {installed.map((r, i) => {
              const entry = remote.get(r.id);
              const left = regionDaysLeft(r, now);
              const canUpdate = online && updateAvailable(r, entry, now);
              return (
                <RegionRow
                  key={r.id}
                  first={i === 0}
                  icon={left < 0 ? 'alert-triangle' : 'check-circle'}
                  iconColor={left < 0 ? colors.orange : colors.lime}
                  title={r.name}
                  lines={[
                    left < 0
                      ? { text: t('offline.expiredOn', { date: dayLabel(r.validUntil) }), color: colors.orange }
                      : left <= UPDATE_WITHIN_DAYS
                        ? { text: left === 0 ? t('offline.expiresToday') : tn('offline.expiresIn', left), color: colors.lilac }
                        : { text: t('offline.validUntil', { date: dayLabel(r.validUntil) }) },
                    { text: `${formatBytes(r.rawBytes)} · ${stopsText(r.stops)}` },
                  ]}
                  download={downloads[r.id]}
                  below={
                    canUpdate && entry ? (
                      <Button
                        title={t('offline.updateSize', { size: formatBytes(entry.sizeBytes) })}
                        icon="refresh-cw"
                        size="sm"
                        full={false}
                        disabled={updatingAll}
                        onPress={() => void download(entry, true)}
                        style={{ marginTop: 8 }}
                      />
                    ) : null
                  }
                  trailing={
                    <RoundButton icon="trash-2" label={t('offline.deleteA11y', { name: r.name })} onPress={() => void remove(r)} />
                  }
                />
              );
            })}
          </Card>
        )}
        {installed.length > 0 ? (
          <AppText variant="small" muted style={styles.storage}>
            {t('offline.storageUsed', { size: formatBytes(used), cities: tn('offline.cities', installed.length) })}
          </AppText>
        ) : null}
        {updates.length > 0 ? (
          <Button
            title={t('offline.updateAll', { n: updates.length })}
            icon="refresh-cw"
            variant="light"
            loading={updatingAll}
            onPress={() => void updateAll()}
            style={{ marginTop: spacing.sm }}
          />
        ) : null}
      </View>

      <AutoUpdateCard />

      {/* Weitere Städte vom Server */}
      {indexState === 'loading' && !index ? (
        <View>
          <SectionHeader title={t('offline.available')} />
          <Skeleton height={220} style={{ borderRadius: radius.card }} />
        </View>
      ) : available.length > 0 ? (
        <View>
          <SectionHeader title={t('offline.available')} />
          <Card style={styles.list}>
            {available.map((r, i) => (
              <RegionRow
                key={r.id}
                first={i === 0}
                icon="map-pin"
                iconColor={colors.textMuted}
                title={r.name}
                lines={[
                  { text: `${formatBytes(r.sizeBytes)} · ${stopsText(r.stops)}` },
                  { text: t('offline.validUntil', { date: dayLabel(r.validUntil) }) },
                ]}
                download={downloads[r.id]}
                trailing={
                  <RoundButton
                    icon="download"
                    primary
                    label={t('offline.downloadA11y', { name: r.name, size: formatBytes(r.sizeBytes) })}
                    onPress={() => void download(r, false)}
                  />
                }
              />
            ))}
          </Card>
        </View>
      ) : null}

      <Notice icon="refresh-cw" text={t('offline.weekly')} />

      {attribution ? (
        <View style={styles.attribution}>
          <Feather name="info" size={14} color={colors.textFaint} style={{ marginTop: 2 }} />
          <AppText variant="small" color={colors.textFaint} style={{ flex: 1 }}>
            {attribution}
          </AppText>
        </View>
      ) : null}
    </Screen>
  );
}

/** "heute, 03:12" / "gestern, 03:12" / "05.11., 03:12" */
function whenText(iso: string, now: number, t: ReturnType<typeof useI18n>['t']): string {
  const time = formatTime(iso);
  const day = formatDayMonth(iso);
  if (day === formatDayMonth(new Date(now).toISOString())) return t('offline.auto.today', { time });
  if (day === formatDayMonth(new Date(now - 86_400_000).toISOString())) return t('offline.auto.yesterday', { time });
  return t('offline.auto.onDay', { date: day, time });
}

/** Schalter "Automatisch im WLAN aktualisieren" + letzter automatischer Lauf. */
function AutoUpdateCard() {
  const { t } = useI18n();
  const now = useNow(60_000);
  const auto = useAutoUpdateState();
  const web = Platform.OS === 'web';

  const toggle = async (on: boolean) => {
    await setAutoUpdateEnabled(on);
    await syncBackgroundUpdateTask();
    if (on) void runAutoUpdate('foreground');
  };

  let status: string;
  if (!auto.enabled) status = t('offline.auto.off');
  else if (auto.lastUpdateAt) {
    const names = auto.lastUpdated.length && auto.lastUpdated.length <= 2 ? ` (${auto.lastUpdated.join(', ')})` : '';
    status = `${t('offline.auto.last', { when: whenText(auto.lastUpdateAt, now, t) })}${names}`;
  } else if (auto.lastCheckAt) status = t('offline.auto.checked', { when: whenText(auto.lastCheckAt, now, t) });
  else status = t('offline.auto.never');
  const failedLast = auto.enabled && !!auto.lastErrorAt && (!auto.lastCheckAt || auto.lastErrorAt >= auto.lastCheckAt);

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={styles.autoRow}>
        <View style={styles.rowIcon}>
          <Feather name="wifi" size={18} color={colors.lime} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong">{t(web ? 'offline.auto.titleWeb' : 'offline.auto.title')}</AppText>
          <AppText variant="small" muted>
            {t(web ? 'offline.auto.textWeb' : 'offline.auto.text')}
          </AppText>
        </View>
        <Toggle
          value={auto.enabled}
          onChange={(v) => void toggle(v)}
          accessibilityLabel={t(web ? 'offline.auto.titleWeb' : 'offline.auto.title')}
        />
      </View>
      <View style={styles.autoStatus}>
        <Feather name={auto.enabled ? 'clock' : 'pause-circle'} size={14} color={colors.textFaint} style={{ marginTop: 2 }} />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="small" color={colors.textMuted}>
            {status}
          </AppText>
          {failedLast ? (
            <AppText variant="small" color={colors.orange}>
              {t('offline.auto.failed')}
            </AppText>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

function RoundButton({ icon, label, onPress, primary }: { icon: FeatherName; label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.round, primary && styles.roundPrimary, pressed && { opacity: 0.7 }]}>
      <Feather name={icon} size={18} color={primary ? colors.textOnLight : colors.textMuted} />
    </Pressable>
  );
}

function RegionRow({
  first,
  icon,
  iconColor,
  title,
  lines,
  download,
  below,
  trailing,
}: {
  first: boolean;
  icon: FeatherName;
  iconColor: string;
  title: string;
  lines: { text: string; color?: string }[];
  download?: DownloadState;
  /** unter dem Text (z. B. "Aktualisieren") */
  below?: ReactNode;
  /** rechts (Laden/Löschen) – während des Downloads ersetzt durch den Fortschritt */
  trailing?: ReactNode;
}) {
  const { t } = useI18n();
  const pct = download?.progress != null ? Math.round(download.progress * 100) : null;
  return (
    <View style={[styles.row, !first && styles.rowBorder]}>
      <View style={styles.rowMain}>
        <View style={styles.rowIcon}>
          <Feather name={icon} size={18} color={iconColor} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <AppText variant="bodyStrong" numberOfLines={2}>
            {title}
          </AppText>
          {lines.map((l, i) => (
            <AppText key={i} variant="small" color={l.color ?? colors.textMuted} numberOfLines={2}>
              {l.text}
            </AppText>
          ))}
          {!download && below ? <View style={{ flexDirection: 'row' }}>{below}</View> : null}
        </View>
        {download ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.lime} size="small" />
            <AppText variant="smallStrong" color={colors.lime}>
              {download.phase === 'save' ? t('offline.saving') : pct != null ? `${pct} %` : t('offline.downloading')}
            </AppText>
          </View>
        ) : (
          trailing
        )}
      </View>
      {download ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(4, pct ?? 15)}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  offlineBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(46,200,230,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(46,200,230,0.35)',
  },
  emptyCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  list: { paddingVertical: 4, paddingHorizontal: spacing.md },
  row: { paddingVertical: 12, gap: 10 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  roundPrimary: { backgroundColor: colors.lime, borderColor: colors.lime },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceDeep, overflow: 'hidden', marginLeft: 52 },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.lime },
  storage: { marginTop: spacing.sm, paddingHorizontal: 4 },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  autoStatus: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  attribution: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4 },
});
