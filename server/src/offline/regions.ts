// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Städte/Regionen, für die Offline-Fahrpläne gebaut werden (Mittelpunkt + Radius).
 * Eigene Liste: OFFLINE_REGIONS_FILE=/etc/catch-junify/offline-regions.json (gleiches Format).
 */
export interface OfflineRegion {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
}

export const DEFAULT_REGIONS: OfflineRegion[] = [
  // Ganzes Münsterland inkl. RVM-Gebiet (Kreise Borken, Coesfeld, Steinfurt, Warendorf) + Münster.
  // Mittelpunkt bewusst westlich von Münster, damit Bocholt/Gronau und Warendorf/Rheine reinpassen.
  { id: 'muenster', name: 'Münster & Münsterland', lat: 51.93, lon: 7.4, radiusKm: 60 },
  { id: 'berlin', name: 'Berlin', lat: 52.52, lon: 13.405, radiusKm: 30 },
  { id: 'hamburg', name: 'Hamburg', lat: 53.5511, lon: 9.9937, radiusKm: 30 },
  { id: 'muenchen', name: 'München', lat: 48.1372, lon: 11.5755, radiusKm: 30 },
  { id: 'koeln-bonn', name: 'Köln & Bonn', lat: 50.84, lon: 7.03, radiusKm: 30 },
  { id: 'frankfurt', name: 'Frankfurt (Rhein-Main)', lat: 50.1109, lon: 8.6821, radiusKm: 30 },
  { id: 'stuttgart', name: 'Stuttgart', lat: 48.7758, lon: 9.1829, radiusKm: 25 },
  { id: 'duesseldorf', name: 'Düsseldorf', lat: 51.2277, lon: 6.7735, radiusKm: 20 },
  { id: 'ruhr', name: 'Ruhrgebiet (Essen, Dortmund, Bochum)', lat: 51.48, lon: 7.25, radiusKm: 30 },
  { id: 'leipzig', name: 'Leipzig', lat: 51.3397, lon: 12.3731, radiusKm: 20 },
  { id: 'dresden', name: 'Dresden', lat: 51.0504, lon: 13.7373, radiusKm: 20 },
  { id: 'hannover', name: 'Hannover', lat: 52.3759, lon: 9.732, radiusKm: 25 },
  { id: 'nuernberg', name: 'Nürnberg, Fürth & Erlangen', lat: 49.4521, lon: 11.0767, radiusKm: 25 },
  { id: 'bremen', name: 'Bremen', lat: 53.0793, lon: 8.8017, radiusKm: 20 },
];

export const OFFLINE_FORMAT_VERSION = 1;
/** Wie viele Tage ab dem Bautag ein Paket abdeckt. */
export const OFFLINE_DAYS = 14;
