// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from './auth/auth.js';
import { z } from 'zod';
import { t, type MsgKey } from './i18n.js';

/**
 * Fehler mit HTTP-Status und anzeigbarer Meldung. Der Text wird erst beim Antworten
 * in der Sprache der Anfrage erzeugt (siehe i18n.ts).
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly key: MsgKey,
    public readonly params: Record<string, string | number> = {},
  ) {
    super(t('en', key, params));
  }
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw new HttpError(401, 'unauthorized', 'login_required');
  return req.user;
}

/** Validiert Eingaben mit zod und wirft bei Fehlern einen 400er. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(400, 'invalid_input', 'invalid_input', { where: first?.path.join('.') ?? '', detail: first?.message ?? 'unknown' });
  }
  return r.data;
}
