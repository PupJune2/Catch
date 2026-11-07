// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { describe, expect, it } from 'vitest';
import { gtfsSeconds, haversineKm, loadRegions, modeOf, parseCsvLine } from '../src/offline/build.js';
import { DEFAULT_REGIONS } from '../src/offline/regions.js';

describe('Offline-Fahrpläne: Aufbau', () => {
  it('liest CSV-Zeilen mit Anführungszeichen', () => {
    expect(parseCsvLine('1,07:09:00,07:09:00,603311,0,"Stadtbergen (Schwab), Stadtbergen",,')).toEqual([
      '1', '07:09:00', '07:09:00', '603311', '0', 'Stadtbergen (Schwab), Stadtbergen', '', '',
    ]);
    expect(parseCsvLine('a,"x ""y"" z",b')).toEqual(['a', 'x "y" z', 'b']);
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });
  it('rechnet GTFS-Zeiten über Mitternacht', () => {
    expect(gtfsSeconds('07:09:00')).toBe(25740);
    expect(gtfsSeconds('25:30:00')).toBe(91800);
  });
  it('ordnet Verkehrsmittel zu', () => {
    expect(modeOf(2, 'ICE 597')).toBe('LONG_DISTANCE');
    expect(modeOf(2, 'RE2')).toBe('REGIONAL');
    expect(modeOf(2, 'S7')).toBe('SUBURBAN');
    expect(modeOf(109, 'S1')).toBe('SUBURBAN');
    expect(modeOf(1, 'U8')).toBe('SUBWAY');
    expect(modeOf(0, 'M10')).toBe('TRAM');
    expect(modeOf(3, '15')).toBe('BUS');
    expect(modeOf(700, 'X90')).toBe('BUS');
    expect(modeOf(4, 'F10')).toBe('FERRY');
  });
  it('Regionen: gültige Liste, Auswahl per ID, Münster schließt Dülmen ein', () => {
    expect(loadRegions(undefined, 'muenster,berlin').map((r) => r.id)).toEqual(['muenster', 'berlin']);
    expect(DEFAULT_REGIONS.length).toBeGreaterThan(10);
    const m = DEFAULT_REGIONS.find((r) => r.id === 'muenster')!;
    expect(haversineKm(m.lat, m.lon, 51.8305, 7.2836)).toBeLessThan(m.radiusKm); // Dülmen
    expect(haversineKm(m.lat, m.lon, 51.9461, 7.1679)).toBeLessThan(m.radiusKm); // Coesfeld
    // RVM-Gebiet: Kreise Borken, Steinfurt, Warendorf
    for (const [lat, lon] of [[51.838, 6.615], [51.8436, 6.8579], [52.075, 7.006], [52.21, 7.02], [52.28, 7.44], [52.277, 7.716], [51.952, 7.99], [51.9607, 7.6261]]) {
      expect(haversineKm(m.lat, m.lon, lat, lon)).toBeLessThan(m.radiusKm); // Bocholt, Borken, Ahaus, Gronau, Rheine, Ibbenbüren, Warendorf, Münster
    }
  });
});
