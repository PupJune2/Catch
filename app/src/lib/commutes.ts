// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Pendler-Modus in der App: Texte, Wochentage, Status und der Weg "Verbindung → als Strecke speichern".
 *
 * Datenschutz: Anders als gespeicherte Orte (nur auf dem Gerät, lib/places.ts) liegen Pendelstrecken
 * auf dem Server – nur so kann Catch die Strecke beobachten, während die App geschlossen ist.
 * Das steht im Editor und in der Datenschutzerklärung.
 */
import { router } from 'expo-router';
import { Platform } from 'react-native';

import {
  geoPlaceId,
  WEEKDAYS_ALL,
  WEEKDAYS_MON_FRI,
  type Commute,
  type CommutePlace,
  type CreateCommuteBody,
  type Journey,
  type Place,
} from '@/api/contract';
import { TIME_ZONE } from '@/config';
import { getLang, localeOf, t, type TKey } from '@/i18n';
import type { AppUser } from './auth';
import { formatTime } from './format';
import { registerForPush } from './notifications';
import { placeTitle, type SavedPlaces } from './places';
import { requireLogin } from './requireLogin';

const MIN = 60_000;

/** Wochentage Mo..So → Bit 0..6; Beschriftung über die vorhandenen Schlüssel wd.0 (So) … wd.6 (Sa). */
export const WEEKDAY_BITS = [0, 1, 2, 3, 4, 5, 6] as const;
export function weekdayShort(bit: number): string {
  return t(`wd.${(bit + 1) % 7}` as TKey);
}

export function weekdaysText(mask: number): string {
  if ((mask & WEEKDAYS_ALL) === WEEKDAYS_ALL) return t('commute.days.all');
  if (mask === WEEKDAYS_MON_FRI) return t('commute.days.weekdays');
  if (mask === 0b1100000) return t('commute.days.weekend');
  return WEEKDAY_BITS.filter((b) => mask & (1 << b)).map(weekdayShort).join(', ');
}

/** "Mon–Fri · leave 07:30" / "Mo–Fr · an bis 08:00" */
export function scheduleText(c: Pick<Commute, 'weekdays' | 'time' | 'timeMode'>): string {
  const when = c.timeMode === 'arrive' ? t('commute.arriveAt', { time: c.time }) : t('commute.departAt', { time: c.time });
  return `${weekdaysText(c.weekdays)} · ${when}`;
}

function berlinDate(ms: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toDateString();
  }
}

/** "Today" / "Tomorrow" / "Mon" für den nächsten Termin. */
export function dayLabel(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso);
  const d = berlinDate(ms);
  if (d === berlinDate(now)) return t('common.today');
  if (d === berlinDate(now + 86_400_000)) return t('commute.tomorrow');
  try {
    return new Intl.DateTimeFormat(localeOf(getLang()), { timeZone: TIME_ZONE, weekday: 'short' }).format(new Date(ms));
  } catch {
    return formatTime(iso);
  }
}

export type CommuteState = 'paused' | 'watching' | 'reminded' | 'upcoming' | 'none';

export function commuteState(c: Commute): CommuteState {
  if (!c.active) return 'paused';
  if (c.remindedAt && c.plan) return 'reminded';
  if (c.watching) return 'watching';
  if (c.nextAt) return 'upcoming';
  return 'none';
}

/** Die Strecke für die Startseite: läuft gerade, sonst der nächste Termin (höchstens ~20 h voraus). */
export function nextCommute(list: Commute[] | undefined, now = Date.now()): Commute | null {
  const active = (list ?? []).filter((c) => c.active && c.nextAt);
  const running = active.filter((c) => c.watching || c.plan);
  if (running.length) return running.sort((a, b) => Date.parse(a.plan?.leaveAt ?? a.nextAt!) - Date.parse(b.plan?.leaveAt ?? b.nextAt!))[0];
  const soon = active.filter((c) => Date.parse(c.nextAt!) - now < 20 * 3600_000).sort((a, b) => Date.parse(a.nextAt!) - Date.parse(b.nextAt!));
  return soon[0] ?? null;
}

