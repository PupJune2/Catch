// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { t, useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth';
import {
  alertKeyFromData,
  configureNotifications,
  markAlertSeen,
  registerForPush,
  syncAlertChannel,
  wasAlertSeen,
} from '@/lib/notifications';
import { useSettings } from '@/lib/settings';
import { useRealtime } from '@/realtime/RealtimeProvider';

/**
 * Verbindet Push-Benachrichtigungen mit der App:
 * - meldet das Gerät nach dem Login beim Server an,
 * - zeigt Pushes, die im Vordergrund ankommen, als Popup (falls nicht schon per WebSocket da),
 * - öffnet beim Antippen einer Benachrichtigung die betroffene Linie.
 */
export function NotificationBridge() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const { showPopup } = useRealtime();
  const registeredFor = useRef<string | null>(null);

  const { lang } = useI18n();

  useEffect(() => {
    configureNotifications().catch(() => undefined);
  }, []);

  // Android-Kanalname an die Sprache anpassen
  useEffect(() => {
    syncAlertChannel().catch(() => undefined);
  }, [lang]);

  // Gerät registrieren
  useEffect(() => {
    if (Platform.OS === 'web' || !user || !settings.push) return;
    if (registeredFor.current === user.uid) return;
    registeredFor.current = user.uid;
    registerForPush().catch(() => undefined);
  }, [user, settings.push]);

  useEffect(() => {
    if (!user) registeredFor.current = null;
  }, [user]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const received = Notifications.addNotificationReceivedListener((n) => {
      const data = n.request.content.data as Record<string, unknown> | undefined;
      if (!data || data.local === true || data.type !== 'alert') return;
      const key = alertKeyFromData(data);
      if (!key || wasAlertSeen(key)) return;
      markAlertSeen(key);
      showPopup({
        key,
        title: n.request.content.title ?? t('alert.reported'),
        message: n.request.content.body ?? '',
        lineKey: typeof data.lineKey === 'string' ? data.lineKey : undefined,
      });
    });

    const openFromData = (data: Record<string, unknown> | undefined) => {
      // Pendler-Modus ("Zeit zu gehen", neue Zeit, Ausfall) → Strecke mit nächster Verbindung öffnen
      if (data?.type === 'commute' && typeof data.commuteId === 'string') {
        router.push({ pathname: '/commute-edit', params: { id: data.commuteId } });
        return;
      }
      const lineKey = data && typeof data.lineKey === 'string' ? data.lineKey : null;
      if (lineKey) router.push(`/line/${encodeURIComponent(lineKey)}`);
      else router.push('/live');
    };

    const responded = Notifications.addNotificationResponseReceivedListener((r) => {
      const data = r.notification.request.content.data as Record<string, unknown> | undefined;
      if (data?.local === true) return;
      openFromData(data);
    });

    // App wurde über eine Benachrichtigung gestartet
    Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        const data = r?.notification.request.content.data as Record<string, unknown> | undefined;
        if (r && data?.local !== true) openFromData(data);
      })
      .catch(() => undefined);

    return () => {
      received.remove();
      responded.remove();
    };
  }, [showPopup]);

  return null;
}
