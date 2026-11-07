// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import * as Linking from 'expo-linking';

import { getLang } from '@/i18n';

export type LegalPage = 'terms' | 'privacy' | 'notice';

/** Rechtstexte auf junify.live – Sprache folgt der App (Englisch ist Standard, Deutsch ist verbindlich). */
const URLS: Record<LegalPage, { en: string; de: string }> = {
  terms: { en: 'https://junify.live/terms', de: 'https://junify.live/nutzungsbedingungen' },
  privacy: { en: 'https://junify.live/privacy', de: 'https://junify.live/datenschutz' },
  notice: { en: 'https://junify.live/legal-notice', de: 'https://junify.live/impressum' },
};

export function legalUrl(page: LegalPage): string {
  return getLang() === 'de' ? URLS[page].de : URLS[page].en;
}

/** Öffnet die Seite im Browser (Web: neuer Tab). */
export function openLegal(page: LegalPage): void {
  Linking.openURL(legalUrl(page)).catch(() => undefined);
}
