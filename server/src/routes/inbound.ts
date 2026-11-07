// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * POST /v1/mail/inbound – Webhook von Resend für empfangene E-Mails (öffentlich, ohne Login).
 *
 * Sicherheit: Nur mit gültiger Svix-Signatur (RESEND_WEBHOOK_SECRET) über die unveränderten
 * Rohdaten und mit aktuellem Zeitstempel (±5 Min.). Ohne Secret antwortet die Adresse 404.
 * Antwortet schnell mit 200 (sonst wiederholt Resend), der Inhalt wird im Hintergrund abgerufen.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Deps } from '../deps.js';
import { HttpError } from '../http.js';
import { INBOUND_EVENTS, verifyWebhook } from '../mail/inbound.js';
import { inboundEnabled, loadInboundContent, parseInboundEvent, retryInboundContent, storeInboundEvent } from '../services/inbox.js';

/** Webhooks enthalten nur Metadaten – mehr als 512 KB sind kein echter Webhook. */
const WEBHOOK_BODY_LIMIT = 512 * 1024;

export async function inboundRoutes(app: FastifyInstance, deps: Deps) {
  const { cfg, log } = deps;
  const enabled = inboundEnabled(cfg);
  if (enabled) log.info('E-Mail-Empfang aktiv (POST /v1/mail/inbound)');

  // Fehlende Inhalte regelmäßig erneut abrufen
  let retry: NodeJS.Timeout | null = null;
  app.addHook('onReady', async () => {
    if (!enabled) return;
    retry = setInterval(() => {
      retryInboundContent(deps).catch((err) => log.warn({ err }, 'Empfangene Mails: erneuter Abruf fehlgeschlagen'));
    }, 5 * 60_000);
    retry.unref();
  });
  app.addHook('onClose', async () => {
    if (retry) clearInterval(retry);
  });

  // Eigener Kontext: Rohdaten statt JSON-Parser (die Signatur gilt für die Bytes, wie sie ankommen).
  // Der globale JSON-Parser der übrigen API bleibt unberührt.
  await app.register(async (r) => {
    r.removeAllContentTypeParsers();
    r.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: WEBHOOK_BODY_LIMIT }, (_req, body, done) => done(null, body));

    const header = (req: FastifyRequest, name: string) => {
      const v = req.headers[name];
      return Array.isArray(v) ? v[0] : v;
    };

    r.post(
      '/v1/mail/inbound',
      { bodyLimit: WEBHOOK_BODY_LIMIT, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
      async (req, reply) => {
        if (!enabled) throw new HttpError(404, 'not_found', 'route_not_found');
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const check = verifyWebhook(
          cfg.RESEND_WEBHOOK_SECRET,
          { id: header(req, 'svix-id'), timestamp: header(req, 'svix-timestamp'), signature: header(req, 'svix-signature') },
          raw,
        );
        if (!check.ok) {
          req.log.warn({ reason: check.reason }, 'Webhook für empfangene Mail abgelehnt');
          return reply.code(401).send({ error: 'invalid_signature', message: 'Invalid webhook signature.' });
        }
        let body: unknown;
        try {
          body = JSON.parse(raw.toString('utf8'));
        } catch {
          return reply.code(400).send({ error: 'bad_request', message: 'Invalid JSON.' });
        }
        const event = parseInboundEvent(check.id, body);
        // Andere Ereignisse (z. B. email.sent, email.delivered) bestätigen, aber nicht speichern
        if (!INBOUND_EVENTS.includes(event.type)) return { ok: true, ignored: true };
        if (!event.emailId) {
          req.log.warn({ type: event.type }, 'Webhook ohne E-Mail-ID');
          return { ok: true, ignored: true };
        }
        const result = await storeInboundEvent(deps.db, { ...event, emailId: event.emailId });
        if (result === 'duplicate') return { ok: true, duplicate: true };
        // Inhalt im Hintergrund abrufen (bei Fehlern: FETCH_FAILED, später erneut)
        loadInboundContent(deps, event.emailId).catch((err) =>
          log.error({ err, email: event.emailId }, 'Empfangene Mail: Inhalt nicht gespeichert'),
        );
        return { ok: true };
      },
    );
  });
}
