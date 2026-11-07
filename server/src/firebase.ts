// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Eine gemeinsame Firebase-Admin-Instanz.
 * - Ohne Service-Account: nur Login-Prüfung (dafür reicht die Projekt-ID).
 * - Mit Service-Account (FIREBASE_SERVICE_ACCOUNT_FILE): zusätzlich Push über FCM.
 */
import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import type { Config } from './config.js';

let app: App | null = null;
let hasCredentials = false;

export function getFirebaseApp(cfg: Config): App {
  if (app) return app;
  const existing = getApps()[0];
  if (existing) return (app = existing);
  if (cfg.FIREBASE_SERVICE_ACCOUNT_FILE) {
    const sa = JSON.parse(readFileSync(cfg.FIREBASE_SERVICE_ACCOUNT_FILE, 'utf8')) as { project_id?: string };
    if (sa.project_id && cfg.FIREBASE_PROJECT_ID && sa.project_id !== cfg.FIREBASE_PROJECT_ID) {
      throw new Error(
        `Der Firebase-Service-Account gehört zu Projekt "${sa.project_id}", erwartet wird "${cfg.FIREBASE_PROJECT_ID}".`,
      );
    }
    app = initializeApp({ credential: cert(cfg.FIREBASE_SERVICE_ACCOUNT_FILE), projectId: cfg.FIREBASE_PROJECT_ID || sa.project_id });
    hasCredentials = true;
  } else {
    app = initializeApp({ projectId: cfg.FIREBASE_PROJECT_ID });
  }
  return app;
}

/** true, wenn Push über FCM möglich ist. */
export function firebaseCanSendPush(): boolean {
  return hasCredentials;
}
