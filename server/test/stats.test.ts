// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { describe, expect, it } from 'vitest';
import { buildInsight, circularMeanTime, computeLineStats, formatHHMM, hotspots, localTime, peakWindows, shortStopName, type StatReport } from '../src/services/stats.js';

const stop = (id: string, name: string) => ({ id, name });
/** Erzeugt einen Zeitpunkt in Berliner Winterzeit (UTC+1). */
const berlin = (day: number, hh: number, mm: number) => new Date(Date.UTC(2026, 0, day, hh - 1, mm));

describe('Zeit', () => {
  it('rechnet in Europe/Berlin (Winter- und Sommerzeit)', () => {
    expect(localTime(new Date('2026-01-12T07:30:00Z'))).toEqual({ minutes: 8 * 60 + 30, weekday: 0 }); // Mo 08:30 MEZ
    expect(localTime(new Date('2026-07-12T07:30:00Z')).minutes).toBe(9 * 60 + 30); // So 09:30 MESZ
    expect(localTime(new Date('2026-07-12T07:30:00Z')).weekday).toBe(6);
  });
  it('formatiert HH:MM inkl. Überlauf', () => {
    expect(formatHHMM(0)).toBe('00:00');
    expect(formatHHMM(1439)).toBe('23:59');
    expect(formatHHMM(1440 + 61)).toBe('01:01');
  });
});

describe('circularMeanTime', () => {
  it('mittelt über Mitternacht korrekt', () => {
    const r = circularMeanTime([23 * 60 + 50, 10])!;
    expect(r.time).toBe('00:00');
    expect(r.confidence).toBeGreaterThan(0.99);
  });
  it('liefert normale Mittelwerte', () => {
    expect(circularMeanTime([8 * 60, 9 * 60])!.time).toBe('08:30');
  });
  it('erkennt fehlende Tendenz', () => {
    const r = circularMeanTime([0, 360, 720, 1080])!;
    expect(r.confidence).toBe(0);
  });
  it('leer → null', () => expect(circularMeanTime([])).toBeNull());
});

describe('peakWindows', () => {
  it('findet Stoßzeiten und ein zweites Fenster', () => {
    const morning = [450, 460, 470, 480, 490, 500, 510]; // 07:30–08:30
    const evening = [1050, 1060, 1065]; // 17:30–17:45
    const w = peakWindows([...morning, ...evening, 720]);
    expect(w[0].from).toBe('07:30');
    expect(w[0].count).toBe(7);
    expect(w[1].from).toBe('17:30');
    expect(w[1].count).toBe(3);
  });
  it('funktioniert über Mitternacht', () => {
    const w = peakWindows([23 * 60 + 40, 23 * 60 + 50, 5, 15]);
    expect(w[0].count).toBe(4);
    expect(w[0].from).toBe('23:30');
  });
});

describe('hotspots', () => {
  const A = stop('de-VBB_de:11000:1', 'U Moritzplatz (Berlin)');
  const B = stop('de-VBB_de:11000:2', 'U Kottbusser Tor (Berlin)');
  const B2 = stop('de-DELFI_de:11000:2', 'U Kottbusser Tor (Berlin)'); // gleiche DHID, anderer Feed
  const C = stop('de-VBB_de:11000:3', 'U Schönleinstr. (Berlin)');
  const r = (prev: typeof A | null, next: typeof A | null, h = 8): StatReport => ({
    reportedAt: berlin(5, h, 0), prevStop: prev, nextStop: next, directionId: '0', headsign: null,
  });
  it('fasst beide Richtungen und Feeds zusammen', () => {
    const spots = hotspots([r(A, B), r(B, A), r(A, B2), r(B, C)]);
    expect(spots[0].count).toBe(3);
    expect(spots[1].count).toBe(1);
    expect(spots[0].averageTime).toBe('08:00');
  });
});

