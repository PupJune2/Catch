// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Screen, StackHeader } from '@/components/Screen';
import { StopPicker } from '@/components/StopPicker';
import { useToast } from '@/components/Toast';
import { LineBadge } from '@/components/transit';
import { AppText, Button, Card, Chip, Notice, SectionHeader } from '@/components/ui';
import { useI18n } from '@/i18n';
import { shortStopName } from '@/lib/format';
import { useNow } from '@/lib/useAsync';
import { colors, radius, spacing } from '@/theme';
import { saveWidgetConfig, useWidgetConfig, widgetLineOf, type WidgetLine } from '@/widget/config';
import { fetchSnapshot, readCachedSnapshot, type WidgetSnapshot } from '@/widget/data';
import type { WidgetView } from '@/widget/DeparturesWidget';
import { pinWidget, updateWidgets, widgetCount, WIDGET_SUPPORTED } from '@/widget/native';
import { PreviewSurface } from '@/widget/PreviewSurface';
import { widgetElement } from '@/widget/render';
import { sampleSnapshot } from '@/widget/sample';

const PREVIEW_H = 172;

/**
 * Einstellungen → Homescreen-Widget (Android): Haltestelle + optional hervorgehobene Linie wählen,
 * Vorschau, "Zum Homescreen hinzufügen". Im Web nur Vorschau + Hinweis auf die Android-App.
 */
