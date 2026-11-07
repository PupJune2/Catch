// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/pool.js';
import type { MailSender } from './mail/resend.js';
import type { PushSender, RealtimeHub } from './services/notifier.js';
import type { MotisClient } from './transit/motis.js';

/** Alles, was die Services brauchen – an einer Stelle, damit Tests es leicht ersetzen können. */
export interface Deps {
  cfg: Config;
  db: Db;
  motis: MotisClient;
  hub: RealtimeHub;
  push: PushSender;
  log: FastifyBaseLogger;
  /** Optional: eigener Mail-Versand (Tests); sonst Resend laut Konfiguration. */
  mail?: MailSender;
}
