// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { describe, expect, it } from 'vitest';
import { parseLang, reqLang, t } from '../src/i18n.js';
import { alertTexts } from '../src/services/trackings.js';
import type { Report } from '../src/contract.js';

describe('Sprache', () => {
  it('erkennt die Sprache aus Accept-Language', () => {
    expect(parseLang('de')).toBe('de');
    expect(parseLang('de-DE,de;q=0.9,en;q=0.8')).toBe('de');
    expect(parseLang('en-GB')).toBe('en');
    expect(parseLang('fr-FR')).toBeNull();
    expect(parseLang(undefined)).toBeNull();
    expect(reqLang({ headers: {} })).toBe('en'); // Standard: Englisch
    expect(reqLang({ headers: { 'accept-language': 'de' } })).toBe('de');
  });
  it('übersetzt mit Platzhaltern und Mehrzahl', () => {
    expect(t('en', 'cooldown', { line: 'U8' })).toContain('You just reported U8');
    expect(t('de', 'cooldown', { line: 'U8' })).toContain('Du hast U8 gerade schon gemeldet');
    expect(t('en', 'insight_active', { count: 1 })).toContain('1 report in');
    expect(t('de', 'insight_active', { count: 3 })).toContain('3 Meldungen');
  });
});

describe('Alarm-Texte', () => {
  const report = {
    id: '1', kind: 'CHECK', lineKey: 'subway:u8:bvg', line: { key: 'subway:u8:bvg', name: 'U8', mode: 'SUBWAY' },
    prevStop: { id: 'a', name: 'U Moritzplatz (Berlin)' }, nextStop: { id: 'b', name: 'U Kottbusser Tor (Berlin)' },
    headsign: 'S+U Wittenau (Berlin)', reportedAt: new Date(Date.now() - 5 * 60_000).toISOString(), tags: [], confirmations: 0, denials: 0,
  } as Report;
  it('auf Englisch', () => {
    const a = alertTexts(report, true, 'en');
    expect(a.title).toBe('Ticket check on your section – U8');
    expect(a.message).toBe('Between Moritzplatz and Kottbusser Tor · towards Wittenau · 5 min ago');
  });
  it('auf Deutsch', () => {
    const a = alertTexts(report, false, 'de');
    expect(a.title).toBe('Kontrolle auf U8');
    expect(a.message).toBe('Zwischen Moritzplatz und Kottbusser Tor · Richtung Wittenau · vor 5 Min.');
  });
  it('je Art eigener Titel', () => {
    expect(alertTexts({ ...report, kind: 'DELAY' }, false, 'en').title).toBe('Delay on U8');
    expect(alertTexts({ ...report, kind: 'CROWDED' }, true, 'de').title).toBe('Überfüllt auf deinem Abschnitt – U8');
    expect(alertTexts({ ...report, kind: 'CANCELLED' }, false, 'de').title).toBe('Ausfall: U8');
    expect(alertTexts({ ...report, kind: 'DISRUPTION' }, false, 'en').title).toBe('Disruption on U8');
  });
});
