// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';

import { useI18n } from '@/i18n';
import { relativeTime, shortStopName } from '@/lib/format';
import { kindOf } from '@/lib/kinds';
import { segmentText, tagsText } from '@/lib/labels';
import { useRealtime } from '@/realtime/RealtimeProvider';
import { colors, radius, shadow, spacing } from '@/theme';
import { GhostLogo } from './GhostLogo';
import { KindBadge } from './kinds';
import { LineBadge } from './transit';
import { AppText, Button } from './ui';

/** Globales Popup für Live-Tracking-Alarme ("Verspätung auf U8"). */
export function AlertOverlay() {
  const { popups, dismissPopup } = useRealtime();
  const { t } = useI18n();
  const popup = popups[0];
  const scale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (!popup) return;
    scale.setValue(0.9);
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6 }).start();
  }, [popup, scale]);

  if (!popup) return null;

  const open = () => {
    dismissPopup();
    if (popup.lineKey) router.push(`/line/${encodeURIComponent(popup.lineKey)}`);
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={dismissPopup}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismissPopup} accessibilityLabel={t('common.close')} />
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          <View style={styles.top}>
            <View style={styles.ghostWrap}>
              <GhostLogo size={34} color={colors.cream} fill={colors.textOnLight} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="caption" color={colors.textOnLight}>
                {t('alert.liveAlarm')}
              </AppText>
              <AppText variant="title" color={colors.textOnLight} style={{ fontSize: 24, lineHeight: 28 }}>
                {popup.title || t('alert.reported')}
              </AppText>
            </View>
            <Pressable onPress={dismissPopup} hitSlop={10} accessibilityLabel={t('common.close')}>
              <Feather name="x" size={22} color={colors.textOnLight} />
            </Pressable>
          </View>

          {popup.line ? (
            <View style={styles.lineRow}>
              <LineBadge line={popup.line} size="lg" showIcon />
              {popup.report?.headsign ? (
                <AppText variant="bodyStrong" color={colors.textOnLight} numberOfLines={1} style={{ flex: 1 }}>
                  → {shortStopName(popup.report.headsign)}
                </AppText>
              ) : null}
            </View>
          ) : null}

          <View style={styles.infoBox}>
            {popup.report ? (
              <>
                <KindBadge kind={kindOf(popup.report)} style={styles.kind} />
                <AppText variant="h3" color={colors.textOnLight}>
                  {segmentText(popup.report)}
                </AppText>
                <AppText variant="small" color={colors.textOnLightMuted}>
                  {[relativeTime(popup.report.reportedAt), tagsText(popup.report.tags)].filter(Boolean).join(' · ')}
                </AppText>
              </>
            ) : (
              <AppText variant="body" color={colors.textOnLight}>
                {popup.message}
              </AppText>
            )}
          </View>

          {popup.onMySegment && !/abschnitt|section|segment/i.test(popup.title) ? (
            <View style={styles.segmentBadge}>
              <Feather name="alert-octagon" size={16} color={colors.orange} />
              <AppText variant="smallStrong" color={colors.cream}>
                {t('alert.onMySegment')}
              </AppText>
            </View>
          ) : null}

          <View style={styles.actions}>
            {popup.lineKey ? (
              <Button title={t('alert.view')} variant="light" onPress={open} style={{ flex: 1, backgroundColor: colors.textOnLight }} />
            ) : null}
            <Button title={t('common.ok')} variant="secondary" onPress={dismissPopup} style={{ flex: 1, borderColor: colors.textOnLight }} />
          </View>
          {popups.length > 1 ? (
            <AppText variant="small" color={colors.textOnLightMuted} center>
              {t('alert.more', { n: popups.length - 1 })}
            </AppText>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.orange,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ghostWrap: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: 'rgba(20,32,58,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  infoBox: { backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: radius.md, padding: spacing.md, gap: 4 },
  kind: { marginBottom: 4, borderWidth: 1.5, borderColor: colors.textOnLight },
  segmentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: colors.textOnLight,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
});
