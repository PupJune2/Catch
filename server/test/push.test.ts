// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { describe, expect, it } from 'vitest';
import type { Messaging } from 'firebase-admin/messaging';
import type { TrackingAlert } from '../src/contract.js';
import type { Db } from '../src/db/pool.js';
import { fcmMessage, PushNotifier } from '../src/services/notifier.js';

const alert: TrackingAlert = {
  id: '7', trackingId: '3', onMySegment: true, title: 'Kontrolle auf deinem Abschnitt – U8',
  message: 'Zwischen Moritzplatz und Kottbusser Tor · gerade eben', createdAt: new Date().toISOString(),
  report: {
    id: '42', kind: 'CHECK', lineKey: 'subway:u8:bvg', line: { key: 'subway:u8:bvg', name: 'U8', mode: 'SUBWAY' },
    prevStop: null, nextStop: { id: 'x', name: 'X' }, reportedAt: new Date().toISOString(), tags: [], confirmations: 0, denials: 0,
  },
};

describe('Push', () => {
  it('baut FCM-Nachrichten im expo-notifications-Format', () => {
    const m = fcmMessage('tok', alert) as { token: string; data: Record<string, string>; android: { priority: string } };
    expect(m.token).toBe('tok');
    expect(m.data.title).toContain('U8');
    expect(m.data.channelId).toBe('alerts');
    expect(JSON.parse(m.data.body)).toMatchObject({ type: 'alert', alertId: '7', lineKey: 'subway:u8:bvg', reportId: '42' });
    expect(m.android.priority).toBe('high');
  });

  it('verteilt auf FCM und räumt ungültige Tokens auf', async () => {
    const queries: Array<[string, unknown[] | undefined]> = [];
    const db = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push([sql, params]);
        if (sql.startsWith('SELECT')) return { rows: [
          { token: 'fcm-good', platform: 'android' }, { token: 'fcm-dead', platform: 'android' }, { token: 'apns-x', platform: 'ios' },
        ] };
        return { rows: [] };
      },
    } as unknown as Db;
    const sent: string[] = [];
    const fcm = {
      sendEach: async (msgs: Array<{ token: string }>) => ({
        responses: msgs.map((m) => {
          sent.push(m.token);
          return m.token === 'fcm-dead' ? { success: false, error: { code: 'messaging/registration-token-not-registered', message: 'gone' } } : { success: true };
        }),
      }),
    } as unknown as Messaging;
    const n = new PushNotifier(undefined, fcm, { warn: () => {} });
    await n.sendAlert(db, 'u1', alert);
    expect(sent).toEqual(['fcm-good', 'fcm-dead']); // iOS-Token ohne Expo wird nicht an FCM geschickt
    const del = queries.find(([sql]) => sql.startsWith('DELETE'));
    expect(del?.[1]).toEqual([['fcm-dead']]);
  });
});
