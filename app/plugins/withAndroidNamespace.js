// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Config-Plugin: eigener Java/Kotlin-Namespace für Android.
 *
 * Die App-ID (Paketname für Play Store & Firebase) ist "live.junify.catch".
 * "catch" ist aber in Java und Kotlin ein reserviertes Wort – als Quellcode-Paket
 * (Gradle "namespace") ist der Name deshalb ungültig. Android trennt beides:
 * applicationId bleibt live.junify.catch, nur der interne Namespace wird z. B.
 * live.junify.catchapp. Dieses Plugin setzt den Namespace in app/build.gradle und
 * verschiebt die von Expo erzeugten Kotlin-Dateien (MainActivity, MainApplication).
 */
const fs = require('fs');
const path = require('path');
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function withAndroidNamespace(config, props = {}) {
  const namespace = props.namespace;
  const appId = config.android && config.android.package;
  if (!namespace || !appId || namespace === appId) return config;

  config = withAppBuildGradle(config, (c) => {
    c.modResults.contents = c.modResults.contents.replace(
      /namespace\s*=?\s*['"][^'"]+['"]/,
      `namespace '${namespace}'`,
    );
    return c;
  });

  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const javaRoot = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java');
      const fromDir = path.join(javaRoot, ...appId.split('.'));
      const toDir = path.join(javaRoot, ...namespace.split('.'));
      if (!fs.existsSync(fromDir)) return c;
      fs.mkdirSync(toDir, { recursive: true });
      const pkgLine = new RegExp(`^package\\s+${escapeRegExp(appId)}\\s*$`, 'm');
      for (const name of fs.readdirSync(fromDir)) {
        const src = path.join(fromDir, name);
        if (!fs.statSync(src).isFile()) continue;
        const text = fs.readFileSync(src, 'utf8').replace(pkgLine, `package ${namespace}`);
        fs.writeFileSync(path.join(toDir, name), text);
        fs.unlinkSync(src);
      }
      // leere alte Ordner entfernen (live/junify/catch)
      try {
        fs.rmdirSync(fromDir);
      } catch {
        /* nicht leer oder schon weg */
      }
      return c;
    },
  ]);
  return config;
}

module.exports = withAndroidNamespace;
