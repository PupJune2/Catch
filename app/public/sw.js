// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/*
 * Catch – Service Worker der Web-App (app.junify.live).
 *
 * Ziel: Nach einem Besuch mit Internet öffnet sich die App auch offline (z. B. als installierte PWA),
 * die Offline-Fahrpläne liegen ohnehin in IndexedDB.
 *
 *  - HTML-Shell (alle Seiten, SPA): network-first mit kurzem Timeout, offline die zuletzt geladene Shell
 *  - gehashte Build-Dateien (/_expo/static/…, /assets/… inkl. Schriften): cache-first
 *  - Icons, Manifest, Favicon: stale-while-revalidate
 *  - API (/v1/…) und alles von fremden Origins: nie anfassen (immer direkt ans Netz)
 *
 * Neue Version: VERSION erhöhen → beim Aktivieren werden alte Caches gelöscht.
 * Registriert wird nur im Produktions-Build (src/pwa/register.web.ts).
 */
const VERSION = 'v1';
const SHELL_CACHE = `catch-shell-${VERSION}`;
const STATIC_CACHE = `catch-static-${VERSION}`;
const SHELL_KEY = '/';
const NETWORK_TIMEOUT_MS = 4000;
const EXTRA_PRECACHE = ['/manifest.webmanifest', '/favicon.ico', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];

const isHashed = (path) => path.startsWith('/_expo/static/') || path.startsWith('/assets/');
const isRevalidated = (path) => path.startsWith('/icons/') || path === '/manifest.webmanifest' || path === '/favicon.ico';
const isApi = (path) => path === '/v1' || path.startsWith('/v1/') || path === '/health';
/** Server-Pfade neben der App (APK-Download, Website-Teile) – nie durch die App-Shell ersetzen. */
const isServerPath = (path) => /^\/(download|admin|map)(\/|$)/.test(path);

/** Skript-/CSS-Dateien, die eine index.html einbindet (für Precache und Aufräumen). */
function staticUrlsIn(html) {
  const urls = new Set();
  const re = /(?:src|href)="(\/_expo\/static\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html))) urls.add(m[1]);
  return [...urls];
}

async function addAll(cacheName, urls) {
  const cache = await caches.open(cacheName);
  await Promise.all(
    urls.map(async (url) => {
      try {
        if (await cache.match(url)) return;
        const res = await fetch(url, { credentials: 'same-origin' });
        const html = (res.headers.get('content-type') || '').includes('text/html');
        if (res.ok && !html) await cache.put(url, res);
      } catch {
        // offline o. Ä. – beim nächsten Mal
      }
    }),
  );
}

/** Build-Dateien löschen, die die aktuelle Shell nicht mehr braucht (alte Deploys). */
async function pruneStatic(currentUrls) {
  if (!currentUrls.length) return;
  const keep = new Set(currentUrls);
  const cache = await caches.open(STATIC_CACHE);
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/_expo/static/') && !keep.has(path)) await cache.delete(req);
  }
}

/**
 * Seiten-Bundles (expo-router lädt jede Route als eigene Datei nach) stehen als Pfade im
 * Einstiegs-Bundle ("775":"/_expo/static/js/web/map-….js"), ebenso die Schriften. Alle vorab laden –
 * sonst ginge offline nur, was man online schon einmal geöffnet hat.
 */
