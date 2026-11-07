// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/** Öffentliche Konto-Hilfen: Feedback senden, "Passwort vergessen" mit eigener Catch-Mail. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { authHooks } from '../auth/auth.js';
import type { Deps } from '../deps.js';
import { FEEDBACK_CATEGORIES, FEEDBACK_MAX_LENGTH, FEEDBACK_MIN_LENGTH, type FeedbackCategory } from '../contract.js';
import { parse } from '../http.js';
import { reqLang } from '../i18n.js';
import { createPasswordReset, type PasswordResetDeps } from '../mail/passwordReset.js';

/** Steuerzeichen raus (außer Zeilenumbruch/Tab), höchstens 2 Leerzeilen am Stück. */
export function cleanText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const feedbackSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES as [FeedbackCategory, ...FeedbackCategory[]]),
  message: z
    .string()
    .max(FEEDBACK_MAX_LENGTH + 500)
    .transform(cleanText)
    .pipe(z.string().min(FEEDBACK_MIN_LENGTH).max(FEEDBACK_MAX_LENGTH)),
  rating: z.number().int().min(1).max(5).optional(),
  allowContact: z.boolean().optional(),
  appVersion: z.string().trim().max(40).optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});

export async function accountRoutes(
  app: FastifyInstance,
  deps: Deps,
  auth: ReturnType<typeof authHooks>,
  resetDeps: PasswordResetDeps = {},
) {
  const { db } = deps;

  app.post(
    '/v1/feedback',
    { preHandler: auth.optionalAuth, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const b = parse(feedbackSchema, req.body);
      const uid = req.user?.uid ?? null;
      // Nur mit bestehendem Konto verknüpfen (sonst anonym)
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO feedback (user_id, category, message, rating, allow_contact, app_version, platform, lang)
         VALUES ((SELECT id FROM users WHERE id = $1), $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [uid, b.category, b.message, b.rating ?? null, Boolean(uid && b.allowContact), b.appVersion ?? null, b.platform ?? null, reqLang(req)],
      );
      return reply.code(201).send({ id: String(rows[0].id) });
    },
  );

  const reset = createPasswordReset(deps.cfg, deps.log, resetDeps);
  app.post(
    '/v1/auth/password-reset',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const { email } = parse(z.object({ email: z.string().trim().max(254).email() }), req.body);
      await reset.request(email, reqLang(req));
      return reply.code(204).send();
    },
  );
}
