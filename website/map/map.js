// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Catch – Karte (MapLibre GL JS, Kacheln von OpenFreeMap).
 *
 * Wird in der App angezeigt: Android/iOS per WebView, Web-App per iframe.
 * Nachrichten-Protokoll (beide Richtungen): app/src/lib/mapProtocol.ts
 *
 * Daten: GET /v1/map?minLat&minLon&maxLat&maxLon (gleiche Origin – die Website wird
 * immer zusammen mit der API ausgeliefert, CSP connect-src 'self').
 * Ohne App (Seite direkt im Browser) startet die Karte nach kurzer Zeit allein,
 * optional mit ?lat=&lon=&z=&lang=.
 */
import * as maplibregl from './vendor/maplibre-gl.js';

// --------------------------------------------------------------------------
// Konstanten
// --------------------------------------------------------------------------

const STYLE_URL = 'https://tiles.openfreemap.org/styles/fiord';
const KINDS = ['DELAY', 'CANCELLED', 'CROWDED', 'DISRUPTION', 'CHECK'];
const KIND_COLOR = { DELAY: '#FFC94D', CANCELLED: '#FF8A8A', CROWDED: '#8FB8FF', DISRUPTION: '#FFA8D2', CHECK: '#7EDCC4' };
const MODE_COLOR = {
  BUS: '#A5027D', TRAM: '#D82020', SUBWAY: '#115D91', SUBURBAN: '#008D4F',
  REGIONAL: '#EC0016', LONG_DISTANCE: '#3C3C3C', FERRY: '#309FD1', OTHER: '#5E6A88',
};
/** Wichtigstes Verkehrsmittel zuerst – bestimmt die Farbe einer Haltestelle. */
const MODE_RANK = ['LONG_DISTANCE', 'REGIONAL', 'SUBURBAN', 'SUBWAY', 'TRAM', 'FERRY', 'BUS', 'OTHER'];
const RAIL_MODES = new Set(['SUBWAY', 'SUBURBAN', 'REGIONAL', 'LONG_DISTANCE']);
const FRESH_MS = 15 * 60_000;
const OLD_MS = 60 * 60_000;
const GERMANY = { center: [10.45, 51.16], zoom: 5.2 };
const STOPS_MIN_ZOOM = 13;
/** Hinweis-Pills überlappen sich ab diesem Abstand (Breite × Höhe in px) → gruppieren. */
const GROUP_DX = 60;
const GROUP_DY = 30;
const FAN_MAX = 4;
const ROW_PX = 32;
const REFRESH_MS = 60_000;
const BG = '#16203A';

const TEXT = {
  en: {
    map: 'Map with live tips',
    zoomIn: 'Zoom in to see stops',
    noTiles: 'Base map unavailable – tips are still shown',
    loadFailed: 'Couldn’t load tips – retrying …',
    offline: 'You’re offline – the map updates when you’re back',
    platformRail: 'Platform {t}',
    platformBus: 'Platform {t}',
    tipsHere: '{n} tips here',
    justNow: 'just now',
    minAgo: '{n} min ago',
    hAgo: '{n} h ago',
    kind: { DELAY: 'Delay', CANCELLED: 'Cancelled', CROWDED: 'Crowded', DISRUPTION: 'Disruption', CHECK: 'Ticket check' },
    osm: 'OpenStreetMap contributors',
  },
  de: {
    map: 'Karte mit Live-Hinweisen',
    zoomIn: 'Zoom näher heran, um Haltestellen zu sehen',
    noTiles: 'Kartenhintergrund nicht verfügbar – Hinweise werden trotzdem gezeigt',
    loadFailed: 'Hinweise konnten nicht geladen werden – neuer Versuch …',
    offline: 'Du bist offline – die Karte aktualisiert sich, sobald du wieder online bist',
    platformRail: 'Gleis {t}',
    platformBus: 'Steig {t}',
    tipsHere: '{n} Hinweise hier',
    justNow: 'gerade eben',
    minAgo: 'vor {n} Min',
    hAgo: 'vor {n} Std',
    kind: { DELAY: 'Verspätung', CANCELLED: 'Ausfall', CROWDED: 'Überfüllt', DISRUPTION: 'Störung', CHECK: 'Kontrolle' },
    osm: 'OpenStreetMap-Mitwirkende',
  },
};

