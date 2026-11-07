// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db/pool.js';
import {
  authWarnings,
  detectLang,
  htmlToPlainText,
  isAutoReply,
  normalizeMessageId,
  parseAddress,
  parseReceivedEmail,
  replySubject,
  signWebhook,
  threadHeaders,
  trimQuoted,
  verifyWebhook,
  webhookKey,
  MAIL_TEXT_MAX,
} from '../src/mail/inbound.js';
import { greetingName, inboxReplyMail } from '../src/mail/moderation.js';
import { createResendSender } from '../src/mail/resend.js';
import { parseInboundEvent } from '../src/services/inbox.js';

const SECRET = 'whsec_' + Buffer.from('catch-test-secret-0123456789').toString('base64');
const OTHER = 'whsec_' + Buffer.from('another-secret-0123456789abc').toString('base64');
const now = Date.UTC(2026, 10, 7, 12, 0, 0);
const ts = String(Math.floor(now / 1000));

describe('Webhook-Signatur (Svix)', () => {
  const body = JSON.stringify({ type: 'email.received', data: { email_id: 'abc' } });
  const sig = signWebhook(SECRET, 'msg_1', ts, body);

  it('gültige Signatur', () => {
    expect(verifyWebhook(SECRET, { id: 'msg_1', timestamp: ts, signature: sig }, body, now)).toEqual({ ok: true, id: 'msg_1', timestamp: Number(ts) });
    // als Buffer (Rohdaten) genauso
    expect(verifyWebhook(SECRET, { id: 'msg_1', timestamp: ts, signature: sig }, Buffer.from(body), now).ok).toBe(true);
  });

  it('entspricht dem Svix-Verfahren (HMAC-SHA256, Base64, "id.timestamp.body")', async () => {
    const { createHmac } = await import('node:crypto');
    const key = Buffer.from(SECRET.slice(6), 'base64');
    const expected = createHmac('sha256', key).update(`msg_1.${ts}.${body}`).digest('base64');
    expect(sig).toBe(`v1,${expected}`);
  });

  it('falsches Secret, veränderter Body, andere ID', () => {
    expect(verifyWebhook(OTHER, { id: 'msg_1', timestamp: ts, signature: sig }, body, now)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyWebhook(SECRET, { id: 'msg_1', timestamp: ts, signature: sig }, body.replace('abc', 'abd'), now)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyWebhook(SECRET, { id: 'msg_1', timestamp: ts, signature: sig }, body + ' ', now).ok).toBe(false);
    expect(verifyWebhook(SECRET, { id: 'msg_2', timestamp: ts, signature: sig }, body, now).ok).toBe(false);
  });

  it('alter oder zukünftiger Zeitstempel (> 5 Min.), ungültige Header', () => {
    const old = String(Number(ts) - 301);
    const oldSig = signWebhook(SECRET, 'msg_1', old, body);
    expect(verifyWebhook(SECRET, { id: 'msg_1', timestamp: old, signature: oldSig }, body, now)).toEqual({ ok: false, reason: 'expired' });
    const future = String(Number(ts) + 301);
    expect(verifyWebhook(SECRET, { id: 'msg_1', timestamp: future, signature: signWebhook(SECRET, 'msg_1', future, body) }, body, now).ok).toBe(false);
    const edge = String(Number(ts) - 299);
    expect(verifyWebhook(SECRET, { id: 'msg_1', timestamp: edge, signature: signWebhook(SECRET, 'msg_1', edge, body) }, body, now).ok).toBe(true);
    expect(verifyWebhook(SECRET, { id: 'msg_1', timestamp: '12a', signature: sig }, body, now)).toEqual({ ok: false, reason: 'bad_timestamp' });
    expect(verifyWebhook(SECRET, { id: 'msg_1', timestamp: ts }, body, now)).toEqual({ ok: false, reason: 'missing_headers' });
    expect(verifyWebhook('', { id: 'msg_1', timestamp: ts, signature: sig }, body, now)).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('mehrere Signaturen (Schlüsselwechsel): eine passende genügt; andere Versionen werden ignoriert', () => {
    const other = signWebhook(OTHER, 'msg_1', ts, body);
    expect(verifyWebhook(SECRET, { id: 'msg_1', timestamp: ts, signature: `${other} ${sig}` }, body, now).ok).toBe(true);
    expect(verifyWebhook(SECRET, { id: 'msg_1', timestamp: ts, signature: `v1,Zm9v ${sig}` }, body, now).ok).toBe(true);
    expect(verifyWebhook(SECRET, { id: 'msg_1', timestamp: ts, signature: sig.replace('v1,', 'v2,') }, body, now).ok).toBe(false);
    expect(verifyWebhook(SECRET, { id: 'msg_1', timestamp: ts, signature: other }, body, now).ok).toBe(false);
  });

  it('Secret-Format wird beim Start geprüft', () => {
    expect(webhookKey('whsec_abc')).toBeNull();
    expect(webhookKey('abc' + SECRET.slice(6))).toBeNull();
    expect(webhookKey(SECRET)?.toString()).toBe('catch-test-secret-0123456789');
    expect(() => loadConfig({ AUTH_MODE: 'dev', RESEND_WEBHOOK_SECRET: 'geheim' } as NodeJS.ProcessEnv)).toThrow(/RESEND_WEBHOOK_SECRET/);
    expect(loadConfig({ AUTH_MODE: 'dev', RESEND_WEBHOOK_SECRET: ` ${SECRET} ` } as NodeJS.ProcessEnv).RESEND_WEBHOOK_SECRET).toBe(SECRET);
    expect(loadConfig({ AUTH_MODE: 'dev' } as NodeJS.ProcessEnv).RESEND_WEBHOOK_SECRET).toBe('');
  });
});

describe('HTML → Text', () => {
  it('entfernt Skripte/Styles, behält Text, Absätze, Listen und Links', () => {
    const html = `<!doctype html><html><head><title>T</title><style>p{color:red}</style><script>alert(1)</script></head><body>
      <p>Hallo&nbsp;Team,</p><p>ich wurde <b>gesperrt</b> &amp; weiß nicht warum.<br>Bitte prüft das.</p>
      <ul><li>Eins</li><li>Zwei</li></ul><a href="https://example.com/x?a=1&amp;b=2">hier</a> und <a href="mailto:a@b.de">a@b.de</a>
      <img src="x" alt="Logo"> &lt;script&gt;alert(2)&lt;/script&gt; &#128512;<!-- versteckt --><div onclick="x()">Ende</div></body></html>`;
    const text = htmlToPlainText(html);
    expect(text).toBe(
      'Hallo Team,\n\nich wurde gesperrt & weiß nicht warum.\nBitte prüft das.\n\n• Eins\n• Zwei\nhier (https://example.com/x?a=1&b=2) und a@b.de [Logo] <script>alert(2)</script> 😀\nEnde',
    );
    expect(text).not.toContain('alert(1)');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('versteckt');
  });

  it('kommt mit kaputtem HTML zurecht und bleibt linear', () => {
    expect(htmlToPlainText('a < b > c')).toBe('a < b > c');
    expect(htmlToPlainText('<script>unclosed')).toBe('');
    expect(htmlToPlainText('x<style')).toBe('x<style');
    expect(htmlToPlainText('<a href="javascript:alert(1)">klick</a>')).toBe('klick');
    const t0 = Date.now();
    htmlToPlainText('<a '.repeat(300_000));
    htmlToPlainText('a < '.repeat(300_000) + '>');
    htmlToPlainText('<style>'.repeat(100_000));
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('nur HTML vorhanden → umgewandelt; Text wird bei ~100 KB gekürzt', () => {
    const m = parseReceivedEmail({ id: 'e1', html: '<p>Hi <b>there</b></p>', text: null, subject: ' Test ' }, 'e1');
    expect(m).toMatchObject({ text: 'Hi there', textFromHtml: true, textTruncated: false, subject: 'Test' });
    const big = parseReceivedEmail({ id: 'e2', text: 'x'.repeat(MAIL_TEXT_MAX + 50), html: '<p>ignored</p>' }, 'e2');
    expect(big.text).toHaveLength(MAIL_TEXT_MAX);
    expect(big.textTruncated).toBe(true);
    expect(big.textFromHtml).toBe(false);
  });
});

describe('Empfangene Mail aufbereiten', () => {
  it('liest Resend-Antwort: Adressen, Header, Prüfergebnisse, Anhänge (nur Metadaten)', () => {
    const m = parseReceivedEmail(
      {
        object: 'email',
        id: 'e-1',
        from: 'Anna Müller <anna@example.com>',
        to: ['contact@junify.live'],
        cc: [],
        subject: 'Re: Your Catch report has been hidden',
        text: 'Why?\r\n\r\nOn Mon, 3 Nov 2026 Catch <noreply@junify.live> wrote:\n> old',
        html: '<p>Why?</p>',
        headers: { 'In-Reply-To': '<orig@resend.dev>', References: '<a@x> <orig@resend.dev>', 'Auto-Submitted': 'no', 'X-Secret': 'x' },
        message_id: '<reply-1@mail.example.com>',
        authentication: { spf: 'pass', dkim: [{ result: 'fail' }, { result: 'pass' }], dmarc: { result: 'FAIL' } },
        attachments: [{ id: 'att1', filename: 'screen.png', content_type: 'image/png', content_disposition: 'attachment', size: 12345, content: 'AAAA' }],
      },
      'e-1',
    );
    expect(m.from).toEqual({ address: 'anna@example.com', name: 'Anna Müller' });
    expect(m.to).toEqual(['contact@junify.live']);
    expect(m.text.startsWith('Why?\n\nOn Mon')).toBe(true);
    expect(m.messageId).toBe('<reply-1@mail.example.com>');
    expect(m.inReplyTo).toBe('<orig@resend.dev>');
    expect(m.references).toBe('<a@x> <orig@resend.dev>');
    expect(m.auth).toEqual({ spf: 'pass', dkim: 'pass', dmarc: 'fail' });
    expect(authWarnings(m.auth)).toEqual(['dmarc']);
    expect(m.attachments).toEqual([{ id: 'att1', filename: 'screen.png', contentType: 'image/png', size: 12345, inline: false }]);
    expect(JSON.stringify(m)).not.toContain('AAAA');
    expect(m.headers).toEqual({ 'auto-submitted': 'no' });
    expect(isAutoReply(m.headers)).toBe(false);
  });

  it('Prüfergebnisse notfalls aus Authentication-Results; Header als Liste; Abwesenheitsnotiz', () => {
    const m = parseReceivedEmail(
      { id: 'e', from: 'x@y.de', headers: [{ name: 'Authentication-Results', value: 'mx.resend; spf=softfail smtp.mailfrom=y.de; dkim=none; dmarc=pass' }, { name: 'Auto-Submitted', value: 'auto-replied' }] },
      'e',
    );
    expect(m.auth).toEqual({ spf: 'softfail', dkim: 'none', dmarc: 'pass' });
    expect(authWarnings(m.auth)).toEqual(['spf']);
    expect(isAutoReply(m.headers)).toBe(true);
    expect(m.text).toBe('');
  });

  it('Adressen und Message-IDs', () => {
    expect(parseAddress('"Müller, Anna" <Anna@Example.com>')).toEqual({ address: 'Anna@Example.com', name: 'Müller, Anna' });
    expect(parseAddress({ email: 'a@b.de', name: 'A' })).toEqual({ address: 'a@b.de', name: 'A' });
    expect(parseAddress('kein-name')).toBeNull();
    expect(parseAddress('a@b.de\r\nBcc: x@y.de')).toBeNull();
    expect(normalizeMessageId('abc@x')).toBe('<abc@x>');
    expect(normalizeMessageId('<a b@x>')).toBeNull();
    expect(normalizeMessageId('<a@x>\r\nBcc: y')).toBeNull();
  });

  it('Webhook-Ereignis: E-Mail-ID aus email_id, email.id oder id; fehlende Felder erlaubt', () => {
    expect(parseInboundEvent('w', { type: 'email.received', data: { email_id: 'e1', id: 'x', from: 'A <a@b.de>', to: ['c@d.de'], subject: 'Hi' } })).toMatchObject({
      type: 'email.received', emailId: 'e1', from: { address: 'a@b.de', name: 'A' }, to: ['c@d.de'], subject: 'Hi',
    });
    expect(parseInboundEvent('w', { type: 'inbox.email.received', data: { id: 'inbox_1', email: { id: 'e2', from: 'b@c.de' } } })).toMatchObject({ emailId: 'e2', from: { address: 'b@c.de' } });
    expect(parseInboundEvent('w', { type: 'email.received', data: { id: 'e3' } }).emailId).toBe('e3');
    expect(parseInboundEvent('w', { type: 'email.received', data: { email_id: '../etc' } }).emailId).toBeNull();
    expect(parseInboundEvent('w', null)).toMatchObject({ type: '', emailId: null, from: null, to: [] });
  });
});

describe('Antwort: Header, Betreff, Sprache, Mail', () => {
  it('In-Reply-To und References (Thread)', () => {
    expect(threadHeaders('<m3@x>', '<m1@x> <m2@x>', '<m2@x>')).toEqual({ 'In-Reply-To': '<m3@x>', References: '<m1@x> <m2@x> <m3@x>' });
    expect(threadHeaders('m3@x', null, '<m2@x>')).toEqual({ 'In-Reply-To': '<m3@x>', References: '<m2@x> <m3@x>' });
    expect(threadHeaders('<m3@x>', null, null)).toEqual({ 'In-Reply-To': '<m3@x>', References: '<m3@x>' });
    expect(threadHeaders(null, '<m1@x>')).toEqual({});
    const many = Array.from({ length: 15 }, (_, i) => `<r${i}@x>`).join(' ');
    const h = threadHeaders('<last@x>', many);
    expect(h.References.split(' ')).toHaveLength(10);
    expect(h.References.startsWith('<r0@x> <r7@x>')).toBe(true);
    expect(h.References.endsWith('<r14@x> <last@x>')).toBe(true);
  });

  it('Betreff "Re: …" ohne doppeltes Präfix', () => {
    expect(replySubject('Frage', 'de')).toBe('Re: Frage');
    expect(replySubject('Re: Frage', 'de')).toBe('Re: Frage');
    expect(replySubject('AW: Deine Catch-Meldung', 'de')).toBe('AW: Deine Catch-Meldung');
    expect(replySubject('RE[2]: x', 'en')).toBe('RE[2]: x');
    expect(replySubject('Fwd: x', 'en')).toBe('Re: Fwd: x');
    expect(replySubject('Hi\r\nBcc: evil@x.de', 'en')).toBe('Re: Hi Bcc: evil@x.de');
    expect(replySubject('  ', 'en')).toBe('Re: Your message to Catch');
  });

  it('Zitat-Verlauf abschneiden und Sprache erraten', () => {
    expect(trimQuoted('Danke!\n\nAm Mo., 3. Nov. 2026 um 10:00 Uhr schrieb Catch <noreply@junify.live>:\n> alt')).toBe('Danke!');
    expect(trimQuoted('Thanks\nOn Mon, Nov 3, 2026 at 10:00 AM Catch <noreply@junify.live>\nwrote:\n> old')).toBe('Thanks');
    expect(trimQuoted('Neu\n\nVon: Catch <noreply@junify.live>\nGesendet: Montag\nalt')).toBe('Neu');
    expect(trimQuoted('a\n> zitiert\nb')).toBe('a\nb');
    expect(trimQuoted('x'.repeat(50), 20)).toBe('x'.repeat(20) + ' …');
    expect(detectLang('Frage', 'Hallo, warum wurde meine Meldung ausgeblendet? Danke')).toBe('de');
    expect(detectLang('Question', 'Hello, why was my report hidden? Thanks')).toBe('en');
    expect(detectLang('AW: Test', '')).toBe('de');
    expect(detectLang(null, null)).toBe('en');
  });

  it('Mail im Catch-Layout: alles maskiert, Original zitiert und gekürzt', () => {
    const mail = inboxReplyMail(
      'de',
      {
        reply: 'Danke für den Hinweis <b>!</b>\n\nWir haben es geprüft.',
        original: 'Warum? <img src=x onerror=alert(1)>\n\nAm Mo., 3. Nov. 2026 um 10:00 Uhr schrieb Catch <noreply@junify.live>:\n> Deine Meldung …',
        receivedAt: '2026-11-07T10:00:00Z',
        subject: 'AW: Deine Catch-Meldung wurde ausgeblendet',
        name: 'Anna <script>',
      },
      'https://junify.live',
      { kind: 'reply' },
    );
    expect(mail.subject).toBe('AW: Deine Catch-Meldung wurde ausgeblendet');
    expect(mail.html).toContain('Hallo Anna script,');
    expect(mail.html).toContain('Danke für den Hinweis &lt;b&gt;!&lt;/b&gt;');
    expect(mail.html).toContain('Warum? &lt;img src=x onerror=alert(1)&gt;');
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).not.toContain('Deine Meldung …'); // zitierter Verlauf abgeschnitten
    expect(mail.html).toContain('Dein Catch-Team');
    expect(mail.html).toContain('Deine E-Mail vom 07.11.2026');
    expect(mail.text).toContain('> Warum? <img src=x onerror=alert(1)>');
    expect(mail.text).toContain('Antworte einfach auf diese E-Mail');
    const en = inboxReplyMail('en', { reply: 'Thanks for your message.', original: '', receivedAt: new Date(), subject: null, name: 'a@b.de' }, 'https://junify.live', { kind: 'app' });
    expect(en.subject).toBe('Re: Your message to Catch');
    expect(en.html).toContain('Hi,');
    expect(en.html).toContain('The Catch team');
    // Eigene Anrede in der Antwort → keine zweite; Absätze auch in der Text-Fassung
    const own = inboxReplyMail('de', { reply: 'Hallo Lena,\n\ndanke!', original: 'x', receivedAt: new Date(), subject: 'x', name: 'Lena Test' }, 'https://junify.live', { kind: 'reply' });
    expect(own.html).not.toContain('Hallo Lena Test,');
    expect(own.text).toContain('Hallo Lena,\n\ndanke!\n\nViele Grüße\nDein Catch-Team');
    expect(greetingName('noreply')).toBeNull();
    expect(greetingName('x'.repeat(61))).toBeNull();
  });

  it('Resend-Versand: Header und ID der verschickten Mail', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ id: 'sent-1' }), { status: 200 });
    }) as unknown as typeof fetch;
    const cfg = loadConfig({ AUTH_MODE: 'dev', RESEND_API_KEY: 're_x', MAIL_REPLY_TO: 'contact@junify.live' } as NodeJS.ProcessEnv);
    const res = await createResendSender(cfg, fakeFetch)({ to: 'a@b.de', subject: 'Re: x', html: '<p>x</p>', text: 'x', headers: { 'In-Reply-To': '<m@x>', References: '<m@x>' } });
    expect(res).toEqual({ id: 'sent-1' });
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    expect(calls[0].body).toMatchObject({ to: ['a@b.de'], reply_to: 'contact@junify.live', headers: { 'In-Reply-To': '<m@x>', References: '<m@x>' } });
    await createResendSender(cfg, fakeFetch)({ to: 'a@b.de', subject: 's', html: '', text: '' });
    expect(calls[1].body.headers).toBeUndefined();
  });
});

