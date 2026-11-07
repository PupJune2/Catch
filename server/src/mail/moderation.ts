// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Mails zu Moderations-Entscheidungen (Begründung nach DSA Art. 17), Antworten auf Feedback und
 * auf empfangene E-Mails. Gleiches Catch-Layout wie die Passwort-Mail. Alles, was von Nutzern oder
 * Admins kommt (Haltestellen, Notiz, Feedback-/Mail-Text, Antwort, Name), wird im HTML maskiert.
 */
import type { Config } from '../config.js';
import type { ReportKind } from '../contract.js';
import type { Lang } from '../i18n.js';
import type { MailMessage } from './resend.js';
import { replySubject, trimQuoted } from './inbound.js';
import { escapeHtml, layout, MAIL_COLORS, textToHtml } from './templates.js';

export type DecisionAction =
  | 'REPORT_HIDE'
  | 'REPORT_DELETE'
  | 'REPORT_UNHIDE'
  | 'USER_BAN'
  | 'USER_UNBAN'
  | 'USER_THROTTLE'
  | 'USER_UNTHROTTLE';

/** Gründe, die der Admin beim Ausblenden/Löschen einer Meldung wählen kann. */
export const REPORT_REASONS = ['WRONG', 'SPAM', 'PERSONAL_DATA', 'INAPPROPRIATE', 'OTHER'] as const;
/** Gründe, die der Admin beim Sperren eines Kontos wählen kann. */
export const BAN_REASONS = ['REPEATED_FALSE_REPORTS', 'SPAM', 'PERSONAL_DATA', 'ABUSE', 'OTHER'] as const;
/** Gründe automatischer Entscheidungen bzw. Aufhebungen. */
export const SYSTEM_REASONS = ['FLAGGED', 'DISPUTED', 'REVIEWED'] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];
export type BanReason = (typeof BAN_REASONS)[number];
export type DecisionReason = ReportReason | BanReason | (typeof SYSTEM_REASONS)[number];

/** Was gemeldet war – Schnappschuss zum Zeitpunkt der Entscheidung. */
export interface ReportInfo {
  kind: ReportKind;
  line: string | null;
  headsign: string | null;
  prevStop: string | null;
  nextStop: string | null;
  reportedAt: string | null;
}

/** Wie man widersprechen kann. */
export type Objection = { kind: 'reply' } | { kind: 'email'; address: string } | { kind: 'app' };

export function objectionRoute(cfg: Pick<Config, 'MAIL_REPLY_TO' | 'CONTACT_EMAIL'>): Objection {
  if (cfg.MAIL_REPLY_TO.trim()) return { kind: 'reply' };
  if (cfg.CONTACT_EMAIL.trim()) return { kind: 'email', address: cfg.CONTACT_EMAIL.trim() };
  return { kind: 'app' };
}

export interface DecisionMailInput {
  action: DecisionAction;
  reason: DecisionReason;
  note?: string | null;
  automated: boolean;
  report?: ReportInfo | null;
  /** Sperre: wurden alle Meldungen mit ausgeblendet? */
  hideReports?: boolean;
  /** Drosselung: bis wann (ISO) und welche Limits. */
  until?: string | null;
  limits?: { perDay: number; cooldownMinutes: number; days: number };
  objection: Objection;
}

const KIND: Record<Lang, Record<ReportKind, string>> = {
  en: { DELAY: 'Delay', CANCELLED: 'Cancellation', CROWDED: 'Crowding', DISRUPTION: 'Disruption', CHECK: 'Ticket check' },
  de: { DELAY: 'Verspätung', CANCELLED: 'Ausfall', CROWDED: 'Überfüllung', DISRUPTION: 'Störung', CHECK: 'Kontrolle' },
};

type Limits = NonNullable<DecisionMailInput['limits']>;

