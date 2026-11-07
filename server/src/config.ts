// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { z } from 'zod';
import { webhookKey } from './mail/inbound.js';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGIN: z.string().default('*'),

  DATABASE_URL: z.string().default('postgres://catch:catch@localhost:5432/catch'),

  AUTH_MODE: z.enum(['firebase', 'dev']).default('firebase'),
  FIREBASE_PROJECT_ID: z.string().default(''),
  /** Optional: Service-Account-JSON für Push direkt über Firebase Cloud Messaging. */
  FIREBASE_SERVICE_ACCOUNT_FILE: z.string().optional(),

  MOTIS_URL: z.string().url().default('https://api.transitous.org'),
  TRANSIT_USER_AGENT: z.string().default('catch/dev (+https://junify.live)'),
  TRANSIT_TIMEOUT_MS: z.coerce.number().int().default(12_000),

  EXPO_ACCESS_TOKEN: z.string().optional(),

  RECENT_MINUTES: z.coerce.number().int().min(5).max(240).default(60),
  REPORT_COOLDOWN_MINUTES: z.coerce.number().int().min(0).max(120).default(10),
  REPORTS_PER_DAY: z.coerce.number().int().min(1).max(500).default(20),
  /** Ab so vielen Meldungen in 30 Tagen gilt eine Linie als "oft kontrolliert". */
  FREQUENT_THRESHOLD: z.coerce.number().int().min(1).default(5),

  // --- Admin-Bereich (/v1/admin, Seite /admin/) ---------------------------------------
  /** Firebase-UIDs mit Admin-Zugang, kommagetrennt. Leer = Admin-Bereich aus. */
  ADMIN_UIDS: z.string().default(''),
  /** TOTP-Geheimnis (Base32) für den zweiten Faktor. Leer = Admin-Bereich aus. `sudo catch-admin 2fa` */
  ADMIN_TOTP_SECRET: z.string().default(''),
  /** Optional: nur von diesen IPs (kommagetrennt, IPv4 auch als CIDR, z. B. 203.0.113.0/24). */
  ADMIN_ALLOW_IPS: z.string().default(''),
  /** Admin-Sitzung läuft nach so vielen Minuten ohne Aktivität ab. */
  ADMIN_SESSION_MINUTES: z.coerce.number().int().min(5).max(240).default(30),

  // --- E-Mails (Passwort zurücksetzen) über Resend ------------------------------------------
  /** API-Key von resend.com. Leer = Catch-Mails aus, die App nutzt dann die Standard-Mail von Firebase. */
  RESEND_API_KEY: z.string().default(''),
  /** Absender – die Domain muss bei Resend verifiziert sein. */
  MAIL_FROM: z.string().default('Catch <noreply@junify.live>'),
  /** Öffentliche Adresse der Website (Links in Mails, Logo). */
  CATCH_PUBLIC_URL: z.string().url().default('https://junify.live'),
  RESEND_API_URL: z.string().url().default('https://api.resend.com'),
  /** Optional: Antwortadresse (reply_to) aller Catch-Mails, z. B. die Kontaktadresse des Betreibers. */
  MAIL_REPLY_TO: z.union([z.literal(''), z.string().trim().email()]).default(''),
  /** Optional: Kontaktadresse für Einsprüche gegen Moderations-Entscheidungen (falls kein MAIL_REPLY_TO). */
  CONTACT_EMAIL: z.union([z.literal(''), z.string().trim().email()]).default(''),

  // --- E-Mails empfangen (Resend Receiving → Admin-Bereich „Inbox") --------------------------
  /** Signing secret des Resend-Webhooks (whsec_…). Leer = Empfang aus, /v1/mail/inbound antwortet 404. */
  RESEND_WEBHOOK_SECRET: z.string().trim().default(''),
  /** Optional: API-Key mit Full access zum Lesen empfangener Mails (sonst RESEND_API_KEY). */
  RESEND_INBOUND_API_KEY: z.string().trim().default(''),

  /** Ordner mit den Offline-Fahrplänen (index.json + <id>.json.gz). Leer = Funktion aus. */
  OFFLINE_DIR: z.string().default(''),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ungültige Konfiguration:\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production' && cfg.AUTH_MODE === 'dev') {
    throw new Error('AUTH_MODE=dev ist in Produktion verboten (jeder könnte sich als beliebiger Nutzer ausgeben).');
  }
  if (cfg.ADMIN_TOTP_SECRET && !/^[A-Z2-7]{16,}=*$/.test(cfg.ADMIN_TOTP_SECRET.replace(/\s+/g, '').toUpperCase())) {
    throw new Error('ADMIN_TOTP_SECRET ist kein gültiges Base32-Geheimnis (mind. 16 Zeichen A–Z, 2–7). Neu erzeugen: sudo catch-admin 2fa --reset');
  }
  if (cfg.RESEND_WEBHOOK_SECRET && !webhookKey(cfg.RESEND_WEBHOOK_SECRET)) {
    throw new Error('RESEND_WEBHOOK_SECRET ist kein gültiges Webhook-Secret (whsec_… aus Resend → Webhooks). Neu setzen: sudo catch-admin resend-webhook');
  }
  if (cfg.AUTH_MODE === 'firebase' && !cfg.FIREBASE_PROJECT_ID) {
    throw new Error('FIREBASE_PROJECT_ID fehlt (z. B. "your-firebase-project").');
  }
  return cfg;
}
