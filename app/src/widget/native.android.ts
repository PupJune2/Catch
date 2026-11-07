// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * App-Seite des Widgets (nur Android): Widget neu zeichnen, auf den Homescreen legen,
 * prüfen, ob eins da ist. Gegenstück für Web/iOS: native.ts (alles no-op).
 */
import { getWidgetInfo, requestPinWidget, requestWidgetUpdate } from 'react-native-android-widget';

import { getLang } from '@/i18n';
import { getWidgetConfig } from './config';
import { WIDGET_NAME } from './DeparturesWidget';
import { loadView, widgetElement } from './render';

export const WIDGET_SUPPORTED = true;

/** Anzahl der Catch-Widgets auf dem Homescreen (0 bei Fehler). */
export async function widgetCount(): Promise<number> {
  try {
    return (await getWidgetInfo(WIDGET_NAME)).length;
  } catch {
    return 0;
  }
}

/** Alle Catch-Widgets mit frischen Daten neu zeichnen (z. B. nach Änderung der Auswahl). */
export async function updateWidgets(): Promise<void> {
  try {
    if ((await widgetCount()) === 0) return;
    const config = await getWidgetConfig();
    const lang = getLang();
    const view = await loadView(config, lang);
    await requestWidgetUpdate({
      widgetName: WIDGET_NAME,
      renderWidget: (info) => widgetElement(view, config, lang, { width: info.width, height: info.height }),
    });
  } catch (e) {
    if (__DEV__) console.log('[widget] update failed', e);
  }
}

/**
 * Systemdialog "Widget hinzufügen" (Android 8+, wenn der Launcher es kann).
 * false = nicht unterstützt → Anleitung zeigen.
 */
export async function pinWidget(): Promise<boolean> {
  try {
    return await requestPinWidget({ widgetName: WIDGET_NAME });
  } catch {
    return false;
  }
}
