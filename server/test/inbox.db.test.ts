// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Postfach (empfangene E-Mails) Ende-zu-Ende gegen eine echte PostgreSQL-Datenbank und einen
 * nachgebauten Resend-Server. Läuft nur mit TEST_INBOX_DATABASE_URL (eigene, leere Test-Datenbank –
 * sie wird geleert! Nicht dieselbe wie TEST_DATABASE_URL, weil beide Tests parallel laufen), z. B.:
 *   TEST_INBOX_DATABASE_URL=postgres://catch:catch@127.0.0.1:5433/catch_inbox npx vitest run test/inbox.db.test.ts
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { base32Decode, hotp } from '../src/admin/totp.js';
import { loadConfig } from '../src/config.js';
import type { Deps } from '../src/deps.js';
import { migrate } from '../src/db/migrate.js';
import { createPool, type Db } from '../src/db/pool.js';
import { signWebhook } from '../src/mail/inbound.js';
import { retryInboundContent } from '../src/services/inbox.js';

const URL = process.env.TEST_INBOX_DATABASE_URL;
const TOTP = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const SECRET = 'whsec_' + Buffer.from('inbox-db-test-secret-0123456').toString('base64');

describe.skipIf(!URL)('Postfach mit Datenbank', () => {
  let db: Db;
  let app: FastifyInstance;
  let deps: Deps;
  let resend: Server;
  let session = '';
  /** Nachgebauter Resend: empfangene Mails (id → Antwort oder HTTP-Status) und verschickte Mails */
  const received = new Map<string, unknown>();
  const sent: Array<{ auth: string | undefined; body: Record<string, unknown> }> = [];
  const fetched: Array<{ id: string; auth: string | undefined }> = [];
  let sendFails = false;

  const admin = () => ({ authorization: 'Bearer dev:admin', 'x-admin-session': session });
  let hookN = 0;
  const webhook = (payload: object, id = `msg_${++hookN}`) => {
    const body = JSON.stringify(payload);
    const ts = Math.floor(Date.now() / 1000);
    return app.inject({
      method: 'POST',
      url: '/v1/mail/inbound',
      payload: body,
      headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': signWebhook(SECRET, id, ts, body) },
    });
  };
  const received_ = (id: string, from = 'Anna Example <anna@example.com>', subject = 'Hallo') => ({
    type: 'email.received',
    created_at: new Date().toISOString(),
    data: { email_id: id, from, to: ['contact@junify.live'], subject, message_id: `<${id}@mail.example.com>` },
  });
  const until = async <T>(fn: () => Promise<T | null | undefined | false>, ms = 3000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error('Zeitüberschreitung');
      await new Promise((r) => setTimeout(r, 30));
    }
  };
  const row = async (id: string) =>
    (await db.query<{ content_status: string; status: string; user_id: string | null; fetch_error: string | null; body_text: string | null; fetch_attempts: number }>(
      'SELECT content_status, status, user_id, fetch_error, body_text, fetch_attempts FROM inbound_emails WHERE id = $1',
      [id],
    )).rows[0];

  beforeAll(async () => {
    resend = createServer((req, res) => {
      const auth = req.headers.authorization;
      const m = /^\/emails\/receiving\/([^/?]+)$/.exec(req.url ?? '');
      if (req.method === 'GET' && m) {
        const id = decodeURIComponent(m[1]);
        fetched.push({ id, auth });
        const v = received.get(id);
        if (typeof v === 'number' || v === undefined) {
          res.writeHead(typeof v === 'number' ? v : 404, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ name: 'not_found', message: 'nope' }));
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(v));
      }
      if (req.method === 'POST' && req.url === '/emails') {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => {
          sent.push({ auth, body: JSON.parse(data) });
          res.writeHead(sendFails ? 500 : 200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(sendFails ? { message: 'down' } : { id: `sent-${sent.length}` }));
        });
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => resend.listen(0, '127.0.0.1', r));
    const port = (resend.address() as AddressInfo).port;

    db = createPool(URL!);
    await migrate(db, () => undefined);
    const cfg = loadConfig({
      AUTH_MODE: 'dev',
      ADMIN_UIDS: 'dev-admin',
      ADMIN_TOTP_SECRET: TOTP,
      CATCH_PUBLIC_URL: 'https://junify.live',
      MAIL_REPLY_TO: 'contact@junify.live',
      RESEND_API_KEY: 're_sending',
      RESEND_INBOUND_API_KEY: 're_full',
      RESEND_API_URL: `http://127.0.0.1:${port}`,
      RESEND_WEBHOOK_SECRET: SECRET,
    } as NodeJS.ProcessEnv);
    const built = await buildApp({ cfg, db, logger: false });
    app = built.app;
    deps = built.deps;
    await app.ready();
    const code = hotp(base32Decode(TOTP), Math.floor(Date.now() / 30_000));
    const login = await app.inject({ method: 'POST', url: '/v1/admin/login', headers: { authorization: 'Bearer dev:admin' }, payload: { code } });
    expect(login.statusCode).toBe(200);
    session = login.json().session;
  });

  beforeEach(async () => {
    await db.query('TRUNCATE inbound_replies, inbound_emails, inbound_webhooks, admin_audit, moderation_decisions, feedback_replies, feedback RESTART IDENTITY CASCADE');
    await db.query(`DELETE FROM users WHERE id <> 'dev-admin'`);
    received.clear();
    sent.length = 0;
    fetched.length = 0;
    sendFails = false;
  });

  afterAll(async () => {
    await app?.close();
    await db?.end();
    await new Promise((r) => resend?.close(r));
  });

  it('Webhook → Inhalt abgerufen, Konto zugeordnet, Liste und Detail (nur Text, Anhänge nur Metadaten)', async () => {
    await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer dev:anna' } });
    await db.query(`UPDATE users SET email = 'Anna@Example.com', lang = 'de', display_name = 'Anna' WHERE id = 'dev-anna'`);
    await app.inject({ method: 'POST', url: '/v1/feedback', headers: { authorization: 'Bearer dev:anna' }, payload: { category: 'BUG', message: 'App stürzt ab' } });
    received.set('em-1', {
      object: 'email',
      id: 'em-1',
      from: 'Anna Example <anna@example.com>',
      to: ['contact@junify.live'],
      subject: 'AW: Deine Catch-Meldung wurde ausgeblendet',
      html: '<p>Warum <b>wurde</b> meine Meldung ausgeblendet?</p><script>alert(1)</script>',
      text: null,
      headers: { 'in-reply-to': '<orig-1@resend.dev>', references: '<orig-1@resend.dev>' },
      message_id: '<em-1@mail.example.com>',
      authentication: { spf: 'pass', dkim: 'pass', dmarc: 'fail' },
      attachments: [{ id: 'a1', filename: 'screenshot.png', content_type: 'image/png', size: 2048 }],
    });
    const res = await webhook(received_('em-1'));
    expect(res.statusCode).toBe(200);
    const r = await until(async () => {
      const x = await row('em-1');
      return x?.content_status === 'FETCHED' ? x : null;
    });
    expect(r).toMatchObject({ status: 'NEW', user_id: 'dev-anna', body_text: 'Warum wurde meine Meldung ausgeblendet?' });
    expect(fetched[0]).toEqual({ id: 'em-1', auth: 'Bearer re_full' }); // eigener Full-Access-Key

    const ov = (await app.inject({ method: 'GET', url: '/v1/admin/overview', headers: admin() })).json();
    expect(ov.inbox).toEqual({ new: 1, fetchFailed: 0, enabled: true });

    const list = (await app.inject({ method: 'GET', url: '/v1/admin/inbox?status=NEW', headers: admin() })).json();
    expect(list.enabled).toBe(true);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: 'em-1',
      status: 'NEW',
      from: { address: 'anna@example.com', name: 'Anna Example' },
      subject: 'AW: Deine Catch-Meldung wurde ausgeblendet',
      authWarnings: ['dmarc'],
      attachmentCount: 1,
      snippet: 'Warum wurde meine Meldung ausgeblendet?',
      user: { uid: 'dev-anna', name: 'Anna', banned: false },
    });
    expect((await app.inject({ method: 'GET', url: '/v1/admin/inbox?q=ausgeblendet', headers: admin() })).json().items).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/v1/admin/inbox?q=nichtda', headers: admin() })).json().items).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/v1/admin/inbox?status=&q=', headers: admin() })).statusCode).toBe(200);

    const d = (await app.inject({ method: 'GET', url: '/v1/admin/inbox/em-1', headers: admin() })).json();
    expect(d.mail).toMatchObject({ status: 'READ', textFromHtml: true, messageId: '<em-1@mail.example.com>', inReplyTo: '<orig-1@resend.dev>' });
    expect(d.mail.text).not.toContain('alert');
    expect(d.mail.attachments).toEqual([{ id: 'a1', filename: 'screenshot.png', contentType: 'image/png', size: 2048, inline: false }]);
    expect(d.mail.user).toMatchObject({ uid: 'dev-anna', email: 'Anna@Example.com', lang: 'de' });
    expect(d.feedback).toHaveLength(1);
    expect(d).toMatchObject({ replyLang: 'de', canReply: true, replyBlocked: null, replyTo: 'contact@junify.live' });
    expect((await app.inject({ method: 'GET', url: '/v1/admin/inbox?status=NEW', headers: admin() })).json().items).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/v1/admin/inbox/nope', headers: admin() })).statusCode).toBe(404);
    // Ohne Admin-Sitzung gibt es die Adressen nicht
    expect((await app.inject({ method: 'GET', url: '/v1/admin/inbox', headers: { authorization: 'Bearer dev:anna' } })).statusCode).toBe(404);
  });

  it('Doppelte Zustellung: gleiche Webhook-ID → erkannt; zweites Ereignis zur selben Mail → keine zweite Zeile', async () => {
    received.set('em-2', { id: 'em-2', from: 'b@example.com', subject: 'Hi', text: 'Hello' });
    expect((await webhook(received_('em-2', 'b@example.com'), 'msg_dup')).json()).toEqual({ ok: true });
    expect((await webhook(received_('em-2', 'b@example.com'), 'msg_dup')).json()).toEqual({ ok: true, duplicate: true });
    expect((await webhook({ ...received_('em-2', 'b@example.com'), type: 'inbox.email.received' }, 'msg_other')).json()).toEqual({ ok: true });
    await until(async () => (await row('em-2'))?.content_status === 'FETCHED');
    expect((await db.query('SELECT count(*)::int AS n FROM inbound_emails')).rows[0].n).toBe(1);
    expect((await db.query('SELECT count(*)::int AS n FROM inbound_webhooks')).rows[0].n).toBe(2);
    expect((await row('em-2')).user_id).toBeNull();
  });

  it('Abruf schlägt fehl → FETCH_FAILED (Metadaten bleiben), später erneut bzw. per Button', async () => {
    received.set('em-3', 500);
    await webhook(received_('em-3', 'Carl <carl@example.com>', 'Wichtig'));
    const failed = await until(async () => {
      const x = await row('em-3');
      return x?.content_status === 'FETCH_FAILED' ? x : null;
    });
    expect(failed.fetch_error).toMatch(/Resend antwortet 500/);
    const list = (await app.inject({ method: 'GET', url: '/v1/admin/inbox', headers: admin() })).json();
    expect(list.items[0]).toMatchObject({ contentStatus: 'FETCH_FAILED', subject: 'Wichtig', from: { address: 'carl@example.com', name: 'Carl' } });
    expect((await app.inject({ method: 'GET', url: '/v1/admin/overview', headers: admin() })).json().inbox.fetchFailed).toBe(1);

    // Zeitplan: erst nach Ablauf der Wartezeit erneut
    received.set('em-3', { id: 'em-3', from: 'Carl <carl@example.com>', subject: 'Wichtig', text: 'Jetzt da' });
    expect(await retryInboundContent(deps)).toBe(0);
    await db.query(`UPDATE inbound_emails SET last_fetch_at = now() - interval '1 hour' WHERE id = 'em-3'`);
    expect(await retryInboundContent(deps)).toBe(1);
    expect((await row('em-3')).content_status).toBe('FETCHED');

    // Button "erneut abrufen" (auch bei Fehler; ein schon abgerufener Inhalt bleibt erhalten)
    received.set('em-3', 401);
    const re = await app.inject({ method: 'POST', url: '/v1/admin/inbox/em-3/refetch', headers: admin() });
    expect(re.json()).toMatchObject({ result: 'FETCH_FAILED', contentStatus: 'FETCHED' });
    received.set('em-3', { id: 'em-3', from: 'carl@example.com', subject: 'Wichtig', text: 'Neu geladen' });
    const ok = await app.inject({ method: 'POST', url: '/v1/admin/inbox/em-3/refetch', headers: admin() });
    expect(ok.json()).toMatchObject({ result: 'FETCHED', contentStatus: 'FETCHED' });
    expect((await row('em-3')).body_text).toBe('Neu geladen');
    const audit = await db.query(`SELECT action FROM admin_audit WHERE action = 'inbox_refetch'`);
    expect(audit.rowCount).toBe(2);
  });

  it('Antwort: an den Absender, Re-Betreff, In-Reply-To/References, reply_to, Catch-Layout; gespeichert, erledigt', async () => {
    received.set('em-4', {
      id: 'em-4',
      from: 'Dora <dora@example.com>',
      subject: 'Question about my account',
      text: 'Hello, why was my report hidden? <script>x</script>\n\nOn Mon, 3 Nov 2026 Catch <noreply@junify.live> wrote:\n> old',
      headers: { references: '<a@x> <b@x>', 'in-reply-to': '<b@x>' },
      message_id: '<em-4@mail.example.com>',
    });
    await webhook(received_('em-4', 'dora@example.com', 'Question about my account'));
    await until(async () => (await row('em-4'))?.content_status === 'FETCHED');
    const reply = (message: unknown, lang?: string) =>
      app.inject({ method: 'POST', url: '/v1/admin/inbox/em-4/reply', headers: admin(), payload: { message, ...(lang ? { lang } : {}) } });

    expect((await reply('   ')).statusCode).toBe(400);
    expect((await reply('x'.repeat(5001))).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/admin/inbox/nope/reply', headers: admin(), payload: { message: 'Hi' } })).statusCode).toBe(404);

    const res = await reply('Hi Dora,\nwe checked it <b>again</b>.');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ subject: 'Re: Question about my account', reply: { mailStatus: 'SENT', lang: 'en' } });
    expect(sent).toHaveLength(1);
    const m = sent[0];
    expect(m.auth).toBe('Bearer re_sending'); // Versand mit dem Versand-Key
    expect(m.body).toMatchObject({
      from: 'Catch <noreply@junify.live>',
      to: ['dora@example.com'],
      reply_to: 'contact@junify.live',
      subject: 'Re: Question about my account',
      headers: { 'In-Reply-To': '<em-4@mail.example.com>', References: '<a@x> <b@x> <em-4@mail.example.com>' },
    });
    expect(String(m.body.html)).toContain('we checked it &lt;b&gt;again&lt;/b&gt;.');
    expect(String(m.body.html)).toContain('Hello, why was my report hidden? &lt;script&gt;x&lt;/script&gt;');
    expect(String(m.body.html)).not.toContain('<script>');
    expect(String(m.body.html)).not.toContain('&gt; old');
    expect(String(m.body.text)).toContain('The Catch team');

    const d = (await app.inject({ method: 'GET', url: '/v1/admin/inbox/em-4', headers: admin() })).json();
    expect(d.mail.status).toBe('DONE');
    expect(d.mail.replies).toMatchObject([{ message: 'Hi Dora,\nwe checked it <b>again</b>.', mailStatus: 'SENT', by: 'dev-admin' }]);
    expect(d.replyLang).toBe('en');

    // Sprache gewählt; Versand schlägt fehl → 502, Versuch gespeichert (FAILED), Status bleibt
    await app.inject({ method: 'PATCH', url: '/v1/admin/inbox/em-4', headers: admin(), payload: { status: 'READ' } });
    sendFails = true;
    const bad = await reply('Nochmal', 'de');
    expect(bad.statusCode).toBe(502);
    expect(sent.at(-1)!.body.subject).toBe('Re: Question about my account');
    const after = (await app.inject({ method: 'GET', url: '/v1/admin/inbox/em-4', headers: admin() })).json();
    expect(after.mail.status).toBe('READ');
    expect(after.mail.replies.map((x: { mailStatus: string }) => x.mailStatus)).toEqual(['SENT', 'FAILED']);
    const actions = (await db.query<{ action: string }>('SELECT action FROM admin_audit ORDER BY id')).rows.map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['inbox_reply', 'inbox_status', 'mail_failed']));
  });

  it('Status (Spam, erledigt), Filter, Löschen, Protokoll', async () => {
    received.set('em-5', { id: 'em-5', from: 'spam@example.com', subject: 'WIN', text: 'Buy now' });
    await webhook(received_('em-5', 'spam@example.com', 'WIN'));
    await until(async () => (await row('em-5'))?.content_status === 'FETCHED');
    const patch = (status: string) => app.inject({ method: 'PATCH', url: '/v1/admin/inbox/em-5', headers: admin(), payload: { status } });
    expect((await patch('SPAM')).statusCode).toBe(204);
    expect((await patch('NOPE')).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/v1/admin/inbox?status=SPAM', headers: admin() })).json().items).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/v1/admin/inbox?status=DONE', headers: admin() })).json().items).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/v1/admin/inbox?status=ALL', headers: admin() })).json().items).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: '/v1/admin/inbox/em-5', headers: admin() })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: '/v1/admin/inbox/em-5', headers: admin() })).statusCode).toBe(404);
    const actions = (await db.query<{ action: string; detail: { status?: string } | null }>('SELECT action, detail FROM admin_audit ORDER BY id')).rows;
    expect(actions).toEqual([
      { action: 'inbox_status', detail: { status: 'SPAM' } },
      { action: 'inbox_delete', detail: null },
    ]);
  });

  it('Aufbewahrung: Mails samt Antworten nach 365 Tagen, Webhook-IDs nach 30 Tagen', async () => {
    received.set('em-6', { id: 'em-6', from: 'old@example.com', text: 'alt' });
    await webhook(received_('em-6', 'old@example.com'));
    await until(async () => (await row('em-6'))?.content_status === 'FETCHED');
    await app.inject({ method: 'POST', url: '/v1/admin/inbox/em-6/reply', headers: admin(), payload: { message: 'ok' } });
    await db.query(`UPDATE inbound_emails SET received_at = now() - interval '366 days'`);
    await db.query(`UPDATE inbound_webhooks SET received_at = now() - interval '31 days'`);
    // gleiche Abfragen wie im Aufräum-Job (index.ts)
    await db.query(`DELETE FROM inbound_emails WHERE received_at < now() - make_interval(days => $1)`, [365]);
    await db.query(`DELETE FROM inbound_webhooks WHERE received_at < now() - interval '30 days'`);
    for (const t of ['inbound_emails', 'inbound_replies', 'inbound_webhooks']) {
      expect((await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n).toBe(0);
    }
  });
});
