// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isValidLineKey, makeLineKey, mapMode, normalizeLineName, slugify } from '../src/transit/lineKey.js';
import { canonicalStopId, departureFromStopTime, directLegOptions, estimatePosition, isOnDemand, journeyFromItinerary, lineFromRoute, mapStopsFromMotis, motisPlaceParam, placeFromGeocode } from '../src/transit/mapping.js';
import type { MotisItinerary, MotisLeg, MotisPlanResponse, MotisStopTimesResponse } from '../src/transit/motis.js';
import { matchTracking } from '../src/services/trackings.js';
import { isCoordinate, needsLongWalk, pickLongWalk } from '../src/transit/longWalk.js';
import type { Journey, Leg } from '../src/contract.js';

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;

describe('Linienschlüssel', () => {
  it('ist stabil und unterscheidet Betreiber', () => {
    expect(makeLineKey('SUBWAY', 'U8', 'Berliner Verkehrsbetriebe')).toBe('subway:u8:berliner-verkehrsbetriebe');
    expect(makeLineKey('BUS', 'Bus 100', 'Hamburger Hochbahn AG')).toBe('bus:100:hamburger-hochbahn');
    expect(makeLineKey('BUS', '100', 'Berliner Verkehrsbetriebe')).not.toBe(makeLineKey('BUS', '100', 'Hamburger Hochbahn AG'));
    expect(makeLineKey('SUBURBAN', 'S 1', 'S-Bahn München')).toBe('suburban:s1:s-bahn-muenchen');
    expect(isValidLineKey(makeLineKey('TRAM', 'M10', undefined))).toBe(true);
    expect(isValidLineKey('x; DROP TABLE')).toBe(false);
  });
  it('normalisiert Namen und Firmen', () => {
    expect(normalizeLineName('U 8', 'SUBWAY')).toBe('u8');
    expect(normalizeLineName('Tram M10', 'TRAM')).toBe('m10');
    expect(slugify('Kölner Verkehrs-Betriebe AG')).toBe('koelner-verkehrs-betriebe');
  });
  it('bildet MOTIS-Verkehrsmittel ab', () => {
    expect(mapMode('HIGHSPEED_RAIL')).toBe('LONG_DISTANCE');
    expect(mapMode('REGIONAL_FAST_RAIL')).toBe('REGIONAL');
    expect(mapMode('METRO')).toBe('SUBWAY');
    expect(mapMode('COACH')).toBe('BUS');
    expect(mapMode('???')).toBe('OTHER');
  });
});

describe('Haltestellen-IDs', () => {
  it('vergleicht Feeds über die DHID', () => {
    expect(canonicalStopId('de-VBB_de:11000:900013102::4')).toBe('de:11000:900013102');
    expect(canonicalStopId('de-DELFI_de:11000:900003200:2:53')).toBe('de:11000:900003200');
    expect(canonicalStopId('se-Trafiklab_800010100')).toBe('se-Trafiklab_800010100');
    expect(canonicalStopId(null)).toBeNull();
  });
});

