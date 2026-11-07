// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/** Meldungen, Linien-Statistiken, Live-Trackings, Konto. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { parse, requireUser } from '../http.js';
import { reqLang } from '../i18n.js';
import type { authHooks } from '../auth/auth.js';
import { createReport, deleteOwnReport, flagReport, flagSchema, getLineStats, getPublicStats, kindSchema, listLineReports, recentReports, voteReport } from '../services/reports.js';
import { createTracking, deleteTracking, listAlerts, listTrackings, onReportCreated, releaseHeldAlerts } from '../services/trackings.js';
import { acceptTerms, deleteUser, getMe, registerDevice, unregisterDevice, updateDisplayName } from '../services/users.js';

const idParam = z.object({ id: z.string().regex(/^\d{1,18}$/) });
const lineParam = z.object({ lineKey: z.string().min(3).max(120) });
const days = z.coerce.number().int().refine((d) => [1, 7, 30, 90, 365].includes(d), 'erlaubt: 1, 7, 30, 90, 365');

export async function communityRoutes(app: FastifyInstance, deps: Deps, auth: ReturnType<typeof authHooks>) {
  const { db } = deps;
  const authed = { preHandler: auth.requireAuth };
  const optional = { preHandler: auth.optionalAuth };

  // --- Linien ---
  app.get('/v1/lines/:lineKey/stats', async (req) => {
    const { lineKey } = parse(lineParam, req.params);
    const q = parse(z.object({ days: days.default(30), directionId: z.string().max(20).optional(), kind: kindSchema.optional() }), req.query);
    return getLineStats(deps, lineKey, { ...q, lang: reqLang(req) });
  });

  app.get('/v1/lines/:lineKey/reports', optional, async (req) => {
    const { lineKey } = parse(lineParam, req.params);
    const q = parse(
      z.object({
        days: days.default(30),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        before: z.string().datetime({ offset: true }).optional(),
        kind: kindSchema.optional(),
      }),
      req.query,
    );
    return { reports: await listLineReports(db, lineKey, q, req.user?.uid ?? null) };
  });

  // --- Meldungen ---
  // Kennzahlen für die Website (öffentlich, gecacht)
  app.get('/v1/stats/public', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return getPublicStats(db);
  });

  app.get('/v1/reports/recent', optional, async (req) => {
    const q = parse(
      z.object({
        lat: z.coerce.number().min(-90).max(90).optional(),
        lon: z.coerce.number().min(-180).max(180).optional(),
        radiusKm: z.coerce.number().min(1).max(200).default(30),
        minutes: z.coerce.number().int().min(5).max(24 * 60).default(60),
        kind: kindSchema.optional(),
      }),
      req.query,
    );
    return { reports: await recentReports(db, q, req.user?.uid ?? null) };
  });

  app.post('/v1/reports', { ...authed, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireUser(req);
    const { report, alertsHeld } = await createReport(deps, user.uid, req.body);
    onReportCreated(deps, report, user.uid, { holdAlerts: alertsHeld });
    return reply.code(201).send(report);
  });

  app.post('/v1/reports/:id/vote', authed, async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParam, req.params);
    const { value } = parse(z.object({ value: z.union([z.literal(1), z.literal(-1)]) }), req.body);
    const report = await voteReport(deps, user.uid, id, value);
    // Erste Bestätigung: zurückgehaltene Live-Alarme (Meldende mit negativem Vertrauen) verschicken
    if (value === 1) releaseHeldAlerts(deps, id, user.uid).catch((err) => deps.log.error({ err }, 'Alarme nach Bestätigung'));
    return report;
  });

  // Inhalt melden (falsch, Spam, unangemessen …) – ab 3 Markierungen wird die Meldung ausgeblendet
  app.post('/v1/reports/:id/flag', { ...authed, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParam, req.params);
    const { reason } = parse(flagSchema, req.body);
    await flagReport(deps, user.uid, id, reason);
    return reply.code(204).send();
  });

  app.delete('/v1/reports/:id', authed, async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParam, req.params);
    await deleteOwnReport(db, user.uid, id);
    return reply.code(204).send();
  });

  // --- Live-Tracking ---
  app.get('/v1/trackings', authed, async (req) => ({ trackings: await listTrackings(deps, requireUser(req).uid) }));

  app.post('/v1/trackings', authed, async (req, reply) => {
    const tracking = await createTracking(deps, requireUser(req).uid, req.body);
    return reply.code(201).send(tracking);
  });

  app.delete('/v1/trackings/:id', authed, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await deleteTracking(db, requireUser(req).uid, id);
    return reply.code(204).send();
  });

  app.get('/v1/alerts', authed, async (req) => ({ alerts: await listAlerts(db, requireUser(req).uid, reqLang(req)) }));

  // --- Konto & Geräte ---
  app.get('/v1/me', authed, async (req) => getMe(db, requireUser(req).uid));

  app.patch('/v1/me', authed, async (req) => {
    const uid = requireUser(req).uid;
    const body = parse(
      z.object({ displayName: z.string().trim().min(1).max(40).optional(), acceptTerms: z.literal(true).optional() }),
      req.body,
    );
    if (body.displayName) await updateDisplayName(db, uid, body.displayName);
    if (body.acceptTerms) await acceptTerms(db, uid);
    return getMe(db, uid);
  });

  app.delete('/v1/me', authed, async (req, reply) => {
    await deleteUser(db, requireUser(req).uid);
    return reply.code(204).send();
  });

  app.post('/v1/devices', authed, async (req, reply) => {
    const body = parse(
      z.object({ token: z.string().min(10).max(300), platform: z.enum(['ios', 'android', 'web']) }),
      req.body,
    );
    await registerDevice(db, requireUser(req).uid, body.token, body.platform);
    return reply.code(204).send();
  });

  app.delete('/v1/devices', authed, async (req, reply) => {
    const body = parse(z.object({ token: z.string().min(10).max(300) }), req.body);
    await unregisterDevice(db, requireUser(req).uid, body.token);
    return reply.code(204).send();
  });
}
