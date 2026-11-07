// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * "Passwort vergessen" mit eigener Catch-Mail:
 *  1. Firebase erzeugt den Einmal-Code (generatePasswordResetLink, braucht den Service-Account)
 *  2. Der Link zeigt auf unsere eigene Seite junify.live/reset-password (statt der Firebase-Seite)
 *  3. Versand der gestalteten Mail über Resend
 * Die Antwort verrät nie, ob es ein Konto mit dieser Adresse gibt.
 */
import { getAuth } from 'firebase-admin/auth';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { firebaseCanSendPush, getFirebaseApp } from '../firebase.js';
import { HttpError } from '../http.js';
import type { Lang } from '../i18n.js';
import { createResendSender, mailConfigured, type MailSender } from './resend.js';
import { passwordResetMail } from './templates.js';

/** Liefert den Firebase-Link oder null, wenn es kein Konto gibt. */
export type ResetLinkGenerator = (email: string) => Promise<string | null>;

export interface PasswordResetDeps {
  generateLink?: ResetLinkGenerator;
  send?: MailSender;
  now?: () => number;
}

export function createPasswordReset(cfg: Config, log: FastifyBaseLogger, deps: PasswordResetDeps = {}) {
  const send = deps.send ?? createResendSender(cfg);
  const now = deps.now ?? Date.now;
  const generateLink: ResetLinkGenerator =
    deps.generateLink ??
    (async (email) => {
      try {
        return await getAuth(getFirebaseApp(cfg)).generatePasswordResetLink(email);
      } catch (err) {
        const code = (err as { code?: string }).code ?? '';
        if (code === 'auth/user-not-found' || code === 'auth/invalid-email') return null;
        throw err;
      }
    });
  const canGenerate = () => Boolean(deps.generateLink) || (Boolean(cfg.FIREBASE_SERVICE_ACCOUNT_FILE) && firebaseCanSendPush());

  // Gegen Mail-Bombing: höchstens 3 Mails pro Adresse und Stunde (zusätzlich zum IP-Limit der Route)
  const perAddress = new Map<string, number[]>();
  const allow = (email: string) => {
    const t = now();
    const list = (perAddress.get(email) ?? []).filter((x) => x > t - 3600_000);
    if (list.length >= 3) return false;
    list.push(t);
    perAddress.set(email, list);
    if (perAddress.size > 5000) perAddress.clear();
    return true;
  };

  return {
    configured: () => mailConfigured(cfg) && canGenerate(),
    async request(emailRaw: string, lang: Lang): Promise<void> {
      if (!mailConfigured(cfg) || !canGenerate()) throw new HttpError(503, 'mail_not_configured', 'mail_not_configured');
      const email = emailRaw.trim().toLowerCase();
      if (!allow(email)) return; // still: keine Fehlermeldung, sonst ließe sich herausfinden, ob es das Konto gibt
      const link = await generateLink(email);
      if (!link) return;
      const oobCode = new URL(link).searchParams.get('oobCode');
      if (!oobCode) throw new Error('Firebase-Link ohne oobCode');
      const base = cfg.CATCH_PUBLIC_URL.replace(/\/+$/, '');
      const resetUrl = `${base}/reset-password?oobCode=${encodeURIComponent(oobCode)}&lang=${lang}`;
      try {
        await send({ to: email, ...passwordResetMail(lang, email, resetUrl, base, Boolean(cfg.MAIL_REPLY_TO)) });
      } catch (err) {
        log.error({ err: (err as Error).message }, 'Passwort-Mail konnte nicht gesendet werden');
        throw new HttpError(502, 'mail_failed', 'mail_failed');
      }
    },
  };
}
