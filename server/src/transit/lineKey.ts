// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import type { Mode } from '../contract.js';

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/** "S-Bahn Berlin GmbH" → "s-bahn-berlin" */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTS[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(gmbh|mbh|ag|kg|co|aor|ggmbh|se|eg|ev)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** "U 8" → "u8", "Bus M41" → "m41", "RE 1" → "re1" */
export function normalizeLineName(name: string, mode: Mode): string {
  let n = name.toLowerCase().trim();
  if (mode === 'BUS') n = n.replace(/^(bus|nachtbus)\s+/, '');
  if (mode === 'TRAM') n = n.replace(/^(tram|str|strab|straßenbahn)\s+/, '');
  return n.replace(/[äöüß]/g, (c) => UMLAUTS[c] ?? c).replace(/[^a-z0-9]+/g, '');
}

const MODE_SLUG: Record<Mode, string> = {
  BUS: 'bus',
  TRAM: 'tram',
  SUBWAY: 'subway',
  SUBURBAN: 'suburban',
  REGIONAL: 'regional',
  LONG_DISTANCE: 'longdistance',
  FERRY: 'ferry',
  OTHER: 'other',
};

/**
 * Stabiler Schlüssel einer Linie: Verkehrsmittel + Linienname + Betreiber.
 *
 * Bewusst NICHT die GTFS-route_id, weil sich diese bei Fahrplan-Updates ändern kann –
 * dann wären alle bisherigen Statistiken "weg". Der Betreiber verhindert Kollisionen
 * zwischen Städten (Bus 100 in Berlin ≠ Bus 100 in Hamburg).
 */
export function makeLineKey(mode: Mode, name: string, operator?: string | null): string {
  const n = normalizeLineName(name, mode) || 'unbekannt';
  const op = operator ? slugify(operator) : '';
  return `${MODE_SLUG[mode]}:${n}:${op || 'x'}`;
}

export function isValidLineKey(key: string): boolean {
  return /^[a-z]+:[a-z0-9]{1,40}:[a-z0-9-]{1,60}$/.test(key);
}

/** Abbildung der MOTIS/GTFS-Verkehrsmittel auf die Gruppen der App. */
export function mapMode(motisMode: string | undefined): Mode {
  switch (motisMode) {
    case 'BUS':
    case 'COACH':
    case 'ODM':
    case 'RIDE_SHARING':
      return 'BUS';
    case 'TRAM':
    case 'CABLE_CAR':
    case 'FUNICULAR':
    case 'AERIAL_LIFT':
      return 'TRAM';
    case 'SUBWAY':
    case 'METRO':
      return 'SUBWAY';
    case 'SUBURBAN':
      return 'SUBURBAN';
    case 'REGIONAL_RAIL':
    case 'REGIONAL_FAST_RAIL':
    case 'RAIL':
      return 'REGIONAL';
    case 'HIGHSPEED_RAIL':
    case 'LONG_DISTANCE':
    case 'NIGHT_RAIL':
      return 'LONG_DISTANCE';
    case 'FERRY':
      return 'FERRY';
    default:
      return 'OTHER';
  }
}