/** Schriften, die die App wirklich nutzt (Icons: Feather + MaterialCommunityIcons; Plus Jakarta Sans ohne Kursiv). */
const FONT_RE = /\/assets\/[^"'\s\\]+\/(?:Feather|MaterialCommunityIcons|PlusJakartaSans_[4-8]00[A-Za-z]+)\.[0-9a-f]{32}\.ttf/g;

async function chunkUrlsIn(scriptUrls) {
  const cache = await caches.open(STATIC_CACHE);
  const found = new Set();
  for (const url of scriptUrls) {
    if (!url.endsWith('.js')) continue;
    try {
      const res = await cache.match(url);
      if (!res) continue;
      const text = await res.text();
      for (const re of [/\/_expo\/static\/js\/[^"'\s\\]+?\.js/g, FONT_RE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) found.add(m[0]);
      }
    } catch {
      // weiter mit der nächsten Datei
    }
  }
  return [...found];
}

async function storeShell(res) {
  const html = await res.clone().text();
  const cache = await caches.open(SHELL_CACHE);
  await cache.put(SHELL_KEY, res);
  const urls = staticUrlsIn(html);
  await addAll(STATIC_CACHE, urls);
  const chunks = await chunkUrlsIn(urls);
  await addAll(STATIC_CACHE, chunks);
  await pruneStatic([...urls, ...chunks]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch(new Request(SHELL_KEY, { cache: 'reload', credentials: 'same-origin' }));
        if (res.ok) await storeShell(res);
      } catch {
        // ohne Netz installiert – die Shell kommt beim nächsten Online-Aufruf
      }
      await addAll(STATIC_CACHE, EXTRA_PRECACHE);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
      for (const name of await caches.keys()) {
        if (name.startsWith('catch-') && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const OFFLINE_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Catch</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
  'background:#16203A;color:#fff;font:600 16px system-ui,sans-serif;text-align:center;padding:24px}</style></head>' +
  '<body><div>Catch<br><span style="color:#8C97B2;font-weight:500">No connection – please try again. · Keine Verbindung – bitte später erneut versuchen.</span></div></body></html>';

async function shell(event) {
  const network = fetch(event.request);
  try {
    const res = await withTimeout(network, NETWORK_TIMEOUT_MS);
    const type = res.headers.get('content-type') || '';
    if (res.ok && type.includes('text/html')) event.waitUntil(storeShell(res.clone()).catch(() => undefined));
    return res;
  } catch {
    const cached = await caches.match(SHELL_KEY, { cacheName: SHELL_CACHE });
    if (cached) {
      // Langsames Netz: Antwort trotzdem noch für das nächste Mal speichern
      event.waitUntil(
        network
          .then((res) => (res.ok && (res.headers.get('content-type') || '').includes('text/html') ? storeShell(res) : undefined))
          .catch(() => undefined),
      );
      return cached;
    }
    try {
      return await network;
    } catch {
      return new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  }
}

async function cacheFirst(event) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(event.request, { ignoreSearch: false });
  if (hit) return hit;
  const res = await fetch(event.request);
  // SPA-Fallback des Servers (index.html statt fehlender Datei) nicht als Build-Datei speichern
  const html = (res.headers.get('content-type') || '').includes('text/html');
  if (res.ok && res.type === 'basic' && !html) event.waitUntil(cache.put(event.request, res.clone()).catch(() => undefined));
  return res;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(event.request, { ignoreSearch: true });
  const update = fetch(event.request)
    .then((res) => {
      if (res.ok && res.type === 'basic') return cache.put(event.request, res.clone()).then(() => res);
      return res;
    })
    .catch(() => undefined);
  if (hit) {
    event.waitUntil(update);
    return hit;
  }
  const res = await update;
  return res || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Fremde Origins (API auf junify.live, Karte, Firebase …) gehen direkt ans Netz
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (isApi(path) || isServerPath(path) || path === '/sw.js') return;

  if (req.mode === 'navigate') {
    event.respondWith(shell(event));
  } else if (isHashed(path)) {
    event.respondWith(cacheFirst(event));
  } else if (isRevalidated(path)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});

/**
 * Die Seite schickt nach dem Laden ihre bereits geladenen Dateien (Skripte, Schriften), damit sie
 * auch beim allerersten Besuch – bevor der Service Worker die Seite steuert – im Cache landen.
 */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'CACHE_URLS' || !Array.isArray(data.urls)) return;
  const urls = data.urls
    .map((u) => {
      try {
        return new URL(u, self.location.origin);
      } catch {
        return null;
      }
    })
    .filter((u) => u && u.origin === self.location.origin && (isHashed(u.pathname) || isRevalidated(u.pathname)))
    .map((u) => u.pathname + u.search);
  event.waitUntil(
    (async () => {
      await addAll(STATIC_CACHE, urls);
      const hasShell = !!(await caches.match(SHELL_KEY, { cacheName: SHELL_CACHE }));
      if (hasShell && event.source && 'postMessage' in event.source) event.source.postMessage({ type: 'OFFLINE_READY' });
    })(),
  );
});
