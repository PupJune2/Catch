// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Hintergrund-Task für die automatische Aktualisierung der Offline-Fahrpläne (App: Android/iOS).
 *
 * expo-background-task plant auf Android einen WorkManager-Job (nur mit Netz, App im Hintergrund),
 * auf iOS einen BGTaskScheduler-Task. Das System entscheidet, wann er wirklich läuft – wir bitten
 * um "etwa täglich". Ob tatsächlich geladen wird (WLAN? schon heute geprüft?), entscheidet
 * runAutoUpdate().
 *
 * defineTask() muss beim Laden des Bundles passieren (auch wenn die App nur für den Task im
 * Hintergrund gestartet wird) – deshalb importiert der Einstiegspunkt app/index.ts diese Datei.
 * (Web-Gegenstück: backgroundTask.web.ts, ohne Task.)
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { getAutoUpdateState, runAutoUpdate } from './autoUpdate';
import { offlineStorage } from './storage';

export const OFFLINE_UPDATE_TASK = 'catch-offline-auto-update';
/** "Etwa täglich" – das System verschiebt den Lauf nach eigenem Ermessen. */
const INTERVAL_MINUTES = 24 * 60;

TaskManager.defineTask(OFFLINE_UPDATE_TASK, async () => {
  const outcome = await runAutoUpdate('background');
  return outcome === 'failed' ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
});

let syncing: Promise<void> | null = null;

/**
 * Task an- oder abmelden – passend zur Einstellung und dazu, ob überhaupt eine Stadt installiert ist.
 * Mehrfaches Aufrufen ist harmlos (ein schon geplanter Task wird nicht neu geplant).
 */
export function syncBackgroundUpdateTask(): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const [{ enabled }, installed] = await Promise.all([getAutoUpdateState(), offlineStorage.ensureLoaded()]);
      const want = enabled && installed.length > 0;
      const status = await BackgroundTask.getStatusAsync();
      if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
      const registered = await TaskManager.isTaskRegisteredAsync(OFFLINE_UPDATE_TASK);
      if (want && !registered) {
        await BackgroundTask.registerTaskAsync(OFFLINE_UPDATE_TASK, { minimumInterval: INTERVAL_MINUTES });
      } else if (!want && registered) {
        await BackgroundTask.unregisterTaskAsync(OFFLINE_UPDATE_TASK);
      }
    } catch (e) {
      if (__DEV__) console.log('[offline-auto] background task', e);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

export const backgroundTaskSupported = true;
