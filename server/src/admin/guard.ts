// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Zugangsschutz für den Admin-Bereich – mehrere unabhängige Schichten:
 *  1. optional nur von bestimmten IP-Adressen (ADMIN_ALLOW_IPS)
 *  2. gültiges Firebase-ID-Token (Signatur geprüft; mit Service-Account auch "nicht widerrufen")
 *  3. Firebase-UID steht in ADMIN_UIDS – alle anderen bekommen ein schlichtes 404
 *  4. zweiter Faktor: TOTP-Code (Authenticator-App) → kurzlebige Admin-Sitzung
 *  5. Sperre nach mehreren falschen Codes, Schutz gegen Wiederverwendung eines Codes
 */
import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { getAuth } from 'firebase-admin/auth';
import type { TokenVerifier } from '../auth/auth.js';
import type { Config } from '../config.js';
import { getFirebaseApp } from '../firebase.js';

export interface AdminIdentity {
  uid: string;
  email: string | null;
}

export type AdminTokenVerifier = (token: string) => Promise<AdminIdentity>;

export function parseList(v: string): string[] {
  return v
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Admin-Bereich ist nur aktiv, wenn UIDs und TOTP-Geheimnis gesetzt sind. */
export function adminConfigured(cfg: Config): boolean {
  return parseList(cfg.ADMIN_UIDS).length > 0 && cfg.ADMIN_TOTP_SECRET.trim().length > 0;
}

export function createAdminTokenVerifier(cfg: Config, base: TokenVerifier): AdminTokenVerifier {
  // Entwicklung/Tests: Entwickler-Tokens wie in der restlichen API
  if (cfg.AUTH_MODE === 'dev' && cfg.NODE_ENV !== 'production') {
    return async (token) => {
      const u = await base(token);
      return { uid: u.uid, email: u.email };
    };
  }
  return async (token) => {
    const auth = getAuth(getFirebaseApp(cfg));
    // Mit Service-Account zusätzlich prüfen, ob das Token widerrufen / das Konto gesperrt wurde
    const checkRevoked = Boolean(cfg.FIREBASE_SERVICE_ACCOUNT_FILE);
    const d = await auth.verifyIdToken(token, checkRevoked);
    return { uid: d.uid, email: d.email ?? null };
  };
}

// --- IP-Freigabe ----------------------------------------------------------------------------

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

/** Erlaubt exakte IPs (v4/v6) und IPv4-Netze in CIDR-Schreibweise. */
export function ipAllowed(ip: string, allowList: string[]): boolean {
  if (allowList.length === 0) return true;
  const addr = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  for (const entry of allowList) {
    if (entry === addr) return true;
    const [net, bitsRaw] = entry.split('/');
    if (bitsRaw !== undefined && isIP(net) === 4 && isIP(addr) === 4) {
      const bits = Number(bitsRaw);
      if (!Number.isInteger(bits) || bits < 0 || bits > 32) continue;
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      if ((ipv4ToInt(net) & mask) === (ipv4ToInt(addr) & mask)) return true;
    }
  }
  return false;
}

// --- Sitzungen ------------------------------------------------------------------------------

interface Session {
  uid: string;
  expiresAt: number;
  absoluteEnd: number;
}

/** Sitzungen nur im Speicher (ein Neustart meldet alle ab). Gespeichert wird nur ein Hash. */
export class AdminSessions {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly idleMs: number,
    private readonly maxMs = 8 * 3600_000,
    private readonly now: () => number = Date.now,
  ) {}

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  create(uid: string): { token: string; expiresAt: number } {
    this.sweep();
    const token = randomBytes(32).toString('base64url');
    const t = this.now();
    const s: Session = { uid, expiresAt: t + this.idleMs, absoluteEnd: t + this.maxMs };
    this.sessions.set(AdminSessions.hash(token), s);
    return { token, expiresAt: s.expiresAt };
  }

  /** Gültig für genau diesen Nutzer? Verlängert die Sitzung bei Aktivität. */
  touch(token: string | undefined, uid: string): { expiresAt: number } | null {
    if (!token || token.length > 200) return null;
    const key = AdminSessions.hash(token);
    const s = this.sessions.get(key);
    const t = this.now();
    if (!s) return null;
    if (s.expiresAt <= t || s.absoluteEnd <= t) {
      this.sessions.delete(key);
      return null;
    }
    if (s.uid !== uid) return null;
    s.expiresAt = Math.min(t + this.idleMs, s.absoluteEnd);
    return { expiresAt: s.expiresAt };
  }

  revoke(token: string | undefined): void {
    if (token) this.sessions.delete(AdminSessions.hash(token));
  }

  revokeAll(uid?: string): void {
    for (const [k, s] of this.sessions) if (!uid || s.uid === uid) this.sessions.delete(k);
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, s] of this.sessions) if (s.expiresAt <= t || s.absoluteEnd <= t) this.sessions.delete(k);
  }
}

// --- Sperre nach falschen Codes ---------------------------------------------------------------

export class LoginThrottle {
  private failures: number[] = [];
  private lockedUntil = 0;
  /** Zuletzt angenommener TOTP-Zeitschritt je Nutzer (ein Code gilt nur einmal). */
  private readonly lastCounter = new Map<string, number>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly lockMs = 15 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  lockedFor(): number {
    return Math.max(0, this.lockedUntil - this.now());
  }

  fail(): void {
    const t = this.now();
    this.failures = this.failures.filter((f) => f > t - this.windowMs);
    this.failures.push(t);
    if (this.failures.length >= this.maxFailures) {
      this.lockedUntil = t + this.lockMs;
      this.failures = [];
    }
  }

  /** false, wenn der Code (Zeitschritt) schon einmal benutzt wurde. */
  accept(uid: string, counter: number): boolean {
    const last = this.lastCounter.get(uid);
    if (last !== undefined && counter <= last) return false;
    this.lastCounter.set(uid, counter);
    this.failures = [];
    return true;
  }
}
