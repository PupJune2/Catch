// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Web/iOS: kein Homescreen-Widget (Android-Gegenstück: native.android.ts).
 * Gleiche Schnittstelle, damit Bildschirme ohne Platform-Abfragen auskommen.
 */
export const WIDGET_SUPPORTED = false;

export async function widgetCount(): Promise<number> {
  return 0;
}

export async function updateWidgets(): Promise<void> {
  // nichts zu tun
}

export async function pinWidget(): Promise<boolean> {
  return false;
}
