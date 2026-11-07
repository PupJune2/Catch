// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import type { FastifyInstance } from 'fastify';
import type { WsClientMessage, WsServerMessage } from '../contract.js';
import type { Deps } from '../deps.js';
import { upsertUser, type TokenVerifier } from '../auth/auth.js';
import { isValidLineKey } from '../transit/lineKey.js';
import { DEFAULT_LANG, parseLang, t, type Lang } from '../i18n.js';

/**
 * WebSocket für Live-Ereignisse. Das Token wird als erste Nachricht geschickt
 * (nicht in der URL – URLs landen sonst in Logs).
 */
export async function wsRoutes(app: FastifyInstance, deps: Deps, verify: TokenVerifier) {
  app.get('/v1/ws', { websocket: true }, (socket) => {
    let uid: string | null = null;
    let lang: Lang = DEFAULT_LANG;
    const send = (m: WsServerMessage) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(m));
    };

    // Ohne Lebenszeichen nach 70 s schließen
    let idle = setTimeout(() => socket.close(4000, 'timeout'), 70_000);
    const bump = () => {
      clearTimeout(idle);
      idle = setTimeout(() => socket.close(4000, 'timeout'), 70_000);
    };

    socket.on('message', async (raw: Buffer) => {
      bump();
      let msg: WsClientMessage;
      try {
        if (raw.length > 8_192) throw new Error('too large');
        msg = JSON.parse(raw.toString('utf8')) as WsClientMessage;
      } catch {
        return send({ type: 'error', message: t(lang, 'ws_invalid') });
      }
      switch (msg.type) {
        case 'ping':
          return send({ type: 'pong' });
        case 'auth':
          try {
            const user = await verify(String(msg.token ?? ''));
            const wanted = parseLang(msg.lang);
            if (wanted) lang = wanted;
            await upsertUser(deps.db, user, wanted);
            if (uid) deps.hub.remove(socket);
            uid = user.uid;
            deps.hub.addUser(uid, socket);
            return send({ type: 'hello', uid });
          } catch {
            return send({ type: 'error', message: t(lang, 'ws_auth_failed') });
          }
        case 'watch': {
          const keys = Array.isArray(msg.lineKeys) ? msg.lineKeys.filter((k) => typeof k === 'string' && isValidLineKey(k)) : [];
          deps.hub.watch(socket, keys);
          return;
        }
        default:
          return send({ type: 'error', message: t(lang, 'ws_unknown') });
      }
    });

    socket.on('close', () => {
      clearTimeout(idle);
      deps.hub.remove(socket);
    });

    send({ type: 'hello', uid: null });
  });
}
