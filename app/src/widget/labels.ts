// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Texte fürs Widget mit ausdrücklicher Sprache (der Widget-Task läuft ohne I18nProvider,
 * daher nicht die globalen t()-Helfer, die die Sprache der laufenden App nutzen).
 */
import type { Mode, ReportKind } from '@/api/contract';
import { TIME_ZONE } from '@/config';
import { localeOf, translate, type Lang, type TKey } from '@/i18n';
import { trackChanged, trackKind } from '@/lib/track';
import type { WidgetLineStatus } from './data';

const timeFormats = new Map<Lang, Intl.DateTimeFormat>();

/** "08:15" in Europe/Berlin */
export function clock(lang: Lang, iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  let f = timeFormats.get(lang);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
    try {
      f = new Intl.DateTimeFormat(localeOf(lang), { ...opts, timeZone: TIME_ZONE });
    } catch {
      f = new Intl.DateTimeFormat(localeOf(lang), opts);
    }
    timeFormats.set(lang, f);
  }
  return f.format(d);
}

/** "gerade eben" / "vor 5 Min" / "5 min ago" … */
export function ago(lang: Lang, iso: string | null | undefined, now: number): string {
  if (!iso) return '';
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return translate(lang, 'time.justNow');
  if (min < 60) return translate(lang, 'time.minAgo', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return translate(lang, 'time.hAgo', { n: h });
  return translate(lang, 'time.daysAgo', { n: Math.round(h / 24) });
}

export function kindName(lang: Lang, kind: ReportKind): string {
  return translate(lang, `kind.${kind}` as TKey);
}

/** "Gl. 7" / "Steig B1" / "Pl. 7"; leer ohne Gleisangabe. */
export function trackText(lang: Lang, mode: Mode, track: string | undefined): string {
  const v = track?.trim();
  if (!v) return '';
  return translate(lang, `track.${trackKind(mode)}.short` as TKey, { track: v });
}

export function isTrackChanged(d: { track?: string; plannedTrack?: string }): boolean {
  return trackChanged(d);
}

/** "Ruhig" · "Häufig Hinweise" · "Gerade gemeldet: Verspätung · vor 5 Min" */
export function lineStatusText(lang: Lang, s: WidgetLineStatus, now: number): string {
  if (s.level === 'active') {
    const parts = [s.lastKind ? kindName(lang, s.lastKind) : null, ago(lang, s.lastReportAt, now)].filter(Boolean);
    return parts.length ? `${translate(lang, 'level.active')}: ${parts.join(' · ')}` : translate(lang, 'level.active');
  }
  return translate(lang, s.level === 'frequent' ? 'level.frequent' : 'level.calm');
}

/** Kurzform des Haltestellennamens ohne Orts-Zusatz in Klammern. */
export function shortName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name;
}
