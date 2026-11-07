// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Vertrauens-System ("Reputation") für Meldende.
 *
 * Punktzahl aus den letzten 90 Tagen (TRUST_WINDOW_DAYS):
 *
 *   score =   Bestätigungen erhalten            (+1 je "noch da")
 *           − Widersprüche erhalten              (−1 je "weg")
 *           − 2 × Markierungen erhalten          ("Inhalt melden")
 *           − 5 × ausgeblendete/gelöschte Meldungen (Moderation oder automatisch)
 *           + min(⌊Meldungen ÷ 5⌋, 4)            (Aktivität, nur nicht ausgeblendete)
 *           + min(⌊Kontoalter in Tagen ÷ 30⌋, 2) (Kontoalter)
 *
 * Stufen (wie bisher): ≥ 50 → 3, ≥ 10 → 2 ("vertrauenswürdig"), ≥ 1 → 1, sonst 0 ("neu").
 * Aktivität und Alter bringen höchstens +6 – Stufe 2 gibt es also nur mit echten Bestätigungen.
 *
 * Wirkung:
 *  - Stufe ≥ 2: Abzeichen "vertrauenswürdig" an Meldungen (die App bekommt nur die Stufe, nie die Person).
 *  - Stufe 0: Meldungen gelten in der App als "unbestätigt", bis jemand sie bestätigt.
 *  - score ≤ TRUST_NEGATIVE (−5): Live-Alarme erst nach der ersten Bestätigung, Meldungen zählen
 *    bis dahin nicht in Linien-Statistik und -Lage, Stimmen zählen nur halb fürs automatische Ausblenden.
 *  - Drosselung (siehe throttle*): ≥ 3 Meldungen in 7 Tagen ausgeblendet/gelöscht oder mit
 *    mindestens 3 Widersprüchen mehr als Bestätigungen → 7 Tage strengere Limits.
 */
import type { Db } from '../db/pool.js';

export const TRUST_WINDOW_DAYS = 90;
/** Ab dieser Punktzahl (oder darunter) gelten Meldungen als "erst nach Bestätigung alarmieren". */
export const TRUST_NEGATIVE = -5;
/** Gewicht der Stimme eines Kontos mit deutlich negativem Vertrauen. */
export const LOW_TRUST_VOTE_WEIGHT = 0.5;

/** Drosselung: so viele umstrittene Meldungen in THROTTLE_WINDOW_DAYS lösen sie aus … */
export const THROTTLE_DISPUTED_REPORTS = 3;
export const THROTTLE_WINDOW_DAYS = 7;
/** … ab so vielen Widersprüchen mehr als Bestätigungen gilt eine Meldung als umstritten. */
export const THROTTLE_NET_DENIALS = 3;
/** … dann gelten für THROTTLE_DAYS diese Limits. */
export const THROTTLE_DAYS = 7;
export const THROTTLED_REPORTS_PER_DAY = 3;
export const THROTTLED_COOLDOWN_MINUTES = 30;

export interface TrustInputs {
  /** Bestätigungen, die die Meldungen des Kontos bekommen haben (90 Tage). */
  confirmations: number;
  denials: number;
  /** Markierungen ("Inhalt melden") auf den Meldungen des Kontos. */
  flags: number;
  /** Ausgeblendete plus vom Admin gelöschte Meldungen. */
  hidden: number;
  /** Meldungen, die nicht ausgeblendet sind. */
  reports: number;
  accountAgeDays: number;
}

export function trustScore(i: TrustInputs): number {
  const activity = Math.min(Math.floor(Math.max(0, i.reports) / 5), 4);
  const age = Math.min(Math.floor(Math.max(0, i.accountAgeDays) / 30), 2);
  return i.confirmations - i.denials - 2 * i.flags - 5 * i.hidden + activity + age;
}

export type TrustLevel = 0 | 1 | 2 | 3;

export function trustLevel(score: number): TrustLevel {
  if (score >= 50) return 3;
  if (score >= 10) return 2;
  if (score >= 1) return 1;
  return 0;
}

/** Stimmgewicht fürs automatische Ausblenden. */
export function voteWeight(score: number): number {
  return score <= TRUST_NEGATIVE ? LOW_TRUST_VOTE_WEIGHT : 1;
}

