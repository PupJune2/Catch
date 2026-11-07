// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** Angezeigte App-Version (Profil-Fußzeile). */
export const APP_VERSION = '0.1';

/** Build-Nummer aus der App-Konfiguration (Android versionCode / iOS buildNumber), falls gesetzt. */
function buildNumber(): string | null {
  const cfg = Constants.expoConfig;
  if (Platform.OS === 'android' && cfg?.android?.versionCode) return String(cfg.android.versionCode);
  if (Platform.OS === 'ios' && cfg?.ios?.buildNumber) return cfg.ios.buildNumber;
  return null;
}

/** Version inkl. Build-Nummer, z. B. "0.1 (6)" – wird mit Feedback mitgeschickt. */
export function appVersionWithBuild(): string {
  const build = buildNumber();
  return build ? `${APP_VERSION} (${build})` : APP_VERSION;
}

/** Plattform für den Server ('ios' | 'android' | 'web'). */
export function appPlatform(): 'ios' | 'android' | 'web' {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
}
