// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Zeitbasierte Einmal-Codes (TOTP, RFC 6238) – kompatibel mit Google Authenticator, Aegis,
 * 1Password, Microsoft Authenticator … (SHA-1, 6 Ziffern, 30 Sekunden).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/\s+/g, '').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('Ungültiges Base32-Zeichen');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(key: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totpCounter(nowMs: number, period = 30): number {
  return Math.floor(nowMs / 1000 / period);
}

/**
 * Prüft einen Code mit ±`window` Zeitschritten Toleranz (Uhrabweichung).
 * Gibt den Zähler des passenden Zeitschritts zurück (für Schutz gegen Wiederverwendung) oder null.
 */
export function verifyTotp(secret: string, code: string, nowMs = Date.now(), window = 1): number | null {
  const c = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secret);
  const now = totpCounter(nowMs);
  let found: number | null = null;
  for (let i = -window; i <= window; i++) {
    const expected = Buffer.from(hotp(key, now + i));
    // Immer alle Schritte prüfen und zeitkonstant vergleichen
    if (timingSafeEqual(expected, Buffer.from(c)) && found === null) found = now + i;
  }
  return found;
}
