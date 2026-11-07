// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Einstiegspunkt der App (package.json "main").
 *
 * Neben expo-router werden hier Dinge registriert, die auch laufen müssen, wenn das System die App
 * nur im Hintergrund startet (ohne Bildschirm):
 *  - Hintergrund-Task für die automatische Aktualisierung der Offline-Fahrpläne (App)
 *  - Headless-Task des Homescreen-Widgets (nur Android, src/widget/register.android.ts)
 *  - Service Worker der Web-App (nur Web, Produktions-Build, src/pwa/register.web.ts)
 */
import 'expo-router/entry';

import './src/offline/backgroundTask';
import './src/widget/register';
import { registerServiceWorker } from './src/pwa/register';

registerServiceWorker();
