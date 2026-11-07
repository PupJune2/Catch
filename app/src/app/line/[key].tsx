// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import type { Line, LineStats, Report, ReportKind } from '@/api/contract';
import { api } from '@/api/endpoints';
import { HourChart, MiniBar, StatStrip, WeekdayChart } from '@/components/charts';
import { EmptyState } from '@/components/EmptyState';
import { FlagSheet } from '@/components/FlagSheet';
import { KindBadge, KindFilterChips } from '@/components/kinds';
import { GhostLogo } from '@/components/GhostLogo';
import { Screen, StackHeader } from '@/components/Screen';
import { TimelineItem } from '@/components/Timeline';
import { useToast } from '@/components/Toast';
import { TrackingSheet } from '@/components/TrackingSheet';
import { TrustBadge } from '@/components/TrustBadge';
import { LineBadge } from '@/components/transit';
import { AppText, Button, Card, Chip, ChipRow, ErrorBox, Notice, SectionHeader, Skeleton, Toggle } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { formatClock, formatDayMonth, formatTime, relativeTime, relativeTimeShort, shortStopName } from '@/lib/format';
import { kindLabel, kindOf } from '@/lib/kinds';
import { segmentText, tagsText } from '@/lib/labels';
import { parseLineParam, type LineRouteParams } from '@/lib/navigation';
import { requireLogin } from '@/lib/requireLogin';
import { useAsync, useNow } from '@/lib/useAsync';
import { useWatchLines } from '@/realtime/RealtimeProvider';
import { colors, levelStyle, modeLabel, radius, spacing } from '@/theme';

const DAY_OPTIONS = [7, 30, 90];

function currentBerlinHour(): number {
  try {
    return Number(new Intl.DateTimeFormat('de-DE', { hour: '2-digit', hour12: false, timeZone: 'Europe/Berlin' }).format(new Date()));
  } catch {
    return new Date().getHours();
  }
}

