// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import type { Me } from '../contract.js';
import type { Db } from '../db/pool.js';
import { HttpError } from '../http.js';
import { getTrust } from './trust.js';

/** Stufe 0..3 aus der Vertrauens-Punktzahl (Formel und Wirkung: services/trust.ts). */
export { trustLevel } from './trust.js';

export async function getMe(db: Db, uid: string): Promise<Me> {
  const { rows } = await db.query<{
    id: string;
    email: string | null;
    display_name: string | null;
    created_at: Date;
    terms_accepted_at: Date | null;
    reports: string;
    conf: string | null;
  }>(
    `SELECT u.id, u.email, u.display_name, u.created_at, u.terms_accepted_at,
            (SELECT count(*) FROM reports r WHERE r.user_id = u.id) AS reports,
            (SELECT sum(confirmations) FROM reports r WHERE r.user_id = u.id) AS conf
     FROM users u WHERE u.id = $1`,
    [uid],
  );
  const u = rows[0];
  if (!u) throw new HttpError(404, 'not_found', 'account_not_found');
  const confirmations = Number(u.conf ?? 0);
  const trust = await getTrust(db, uid);
  return {
    uid: u.id,
    email: u.email,
    displayName: u.display_name,
    createdAt: u.created_at.toISOString(),
    reportsCount: Number(u.reports),
    confirmationsReceived: confirmations,
    trustLevel: trust.level,
    termsAcceptedAt: u.terms_accepted_at ? u.terms_accepted_at.toISOString() : null,
    restrictedUntil: trust.restrictedUntil ? trust.restrictedUntil.toISOString() : null,
    alertsNeedConfirmation: trust.negative,
  };
}

/** Nutzungsbedingungen akzeptieren (erster Zeitpunkt bleibt erhalten). */
export async function acceptTerms(db: Db, uid: string): Promise<void> {
  await db.query('UPDATE users SET terms_accepted_at = COALESCE(terms_accepted_at, now()) WHERE id = $1', [uid]);
}

export async function updateDisplayName(db: Db, uid: string, displayName: string): Promise<void> {
  await db.query('UPDATE users SET display_name = $2 WHERE id = $1', [uid, displayName]);
}

/**
 * DSGVO: Konto löschen. Geräte, Trackings, Stimmen werden gelöscht,
 * Meldungen bleiben anonymisiert (user_id = NULL) für die Statistik erhalten.
 */
export async function deleteUser(db: Db, uid: string): Promise<void> {
  await db.query('DELETE FROM users WHERE id = $1', [uid]);
}

export async function registerDevice(db: Db, uid: string, token: string, platform: string): Promise<void> {
  await db.query(
    `INSERT INTO devices (token, user_id, platform) VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now()`,
    [token, uid, platform],
  );
}

export async function unregisterDevice(db: Db, uid: string, token: string): Promise<void> {
  await db.query('DELETE FROM devices WHERE token = $1 AND user_id = $2', [token, uid]);
}