interface Texts {
  labels: { report: string; where: string; time: string; measure: string; reason: string; note: string; decision: string; basis: string };
  basis: string;
  human: string;
  auto: string;
  objection: { reply: string; email: (a: string) => string; app: string };
  button: string;
  legal: string;
  footer: string;
  reason: Record<DecisionReason, string>;
  /** Grund "DISPUTED" bei der Drosselung (statt "einer Meldung widersprochen") */
  reasonThrottle: string;
  measure: {
    hide: string;
    delete: string;
    ban: string;
    banHidden: string;
    unban: string;
    throttle: (l: Limits, until: string) => string;
    unthrottle: string;
  };
  subject: Record<Exclude<DecisionAction, 'REPORT_UNHIDE'>, string> & { throttle: (days: number) => string };
  title: Record<Exclude<DecisionAction, 'REPORT_UNHIDE'>, string>;
  preheader: Record<Exclude<DecisionAction, 'REPORT_UNHIDE'>, string>;
  intro: {
    hide: string;
    hideFlagged: string;
    hideDisputed: string;
    delete: string;
    ban: string;
    unban: string;
    throttle: (until: string) => string;
    throttleAfter: string;
    unthrottle: string;
  };
  welcomeNote: string;
}

const strong = (s: string) => `<strong style="color:${MAIL_COLORS.text};">${s}</strong>`;
const mailto = (a: string) => `<a href="mailto:${escapeHtml(a)}" style="color:${MAIL_COLORS.lime};text-decoration:underline;">${escapeHtml(a)}</a>`;