/** Icons der Hinweis-Arten (eigene, schlichte SVGs; Linienfarbe = currentColor). */
const ICON_PATHS = {
  DELAY: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  CANCELLED: '<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>',
  CROWDED: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c0-3.2 2.4-5.2 5.5-5.2s5.5 2 5.5 5.2"/><circle cx="16.5" cy="9.5" r="2.4"/><path d="M15.8 14c2.7.2 4.7 2 4.7 4.9"/>',
  DISRUPTION: '<path d="M12 4 3 19.5h18z"/><path d="M12 10.5v4"/><path d="M12 17.2v.1"/>',
  CHECK: '<path d="M3.5 7.5h17v3a1.8 1.8 0 0 0 0 3.6v3h-17v-3a1.8 1.8 0 0 0 0-3.6z"/><path d="M9 12.2l2 2 4-4"/>',
};
function iconSvg(kind) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[kind] || ICON_PATHS.CHECK}</svg>`;
}

/** Leerer Stil (nur Hintergrund), wenn die Kacheln nicht erreichbar sind. */
const FALLBACK_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#1B2644' } }],
};

// --------------------------------------------------------------------------
// Zustand
// --------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const state = {
  lang: pickLang(params.get('lang') || (navigator.language || 'en')),
  apiBase: location.origin,
  /** null = alle Arten */
  kinds: null,
  reports: [],
  /** id → MapStop (Cache über mehrere Ausschnitte) */
  stops: new Map(),
  stopsHidden: false,
  user: null,
  journey: null,
  selected: null, // { type: 'report' | 'stop', id }
  padding: { top: 0, bottom: 0, left: 0, right: 0 },
  baseOk: null, // true = Kacheln da, false = Fallback, null = unbekannt
  tileErrors: 0,
  dataFailed: false,
  hasData: false,
  interacted: false,
  spreadKey: null,
};

let map = null;
let styleIsBase = false;
const markers = new Map(); // key → { marker, el, sig }
const routeMarkers = [];
let meMarker = null;

function pickLang(l) {
  return String(l).toLowerCase().startsWith('de') ? 'de' : 'en';
}
function tr(key, vars) {
  let s = (TEXT[state.lang] || TEXT.en)[key] ?? TEXT.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

// --------------------------------------------------------------------------
// Kommunikation mit der App
// --------------------------------------------------------------------------

const native = () => typeof window.ReactNativeWebView?.postMessage === 'function';
const framed = window.parent && window.parent !== window;
let parentOrigin = null;
if (framed && !native()) {
  try {
    parentOrigin = (location.ancestorOrigins && location.ancestorOrigins[0]) || null;
  } catch { /* nicht unterstützt */ }
  if (!parentOrigin && document.referrer) {
    try { parentOrigin = new URL(document.referrer).origin; } catch { /* egal */ }
  }
}

function send(msg) {
  try {
    if (native()) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    else if (framed) window.parent.postMessage(msg, parentOrigin || '*');
  } catch { /* App weg – nichts zu tun */ }
}

const handled = new WeakSet();
function onMessage(ev) {
  if (handled.has(ev)) return;
  handled.add(ev);
  if (native()) {
    // Von der WebView selbst ausgelöste Events haben keine Quelle; Fremd-Frames gibt es nicht.
    if (ev.source && ev.source !== window) return;
  } else {
    if (!framed || ev.source !== window.parent) return;
    if (parentOrigin && ev.origin !== parentOrigin) return;
    if (!parentOrigin) parentOrigin = ev.origin; // erste Nachricht legt die Origin fest
  }
  let msg = ev.data;
  if (typeof msg === 'string') {
    try { msg = JSON.parse(msg); } catch { return; }
  }
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
  try {
    handle(msg);
  } catch (e) {
    send({ type: 'error', message: String(e && e.message || e) });
  }
}
window.addEventListener('message', onMessage);
document.addEventListener('message', onMessage); // Android-WebView feuert auf document

function handle(msg) {
  switch (msg.type) {
    case 'init': return applyInit(msg);
    case 'user': return setUser(msg);
    case 'kinds': return setKinds(msg.kinds);
    case 'journey': return setJourney(msg.journey || null, msg.fit !== false);
    case 'fit': return fit(msg);
    case 'padding': return setPadding(msg);
    case 'select': return select(normSelection(msg.selection));
    case 'lang': return setLang(msg.lang);
    case 'refresh': return loadData(true);
    default: return undefined;
  }
}

// --------------------------------------------------------------------------
// Start
// --------------------------------------------------------------------------

maplibregl.setWorkerUrl(new URL('./vendor/maplibre-gl-worker.js', import.meta.url).href);

const stylePromise = fetchStyle();

async function fetchStyle() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(STYLE_URL, { signal: ctrl.signal, credentials: 'omit' });
    if (!res.ok) throw new Error(`style ${res.status}`);
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function applyInit(msg) {
  if (msg.lang) setLang(msg.lang);
  if (typeof msg.apiBase === 'string') setApiBase(msg.apiBase);
  if (msg.padding) setPadding(msg.padding);
  if ('kinds' in msg) state.kinds = normKinds(msg.kinds);
  if (msg.user && isNum(msg.user.lat) && isNum(msg.user.lon)) state.user = { lat: msg.user.lat, lon: msg.user.lon, accuracy: msg.user.accuracy };
  if (msg.journey) state.journey = msg.journey;

  let view;
  if (msg.center && isNum(msg.center.lat) && isNum(msg.center.lon)) {
    view = { center: [msg.center.lon, msg.center.lat], zoom: isNum(msg.zoom) ? msg.zoom : 15 };
  } else if (state.journey && journeyBounds(state.journey)) {
    view = { bounds: journeyBounds(state.journey) };
  } else if (state.user) {
    view = { center: [state.user.lon, state.user.lat], zoom: 15 };
  } else {
    view = GERMANY;
  }

  if (!map) {
    start(view);
  } else {
    renderAll();
    if (view.bounds) fitBounds(view.bounds, false);
    else map.jumpTo(view);
  }
}

let starting = false;
let pendingView = null;

/** Karte anlegen (einmalig). Kommt währenddessen ein neuer Ausschnitt, gilt der neueste. */
async function start(view) {
  pendingView = view;
  if (map || starting) return;
  starting = true;
  // Kurz auf den Kartenstil warten – sonst zuerst ohne Kacheln starten
  const raw = await Promise.race([stylePromise, sleep(4500).then(() => undefined)]);
  view = pendingView || GERMANY;
  const base = raw ? tweakStyle(raw) : null;
  styleIsBase = !!base;
  state.baseOk = base ? null : false;

  map = new maplibregl.Map({
    container: 'map',
    style: base || FALLBACK_STYLE,
    center: view.center || GERMANY.center,
    zoom: view.zoom ?? GERMANY.zoom,
    minZoom: 3,
    maxZoom: 19,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    renderWorldCopies: false,
    fadeDuration: 120,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-left');
  document.getElementById('map').setAttribute('aria-label', tr('map'));

  if (view.bounds) fitBounds(view.bounds, false);

  map.on('style.load', () => {
    ensureLayers();
    renderAll();
  });
  map.on('error', onMapError);
  map.on('sourcedata', (e) => {
    if (e.sourceId === 'openmaptiles' && e.tile && state.baseOk !== true) {
      state.baseOk = true;
      state.tileErrors = 0;
      updateHint();
    }
  });
  map.on('movestart', (e) => {
    if (e.originalEvent) state.interacted = true;
  });
  map.on('moveend', () => {
    renderTips();
    placeRouteLabels();
    scheduleLoad();
    sendMoved();
  });
  map.once('load', sendMoved);
  map.on('click', onMapClick);
  map.on('contextmenu', (e) => sendLongPress(e.lngLat));
  setupLongPress();

  if (!base) {
    // Später erneut versuchen (z. B. wenn das Netz zurück ist)
    stylePromise.then((s) => (s ? switchToBase(s) : undefined));
    window.addEventListener('online', retryBase);
  }

  updateHint();
  loadData(true);
  setInterval(() => {
    if (document.visibilityState === 'visible') loadData(true);
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadData(true);
  });
}

async function retryBase() {
  if (styleIsBase || !map) return;
  const s = await fetchStyle();
  if (s) switchToBase(s);
}

function switchToBase(raw) {
  if (styleIsBase || !map) return;
  styleIsBase = true;
  state.baseOk = null;
  map.setStyle(tweakStyle(raw), { diff: false });
  updateHint();
}

function onMapError(e) {
  const err = e && e.error;
  const msg = String((err && (err.message || err.url)) || '');
  const isBase = e.sourceId === 'openmaptiles' || e.sourceId === 'ne2_shaded' || /openfreemap/.test(msg);
  if (!isBase) return;
  state.tileErrors += 1;
  if (state.tileErrors >= 3 && state.baseOk !== true) {
    state.baseOk = false;
    updateHint();
  }
}

// --------------------------------------------------------------------------
// Kartenstil: OpenFreeMap "fiord", angepasst an das dunkle Navy der App
// --------------------------------------------------------------------------

function tweakStyle(raw) {
  const style = JSON.parse(JSON.stringify(raw));
  const paint = {
    background: { 'background-color': '#1B2644' },
    water: { 'fill-color': '#0E1830' },
    waterway: { 'line-color': '#0E1830', 'line-opacity': 1 },
    landcover_ice_shelf: { 'fill-color': '#22304F' },
    landuse_residential: { 'fill-color': '#202D4D', 'fill-opacity': 0.55 },
    landcover_wood: { 'fill-color': '#1D3247', 'fill-opacity': 0.55 },
    park: { 'fill-color': '#1E3A46', 'fill-opacity': 0.45 },
    park_outline: { 'line-color': '#24435A', 'line-opacity': 0.5 },
    building: { 'fill-color': '#2A3A60', 'fill-opacity': 0.55 },
    tunnel_motorway_casing: { 'line-color': '#2B3A5E' },
    tunnel_motorway_inner: { 'line-color': '#222F4F' },
    'aeroway-taxiway': { 'line-color': '#2E3D62' },
    'aeroway-runway-casing': { 'line-color': '#2E3D62' },
    'aeroway-area': { 'fill-color': '#222F4F' },
    'aeroway-runway': { 'line-color': '#222F4F' },
    road_area_pier: { 'fill-color': '#1B2644' },
    road_pier: { 'line-color': '#1B2644' },
    highway_path: { 'line-color': '#34466E' },
    highway_minor: { 'line-color': '#2B3A5E' },
    highway_major_casing: { 'line-color': '#3A4D7A' },
    highway_major_inner: { 'line-color': '#2D3C62' },
    highway_major_subtle: { 'line-color': '#2D3C62' },
    highway_motorway_casing: { 'line-color': '#46598A' },
    highway_motorway_inner: { 'line-color': '#34466F' },
    highway_motorway_subtle: { 'line-color': 'rgba(120,140,190,0.25)' },
    railway_transit: { 'line-color': '#33426A' },
    railway_transit_dashline: { 'line-color': '#1B2644' },
    railway_service: { 'line-color': '#2F3D62' },
    railway_service_dashline: { 'line-color': '#1B2644' },
    railway: { 'line-color': '#3C4C75' },
    railway_dashline: { 'line-color': '#1B2644' },
    water_name: { 'text-color': '#5E6A88', 'text-halo-color': '#0E1830' },
    highway_name_other: { 'text-color': '#8C97B2', 'text-halo-color': '#1B2644' },
    highway_ref: { 'text-color': '#C9D1E6', 'text-halo-color': '#22304F' },
    boundary_state: { 'line-color': 'rgba(140,151,178,0.3)' },
    'boundary_country_z0-4': { 'line-color': '#8C97B2' },
    'boundary_country_z5-': { 'line-color': '#8C97B2' },
    place_other: { 'text-color': '#8C97B2', 'text-halo-color': 'rgba(22,32,58,0.85)' },
    place_suburb: { 'text-color': '#8C97B2', 'text-halo-color': 'rgba(22,32,58,0.85)' },
    place_village: { 'text-color': '#AEB7CE', 'text-halo-color': 'rgba(22,32,58,0.85)' },
    place_town: { 'text-color': '#C9D1E6', 'text-halo-color': 'rgba(22,32,58,0.85)' },
    place_city: { 'text-color': '#E1E6F2', 'text-halo-color': 'rgba(22,32,58,0.85)' },
    place_city_large: { 'text-color': '#E1E6F2', 'text-halo-color': 'rgba(22,32,58,0.85)' },
    place_state: { 'text-color': '#8C97B2', 'text-halo-color': 'rgba(22,32,58,0.85)' },
  };
  for (const layer of style.layers || []) {
    const p = paint[layer.id];
    if (p) layer.paint = { ...(layer.paint || {}), ...p };
    // Der Stil verweist auf "circle-11", das Sprite enthält "circle_11"
    const icon = layer.layout && layer.layout['icon-image'];
    if (icon && JSON.stringify(icon).includes('circle-11')) {
      layer.layout['icon-image'] = JSON.parse(JSON.stringify(icon).split('circle-11').join('circle_11'));
    }
  }
  // Schattiertes Relief (Natural Earth) passt farblich nicht – aus
  style.layers = (style.layers || []).filter((l) => l.source !== 'ne2_shaded');
  if (style.sources) delete style.sources.ne2_shaded;
  const omt = style.sources && style.sources.openmaptiles;
  if (omt) {
    omt.attribution =
      '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
      '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
      `<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© ${tr('osm')}</a>`;
  }
  return style;
}

// --------------------------------------------------------------------------
// Eigene Quellen & Ebenen (nach jedem Stilwechsel neu)
// --------------------------------------------------------------------------

const EMPTY = { type: 'FeatureCollection', features: [] };

function ensureLayers() {
  const hasGlyphs = !!map.getStyle().glyphs;
  const src = (id) => {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  };
  ['catch-accuracy', 'catch-route', 'catch-stops', 'catch-stop-labels'].forEach(src);
  const add = (layer) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  };

  add({ id: 'catch-accuracy-fill', type: 'fill', source: 'catch-accuracy', paint: { 'fill-color': '#2EC8E6', 'fill-opacity': 0.12 } });
  add({ id: 'catch-accuracy-line', type: 'line', source: 'catch-accuracy', paint: { 'line-color': '#2EC8E6', 'line-opacity': 0.4, 'line-width': 1 } });

  const w = (a, b) => ['interpolate', ['linear'], ['zoom'], 8, a, 16, b];
  add({
    id: 'catch-route-walk',
    type: 'line',
    source: 'catch-route',
    filter: ['==', ['get', 'walk'], true],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#AEB8D0', 'line-width': w(2.5, 4), 'line-dasharray': [0.2, 1.8], 'line-opacity': 0.95 },
  });
  add({
    id: 'catch-route-casing',
    type: 'line',
    source: 'catch-route',
    filter: ['!=', ['get', 'walk'], true],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#FFFFFF', 'line-width': w(5.5, 10), 'line-opacity': 0.92 },
  });
  add({
    id: 'catch-route-line',
    type: 'line',
    source: 'catch-route',
    filter: ['!=', ['get', 'walk'], true],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': w(3, 6.5) },
  });

  const r = (a, b) => ['interpolate', ['linear'], ['zoom'], STOPS_MIN_ZOOM, a, 17, b];
  add({
    id: 'catch-stops-bus',
    type: 'circle',
    source: 'catch-stops',
    minzoom: STOPS_MIN_ZOOM,
    filter: ['!=', ['get', 'rail'], true],
    paint: {
      'circle-radius': r(2.6, 5.5),
      'circle-color': ['get', 'color'],
      'circle-stroke-color': '#FFFFFF',
      'circle-stroke-width': r(1, 1.8),
    },
  });
  add({
    id: 'catch-stops-rail',
    type: 'circle',
    source: 'catch-stops',
    minzoom: STOPS_MIN_ZOOM,
    filter: ['==', ['get', 'rail'], true],
    paint: {
      'circle-radius': r(3.6, 7),
      'circle-color': '#FFFFFF',
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': r(2, 3.2),
    },
  });
  add({
    id: 'catch-stops-selected',
    type: 'circle',
    source: 'catch-stops',
    filter: ['==', ['get', 'id'], ''],
    paint: {
      'circle-radius': r(9, 13),
      'circle-color': 'rgba(199,232,165,0.18)',
      'circle-stroke-color': '#C7E8A5',
      'circle-stroke-width': 3,
    },
  });
  if (hasGlyphs) {
    add({
      id: 'catch-stop-labels',
      type: 'symbol',
      source: 'catch-stop-labels',
      minzoom: 15,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10.5, 18, 13],
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
        'text-max-width': 9,
        'text-padding': 3,
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': '#E6EAF4', 'text-halo-color': BG, 'text-halo-width': 1.4 },
    });
  }
}

// --------------------------------------------------------------------------
// Daten laden
// --------------------------------------------------------------------------

let loadTimer = null;
let loadCtrl = null;
let retryTimer = null;

function scheduleLoad(delay = 280) {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => loadData(false), delay);
}

function viewBox() {
  const b = map.getBounds();
  return {
    minLat: round(clamp(b.getSouth(), -85, 85), 5),
    minLon: round(clamp(b.getWest(), -180, 180), 5),
    maxLat: round(clamp(b.getNorth(), -85, 85), 5),
    maxLon: round(clamp(b.getEast(), -180, 180), 5),
  };
}

let lastKey = '';
async function loadData(force) {
  if (!map) return;
  const box = viewBox();
  const key = `${box.minLat},${box.minLon},${box.maxLat},${box.maxLon}`;
  if (!force && key === lastKey && !state.dataFailed) return;
  lastKey = key;
  if (loadCtrl) loadCtrl.abort();
  const ctrl = new AbortController();
  loadCtrl = ctrl;
  clearTimeout(retryTimer);
  const qs = new URLSearchParams(Object.entries(box).map(([k, v]) => [k, String(v)]));
  try {
    const res = await fetch(`${state.apiBase}/v1/map?${qs}`, {
      signal: ctrl.signal,
      credentials: 'omit',
      headers: { Accept: 'application/json', 'Accept-Language': state.lang },
    });
    if (!res.ok) throw new Error(`map ${res.status}`);
    const data = await res.json();
    if (ctrl !== loadCtrl) return;
    applyData(data);
    state.dataFailed = false;
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    if (ctrl !== loadCtrl) return;
    state.dataFailed = true;
    retryTimer = setTimeout(() => loadData(true), 15_000);
  }
  updateHint();
}

function applyData(data) {
  state.hasData = true;
  state.reports = Array.isArray(data.reports) ? data.reports.filter((r) => r && r.id && posOf(r)) : [];
  state.stopsHidden = !!data.stopsHidden;
  if (Array.isArray(data.stops)) {
    for (const s of data.stops) if (s && s.id && isNum(s.lat) && isNum(s.lon)) state.stops.set(s.id, s);
    // Cache begrenzen: älteste Einträge zuerst raus
    while (state.stops.size > 4000) state.stops.delete(state.stops.keys().next().value);
  }
  renderStops();
  renderTips();
  sendCounts();
}

function sendMoved() {
  const c = map.getCenter();
  send({ type: 'moved', center: { lat: round(c.lat, 6), lon: round(c.lng, 6) }, zoom: round(map.getZoom(), 2), bounds: viewBox() });
}

function sendCounts() {
  const counts = {};
  for (const r of state.reports) counts[kindOf(r)] = (counts[kindOf(r)] || 0) + 1;
  send({ type: 'data', counts, total: state.reports.length, stopsHidden: state.stopsHidden });
}

// --------------------------------------------------------------------------
// Darstellung
// --------------------------------------------------------------------------

function renderAll() {
  renderStops();
  renderTips();
  renderUser();
  renderJourney();
  updateHint();
}

function stopColor(modes) {
  const m = MODE_RANK.find((x) => (modes || []).includes(x)) || 'OTHER';
  return MODE_COLOR[m];
}

function renderStops() {
  if (!map || !map.getSource('catch-stops')) return;
  const features = [];
  const groups = new Map();
  for (const s of state.stops.values()) {
    const modes = Array.isArray(s.modes) ? s.modes : [];
    const rail = modes.some((m) => RAIL_MODES.has(m));
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { id: s.id, color: stopColor(modes), rail },
    });
    const name = shortName(s.name);
    const g = groups.get(name) || { lat: 0, lon: 0, n: 0, rail: false };
    g.lat += s.lat;
    g.lon += s.lon;
    g.n += 1;
    g.rail = g.rail || rail;
    groups.set(name, g);
  }
  map.getSource('catch-stops').setData({ type: 'FeatureCollection', features });
  const labels = [];
  for (const [name, g] of groups) {
    labels.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [g.lon / g.n, g.lat / g.n] },
      properties: { name, rank: g.rail ? 0 : 1 },
    });
  }
  const lsrc = map.getSource('catch-stop-labels');
  if (lsrc) lsrc.setData({ type: 'FeatureCollection', features: labels });
  applyStopSelection();
}

function applyStopSelection() {
  if (!map || !map.getLayer('catch-stops-selected')) return;
  const id = state.selected && state.selected.type === 'stop' ? state.selected.id : '';
  map.setFilter('catch-stops-selected', ['==', ['get', 'id'], id]);
}

function kindOf(r) {
  return KINDS.includes(r.kind) ? r.kind : 'CHECK';
}

function hasPos(s) {
  return s && isNum(s.lat) && isNum(s.lon);
}

/** Position eines Hinweises: Mitte zwischen den beiden Halten (oder der eine, der bekannt ist). */
function posOf(r) {
  const a = hasPos(r.prevStop) ? r.prevStop : null;
  const b = hasPos(r.nextStop) ? r.nextStop : null;
  if (a && b) return [(a.lon + b.lon) / 2, (a.lat + b.lat) / 2];
  const s = a || b;
  return s ? [s.lon, s.lat] : null;
}

function visibleReports() {
  const set = state.kinds;
  return state.reports.filter((r) => !set || set.includes(kindOf(r)));
}

function ageText(iso) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 1) return tr('justNow');
  if (min < 60) return tr('minAgo', { n: min });
  return tr('hAgo', { n: Math.round(min / 60) });
}

function renderTips() {
  if (!map) return;
  const now = Date.now();
  const items = visibleReports()
    .map((r) => ({ r, ll: posOf(r), t: Date.parse(r.reportedAt) || 0 }))
    .sort((a, b) => b.t - a.t);
  items.forEach((it, i) => {
    it.p = map.project(it.ll);
    it.rank = items.length - i; // neuere liegen oben
  });

  // Gruppieren, wenn sich die Pills auf dem Bildschirm überlappen würden (neueste zuerst)
  const groups = [];
  for (const it of items) {
    const g = groups.find((x) => Math.abs(x.p.x - it.p.x) < GROUP_DX && Math.abs(x.p.y - it.p.y) < GROUP_DY);
    if (g) g.items.push(it);
    else groups.push({ p: it.p, items: [it] });
  }

  const zoom = map.getZoom();
  mergeOverlapping(groups, zoom);

  const want = new Map();
  for (const g of groups) {
    const n = g.items.length;
    const gkey = g.items.map((i) => i.r.id).sort().join(',');
    if (n === 1) {
      const it = g.items[0];
      want.set(`r:${it.r.id}`, tipSpec(it, it.ll, [0, 0], now));
      continue;
    }
    const cx = g.items.reduce((s, i) => s + i.p.x, 0) / n;
    const cy = g.items.reduce((s, i) => s + i.p.y, 0) / n;
    const cll = map.unproject([cx, cy]).toArray();
    if (groupStacks(n, gkey, zoom)) {
      // Untereinander stapeln (ab 5 in zwei Spalten), Mitte = gemeinsamer Schwerpunkt
      const cols = n > FAN_MAX ? 2 : 1;
      const rows = Math.ceil(n / cols);
      g.items.forEach((it, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = cols === 1 ? 0 : (col - 0.5) * 76;
        const y = (row - (rows - 1) / 2) * ROW_PX;
        want.set(`r:${it.r.id}`, tipSpec(it, cll, [Math.round(x), Math.round(y)], now));
      });
    } else {
      want.set(`c:${gkey}`, clusterSpec(g.items, cll, gkey, now));
    }
  }
  syncMarkers(want);
  applyTipSelection();
}

/** Stapeln (true) oder als Zahl-Bubble zusammenfassen (false)? */
function groupStacks(n, gkey, zoom) {
  if (n === 1 || state.spreadKey === gkey || zoom >= 17.5) return true;
  // Aus der Ferne lieber zusammenfassen – Stapel würden die Stadt zudecken
  return zoom >= 12.5 ? n <= FAN_MAX : n <= 2;
}

/** Bildschirm-Rechteck, das eine Gruppe einnimmt (Pill, Stapel oder Bubble). */
function groupBox(g, zoom) {
  const n = g.items.length;
  const cx = g.items.reduce((s, i) => s + i.p.x, 0) / n;
  const cy = g.items.reduce((s, i) => s + i.p.y, 0) / n;
  const gkey = g.items.map((i) => i.r.id).sort().join(',');
  let w = 64;
  let h = 30;
  if (n > 1 && groupStacks(n, gkey, zoom)) {
    const cols = n > FAN_MAX ? 2 : 1;
    w = cols * 76;
    h = Math.ceil(n / cols) * ROW_PX;
  } else if (n > 1) {
    w = 60;
    h = 34;
  }
  return { x1: cx - w / 2, x2: cx + w / 2, y1: cy - h / 2, y2: cy + h / 2 };
}

/** Gruppen, deren Darstellung sich überlappt, zusammenlegen (bis nichts mehr überlappt). */
function mergeOverlapping(groups, zoom) {
  for (let pass = 0; pass < 8; pass++) {
    let merged = false;
    for (let i = 0; i < groups.length && !merged; i++) {
      const a = groupBox(groups[i], zoom);
      for (let j = i + 1; j < groups.length; j++) {
        const b = groupBox(groups[j], zoom);
        if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) {
          groups[i].items.push(...groups[j].items);
          groups.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
    if (!merged) return;
  }
}

function tipSpec(it, ll, offset, now) {
  const r = it.r;
  const age = now - it.t;
  const fresh = age < FRESH_MS;
  const old = age > OLD_MS;
  const kind = kindOf(r);
  const label = `${(TEXT[state.lang] || TEXT.en).kind[kind]} · ${r.line && r.line.name ? r.line.name : ''} · ${ageText(r.reportedAt)}`;
  return {
    ll,
    offset,
    z: it.rank,
    sig: `${fresh}|${old}|${state.lang}|${r.line && r.line.name}|${kind}`,
    build() {
      const el = document.createElement('div');
      el.className = 'mk';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', label);
      el.dataset.report = r.id;
      const pill = document.createElement('div');
      pill.className = `tip${fresh ? ' is-fresh' : ''}${old ? ' is-old' : ''}`;
      pill.style.setProperty('--c', KIND_COLOR[kind]);
      const icon = document.createElement('span');
      icon.className = 'tip-icon';
      icon.innerHTML = iconSvg(kind);
      const name = document.createElement('span');
      name.className = 'tip-line';
      name.textContent = r.line && r.line.name ? r.line.name : '';
      pill.append(icon, name);
      el.append(pill);
      const open = (e) => {
        e.stopPropagation();
        const cur = state.reports.find((x) => x.id === r.id) || r;
        select({ type: 'report', id: r.id });
        send({ type: 'report', report: cur });
      };
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') open(e);
      });
      return el;
    },
  };
}

function clusterSpec(items, ll, gkey, now) {
  const kinds = [...new Set(items.map((i) => kindOf(i.r)))].slice(0, 3);
  const fresh = items.some((i) => now - i.t < FRESH_MS);
  return {
    ll,
    offset: [0, 0],
    z: 100000,
    sig: `${items.length}|${kinds.join(',')}|${fresh}|${state.lang}`,
    build() {
      const el = document.createElement('div');
      el.className = 'mk';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', tr('tipsHere', { n: items.length }));
      const c = document.createElement('div');
      c.className = `cluster${fresh ? ' is-fresh' : ''}`;
      const dots = document.createElement('span');
      dots.className = 'cluster-dots';
      for (const k of kinds) {
        const i = document.createElement('i');
        i.style.setProperty('--c', KIND_COLOR[k]);
        dots.append(i);
      }
      const n = document.createElement('span');
      n.textContent = String(items.length);
      c.append(dots, n);
      el.append(c);
      const open = (e) => {
        e.stopPropagation();
        const z = map.getZoom();
        const spreadOut = z >= 16 || samePlace(items);
        if (spreadOut) {
          state.spreadKey = gkey;
          renderTips();
        } else {
          map.easeTo({ center: ll, zoom: Math.min(z + 2, 17), duration: 450 });
        }
      };
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') open(e);
      });
      return el;
    },
  };
}

function samePlace(items) {
  const [a] = items;
  return items.every((i) => Math.abs(i.ll[0] - a.ll[0]) < 1e-4 && Math.abs(i.ll[1] - a.ll[1]) < 1e-4);
}

function syncMarkers(want) {
  for (const [key, m] of markers) {
    if (!want.has(key)) {
      m.marker.remove();
      markers.delete(key);
    }
  }
  for (const [key, w] of want) {
    let m = markers.get(key);
    if (m && m.sig !== w.sig) {
      m.marker.remove();
      markers.delete(key);
      m = null;
    }
    if (!m) {
      const el = w.build();
      const marker = new maplibregl.Marker({ element: el, anchor: 'center', offset: w.offset }).setLngLat(w.ll).addTo(map);
      m = { marker, el, sig: w.sig };
      markers.set(key, m);
    } else {
      m.marker.setLngLat(w.ll);
      m.marker.setOffset(w.offset);
    }
    m.el.style.zIndex = String(10 + w.z);
  }
}

function applyTipSelection() {
  const id = state.selected && state.selected.type === 'report' ? state.selected.id : null;
  for (const m of markers.values()) {
    const on = !!id && m.el.dataset.report === id;
    const pill = m.el.firstElementChild;
    if (pill) pill.classList.toggle('is-selected', on);
    if (on) m.el.style.zIndex = '200000';
  }
}

function normSelection(sel) {
  if (!sel || typeof sel !== 'object' || !sel.id) return null;
  return { type: sel.type === 'stop' ? 'stop' : 'report', id: String(sel.id) };
}

function select(sel) {
  state.selected = sel;
  if (!sel) state.spreadKey = null;
  applyTipSelection();
  applyStopSelection();
  ensureSelectionVisible();
}

// ---- Eigener Standort -------------------------------------------------------

function setUser(msg) {
  if (msg && isNum(msg.lat) && isNum(msg.lon)) state.user = { lat: msg.lat, lon: msg.lon, accuracy: isNum(msg.accuracy) ? msg.accuracy : undefined };
  else state.user = null;
  renderUser();
}

function renderUser() {
  if (!map) return;
  const u = state.user;
  if (!u) {
    if (meMarker) meMarker.remove();
    meMarker = null;
  } else {
    if (!meMarker) {
      const el = document.createElement('div');
      el.className = 'me-wrap';
      const dot = document.createElement('div');
      dot.className = 'me';
      el.append(dot);
      meMarker = new maplibregl.Marker({ element: el, anchor: 'center' });
    }
    meMarker.setLngLat([u.lon, u.lat]).addTo(map);
  }
  const src = map.getSource('catch-accuracy');
  if (src) {
    src.setData(
      u && u.accuracy && u.accuracy > 15
        ? { type: 'FeatureCollection', features: [circlePolygon(u.lon, u.lat, Math.min(u.accuracy, 5000))] }
        : EMPTY,
    );
  }
}

function circlePolygon(lon, lat, meters) {
  const pts = [];
  const dLat = meters / 111320;
  const dLon = meters / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    pts.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} };
}

// ---- Verbindung -------------------------------------------------------------

function setJourney(journey, doFit) {
  state.journey = journey && Array.isArray(journey.legs) ? journey : null;
  renderJourney();
  if (doFit && state.journey) fit({ target: 'journey' });
}

/** Google-Polyline dekodieren → [[lon, lat], …] */
function decodePolyline(str, precision = 5) {
  const factor = 10 ** precision;
  const coords = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < str.length) {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < str.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < str.length);
    lon += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lon / factor, lat / factor]);
  }
  return coords;
}

function legCoords(leg) {
  const g = leg.geometry;
  if (g && typeof g.polyline === 'string' && g.polyline) {
    try {
      const c = decodePolyline(g.polyline, isNum(g.precision) ? g.precision : 5);
      if (c.length >= 2 && c.every(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90)) return c;
    } catch { /* unten: Halte verbinden */ }
  }
  const pts = [];
  const push = (s) => {
    if (hasPos(s)) pts.push([s.lon, s.lat]);
  };
  push(leg.from);
  for (const so of leg.stopovers || []) push(so.stop);
  push(leg.to);
  return pts;
}

function normHex(c) {
  if (!c) return null;
  const v = c.startsWith('#') ? c : `#${c}`;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;
}