export default function WidgetScreen() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const config = useWidgetConfig();
  const now = useNow(60_000);
  const { width: winW } = useWindowDimensions();
  const [picker, setPicker] = useState(false);
  const [snap, setSnap] = useState<{ snapshot: WidgetSnapshot; stale: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [placed, setPlaced] = useState(0);
  const [pinning, setPinning] = useState(false);

  const stopId = config.stop?.id;
  const lineKey = config.line?.key;

  const refreshPlaced = useCallback(() => {
    void widgetCount().then(setPlaced);
  }, []);

  useEffect(() => {
    refreshPlaced();
  }, [refreshPlaced]);

  // Live-Daten für die Vorschau (und für die Linien-Auswahl)
  useEffect(() => {
    if (!config.loaded || !config.stop) {
      setSnap(null);
      setFailed(false);
      return;
    }
    let alive = true;
    setFailed(false);
    fetchSnapshot(config, lang)
      .then((s) => alive && setSnap({ snapshot: s, stale: false }))
      .catch(async () => {
        const cached = await readCachedSnapshot(config);
        if (!alive) return;
        setSnap(cached ? { snapshot: cached, stale: true } : null);
        setFailed(!cached);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.loaded, stopId, lineKey, lang]);

  const sample = !config.stop;
  const view: WidgetView = useMemo(() => {
    if (sample) return { kind: 'data', snapshot: sampleSnapshot(now), stale: false };
    if (snap) return { kind: 'data', snapshot: snap.snapshot, stale: snap.stale };
    if (failed) return { kind: 'error', stopName: config.stop?.name };
    return { kind: 'data', snapshot: { stopId: stopId ?? '', stopName: config.stop?.name ?? '', fetchedAt: new Date(now).toISOString(), departures: [], lineStatus: null }, stale: false, refreshing: true };
  }, [sample, snap, failed, config.stop?.name, stopId, now]);

  const previewW = Math.min(360, Math.max(260, winW - 2 * spacing.lg - 2 * spacing.md));
  const element = useMemo(
    () => widgetElement(view, config, lang, { width: previewW, height: PREVIEW_H }, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, stopId, lineKey, lang, previewW, now],
  );

  // Linien an dieser Haltestelle (aus den Abfahrten) + die schon gewählte
  const lines: WidgetLine[] = useMemo(() => {
    const map = new Map<string, WidgetLine>();
    if (config.line) map.set(config.line.key, config.line);
    for (const d of snap?.snapshot.departures ?? []) if (!map.has(d.line.key)) map.set(d.line.key, d.line);
    return [...map.values()].slice(0, 14);
  }, [snap, config.line]);

  const pickStop = async (s: { id: string; name: string; modes?: WidgetLine['mode'][] }) => {
    await saveWidgetConfig({ stop: { id: s.id, name: s.name, modes: s.modes } });
    void updateWidgets();
  };

  const pickLine = async (line: WidgetLine | null) => {
    await saveWidgetConfig({ line: line ? widgetLineOf(line) : null });
    void updateWidgets();
  };

  const addToHome = async () => {
    setPinning(true);
    try {
      const ok = await pinWidget();
      if (!ok) toast(t('widget.pinFailed'), 'info');
    } finally {
      setPinning(false);
      setTimeout(refreshPlaced, 4000);
    }
  };

  return (
    <Screen>
      <StackHeader onBack={() => (router.canGoBack() ? router.back() : router.replace('/profile'))} />

      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Feather name="layout" size={24} color={colors.textOnLight} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="title" accessibilityRole="header">
            {t('widget.title')}
          </AppText>
          <AppText variant="body" muted>
            {t('widget.intro')}
          </AppText>
        </View>
      </View>

      <View>
        <SectionHeader title={t('widget.preview')} />
        <Card color={colors.surfaceDeep} style={styles.previewCard}>
          <PreviewSurface element={element} width={previewW} height={PREVIEW_H} />
          {sample ? (
            <View style={styles.sampleTag}>
              <AppText variant="caption" color={colors.textOnLight}>
                {t('widget.sample')}
              </AppText>
            </View>
          ) : null}
        </Card>
      </View>

      {!WIDGET_SUPPORTED ? <Notice icon="smartphone" color={colors.cyan} text={t('widget.onlyAndroid')} /> : null}

      <View>
        <SectionHeader title={t('widget.stop')} />
        <Card style={styles.row}>
          <View style={styles.rowIcon}>
            <Feather name="map-pin" size={18} color={colors.lime} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong" numberOfLines={2}>
              {config.stop ? shortStopName(config.stop.name) : t('widget.noStop')}
            </AppText>
            <AppText variant="small" muted>
              {t('widget.stopText')}
            </AppText>
          </View>
          <Button
            title={config.stop ? t('widget.changeStop') : t('widget.chooseStop')}
            size="sm"
            variant={config.stop ? 'secondary' : 'primary'}
            full={false}
            onPress={() => setPicker(true)}
          />
        </Card>
      </View>

      <View>
        <SectionHeader title={t('widget.line')} />
        <Card style={{ gap: spacing.md }}>
          <AppText variant="small" muted>
            {config.stop ? t('widget.lineText') : t('widget.lineNeedsStop')}
          </AppText>
          {config.stop ? (
            <View style={styles.lines}>
              <Chip label={t('widget.lineNone')} selected={!config.line} onPress={() => void pickLine(null)} />
              {lines.map((l) => {
                const on = config.line?.key === l.key;
                return (
                  <Pressable
                    key={l.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={l.name}
                    onPress={() => void pickLine(on ? null : l)}
                    style={({ pressed }) => [styles.lineChip, on && styles.lineChipOn, pressed && { opacity: 0.8 }]}>
                    <LineBadge line={l} size="sm" style={{ alignSelf: 'center' }} />
                    {on ? <Feather name="check" size={14} color={colors.textOnLight} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </Card>
      </View>

      {WIDGET_SUPPORTED ? (
        <View style={{ gap: spacing.md }}>
          {placed > 0 ? (
            <>
              <Notice icon="check-circle" color={colors.lime} text={t('widget.placed')} />
              <Button title={t('widget.refresh')} icon="refresh-cw" variant="secondary" onPress={() => void updateWidgets()} />
            </>
          ) : (
            <Button title={t('widget.add')} icon="plus-square" loading={pinning} onPress={() => void addToHome()} />
          )}
          <Notice icon="info" text={t('widget.howTo')} />
        </View>
      ) : (
        <Notice icon="info" text={t('widget.howTo')} />
      )}

      <Notice icon="refresh-cw" text={t('widget.updates')} />

      <StopPicker
        visible={picker}
        title={t('widget.chooseStop')}
        onClose={() => setPicker(false)}
        onSelect={(s) => void pickStop(s)}
      />
    </Screen>
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
  previewCard: { alignItems: 'center', paddingVertical: spacing.lg, paddingHorizontal: spacing.md },
  sampleTag: {
    position: 'absolute',
    top: 8,
    right: 10,
    backgroundColor: colors.lilac,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lines: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
  lineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  lineChipOn: { backgroundColor: colors.lime, borderColor: colors.lime },
});
