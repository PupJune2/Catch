// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { getAuthToken } from '@/api/client';
import type { Line, Report, TrackingAlert, WsClientMessage, WsServerMessage } from '@/api/contract';
import { WS_URL } from '@/config';
import { getLang, useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { markAlertSeen, playAlertFeedback, wasAlertSeen } from '@/lib/notifications';
import { useSettings } from '@/lib/settings';

/** Ein Eintrag für das globale Alarm-Popup (aus WebSocket oder Push). */
export interface AlertPopup {
  key: string;
  title: string;
  message: string;
  lineKey?: string;
  line?: Line;
  report?: Report;
  onMySegment?: boolean;
}

interface RealtimeContextValue {
  connected: boolean;
  /** Linien beobachten → neue Meldungen kommen über onReport. Gibt "unwatch" zurück. */
  watch(lineKeys: string[]): () => void;
  onReport(listener: (report: Report) => void): () => void;
  /** Wird bei jedem neuen Alarm aufgerufen (z. B. um Listen neu zu laden). */
  onAlert(listener: (alert: TrackingAlert) => void): () => void;
  popups: AlertPopup[];
  showPopup(popup: AlertPopup): void;
  dismissPopup(): void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function alertToPopup(alert: TrackingAlert): AlertPopup {
  return {
    key: alert.id,
    title: alert.title,
    message: alert.message,
    lineKey: alert.report.lineKey,
    line: alert.report.line,
    report: alert.report,
    onMySegment: alert.onMySegment,
  };
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { settings } = useSettings();
  const [connected, setConnected] = useState(false);
  const [popups, setPopups] = useState<AlertPopup[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const watchCounts = useRef(new Map<string, number>());
  const reportListeners = useRef(new Set<(r: Report) => void>());
  const alertListeners = useRef(new Set<(a: TrackingAlert) => void>());
  const soundRef = useRef(settings.sound);
  useEffect(() => {
    soundRef.current = settings.sound;
  }, [settings.sound]);

  const send = useCallback((msg: WsClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const sendWatch = useCallback(() => {
    send({ type: 'watch', lineKeys: [...watchCounts.current.keys()] });
  }, [send]);

  // Sprache geändert → erneut anmelden, damit der Server Alarme/Push in der neuen Sprache schickt
  const { lang } = useI18n();
  const firstLang = useRef(true);
  useEffect(() => {
    if (firstLang.current) {
      firstLang.current = false;
      return;
    }
    getAuthToken()
      .then((token) => {
        if (token) send({ type: 'auth', token, lang });
      })
      .catch(() => undefined);
  }, [lang, send]);

  const showPopup = useCallback((popup: AlertPopup) => {
    setPopups((prev) => (prev.some((p) => p.key === popup.key) ? prev : [...prev, popup]));
  }, []);

  const dismissPopup = useCallback(() => setPopups((prev) => prev.slice(1)), []);

  // Verbindung (neu) aufbauen, wenn sich der Nutzer ändert
  useEffect(() => {
    let closedByUs = false;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const handleMessage = (msg: WsServerMessage) => {
      switch (msg.type) {
        case 'alert': {
          const a = msg.alert;
          alertListeners.current.forEach((l) => l(a));
          if (wasAlertSeen(a.id)) return;
          markAlertSeen(a.id);
          markAlertSeen(a.report.id);
          showPopup(alertToPopup(a));
          playAlertFeedback(soundRef.current);
          return;
        }
        case 'report':
          reportListeners.current.forEach((l) => l(msg.report));
          return;
        default:
          return;
      }
    };

    const connect = () => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = async () => {
        retry = 0;
        setConnected(true);
        const token = await getAuthToken().catch(() => null);
        // lang: Server speichert die Sprache für Push-Texte
        if (token && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'auth', token, lang: getLang() }));
        if (watchCounts.current.size && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'watch', lineKeys: [...watchCounts.current.keys()] }));
        }
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 25_000);
      };
      ws.onmessage = (ev) => {
        try {
          handleMessage(JSON.parse(String(ev.data)) as WsServerMessage);
        } catch {
          // ungültige Nachricht ignorieren
        }
      };
      ws.onerror = () => {
        // onclose folgt und kümmert sich um den Reconnect
      };
      ws.onclose = () => {
        setConnected(false);
        if (pingTimer) clearInterval(pingTimer);
        if (wsRef.current === ws) wsRef.current = null;
        if (!closedByUs) scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      const delay = Math.min(30_000, 1000 * 2 ** retry) + Math.random() * 500;
      retry += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    connect();

    return () => {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [user?.uid, showPopup]);

  const watch = useCallback(
    (lineKeys: string[]) => {
      const keys = [...new Set(lineKeys.filter(Boolean))];
      let changed = false;
      for (const k of keys) {
        const c = watchCounts.current.get(k) ?? 0;
        watchCounts.current.set(k, c + 1);
        if (c === 0) changed = true;
      }
      if (changed) sendWatch();
      return () => {
        let removed = false;
        for (const k of keys) {
          const c = watchCounts.current.get(k) ?? 0;
          if (c <= 1) {
            watchCounts.current.delete(k);
            removed = true;
          } else watchCounts.current.set(k, c - 1);
        }
        if (removed) sendWatch();
      };
    },
    [sendWatch],
  );

  const onReport = useCallback((listener: (r: Report) => void) => {
    reportListeners.current.add(listener);
    return () => {
      reportListeners.current.delete(listener);
    };
  }, []);

  const onAlert = useCallback((listener: (a: TrackingAlert) => void) => {
    alertListeners.current.add(listener);
    return () => {
      alertListeners.current.delete(listener);
    };
  }, []);

  const value = useMemo<RealtimeContextValue>(
    () => ({ connected, watch, onReport, onAlert, popups, showPopup, dismissPopup }),
    [connected, watch, onReport, onAlert, popups, showPopup, dismissPopup],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime muss innerhalb von <RealtimeProvider> verwendet werden');
  return ctx;
}

/** Beobachtet Linien, solange die Komponente sichtbar ist, und ruft bei neuen Meldungen `onNew` auf. */
export function useWatchLines(lineKeys: string[], onNew: (report: Report) => void) {
  const { watch, onReport } = useRealtime();
  const cbRef = useRef(onNew);
  useEffect(() => {
    cbRef.current = onNew;
  });
  const joined = lineKeys.join('|');
  useEffect(() => {
    if (!joined) return;
    const keys = joined.split('|');
    const unwatch = watch(keys);
    const off = onReport((r) => {
      if (keys.includes(r.lineKey)) cbRef.current(r);
    });
    return () => {
      unwatch();
      off();
    };
  }, [joined, watch, onReport]);
}
