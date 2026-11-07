// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Zustellung von Echtzeit-Ereignissen:
 *  - WebSocket an geöffnete Apps (Popup + Ton in der App)
 *  - Push an alle Geräte, auch wenn die App geschlossen ist (Expo-Push oder direkt FCM)
 */
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import type { Message, Messaging } from 'firebase-admin/messaging';
import type { Report, TrackingAlert, WsServerMessage } from '../contract.js';
import type { Db } from '../db/pool.js';

export interface SocketLike {
  send(data: string): void;
  readyState: number;
}

const OPEN = 1;

export class RealtimeHub {
  private readonly byUser = new Map<string, Set<SocketLike>>();
  private readonly byLine = new Map<string, Set<SocketLike>>();
  private readonly watched = new Map<SocketLike, Set<string>>();

  addUser(uid: string, socket: SocketLike): void {
    let set = this.byUser.get(uid);
    if (!set) this.byUser.set(uid, (set = new Set()));
    set.add(socket);
  }

  watch(socket: SocketLike, lineKeys: string[]): void {
    this.unwatchAll(socket);
    const keys = new Set(lineKeys.slice(0, 50));
    this.watched.set(socket, keys);
    for (const k of keys) {
      let set = this.byLine.get(k);
      if (!set) this.byLine.set(k, (set = new Set()));
      set.add(socket);
    }
  }

  private unwatchAll(socket: SocketLike): void {
    for (const k of this.watched.get(socket) ?? []) {
      const set = this.byLine.get(k);
      set?.delete(socket);
      if (set && set.size === 0) this.byLine.delete(k);
    }
    this.watched.delete(socket);
  }

  remove(socket: SocketLike): void {
    this.unwatchAll(socket);
    for (const [uid, set] of this.byUser) {
      set.delete(socket);
      if (set.size === 0) this.byUser.delete(uid);
    }
  }

  sendToUser(uid: string, msg: WsServerMessage): number {
    return this.sendAll(this.byUser.get(uid), msg);
  }

  broadcastReport(report: Report): number {
    return this.sendAll(this.byLine.get(report.lineKey), { type: 'report', report });
  }

  isOnline(uid: string): boolean {
    return (this.byUser.get(uid)?.size ?? 0) > 0;
  }

  stats() {
    return { users: this.byUser.size, watchedLines: this.byLine.size };
  }

  private sendAll(set: Set<SocketLike> | undefined, msg: WsServerMessage): number {
    if (!set) return 0;
    const data = JSON.stringify(msg);
    let n = 0;
    for (const s of set) {
      if (s.readyState !== OPEN) continue;
      try {
        s.send(data);
        n++;
      } catch {
        /* Verbindung bricht gerade ab – ignorieren */
      }
    }
    return n;
  }
}

/** Allgemeine Push (z. B. Pendler-Modus "Zeit zu gehen"): Titel, Text und Daten für die App. */
export interface PushNotice {
  title: string;
  message: string;
  /** Werte als Strings (FCM-Data); `type` sagt der App, was beim Antippen geöffnet wird. */
  data: Record<string, string>;
}

export interface PushSender {
  sendAlert(db: Db, uid: string, alert: TrackingAlert): Promise<void>;
  /** Optional, damit einfache Test-Attrappen ohne sie auskommen (dann keine Pendler-Pushes). */
  sendNotice?(db: Db, uid: string, notice: PushNotice): Promise<void>;
}

/** Daten, die die App zum Zuordnen braucht (Doppel-Anzeige vermeiden, Linie öffnen). */
export function alertPushData(alert: TrackingAlert): Record<string, string> {
  const data: Record<string, string> = {
    type: 'alert',
    alertId: alert.id,
    trackingId: alert.trackingId,
    lineKey: alert.report.lineKey,
    reportId: alert.report.id,
  };
  if (alert.commuteId) data.commuteId = alert.commuteId;
  return data;
}

function alertNotice(alert: TrackingAlert): PushNotice {
  return { title: alert.title, message: alert.message, data: alertPushData(alert) };
}