function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 170;
}

function legColor(leg) {
  return normHex(leg.line && leg.line.color) || MODE_COLOR[leg.mode] || MODE_COLOR.OTHER;
}

function isWalk(leg) {
  return leg.walking || leg.mode === 'WALK';
}

function platformText(track, mode) {
  if (!track) return '';
  const rail = RAIL_MODES.has(mode);
  return tr(rail ? 'platformRail' : 'platformBus', { t: track });
}

function journeyBounds(j) {
  let minX = 180, minY = 90, maxX = -180, maxY = -90, any = false;
  for (const leg of j.legs || []) {
    for (const [x, y] of legCoords(leg)) {
      any = true;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return any ? [[minX, minY], [maxX, maxY]] : null;
}

function renderJourney() {
  if (!map) return;
  for (const m of routeMarkers.splice(0)) m.remove();
  const src = map.getSource('catch-route');
  const j = state.journey;
  if (!j) {
    if (src) src.setData(EMPTY);
    return;
  }
  const legs = j.legs || [];
  const features = legs
    .map((leg) => ({ leg, coords: legCoords(leg) }))
    .filter((x) => x.coords.length >= 2)
    .map(({ leg, coords }) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: { walk: isWalk(leg), color: legColor(leg) },
    }));
  if (src) src.setData({ type: 'FeatureCollection', features });

  // Punkte: Start, Ziel, Ein-/Ausstiege (mit Gleis/Steig)
  const points = [];
  const addPoint = (stop, kind, sub) => {
    if (!hasPos(stop)) return;
    const near = points.find((p) => Math.abs(p.lat - stop.lat) < 0.0006 && Math.abs(p.lon - stop.lon) < 0.0009);
    if (near) {
      if (sub && !near.subs.includes(sub)) near.subs.push(sub);
      if (kind === 'end') near.kind = 'end';
      if (kind === 'start') near.kind = 'start';
      return;
    }
    points.push({ lat: stop.lat, lon: stop.lon, name: shortName(stop.name), kind, subs: sub ? [sub] : [] });
  };
  legs.forEach((leg, i) => {
    const walk = isWalk(leg);
    const first = i === 0;
    const last = i === legs.length - 1;
    addPoint(leg.from, first ? 'start' : 'via', walk ? '' : platformText(leg.fromTrack, leg.mode));
    addPoint(leg.to, last ? 'end' : 'via', walk ? '' : platformText(leg.toTrack, leg.mode));
  });
  for (const p of points) {
    const el = document.createElement('div');
    el.className = 'rp-wrap';
    const box = document.createElement('div');
    box.className = `rp is-${p.kind}`;
    const dot = document.createElement('div');
    dot.className = 'rp-dot';
    const label = document.createElement('div');
    label.className = 'rp-label';
    const name = document.createElement('span');
    name.className = 'rp-name';
    name.textContent = p.name;
    label.append(name);
    if (p.subs.length) {
      const sub = document.createElement('span');
      sub.className = 'rp-sub';
      sub.textContent = p.subs.join(' → ');
      label.append(sub);
    }
    box.append(dot, label);
    el.append(box);
    routeMarkers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(map));
  }

  // Linien-Badge in der Mitte jedes Fahrt-Abschnitts
  for (const leg of legs) {
    if (isWalk(leg) || !leg.line || !leg.line.name) continue;
    const coords = legCoords(leg);
    if (coords.length < 2) continue;
    const mid = coords[Math.floor(coords.length / 2)];
    const el = document.createElement('div');
    el.className = 'rb-wrap';
    const b = document.createElement('div');
    b.className = 'rb';
    const bg = legColor(leg);
    b.style.setProperty('--c', bg);
    b.style.setProperty('--fg', normHex(leg.line.textColor) || (isLight(bg) ? '#14203A' : '#FFFFFF'));
    b.textContent = leg.line.name;
    el.append(b);
    routeMarkers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(mid).addTo(map));
  }
  placeRouteLabels();
}

