// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Baut das Widget für einen Zustand (genutzt vom Widget-Task und von der App, wenn sie das
 * Widget selbst aktualisiert). Plattformneutral – die nativen Aufrufe stecken in native.android.ts.
 */
import type { Lang } from '@/i18n';
import type { WidgetConfig } from './config';
import { fetchSnapshot, readCachedSnapshot, type WidgetSnapshot } from './data';
import { DeparturesWidget, type WidgetView } from './DeparturesWidget';

/** Deep-Link: Abfahrtstafel dieser Haltestelle in der App (app/(tabs)/search.tsx liest board/boardName). */
export function boardUri(stop: { id: string; name: string }): string {
  return `catch://search?board=${encodeURIComponent(stop.id)}&boardName=${encodeURIComponent(stop.name)}`;
}

export function widgetElement(view: WidgetView, config: WidgetConfig, lang: Lang, size: { width: number; height: number }, now = Date.now()) {
  return (
    <DeparturesWidget
      view={view}
      lang={lang}
      width={size.width}
      height={size.height}
      now={now}
      openUri={config.stop ? boardUri(config.stop) : undefined}
    />
  );
}

/** Frische Daten holen; ohne Netz den letzten Stand (stale) oder den Fehlerzustand. */
export async function loadView(config: WidgetConfig, lang: Lang, cached?: WidgetSnapshot | null): Promise<WidgetView> {
  if (!config.stop) return { kind: 'empty' };
  try {
    return { kind: 'data', snapshot: await fetchSnapshot(config, lang), stale: false };
  } catch {
    const last = cached === undefined ? await readCachedSnapshot(config) : cached;
    return last ? { kind: 'data', snapshot: last, stale: true } : { kind: 'error', stopName: config.stop.name };
  }
}