/** Mini-Datenbank im Speicher – nur was der Webhook-Endpunkt braucht. */
function fakeDb() {
  const hooks = new Set<string>();
  const emails = new Map<string, unknown[]>();
  const query = async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO inbound_webhooks/.test(sql)) {
      if (hooks.has(String(params[0]))) return { rowCount: 0, rows: [] };
      hooks.add(String(params[0]));
      return { rowCount: 1, rows: [{ id: params[0] }] };
    }
    if (/INSERT INTO inbound_emails/.test(sql)) {
      if (emails.has(String(params[0]))) return { rowCount: 0, rows: [] };
      emails.set(String(params[0]), params);
      return { rowCount: 1, rows: [{ id: params[0] }] };
    }
    return { rowCount: 0, rows: [] }; // BEGIN/COMMIT/ROLLBACK, Abruf (UPDATE … → 0 Zeilen: nichts abzurufen)
  };
  return { hooks, emails, db: { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Db };
}

describe('Endpunkt POST /v1/mail/inbound', () => {
  let on: FastifyInstance;
  let off: FastifyInstance;
  const store = fakeDb();
  const send = (app: FastifyInstance, payload: string, headers: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/v1/mail/inbound', payload, headers: { 'content-type': 'application/json', ...headers } });
  const signed = (id: string, payload: string, secret = SECRET, at = Math.floor(Date.now() / 1000)) => ({
    'svix-id': id,
    'svix-timestamp': String(at),
    'svix-signature': signWebhook(secret, id, at, payload),
  });

  beforeAll(async () => {
    const base = { AUTH_MODE: 'dev', RESEND_API_KEY: 're_test' };
    on = (await buildApp({ cfg: loadConfig({ ...base, RESEND_WEBHOOK_SECRET: SECRET } as NodeJS.ProcessEnv), db: store.db, logger: false })).app;
    off = (await buildApp({ cfg: loadConfig(base as NodeJS.ProcessEnv), db: store.db, logger: false })).app;
  });
  afterAll(async () => {
    await on?.close();
    await off?.close();
  });

  const event = JSON.stringify({ type: 'email.received', created_at: new Date().toISOString(), data: { email_id: 'em-1', from: 'Anna <anna@example.com>', to: ['contact@junify.live'], subject: 'Hallo' } });

  it('404, wenn der Empfang nicht eingerichtet ist', async () => {
    const res = await send(off, event, signed('w0', event));
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });

  it('401 bei falscher/fehlender Signatur oder altem Zeitstempel – nichts gespeichert', async () => {
    expect((await send(on, event, signed('w1', event, OTHER))).statusCode).toBe(401);
    expect((await send(on, event, {})).statusCode).toBe(401);
    expect((await send(on, event.replace('Hallo', 'Hallx'), signed('w1', event))).statusCode).toBe(401);
    expect((await send(on, event, signed('w1', event, SECRET, Math.floor(Date.now() / 1000) - 600))).statusCode).toBe(401);
    expect(store.hooks.size).toBe(0);
  });

  it('200: speichert, Wiederholung derselben Webhook-ID wird erkannt', async () => {
    const first = await send(on, event, signed('w2', event));
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true });
    expect(store.emails.get('em-1')).toMatchObject(['em-1', expect.any(Date), 'email.received', 'anna@example.com', 'Anna', ['contact@junify.live'], 'Hallo', null]);
    const again = await send(on, event, signed('w2', event));
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ ok: true, duplicate: true });
    expect(store.hooks.size).toBe(1);
  });

  it('andere Ereignisse: 200, aber ignoriert; kaputtes JSON: 400; Rohdaten auch ohne JSON-Content-Type', async () => {
    const sent = JSON.stringify({ type: 'email.sent', data: { email_id: 'x' } });
    expect((await send(on, sent, signed('w3', sent))).json()).toEqual({ ok: true, ignored: true });
    expect((await send(on, '{nope', signed('w4', '{nope'))).statusCode).toBe(400);
    const inbox = JSON.stringify({ type: 'inbox.email.received', data: { email: { id: 'em-2' } } });
    const res = await on.inject({ method: 'POST', url: '/v1/mail/inbound', payload: inbox, headers: { 'content-type': 'text/plain', ...signed('w5', inbox) } });
    expect(res.json()).toEqual({ ok: true });
    expect(store.emails.has('em-2')).toBe(true);
  });

  it('die Parser der übrigen API bleiben unverändert (kein Rohdaten-Parser, Schutz vor __proto__)', async () => {
    // Der Rohdaten-Parser ("*") gilt nur für den Webhook – sonst wäre das hier kein 415
    const raw = await on.inject({ method: 'POST', url: '/v1/feedback', payload: 'hi', headers: { 'content-type': 'application/octet-stream' } });
    expect(raw.statusCode).toBe(415);
    const proto = await on.inject({ method: 'POST', url: '/v1/feedback', payload: '{"category":"BUG","message":"Hallo Welt","__proto__":{"x":1}}', headers: { 'content-type': 'application/json' } });
    expect(proto.statusCode).toBe(400);
    expect(proto.json().message).toMatch(/not valid JSON/); // Prototype-Poisoning abgewiesen
  });
});