/**
 * Beschriftungen am rechten Rand nach links klappen (nicht abschneiden) und überlappende
 * ausblenden: Ziel und Start haben Vorrang, dann Linien-Badges, dann Umstiege.
 */
function placeRouteLabels() {
  if (!map || !routeMarkers.length) return;
  const w = map.getContainer().clientWidth;
  const items = [];
  for (const m of routeMarkers) {
    const el = m.getElement();
    const box = el.querySelector('.rp');
    if (box) {
      const p = map.project(m.getLngLat());
      box.classList.toggle('is-left', p.x > w * 0.6);
      const prio = box.classList.contains('is-end') ? 0 : box.classList.contains('is-start') ? 1 : 3;
      items.push({ label: box.querySelector('.rp-label'), prio });
    } else {
      items.push({ label: el.querySelector('.rb'), prio: 2 });
    }
  }
  items.sort((a, b) => a.prio - b.prio);
  const shown = [];
  for (const it of items) {
    if (!it.label) continue;
    it.label.classList.remove('is-hidden');
    const r = it.label.getBoundingClientRect();
    const hit = shown.some((b) => r.left < b.right + 2 && b.left < r.right + 2 && r.top < b.bottom + 2 && b.top < r.bottom + 2);
    if (hit && it.prio > 1) it.label.classList.add('is-hidden');
    else shown.push(r);
  }
}

