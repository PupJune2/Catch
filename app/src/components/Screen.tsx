// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { router } from 'expo-router';
import type { ComponentRef, ReactNode, RefObject } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { useI18n } from '@/i18n';
import { colors, spacing } from '@/theme';
import { AppText, IconButton } from './ui';

/**
 * Platz unter dem Inhalt für die schwebende Tab-Leiste: Leiste (~70) + überstehender
 * Melden-Knopf (30) + Luft. Der untere Safe-Area-Abstand (Android-Gestenleiste) kommt dazu.
 */
export const TAB_BAR_SPACE = 124;

/**
 * Standard-Bildschirm: dunkler Hintergrund, Safe-Area oben, scrollbarer Inhalt.
 * `header` wird in den gewölbten Kopfbereich (Bild 1) gesetzt.
 */
export function Screen({
  children,
  header,
  refreshing,
  onRefresh,
  withTabBar = false,
  scroll = true,
  contentStyle,
  footer,
  scrollRef,
  onContentLayout,
}: {
  children: ReactNode;
  /** y-Position des Inhaltsbereichs (unter dem Kopf) innerhalb der ScrollView */
  onContentLayout?: (y: number) => void;
  /** Zugriff auf die ScrollView, z. B. um zu Ergebnissen zu scrollen */
  scrollRef?: RefObject<ComponentRef<typeof ScrollView> | null>;
  header?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  withTabBar?: boolean;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Fixierter Bereich unten (z. B. Haupt-Button) */
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const bottomPad = (withTabBar ? TAB_BAR_SPACE : spacing.xl) + insets.bottom + (footer ? 84 : 0);

  const body = (
    <>
      {header ? <CurvedHeader topInset={insets.top}>{header}</CurvedHeader> : <View style={{ height: insets.top }} />}
      <View style={[styles.content, contentStyle]} onLayout={onContentLayout ? (e) => onContentLayout(e.nativeEvent.layout.y) : undefined}>
        {children}
      </View>
    </>
  );

  return (
    <View style={styles.root}>
      {scroll ? (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingBottom: bottomPad }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.lime} colors={[colors.lime]} />
            ) : undefined
          }>
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingBottom: bottomPad }}>{body}</View>
      )}
      {footer ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) + (withTabBar ? TAB_BAR_SPACE - 20 : 0) }]}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}

/** Heller Kopfbereich mit gewölbter Unterkante (Bild 1). */
export function CurvedHeader({ children, topInset }: { children: ReactNode; topInset: number }) {
  return (
    <View>
      <View style={[styles.header, { paddingTop: topInset + spacing.sm }]}>{children}</View>
      <Svg width="100%" height={34} viewBox="0 0 100 34" preserveAspectRatio="none" style={styles.curve}>
        <Path d="M0 0 H100 V34 Q50 -6 0 34 Z" fill={colors.raised} />
      </Svg>
    </View>
  );
}

/** Kopfzeile für Unterseiten: Zurück, Titel, optionale Aktion. */
export function StackHeader({
  title,
  subtitle,
  right,
  onBack,
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  onBack?: () => void;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.stackHeader}>
      <IconButton
        icon="arrow-left"
        accessibilityLabel={t('common.back')}
        bg="transparent"
        onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
      />
      <View style={{ flex: 1, alignItems: 'center' }}>
        {title ? (
          <AppText variant="h3" numberOfLines={1}>
            {title}
          </AppText>
        ) : null}
        {subtitle ? (
          <AppText variant="small" muted numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View style={{ minWidth: 42, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.raised, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  curve: { marginTop: -1 },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: 'rgba(22,32,58,0.96)',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  stackHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginHorizontal: -spacing.xs, minHeight: 48 },
});
