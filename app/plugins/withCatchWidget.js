// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Config-Plugin: Homescreen-Widget "CatchDepartures" (react-native-android-widget) + Korrektur
 * für unseren Java-Namespace.
 *
 * Das Plugin der Bibliothek legt die Widget-Klasse als
 *   android/app/src/main/java/live/junify/catch/widget/CatchDepartures.java
 *   package live.junify.catch.widget;
 * an. "catch" ist in Java ein reserviertes Wort – das kompiliert nicht (deshalb gibt es auch
 * plugins/withAndroidNamespace.js). Im Manifest steht die Klasse relativ als ".widget.CatchDepartures",
 * Android löst das gegen den Gradle-Namespace (live.junify.catchapp) auf. Dieses Plugin verschiebt
 * die erzeugten Dateien deshalb ganz am Ende (finalized-Mod, läuft nach allen anderen) nach
 *   live/junify/catchapp/widget/ und passt die package-Zeile an.
 *
 * Optionen: wie das Bibliotheks-Plugin ({ widgets, fonts }) plus `namespace`.
 */
const fs = require('fs');
const path = require('path');
const { withFinalizedMod } = require('expo/config-plugins');
const withAndroidWidgets = require('react-native-android-widget/app.plugin').default;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function moveTree(fromDir, toDir, fromPkg, toPkg) {
  if (!fs.existsSync(fromDir)) return 0;
  let moved = 0;
  fs.mkdirSync(toDir, { recursive: true });
  // "package live.junify.catch.widget;" → "package live.junify.catchapp.widget;"
  const pkgLine = new RegExp(`^(\\s*package\\s+)${escapeRegExp(fromPkg)}(?=[.;\\s]|$)`, 'm');
  for (const name of fs.readdirSync(fromDir)) {
    const src = path.join(fromDir, name);
    const dst = path.join(toDir, name);
    if (fs.statSync(src).isDirectory()) {
      moved += moveTree(src, dst, fromPkg, toPkg);
      continue;
    }
    const text = fs.readFileSync(src, 'utf8').replace(pkgLine, `$1${toPkg}`);
    fs.writeFileSync(dst, text);
    fs.unlinkSync(src);
    moved += 1;
  }
  try {
    fs.rmdirSync(fromDir);
  } catch {
    /* nicht leer */
  }
  return moved;
}

function withCatchWidget(config, props = {}) {
  const { namespace, ...widgetProps } = props;
  config = withAndroidWidgets(config, widgetProps);

  const appId = config.android && config.android.package;
  if (!namespace || !appId || namespace === appId) return config;

  return withFinalizedMod(config, [
    'android',
    async (c) => {
      const javaRoot = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java');
      const fromRoot = path.join(javaRoot, ...appId.split('.'));
      const toRoot = path.join(javaRoot, ...namespace.split('.'));
      // Nur Unterordner (z. B. widget/) – MainActivity & Co. verschiebt withAndroidNamespace
      if (fs.existsSync(fromRoot)) {
        for (const name of fs.readdirSync(fromRoot)) {
          const src = path.join(fromRoot, name);
          if (fs.statSync(src).isDirectory()) {
            moveTree(src, path.join(toRoot, name), `${appId}.${name}`, `${namespace}.${name}`);
          }
        }
        // leere Ordner live/junify/catch entfernen
        let dir = fromRoot;
        while (dir.startsWith(javaRoot) && dir !== javaRoot) {
          try {
            fs.rmdirSync(dir);
          } catch {
            break;
          }
          dir = path.dirname(dir);
        }
      }
      return c;
    },
  ]);
}

module.exports = withCatchWidget;