describe('MOTIS → App-Format', () => {
  it('wandelt Abfahrten um', () => {
    const res = fixture<MotisStopTimesResponse>('stoptimes.json');
    const d = departureFromStopTime(res.stopTimes[0]);
    expect(d.line.key).toBe('subway:u3:berliner-verkehrsbetriebe');
    expect(d.line.color).toBe('#16683d');
    expect(d.stop.id).toBe('de-VBB_de:11000:900013102');
    expect(d.headsign).toContain('Krumme Lanke');
    expect(d.tripId).toBeTruthy();
  });
  it('wandelt Verbindungen inkl. Halte um', () => {
    const res = fixture<MotisPlanResponse>('plan.json');
    const j = journeyFromItinerary(res.itineraries[0], 0);
    expect(j.legs.map((l) => l.line?.name ?? 'Fuß')).toEqual(['U8', 'Fuß', 'S7']);
    expect(j.legs[0].stopovers!.length).toBe(5); // Start + 3 Zwischenhalte + Ziel
    expect(j.legs[1].walking).toBe(true);
    expect(j.durationMin).toBe(12);
  });
  it('Orte: Adresse mit PLZ/Ort, Haltestelle mit ID, Koordinaten als geo:', () => {
    const addr = placeFromGeocode({
      type: 'ADDRESS', name: 'Weseler Straße 108', id: '', lat: 51.9484542, lon: 7.6144895, zip: '48151',
      areas: [{ name: 'Nordrhein-Westfalen', adminLevel: 4 }, { name: 'Münster', adminLevel: 6, default: true }],
    }, { lat: 51.95, lon: 7.61 });
    expect(addr).toMatchObject({ kind: 'ADDRESS', name: 'Weseler Straße 108', detail: '48151 Münster', id: 'geo:51.948454,7.614490' });
    expect(addr.distance).toBeGreaterThan(0);
    const stop = placeFromGeocode({ type: 'STOP', name: 'Münster Hbf', id: 'de-DELFI_de:05515:41000', lat: 51.95, lon: 7.63, modes: ['BUS', 'REGIONAL_RAIL'] });
    expect(stop).toMatchObject({ kind: 'STOP', id: 'de-DELFI_de:05515:41000', modes: ['BUS', 'REGIONAL'] });
    expect(placeFromGeocode({ type: 'PLACE', name: 'Schloss', id: 'way/1', lat: 1, lon: 2 }).kind).toBe('POI');
    expect(motisPlaceParam('geo:51.948454,7.61449')).toBe('51.948454,7.61449');
    expect(motisPlaceParam('52.5,13.4')).toBe('52.5,13.4');
    expect(motisPlaceParam('de-DELFI_de:05515:41000')).toBe('de-DELFI_de:05515:41000');
    expect(motisPlaceParam('geo:99,13')).toBe('geo:99,13');
  });
  it('Karte: Bahnsteige einer Station werden ein Punkt, Bussteige bleiben einzeln', () => {
    const s = mapStopsFromMotis([
      { name: 'Münster Hbf', stopId: 'x:94:17', parentId: 'x_G', lat: 51.95, lon: 7.63, track: '17', modes: ['REGIONAL_RAIL'] },
      { name: 'Münster Hbf', stopId: 'x:94:14', parentId: 'x_G', lat: 51.95, lon: 7.63, track: '14', modes: ['HIGHSPEED_RAIL'] },
      { name: 'Eisenbahnstraße', stopId: 'y:2:B', lat: 51.96, lon: 7.64, track: 'B', modes: ['BUS'] },
    ]);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ id: 'x_G', modes: ['REGIONAL', 'LONG_DISTANCE'] });
    expect(s[0].track).toBeUndefined();
    expect(s[1]).toMatchObject({ id: 'y:2:B', track: 'B' });
  });
  it('Verbindung: Gleise und Start-/Zielname bei Koordinaten', () => {
    const res = fixture<MotisPlanResponse>('plan.json');
    const it0 = JSON.parse(JSON.stringify(res.itineraries[0]));
    it0.legs[0].from.name = 'START';
    it0.legs[0].from.track = '2';
    it0.legs[0].from.scheduledTrack = '1';
    it0.legs[0].legGeometry = { points: 'abc', precision: 6 };
    const j = journeyFromItinerary(it0, 0, { from: 'Weseler Straße 108' });
    expect(j.legs[0].from.name).toBe('Weseler Straße 108');
    expect(j.legs[0]).toMatchObject({ fromTrack: '2', fromPlannedTrack: '1', geometry: { polyline: 'abc', precision: 6 } });
  });
  it('schätzt die Position eines Fahrzeugs', () => {
    const t = (m: number) => new Date(Date.UTC(2026, 0, 1, 8, m)).toISOString();
    const so = [0, 2, 4, 6].map((m, i) => ({ stop: { id: `s${i}`, name: `S${i}` }, plannedDeparture: t(m), departure: t(m) }));
    expect(estimatePosition(so, Date.parse(t(3)))).toEqual({ prevIndex: 1, nextIndex: 2 });
    expect(estimatePosition(so, Date.parse(t(-5)))).toEqual({ prevIndex: null, nextIndex: 0 });
    expect(estimatePosition(so, Date.parse(t(30)))).toEqual({ prevIndex: 3, nextIndex: null });
  });
});

