// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import type { ActivityLevel, Report, ReportSummary, ReportTag } from '@/api/contract';
import { t, tn, type TKey } from '@/i18n';
import { relativeTime, shortStopName } from './format';
import { kindLabel, visibleTags } from './kinds';

/** Anzeigename eines Merkmals in der aktuellen Sprache. */
export function tagLabel(tag: ReportTag): string {
  return t(`tag.${tag}` as TKey);
}

/** Anzeigbare Merkmale einer Meldung als Text ("Voll · Kein Platz für Rad/Kinderwagen"). */
export function tagsText(tags: ReportTag[]): string {
  return visibleTags(tags).map(tagLabel).join(' · ');
}

/** "Zwischen A und B" / "Vor B" / "Nach A" */
export function segmentText(report: Pick<Report, 'prevStop' | 'nextStop'>): string {
  const a = report.prevStop ? shortStopName(report.prevStop.name) : null;
  const b = report.nextStop ? shortStopName(report.nextStop.name) : null;
  if (a && b) return t('seg.between', { a, b });
  if (b) return t('seg.before', { b });
  if (a) return t('seg.after', { a });
  return t('seg.unknown');
}

/** Titel einer Meldung: "U8 → Wittenau" */
export function reportTitle(report: Pick<Report, 'line' | 'headsign'>): string {
  return report.headsign ? `${report.line.name} → ${shortStopName(report.headsign)}` : report.line.name;
}

export function isRecent(iso: string, minutes = 60, now = Date.now()): boolean {
  return now - new Date(iso).getTime() < minutes * 60000;
}

/** Kurzer Satz zur Meldungslage einer Linie. */
export function summaryText(s: ReportSummary | undefined, now = Date.now()): string {
  if (!s) return t('summary.noData');
  if (s.level === 'active' && s.lastReportAt) {
    const ago = relativeTime(s.lastReportAt, now);
    if (s.lastKind) {
      const kind = kindLabel(s.lastKind);
      return s.recentCount > 1 ? t('summary.activeKindMany', { kind, count: s.recentCount, ago }) : t('summary.activeKind', { kind, ago });
    }
    return t('summary.active', { count: s.recentCount, ago });
  }
  if (s.count30d === 0) return t('summary.none30');
  return tn('summary.count30', s.count30d);
}

export function levelOf(s: ReportSummary | undefined): ActivityLevel {
  return s?.level ?? 'calm';
}

const levelRank: Record<ActivityLevel, number> = { calm: 0, frequent: 1, active: 2 };

export function maxLevel(levels: ActivityLevel[]): ActivityLevel {
  return levels.reduce<ActivityLevel>((acc, l) => (levelRank[l] > levelRank[acc] ? l : acc), 'calm');
}