export default function LineScreen() {
  const params = useLocalSearchParams<Partial<Record<keyof LineRouteParams, string>>>();
  const key = String(params.key ?? '');
  const paramLine = parseLineParam(params.line);
  const { user } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const now = useNow(30000);

  const [days, setDays] = useState(30);
  const [showAll, setShowAll] = useState(false);
  const [sheet, setSheet] = useState(false);
  /** Filter nach Art (null = alle) – gilt für Auswertung und Liste */
  const [kind, setKind] = useState<ReportKind | null>(null);
  const [flagging, setFlagging] = useState<Report | null>(null);

  const stats = useAsync(() => api.lineStats(key, days, undefined, kind), [key, days, kind], !!key);
  const reports = useAsync(
    () => api.lineReports(key, { days, limit: 100, kind }),
    [key, days, kind, showAll, user?.uid],
    !!key && showAll,
  );

  useWatchLines([key], (r) => {
    stats.reload(true);
    if (showAll && (!kind || kindOf(r) === kind)) {
      reports.setData((prev) => (prev ? { reports: [r, ...prev.reports.filter((x) => x.id !== r.id)] } : prev));
    }
    toast(t('line.newReport', { segment: `${kindLabel(kindOf(r))} · ${segmentText(r)}` }), 'error');
  });

  const askFlag = (report: Report) => {
    if (!requireLogin(user, t('flag.loginReason'))) return;
    setFlagging(report);
  };

  const line: Line | null = stats.data?.line ?? paramLine;
  const s = stats.data;
  const level = s?.level ?? 'calm';
  /** Ab 0,35 bündeln sich die Meldungen genug, dass eine Durchschnittszeit Sinn ergibt (wie auf dem Server). */
  const confidentAverage = !!s?.averageTime && s.averageTime.confidence >= 0.35;

  const vote = async (report: Report, value: 1 | -1) => {
    if (!requireLogin(user, t('line.loginVote'))) return;
    try {
      const updated = await api.vote(report.id, value);
      reports.setData((prev) => (prev ? { reports: prev.reports.map((r) => (r.id === updated.id ? updated : r)) } : prev));
      toast(value === 1 ? t('line.thanksConfirm') : t('line.thanksNoted'), 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const openTracking = () => {
    if (!line) return;
    if (!requireLogin(user, t('live.loginReason'))) return;
    setSheet(true);
  };

  const reportHere = () => {
    router.push({ pathname: '/report', params: params.tripId ? { tripId: params.tripId } : {} });
  };

  const maxHotspot = Math.max(1, ...(s?.hotspots.map((h) => h.count) ?? [1]));

  return (
    <Screen
      refreshing={stats.loading && !!stats.data}
      onRefresh={() => stats.reload()}
      footer={
        <View style={styles.footerRow}>
          <Button title={t('tabs.report')} icon="plus" variant="danger" full={false} onPress={reportHere} style={{ paddingHorizontal: 20 }} />
          <Button title={t('common.liveTracking')} icon="radio" variant="cyan" onPress={openTracking} disabled={!line} style={{ flex: 1 }} />
        </View>
      }
      header={
        <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
          <StackHeader />
          <View style={styles.titleRow}>
            {line ? <LineBadge line={line} size="lg" showIcon /> : <Skeleton width={70} height={34} />}
            <View style={{ flex: 1 }}>
              <AppText variant="h2" numberOfLines={1}>
                {line ? `${modeLabel(line.mode)} ${line.name}` : t('line.fallbackTitle')}
              </AppText>
              <AppText variant="small" muted numberOfLines={1}>
                {line?.operator ?? ' '}
              </AppText>
            </View>
          </View>
          <View style={[styles.levelPill, { backgroundColor: levelStyle[level].color }]}>
            <View style={styles.levelDot} />
            <AppText variant="smallStrong" color={colors.textOnLight}>
              {level === 'active' && s?.lastReportAt
                ? kind
                  ? t('line.kindReported', { kind: kindLabel(kind), ago: relativeTime(s.lastReportAt, now) })
                  : t('line.checkReported', { ago: relativeTime(s.lastReportAt, now) })
                : levelStyle[level].label}
            </AppText>
          </View>
          {line?.onDemand ? <Notice icon="phone-call" text={t('onDemand.lineHint')} color={colors.cyan} /> : null}
          {params.time ? (
            <AppText variant="small" muted>
              {t('line.yourTrip', { time: formatClock(params.time) })}
              {params.headsign ? ` → ${shortStopName(params.headsign)}` : ''}
            </AppText>
          ) : null}
          <KindFilterChips value={kind} onChange={setKind} counts={s?.byKind} />
          <ChipRow>
            {DAY_OPTIONS.map((d) => (
              <Chip key={d} label={t('line.days', { n: d })} selected={days === d} onPress={() => setDays(d)} />
            ))}
          </ChipRow>
        </View>
      }>
      {stats.error ? <ErrorBox message={stats.error} onRetry={() => stats.reload()} /> : null}

      {stats.loading && !s ? (
        <View style={{ gap: spacing.md }}>
          <Skeleton height={96} style={{ borderRadius: radius.card }} />
          <Skeleton height={80} style={{ borderRadius: radius.card }} />
          <Skeleton height={180} style={{ borderRadius: radius.card }} />
        </View>
      ) : null}

      {s ? (
        <>
          <StatStrip
            stats={[
              { value: String(s.total), label: t('line.stat.reports') },
              // Bei stark gestreuten Zeiten (z. B. morgens UND abends) ist ein Mittelwert irreführend –
              // dann zeigen wir den Beginn der stärksten Stoßzeit.
              confidentAverage
                ? { value: s.averageTime!.time, label: t('line.stat.avg'), color: colors.lime }
                : s.peakWindows[0]
                  ? {
                      value: s.peakWindows[0].from,
                      label: s.peakWindows.length > 1 ? t('line.stat.peak1') : t('line.stat.peak'),
                      color: colors.lime,
                    }
                  : { value: s.averageTime?.time ?? '–', label: t('line.stat.avg'), color: colors.lime },
              {
                value: relativeTimeShort(s.lastReportAt, now),
                label: t('line.stat.last'),
                color: level === 'active' ? colors.orange : colors.text,
              },
            ]}
          />

          <View style={styles.insight}>
            <View style={styles.insightIcon}>
              <GhostLogo size={26} color={colors.textOnLight} fill={colors.lilac} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <AppText variant="caption" color={colors.textOnLightMuted}>
                {t('line.forecast')}
              </AppText>
              <AppText variant="bodyStrong" color={colors.textOnLight}>
                {s.insight}
              </AppText>
              {s.averageTime && !confidentAverage && s.total >= 3 ? (
                <AppText variant="small" color={colors.textOnLightMuted}>
                  {s.peakWindows.length > 1
                    ? t('line.avgMisleading', { time: s.averageTime.time })
                    : t('line.avgSpread')}
                </AppText>
              ) : null}
            </View>
          </View>

          {s.total === 0 ? (
            kind ? (
              <EmptyState title={t('line.emptyKindTitle')} text={t('line.emptyKindText', { kind: kindLabel(kind), days })} />
            ) : (
              <EmptyState title={t('line.emptyTitle')} text={t('line.emptyText', { days })} />
            )
          ) : (
            <>
              {s.peakWindows.length > 0 ? (
                <View>
                  <SectionHeader title={t('line.when')} />
                  <ChipRow>
                    {s.peakWindows.map((w) => (
                      <View key={`${w.from}-${w.to}`} style={styles.window}>
                        <Feather name="clock" size={14} color={colors.textOnLight} />
                        <AppText variant="smallStrong" color={colors.textOnLight}>
                          {w.from}–{w.to} · {Math.round(w.share * 100)}%
                        </AppText>
                      </View>
                    ))}
                  </ChipRow>
                </View>
              ) : null}

              {s.hotspots.length > 0 ? (
                <View>
                  <SectionHeader title={t('line.hotspots')} />
                  <Card style={{ gap: spacing.md }}>
                    {s.hotspots.slice(0, 5).map((h, i) => (
                      <View key={`${h.stopA?.id}-${h.stopB?.id}-${i}`} style={styles.hotspot}>
                        <View style={[styles.rank, i === 0 && { backgroundColor: colors.orange }]}>
                          <AppText variant="smallStrong" color={i === 0 ? colors.textOnLight : colors.text}>
                            {i + 1}
                          </AppText>
                        </View>
                        <View style={{ flex: 1, gap: 6 }}>
                          <AppText variant="bodyStrong" numberOfLines={2}>
                            {h.stopA && h.stopB
                              ? `${shortStopName(h.stopA.name)} ↔ ${shortStopName(h.stopB.name)}`
                              : shortStopName((h.stopA ?? h.stopB)?.name)}
                          </AppText>
                          <MiniBar value={h.count} max={maxHotspot} color={i === 0 ? colors.orange : colors.lilac} />
                          <AppText variant="small" muted>
                            {t('line.hotspotReported', { count: h.count })}
                            {h.averageTime ? t('line.hotspotMostly', { time: h.averageTime }) : ''}
                            {t('line.hotspotLast', { ago: relativeTime(h.lastReportAt, now) })}
                          </AppText>
                        </View>
                      </View>
                    ))}
                  </Card>
                </View>
              ) : null}

              <View>
                <SectionHeader title={t('line.byHour')} />
                <Card>
                  <HourChart byHour={s.byHour} peakWindows={s.peakWindows} currentHour={currentBerlinHour()} />
                  <View style={styles.legend}>
                    <View style={[styles.legendDot, { backgroundColor: colors.lime }]} />
                    <AppText variant="small" muted>
                      {t('line.legendPeak')}
                    </AppText>
                    <View style={[styles.legendDot, { backgroundColor: colors.lilac, marginLeft: spacing.sm }]} />
                    <AppText variant="small" muted>
                      {t('line.legendReports')}
                    </AppText>
                    <View style={[styles.legendDot, { borderWidth: 1.5, borderColor: colors.cyan, marginLeft: spacing.sm }]} />
                    <AppText variant="small" muted>
                      {t('line.legendNow')}
                    </AppText>
                  </View>
                </Card>
              </View>

              <View>
                <SectionHeader title={t('line.byWeekday')} />
                <Card>
                  <WeekdayChart byWeekday={s.byWeekday} />
                </Card>
              </View>

              {s.directions.length > 1 ? (
                <View>
                  <SectionHeader title={t('line.byDirection')} />
                  <Card style={{ gap: spacing.sm }}>
                    {s.directions.map((d) => (
                      <View key={`${d.directionId}-${d.headsign}`} style={styles.dirRow}>
                        <Feather name="arrow-right" size={16} color={colors.textMuted} />
                        <AppText variant="body" style={{ flex: 1 }} numberOfLines={1}>
                          {d.headsign ? shortStopName(d.headsign) : t('common.unknown')}
                        </AppText>
                        <AppText variant="bodyStrong">{d.count}×</AppText>
                      </View>
                    ))}
                  </Card>
                </View>
              ) : null}

              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <AppText variant="h3">{t('line.showAll')}</AppText>
                  <AppText variant="small" muted>
                    {t('line.showAllText')}
                  </AppText>
                </View>
                <Toggle value={showAll} onChange={setShowAll} accessibilityLabel={t('line.showAll')} />
              </View>

              {showAll ? (
                <View>
                  {reports.error ? <ErrorBox message={reports.error} onRetry={() => reports.reload()} /> : null}
                  {reports.loading && !reports.data ? <Skeleton height={120} style={{ borderRadius: radius.card }} /> : null}
                  {(reports.data?.reports ?? []).map((r, i, arr) => (
                    <TimelineItem
                      key={r.id}
                      top={formatTime(r.reportedAt)}
                      bottom={formatDayMonth(r.reportedAt)}
                      separator={i < arr.length - 1}>
                      <ReportItem report={r} now={now} onVote={vote} onFlag={askFlag} />
                    </TimelineItem>
                  ))}
                  {reports.data && reports.data.reports.length === 0 ? (
                    <AppText variant="small" muted center>
                      {t('line.noneInPeriod')}
                    </AppText>
                  ) : null}
                </View>
              ) : null}
            </>
          )}
        </>
      ) : null}

      <TrackingSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        context={
          line
            ? {
                line,
                tripId: params.tripId || undefined,
                headsign: params.headsign || undefined,
                directionId: params.directionId || undefined,
                departureTime: params.time || undefined,
              }
            : null
        }
        onCreated={() => toast(t('line.trackingStarted'), 'success')}
      />
      <FlagSheet report={flagging} onClose={() => setFlagging(null)} />
    </Screen>
  );
}

function ReportItem({
  report,
  now,
  onVote,
  onFlag,
}: {
  report: Report;
  now: number;
  onVote: (r: Report, v: 1 | -1) => void;
  onFlag: (r: Report) => void;
}) {
  const { t } = useI18n();
  const recent = now - new Date(report.reportedAt).getTime() < 3 * 3600_000;
  const canFlag = !report.isMine;
  return (
    <Pressable
      onLongPress={canFlag ? () => onFlag(report) : undefined}
      delayLongPress={450}
      style={[styles.reportItem, recent && { borderColor: 'rgba(255,122,26,0.4)' }]}>
      <View style={styles.itemHead}>
        <KindBadge kind={kindOf(report)} />
        <TrustBadge report={report} style={{ marginLeft: 8 }} />
        <View style={{ flex: 1 }} />
        {canFlag ? (
          <Pressable onPress={() => onFlag(report)} hitSlop={12} accessibilityLabel={t('flag.title')} style={styles.itemMenu}>
            <Feather name="more-vertical" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <AppText variant="bodyStrong">{segmentText(report)}</AppText>
      <AppText variant="small" muted>
        {[report.headsign ? `→ ${shortStopName(report.headsign)}` : null, relativeTime(report.reportedAt, now), tagsText(report.tags)]
          .filter(Boolean)
          .join(' · ')}
      </AppText>
      <View style={styles.voteRow}>
        {report.isMine ? (
          <AppText variant="small" color={colors.cyan}>
            {t('line.yourReport')}
          </AppText>
        ) : recent ? (
          <>
            <VoteButton label={t('line.stillThere')} icon="thumbs-up" active={report.myVote === 1} count={report.confirmations} onPress={() => onVote(report, 1)} />
            <VoteButton label={t('line.gone')} icon="thumbs-down" active={report.myVote === -1} count={report.denials} onPress={() => onVote(report, -1)} />
          </>
        ) : (
          <AppText variant="small" muted>
            👍 {report.confirmations} · 👎 {report.denials}
          </AppText>
        )}
      </View>
    </Pressable>
  );
}

function VoteButton({
  label,
  icon,
  active,
  count,
  onPress,
}: {
  label: string;
  icon: 'thumbs-up' | 'thumbs-down';
  active: boolean;
  count: number;
  onPress: () => void;
}) {
  const color = icon === 'thumbs-up' ? colors.lime : colors.orange;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.vote, active && { backgroundColor: color, borderColor: color }, pressed && { opacity: 0.8 }]}>
      <Feather name={icon} size={14} color={active ? colors.textOnLight : color} />
      <AppText variant="smallStrong" color={active ? colors.textOnLight : colors.text}>
        {label} · {count}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  levelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  levelDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textOnLight },
  insight: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.lilac,
    borderRadius: radius.card,
    padding: spacing.lg,
  },
  insightIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: 'rgba(20,32,58,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  window: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.lime,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  hotspot: { flexDirection: 'row', gap: spacing.sm },
  rank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  dirRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
  },
  reportItem: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  itemMenu: { padding: 2, marginRight: -4 },
  voteRow: { flexDirection: 'row', gap: spacing.xs, marginTop: 6, flexWrap: 'wrap' },
  vote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
});