const TEXT: Record<Lang, Texts> = {
  en: {
    labels: {
      report: 'Report',
      where: 'Where',
      time: 'Reported',
      measure: 'Measure',
      reason: 'Reason',
      note: 'Note from the Catch team',
      decision: 'How it was decided',
      basis: 'Basis',
    },
    basis: 'Catch terms of use, section 4 (rules for tips) and section 7 (moderation)',
    human: 'By the Catch team, after a review',
    auto: 'Automatically – no person has reviewed it yet',
    objection: {
      reply: 'Do you think this is wrong? Just reply to this e-mail and briefly tell us why. A person will then review the decision again.',
      email: (a) => `Do you think this is wrong? Write to ${mailto(a)} and briefly tell us why. A person will then review the decision again.`,
      app: 'Do you think this is wrong? Send us a message in the app (Profile → Send feedback) and briefly tell us why. A person will then review the decision again.',
    },
    button: 'Read the terms of use',
    legal: 'Objecting to us is free and optional – your right to take legal action against this decision is not affected.',
    footer: 'Catch – live tips from passengers on buses and trains. You are receiving this e-mail because it concerns your Catch account.',
    reason: {
      WRONG: 'False or misleading information',
      SPAM: 'Spam or duplicate reports',
      PERSONAL_DATA: 'Describes or exposes people',
      INAPPROPRIATE: 'Inappropriate content',
      OTHER: 'Other violation of the terms of use',
      REPEATED_FALSE_REPORTS: 'Repeated false or misleading reports',
      ABUSE: 'Misuse of Catch (e.g. harassment, manipulation or automated use)',
      FLAGGED: 'Flagged as a problem by several users',
      DISPUTED: 'Disputed by several users',
      REVIEWED: 'Decision reviewed',
    },
    reasonThrottle: 'Many of your recent reports were disputed or hidden',
    measure: {
      hide: 'Hidden – other users no longer see it and it no longer counts in statistics.',
      delete: 'Deleted permanently.',
      ban: 'Account suspended – you can no longer report, confirm, flag or use live tracking with it.',
      banHidden: 'All your reports have been hidden as well.',
      unban: 'Suspension lifted',
      throttle: (l, until) =>
        `Reporting limited until ${until}: at most ${l.perDay} reports per day and one every ${l.cooldownMinutes} minutes. Everything else works as usual.`,
      unthrottle: 'Reporting limit lifted',
    },
    subject: {
      REPORT_HIDE: 'Your Catch report has been hidden',
      REPORT_DELETE: 'Your Catch report has been removed',
      USER_BAN: 'Your Catch account has been suspended',
      USER_UNBAN: 'Your Catch account is active again',
      USER_THROTTLE: 'Reporting on Catch is limited for you for now',
      USER_UNTHROTTLE: 'Your reporting limit on Catch has been lifted',
      throttle: (d) => `Reporting on Catch is limited for you for ${d} days`,
    },
    title: {
      REPORT_HIDE: 'We’ve hidden your report',
      REPORT_DELETE: 'We’ve removed your report',
      USER_BAN: 'Your account has been suspended',
      USER_UNBAN: 'Welcome back',
      USER_THROTTLE: 'Reporting is limited for now',
      USER_UNTHROTTLE: 'You can report as usual again',
    },
    preheader: {
      REPORT_HIDE: 'One of your reports is no longer shown on Catch – here’s why and how to object.',
      REPORT_DELETE: 'One of your reports has been removed from Catch – here’s why and how to object.',
      USER_BAN: 'Your Catch account has been suspended – here’s why and how to object.',
      USER_UNBAN: 'You can report, confirm and use live tracking again.',
      USER_THROTTLE: 'Several of your recent reports were disputed – here’s what that means.',
      USER_UNTHROTTLE: 'The limit on reporting has been removed from your account.',
    },
    intro: {
      hide: 'After a review, we have hidden one of your reports on Catch. Here are the details:',
      hideFlagged: 'Several users flagged one of your reports on Catch as a problem, so it has been hidden automatically. Here are the details:',
      hideDisputed: 'Several users disputed one of your reports on Catch, so it has been hidden automatically. Here are the details:',
      delete: 'After a review, we have deleted one of your reports on Catch. Here are the details:',
      ban: 'After a review, we have suspended your Catch account. You can still search connections and view tips without signing in.',
      unban: 'We have lifted the suspension of your Catch account. You can report, confirm and use live tracking again – please keep to our terms of use.',
      throttle: (until) =>
        `Several of your recent reports were disputed by other users or hidden. To keep the information on Catch reliable, reporting is limited for your account until ${strong(escapeHtml(until))}.`,
      throttleAfter: 'The limit ends automatically. Please only report what you can see yourself at that moment – then your reports will soon count fully again.',
      unthrottle: 'We have reviewed your account and removed the limit on reporting. You can report as usual again.',
    },
    welcomeNote: 'Thanks for helping to keep Catch reliable for everyone.',
  },
  de: {
    labels: {
      report: 'Meldung',
      where: 'Wo',
      time: 'Gemeldet',
      measure: 'Maßnahme',
      reason: 'Grund',
      note: 'Hinweis des Catch-Teams',
      decision: 'Wie entschieden wurde',
      basis: 'Grundlage',
    },
    basis: 'Catch-Nutzungsbedingungen, Nr. 4 (Regeln für Hinweise) und Nr. 7 (Moderation)',
    human: 'Vom Catch-Team, nach einer Prüfung',
    auto: 'Automatisch – noch ohne Prüfung durch einen Menschen',
    objection: {
      reply: 'Du hältst das für falsch? Antworte einfach auf diese E-Mail und schreib kurz, warum. Dann prüft ein Mensch die Entscheidung noch einmal.',
      email: (a) => `Du hältst das für falsch? Schreib an ${mailto(a)} und erklär kurz, warum. Dann prüft ein Mensch die Entscheidung noch einmal.`,
      app: 'Du hältst das für falsch? Schick uns in der App eine Nachricht (Profil → Feedback senden) und schreib kurz, warum. Dann prüft ein Mensch die Entscheidung noch einmal.',
    },
    button: 'Nutzungsbedingungen lesen',
    legal: 'Ein Widerspruch bei uns ist kostenlos und freiwillig – dein Recht, gerichtlich gegen die Entscheidung vorzugehen, bleibt davon unberührt.',
    footer: 'Catch – Live-Hinweise von Fahrgästen für Bus und Bahn. Du bekommst diese E-Mail, weil sie dein Catch-Konto betrifft.',
    reason: {
      WRONG: 'Falsche oder irreführende Angaben',
      SPAM: 'Spam oder Mehrfachmeldungen',
      PERSONAL_DATA: 'Beschreibt Personen oder stellt sie bloß',
      INAPPROPRIATE: 'Unangemessener Inhalt',
      OTHER: 'Sonstiger Verstoß gegen die Nutzungsbedingungen',
      REPEATED_FALSE_REPORTS: 'Wiederholt falsche oder irreführende Meldungen',
      ABUSE: 'Missbrauch von Catch (z. B. Belästigung, Manipulation oder automatisierte Nutzung)',
      FLAGGED: 'Von mehreren Nutzern als problematisch markiert',
      DISPUTED: 'Von mehreren Nutzern widersprochen',
      REVIEWED: 'Entscheidung überprüft',
    },
    reasonThrottle: 'Vielen deiner letzten Meldungen wurde widersprochen, oder sie wurden ausgeblendet',
    measure: {
      hide: 'Ausgeblendet – andere sehen sie nicht mehr, und sie zählt nicht mehr in der Statistik.',
      delete: 'Endgültig gelöscht.',
      ban: 'Konto gesperrt – du kannst damit nichts mehr melden, bestätigen oder markieren und kein Live-Tracking nutzen.',
      banHidden: 'Außerdem wurden alle deine Meldungen ausgeblendet.',
      unban: 'Sperre aufgehoben',
      throttle: (l, until) =>
        `Melden eingeschränkt bis ${until}: höchstens ${l.perDay} Meldungen pro Tag und eine alle ${l.cooldownMinutes} Minuten. Alles andere funktioniert wie gewohnt.`,
      unthrottle: 'Einschränkung beim Melden aufgehoben',
    },
    subject: {
      REPORT_HIDE: 'Deine Catch-Meldung wurde ausgeblendet',
      REPORT_DELETE: 'Deine Catch-Meldung wurde entfernt',
      USER_BAN: 'Dein Catch-Konto wurde gesperrt',
      USER_UNBAN: 'Dein Catch-Konto ist wieder aktiv',
      USER_THROTTLE: 'Melden bei Catch ist für dich vorerst eingeschränkt',
      USER_UNTHROTTLE: 'Deine Einschränkung beim Melden wurde aufgehoben',
      throttle: (d) => `Melden bei Catch ist für dich ${d} Tage eingeschränkt`,
    },
    title: {
      REPORT_HIDE: 'Wir haben deine Meldung ausgeblendet',
      REPORT_DELETE: 'Wir haben deine Meldung entfernt',
      USER_BAN: 'Dein Konto wurde gesperrt',
      USER_UNBAN: 'Willkommen zurück',
      USER_THROTTLE: 'Melden ist vorerst eingeschränkt',
      USER_UNTHROTTLE: 'Du kannst wieder normal melden',
    },
    preheader: {
      REPORT_HIDE: 'Eine deiner Meldungen wird bei Catch nicht mehr angezeigt – warum, und wie du widersprechen kannst.',
      REPORT_DELETE: 'Eine deiner Meldungen wurde bei Catch entfernt – warum, und wie du widersprechen kannst.',
      USER_BAN: 'Dein Catch-Konto wurde gesperrt – warum, und wie du widersprechen kannst.',
      USER_UNBAN: 'Du kannst wieder melden, bestätigen und Live-Tracking nutzen.',
      USER_THROTTLE: 'Mehreren deiner letzten Meldungen wurde widersprochen – was das bedeutet.',
      USER_UNTHROTTLE: 'Die Einschränkung beim Melden wurde von deinem Konto entfernt.',
    },
    intro: {
      hide: 'Nach einer Prüfung haben wir eine deiner Meldungen bei Catch ausgeblendet. Die Einzelheiten:',
      hideFlagged: 'Mehrere Nutzer haben eine deiner Meldungen bei Catch als problematisch markiert. Sie wurde deshalb automatisch ausgeblendet. Die Einzelheiten:',
      hideDisputed: 'Mehrere Nutzer haben einer deiner Meldungen bei Catch widersprochen. Sie wurde deshalb automatisch ausgeblendet. Die Einzelheiten:',
      delete: 'Nach einer Prüfung haben wir eine deiner Meldungen bei Catch gelöscht. Die Einzelheiten:',
      ban: 'Nach einer Prüfung haben wir dein Catch-Konto gesperrt. Verbindungen suchen und Hinweise ansehen kannst du weiterhin ohne Anmeldung.',
      unban: 'Wir haben die Sperre deines Catch-Kontos aufgehoben. Du kannst wieder melden, bestätigen und Live-Tracking nutzen – bitte halte dich an unsere Nutzungsbedingungen.',
      throttle: (until) =>
        `Mehreren deiner letzten Meldungen haben andere widersprochen, oder sie wurden ausgeblendet. Damit die Hinweise bei Catch verlässlich bleiben, ist das Melden für dein Konto bis ${strong(escapeHtml(until))} eingeschränkt.`,
      throttleAfter: 'Die Einschränkung endet automatisch. Melde bitte nur, was du in dem Moment selbst siehst – dann zählen deine Meldungen bald wieder voll.',
      unthrottle: 'Wir haben dein Konto geprüft und die Einschränkung beim Melden aufgehoben. Du kannst wieder wie gewohnt melden.',
    },
    welcomeNote: 'Danke, dass du hilfst, Catch für alle verlässlich zu halten.',
  },
};

