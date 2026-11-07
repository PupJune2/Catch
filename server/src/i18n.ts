// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Server-Texte in Englisch (Standard) und Deutsch.
 *
 * Die Sprache kommt aus dem Header `Accept-Language` (die App schickt "en" oder "de"),
 * beim WebSocket aus dem Feld `lang` der auth-Nachricht. Für Push-Benachrichtigungen
 * wird die zuletzt genutzte Sprache am Nutzer gespeichert (users.lang).
 */
import type { FastifyRequest } from 'fastify';
import type { ReportKind } from './contract.js';

export type Lang = 'en' | 'de';
export const DEFAULT_LANG: Lang = 'en';
export const LANGS: readonly Lang[] = ['en', 'de'];

type Params = Record<string, string | number>;
type Template = (p: Params) => string;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Bezeichnungen der Hinweis-Arten: [Satzanfang (Mehrzahl), klein (Mehrzahl)] */
const KIND_WORDS: Record<Lang, Record<ReportKind | 'ALL', [string, string]>> = {
  en: {
    ALL: ['Reports', 'reports'],
    DELAY: ['Delays', 'delays'],
    CANCELLED: ['Cancellations', 'cancellations'],
    CROWDED: ['Crowding reports', 'crowding reports'],
    DISRUPTION: ['Disruptions', 'disruptions'],
    CHECK: ['Ticket checks', 'ticket checks'],
  },
  de: {
    ALL: ['Meldungen', 'Meldungen'],
    DELAY: ['Verspätungen', 'Verspätungen'],
    CANCELLED: ['Ausfälle', 'Ausfälle'],
    CROWDED: ['Überfüllungs-Meldungen', 'Überfüllungs-Meldungen'],
    DISRUPTION: ['Störungen', 'Störungen'],
    CHECK: ['Kontrollen', 'Kontrollen'],
  },
};

/** "Delays" / "Kontrollen" … für Sätze. kind null = alle Arten. */
export function kindWord(lang: Lang, kind: ReportKind | null, start = true): string {
  return KIND_WORDS[lang][kind ?? 'ALL'][start ? 0 : 1];
}

/** Alarm-Titel je Art: [normal, auf dem eigenen Abschnitt] */
const ALERT_TITLES: Record<Lang, Record<ReportKind, [string, string]>> = {
  en: {
    DELAY: ['Delay on {line}', 'Delay on your section – {line}'],
    CANCELLED: ['Cancellation: {line}', 'Cancellation on your section – {line}'],
    CROWDED: ['Crowded: {line}', 'Crowding on your section – {line}'],
    DISRUPTION: ['Disruption on {line}', 'Disruption on your section – {line}'],
    CHECK: ['Ticket check on {line}', 'Ticket check on your section – {line}'],
  },
  de: {
    DELAY: ['Verspätung auf {line}', 'Verspätung auf deinem Abschnitt – {line}'],
    CANCELLED: ['Ausfall: {line}', 'Ausfall auf deinem Abschnitt – {line}'],
    CROWDED: ['Überfüllt: {line}', 'Überfüllt auf deinem Abschnitt – {line}'],
    DISRUPTION: ['Störung auf {line}', 'Störung auf deinem Abschnitt – {line}'],
    CHECK: ['Kontrolle auf {line}', 'Kontrolle auf deinem Abschnitt – {line}'],
  },
};

export function alertTitle(lang: Lang, kind: ReportKind, line: string, onMySegment: boolean): string {
  return ALERT_TITLES[lang][kind][onMySegment ? 1 : 0].replace('{line}', line);
}

