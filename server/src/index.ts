// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { createPool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { startCommuteScheduler } from './services/commuteJob.js';
import { INBOX_RETENTION_DAYS } from './services/inbox.js';

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);
await migrate(db, (m) => console.log(m));

const { app, deps } = await buildApp({ cfg, db });

// Pendler-Modus: jede Minute gespeicherte Strecken prüfen (Verbindung planen, automatische Trackings, Losgeh-Erinnerung)
const commuteScheduler = startCommuteScheduler(deps);
app.addHook('onClose', async () => commuteScheduler.stop());

// Aufräumen: abgelaufene Trackings nach 1 Tag, Meldungen, Feedback und empfangene E-Mails (samt Antworten)
// nach 1 Jahr, Admin-Protokoll nach 180 Tagen, IDs verarbeiteter Webhooks nach 30 Tagen
const cleanup = setInterval(async () => {
  try {
    await db.query(`DELETE FROM trackings WHERE ends_at < now() - interval '1 day'`);
    await db.query(`DELETE FROM reports WHERE reported_at < now() - interval '365 days'`);
    await db.query(`DELETE FROM feedback WHERE created_at < now() - interval '365 days'`);
    await db.query(`DELETE FROM admin_audit WHERE at < now() - interval '180 days'`);
    await db.query(`DELETE FROM inbound_emails WHERE received_at < now() - make_interval(days => $1)`, [INBOX_RETENTION_DAYS]);
    await db.query(`DELETE FROM inbound_webhooks WHERE received_at < now() - interval '30 days'`);
  } catch (err) {
    app.log.warn({ err }, 'Aufräumen fehlgeschlagen');
  }
}, 3600_000);

async function shutdown(signal: string) {
  app.log.info(`${signal} empfangen – fahre herunter`);
  clearInterval(cleanup);
  await app.close();
  await db.end();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: cfg.PORT, host: cfg.HOST });
if (cfg.AUTH_MODE === 'dev') app.log.warn('AUTH_MODE=dev aktiv – "Bearer dev:<name>" wird akzeptiert. Nur lokal benutzen!');