/** Minuten bis zum Losgehen (negativ = schon vorbei). */
export function minutesUntil(iso: string, now = Date.now()): number {
  return Math.round((Date.parse(iso) - now) / MIN);
}

// --- Orte ----------------------------------------------------------------------------------

export function toCommutePlace(p: Place): CommutePlace {
  const isStop = p.kind === 'STOP' && !p.id.startsWith('geo:');
  return { kind: p.kind, id: isStop ? p.id : geoPlaceId(p.lat, p.lon), name: p.name.slice(0, 160), lat: p.lat, lon: p.lon };
}

export function toPlace(p: CommutePlace): Place {
  return { kind: p.kind, id: p.id, name: p.name, lat: p.lat, lon: p.lon };
}

function near(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return Math.abs(a.lat - b.lat) < 0.0015 && Math.abs(a.lon - b.lon) < 0.0025;
}

export function slotForPlace(saved: SavedPlaces, p: { id: string; lat: number; lon: number } | null | undefined): 'home' | 'work' | null {
  if (!p) return null;
  if (saved.work && (saved.work.id === p.id || near(saved.work, p))) return 'work';
  if (saved.home && (saved.home.id === p.id || near(saved.home, p))) return 'home';
  return null;
}

/** Name-Vorschlag nach dem Ziel: "To work" / "Home" / "To <Ziel>". */
export function suggestName(saved: SavedPlaces, to: Place | null): string {
  const slot = slotForPlace(saved, to);
  if (slot === 'work') return t('commute.nameToWork');
  if (slot === 'home') return t('commute.nameHome');
  if (to) return t('commute.nameTo', { place: placeTitle(to) }).slice(0, 40);
  return t('commute.nameDefault');
}

/** Start/Ziel aus einer Verbindung (Haltestelle mit ID, sonst Koordinate mit dem Namen aus der Suche). */
export function journeyEnds(j: Journey): { from: Place | null; to: Place | null } {
  const first = j.legs[0];
  const last = j.legs[j.legs.length - 1];
  const toPlaceOf = (s: { id: string; name: string; lat?: number; lon?: number }, transit: boolean): Place | null => {
    if (s.lat === undefined || s.lon === undefined) return null;
    const isStop = transit || (!!s.id && !s.id.startsWith('geo:') && s.name !== 'START' && s.name !== 'END');
    return isStop && s.id
      ? { kind: 'STOP', id: s.id, name: s.name, lat: s.lat, lon: s.lon }
      : { kind: 'ADDRESS', id: geoPlaceId(s.lat, s.lon), name: s.name, lat: s.lat, lon: s.lon };
  };
  return {
    from: first ? toPlaceOf(first.from, !first.walking) : null,
    to: last ? toPlaceOf(last.to, !last.walking) : null,
  };
}

// --- Entwurf (z. B. aus "Als Pendelstrecke speichern") --------------------------------------

export type CommuteDraft = Partial<Omit<CreateCommuteBody, 'from' | 'to'>> & { from?: Place | null; to?: Place | null };

let draft: CommuteDraft | null = null;

export const commuteDraft = {
  set(d: CommuteDraft) {
    draft = d;
  },
  /** Einmal abholen (danach leer). */
  take(): CommuteDraft | null {
    const d = draft;
    draft = null;
    return d;
  },
};

/** Verbindungs-Bildschirm → Editor mit Start, Ziel und Uhrzeit dieser Verbindung (Mo–Fr). */
export function saveJourneyAsCommute(journey: Journey, user: AppUser | null) {
  if (!requireLogin(user, t('commute.loginReason'))) return;
  const { from, to } = journeyEnds(journey);
  commuteDraft.set({ from, to, time: formatTime(journey.departure), timeMode: 'depart', weekdays: WEEKDAYS_MON_FRI });
  router.push('/commute-edit');
}

/** Beim Einschalten der ersten Strecke: Push erlauben (gleiche Logik wie im Profil). */
export async function ensurePushForCommutes(enabled: boolean, enable: () => void): Promise<string | null> {
  if (Platform.OS === 'web') return t('commute.pushWeb');
  if (!enabled) enable();
  const r = await registerForPush();
  return r.ok ? null : r.message;
}
