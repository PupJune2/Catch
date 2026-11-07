// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/** E-Mail-Versand über Resend (https://resend.com) – nur ein schlanker HTTP-Aufruf. */
import type { Config } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Antwortadresse; Standard: MAIL_REPLY_TO aus der Konfiguration (falls gesetzt). */
  replyTo?: string;
  /** Zusätzliche Header, z. B. In-Reply-To/References bei Antworten auf empfangene Mails. */
  headers?: Record<string, string>;
}

/** Ergebnis des Versands: Resend liefert die ID der verschickten Mail. */
export interface MailResult {
  id?: string;
}

export type MailSender = (m: MailMessage) => Promise<MailResult | void>;

export function mailConfigured(cfg: Config): boolean {
  return cfg.RESEND_API_KEY.trim().length > 0;
}

/** reply_to einer Mail: eigene Angabe, sonst MAIL_REPLY_TO (leer = keine). */
export function replyTo(cfg: Pick<Config, 'MAIL_REPLY_TO'>, m: Pick<MailMessage, 'replyTo'>): string {
  return (m.replyTo ?? cfg.MAIL_REPLY_TO ?? '').trim();
}

export function createResendSender(cfg: Config, fetchImpl: typeof fetch = fetch): MailSender {
  return async (m) => {
    const res = await fetchImpl(`${cfg.RESEND_API_URL.replace(/\/+$/, '')}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: cfg.MAIL_FROM,
        to: [m.to],
        subject: m.subject,
        html: m.html,
        text: m.text,
        ...(replyTo(cfg, m) ? { reply_to: replyTo(cfg, m) } : {}),
        ...(m.headers && Object.keys(m.headers).length ? { headers: m.headers } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`Resend antwortet ${res.status}: ${body}`);
    }
    const data = (await res.json().catch(() => null)) as { id?: unknown } | null;
    return { id: typeof data?.id === 'string' ? data.id.slice(0, 100) : undefined };
  };
}
