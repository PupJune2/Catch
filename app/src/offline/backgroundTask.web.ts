// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Web: kein Hintergrund-Task. Die automatische Aktualisierung läuft dort nur beim Start
 * (siehe AutoUpdateBridge). App-Gegenstück: backgroundTask.ts.
 */
export const OFFLINE_UPDATE_TASK = 'catch-offline-auto-update';

export function syncBackgroundUpdateTask(): Promise<void> {
  return Promise.resolve();
}

export const backgroundTaskSupported = false;
