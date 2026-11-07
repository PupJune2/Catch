// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Commute } from '@/api/contract';
import { useI18n } from '@/i18n';
import { commuteState, dayLabel, minutesUntil, scheduleText } from '@/lib/commutes';
import { formatTime, shortStopName } from '@/lib/format';
import { levelOf, maxLevel } from '@/lib/labels';
import { colors, levelStyle, radius, spacing } from '@/theme';
import { LineBadge } from './transit';
import { AppText, Button } from './ui';

const STATE_COLOR = {
  paused: colors.textFaint,
  watching: colors.cyan,
  reminded: colors.lime,
  upcoming: colors.lilac,
  none: colors.textFaint,
} as const;

/**
 * Karte einer Pendelstrecke: Name, Tage + Uhrzeit, Status (beobachtet / pausiert / nächster Termin)
 * und – am Tag der Fahrt – "Los um 07:36" mit erster Fahrt und Meldungslage.
 */
export function CommuteCard({
  commute,
  now = Date.now(),
  onPress,
  onShowJourney,
  loadingJourney,
  compact,
}: {
  commute: Commute;
  now?: number;
  onPress?: () => void;
  onShowJourney?: () => void;
  loadingJourney?: boolean;
  compact?: boolean;
}) {
  const { t, tn } = useI18n();
  const state = commuteState(commute);
  const plan = commute.plan;
  const stateLabel =
    state === 'paused'
      ? t('commute.state.paused')
      : state === 'watching' || state === 'reminded'
        ? t('commute.state.watching')
        : state === 'upcoming' && commute.nextAt
          ? t('commute.state.next', { day: dayLabel(commute.nextAt, now), time: formatTime(commute.nextAt) })
          : t('commute.state.none');

  const transit = plan?.journey.legs.filter((l) => !l.walking && l.line) ?? [];
  // Schlechteste Meldungslage der Abschnitte (gerade gemeldet > häufig > ruhig)
  const level = maxLevel(transit.map((l) => levelOf(l.summary)));
  const leaveIn = plan ? minutesUntil(plan.leaveAt, now) : null;

  return (
    // Karte = Fläche; antippbar ist der obere Teil. "Verbindung ansehen" liegt daneben statt darin –
    // ein Button im Button ist im Web ungültig (<button> in <button>) und verwirrt Screenreader.
    <View style={[styles.card, !commute.active && styles.paused]}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        style={({ pressed }) => [styles.main, pressed && { opacity: 0.88 }]}>
        <View style={styles.head}>
          <View style={[styles.icon, { backgroundColor: commute.active ? colors.lime : colors.surfaceAlt }]}>
            <Feather name="repeat" size={18} color={commute.active ? colors.textOnLight : colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="h3" numberOfLines={1}>
              {commute.name}
            </AppText>
            <AppText variant="small" muted numberOfLines={1}>
              {scheduleText(commute)}
            </AppText>
          </View>
          <View style={[styles.pill, { borderColor: STATE_COLOR[state] }]}>
            {state === 'watching' || state === 'reminded' ? <View style={[styles.dot, { backgroundColor: colors.cyan }]} /> : null}
            <AppText variant="smallStrong" color={STATE_COLOR[state] === colors.textFaint ? colors.textMuted : STATE_COLOR[state]} numberOfLines={1}>
              {stateLabel}
            </AppText>
          </View>
        </View>

        <View style={styles.route}>
          <Feather name="navigation" size={13} color={colors.textMuted} />
          <AppText variant="small" muted numberOfLines={1} style={{ flex: 1 }}>
            {shortStopName(commute.from.name)} → {shortStopName(commute.to.name)}
          </AppText>
        </View>

        {plan ? (
          <View style={styles.plan}>
            <View style={styles.leaveRow}>
              <View style={{ flex: 1 }}>
                <AppText variant="caption" color={colors.textOnLightMuted}>
                  {t('commute.leaveAtLabel')}
                </AppText>
                <AppText variant="title" color={colors.textOnLight} style={styles.leaveTime}>
                  {formatTime(plan.leaveAt)}
                </AppText>
              </View>
              {leaveIn !== null && leaveIn >= 0 && leaveIn <= 120 ? (
                <View style={styles.countdown}>
                  <AppText variant="smallStrong" color={colors.lime}>
                    {leaveIn === 0 ? t('commute.leaveNow') : t('commute.leaveIn', { n: leaveIn })}
                  </AppText>
                </View>
              ) : null}
            </View>
            {plan.firstLine ? (
              <View style={styles.firstLeg}>
                <LineBadge line={plan.firstLine} size="sm" />
                <AppText variant="smallStrong" color={colors.textOnLight} numberOfLines={1} style={{ flex: 1 }}>
                  {t('commute.firstLeg', { time: formatTime(plan.firstDeparture), stop: shortStopName(plan.firstStop?.name) })}
                  {plan.delayMin && plan.delayMin > 0 ? (
                    <AppText variant="smallStrong" color={colors.danger}>{`  +${plan.delayMin}`}</AppText>
                  ) : null}
                </AppText>
              </View>
            ) : (
              <AppText variant="smallStrong" color={colors.textOnLight}>
                {t('commute.walkOnly', { min: plan.journey.durationMin })}
              </AppText>
            )}
            {!compact ? (
              <View style={styles.statusRow}>
                {/* "ruhig" ist selbst lime → auf der lime Fläche dunkel zeigen */}
                <View style={[styles.levelDot, { backgroundColor: level === 'calm' ? colors.textOnLight : levelStyle[level].color }]} />
                <AppText variant="small" color={colors.textOnLightMuted} numberOfLines={1} style={{ flex: 1 }}>
                  {commute.alertCount > 0
                    ? tn('commute.alerts', commute.alertCount)
                    : level === 'active'
                      ? t('commute.status.active')
                      : t('commute.status.calm')}
                  {' · '}
                  {t('commute.arrival', { time: formatTime(plan.journey.arrival) })}
                </AppText>
              </View>
            ) : commute.alertCount > 0 ? (
              <AppText variant="small" color={colors.textOnLightMuted}>
                {tn('commute.alerts', commute.alertCount)}
              </AppText>
            ) : null}
          </View>
        ) : null}
      </Pressable>

      {onShowJourney ? (
        <Button
          title={t('commute.showJourney')}
          icon="git-commit"
          variant="light"
          size="sm"
          full={false}
          loading={loadingJourney}
          onPress={onShowJourney}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, gap: spacing.sm },
  main: { gap: spacing.sm },
  paused: { opacity: 0.75 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  icon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: 150,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  route: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  plan: { backgroundColor: colors.lime, borderRadius: radius.md, padding: spacing.md, gap: 6 },
  leaveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  leaveTime: { fontSize: 30, lineHeight: 34 },
  countdown: { backgroundColor: colors.textOnLight, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  firstLeg: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  levelDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1, borderColor: 'rgba(20,32,58,0.35)' },
});
