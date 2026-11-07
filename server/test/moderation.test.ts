// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { t } from '../src/i18n.js';
import { decisionMail, feedbackReplyMail, htmlToText, objectionRoute, type DecisionMailInput } from '../src/mail/moderation.js';
import { replyTo } from '../src/mail/resend.js';
import { passwordResetMail } from '../src/mail/templates.js';
import { replyBody } from '../src/routes/admin.js';
import {
  shouldThrottle,
  trustLevel,
  trustScore,
  TRUST_NEGATIVE,
  voteWeight,
  type TrustInputs,
} from '../src/services/trust.js';

const none: TrustInputs = { confirmations: 0, denials: 0, flags: 0, hidden: 0, reports: 0, accountAgeDays: 0 };

describe('Vertrauen: Punktzahl und Stufen', () => {
  it('neues Konto = 0 Punkte, Stufe 0 (unbestätigt), aber nicht negativ', () => {
    expect(trustScore(none)).toBe(0);
    expect(trustLevel(0)).toBe(0);
    expect(trustScore(none) <= TRUST_NEGATIVE).toBe(false);
  });

  it('Formel: +Bestätigungen −Widersprüche −2×Markierungen −5×ausgeblendet +Aktivität +Alter', () => {
    expect(trustScore({ ...none, confirmations: 12, denials: 2 })).toBe(10);
    expect(trustScore({ ...none, flags: 3 })).toBe(-6);
    expect(trustScore({ ...none, hidden: 1 })).toBe(-5);
    expect(trustScore({ ...none, confirmations: 4, denials: 1, flags: 1, hidden: 0, reports: 10, accountAgeDays: 45 })).toBe(4 - 1 - 2 + 2 + 1);
  });

  it('Aktivität (max. +4) und Kontoalter (max. +2) allein reichen nicht für "vertrauenswürdig"', () => {
    const busy = trustScore({ ...none, reports: 500, accountAgeDays: 3000 });
    expect(busy).toBe(6);
    expect(trustLevel(busy)).toBe(1);
    expect(trustLevel(trustScore({ ...none, reports: 500, accountAgeDays: 3000, confirmations: 4 }))).toBe(2);
  });

  it('Stufen-Grenzen wie bisher', () => {
    expect([-10, 0, 1, 9, 10, 49, 50, 500].map(trustLevel)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('eine ausgeblendete Meldung mit 3 Markierungen macht das Konto deutlich negativ', () => {
    const s = trustScore({ ...none, flags: 3, hidden: 1, reports: 2 });
    expect(s).toBe(-11);
    expect(s <= TRUST_NEGATIVE).toBe(true);
  });

  it('Stimmgewicht: deutlich negativ = halbe Stimme', () => {
    expect(voteWeight(0)).toBe(1);
    expect(voteWeight(TRUST_NEGATIVE + 1)).toBe(1);
    expect(voteWeight(TRUST_NEGATIVE)).toBe(0.5);
  });

  it('Drosselung ab 3 umstrittenen Meldungen in 7 Tagen (ausgeblendet, gelöscht oder −3)', () => {
    expect(shouldThrottle({ hidden: 2, deleted: 0, disputed: 0 })).toBe(false);
    expect(shouldThrottle({ hidden: 3, deleted: 0, disputed: 0 })).toBe(true);
    expect(shouldThrottle({ hidden: 1, deleted: 1, disputed: 1 })).toBe(true);
    expect(shouldThrottle({ hidden: 0, deleted: 0, disputed: 2 })).toBe(false);
  });

  it('Fehlermeldung der Drosselung in beiden Sprachen mit Datum', () => {
    const p = { until: '2026-11-14T13:05:00.000Z', max: 3, minutes: 30 };
    expect(t('en', 'report_throttled', p)).toContain('until 14 Nov 2026, 14:05');
    expect(t('en', 'report_throttled', p)).toContain('at most 3 reports per day and one every 30 minutes');
    expect(t('de', 'report_throttled', p)).toContain('bis 14.11.2026, 14:05 Uhr');
  });
});

const evil = '<script>alert(1)</script>';
const report = {
  kind: 'CHECK' as const,
  line: 'U8',
  headsign: 'Hermannstraße',
  prevStop: `Moritzplatz ${evil}`,
  nextStop: 'Kottbusser Tor & "Co"',
  reportedAt: '2026-11-07T13:32:00.000Z',
};
const base = (o: Partial<DecisionMailInput>): DecisionMailInput => ({
  action: 'REPORT_HIDE',
  reason: 'WRONG',
  automated: false,
  report,
  objection: { kind: 'reply' },
  ...o,
});

describe('Begründungs-Mails (DSA Art. 17)', () => {
  it('Ausblenden durch den Admin: Was, Maßnahme, Grund, Notiz, Prüfung, Widerspruch, AGB-Link', () => {
    const m = decisionMail('en', base({ note: `Please check ${evil}` }), 'https://junify.live')!;
    expect(m.subject).toBe('Your Catch report has been hidden');
    for (const s of ['Ticket check · U8 → Hermannstraße', 'Hidden – other users', 'False or misleading information', 'By the Catch team, after a review', 'Just reply to this e-mail', 'https://junify.live/terms', 'legal action']) {
      expect(m.html.includes(s) || m.text.includes(s), s).toBe(true);
    }
    expect(m.text).toContain('Reported: 7 Nov 2026, 14:32');
    // Inhalte von Nutzern/Admins sind maskiert
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(m.html).toContain('Kottbusser Tor &amp; &quot;Co&quot;');
    // Text-Fassung unverändert lesbar
    expect(m.text).toContain(`Moritzplatz ${evil} → Kottbusser Tor & "Co"`);
    expect(m.text).toContain(`Note from the Catch team: Please check ${evil}`);
  });

  it('Deutsch, gelöscht, Widerspruch per Kontaktadresse', () => {
    const m = decisionMail('de', base({ action: 'REPORT_DELETE', reason: 'PERSONAL_DATA', objection: { kind: 'email', address: 'hallo@junify.live' } }), 'https://junify.live')!;
    expect(m.subject).toBe('Deine Catch-Meldung wurde entfernt');
    expect(m.html).toContain('lang="de"');
    expect(m.text).toContain('Meldung: Kontrolle · U8 → Hermannstraße');
    expect(m.text).toContain('Gemeldet: 07.11.2026, 14:32 Uhr');
    expect(m.text).toContain('Beschreibt Personen oder stellt sie bloß');
    expect(m.html).toContain('href="mailto:hallo@junify.live"');
    expect(m.text).toContain('Schreib an hallo@junify.live');
    expect(m.html).toContain('https://junify.live/nutzungsbedingungen');
  });

  it('automatisch nach Markierungen: als automatische Entscheidung gekennzeichnet', () => {
    const en = decisionMail('en', base({ automated: true, reason: 'FLAGGED', objection: { kind: 'app' } }), 'https://junify.live')!;
    expect(en.text).toContain('flagged one of your reports');
    expect(en.text).toContain('How it was decided: Automatically – no person has reviewed it yet');
    expect(en.text).toContain('Profile → Send feedback');
    const de = decisionMail('de', base({ automated: true, reason: 'DISPUTED' }), 'https://junify.live')!;
    expect(de.text).toContain('Automatisch – noch ohne Prüfung durch einen Menschen');
    expect(de.text).toContain('Von mehreren Nutzern widersprochen');
  });

  it('Sperre (mit allen Meldungen ausgeblendet) und Entsperren', () => {
    const ban = decisionMail('en', { action: 'USER_BAN', reason: 'ABUSE', automated: false, hideReports: true, objection: { kind: 'reply' } }, 'https://junify.live')!;
    expect(ban.subject).toBe('Your Catch account has been suspended');
    expect(ban.text).toContain('All your reports have been hidden as well.');
    expect(ban.text).toContain('Misuse of Catch');
    const unban = decisionMail('de', { action: 'USER_UNBAN', reason: 'REVIEWED', automated: false, objection: { kind: 'reply' } }, 'https://junify.live')!;
    expect(unban.subject).toBe('Dein Catch-Konto ist wieder aktiv');
    expect(unban.text).not.toContain('Widerspruch');
  });

  it('Drosselung: Limits, Ende, automatisch, eigener Grundtext', () => {
    const m = decisionMail(
      'de',
      { action: 'USER_THROTTLE', reason: 'DISPUTED', automated: true, until: '2026-11-14T13:05:00.000Z', limits: { perDay: 3, cooldownMinutes: 30, days: 7 }, objection: { kind: 'reply' } },
      'https://junify.live',
    )!;
    expect(m.subject).toBe('Melden bei Catch ist für dich 7 Tage eingeschränkt');
    expect(m.text).toContain('bis 14.11.2026, 14:05 Uhr');
    expect(m.text).toContain('höchstens 3 Meldungen pro Tag und eine alle 30 Minuten');
    expect(m.text).toContain('Vielen deiner letzten Meldungen wurde widersprochen');
  });

  it('Wiederherstellen verschickt keine Mail', () => {
    expect(decisionMail('en', base({ action: 'REPORT_UNHIDE', reason: 'REVIEWED' }), 'https://junify.live')).toBeNull();
  });

  it('Widerspruchsweg aus der Konfiguration', () => {
    const cfg = (env: Record<string, string>) => loadConfig({ AUTH_MODE: 'dev', ...env } as NodeJS.ProcessEnv);
    expect(objectionRoute(cfg({}))).toEqual({ kind: 'app' });
    expect(objectionRoute(cfg({ CONTACT_EMAIL: 'hallo@junify.live' }))).toEqual({ kind: 'email', address: 'hallo@junify.live' });
    expect(objectionRoute(cfg({ CONTACT_EMAIL: 'hallo@junify.live', MAIL_REPLY_TO: 'team@junify.live' }))).toEqual({ kind: 'reply' });
    expect(() => cfg({ MAIL_REPLY_TO: 'keine-adresse' })).toThrow(/MAIL_REPLY_TO/);
    expect(replyTo(cfg({ MAIL_REPLY_TO: 'team@junify.live' }), {})).toBe('team@junify.live');
    expect(replyTo(cfg({}), {})).toBe('');
  });

  it('Passwort-Mail: Fußzeile ohne "Antworten werden nicht gelesen", wenn MAIL_REPLY_TO gesetzt ist', () => {
    expect(passwordResetMail('en', 'a@b.de', 'https://x/r', 'https://junify.live').text).toContain('replies are not read');
    expect(passwordResetMail('en', 'a@b.de', 'https://x/r', 'https://junify.live', true).text).not.toContain('replies are not read');
  });

  it('htmlToText', () => expect(htmlToText('a<br>b &amp; <strong>c</strong> &lt;x&gt;')).toBe('a\nb & c <x>'));
});

describe('Antwort auf Feedback', () => {
  it('Mail zitiert das Feedback maskiert und behält Zeilenumbrüche', () => {
    const m = feedbackReplyMail(
      'en',
      { reply: 'Thanks!\nWe fixed it <b>today</b>.', original: `The app crashes ${evil}`, sentAt: '2026-11-05T09:00:00.000Z' },
      'https://junify.live',
      { kind: 'reply' },
    );
    expect(m.subject).toBe('Reply to your Catch feedback');
    expect(m.html).toContain('Thanks!<br>We fixed it &lt;b&gt;today&lt;/b&gt;.');
    expect(m.html).toContain('The app crashes &lt;script&gt;');
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<b>today');
    expect(m.text).toContain('> We fixed it <b>today</b>.');
    expect(m.text).toContain('Your message from 5 Nov 2026, 10:00:');
    expect(m.text).toContain('The Catch team');
    const de = feedbackReplyMail('de', { reply: 'Danke', original: 'Hallo', sentAt: new Date('2026-11-05T09:00:00Z') }, 'https://junify.live', { kind: 'app' });
    expect(de.subject).toBe('Antwort auf dein Catch-Feedback');
    expect(de.text).toContain('Dein Catch-Team');
    expect(de.text).toContain('Profil → Feedback senden');
  });

  it('Eingabe: 1–3000 Zeichen, Steuerzeichen raus', () => {
    expect(replyBody.safeParse({ message: '   ' }).success).toBe(false);
    expect(replyBody.safeParse({}).success).toBe(false);
    expect(replyBody.safeParse({ message: 'x'.repeat(3001) }).success).toBe(false);
    expect(replyBody.safeParse({ message: 'x'.repeat(3000) }).success).toBe(true);
    expect(replyBody.parse({ message: ' Hallo\u0000 Welt ' }).message).toBe('Hallo Welt');
  });
});