describe('Live-Tracking-Abgleich', () => {
  const tracking = {
    id: '1', userId: 'u', lineKey: 'subway:u8:berliner-verkehrsbetriebe', directionId: '0', bothDirections: false,
    stopIds: ['de:11000:1', 'de:11000:2', 'de:11000:3'],
  };
  const report = (over: Partial<Parameters<typeof matchTracking>[1]> = {}) => ({
    lineKey: 'subway:u8:berliner-verkehrsbetriebe', directionId: '0',
    prevStop: { id: 'de-VBB_de:11000:2::1', name: 'B' }, nextStop: { id: 'de-VBB_de:11000:3', name: 'C' }, ...over,
  });
  it('alarmiert auf dem eigenen Abschnitt', () => expect(matchTracking(tracking, report())).toEqual({ match: true, onMySegment: true }));
  it('alarmiert auf der Linie außerhalb des Abschnitts', () =>
    expect(matchTracking(tracking, report({ prevStop: { id: 'de:11000:9', name: 'X' }, nextStop: null }))).toEqual({ match: true, onMySegment: false }));
  it('ignoriert die Gegenrichtung', () => expect(matchTracking(tracking, report({ directionId: '1' })).match).toBe(false));
  it('…außer bei "beide Richtungen"', () => expect(matchTracking({ ...tracking, bothDirections: true }, report({ directionId: '1' })).match).toBe(true));
  it('erkennt dieselbe Linie aus anderer Datenquelle nur auf dem Abschnitt', () => {
    expect(matchTracking(tracking, report({ lineKey: 'subway:u8:bvg' })).match).toBe(true);
    expect(matchTracking(tracking, report({ lineKey: 'subway:u8:bvg', prevStop: { id: 'de:11000:9', name: 'X' }, nextStop: null })).match).toBe(false);
    expect(matchTracking(tracking, report({ lineKey: 'bus:u8:bvg' })).match).toBe(false);
  });  it('filtert nach gewählten Arten (leer = alle)', () => {
    expect(matchTracking({ ...tracking, kinds: ['DELAY', 'CANCELLED'] }, report({ kind: 'DELAY' })).match).toBe(true);
    expect(matchTracking({ ...tracking, kinds: ['DELAY', 'CANCELLED'] }, report({ kind: 'CHECK' })).match).toBe(false);
    expect(matchTracking({ ...tracking, kinds: [] }, report({ kind: 'CROWDED' })).match).toBe(true);
  });
});

describe('Andere Fahrt wählen (Direktfahrten)', () => {
  const base = fixture<MotisPlanResponse>('plan.json').itineraries[0];
  const ride = base.legs[0];
  const walk = base.legs[1];
  const at = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();
  /** Dieselbe Fahrt, um `shift` Minuten verschoben, mit eigener Fahrt-ID. */
  const shifted = (shift: number, id: string): MotisLeg => ({
    ...ride,
    tripId: id,
    startTime: at(ride.startTime, shift),
    scheduledStartTime: at(ride.scheduledStartTime, shift),
    endTime: at(ride.endTime, shift),
    scheduledEndTime: at(ride.scheduledEndTime, shift),
  });
  const itin = (...legs: MotisLeg[]): MotisItinerary => ({ ...base, legs });
  const t0 = Date.parse(ride.scheduledStartTime);

  it('liefert nur Fahrten ohne Umstieg im Zeitfenster, sortiert und ohne Doppelte', () => {
    const options = directLegOptions(
      [
        itin(shifted(20, 'c')),
        itin(shifted(-30, 'a')),
        itin(shifted(-30, 'a')), // doppelt
        itin(shifted(0, 'b')),
        base, // mit Umstieg → raus
        itin(shifted(-300, 'zu-früh')),
        itin({ ...walk, duration: 900 }, shifted(-10, 'langer-fussweg')),
        itin({ ...walk, duration: 120 }, shifted(-5, 'kurzer-fussweg')),
      ],
      { earliest: t0 - 120 * 60_000, latest: t0 + 90 * 60_000 },
    );
    expect(options.map((o) => o.tripId)).toEqual(['a', 'kurzer-fussweg', 'b', 'c']);
    expect(options.every((o) => !o.walking && o.line)).toBe(true);
  });
});

