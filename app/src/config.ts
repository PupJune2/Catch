// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Zentrale App-Konfiguration.
 *
 * Hinweis zur Firebase-Konfiguration: Die Web-Config (apiKey, appId, …) ist laut
 * Firebase *kein Geheimnis* – sie identifiziert nur das Projekt und steckt in jeder
 * ausgelieferten App. Die Sicherheit kommt von Firebase Authentication (nur echte,
 * angemeldete Nutzer bekommen ein ID-Token) und davon, dass unser eigener Server
 * jedes Token prüft. Empfehlung: Im Google-Cloud-Console den API-Key auf die
 * App-Bundle-IDs beschränken und später Firebase App Check aktivieren.
 */

// Wichtig: Expo ersetzt nur *statische* Zugriffe wie `process.env.EXPO_PUBLIC_X` beim Bauen.

/** Produktiv-Server (Hetzner, deploy/debian/setup.sh). */
export const DEFAULT_API_URL = 'https://junify.live';

export const API_URL: string = (process.env.EXPO_PUBLIC_API_URL || (__DEV__ ? 'http://localhost:8080' : DEFAULT_API_URL)).replace(/\/+$/, '');

export const WS_URL: string = `${API_URL.replace(/^http/, 'ws')}/v1/ws`;

/**
 * Kartenseite (website/map/, MapLibre + OpenFreeMap) – in der App per WebView, im Web per iframe.
 * Liegt auf der Website-Domain, die auch /v1 ausliefert (die Seite lädt ihre Daten von der eigenen Origin).
 */
export const MAP_URL: string = process.env.EXPO_PUBLIC_MAP_URL || `${API_URL}/map/`;

/** "dev" = Entwickler-Login ohne Firebase (nur lokal, Server braucht AUTH_MODE=dev). */
export const AUTH_MODE: 'firebase' | 'dev' = process.env.EXPO_PUBLIC_AUTH_MODE === 'dev' ? 'dev' : 'firebase';

export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'YOUR_FIREBASE_WEB_API_KEY',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || 'your-firebase-project.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'your-firebase-project',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'your-firebase-project.firebasestorage.app',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || 'YOUR_FIREBASE_SENDER_ID',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || 'YOUR_FIREBASE_WEB_APP_ID',
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID || 'YOUR_FIREBASE_MEASUREMENT_ID',
};

/** Zeitzone, in der alle Uhrzeiten angezeigt werden. */
export const TIME_ZONE = 'Europe/Berlin';

/** Öffentlicher Quellcode (AGPL-3.0) – Pflicht für Open Source und für die Nutzung von Transitous. */
export const SOURCE_URL: string = process.env.EXPO_PUBLIC_SOURCE_URL || 'https://github.com/PupJune2/Catch';

/** Datenquellen, die genannt werden müssen (Lizenzen von Transitous, DELFI, OpenStreetMap). */
export const DATA_SOURCE_URLS = {
  transitous: 'https://transitous.org/sources/',
  delfi: 'https://gtfs.de/',
  osm: 'https://www.openstreetmap.org/copyright',
} as const;

/**
 * Spenden über Ko-fi (Karte "Catch unterstützen" im Profil).
 * Für Store-Builds mit eigenen Zahlungsregeln (z. B. Google Play) mit EXPO_PUBLIC_DONATIONS=off ausblenden.
 */
export const DONATION_URL: string = process.env.EXPO_PUBLIC_DONATION_URL || 'https://ko-fi.com/catchline';
export const DONATIONS_ENABLED: boolean = process.env.EXPO_PUBLIC_DONATIONS !== 'off' && DONATION_URL !== '';