export interface Trust {
  score: number;
  level: TrustLevel;
  /** Deutlich negativ: Alarme erst nach Bestätigung, halbe Stimme. */
  negative: boolean;
  inputs: TrustInputs;
  /** Drosselung aktiv bis (null = keine). */
  restrictedUntil: Date | null;
  restrictionLiftedAt: Date | null;
}

const NO_TRUST: Trust = {
  score: 0,
  level: 0,
  negative: false,
  inputs: { confirmations: 0, denials: 0, flags: 0, hidden: 0, reports: 0, accountAgeDays: 0 },
  restrictedUntil: null,
  restrictionLiftedAt: null,
};

/** Vertrauen eines Kontos aus der Datenbank (eine Abfrage). Unbekanntes Konto = neu. */
export async function getTrust(db: Db, uid: string): Promise<Trust> {
  const { rows } = await db.query<{
    created_at: Date;
    restricted_until: Date | null;
    restriction_lifted_at: Date | null;
    conf: string;
    den: string;
    flags: string;
    hidden: string;
    ok: string;
    deleted: string;
  }>(
    `SELECT u.created_at, u.restricted_until, u.restriction_lifted_at,
            coalesce(sum(r.confirmations), 0) AS conf,
            coalesce(sum(r.denials), 0) AS den,
            coalesce(sum(r.flags), 0) AS flags,
            count(r.id) FILTER (WHERE r.hidden) AS hidden,
            count(r.id) FILTER (WHERE NOT r.hidden) AS ok,
            (SELECT count(*) FROM moderation_decisions d
              WHERE d.user_id = u.id AND d.action = 'REPORT_DELETE'
                AND d.created_at >= now() - make_interval(days => $2)) AS deleted
     FROM users u
     LEFT JOIN reports r ON r.user_id = u.id AND r.created_at >= now() - make_interval(days => $2)
     WHERE u.id = $1
     GROUP BY u.id`,
    [uid, TRUST_WINDOW_DAYS],
  );
  const u = rows[0];
  if (!u) return NO_TRUST;
  const inputs: TrustInputs = {
    confirmations: Number(u.conf),
    denials: Number(u.den),
    flags: Number(u.flags),
    hidden: Number(u.hidden) + Number(u.deleted),
    reports: Number(u.ok),
    accountAgeDays: Math.floor((Date.now() - u.created_at.getTime()) / 86_400_000),
  };
  const score = trustScore(inputs);
  const restrictedUntil = u.restricted_until && u.restricted_until.getTime() > Date.now() ? u.restricted_until : null;
  return {
    score,
    level: trustLevel(score),
    negative: score <= TRUST_NEGATIVE,
    inputs,
    restrictedUntil,
    restrictionLiftedAt: u.restriction_lifted_at,
  };
}

// --- Drosselung ---------------------------------------------------------------------------

export interface ThrottleInputs {
  /** Meldungen der letzten 7 Tage (seit einer Aufhebung durch den Admin), die ausgeblendet sind. */
  hidden: number;
  /** … die vom Admin gelöscht wurden. */
  deleted: number;
  /** … nicht ausgeblendet, aber mit denials − confirmations ≥ THROTTLE_NET_DENIALS. */
  disputed: number;
}

export function shouldThrottle(i: ThrottleInputs): boolean {
  return i.hidden + i.deleted + i.disputed >= THROTTLE_DISPUTED_REPORTS;
}

/** Zählt die umstrittenen Meldungen eines Kontos im Drossel-Fenster. */
export async function throttleInputs(db: Db, uid: string, liftedAt: Date | null): Promise<ThrottleInputs> {
  const since = new Date(Math.max(Date.now() - THROTTLE_WINDOW_DAYS * 86_400_000, liftedAt?.getTime() ?? 0));
  const { rows } = await db.query<{ hidden: string; disputed: string; deleted: string }>(
    `SELECT
       count(*) FILTER (WHERE hidden) AS hidden,
       count(*) FILTER (WHERE NOT hidden AND denials - confirmations >= $3) AS disputed,
       (SELECT count(*) FROM moderation_decisions d
         WHERE d.user_id = $1 AND d.action = 'REPORT_DELETE' AND d.created_at >= $2) AS deleted
     FROM reports WHERE user_id = $1 AND created_at >= $2`,
    [uid, since, THROTTLE_NET_DENIALS],
  );
  return { hidden: Number(rows[0]?.hidden ?? 0), disputed: Number(rows[0]?.disputed ?? 0), deleted: Number(rows[0]?.deleted ?? 0) };
}