describe('Rufbus / AST / TaxiBus', () => {
  it('erkennt Bedarfsverkehre an Modus, route_type, Route-ID und Name', () => {
    expect(isOnDemand({ mode: 'ODM' }, '794')).toBe(true);
    expect(isOnDemand({ mode: 'BUS', routeType: 715 }, '12')).toBe(true);
    expect(isOnDemand({ mode: 'BUS', routeId: 'de-DELFI_de:NWL:05711|Bedarf|AST:WIN_715' }, 'X')).toBe(true);
    for (const n of ['AST', 'AST 5', 'ALF', 'Rufbus', 'TaxiBus', '333AL', '572TB', 'RUF 12']) expect(isOnDemand({ mode: 'BUS' }, n)).toBe(true);
    for (const n of ['741', 'S73', 'R10', 'RE82', 'T1', 'ALTONA', 'N5']) expect(isOnDemand({ mode: 'BUS' }, n)).toBe(false);
  });
  it('folgt den echten NWL-/VRR-Daten (Dülmen, Haltern, Münster)', () => {
    // T65 Dülmen: Kategorie "Bedarf" – auch wenn eine Variante als normaler Bus (3) kommt
    expect(isOnDemand({ mode: 'ODM', routeType: 715, routeId: 'de-DELFI_de:NWL:05558|Bedarf|T65:RVM_715' }, 'T65')).toBe(true);
    expect(isOnDemand({ mode: 'BUS', routeType: 3, routeId: 'de-DELFI_de:NWL:05558|Bedarf|T67:RVM_3' }, 'T67')).toBe(true);
    // Bürgerbus Dülmen: 715, aber Kategorie "Bus" und fester Fahrplan → kein Rufbus
    expect(isOnDemand({ mode: 'ODM', routeType: 715, routeId: 'de-DELFI_de:NWL:05558016|Bus|B1:RVM_715' }, 'B1')).toBe(false);
    // Haltern: AST (715, ohne Kategorie) und TaxiBus "TB271" (als normaler Bus)
    expect(isOnDemand({ mode: 'ODM', routeType: 715, routeId: 'de-DELFI_de:vrr:AST71-RE:VES-40-A71_715' }, 'AST71')).toBe(true);
    expect(isOnDemand({ mode: 'BUS', routeType: 3, routeId: 'de-DELFI_de:vrr:TB271-RE:VES-40-271-T_3' }, 'TB271')).toBe(true);
    // Münster T15: nur das Ziel verrät den Taxibus
    expect(isOnDemand({ mode: 'ODM', routeType: 715, routeId: 'de-DELFI_de:NWL:05515|Bus|T15:SWMS_715', headsign: 'Taxibus' }, 'T15')).toBe(true);
  });
  it('hält gleichnamige AST-Gebiete auseinander und markiert sie', () => {
    const base = { mode: 'ODM', routeType: 715, routeShortName: 'AST', agencyName: 'GBN-AST/ALF' };
    const a = lineFromRoute({ ...base, routeId: 'de-DELFI_de:NWL:05711|Bedarf|AST:WIN_715' });
    const b = lineFromRoute({ ...base, routeId: 'de-DELFI_de:NWL:05711|Bedarf|AST:LAE_715' });
    expect(a.name).toBe('AST');
    expect(a.onDemand).toBe(true);
    expect(a.mode).toBe('BUS');
    expect(a.key).not.toBe(b.key);
    expect(a.key).toBe('bus:astwin:gbn-ast-alf');
    // normale Linie unverändert
    const bus = lineFromRoute({ mode: 'BUS', routeType: 3, routeShortName: '741', agencyName: 'Lippe3' });
    expect(bus.onDemand).toBeUndefined();
    expect(bus.key).toBe('bus:741:lippe3');
  });
});

describe('Langer Fußweg auf dem Land (Fallback)', () => {
  const T = (iso: string) => `2026-11-08T${iso}:00.000Z`;
  const leg = (walking: boolean, dep: string, arr: string, min: number): Leg =>
    ({ mode: walking ? 'WALK' : 'REGIONAL', walking, from: { id: 'a', name: 'A' }, to: { id: 'b', name: 'B' },
      plannedDeparture: dep, departure: dep, plannedArrival: arr, arrival: arr, durationMin: min }) as Leg;
  const journey = (id: string, dep: string, arr: string, walkMin: number): Journey => ({
    id, departure: dep, arrival: arr, durationMin: 0, transfers: 0,
    legs: [leg(false, dep, dep, 32), leg(true, dep, arr, walkMin)],
  });
  const requested = Date.parse(T('14:15'));
  // Sonntag, Gelsenkirchen → Dülmen-Börnste: normal erst Montag früh
  const primary = [journey('m1', '2026-11-09T05:25:00.000Z', '2026-11-09T06:24:00.000Z', 10)];

  it('erkennt Koordinaten', () => {
    expect(isCoordinate('51.8471734,7.255871')).toBe(true);
    expect(isCoordinate('de-DELFI_de:05513:5613_G')).toBe(false);
  });
  it('sucht nur, wenn stundenlang nichts fährt', () => {
    expect(needsLongWalk(primary, requested)).toBe(true);
    expect(needsLongWalk([journey('x', T('14:25'), T('15:30'), 10)], requested)).toBe(false);
    expect(needsLongWalk([], requested)).toBe(true);
  });
  it('nimmt nur, was bald fährt und früher ankommt – markiert mit Fußweg-Länge', () => {
    const alt = [
      journey('a1', T('14:25'), T('15:56'), 59),
      journey('a2', T('18:55'), T('20:26'), 59), // fährt erst in 4+ Std. → nicht
      journey('a3', '2026-11-09T04:25:00.000Z', '2026-11-09T06:30:00.000Z', 24), // später da als normal → nicht
    ];
    const picked = pickLongWalk(primary, alt, requested);
    expect(picked.map((j) => j.id)).toEqual(['lw-a1']);
    expect(picked[0].longWalk).toBe(true);
    expect(picked[0].longWalkMin).toBe(59);
  });
});