describe('computeLineStats', () => {
  it('ergibt eine sinnvolle Zusammenfassung', () => {
    const A = stop('de:1', 'U Moritzplatz (Berlin)');
    const B = stop('de:2', 'U Kottbusser Tor (Berlin)');
    const reports: StatReport[] = [];
    for (let d = 1; d <= 6; d++) reports.push({ reportedAt: berlin(d, 8, 10 + d), prevStop: A, nextStop: B, directionId: '0', headsign: 'Wittenau' });
    const s = computeLineStats(reports, { lineKey: 'subway:u8:bvg', days: 30, recentMinutes: 60, frequentThreshold: 5, now: berlin(20, 12, 0) });
    expect(s.total).toBe(6);
    expect(s.level).toBe('frequent');
    expect(s.byHour[8]).toBe(6);
    expect(s.byWeekday.reduce((a, b) => a + b, 0)).toBe(6);
    expect(s.averageTime?.time).toMatch(/^08:1[34]$/); // Mittel aus 08:11–08:16
    expect(s.insight).toContain('Moritzplatz');
    expect(s.insight).toContain('08:');
  });
  it('ohne Meldungen', () => {
    const s = computeLineStats([], { lineKey: 'bus:100:x', days: 7, recentMinutes: 60, frequentThreshold: 5, lang: 'de' });
    expect(s.level).toBe('calm');
    expect(s.insight).toMatch(/nichts gemeldet/);
    expect(buildInsight({ ...s, total: 1 }, 'de')).toMatch(/keine verlässliche/);
    // Englisch ist Standard
    expect(computeLineStats([], { lineKey: 'bus:100:x', days: 7, recentMinutes: 60, frequentThreshold: 5 }).insight).toBe('Nothing was reported here in the last 7 days.');
    expect(buildInsight({ ...s, total: 1 })).toMatch(/no reliable pattern/);
  });
  it('formuliert je Art und liefert byKind', () => {
    const s = computeLineStats([], {
      lineKey: 'bus:100:x', days: 7, recentMinutes: 60, frequentThreshold: 5, kind: 'DELAY',
      byKind: { DELAY: 0, CANCELLED: 2, CROWDED: 0, DISRUPTION: 0, CHECK: 1 },
    });
    expect(s.kind).toBe('DELAY');
    expect(s.byKind.CANCELLED).toBe(2);
    expect(s.insight).toBe('No delays reported here in the last 7 days.');
    expect(computeLineStats([], { lineKey: 'bus:100:x', days: 7, recentMinutes: 60, frequentThreshold: 5, kind: 'CHECK', lang: 'de' }).insight)
      .toBe('In den letzten 7 Tagen keine Kontrollen gemeldet.');
  });
});

it('kürzt Haltestellennamen', () => {
  expect(shortStopName('U Kottbusser Tor (Berlin)')).toBe('Kottbusser Tor');
  expect(shortStopName('S+U Alexanderplatz Bhf (Berlin)')).toBe('Alexanderplatz Bhf');
  expect(shortStopName('Hauptbahnhof')).toBe('Hauptbahnhof');
});

it('beschreibt zwei Stoßzeiten statt eines irreführenden Mittelwerts', () => {
  const A = { id: 'de:1', name: 'A' };
  const B = { id: 'de:2', name: 'B' };
  const reports: StatReport[] = [];
  for (let d = 1; d <= 5; d++) {
    reports.push({ reportedAt: berlin(d, 8, 0), prevStop: A, nextStop: B, directionId: null, headsign: null });
    reports.push({ reportedAt: berlin(d, 18, 0), prevStop: A, nextStop: B, directionId: null, headsign: null });
  }
  const s = computeLineStats(reports, { lineKey: 'bus:1:x', days: 30, recentMinutes: 60, frequentThreshold: 5, now: berlin(20, 12, 0), lang: 'de' });
  expect(s.insight).toContain('Zwei Stoßzeiten');
  const en = computeLineStats(reports, { lineKey: 'bus:1:x', days: 30, recentMinutes: 60, frequentThreshold: 5, now: berlin(20, 12, 0) });
  expect(en.insight).toContain('Two peak times: 08:00–08:15 and 18:00–18:15.');
  expect(s.hotspots[0].averageTime).toBeNull();
});
