// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/** Beispieldaten für die Widget-Vorschau, solange keine Haltestelle gewählt ist. */
import type { WidgetSnapshot } from './data';

export function sampleSnapshot(now = Date.now()): WidgetSnapshot {
  const at = (min: number) => new Date(Math.ceil(now / 60000) * 60000 + min * 60000).toISOString();
  const s1 = { key: 'sample:s1', name: 'S1', mode: 'SUBURBAN' as const, color: '#008D4F' };
  const bus = { key: 'sample:bus-10', name: '10', mode: 'BUS' as const, color: '#A5027D' };
  const re = { key: 'sample:re7', name: 'RE7', mode: 'REGIONAL' as const, color: '#EC0016' };
  const u8 = { key: 'sample:u8', name: 'U8', mode: 'SUBWAY' as const, color: '#115D91' };
  return {
    stopId: 'sample',
    stopName: 'Münster Hbf',
    fetchedAt: new Date(now).toISOString(),
    lineStatus: { line: re, level: 'active', lastKind: 'DELAY', lastReportAt: new Date(now - 5 * 60000).toISOString(), recentCount: 2 },
    departures: [
      { tripId: 'a', plannedTime: at(3), time: at(5), delayMin: 2, realtime: true, cancelled: false, line: s1, headsign: 'Flughafen', track: '3', level: 'calm', activeKind: null },
      { tripId: 'b', plannedTime: at(6), time: at(6), delayMin: 0, realtime: true, cancelled: false, line: bus, headsign: 'Gievenbeck', track: 'B1', level: 'frequent', activeKind: null },
      { tripId: 'c', plannedTime: at(9), time: at(14), delayMin: 5, realtime: true, cancelled: false, line: re, headsign: 'Krefeld Hbf', track: '5', plannedTrack: '7', level: 'active', activeKind: 'DELAY' },
      { tripId: 'd', plannedTime: at(12), time: at(12), delayMin: null, realtime: false, cancelled: false, line: u8, headsign: 'Wittenau', level: 'calm', activeKind: null },
      { tripId: 'e', plannedTime: at(15), time: at(15), delayMin: null, realtime: false, cancelled: true, line: bus, headsign: 'Roxel', track: 'B2', level: 'calm', activeKind: null },
    ],
  };
}