// ---- Kamera -----------------------------------------------------------------

function fitPadding() {
  const p = state.padding;
  return { top: (p.top || 0) + 56, bottom: (p.bottom || 0) + 56, left: (p.left || 0) + 36, right: (p.right || 0) + 36 };
}

function fitBounds(bounds, animate = true) {
  if (!map) return;
  const [[x1, y1], [x2, y2]] = bounds;
  const pad = fitPadding();
  const c = map.getContainer();
  // Zu viel Rand für einen kleinen Bildschirm? Dann anteilig verkleinern
  const maxV = Math.max(40, c.clientHeight - 80);
  if (pad.top + pad.bottom > maxV) {
    const f = maxV / (pad.top + pad.bottom);
    pad.top *= f;
    pad.bottom *= f;
  }
  if (x1 === x2 && y1 === y2) {
    map.jumpTo({ center: [x1, y1], zoom: 16 });
    return;
  }
  map.fitBounds(bounds, { padding: pad, maxZoom: 16.5, duration: animate ? 700 : 0 });
}

function fit(msg) {
  if (!map) return;
  if (msg.ifUntouched && state.interacted) return;
  const animate = msg.animate !== false;
  if (msg.target === 'journey' && state.journey) {
    const b = journeyBounds(state.journey);
    if (b) fitBounds(b, animate);
    return;
  }
  if (msg.bounds && isNum(msg.bounds.minLat)) {
    fitBounds([[msg.bounds.minLon, msg.bounds.minLat], [msg.bounds.maxLon, msg.bounds.maxLat]], animate);
    return;
  }
  const c = msg.center || (msg.target === 'user' ? state.user : null);
  if (c && isNum(c.lat) && isNum(c.lon)) {
    const zoom = isNum(msg.zoom) ? msg.zoom : Math.max(map.getZoom(), 15);
    if (animate) map.flyTo({ center: [c.lon, c.lat], zoom, speed: 1.6, curve: 1.3 });
    else map.jumpTo({ center: [c.lon, c.lat], zoom });
  }
}

