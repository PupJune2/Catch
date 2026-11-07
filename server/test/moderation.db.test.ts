// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Ende-zu-Ende gegen eine echte PostgreSQL-Datenbank (Moderation, Vertrauen, Drosselung, Antworten).
 * Läuft nur mit TEST_DATABASE_URL (eigene, leere Test-Datenbank – sie wird geleert!), z. B.:
 *   TEST_DATABASE_URL=postgres://catch:catch@127.0.0.1:5433/catch_mod npx vitest run test/moderation.db.test.ts
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { base32Decode, hotp } from '../src/admin/totp.js';
import { loadConfig } from '../src/config.js';
import type { Report, TrackingAlert } from '../src/contract.js';
import type { Deps } from '../src/deps.js';
import { migrate } from '../src/db/migrate.js';
import { createPool, type Db } from '../src/db/pool.js';
import type { MailMessage } from '../src/mail/resend.js';

const URL = process.env.TEST_DATABASE_URL;
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe.skipIf(!URL)('Moderation mit Datenbank', () => {
  let db: Db;
  let app: FastifyInstance;
  let deps: Deps;
  let session = '';
  const mails: MailMessage[] = [];
  const pushes: Array<{ uid: string; alert: TrackingAlert }> = [];
  const goodMail = async (m: MailMessage) => void mails.push(m);

  const as = (name: string) => ({ authorization: `Bearer dev:${name}` });
  // Eigene IP je Nutzer und Test-Lauf, damit die Rate-Limits pro IP nicht greifen
  let ipBase = 0;
  const ips = new Map<string, string>();
  const ip = (name: string) => {
    if (!ips.has(name)) ips.set(name, `10.${(ipBase >> 8) & 255}.${ipBase & 255}.${ips.size + 1}`);
    return ips.get(name)!;
  };
  const admin = () => ({ ...as('admin'), 'x-admin-session': session });
  const line = { name: '5', mode: 'BUS' as const, operator: 'Test' };
  let stopN = 0;
  const report = async (name: string, kind = 'CHECK') => {
    stopN++;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      remoteAddress: ip(name),
      headers: as(name),
      payload: { kind, line, prevStop: { id: `s${stopN}`, name: `Halt <b>${stopN}</b>` }, nextStop: { id: `t${stopN}`, name: 'Ziel & Co' } },
    });
    return res;
  };
  const vote = (name: string, id: string, value: 1 | -1) =>
    app.inject({ method: 'POST', url: `/v1/reports/${id}/vote`, remoteAddress: ip(name), headers: as(name), payload: { value } });
  const until = async <T>(fn: () => Promise<T | null | undefined | false>, ms = 3000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error('Zeitüberschreitung');
      await new Promise((r) => setTimeout(r, 30));
    }
  };
  const decisions = async (uid: string) =>
    (await db.query<{ action: string; reason: string; automated: boolean; mail_status: string; note: string | null }>(
      'SELECT action, reason, automated, mail_status, note FROM moderation_decisions WHERE user_id = $1 ORDER BY id',
      [uid],
    )).rows;

  beforeAll(async () => {
    db = createPool(URL!);
    await migrate(db, () => undefined);
    const cfg = loadConfig({
      AUTH_MODE: 'dev',
      ADMIN_UIDS: 'dev-admin',
      ADMIN_TOTP_SECRET: SECRET,
      CATCH_PUBLIC_URL: 'https://junify.live',
      MAIL_REPLY_TO: 'team@junify.live',
      REPORT_COOLDOWN_MINUTES: '0',
    } as NodeJS.ProcessEnv);
    const built = await buildApp({
      cfg,
      db,
      logger: false,
      push: { sendAlert: async (_db, uid, alert) => void pushes.push({ uid, alert }) },
    });
    app = built.app;
    deps = built.deps;
    deps.mail = goodMail;
    await app.ready();
    const code = hotp(base32Decode(SECRET), Math.floor(Date.now() / 30_000));
    const login = await app.inject({ method: 'POST', url: '/v1/admin/login', headers: as('admin'), payload: { code } });
    expect(login.statusCode).toBe(200);
    session = login.json().session;
  });

  beforeEach(async () => {
    await db.query(`TRUNCATE moderation_decisions, feedback_replies, feedback, report_flags, report_votes, tracking_alerts,
      trackings, reports, devices, admin_audit RESTART IDENTITY CASCADE`);
    await db.query(`DELETE FROM users WHERE id <> 'dev-admin'`);
    mails.length = 0;
    pushes.length = 0;
    ipBase++;
    ips.clear();
    deps.mail = goodMail;
  });

  afterAll(async () => {
    await app?.close();
    await db?.end();
  });

  const user = async (name: string, email: string | null, lang = 'en') => {
    await app.inject({ method: 'GET', url: '/v1/me', headers: as(name) });
    await db.query('UPDATE users SET email = $2, lang = $3 WHERE id = $1', [`dev-${name}`, email, lang]);
    return `dev-${name}`;
  };

  it('3 Markierungen: automatisch ausgeblendet, automatische Entscheidung, Mail in der Sprache des Meldenden', async () => {
    const anna = await user('anna', 'anna@example.com', 'de');
    for (const n of ['b1', 'b2', 'b3']) await user(n, null);
    const r: Report = (await report('anna')).json();
    expect(r.reporterTrust).toBe(0); // neu
    for (const n of ['b1', 'b2', 'b3']) {
      const f = await app.inject({ method: 'POST', url: `/v1/reports/${r.id}/flag`, remoteAddress: ip(n), headers: as(n), payload: { reason: 'WRONG' } });
      expect(f.statusCode).toBe(204);
    }
    const d = await until(async () => (await decisions(anna)).find((x) => x.mail_status === 'SENT'));
    expect(d).toMatchObject({ action: 'REPORT_HIDE', reason: 'FLAGGED', automated: true });
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe('anna@example.com');
    expect(mails[0].subject).toBe('Deine Catch-Meldung wurde ausgeblendet');
    expect(mails[0].html).toContain('Halt &lt;b&gt;');
    expect(mails[0].text).toContain('Antworte einfach auf diese E-Mail');
    const audit = await db.query(`SELECT action FROM admin_audit WHERE action = 'auto_report_hide'`);
    expect(audit.rowCount).toBe(1);
    // Ausgeblendet: Abstimmen geht nicht mehr
    expect((await vote('b1', r.id, 1)).statusCode).toBe(404);
  });

  it('Admin blendet mit Grund + Notiz aus; Mail-Fehler blockiert nicht; ohne E-Mail nur Protokoll', async () => {
    const anna = await user('anna', 'anna@example.com');
    const r1: Report = (await report('anna')).json();
    const res = await app.inject({ method: 'POST', url: `/v1/admin/reports/${r1.id}/hide`, headers: admin(), payload: { reason: 'SPAM', note: 'Same <i>report</i> 5 times' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toMatchObject({ action: 'REPORT_HIDE', reason: 'SPAM', automated: false, mailStatus: 'SENT', note: 'Same <i>report</i> 5 times' });
    expect(mails[0].text).toContain('Spam or duplicate reports');
    expect(mails[0].html).toContain('Same &lt;i&gt;report&lt;/i&gt; 5 times');

    deps.mail = async () => {
      throw new Error('Resend antwortet 500');
    };
    const r2: Report = (await report('anna')).json();
    const del = await app.inject({ method: 'DELETE', url: `/v1/admin/reports/${r2.id}?reason=WRONG`, headers: admin() });
    expect(del.statusCode).toBe(200);
    expect(del.json().decision).toMatchObject({ action: 'REPORT_DELETE', mailStatus: 'FAILED' });
    expect((await db.query(`SELECT 1 FROM admin_audit WHERE action = 'mail_failed'`)).rowCount).toBe(1);
    expect((await db.query('SELECT 1 FROM reports WHERE id = $1', [r2.id])).rowCount).toBe(0);

    deps.mail = goodMail;
    const bob = await user('bob', null);
    const r3: Report = (await report('bob')).json();
    const h3 = await app.inject({ method: 'POST', url: `/v1/admin/reports/${r3.id}/hide`, headers: admin(), payload: { reason: 'WRONG' } });
    expect(h3.json().decision.mailStatus).toBe('NO_EMAIL');

    // Resend nicht eingerichtet
    deps.mail = undefined;
    const r4: Report = (await report('anna')).json();
    const h4 = await app.inject({ method: 'POST', url: `/v1/admin/reports/${r4.id}/hide`, headers: admin(), payload: { reason: 'WRONG' } });
    expect(h4.json().decision.mailStatus).toBe('NOT_CONFIGURED');

    // Ungültiger Grund / zu lange Notiz
    expect((await app.inject({ method: 'POST', url: `/v1/admin/reports/${r4.id}/hide`, headers: admin(), payload: { reason: 'NOPE' } })).statusCode).toBe(400);
    const detail = await app.inject({ method: 'GET', url: `/v1/admin/users/${anna}`, headers: admin() });
    const acts = detail.json().decisions.map((d: { action: string }) => d.action).filter((a: string) => a.startsWith('REPORT_'));
    expect(acts).toEqual(['REPORT_HIDE', 'REPORT_DELETE', 'REPORT_HIDE']);
    expect(detail.json().trust.inputs.hidden).toBe(3); // 2 ausgeblendet + 1 gelöscht
    expect(bob).toBe('dev-bob');
  });

  it('höchstens 5 Begründungs-Mails pro Tag; Sperren/Entsperren immer', async () => {
    const anna = await user('anna', 'anna@example.com');
    await db.query(`UPDATE users SET created_at = now() - interval '200 days' WHERE id = $1`, [anna]);
    for (let i = 0; i < 6; i++) {
      const r: Report = (await report('anna')).json();
      // nicht drosseln lassen: Admin-Prüfung verhindert neue Drosselung in diesem Test
      await db.query(`UPDATE users SET restriction_lifted_at = now(), restricted_until = NULL WHERE id = $1`, [anna]);
      await app.inject({ method: 'POST', url: `/v1/admin/reports/${r.id}/hide`, headers: admin(), payload: { reason: 'WRONG' } });
    }
    const st = (await decisions(anna)).filter((d) => d.action === 'REPORT_HIDE').map((d) => d.mail_status);
    expect(st.filter((s) => s === 'SENT')).toHaveLength(5);
    expect(st[5]).toBe('RATE_LIMITED');
    const ban = await app.inject({ method: 'POST', url: `/v1/admin/users/${anna}/ban`, headers: admin(), payload: { reason: 'REPEATED_FALSE_REPORTS', hideReports: true } });
    expect(ban.json().decision.mailStatus).toBe('SENT');
    expect(mails.at(-1)!.subject).toBe('Your Catch account has been suspended');
    expect(mails.at(-1)!.text).toContain('All your reports have been hidden as well.');
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: as('anna') })).statusCode).toBe(403);
    const unban = await app.inject({ method: 'POST', url: `/v1/admin/users/${anna}/unban`, headers: admin() });
    expect(unban.json().decision).toMatchObject({ action: 'USER_UNBAN', mailStatus: 'SENT' });
    expect(mails.at(-1)!.subject).toBe('Your Catch account is active again');
    // nochmal entsperren: keine zweite Entscheidung, keine zweite Mail
    const n = mails.length;
    expect((await app.inject({ method: 'POST', url: `/v1/admin/users/${anna}/unban`, headers: admin() })).json().decision).toBeNull();
    expect(mails).toHaveLength(n);
  });

  it('Drosselung nach 3 ausgeblendeten Meldungen: strengere Limits, Mail, Admin hebt auf', async () => {
    const anna = await user('anna', 'anna@example.com');
    await user('x', null);
    for (let i = 0; i < 3; i++) {
      const r: Report = (await report('anna')).json();
      await db.query('UPDATE reports SET hidden = true WHERE id = $1', [r.id]);
    }
    // nächste Meldung: Drosselung greift (in den letzten 30 Min. wurde schon gemeldet)
    const blocked = await app.inject({
      method: 'POST', url: '/v1/reports', remoteAddress: ip('anna'), headers: { ...as('anna'), 'accept-language': 'de' },
      payload: { kind: 'DELAY', line, nextStop: { id: 'z1', name: 'Z' } },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toBe('throttled');
    expect(blocked.json().message).toContain('höchstens 3 Meldungen pro Tag und eine alle 30 Minuten');
    const d = await until(async () => (await decisions(anna)).find((x) => x.action === 'USER_THROTTLE' && x.mail_status !== 'PENDING'));
    expect(d).toMatchObject({ reason: 'DISPUTED', automated: true, mail_status: 'SENT' });
    expect(mails.at(-1)!.subject).toBe('Melden bei Catch ist für dich 7 Tage eingeschränkt'); // Sprache der letzten Anfrage
    const me = (await app.inject({ method: 'GET', url: '/v1/me', headers: as('anna') })).json();
    expect(me.restrictedUntil).toBeTruthy();
    expect(me.alertsNeedConfirmation).toBe(true); // 3 ausgeblendet = −15
    const list = (await app.inject({ method: 'GET', url: '/v1/admin/users?filter=restricted', headers: admin() })).json();
    expect(list.items.map((u: { uid: string }) => u.uid)).toEqual([anna]);

    const lift = await app.inject({ method: 'POST', url: `/v1/admin/users/${anna}/unrestrict`, headers: admin() });
    expect(lift.json().decision).toMatchObject({ action: 'USER_UNTHROTTLE', mailStatus: 'SENT' });
    // nach dem Aufheben zählen alte Meldungen nicht erneut → normales Melden geht wieder
    expect((await report('anna')).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: `/v1/admin/users/${anna}/unrestrict`, headers: admin() })).json().decision).toBeNull();
  });

  it('negatives Vertrauen: Alarme erst nach der ersten Bestätigung, nicht in der Linien-Lage', async () => {
    const anna = await user('anna', null);
    const tim = await user('tim', null);
    await user('vera', null);
    // Anna hat eine ausgeblendete Meldung mit 3 Markierungen → deutlich negativ
    const old: Report = (await report('anna')).json();
    await db.query('UPDATE reports SET hidden = true, flags = 3 WHERE id = $1', [old.id]);
    const now = new Date();
    const tr = await app.inject({
      method: 'POST', url: '/v1/trackings', headers: as('tim'),
      payload: { line, startsAt: new Date(now.getTime() - 60_000).toISOString(), endsAt: new Date(now.getTime() + 3600_000).toISOString() },
    });
    expect(tr.statusCode).toBe(201);
    const r: Report = (await report('anna')).json();
    expect(r.reporterTrust).toBe(0);
    await new Promise((res) => setTimeout(res, 150));
    expect(pushes).toHaveLength(0);
    const held = await db.query('SELECT alerts_held FROM reports WHERE id = $1', [r.id]);
    expect(held.rows[0].alerts_held).toBe(true);
    const lineKey = r.lineKey;
    const sum = (await app.inject({ method: 'GET', url: `/v1/lines/${encodeURIComponent(lineKey)}/stats?days=1` })).json();
    expect(sum.total).toBe(0);
    // Bestätigung durch Vera → Alarm an Tim
    expect((await vote('vera', r.id, 1)).statusCode).toBe(200);
    await until(async () => pushes.length > 0);
    expect(pushes[0].uid).toBe(tim);
    expect(pushes[0].alert.report.id).toBe(r.id);
    expect(anna).toBe('dev-anna');
  });

  it('Widersprüche: halbe Stimme bei negativem Vertrauen, Admin-Prüfung schützt vor erneutem Ausblenden', async () => {
    const anna = await user('anna', 'anna@example.com');
    for (const n of ['n1', 'n2', 'n3', 'n4']) await user(n, null);
    const r: Report = (await report('anna')).json();
    for (const n of ['n1', 'n2']) await vote(n, r.id, -1);
    // n3 ist deutlich negativ → zählt halb: 2,5 < 3 → noch sichtbar
    await db.query(`UPDATE users SET created_at = now() WHERE id = 'dev-n3'`);
    const n3old: Report = (await report('n3')).json();
    await db.query('UPDATE reports SET hidden = true WHERE id = $1', [n3old.id]);
    await vote('n3', r.id, -1);
    expect((await db.query('SELECT hidden FROM reports WHERE id = $1', [r.id])).rows[0].hidden).toBe(false);
    await vote('n4', r.id, -1);
    expect((await db.query('SELECT hidden FROM reports WHERE id = $1', [r.id])).rows[0].hidden).toBe(true);
    const d = await until(async () => (await decisions(anna)).find((x) => x.reason === 'DISPUTED' && x.mail_status === 'SENT'));
    expect(d.action).toBe('REPORT_HIDE');
    // Admin stellt wieder her → weitere Widersprüche blenden nicht mehr automatisch aus
    const un = await app.inject({ method: 'POST', url: `/v1/admin/reports/${r.id}/unhide`, headers: admin() });
    expect(un.json().decision).toMatchObject({ action: 'REPORT_UNHIDE', mailStatus: 'NOT_NEEDED' });
    await user('n5', null);
    await vote('n5', r.id, -1);
    expect((await db.query('SELECT hidden FROM reports WHERE id = $1', [r.id])).rows[0].hidden).toBe(false);
  });

  it('Antwort auf Feedback: nur mit Zustimmung, gestaltete Mail, gespeichert, erledigt', async () => {
    await user('fritz', 'fritz@example.com', 'de');
    const send = (headers: Record<string, string>, payload: object) => app.inject({ method: 'POST', url: '/v1/feedback', headers: { ...headers, 'accept-language': 'de' }, payload });
    const ok = (await send(as('fritz'), { category: 'BUG', message: 'Absturz <img src=x onerror=alert(1)>', allowContact: true })).json().id;
    const noContact = (await send(as('fritz'), { category: 'IDEA', message: 'Dark mode bitte' })).json().id;
    const anon = (await send({}, { category: 'IDEA', message: 'Anonym hier' })).json().id;

    const reply = (id: string, message: unknown) => app.inject({ method: 'POST', url: `/v1/admin/feedback/${id}/reply`, headers: admin(), payload: { message } });
    expect((await reply('999999', 'Hi')).statusCode).toBe(404);
    expect((await reply(noContact, 'Hi')).json().error).toBe('no_contact');
    expect((await reply(anon, 'Hi')).statusCode).toBe(400);
    expect((await reply(ok, '   ')).statusCode).toBe(400);
    expect((await reply(ok, 'x'.repeat(3001))).statusCode).toBe(400);
    deps.mail = undefined;
    expect((await reply(ok, 'Hi')).statusCode).toBe(503);
    deps.mail = async () => {
      throw new Error('down');
    };
    expect((await reply(ok, 'Hi')).statusCode).toBe(502);
    deps.mail = goodMail;

    const res = await reply(ok, 'Danke! Ist mit Version 0.2 behoben.\nViele Grüße');
    expect(res.statusCode).toBe(200);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: 'fritz@example.com', subject: 'Antwort auf dein Catch-Feedback' });
    expect(mails[0].html).toContain('Absturz &lt;img src=x onerror=alert(1)&gt;');
    expect(mails[0].html).not.toContain('<img src=x');
    const list = (await app.inject({ method: 'GET', url: '/v1/admin/feedback', headers: admin() })).json();
    const f = list.items.find((x: { id: string }) => x.id === ok);
    expect(f.status).toBe('DONE');
    expect(f.canReply).toBe(true);
    expect(f.replies).toHaveLength(1);
    expect(f.replies[0].message).toContain('Version 0.2');
    expect(list.items.find((x: { id: string }) => x.id === noContact).canReply).toBe(false);
    const audit = (await app.inject({ method: 'GET', url: '/v1/admin/audit', headers: admin() })).json();
    expect(audit.items.map((a: { action: string }) => a.action)).toContain('feedback_reply');
  });
});
