// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Web: Service Worker (public/sw.js) registrieren – nur im Produktions-Build und nur über HTTPS
 * (oder localhost zum Testen). Danach schickt die Seite dem Worker die schon geladenen
 * Build-Dateien, damit die App schon nach dem ersten Besuch offline startet.
 * App-Gegenstück: register.ts (no-op).
 */
const READY_FLAG = 'catch.pwa.offlineReady';

const readyListeners = new Set<() => void>();
let readyPending = false;

function notifyReady() {
  let seen = false;
  try {
    seen = localStorage.getItem(READY_FLAG) === '1';
    localStorage.setItem(READY_FLAG, '1');
  } catch {
    seen = true; // ohne Speicher lieber gar nicht melden als bei jedem Start
  }
  if (seen) return;
  if (readyListeners.size === 0) readyPending = true;
  for (const l of readyListeners) l();
}

/** Einmalig (pro Browser): "Catch öffnet sich jetzt auch ohne Internet". */
export function onOfflineReady(listener: () => void): () => void {
  readyListeners.add(listener);
  if (readyPending) {
    readyPending = false;
    listener();
  }
  return () => {
    readyListeners.delete(listener);
  };
}

function loadedStaticUrls(): string[] {
  try {
    return performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((u) => {
        try {
          const url = new URL(u);
          return url.origin === location.origin && (url.pathname.startsWith('/_expo/static/') || url.pathname.startsWith('/assets/'));
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function sendLoaded(reg: ServiceWorkerRegistration) {
  const target = reg.active ?? navigator.serviceWorker.controller;
  target?.postMessage({ type: 'CACHE_URLS', urls: loadedStaticUrls() });
}

export function registerServiceWorker(): void {
  if (__DEV__) return;
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !local) return;

  const start = () => {
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === 'OFFLINE_READY') notifyReady();
    });
    // Nachrichten des Workers sonst evtl. bis zum Setzen von onmessage zurückgehalten
    navigator.serviceWorker.startMessages();
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        sendLoaded(reg);
        // Schriften/Icons lädt die App erst nach dem Start – kurz danach noch einmal
        setTimeout(() => sendLoaded(reg), 5000);
      })
      .catch(() => undefined);
  };

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