// ---- Einstellungen aus der App ----------------------------------------------

function setLang(l) {
  const lang = pickLang(l || 'en');
  if (lang === state.lang) return;
  state.lang = lang;
  document.documentElement.lang = lang;
  if (map) {
    document.getElementById('map').setAttribute('aria-label', tr('map'));
    renderTips();
    renderJourney();
  }
  updateHint();
}

function setApiBase(base) {
  // Wegen CSP (connect-src 'self') nur die eigene Origin; ein Pfad-Präfix ist erlaubt.
  try {
    const u = new URL(base, location.href);
    if (u.origin === location.origin) state.apiBase = (u.origin + u.pathname).replace(/\/+$/, '');
  } catch { /* ignorieren */ }
}

function setKinds(kinds) {
  state.kinds = normKinds(kinds);
  state.spreadKey = null;
  renderTips();
}

function normKinds(kinds) {
  if (!Array.isArray(kinds)) return null;
  const k = kinds.filter((x) => KINDS.includes(x));
  return k.length === 0 || k.length === KINDS.length ? null : k;
}

function setPadding(p) {
  const v = (x) => (isNum(x) && x >= 0 ? Math.min(x, 2000) : 0);
  state.padding = { top: v(p.top), bottom: v(p.bottom), left: v(p.left), right: v(p.right) };
  const root = document.documentElement.style;
  root.setProperty('--pad-top', `${state.padding.top}px`);
  root.setProperty('--pad-bottom', `${state.padding.bottom}px`);
  ensureSelectionVisible();
}

