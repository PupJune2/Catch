// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { ActivityLevel, Mode } from '@/api/contract';
import { colors, levelStyle, modeSurface, radius } from '@/theme';
import { DiamondIcon } from './transit';
import { AppText } from './ui';
import { t } from '@/i18n';

export type CardTone = ActivityLevel | 'live' | 'neutral';

export const toneColor: Record<CardTone, string> = {
  calm: colors.lime,
  frequent: colors.lilac,
  active: colors.orange,
  live: colors.cyan,
  neutral: colors.surfaceAlt,
};

/** Reiter-Text je Ton (Funktion, damit er der aktuellen Sprache folgt). */
function toneLabel(tone: CardTone): string {
  if (tone === 'live') return t('common.liveTracking');
  if (tone === 'neutral') return '';
  return levelStyle[tone].label;
}

export interface StatusCardProps {
  tone: CardTone;
  /** Text im Reiter oben links (Standard: Status-Label) */
  tab?: string;
  /** Kleines Icon vor dem Reiter-Text (z. B. Art des Hinweises) */
  tabIcon?: ReactNode;
  title: string;
  subtitle?: string;
  mode: Mode | 'WALK';
  /** Kleine Leiste rechts neben dem Reiter: Bestätigungen + Fortschritt */
  meta?: { confirmations?: number; progress?: number; progressLabel?: string; text?: string };
  /** Hintergrundfarbe hinter der Karte (für die "Innen-Rundung" am Reiter) */
  backdrop?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  onMenu?: () => void;
  menuIcon?: 'more-vertical' | 'x' | 'trash-2' | 'chevron-right' | 'edit-2';
  right?: ReactNode;
  children?: ReactNode;
}

/**
 * Die Karte aus Bild 1: Reiter oben links, Raute mit Verkehrsmittel, Titel.
 * Der Kartenkörper trägt die Farbe des Verkehrsmittels (Bus lila, U-Bahn blau …);
 * der Status (ruhig/häufig/gerade gemeldet/live) steckt als farbiges Label im Reiter.
 * Ton "neutral" (z. B. abgelaufen) bleibt grau.
 */
export function StatusCard({
  tone,
  tab,
  tabIcon,
  title,
  subtitle,
  mode,
  meta,
  backdrop = colors.bg,
  onPress,
  onLongPress,
  onMenu,
  menuIcon = 'more-vertical',
  right,
  children,
}: StatusCardProps) {
  const color = toneColor[tone];
  const tinted = tone !== 'neutral' && mode !== 'WALK';
  const body = tinted ? modeSurface[mode as Mode] : color;
  // Auf Fahrzeugfarbe weiße Schrift; ohne Fahrzeugfarbe wie bisher (dunkel auf Status-Farbe, hell auf grau)
  const onStatus = !tinted && tone !== 'neutral';
  const fg = onStatus ? colors.textOnLight : colors.text;
  const fgMuted = tinted ? 'rgba(255,255,255,0.86)' : onStatus ? colors.textOnLightMuted : colors.textMuted;
  const tabText = tab ?? toneLabel(tone);
  const progress = meta?.progress !== undefined ? Math.max(0, Math.min(1, meta.progress)) : undefined;

  const content = (
    <View>
      <View style={styles.tabRow}>
        <View style={[styles.tab, tinted && styles.tabTinted, { backgroundColor: body }]}>
          {tinted ? (
            // Status-Label (lime/lila/orange/cyan) sitzt im Reiter in Fahrzeugfarbe
            <View style={[styles.statusPill, { backgroundColor: color }]}>
              {tabIcon}
              <AppText variant="smallStrong" color={colors.textOnLight} numberOfLines={1} style={styles.tabLabel}>
                {tabText}
              </AppText>
            </View>
          ) : (
            <View style={styles.plainTab}>
              {tabIcon}
              <AppText variant="smallStrong" color={fg} numberOfLines={1} style={styles.tabLabel}>
                {tabText}
              </AppText>
            </View>
          )}
        </View>
        {/* Innen-Rundung zwischen Reiter und Kartenkörper (gleiche Farbe wie der Körper) */}
        <View style={[styles.notch, { backgroundColor: body }]}>
          <View style={[styles.notchInner, { backgroundColor: backdrop }]} />
        </View>
        <View style={styles.meta}>
          {meta?.confirmations !== undefined && meta.confirmations > 0 ? (
            <View style={styles.confirm}>
              <View style={[styles.confirmDot, { backgroundColor: color }]}>
                <Feather name="thumbs-up" size={11} color={colors.textOnLight} />
              </View>
              <AppText variant="smallStrong" color={colors.text}>
                +{meta.confirmations}
              </AppText>
            </View>
          ) : null}
          {meta?.text ? (
            <AppText variant="small" muted numberOfLines={1}>
              {meta.text}
            </AppText>
          ) : null}
          {progress !== undefined ? (
            <View style={styles.progressWrap}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: color }]} />
              </View>
              <AppText variant="smallStrong" color={color} style={styles.progressLabel}>
                {meta?.progressLabel ?? `${Math.round(progress * 100)}%`}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>
      <View style={[styles.body, { backgroundColor: body }, children ? styles.bodyWithFooter : null]}>
        {tinted ? (
          <DiamondIcon mode={mode} bg={colors.textOnLight} iconColor={colors.text} plain />
        ) : (
          <DiamondIcon mode={mode} bg={colors.bg} iconColor={color} />
        )}
        <View style={styles.texts}>
          <AppText variant="h3" color={fg} numberOfLines={2}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="small" color={fgMuted} numberOfLines={3} style={{ marginTop: 2 }}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {right}
        {onMenu ? (
          <Pressable onPress={onMenu} hitSlop={12} accessibilityLabel={t('common.options')} style={styles.menu}>
            <Feather name={menuIcon} size={20} color={fg} />
          </Pressable>
        ) : null}
      </View>
      {children ? <View style={[styles.footer, { backgroundColor: body }]}>{children}</View> : null}
    </View>
  );

  if (!onPress && !onLongPress) return content;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={450}
      style={({ pressed }) => [pressed && { opacity: 0.9, transform: [{ scale: 0.992 }] }]}>
      {content}
    </Pressable>
  );
}

const TAB_R = 18;

const styles = StyleSheet.create({
  tabRow: { flexDirection: 'row', alignItems: 'flex-end' },
  tab: {
    paddingHorizontal: 18,
    paddingTop: 9,
    paddingBottom: 7,
    borderTopLeftRadius: TAB_R,
    borderTopRightRadius: TAB_R,
    maxWidth: '62%',
  },
  tabTinted: { paddingHorizontal: 7, paddingTop: 7, paddingBottom: 3 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  plainTab: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tabLabel: { flexShrink: 1 },
  notch: { width: TAB_R, height: TAB_R, alignSelf: 'flex-end' },
  notchInner: { flex: 1, borderBottomLeftRadius: TAB_R },
  meta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    paddingBottom: 9,
    paddingLeft: 4,
  },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  confirmDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressTrack: { width: 56, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressLabel: { minWidth: 34, textAlign: 'right' },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingLeft: 14,
    paddingRight: 16,
    borderRadius: radius.card,
    borderTopLeftRadius: 0,
  },
  texts: { flex: 1 },
  menu: { paddingLeft: 4, paddingVertical: 4 },
  bodyWithFooter: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: 10 },
  footer: {
    paddingHorizontal: 18,
    paddingBottom: 16,
    borderBottomLeftRadius: radius.card,
    borderBottomRightRadius: radius.card,
  },
});
