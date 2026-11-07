// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import type { Config } from './config.js';
import type { Db } from './db/pool.js';
import type { Deps } from './deps.js';
import { authHooks, createTokenVerifier, type TokenVerifier } from './auth/auth.js';
import { HttpError } from './http.js';
import { reqLang, t } from './i18n.js';
import { communityRoutes } from './routes/community.js';
import { commuteRoutes } from './routes/commutes.js';
import { transitRoutes } from './routes/transit.js';
import { wsRoutes } from './routes/ws.js';
import { accountRoutes } from './routes/account.js';
import { offlineRoutes } from './routes/offline.js';
import { adminRoutes, type AdminRouteOptions } from './routes/admin.js';
import { inboundRoutes } from './routes/inbound.js';
import type { PasswordResetDeps } from './mail/passwordReset.js';
import { getMessaging } from 'firebase-admin/messaging';
import { firebaseCanSendPush, getFirebaseApp } from './firebase.js';
import { PushNotifier, RealtimeHub, type PushSender } from './services/notifier.js';
import { MotisClient, TransitError } from './transit/motis.js';

export interface BuildOptions {
  cfg: Config;
  db: Db;
  /** Für Tests ersetzbar */
  motis?: MotisClient;
  push?: PushSender;
  verify?: TokenVerifier;
  logger?: boolean | object;
  admin?: AdminRouteOptions;
  passwordReset?: PasswordResetDeps;
}

function createPushNotifier(cfg: Config, log: FastifyInstance['log']): PushNotifier {
  let fcm = null;
  if (cfg.FIREBASE_SERVICE_ACCOUNT_FILE) {
    const firebase = getFirebaseApp(cfg);
    if (firebaseCanSendPush()) {
      fcm = getMessaging(firebase);
      log.info('Push über Firebase Cloud Messaging aktiv');
    }
  }
  return new PushNotifier(cfg.EXPO_ACCESS_TOKEN, fcm, log);
}

export async function buildApp(opts: BuildOptions): Promise<{ app: FastifyInstance; deps: Deps }> {
  const { cfg, db } = opts;
  const app = Fastify({
    logger: opts.logger ?? {
      level: cfg.LOG_LEVEL,
      ...(cfg.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
      redact: ['req.headers.authorization'],
    },
    // Läuft hinter Nginx auf demselben Rechner: nur dem lokalen Proxy glauben. Mit "true" könnte
    // jeder per X-Forwarded-For eine beliebige IP vortäuschen (Rate-Limits, IP-Freigabe umgehen).
    trustProxy: ['127.0.0.1', '::1'],
    // Datensparsam: in Produktion keine Zeile (mit IP) pro Anfrage, nur Warnungen/Fehler
    disableRequestLogging: cfg.NODE_ENV === 'production',
    bodyLimit: 64 * 1024,
  });

  const deps: Deps = {
    cfg,
    db,
    log: app.log,
    hub: new RealtimeHub(),
    motis:
      opts.motis ??
      new MotisClient({ baseUrl: cfg.MOTIS_URL, userAgent: cfg.TRANSIT_USER_AGENT, timeoutMs: cfg.TRANSIT_TIMEOUT_MS }),
    push: opts.push ?? createPushNotifier(cfg, app.log),
  };
  const verify = opts.verify ?? createTokenVerifier(cfg);
  const auth = authHooks(db, verify);

  app.decorateRequest('user', null);

  // Leeren JSON-Body (z. B. DELETE mit Content-Type: application/json) tolerieren statt 400 –
  // ansonsten Fastifys Standard-Parser inkl. Schutz vor Prototype-Poisoning.
  const defaultJson = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (typeof body === 'string' && body.trim() === '') return done(null, undefined);
    defaultJson(req, body as string, done);
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: cfg.CORS_ORIGIN === '*' ? true : cfg.CORS_ORIGIN.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

  app.setErrorHandler((err, req, reply) => {
    const lang = reqLang(req);
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: t(lang, err.key, err.params) });
    }
    if (err instanceof TransitError) {
      req.log.warn({ err: err.message }, 'Fahrplan-Fehler');
      const status = err.status === 404 ? 404 : err.status >= 500 ? 502 : 400;
      return reply.code(status).send({ error: 'transit', message: t(lang, err.status === 404 ? 'transit_not_found' : 'transit_unavailable') });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 429) {
      return reply.code(429).send({ error: 'rate_limited', message: t(lang, 'rate_limited') });
    }
    if (status < 500) {
      return reply.code(status).send({ error: 'bad_request', message: (err as Error).message });
    }
    req.log.error({ err }, 'Unerwarteter Fehler');
    return reply.code(500).send({ error: 'internal', message: t(lang, 'internal') });
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'not_found', message: t(reqLang(req), 'route_not_found') }));

  app.get('/health', async () => {
    let dbOk = false;
    try {
      await db.query('SELECT 1');
      dbOk = true;
    } catch {
      /* unten gemeldet */
    }
    return { ok: dbOk, db: dbOk, transit: 'motis', push: { fcm: firebaseCanSendPush() }, realtime: deps.hub.stats() };
  });

  await transitRoutes(app, deps);
  await communityRoutes(app, deps, auth);
  await commuteRoutes(app, deps, auth);
  await accountRoutes(app, deps, auth, opts.passwordReset);
  await offlineRoutes(app, deps);
  await adminRoutes(app, deps, verify, opts.admin);
  await inboundRoutes(app, deps);
  await wsRoutes(app, deps, verify);
  return { app, deps };
}