const en = {
  // Anmeldung & Konto
  dev_login_invalid: () => 'Invalid developer login.',
  auth_not_configured: () => 'Sign-in is not set up on the server.',
  session_expired: () => 'Your session has expired. Please sign in again.',
  account_banned: () => 'Your account has been suspended.',
  login_required: () => 'Please sign in to use this feature.',
  account_not_found: () => 'Account not found.',
  // Meldungen
  report_not_found: () => 'Report not found.',
  report_not_deletable: () => 'Report not found or can no longer be deleted (only within 15 min of reporting).',
  stop_not_on_trip: (p) => `“${p.stop}” is not on this trip.`,
  cooldown: (p) => `You just reported ${p.line}. Thanks! Please wait a few minutes.`,
  daily_limit: () => 'You have already sent a lot of reports today. You can continue tomorrow.',
  own_report: () => 'You can’t vote on your own report.',
  own_report_flag: () => 'You can’t flag your own report.',
  too_old: () => 'This report is too old to vote on.',
  invalid_line: () => 'Invalid line.',
  // Live-Tracking
  too_many_trackings: (p) => `You can have at most ${p.max} live trackings at the same time.`,
  tracking_not_found: () => 'Live tracking not found.',
  // Pendler-Modus (Fehler, Pushes "Zeit zu gehen")
  too_many_commutes: (p) => `You can save at most ${p.max} commutes.`,
  commute_not_found: () => 'Commute not found.',
  commute_same_place: () => 'Start and destination must be different.',
  commute_leave_title: (p) => `${p.name}: time to leave`,
  commute_leave_body: (p) => `${p.line} at ${p.time} from ${p.stop}${p.delay}${p.walk}`,
  commute_walk_body: (p) => `Leave at ${p.leave} – ${p.min} min on foot`,
  commute_update_title: (p) => `${p.name}: new time`,
  commute_update_body: (p) => `Leave at ${p.leave} now: ${p.line} at ${p.time} from ${p.stop}${p.delay}`,
  commute_cancel_title: (p) => `${p.line} cancelled – ${p.name}`,
  commute_cancel_body: (p) => `Next option: ${p.line} at ${p.time} from ${p.stop}, leave at ${p.leave}`,
  commute_cancel_none: () => 'No alternative found right now – check the app.',
  commute_delay: (p) => ` (+${p.n} min)`,
  commute_walk: (p) => ` · ${p.min} min walk`,
  commute_alert_title: (p) => `${p.name}: ${p.title}`,
  line_bus: (p) => `Bus ${p.name}`,
  line_tram: (p) => `Tram ${p.name}`,
  // Allgemein
  invalid_input: (p) => `Invalid input${p.where ? ` (${p.where})` : ''}: ${p.detail}`,
  rate_limited: () => 'Too many requests – please wait a moment.',
  internal: () => 'Something went wrong. Please try again later.',
  route_not_found: () => 'Not found.',
  // Admin-Bereich
  admin_2fa_required: () => 'Please enter the code from your authenticator app.',
  admin_2fa_invalid: () => 'This code is not valid (or was already used). Please wait for the next one.',
  admin_locked: (p) => `Too many wrong codes. Admin login is locked for ${p.minutes} min.`,
  admin_self: () => 'Admin accounts can’t be changed here.',
  user_not_found: () => 'Account not found.',
  feedback_not_found: () => 'Feedback not found.',
  // Moderation & Vertrauen
  report_throttled: (p) =>
    `Several of your recent reports were disputed or hidden, so reporting is limited for you until ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(String(p.until)))}: at most ${p.max} reports per day and one every ${p.minutes} minutes. Think this is a mistake? Send us feedback in the app.`,
  feedback_no_contact: () => 'This person has not agreed to be contacted by e-mail (or their account has no e-mail address).',
  inbox_not_found: () => 'E-mail not found.',
  inbox_no_address: () => 'This e-mail has no valid sender address to reply to.',
  // E-Mail
  mail_not_configured: () => 'E-mail sending is not set up on the server.',
  mail_failed: () => 'The e-mail could not be sent. Please try again later.',
  transit_not_found: () => 'Not found in the timetable.',
  transit_unavailable: () => 'The timetable service is not reachable right now. Please try again shortly.',
  // WebSocket
  ws_invalid: () => 'Invalid message',
  ws_auth_failed: () => 'Sign-in failed',
  ws_unknown: () => 'Unknown message type',
  // Linien-Zusammenfassung ("insight")
  insight_none: (p) => (p.what === 'reports' ? `Nothing was reported here in the last ${p.days} days.` : `No ${p.what} reported here in the last ${p.days} days.`),
  insight_active: (p) => `Active right now: ${p.count} ${plural(Number(p.count), 'report', 'reports')} in the last hour.`,
  insight_too_few: (p) => `Only ${p.count} ${plural(Number(p.count), 'report', 'reports')} in ${p.days} days – no reliable pattern yet.`,
  insight_mostly: (p) => `${p.What} mostly around ${p.time}, especially between ${p.from} and ${p.to}.`,
  insight_two_peaks: (p) => `Two peak times: ${p.aFrom}–${p.aTo} and ${p.bFrom}–${p.bTo}.`,
  insight_peak: (p) => `Cluster between ${p.from} and ${p.to}, otherwise spread over the day.`,
  insight_spread: () => 'Reports are spread over the whole day.',
  insight_hotspot_between: (p) => `Hotspot: between ${p.a} and ${p.b} (${p.count}×).`,
  insight_hotspot_at: (p) => `Hotspot: at ${p.a} (${p.count}×).`,
  // Alarme (Live-Tracking, Push)
  alert_between: (p) => `Between ${p.a} and ${p.b}`,
  alert_at: (p) => `At ${p.a}`,
  alert_direction: (p) => ` · towards ${p.dir}`,
  just_now: () => 'just now',
  minutes_ago: (p) => `${p.n} min ago`,
} satisfies Record<string, Template>;

