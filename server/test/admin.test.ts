// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { describe, expect, it } from 'vitest';
import { base32Decode, hotp, verifyTotp } from '../src/admin/totp.js';
import { AdminSessions, ipAllowed, LoginThrottle } from '../src/admin/guard.js';
import { escapeHtml, passwordResetMail } from '../src/mail/templates.js';
import { createPasswordReset } from '../src/mail/passwordReset.js';
import { cleanText } from '../src/routes/account.js';
import { loadConfig } from '../src/config.js';

// RFC 6238, Anhang B: Schlüssel "12345678901234567890" (Base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ)
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP', () => {
  it('dekodiert Base32', () => expect(base32Decode(RFC_SECRET).toString()).toBe('12345678901234567890'));
  it('entspricht den RFC-6238-Testwerten (6 Ziffern)', () => {
    const key = base32Decode(RFC_SECRET);
    expect(hotp(key, Math.floor(59 / 30))).toBe('287082');
    expect(hotp(key, Math.floor(1111111109 / 30))).toBe('081804');
    expect(hotp(key, Math.floor(2000000000 / 30))).toBe('279037');
  });
  it('akzeptiert ±1 Zeitschritt, sonst nicht', () => {
    const t = 1111111109_000;
    expect(verifyTotp(RFC_SECRET, '081804', t)).toBe(Math.floor(1111111109 / 30));
    expect(verifyTotp(RFC_SECRET, '081804', t + 30_000)).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, '081804', t + 90_000)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '000000', t)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abc', t)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '081 804', t)).not.toBeNull();
  });
});

describe('Admin-Schutz', () => {
  it('IP-Freigabe: exakt, CIDR, leer = alle', () => {
    expect(ipAllowed('1.2.3.4', [])).toBe(true);
    expect(ipAllowed('1.2.3.4', ['1.2.3.4'])).toBe(true);
    expect(ipAllowed('::ffff:1.2.3.4', ['1.2.3.0/24'])).toBe(true);
    expect(ipAllowed('1.2.4.4', ['1.2.3.0/24'])).toBe(false);
    expect(ipAllowed('2001:db8::1', ['2001:db8::1'])).toBe(true);
    expect(ipAllowed('2001:db8::2', ['2001:db8::1', '10.0.0.0/8'])).toBe(false);
  });

  it('Sitzung: nur für denselben Nutzer, läuft ohne Aktivität ab, Abmelden wirkt', () => {
    let now = 0;
    const s = new AdminSessions(30 * 60_000, 8 * 3600_000, () => now);
    const { token } = s.create('admin');
    expect(s.touch(token, 'admin')).not.toBeNull();
    expect(s.touch(token, 'other')).toBeNull();
    expect(s.touch('falsch', 'admin')).toBeNull();
    now += 29 * 60_000;
    expect(s.touch(token, 'admin')).not.toBeNull(); // verlängert
    now += 29 * 60_000;
    expect(s.touch(token, 'admin')).not.toBeNull();
    now += 31 * 60_000;
    expect(s.touch(token, 'admin')).toBeNull();
    const second = s.create('admin').token;
    s.revoke(second);
    expect(s.touch(second, 'admin')).toBeNull();
  });

  it('Sitzung endet spätestens nach der Höchstdauer', () => {
    let now = 0;
    const s = new AdminSessions(30 * 60_000, 60 * 60_000, () => now);
    const { token } = s.create('a');
    for (let i = 0; i < 3; i++) {
      now += 20 * 60_000;
      s.touch(token, 'a');
    }
    expect(s.touch(token, 'a')).toBeNull();
  });

  it('Sperre nach 5 Fehlversuchen, Code nur einmal gültig', () => {
    let now = 0;
    const th = new LoginThrottle(5, 15 * 60_000, 15 * 60_000, () => now);
    for (let i = 0; i < 4; i++) th.fail();
    expect(th.lockedFor()).toBe(0);
    th.fail();
    expect(th.lockedFor()).toBe(15 * 60_000);
    now += 15 * 60_000;
    expect(th.lockedFor()).toBe(0);
    expect(th.accept('a', 100)).toBe(true);
    expect(th.accept('a', 100)).toBe(false);
    expect(th.accept('a', 99)).toBe(false);
    expect(th.accept('a', 101)).toBe(true);
  });

  it('Konfiguration prüft das TOTP-Geheimnis', () => {
    expect(() => loadConfig({ AUTH_MODE: 'dev', ADMIN_TOTP_SECRET: 'kein-base32!' } as NodeJS.ProcessEnv)).toThrow(/Base32/);
    expect(loadConfig({ AUTH_MODE: 'dev', ADMIN_TOTP_SECRET: RFC_SECRET } as NodeJS.ProcessEnv).ADMIN_TOTP_SECRET).toBe(RFC_SECRET);
  });
});

describe('Feedback-Text', () => {
  it('entfernt Steuerzeichen und viele Leerzeilen', () => {
    expect(cleanText('  Hallo\u0000 Welt\r\n\r\n\r\n\r\nTschüss‮ ')).toBe('Hallo Welt\n\nTschüss');
  });
});

describe('Passwort-Mail', () => {
  const cfg = loadConfig({ AUTH_MODE: 'dev', RESEND_API_KEY: 're_test', CATCH_PUBLIC_URL: 'https://junify.live' } as NodeJS.ProcessEnv);
  const log = { error: () => undefined } as never;

  it('escaped HTML', () => expect(escapeHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;'));

  it('baut die Mail mit eigenem Link (EN/DE)', () => {
    const en = passwordResetMail('en', 'a<b>@x.de', 'https://junify.live/reset-password?oobCode=ABC&lang=en', 'https://junify.live');
    expect(en.subject).toBe('Reset your Catch password');
    expect(en.html).toContain('href="https://junify.live/reset-password?oobCode=ABC&amp;lang=en"');
    expect(en.html).toContain('a&lt;b&gt;@x.de');
    expect(en.html).not.toContain('a<b>@x.de');
    expect(en.text).toContain('Choose new password: https://junify.live/reset-password?oobCode=ABC&lang=en');
    const de = passwordResetMail('de', 'x@y.de', 'https://junify.live/r', 'https://junify.live');
    expect(de.subject).toBe('Dein Catch-Passwort zurücksetzen');
    expect(de.html).toContain('lang="de"');
  });

  it('sendet nur mit Konto, verrät nichts, begrenzt pro Adresse', async () => {
    const sent: Array<{ to: string; text: string }> = [];
    const reset = createPasswordReset(cfg, log, {
      generateLink: async (email) =>
        email === 'da@x.de' ? 'https://your-firebase-project.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=CODE123&apiKey=k&lang=en' : null,
      send: async (m) => void sent.push(m),
    });
    await reset.request('nicht@x.de', 'en');
    expect(sent).toHaveLength(0);
    await reset.request(' DA@x.de ', 'de');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('da@x.de');
    expect(sent[0].text).toContain('https://junify.live/reset-password?oobCode=CODE123&lang=de');
    await reset.request('da@x.de', 'de');
    await reset.request('da@x.de', 'de');
    await reset.request('da@x.de', 'de');
    expect(sent).toHaveLength(3);
  });

  it('ohne Resend-Key: 503 mail_not_configured', async () => {
    const off = createPasswordReset(loadConfig({ AUTH_MODE: 'dev' } as NodeJS.ProcessEnv), log, { generateLink: async () => null, send: async () => undefined });
    await expect(off.request('a@b.de', 'en')).rejects.toMatchObject({ status: 503, code: 'mail_not_configured' });
  });
});
