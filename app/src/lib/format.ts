// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { TIME_ZONE } from '@/config';
import { getLang, localeOf, t, type Lang } from '@/i18n';

const cache = new Map<string, Intl.DateTimeFormat>();

/** Formatter je Sprache + Optionen (gecacht). */
function formatter(name: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const lang: Lang = getLang();
  const key = `${lang}|${name}`;
  let f = cache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(localeOf(lang), { ...options, timeZone: TIME_ZONE });
    } catch {
      // Fallback, falls die Engine keine Zeitzonen unterstützt → Gerätezeit
      f = new Intl.DateTimeFormat(localeOf(lang), options);
    }
    cache.set(key, f);
  }
  return f;
}

/** "08:15" */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return formatter('time', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** "08:15 Uhr" (de) / "08:15" (en) */
export function formatClock(iso: string | null | undefined): string {
  return t('time.clock', { time: formatTime(iso) });
}

/** "Fr., 06.11." / "Fri 06/11" */
export function formatDay(iso: string): string {
  return formatter('day', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(iso));
}

/** Gleicher Kalendertag in der Anzeige-Zeitzone (Europe/Berlin)? */
export function sameDayInZone(a: string | number | Date, b: string | number | Date): boolean {
  const f = formatter('ymd', { year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date(a)) === f.format(new Date(b));
}

/** "Freitag, 6. November" / "Friday 6 November" */
export function formatDateLong(date: Date): string {
  return formatter('dateLong', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

/** "gerade eben", "vor 3 Min" / "just now", "3 min ago" … */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return t('time.never');
  const diffMs = now - new Date(iso).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 0) {
    const inMin = -min;
    if (inMin < 60) return t('time.inMin', { n: inMin });
    return t('time.inH', { n: Math.round(inMin / 60) });
  }
  if (min < 1) return t('time.justNow');
  if (min < 60) return t('time.minAgo', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('time.hAgo', { n: h });
  const d = Math.round(h / 24);
  if (d === 1) return t('time.yesterday');
  return t('time.daysAgo', { n: d });
}

/** Kurzform ohne "vor"/"ago": "jetzt", "3 Min", "2 Std", "4 T" / "now", "3 min", "2 h", "4 d" */
export function relativeTimeShort(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '–';
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return t('time.nowShort');
  if (min < 60) return t('time.min', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('time.h', { n: h });
  return t('time.days', { n: Math.round(h / 24) });
}

/** "06.11." / "06/11" */
export function formatDayMonth(iso: string): string {
  return formatter('dayMonth', { day: '2-digit', month: '2-digit' }).format(new Date(iso));
}

/** 75 → "1 h 15 min" / "1 Std 15 Min" */
export function formatDuration(totalMin: number): string {
  const m = Math.max(0, Math.round(totalMin));
  if (m < 60) return t('time.min', { n: m });
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? t('time.h', { n: h }) : t('time.hMin', { h, m: rest });
}

export function delayMinutes(planned?: string, actual?: string): number {
  if (!planned || !actual) return 0;
  return Math.round((new Date(actual).getTime() - new Date(planned).getTime()) / 60000);
}

export function greeting(date: Date = new Date()): string {
  const h = Number(formatter('hour', { hour: '2-digit', hour12: false }).format(date));
  if (h >= 5 && h < 11) return t('greeting.morning');
  if (h >= 11 && h < 18) return t('greeting.day');
  return t('greeting.evening');
}

/** Entfernt den Orts-Zusatz in Klammern: "U Kottbusser Tor (Berlin)" → "U Kottbusser Tor" */
export function shortStopName(name: string | undefined | null): string {
  if (!name) return t('common.unknown');
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name;
}

export function addMinutes(iso: string | Date, minutes: number): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Date(d.getTime() + minutes * 60000).toISOString();
}
