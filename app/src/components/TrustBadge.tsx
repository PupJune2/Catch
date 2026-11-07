// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Me, Report } from '@/api/contract';
import { useI18n, type TKey } from '@/i18n';
import { colors, radius } from '@/theme';
import { AppText, Notice } from './ui';

/**
 * Vertrauen des Meldenden (nur die Stufe, nie die Person):
 *  - Stufe ≥ 2 → "Vertrauenswürdig"
 *  - Stufe 0 und noch keine Bestätigung → "Unbestätigt"
 *  - sonst nichts
 */
export function trustTag(report: Pick<Report, 'reporterTrust' | 'confirmations'>): 'trusted' | 'unconfirmed' | null {
  if (report.reporterTrust === undefined || report.reporterTrust === null) return null;
  if (report.reporterTrust >= 2) return 'trusted';
  if (report.reporterTrust === 0 && report.confirmations === 0) return 'unconfirmed';
  return null;
}

/** Kleines Abzeichen; `onCard` = auf farbiger Status-Karte (helle Schrift). */
export function TrustBadge({
  report,
  onCard = false,
  style,
}: {
  report: Pick<Report, 'reporterTrust' | 'confirmations'>;
  onCard?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useI18n();
  const tag = trustTag(report);
  if (!tag) return null;
  const trusted = tag === 'trusted';
  // Auf den farbigen Karten (Bus magenta, Tram rot …) als gefülltes Lime-Abzeichen, sonst als Umriss
  const filled = trusted && onCard;
  const color = filled ? colors.textOnLight : trusted ? colors.lime : onCard ? 'rgba(255,255,255,0.86)' : colors.textMuted;
  const border = trusted ? (filled ? colors.lime : `${colors.lime}66`) : onCard ? 'rgba(255,255,255,0.35)' : colors.borderStrong;
  return (
    <View
      accessible
      accessibilityLabel={t(trusted ? 'trust.trustedA11y' : 'trust.unconfirmedA11y')}
      style={[styles.badge, { borderColor: border }, filled && { backgroundColor: colors.lime }, style]}>
      <Feather name={trusted ? 'shield' : 'help-circle'} size={12} color={color} />
      <AppText variant="smallStrong" color={color} numberOfLines={1}>
        {t(trusted ? 'trust.trusted' : 'trust.unconfirmed')}
      </AppText>
    </View>
  );
}

/**
 * Profil: was die eigene Vertrauensstufe bewirkt – und ob die Moderation gerade etwas einschränkt
 * (gedrosseltes Melden bzw. Alarme erst nach Bestätigung).
 */
export function TrustStatus({ me }: { me: Me | null | undefined }) {
  const { t, locale } = useI18n();
  if (!me) return null;
  const level = Math.max(0, Math.min(3, me.trustLevel ?? 0));
  const until = me.restrictedUntil
    ? new Date(me.restrictedUntil).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  return (
    <View style={{ gap: 6 }}>
      <Notice icon="shield" text={t(`trust.hint.${level}` as TKey)} />
      {until ? (
        <Notice icon="alert-triangle" color={colors.orange} text={t('trust.restricted', { date: until })} />
      ) : me.alertsNeedConfirmation ? (
        <Notice icon="alert-circle" color={colors.orange} text={t('trust.held')} />
      ) : null}
    </View>
  );
}

/**
 * Melden ist automatisch eingeschränkt (Server-Fehler "throttled"): Meldung des Servers plus
 * Weg zum Feedback, falls die Person das für einen Fehler hält.
 */
export function ThrottledNotice({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.notice} accessibilityRole="alert">
      <View style={styles.noticeHead}>
        <Feather name="shield" size={18} color={colors.orange} />
        <AppText variant="bodyStrong" style={{ flex: 1 }}>
          {t('trust.throttledTitle')}
        </AppText>
      </View>
      <AppText variant="small" muted>
        {message}
      </AppText>
      <Pressable onPress={() => router.push('/feedback')} hitSlop={8} accessibilityRole="link">
        <AppText variant="smallStrong" color={colors.lime}>
          {t('trust.contact')} →
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    gap: 8,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(255,122,26,0.4)',
    backgroundColor: 'rgba(255,122,26,0.08)',
    padding: 16,
  },
  noticeHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});
