// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Offline-Fahrpläne: Liste der Pakete und Download (gzip).
 * Die Pakete baut `catch-offline-build` (systemd-Timer, wöchentlich) nach OFFLINE_DIR.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { HttpError, parse } from '../http.js';

export async function offlineRoutes(app: FastifyInstance, deps: Deps) {
  const dir = deps.cfg.OFFLINE_DIR;
  let cache: { mtime: number; body: unknown } | null = null;

  const index = () => {
    const file = dir ? join(dir, 'index.json') : '';
    if (!file || !existsSync(file)) return null;
    const mtime = statSync(file).mtimeMs;
    if (!cache || cache.mtime !== mtime) cache = { mtime, body: JSON.parse(readFileSync(file, 'utf8')) };
    return cache.body as { regions: Array<{ id: string }> };
  };

  app.get('/v1/offline/regions', async (_req, reply) => {
    const idx = index();
    reply.header('Cache-Control', 'public, max-age=300');
    if (!idx) return { available: false, regions: [] };
    return { available: true, ...idx };
  });

  app.get('/v1/offline/regions/:id', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().regex(/^[a-z0-9-]{2,40}$/) }), req.params);
    const idx = index();
    if (!idx || !idx.regions.some((r) => r.id === id)) throw new HttpError(404, 'not_found', 'route_not_found');
    const file = join(dir, `${id}.json.gz`);
    if (!existsSync(file)) throw new HttpError(404, 'not_found', 'route_not_found');
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Cache-Control', 'public, max-age=3600');
    reply.header('Vary', 'Accept-Encoding');
    const st = statSync(file);
    reply.header('Last-Modified', st.mtime.toUTCString());
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      reply.header('Content-Encoding', 'gzip');
      reply.header('Content-Length', String(st.size));
      return reply.send(createReadStream(file));
    }
    return reply.send(createReadStream(file).pipe(createGunzip()));
  });
}
