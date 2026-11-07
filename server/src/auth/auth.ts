// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Login-Prüfung: Die App meldet sich bei Firebase an und schickt das ID-Token mit.
 * Der Server prüft die Signatur des Tokens (öffentliche Google-Schlüssel) – dafür ist
 * KEIN Service-Account nötig, nur die Projekt-ID.
 */
import { getAuth } from 'firebase-admin/auth';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/pool.js';
import { getFirebaseApp } from '../firebase.js';
import { HttpError } from '../http.js';
import { parseLang, type Lang } from '../i18n.js';

export interface AuthUser {
  uid: string;
  email: string | null;
  name: string | null;
}

export type TokenVerifier = (token: string) => Promise<AuthUser>;

export function createTokenVerifier(cfg: Config): TokenVerifier {
  let firebaseVerify: TokenVerifier | null = null;
  if (cfg.FIREBASE_PROJECT_ID) {
    const auth = getAuth(getFirebaseApp(cfg));
    firebaseVerify = async (token) => {
      const decoded = await auth.verifyIdToken(token);
      return { uid: decoded.uid, email: decoded.email ?? null, name: (decoded.name as string | undefined) ?? null };
    };
  }

  return async (token: string) => {
    if (cfg.AUTH_MODE === 'dev' && token.startsWith('dev:')) {
      const name = token.slice(4).trim().slice(0, 40);
      if (!/^[\w .äöüÄÖÜß-]{1,40}$/.test(name)) throw new HttpError(401, 'unauthorized', 'dev_login_invalid');
      return { uid: `dev-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, email: null, name };
    }
    if (!firebaseVerify) throw new HttpError(401, 'unauthorized', 'auth_not_configured');
    try {
      return await firebaseVerify(token);
    } catch {
      throw new HttpError(401, 'unauthorized', 'session_expired');
    }
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

/**
 * Legt den Nutzer bei der ersten Anfrage an und aktualisiert "zuletzt gesehen".
 * `lang` (falls bekannt) wird gespeichert – damit kommen Push-Alarme in seiner Sprache.
 */
export async function upsertUser(db: Db, u: AuthUser, lang: Lang | null = null): Promise<void> {
  const res = await db.query<{ banned: boolean }>(
    `INSERT INTO users (id, email, display_name, lang) VALUES ($1, $2, $3, COALESCE($4, 'en'))
     ON CONFLICT (id) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, users.email),
       display_name = COALESCE(users.display_name, EXCLUDED.display_name),
       lang = COALESCE($4, users.lang),
       last_seen_at = now()
     RETURNING banned`,
    [u.uid, u.email, u.name, lang],
  );
  if (res.rows[0]?.banned) throw new HttpError(403, 'banned', 'account_banned');
}

export function authHooks(db: Db, verify: TokenVerifier) {
  /** Login optional: setzt req.user, wenn ein gültiges Token mitkommt. */
  async function optionalAuth(req: FastifyRequest): Promise<void> {
    req.user = null;
    const token = bearer(req);
    if (!token) return;
    try {
      req.user = await verify(token);
    } catch {
      req.user = null;
    }
  }

  /** Login Pflicht. */
  async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const token = bearer(req);
    if (!token) throw new HttpError(401, 'unauthorized', 'login_required');
    const user = await verify(token);
    await upsertUser(db, user, parseLang(req.headers['accept-language']));
    req.user = user;
  }

  return { optionalAuth, requireAuth };
}