/** Ausgewählten Hinweis/Halt in den freien Bereich schieben (z. B. wenn unten eine Karte aufgeht). */
function ensureSelectionVisible() {
  if (!map || !state.selected) return;
  let ll = null;
  if (state.selected.type === 'stop') {
    const s = state.stops.get(state.selected.id);
    if (s) ll = [s.lon, s.lat];
  } else {
    const r = state.reports.find((x) => x.id === state.selected.id);
    if (r) ll = posOf(r);
    const m = markers.get(`r:${state.selected.id}`);
    if (m) ll = m.marker.getLngLat().toArray();
  }
  if (!ll) return;
  const p = map.project(ll);
  const h = map.getContainer().clientHeight;
  const top = state.padding.top + 48;
  const bottom = h - state.padding.bottom - 48;
  if (bottom - top < 40) return;
  let dy = 0;
  if (p.y > bottom) dy = p.y - (top + bottom) / 2;
  else if (p.y < top) dy = p.y - (top + bottom) / 2;
  if (Math.abs(dy) > 2) map.panBy([0, dy], { duration: 350 });
}

// ---- Hinweis-Pill -----------------------------------------------------------

function updateHint() {
  const el = document.getElementById('hint');
  let text = '';
  let cls = '';
  if (state.dataFailed) {
    text = navigator.onLine === false ? tr('offline') : tr('loadFailed');
    cls = 'is-warn';
  } else if (state.baseOk === false) {
    text = tr('noTiles');
    cls = 'is-warn';
  } else if (state.hasData && state.stopsHidden) {
    text = tr('zoomIn');
    cls = 'is-zoom';
  }
  el.textContent = text;
  el.className = `hint ${cls}`;
  el.hidden = !text;
}

