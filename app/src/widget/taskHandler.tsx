// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Headless-Task des Widgets: Android ruft ihn auf, wenn das Widget hinzugefügt, vergrößert,
 * regelmäßig (updatePeriodMillis, ≥ 30 Min) aktualisiert oder angetippt (↻) wird.
 * Läuft ohne sichtbare App – nur AsyncStorage + fetch, keine React-Hooks.
 */
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { readWidgetConfig } from './config';
import { readCachedSnapshot, readLang } from './data';
import { loadView, widgetElement } from './render';

export async function widgetTaskHandler({ widgetInfo, widgetAction, clickAction, renderWidget }: WidgetTaskHandlerProps): Promise<void> {
  if (widgetAction === 'WIDGET_DELETED') return;
  if (widgetAction === 'WIDGET_CLICK' && clickAction !== 'REFRESH') return;

  const [config, lang] = await Promise.all([readWidgetConfig(), readLang()]);
  const size = { width: widgetInfo.width, height: widgetInfo.height };
  const cached = await readCachedSnapshot(config);

  // Sofort etwas zeigen (beim Hinzufügen/Vergrößern/Tippen), dann frische Daten
  if (config.stop && cached && widgetAction !== 'WIDGET_UPDATE') {
    renderWidget(widgetElement({ kind: 'data', snapshot: cached, stale: false, refreshing: true }, config, lang, size));
  }

  const view = await loadView(config, lang, cached);
  renderWidget(widgetElement(view, config, lang, size));
}