export type MsgKey = keyof typeof en;

const de: Record<MsgKey, Template> = {
  dev_login_invalid: () => 'Ungültiger Entwickler-Login.',
  auth_not_configured: () => 'Login ist auf dem Server nicht eingerichtet.',
  session_expired: () => 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.',
  account_banned: () => 'Dein Konto wurde gesperrt.',
  login_required: () => 'Bitte melde dich an, um diese Funktion zu nutzen.',
  account_not_found: () => 'Konto nicht gefunden.',
  report_not_found: () => 'Meldung nicht gefunden.',
  report_not_deletable: () => 'Meldung nicht gefunden oder nicht mehr löschbar (nur 15 Min. nach dem Melden).',
  stop_not_on_trip: (p) => `„${p.stop}“ liegt nicht auf dieser Fahrt.`,
  cooldown: (p) => `Du hast ${p.line} gerade schon gemeldet. Danke! Bitte warte ein paar Minuten.`,
  daily_limit: () => 'Du hast heute schon sehr viele Meldungen abgegeben. Morgen geht es weiter.',
  own_report: () => 'Du kannst deine eigene Meldung nicht bewerten.',
  own_report_flag: () => 'Du kannst deine eigene Meldung nicht melden.',
  too_old: () => 'Diese Meldung ist zu alt zum Bewerten.',
  invalid_line: () => 'Ungültige Linie.',
  too_many_trackings: (p) => `Du kannst höchstens ${p.max} Live-Trackings gleichzeitig haben.`,
  tracking_not_found: () => 'Live-Tracking nicht gefunden.',
  too_many_commutes: (p) => `Du kannst höchstens ${p.max} Pendelstrecken speichern.`,
  commute_not_found: () => 'Pendelstrecke nicht gefunden.',
  commute_same_place: () => 'Start und Ziel müssen verschieden sein.',
  commute_leave_title: (p) => `${p.name}: Zeit loszugehen`,
  commute_leave_body: (p) => `${p.line} um ${p.time} ab ${p.stop}${p.delay}${p.walk}`,
  commute_walk_body: (p) => `Los um ${p.leave} – ${p.min} Min. zu Fuß`,
  commute_update_title: (p) => `${p.name}: neue Zeit`,
  commute_update_body: (p) => `Jetzt um ${p.leave} losgehen: ${p.line} um ${p.time} ab ${p.stop}${p.delay}`,
  commute_cancel_title: (p) => `${p.line} fällt aus – ${p.name}`,
  commute_cancel_body: (p) => `Nächste Möglichkeit: ${p.line} um ${p.time} ab ${p.stop}, los um ${p.leave}`,
  commute_cancel_none: () => 'Gerade keine Alternative gefunden – schau in die App.',
  commute_delay: (p) => ` (+${p.n} Min.)`,
  commute_walk: (p) => ` · ${p.min} Min. Fußweg`,
  commute_alert_title: (p) => `${p.name}: ${p.title}`,
  line_bus: (p) => `Bus ${p.name}`,
  line_tram: (p) => `Tram ${p.name}`,
  invalid_input: (p) => `Ungültige Eingabe${p.where ? ` (${p.where})` : ''}: ${p.detail}`,
  rate_limited: () => 'Zu viele Anfragen – bitte kurz warten.',
  internal: () => 'Da ist etwas schiefgelaufen. Bitte später erneut versuchen.',
  route_not_found: () => 'Gibt es nicht.',
  admin_2fa_required: () => 'Bitte gib den Code aus deiner Authenticator-App ein.',
  admin_2fa_invalid: () => 'Dieser Code ist ungültig (oder wurde schon benutzt). Bitte warte auf den nächsten.',
  admin_locked: (p) => `Zu viele falsche Codes. Der Admin-Login ist für ${p.minutes} Min. gesperrt.`,
  admin_self: () => 'Admin-Konten lassen sich hier nicht ändern.',
  user_not_found: () => 'Konto nicht gefunden.',
  feedback_not_found: () => 'Feedback nicht gefunden.',
  report_throttled: (p) =>
    `Mehreren deiner letzten Meldungen wurde widersprochen, oder sie wurden ausgeblendet. Deshalb ist Melden für dich bis ${new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(String(p.until)))} Uhr eingeschränkt: höchstens ${p.max} Meldungen pro Tag und eine alle ${p.minutes} Minuten. Hältst du das für einen Fehler? Schick uns Feedback in der App.`,
  feedback_no_contact: () => 'Diese Person hat einer Antwort per E-Mail nicht zugestimmt (oder ihr Konto hat keine E-Mail-Adresse).',
  inbox_not_found: () => 'E-Mail nicht gefunden.',
  inbox_no_address: () => 'Diese E-Mail hat keine gültige Absender-Adresse für eine Antwort.',
  mail_not_configured: () => 'Der E-Mail-Versand ist auf dem Server nicht eingerichtet.',
  mail_failed: () => 'Die E-Mail konnte nicht gesendet werden. Bitte später erneut versuchen.',
  transit_not_found: () => 'Nicht im Fahrplan gefunden.',
  transit_unavailable: () => 'Die Fahrplanauskunft ist gerade nicht erreichbar. Bitte gleich nochmal versuchen.',
  ws_invalid: () => 'Ungültige Nachricht',
  ws_auth_failed: () => 'Anmeldung fehlgeschlagen',
  ws_unknown: () => 'Unbekannter Nachrichtentyp',
  insight_none: (p) => (p.what === 'Meldungen' ? `In den letzten ${p.days} Tagen wurde hier nichts gemeldet.` : `In den letzten ${p.days} Tagen keine ${p.what} gemeldet.`),
  insight_active: (p) => `Gerade aktiv: ${p.count} ${plural(Number(p.count), 'Meldung', 'Meldungen')} in der letzten Stunde.`,
  insight_too_few: (p) => `Erst ${p.count} ${plural(Number(p.count), 'Meldung', 'Meldungen')} in ${p.days} Tagen – noch keine verlässliche Tendenz.`,
  insight_mostly: (p) => `${p.What} meist gegen ${p.time} Uhr, vor allem zwischen ${p.from} und ${p.to}.`,
  insight_two_peaks: (p) => `Zwei Stoßzeiten: ${p.aFrom}–${p.aTo} und ${p.bFrom}–${p.bTo} Uhr.`,
  insight_peak: (p) => `Häufung zwischen ${p.from} und ${p.to} Uhr, sonst über den Tag verteilt.`,
  insight_spread: () => 'Die Meldungen verteilen sich über den ganzen Tag.',
  insight_hotspot_between: (p) => `Hotspot: zwischen ${p.a} und ${p.b} (${p.count}×).`,
  insight_hotspot_at: (p) => `Hotspot: bei ${p.a} (${p.count}×).`,
  alert_between: (p) => `Zwischen ${p.a} und ${p.b}`,
  alert_at: (p) => `Bei ${p.a}`,
  alert_direction: (p) => ` · Richtung ${p.dir}`,
  just_now: () => 'gerade eben',
  minutes_ago: (p) => `vor ${p.n} Min.`,
};

const dictionaries: Record<Lang, Record<MsgKey, Template>> = { en, de };

/** Übersetzt einen Schlüssel. */
export function t(lang: Lang, key: MsgKey, params: Params = {}): string {
  return (dictionaries[lang] ?? dictionaries[DEFAULT_LANG])[key](params);
}

/** "de", "de-DE", "de-DE,de;q=0.9,en;q=0.8" → "de". Unbekannt/leer → null. */
export function parseLang(value: unknown): Lang | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const first = raw.split(',')[0]?.trim().toLowerCase() ?? '';
  if (first.startsWith('de')) return 'de';
  if (first.startsWith('en')) return 'en';
  return null;
}

/** Sprache einer HTTP-Anfrage (Standard: Englisch). */
export function reqLang(req: Pick<FastifyRequest, 'headers'>): Lang {
  return parseLang(req.headers['accept-language']) ?? DEFAULT_LANG;
}
