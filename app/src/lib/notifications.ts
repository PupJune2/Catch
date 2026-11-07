// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from '@/api/endpoints';
import { t } from '@/i18n';

export const ALERT_CHANNEL_ID = 'alerts';

/** IDs von Alarmen, die schon per WebSocket angezeigt wurden (gegen doppelte Banner/Töne). */
const seenAlertKeys = new Set<string>();

export function markAlertSeen(key: string | undefined | null) {
  if (!key) return;
  seenAlertKeys.add(key);
  if (seenAlertKeys.size > 200) {
    const first = seenAlertKeys.values().next().value;
    if (first !== undefined) seenAlertKeys.delete(first);
  }
}

export function wasAlertSeen(key: string | undefined | null): boolean {
  return !!key && seenAlertKeys.has(key);
}

/** Schlüssel, über den Push und WebSocket-Alarm als "derselbe" erkannt werden. */
export function alertKeyFromData(data: Record<string, unknown> | undefined | null): string | null {
  if (!data) return null;
  const v = data.alertId ?? data.reportId;
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
}

let configured = false;

/** Einmalig beim App-Start: Verhalten im Vordergrund + Android-Kanal. */
export async function configureNotifications(): Promise<void> {
  if (configured || Platform.OS === 'web') return;
  configured = true;

  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      const key = alertKeyFromData(data);
      // Lokale Benachrichtigung, die wir selbst für den Ton auslösen → nur Ton, kein Banner
      if (data?.local === true) {
        return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: true, shouldSetBadge: false };
      }
      // Alarm schon per WebSocket als Popup gezeigt → nicht doppelt
      if (wasAlertSeen(key)) {
        return { shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false };
      }
      return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
    },
  });

  await syncAlertChannel();
}

/** Android-Kanal anlegen bzw. Name/Beschreibung an die aktuelle Sprache anpassen. */
export async function syncAlertChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ALERT_CHANNEL_ID, {
    name: t('notif.channelName'),
    description: t('notif.channelDesc'),
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 250, 150, 250],
    lightColor: '#FF7A1A',
    enableVibrate: true,
  }).catch(() => undefined);
}

function getProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

export type PushRegistration =
  | { ok: true; token: string }
  | { ok: false; reason: 'web' | 'simulator' | 'denied' | 'no-project' | 'error'; message: string };

/** Fragt nach Erlaubnis, holt ein Push-Token (Expo oder nativ FCM) und meldet es beim Server an. */
export async function registerForPush(): Promise<PushRegistration> {
  if (Platform.OS === 'web') return { ok: false, reason: 'web', message: t('notif.onlyApp') };
  if (!Device.isDevice) {
    return { ok: false, reason: 'simulator', message: t('notif.onlyDevice') };
  }
  try {
    await configureNotifications();
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') {
      return { ok: false, reason: 'denied', message: t('notif.disabled') };
    }
    const projectId = getProjectId();
    let token: string;
    if (projectId) {
      // Mit Expo-Konto (eas init): Expo-Push-Dienst, funktioniert für Android und iOS
      token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    } else if (Platform.OS === 'android') {
      // Ohne Expo-Konto: natives FCM-Token – der Server schickt dann direkt über Firebase.
      // Braucht google-services.json im Build (GitHub Actions legt sie aus einem Secret an).
      try {
        token = String((await Notifications.getDevicePushTokenAsync()).data);
      } catch {
        return {
          ok: false,
          reason: 'no-project',
          message: t('notif.noGoogleServices'),
        };
      }
    } else {
      return {
        ok: false,
        reason: 'no-project',
        message: t('notif.iosProject'),
      };
    }
    await api.registerDevice(token, Platform.OS === 'ios' ? 'ios' : 'android');
    lastToken = token;
    return { ok: true, token };
  } catch (e) {
    return { ok: false, reason: 'error', message: (e as Error)?.message ?? t('notif.failed') };
  }
}

let lastToken: string | null = null;

export async function unregisterPush(): Promise<void> {
  if (!lastToken) return;
  const token = lastToken;
  lastToken = null;
  await api.unregisterDevice(token).catch(() => undefined);
}

/** Ton + Vibration für einen Alarm, während die App offen ist. */
export async function playAlertFeedback(withSound: boolean): Promise<void> {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  if (!withSound) return;
  try {
    await configureNotifications();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Catch',
        body: t('notif.localBody'),
        sound: 'default',
        data: { local: true },
      },
      trigger: Platform.OS === 'android' ? { channelId: ALERT_CHANNEL_ID } : null,
    });
  } catch {
    // Ton ist "nice to have"
  }
}