/**
 * FCM-Nachricht im Format, das expo-notifications auf Android anzeigt
 * (Data-Message: title/message/body/channelId – siehe Expo-Doku
 * "Android push notification payload specification"). So kommen Ton, Kanal und die
 * Daten (für Antippen → Linie öffnen) genauso an wie über den Expo-Push-Dienst.
 */
export function fcmMessage(token: string, alert: TrackingAlert): Message {
  return fcmNoticeMessage(token, alertNotice(alert));
}

export function fcmNoticeMessage(token: string, notice: PushNotice): Message {
  return {
    token,
    data: {
      title: notice.title,
      message: notice.message,
      body: JSON.stringify(notice.data),
      channelId: 'alerts',
      color: '#FF7A1A',
    },
    android: { priority: 'high', ttl: 30 * 60_000 },
  };
}

/**
 * Verschickt Alarme an alle Geräte eines Nutzers:
 *  - Expo-Push-Tokens ("ExponentPushToken[…]") über den Expo-Dienst
 *  - native FCM-Tokens (Android-App ohne Expo-Konto) direkt über Firebase, wenn ein
 *    Service-Account eingerichtet ist
 */
export class PushNotifier implements PushSender {
  private readonly expo: Expo;

  constructor(
    accessToken: string | undefined,
    private readonly fcm: Messaging | null,
    private readonly log: { warn: (o: object, msg: string) => void },
  ) {
    this.expo = new Expo(accessToken ? { accessToken } : {});
  }

  sendAlert(db: Db, uid: string, alert: TrackingAlert): Promise<void> {
    return this.sendNotice(db, uid, alertNotice(alert));
  }

  async sendNotice(db: Db, uid: string, notice: PushNotice): Promise<void> {
    const { rows } = await db.query<{ token: string; platform: string | null }>(
      'SELECT token, platform FROM devices WHERE user_id = $1',
      [uid],
    );
    const expoTokens = rows.map((r) => r.token).filter((t) => Expo.isExpoPushToken(t));
    const fcmTokens = rows.filter((r) => !Expo.isExpoPushToken(r.token) && r.platform === 'android').map((r) => r.token);
    const dead: string[] = [];
    await Promise.all([this.sendExpo(expoTokens, notice, dead), this.sendFcm(fcmTokens, notice, dead)]);
    // Abgemeldete/ungültige Geräte aufräumen
    if (dead.length) await db.query('DELETE FROM devices WHERE token = ANY($1)', [dead]);
  }

  private async sendExpo(tokens: string[], notice: PushNotice, dead: string[]): Promise<void> {
    if (tokens.length === 0) return;
    const messages: ExpoPushMessage[] = tokens.map((to) => ({
      to,
      title: notice.title,
      body: notice.message,
      sound: 'default',
      priority: 'high',
      channelId: 'alerts',
      interruptionLevel: 'time-sensitive',
      data: notice.data,
    }));
    for (const chunk of this.expo.chunkPushNotifications(messages)) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.forEach((t, i) => {
          if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') {
            const to = chunk[i]?.to;
            if (typeof to === 'string') dead.push(to);
          }
        });
      } catch (err) {
        this.log.warn({ err }, 'Expo-Push fehlgeschlagen');
      }
    }
  }

  private async sendFcm(tokens: string[], notice: PushNotice, dead: string[]): Promise<void> {
    if (tokens.length === 0) return;
    if (!this.fcm) {
      this.log.warn({ count: tokens.length }, 'FCM-Tokens vorhanden, aber kein Firebase-Service-Account eingerichtet');
      return;
    }
    try {
      const res = await this.fcm.sendEach(tokens.map((t) => fcmNoticeMessage(t, notice)));
      res.responses.forEach((r, i) => {
        const code = r.error?.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
          dead.push(tokens[i]);
        } else if (r.error) {
          this.log.warn({ code, msg: r.error.message }, 'FCM-Zustellung fehlgeschlagen');
        }
      });
    } catch (err) {
      this.log.warn({ err }, 'FCM-Push fehlgeschlagen');
    }
  }
}
