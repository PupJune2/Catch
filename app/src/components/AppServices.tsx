// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Dienste ohne eigene Oberfläche (im Root-Layout eingehängt):
 *  - Offline-Fahrpläne: automatische Aktualisierung beim Start und beim Zurückkehren in die App
 *    (falls das System den Hintergrund-Task drosselt; im Web nur beim Start) + Hintergrund-Task an-/abmelden
 *  - Homescreen-Widget (Android): beim Verlassen der App mit frischen Daten neu zeichnen
 *  - Web-App: einmaliger Hinweis, sobald Catch auch offline startet (Service Worker)
 */
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { useI18n } from '@/i18n';
import { runAutoUpdate, useAutoUpdateState } from '@/offline/autoUpdate';
import { syncBackgroundUpdateTask } from '@/offline/backgroundTask';
import { useInstalledRegions } from '@/offline/storage';
import { onOfflineReady } from '@/pwa/register';
import { updateWidgets, WIDGET_SUPPORTED } from '@/widget/native';
import { useToast } from './Toast';

/** Erst etwas warten – der Start der App hat Vorrang. */
const START_DELAY_MS = 8000;
const WIDGET_MIN_GAP_MS = 5 * 60_000;

export function AppServices() {
  const { t } = useI18n();
  const toast = useToast();
  const { installed, loaded } = useInstalledRegions();
  const auto = useAutoUpdateState();
  const lastWidgetUpdate = useRef(0);
  const count = installed.length;

  // Hintergrund-Task passend zu Einstellung und installierten Städten
  useEffect(() => {
    if (!loaded || !auto.loaded) return;
    void syncBackgroundUpdateTask();
  }, [loaded, auto.loaded, auto.enabled, count > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Automatische Aktualisierung: beim Start (verzögert) und wenn die App wieder aktiv wird
  useEffect(() => {
    const timer = setTimeout(() => void runAutoUpdate(Platform.OS === 'web' ? 'start' : 'foreground'), START_DELAY_MS);
    if (Platform.OS === 'web') return () => clearTimeout(timer);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void runAutoUpdate('foreground');
      else if (s === 'background' && WIDGET_SUPPORTED && Date.now() - lastWidgetUpdate.current > WIDGET_MIN_GAP_MS) {
        lastWidgetUpdate.current = Date.now();
        void updateWidgets();
      }
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);

  // Web: "Catch öffnet sich jetzt auch ohne Internet" (einmal)
  useEffect(() => onOfflineReady(() => toast(t('pwa.offlineReady'), 'success')), [t, toast]);

  return null;
}
