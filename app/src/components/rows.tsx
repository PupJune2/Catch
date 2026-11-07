// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { Fragment } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Departure, Journey, Report, Tracking } from '@/api/contract';
import { useI18n } from '@/i18n';
import { delayMinutes, formatClock, formatDay, formatDuration, formatTime, relativeTime, sameDayInZone, shortStopName } from '@/lib/format';
import { kindLabel, kindOf, kindsFromBody } from '@/lib/kinds';
import { isRecent, levelOf, maxLevel, reportTitle, segmentText, summaryText, tagsText } from '@/lib/labels';
import { colors, levelStyle, radius, spacing } from '@/theme';
import { KindIcon } from './kinds';
import { StatusCard } from './StatusCard';
import { trackInfo } from '@/lib/track';
import { LineBadge, ModeIcon, StatusDot, TrackTag } from './transit';
import { AppText } from './ui';
import { TrustBadge, trustTag } from './TrustBadge';

// ---------------------------------------------------------------------------
// Abfahrt (Abfahrtstafel / Auswahl der Linie)
// ---------------------------------------------------------------------------

export function DepartureRow({
  dep,
  onPress,
  now = Date.now(),
  showStop = false,
}: {
  dep: Departure;
  onPress?: () => void;
  now?: number;
  showStop?: boolean;
}) {
  const { t } = useI18n();
  const delay = dep.delayMin ?? 0;
  const level = levelOf(dep.summary);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.depRow, pressed && { backgroundColor: colors.surfaceAlt }]}>
      <View style={styles.depTime}>
        <AppText variant="mono" style={dep.cancelled ? styles.strike : undefined}>
          {formatTime(dep.plannedTime)}
        </AppText>
        {dep.cancelled ? (
          <AppText variant="small" color={colors.orange}>
            {t('dep.cancelled')}
          </AppText>
        ) : delay > 0 ? (
          <AppText variant="smallStrong" color={colors.orange}>
            +{delay}
          </AppText>
        ) : dep.realtime ? (
          <AppText variant="smallStrong" color={colors.lime}>
            +0
          </AppText>
        ) : null}
      </View>
      <LineBadge line={dep.line} level={level} kind={dep.summary?.lastKind} />
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {shortStopName(dep.headsign)}
        </AppText>
        <View style={styles.depSub}>
          {/* Gleis / Steig – bei Gleiswechsel orange "Gl. 9 (statt 7)" */}
          <TrackTag mode={dep.line.mode} track={dep.track} plannedTrack={dep.plannedTrack} short />
          <AppText
            variant="small"
            color={level === 'active' ? colors.orange : colors.textMuted}
            numberOfLines={1}
            style={{ flex: 1 }}>
            {showStop ? t('dep.from', { stop: shortStopName(dep.stop.name) }) : ''}
            {dep.line.onDemand ? (
              // Rufbus: "vorher bestellen" ist hier das Wichtigste – Meldungslage nur, wenn gerade etwas los ist
              <AppText variant="smallStrong" color={colors.cyan}>
                {t('onDemand.short')}
                {level === 'active' ? ' · ' : ''}
              </AppText>
            ) : null}
            {dep.line.onDemand && level !== 'active' ? '' : summaryText(dep.summary, now)}
          </AppText>
        </View>
      </View>
      {onPress ? <Feather name="chevron-right" size={18} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Verbindung (Ergebnisliste wie im DB Navigator)
// ---------------------------------------------------------------------------

export function JourneyCard({ journey, onPress, now = Date.now() }: { journey: Journey; onPress: () => void; now?: number }) {
  const { t, tn } = useI18n();
  const transit = journey.legs.filter((l) => !l.walking && l.line);
  const first = journey.legs[0];
  const last = journey.legs[journey.legs.length - 1];
  const depDelay = first ? delayMinutes(first.plannedDeparture, first.departure) : 0;
  const arrDelay = last ? delayMinutes(last.plannedArrival, last.arrival) : 0;
  const level = maxLevel(transit.map((l) => levelOf(l.summary)));
  const activeLeg = transit.find((l) => l.summary?.level === 'active');
  // Wo es losgeht: Gleis/Steig des ersten Fahrzeugs ("ab Steig A")
  const firstTransit = transit[0];
  const startTrack = firstTransit?.line
    ? trackInfo(firstTransit.line.mode, firstTransit.fromTrack, firstTransit.fromPlannedTrack, { context: 'dep' })
    : null;
  const frequentLegs = transit.filter((l) => l.summary?.level === 'frequent');
  // Nicht heute (z. B. nachts schon der erste Zug am nächsten Morgen): Datum deutlich dazuschreiben
  const depIso = first?.plannedDeparture ?? journey.departure;
  const otherDay = !sameDayInZone(depIso, now);

  let statusText = t('journey.allCalm');
  if (activeLeg?.line) {
    const kind = activeLeg.summary?.lastKind;
    statusText = t('journey.checkOn', {
      kind: kind ? kindLabel(kind) : levelStyle.active.label,
      line: activeLeg.line.name,
      ago: relativeTime(activeLeg.summary?.lastReportAt, now),
    });
  } else if (frequentLegs.length) {
    statusText = t('journey.often', { lines: frequentLegs.map((l) => l.line?.name).join(', ') });
  }

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.journey, pressed && { opacity: 0.9 }]}>
      <View style={styles.journeyTop}>
        <View style={{ flex: 1 }}>
          {otherDay ? (
            <View style={styles.dayPill}>
              <Feather name="calendar" size={12} color={colors.textOnLight} />
              <AppText variant="smallStrong" color={colors.textOnLight}>
                {formatDay(depIso)}
              </AppText>
            </View>
          ) : null}
          <View style={styles.timesRow}>
            <AppText variant="h2">{formatTime(depIso)}</AppText>
            {depDelay > 0 ? (
              <AppText variant="smallStrong" color={colors.orange}>
                +{depDelay}
              </AppText>
            ) : null}
            <Feather name="arrow-right" size={16} color={colors.textMuted} />
            <AppText variant="h2">{formatTime(last?.plannedArrival ?? journey.arrival)}</AppText>
            {arrDelay > 0 ? (
              <AppText variant="smallStrong" color={colors.orange}>
                +{arrDelay}
              </AppText>
            ) : null}
          </View>
          <AppText variant="small" muted>
            {formatDuration(journey.durationMin)} ·{' '}
            {journey.transfers === 0 ? t('journey.direct') : tn('journey.transfers', journey.transfers)}
            {startTrack ? (
              <AppText variant="small" color={startTrack.changed ? colors.orange : colors.textMuted}>
                {' · '}
                {startTrack.text}
              </AppText>
            ) : null}
          </AppText>
        </View>
        <Feather name="chevron-right" size={20} color={colors.textMuted} />
      </View>

      <View style={styles.legsRow}>
        {journey.legs.map((leg, i) => (
          <Fragment key={i}>
            {i > 0 ? <Feather name="chevron-right" size={12} color={colors.textFaint} /> : null}
            {leg.walking || !leg.line ? (
              <View style={styles.walk}>
                <ModeIcon mode="WALK" size={15} color={colors.textMuted} />
                <AppText variant="small" muted>
                  {Math.max(1, leg.durationMin)}
                </AppText>
              </View>
            ) : (
              <LineBadge line={leg.line} size="sm" level={journey.offline ? undefined : levelOf(leg.summary)} kind={leg.summary?.lastKind} />
            )}
          </Fragment>
        ))}
      </View>

      {journey.longWalk ? (
        // Nur angeboten, weil sonst stundenlang nichts fährt – deutlich kennzeichnen
        <View style={styles.onDemandRow}>
          <ModeIcon mode="WALK" size={14} color={colors.orange} />
          <AppText variant="smallStrong" color={colors.orange} style={{ flex: 1 }}>
            {t('journey.longWalk', { min: formatDuration(journey.longWalkMin ?? 0) })}
          </AppText>
        </View>
      ) : null}

      {transit.some((l) => l.line?.onDemand) ? (
        <View style={styles.onDemandRow}>
          <Feather name="phone-call" size={13} color={colors.cyan} />
          <AppText variant="smallStrong" color={colors.cyan} style={{ flex: 1 }}>
            {t('onDemand.journeyHint')}
          </AppText>
        </View>
      ) : null}

      {journey.offline ? (
        // Offline auf dem Gerät berechnet: keine Meldungen/Echtzeit – das klar sagen statt "alles ruhig"
        <View style={[styles.statusPill, { backgroundColor: `${colors.cyan}22` }]}>
          <Feather name="wifi-off" size={12} color={colors.cyan} />
          <AppText variant="smallStrong" color={colors.cyan} numberOfLines={1} style={{ flex: 1 }}>
            {t('offline.cardStatus')}
          </AppText>
        </View>
      ) : (
        <View style={[styles.statusPill, { backgroundColor: `${levelStyle[level].color}22` }]}>
          <StatusDot level={level} size={9} style={{ borderWidth: 0 }} />
          <AppText variant="smallStrong" color={levelStyle[level].color} numberOfLines={1} style={{ flex: 1 }}>
            {statusText}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Meldung als Status-Karte
// ---------------------------------------------------------------------------

export function ReportCard({
  report,
  now = Date.now(),
  onPress,
  onLongPress,
  backdrop,
  showLine = true,
}: {
  report: Report;
  now?: number;
  onPress?: () => void;
  /** z. B. "Inhalt melden" */
  onLongPress?: () => void;
  backdrop?: string;
  showLine?: boolean;
}) {
  useI18n(); // neu rendern bei Sprachwechsel
  const recent = isRecent(report.reportedAt, 60, now);
  const votes = report.confirmations + report.denials;
  const tags = tagsText(report.tags);
  const kind = kindOf(report);
  return (
    <StatusCard
      tone={recent ? 'active' : 'frequent'}
      tab={`${kindLabel(kind)} · ${relativeTime(report.reportedAt, now)}`}
      tabIcon={<KindIcon kind={kind} size={15} color={colors.textOnLight} />}
      mode={report.line.mode}
      title={showLine ? reportTitle(report) : segmentText(report)}
      subtitle={showLine ? segmentText(report) + (tags ? ` · ${tags}` : '') : tags || formatClock(report.reportedAt)}
      meta={{
        confirmations: report.confirmations,
        progress: votes > 0 ? report.confirmations / votes : undefined,
        progressLabel: votes > 0 ? `${Math.round((report.confirmations / votes) * 100)}%` : undefined,
      }}
      backdrop={backdrop}
      onPress={onPress}
      onLongPress={onLongPress}
      onMenu={onPress}
      menuIcon="chevron-right">
      {/* Vertrauen des Meldenden: "Vertrauenswürdig" bzw. "Unbestätigt" (nur wenn zutreffend) */}
      {trustTag(report) ? <TrustBadge report={report} onCard style={{ marginLeft: 72 }} /> : null}
    </StatusCard>
  );
}

// ---------------------------------------------------------------------------
// Live-Tracking
// ---------------------------------------------------------------------------

export function trackingStatus(t: Tracking, now = Date.now()): 'aktiv' | 'geplant' | 'abgelaufen' {
  const s = new Date(t.startsAt).getTime();
  const e = new Date(t.endsAt).getTime();
  if (now > e) return 'abgelaufen';
  if (now < s) return 'geplant';
  return 'aktiv';
}

export function TrackingCard({
  tracking,
  now = Date.now(),
  onPress,
  onDelete,
}: {
  tracking: Tracking;
  now?: number;
  onPress?: () => void;
  onDelete?: () => void;
}) {
  const { t, tn } = useI18n();
  const status = trackingStatus(tracking, now);
  const s = tracking.summary;
  const segment =
    tracking.fromStop || tracking.toStop
      ? `${shortStopName(tracking.fromStop?.name)} → ${shortStopName(tracking.toStop?.name)}`
      : tracking.headsign
        ? t('tracking.towards', { stop: shortStopName(tracking.headsign) })
        : t('tracking.wholeLine');
  const tone = status === 'abgelaufen' ? 'neutral' : s?.level === 'active' ? 'active' : 'live';
  const tab =
    status === 'aktiv'
      ? s?.level === 'active'
        ? t('alert.reported')
        : t('tracking.liveActive')
      : status === 'geplant'
        ? t('tracking.starts', { time: formatTime(tracking.startsAt) })
        : t('tracking.expired');
  return (
    <StatusCard
      tone={tone}
      tab={tab}
      mode={tracking.line.mode}
      title={tracking.headsign ? `${tracking.line.name} → ${shortStopName(tracking.headsign)}` : tracking.line.name}
      subtitle={`${segment}\n${t('time.range', { from: formatTime(tracking.startsAt), to: formatTime(tracking.endsAt) })}`}
      meta={{
        text: tracking.alertCount > 0 ? tn('tracking.alerts', tracking.alertCount) : undefined,
        confirmations: undefined,
      }}
      onPress={onPress}
      onMenu={onDelete}
      menuIcon="trash-2">
      {/* Nur bestimmte Arten verfolgt → hier anzeigen (alle = nichts anzeigen) */}
      {tracking.kinds?.length ? (
        <View style={styles.trackedKinds}>
          {kindsFromBody(tracking.kinds).map((k) => (
            <KindIcon key={k} kind={k} size={15} color={status === 'abgelaufen' ? colors.textMuted : colors.text} />
          ))}
          <AppText variant="small" color={status === 'abgelaufen' ? colors.textMuted : 'rgba(255,255,255,0.86)'} numberOfLines={2} style={{ flex: 1 }}>
            {t('tracking.onlyKinds', { kinds: kindsFromBody(tracking.kinds).map(kindLabel).join(', ') })}
          </AppText>
        </View>
      ) : null}
    </StatusCard>
  );
}

const styles = StyleSheet.create({
  onDemandRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs },
  dayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: colors.cyan,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
    marginBottom: 6,
  },
  depRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: radius.md,
  },
  depTime: { width: 54 },
  depSub: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  strike: { textDecorationLine: 'line-through', color: colors.textMuted },
  journey: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  journeyTop: { flexDirection: 'row', alignItems: 'center' },
  timesRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  legsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  walk: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  trackedKinds: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 72 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
