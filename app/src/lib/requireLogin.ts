// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { router } from 'expo-router';

import type { AppUser } from './auth';

/** Leitet zum Login weiter, wenn niemand angemeldet ist. Gibt true zurück, wenn es weitergehen kann. */
export function requireLogin(user: AppUser | null, reason: string): user is AppUser {
  if (user) return true;
  router.push({ pathname: '/login', params: { reason } });
  return false;
}