// ---- Tippen -----------------------------------------------------------------

function onMapClick(e) {
  const target = e.originalEvent && e.originalEvent.target;
  if (target && target.closest && target.closest('.mk')) return;
  const stop = stopNear(e.point);
  if (stop) {
    select({ type: 'stop', id: stop.id });
    send({ type: 'stop', stop });
    return;
  }
  if (state.selected || state.spreadKey) {
    state.spreadKey = null;
    select(null);
    renderTips();
  }
  send({ type: 'tap', lat: round(e.lngLat.lat, 6), lon: round(e.lngLat.lng, 6) });
}

function stopNear(point) {
  const layers = ['catch-stops-rail', 'catch-stops-bus'].filter((id) => map.getLayer(id));
  if (!layers.length) return null;
  const r = 14;
  const feats = map.queryRenderedFeatures([[point.x - r, point.y - r], [point.x + r, point.y + r]], { layers });
  let best = null;
  let bestD = Infinity;
  for (const f of feats) {
    const s = state.stops.get(f.properties.id);
    if (!s) continue;
    const d = dist(map.project([s.lon, s.lat]), point);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

let lastLongPress = 0;
function sendLongPress(ll) {
  // Android meldet langes Drücken zusätzlich als "contextmenu" – nur einmal senden
  if (Date.now() - lastLongPress < 900) return;
  lastLongPress = Date.now();
  send({ type: 'longpress', lat: round(ll.lat, 6), lon: round(ll.lng, 6) });
}

function setupLongPress() {
  const el = map.getCanvasContainer();
  let timer = null;
  let start = null;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  el.addEventListener('touchstart', (e) => {
    cancel();
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const rect = el.getBoundingClientRect();
    start = { x: t.clientX - rect.left, y: t.clientY - rect.top };
    timer = setTimeout(() => sendLongPress(map.unproject([start.x, start.y])), 600);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!timer || !start) return;
    const t = e.touches[0];
    const rect = el.getBoundingClientRect();
    if (Math.hypot(t.clientX - rect.left - start.x, t.clientY - rect.top - start.y) > 10) cancel();
  }, { passive: true });
  el.addEventListener('touchend', cancel, { passive: true });
  el.addEventListener('touchcancel', cancel, { passive: true });
}

// --------------------------------------------------------------------------
// Helfer
// --------------------------------------------------------------------------

function isNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}
function round(x, d) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
function clamp(x, a, b) {
  return Math.min(b, Math.max(a, x));
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
/** "U Kottbusser Tor (Berlin)" → "U Kottbusser Tor" (wie in der App) */
function shortName(name) {
  if (!name) return '';
  return String(name).replace(/\s*\([^)]*\)\s*$/, '').trim() || String(name);
}

window.addEventListener('resize', () => {
  if (!map) return;
  renderTips();
  placeRouteLabels();
});
window.addEventListener('online', () => loadData(true));
window.addEventListener('error', (e) => send({ type: 'error', message: String(e.message || 'error') }));

// --------------------------------------------------------------------------
// Los geht's: der App Bescheid geben; ohne App nach kurzer Zeit selbst starten
// --------------------------------------------------------------------------

document.documentElement.lang = state.lang;
send({ type: 'ready' });

if (!native() && !framed) {
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  const z = Number(params.get('z'));
  const hasCenter = params.has('lat') && params.has('lon') && Number.isFinite(lat) && Number.isFinite(lon);
  start(hasCenter ? { center: [lon, lat], zoom: Number.isFinite(z) && params.has('z') ? z : 15 } : GERMANY);
} else {
  // Eingebettet: auf "init" warten – kommt keins, trotzdem starten
  setTimeout(() => {
    if (!map) start(GERMANY);
  }, 2500);
}
