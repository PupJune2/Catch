// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/** Pendler-Modus: gespeicherte Strecken mit automatischer Beobachtung und Losgeh-Erinnerung. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { authHooks } from '../auth/auth.js';
import type { Deps } from '../deps.js';
import { parse, requireUser } from '../http.js';
import { createCommute, deleteCommute, listCommutes, previewCommute, updateCommute } from '../services/commutes.js';

const idParam = z.object({ id: z.string().regex(/^\d{1,18}$/) });

export async function commuteRoutes(app: FastifyInstance, deps: Deps, auth: ReturnType<typeof authHooks>) {
  const authed = { preHandler: auth.requireAuth };

  app.get('/v1/commutes', authed, async (req) => ({ commutes: await listCommutes(deps, requireUser(req).uid) }));

  app.post('/v1/commutes', { ...authed, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const commute = await createCommute(deps, requireUser(req).uid, req.body);
    return reply.code(201).send(commute);
  });

  app.patch('/v1/commutes/:id', authed, async (req) => {
    const { id } = parse(idParam, req.params);
    return updateCommute(deps, requireUser(req).uid, id, req.body);
  });

  app.delete('/v1/commutes/:id', authed, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await deleteCommute(deps.db, requireUser(req).uid, id);
    return reply.code(204).send();
  });

  // Nächste Verbindung jetzt live planen (fragt MOTIS → etwas strenger begrenzt)
  app.get('/v1/commutes/:id/preview', { ...authed, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { id } = parse(idParam, req.params);
    return previewCommute(deps, requireUser(req).uid, id);
  });
}
