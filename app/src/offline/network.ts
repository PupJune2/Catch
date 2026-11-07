// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Platform } from 'react-native';

import { ApiError } from '@/api/client';

/** Kein Internet / Server nicht erreichbar (der API-Client meldet das als Status 0, Code "network"). */
export function isNetworkError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 0 && e.code === 'network';
}

/**
 * Weiß das Gerät schon, dass es offline ist? Nur im Web zuverlässig (navigator.onLine) –
 * in der App merken wir es am fehlgeschlagenen Request (schlägt ohne Netz sofort fehl).
 */
export function knownOffline(): boolean {
  return Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.onLine === false;
}
