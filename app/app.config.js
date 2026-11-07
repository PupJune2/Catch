// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Ergänzt app.json beim Bauen um Werte, die nicht ins Repository gehören
 * oder sich pro Build ändern (z. B. in GitHub Actions).
 *
 *  - google-services.json (Firebase, für Push auf Android) wird nur eingebunden,
 *    wenn die Datei vorhanden ist – ohne sie baut die App trotzdem.
 *  - ANDROID_VERSION_CODE: fortlaufende Build-Nummer, damit Updates installierbar sind.
 *  - EAS_PROJECT_ID: optional, für den Expo-Push-Dienst (eas init).
 *  - Plugins für Hintergrund-Aktualisierung der Offline-Fahrpläne (expo-background-task) und das
 *    Android-Homescreen-Widget (plugins/withCatchWidget.js → react-native-android-widget).
 *    Hinweis: `npx expo prebuild` im Ordner app/ ausführen – das Widget-Plugin der Bibliothek
 *    schreibt relativ zum aktuellen Verzeichnis.
 */
const fs = require('fs');
const path = require('path');

/** Plus Jakarta Sans fürs Widget (wird nach android/app/src/main/assets/fonts kopiert). */
const widgetFonts = ['500Medium', '600SemiBold', '700Bold', '800ExtraBold'].map(
  (w) => `./node_modules/@expo-google-fonts/plus-jakarta-sans/${w}/PlusJakartaSans_${w}.ttf`,
);

/** Homescreen-Widget: Haltestelle mit nächsten Abfahrten + Lage einer Linie (siehe src/widget/). */
const widgetPlugin = [
  './plugins/withCatchWidget',
  {
    // muss zu withAndroidNamespace in app.json passen
    namespace: 'live.junify.catchapp',
    fonts: widgetFonts,
    widgets: [
      {
        name: 'CatchDepartures',
        label: 'Catch',
        description: 'Next departures at your stop and the status of your favourite line',
        // 4×2 Zellen (Android: n × 70 dp − 30 dp), in beide Richtungen veränderbar
        minWidth: '250dp',
        minHeight: '110dp',
        targetCellWidth: 4,
        targetCellHeight: 2,
        resizeMode: 'horizontal|vertical',
        previewImage: './assets/widget/catch-departures-preview.png',
        // Android-Minimum 30 Min. – zusätzlich aktualisiert die App beim Verlassen und auf ↻
        updatePeriodMillis: 30 * 60 * 1000,
      },
    ],
  },
];

module.exports = ({ config }) => {
  config.plugins = [...(config.plugins || []), 'expo-background-task', widgetPlugin];
  const googleServices = process.env.GOOGLE_SERVICES_FILE || './google-services.json';
  if (fs.existsSync(path.resolve(__dirname, googleServices))) {
    config.android = { ...config.android, googleServicesFile: googleServices };
  }
  if (process.env.ANDROID_VERSION_CODE) {
    config.android = { ...config.android, versionCode: Number(process.env.ANDROID_VERSION_CODE) };
  }
  if (process.env.APP_VERSION) {
    config.version = process.env.APP_VERSION;
  }
  if (process.env.EAS_PROJECT_ID) {
    config.extra = { ...config.extra, eas: { ...(config.extra && config.extra.eas), projectId: process.env.EAS_PROJECT_ID } };
  }
  return config;
};