export function formatMailDate(lang: Lang, iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
  }).format(d) + (lang === 'de' ? ' Uhr' : '');
}

function termsUrl(lang: Lang, publicUrl: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/${lang === 'de' ? 'nutzungsbedingungen' : 'terms'}`;
}

/** HTML-Absatz → Text für die Nur-Text-Fassung. */
export function htmlToText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export interface Parts {
  subject: string;
  preheader: string;
  title: string;
  paragraphs: string[];
  details?: Array<[string, string]>;
  quotes?: Array<{ label: string; text: string; highlight?: boolean }>;
  after?: string[];
  button?: { label: string; url: string };
  note: string;
  footer: string;
}

/** Catch-Layout als HTML + Nur-Text-Fassung. */
export function renderMail(lang: Lang, publicUrl: string, p: Parts): Omit<MailMessage, 'to'> {
  const html = layout({ lang, publicUrl, ...p });
  const text = [
    p.title,
    '',
    ...p.paragraphs.flatMap((x, i) => (i ? ['', htmlToText(x)] : [htmlToText(x)])),
    ...(p.details?.length ? ['', ...p.details.map(([k, v]) => `${k}: ${v}`)] : []),
    ...(p.quotes ?? []).flatMap((q) => ['', `${q.label}:`, ...q.text.split('\n').map((l) => `> ${l}`)]),
    ...(p.after ?? []).flatMap((a) => ['', htmlToText(a)]),
    ...(p.button ? ['', `${p.button.label}: ${p.button.url}`] : []),
    '',
    p.note,
    '',
    '— ' + p.footer,
    publicUrl,
  ].join('\n');
  return { subject: p.subject, html, text };
}

function reportRows(lang: Lang, t: Texts, r: ReportInfo): Array<[string, string]> {
  const what = [KIND[lang][r.kind] ?? r.kind, r.line ? r.line + (r.headsign ? ` → ${r.headsign}` : '') : null].filter(Boolean).join(' · ');
  const where = [r.prevStop, r.nextStop].filter(Boolean).join(' → ');
  const rows: Array<[string, string]> = [[t.labels.report, what]];
  if (where) rows.push([t.labels.where, where]);
  if (r.reportedAt) rows.push([t.labels.time, formatMailDate(lang, r.reportedAt)]);
  return rows;
}

/**
 * Begründungs-Mail zu einer Entscheidung. null = für diese Aktion gibt es keine Mail
 * (Wiederherstellen einer Meldung).
 */
export function decisionMail(lang: Lang, d: DecisionMailInput, publicUrl: string): Omit<MailMessage, 'to'> | null {
  if (d.action === 'REPORT_UNHIDE') return null;
  const t = TEXT[lang] ?? TEXT.en;
  const objection =
    d.objection.kind === 'reply' ? escapeHtml(t.objection.reply) : d.objection.kind === 'email' ? t.objection.email(d.objection.address) : escapeHtml(t.objection.app);
  const terms = { label: t.button, url: termsUrl(lang, publicUrl) };
  const how: [string, string] = [t.labels.decision, d.automated ? t.auto : t.human];
  const note: Array<[string, string]> = d.note?.trim() ? [[t.labels.note, d.note.trim()]] : [];
  const reasonRow: [string, string] = [t.labels.reason, d.action === 'USER_THROTTLE' && d.reason === 'DISPUTED' ? t.reasonThrottle : t.reason[d.reason] ?? d.reason];
  const basis: [string, string] = [t.labels.basis, t.basis];
  const base = { preheader: t.preheader[d.action], title: t.title[d.action], footer: t.footer };

  switch (d.action) {
    case 'REPORT_HIDE':
    case 'REPORT_DELETE': {
      const intro =
        d.action === 'REPORT_DELETE'
          ? t.intro.delete
          : d.automated && d.reason === 'FLAGGED'
            ? t.intro.hideFlagged
            : d.automated && d.reason === 'DISPUTED'
              ? t.intro.hideDisputed
              : t.intro.hide;
      return renderMail(lang, publicUrl, {
        ...base,
        subject: t.subject[d.action],
        paragraphs: [escapeHtml(intro)],
        details: [
          ...(d.report ? reportRows(lang, t, d.report) : []),
          [t.labels.measure, d.action === 'REPORT_DELETE' ? t.measure.delete : t.measure.hide],
          reasonRow,
          ...note,
          how,
          basis,
        ],
        after: [objection],
        button: terms,
        note: t.legal,
      });
    }
    case 'USER_BAN':
      return renderMail(lang, publicUrl, {
        ...base,
        subject: t.subject.USER_BAN,
        paragraphs: [escapeHtml(t.intro.ban)],
        details: [[t.labels.measure, t.measure.ban + (d.hideReports ? ' ' + t.measure.banHidden : '')], reasonRow, ...note, how, basis],
        after: [objection],
        button: terms,
        note: t.legal,
      });
    case 'USER_UNBAN':
      return renderMail(lang, publicUrl, {
        ...base,
        subject: t.subject.USER_UNBAN,
        paragraphs: [escapeHtml(t.intro.unban)],
        details: [[t.labels.measure, t.measure.unban], ...note, how],
        button: terms,
        note: t.welcomeNote,
      });
    case 'USER_THROTTLE': {
      const limits = d.limits ?? { perDay: 3, cooldownMinutes: 30, days: 7 };
      const until = d.until ? formatMailDate(lang, d.until) : '–';
      return renderMail(lang, publicUrl, {
        ...base,
        subject: t.subject.throttle(limits.days),
        paragraphs: [t.intro.throttle(until)],
        details: [[t.labels.measure, t.measure.throttle(limits, until)], reasonRow, ...note, how, basis],
        after: [escapeHtml(t.intro.throttleAfter), objection],
        button: terms,
        note: t.legal,
      });
    }
    case 'USER_UNTHROTTLE':
      return renderMail(lang, publicUrl, {
        ...base,
        subject: t.subject.USER_UNTHROTTLE,
        paragraphs: [escapeHtml(t.intro.unthrottle)],
        details: [[t.labels.measure, t.measure.unthrottle], ...note, how],
        note: t.welcomeNote,
      });
  }
}

// --- Antwort auf Feedback ------------------------------------------------------------------

const REPLY_TEXT: Record<Lang, {
  subject: string;
  preheader: string;
  title: string;
  intro: string;
  reply: string;
  original: (date: string) => string;
  signature: string;
  more: { reply: string; email: (a: string) => string; app: string };
  footer: string;
}> = {
  en: {
    subject: 'Reply to your Catch feedback',
    preheader: 'The Catch team has answered your feedback.',
    title: 'We’ve answered your feedback',
    intro: 'Thanks for writing to us! Here’s our reply:',
    reply: 'Our reply',
    original: (d) => `Your message from ${d}`,
    signature: 'Best wishes,<br>The Catch team',
    more: {
      reply: 'Anything to add? Just reply to this e-mail.',
      email: (a) => `Anything to add? Write to ${a}.`,
      app: 'Anything to add? Send us another message in the app (Profile → Send feedback).',
    },
    footer: 'Catch – live tips from passengers on buses and trains. You are receiving this e-mail because you sent us feedback and agreed to a reply.',
  },
  de: {
    subject: 'Antwort auf dein Catch-Feedback',
    preheader: 'Das Catch-Team hat auf dein Feedback geantwortet.',
    title: 'Wir haben dir geantwortet',
    intro: 'Danke, dass du uns geschrieben hast! Hier ist unsere Antwort:',
    reply: 'Unsere Antwort',
    original: (d) => `Deine Nachricht vom ${d}`,
    signature: 'Viele Grüße<br>Dein Catch-Team',
    more: {
      reply: 'Möchtest du noch etwas ergänzen? Antworte einfach auf diese E-Mail.',
      email: (a) => `Möchtest du noch etwas ergänzen? Schreib an ${a}.`,
      app: 'Möchtest du noch etwas ergänzen? Schick uns einfach eine weitere Nachricht in der App (Profil → Feedback senden).',
    },
    footer: 'Catch – Live-Hinweise von Fahrgästen für Bus und Bahn. Du bekommst diese E-Mail, weil du uns Feedback geschickt und einer Antwort zugestimmt hast.',
  },
};

export function feedbackReplyMail(
  lang: Lang,
  f: { reply: string; original: string; sentAt: string | Date },
  publicUrl: string,
  objection: Objection,
): Omit<MailMessage, 'to'> {
  const t = REPLY_TEXT[lang] ?? REPLY_TEXT.en;
  const more = objection.kind === 'reply' ? t.more.reply : objection.kind === 'email' ? t.more.email(objection.address) : t.more.app;
  return renderMail(lang, publicUrl, {
    subject: t.subject,
    preheader: t.preheader,
    title: t.title,
    paragraphs: [escapeHtml(t.intro)],
    quotes: [
      { label: t.reply, text: f.reply, highlight: true },
      { label: t.original(formatMailDate(lang, f.sentAt)), text: f.original },
    ],
    after: [t.signature],
    note: more,
    footer: t.footer,
  });
}

// --- Antwort auf eine empfangene E-Mail (Admin-Bereich → Inbox) -----------------------------

const INBOX_REPLY_TEXT: Record<Lang, {
  title: string;
  hello: (name: string | null) => string;
  original: (date: string) => string;
  signature: string;
  more: { reply: string; email: (a: string) => string; app: string };
  footer: string;
}> = {
  en: {
    title: 'Reply from the Catch team',
    hello: (n) => (n ? `Hi ${n},` : 'Hi,'),
    original: (d) => `Your e-mail from ${d}`,
    signature: 'Best wishes,<br>The Catch team',
    more: REPLY_TEXT.en.more,
    footer: 'Catch – live tips from passengers on buses and trains. You are receiving this e-mail because you wrote to us.',
  },
  de: {
    title: 'Antwort vom Catch-Team',
    hello: (n) => (n ? `Hallo ${n},` : 'Hallo,'),
    original: (d) => `Deine E-Mail vom ${d}`,
    signature: 'Viele Grüße<br>Dein Catch-Team',
    more: REPLY_TEXT.de.more,
    footer: 'Catch – Live-Hinweise von Fahrgästen für Bus und Bahn. Du bekommst diese E-Mail, weil du uns geschrieben hast.',
  },
};

/** Name aus dem Absender für die Anrede – nur, wenn er wie ein Name aussieht. */
export function greetingName(name: string | null | undefined): string | null {
  const n = (name ?? '').replace(/[\u0000-\u001F\u007F"<>]/g, '').replace(/\s+/g, ' ').trim();
  if (!n || n.length > 60 || n.includes('@') || /^(catch|noreply|no-reply)$/i.test(n)) return null;
  return n;
}

/** Beginnt die Antwort schon mit einer Anrede? Dann keine zweite davor setzen. */
export function startsWithGreeting(reply: string): boolean {
  return /^\s*(hallo|hello|hi|hey|moin|servus|guten (morgen|tag|abend)|good (morning|afternoon|evening)|liebe|lieber|dear|sehr geehrte)\b/i.test(reply);
}

/**
 * Antwort auf eine empfangene Mail: Anrede (falls die Antwort keine hat), Antwort, Signatur,
 * darunter die ursprüngliche Nachricht (ohne zitierten Verlauf, gekürzt). Betreff "Re: …" ohne
 * doppeltes Präfix.
 */
export function inboxReplyMail(
  lang: Lang,
  m: { reply: string; original: string; receivedAt: string | Date; subject: string | null; name?: string | null },
  publicUrl: string,
  objection: Objection,
): Omit<MailMessage, 'to'> {
  const t = INBOX_REPLY_TEXT[lang] ?? INBOX_REPLY_TEXT.en;
  const more = objection.kind === 'reply' ? t.more.reply : objection.kind === 'email' ? t.more.email(objection.address) : t.more.app;
  const paragraphs = m.reply
    .split(/\n[ \t]*\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map(textToHtml);
  const original = trimQuoted(m.original, 1500);
  return renderMail(lang, publicUrl, {
    subject: replySubject(m.subject, lang),
    preheader: m.reply.replace(/\s+/g, ' ').trim().slice(0, 110),
    title: t.title,
    paragraphs: [...(startsWithGreeting(m.reply) ? [] : [escapeHtml(t.hello(greetingName(m.name)))]), ...paragraphs, t.signature],
    quotes: original ? [{ label: t.original(formatMailDate(lang, m.receivedAt)), text: original }] : [],
    note: more,
    footer: t.footer,
  });
}
