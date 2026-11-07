// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Tutorial "Karte": Auf Start die Karte öffnen, nach Art filtern, einen Hinweis antippen –
 * und über "Auf der Karte zeigen" die eigene Verbindung einzeichnen lassen.
 * Die Karte ist eine stilisierte Stadt (Hamburg) aus Views: Straßen, Elbe, Alster, Stadtpark.
 */
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Animated, StyleSheet, View } from 'react-native';

import type { Mode, ReportKind } from '@/api/contract';
import { GhostLogo } from '@/components/GhostLogo';
import { KIND_COLOR, KIND_ICON } from '@/lib/kinds';
import { colors, modeColor } from '@/theme';
import {
  Appear,
  Box,
  center,
  MockButton,
  MockCard,
  MockScreen,
  MockStackHeader,
  MockStatusBar,
  MockTabBar,
  MText,
  Pulse,
  useGlide,
  type Rect,
} from '../mock';
import type { SceneProps, Tutorial } from '../types';

interface P {
  x: number;
  y: number;
}

// Layout (Mock-Telefon 300 × 600)
const R = {
  // Start
  mapBtn: { x: 216, y: 31, w: 28, h: 28 },
  avatar: { x: 252, y: 31, w: 28, h: 28 },
  report1: { x: 16, y: 248, w: 268, h: 80 },
  report2: { x: 16, y: 338, w: 268, h: 80 },
  report3: { x: 16, y: 428, w: 268, h: 80 },
  // Karte
  header: { x: 0, y: 0, w: 300, h: 100 },
  chips: { x: 12, y: 68, w: 288, h: 22 },
  card: { x: 8, y: 414, w: 284, h: 172 },
  fab: { x: 252, y: 504, w: 36, h: 36 },
  // Verbindung
  showOnMap: { x: 16, y: 112, w: 118, h: 24 },
  commute: { x: 140, y: 112, w: 124, h: 24 },
  edit: { x: 16, y: 142, w: 96, h: 24 },
  leg1: { x: 62, y: 180, w: 222, h: 104 },
  leg2: { x: 62, y: 300, w: 222, h: 104 },
  track: { x: 16, y: 552, w: 268, h: 34 },
} satisfies Record<string, Rect>;

/** So weit rücken die Knöpfe nach oben, wenn unten die Karte mit Details offen ist */
const FAB_UP = R.fab.y + R.fab.h - (R.card.y - 34);

// Hinweise auf der Karte (Mittelpunkt der Pille)
const TIPS: { id: string; kind: ReportKind; line: string; p: P }[] = [
  { id: 'u3', kind: 'DELAY', line: 'U3', p: { x: 128, y: 334 } },
  { id: 'bus', kind: 'DELAY', line: '118', p: { x: 236, y: 268 } },
  { id: 's1', kind: 'CROWDED', line: 'S1', p: { x: 92, y: 196 } },
  { id: 're', kind: 'CANCELLED', line: 'RE3', p: { x: 66, y: 448 } },
  { id: 'u1', kind: 'DISRUPTION', line: 'U1', p: { x: 204, y: 416 } },
  { id: 'm5', kind: 'CHECK', line: 'M5', p: { x: 168, y: 486 } },
];
const tipW = (line: string) => 26 + line.length * 6;
const tipRect = (t: { line: string; p: P }): Rect => ({ x: t.p.x - tipW(t.line) / 2, y: t.p.y - 10, w: tipW(t.line), h: 20 });
const U3 = TIPS[0];

// Verbindung Hamburg Hbf → Stadtpark (S1, dann Bus 118)
const HBF: P = { x: 150, y: 372 };
const BARMBEK: P = { x: 250, y: 208 };
const STADTPARK: P = { x: 194, y: 160 };
const S1_PATH: P[] = [HBF, { x: 168, y: 330 }, { x: 196, y: 282 }, { x: 226, y: 240 }, BARMBEK];
const BUS_PATH: P[] = [BARMBEK, { x: 230, y: 178 }, STADTPARK];

function MapScene({ step, lang }: SceneProps) {
  const de = lang === 'de';
  const L = (d: string, e: string) => (de ? d : e);
  const filtered = step >= 2 && step <= 3;
  const selected = step === 3;
  const journeyMap = step >= 5;
  const fabShift = useGlide(selected ? -FAB_UP : 0);
  const delayChip: Rect = { x: 65, y: R.chips.y, w: de ? 86 : 64, h: 22 };

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* --- 1. Start ------------------------------------------------------------- */}
      <MockStatusBar />
      <Box r={{ x: 16, y: 31, w: 190, h: 28 }} style={s.brand}>
        <GhostLogo size={20} />
        <MText size={14} weight="bold">
          Catch
        </MText>
      </Box>
      <Box r={{ x: 204, y: 42, w: 6, h: 6 }} style={{ borderRadius: 3, backgroundColor: colors.lime }} />
      <Box r={R.mapBtn} style={[s.round, { backgroundColor: colors.surfaceAlt }]}>
        <Feather name="map" size={13} color={colors.text} />
      </Box>
      <Pulse r={R.mapBtn} active={step === 0} radius={14} />
      <Box r={R.avatar} style={[s.round, { backgroundColor: colors.lime }]}>
        <MText size={12} weight="bold" color={colors.textOnLight}>
          A
        </MText>
      </Box>
      <Box r={{ x: 16, y: 70, w: 268, h: 64 }}>
        <MText size={24} weight="extrabold" style={{ lineHeight: 30, letterSpacing: -0.6 }}>
          {L('Guten Abend,\nAnna', 'Good evening,\nAnna')}
        </MText>
      </Box>
      <Box r={{ x: 16, y: 144, w: 268, h: 46 }} style={s.searchCard}>
        <View style={s.searchIcon}>
          <Feather name="search" size={13} color={colors.textOnLight} />
        </View>
        <View style={{ flex: 1 }}>
          <MText size={10.5}>{L('Wohin geht’s?', 'Where to?')}</MText>
          <MText size={8.5} weight="medium" color={colors.textMuted}>
            {L('Verbindungen & Live-Hinweise', 'Find connections & live tips')}
          </MText>
        </View>
        <Feather name="arrow-right" size={14} color={colors.textMuted} />
      </Box>
      <Box r={{ x: 16, y: 202, w: 268, h: 20 }} style={s.sectionRow}>
        <MText size={13.5} weight="bold" style={{ flex: 1 }}>
          {L('Gerade gemeldet', 'Just reported')}
        </MText>
        <MText size={9} weight="bold" color={colors.lime}>
          {L('Karte', 'Map')}
        </MText>
      </Box>
      <Box r={{ x: 16, y: 226, w: 268, h: 14 }} style={s.sectionRow}>
        <Feather name="map-pin" size={9} color={colors.textMuted} />
        <MText size={8.5} weight="medium" color={colors.textMuted}>
          {L('Im Umkreis von 30 km · letzte 2 Stunden', 'Within 30 km · last 2 hours')}
        </MText>
      </Box>
      <MockCard
        r={R.report1}
        mode="SUBWAY"
        tone="active"
        tab={L('Verspätung · vor 6 Min', 'Delay · 6 min ago')}
        title="U3 → Barmbek"
        subtitle={L('Zwischen Mönckebergstraße und Hauptbahnhof Süd · 5–15 Min.', 'Between Mönckebergstraße and Hauptbahnhof Süd · 5–15 min')}
        menu="chevron-right"
      />
      <MockCard
        r={R.report2}
        mode="BUS"
        tone="active"
        tab={L('Verspätung · vor 12 Min', 'Delay · 12 min ago')}
        title="118 → Stadtpark"
        subtitle={L('Zwischen Barmbek und Stadtpark · Über 15 Min.', 'Between Barmbek and Stadtpark · Over 15 min')}
        menu="chevron-right"
      />
      <MockCard
        r={R.report3}
        mode="SUBURBAN"
        tone="active"
        tab={L('Überfüllt · vor 20 Min', 'Crowded · 20 min ago')}
        title="S1 → Wedel"
        subtitle={L('Zwischen Dammtor und Sternschanze · Voll', 'Between Dammtor and Sternschanze · Full')}
        menu="chevron-right"
      />
      <MockTabBar active="home" lang={lang} />

      {/* --- 2. Karte mit Hinweisen ------------------------------------------------- */}
      <MockScreen show={step >= 1 && step <= 3}>
        <CityMap />
        {TIPS.map((t) => (
          <Appear key={t.id} show={!filtered || t.kind === 'DELAY'} duration={260}>
            <Tip kind={t.kind} line={t.line} p={t.p} selected={selected && t.id === 'u3'} />
          </Appear>
        ))}
        <UserDot p={{ x: 172, y: 302 }} />
        <Pulse r={tipRect(U3)} active={step === 2} radius={12} color={colors.text} />

        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: fabShift }] }]} pointerEvents="none">
          <Fab r={R.fab} icon="navigation" active />
          <Attribution lang={lang} />
        </Animated.View>

        <MapHeader
          title={L('Karte', 'Map')}
          subtitle={
            filtered
              ? L('2 Hinweise hier · letzte 2 Std', '2 tips here · last 2 h')
              : L('6 Hinweise hier · letzte 2 Std', '6 tips here · last 2 h')
          }
          lang={lang}
          kind={filtered ? 'DELAY' : null}
        />
        <Pulse r={delayChip} active={step === 1} radius={11} color={KIND_COLOR.DELAY} />

        {/* Details zum angetippten Hinweis */}
        <Appear show={selected} from="up" distance={30} fill={false} style={posStyle(R.card)}>
          <TipCard lang={lang} />
        </Appear>
      </MockScreen>

      {/* --- 3. Verbindung → "Auf der Karte zeigen" ---------------------------------------- */}
      <MockScreen show={step >= 4}>
        <MockStatusBar />
        <MockStackHeader title={L('Deine Verbindung', 'Your connection')} subtitle={L('Sa 7.11. · 23 Min · 1 Umstieg', 'Sat 7/11 · 23 min · 1 change')} />
        <Box r={{ x: 16, y: 62, w: 268, h: 44 }}>
          <MText size={14} weight="extrabold" lines={1}>
            Hamburg Hbf
          </MText>
          <MText size={14} weight="extrabold" color={colors.textMuted} lines={1}>
            → Hamburg, Stadtpark
          </MText>
        </Box>
        <MockButton r={R.showOnMap} text={L('Auf der Karte zeigen', 'Show on map')} icon="map" variant="light" size={8.5} />
        <MockButton r={R.commute} text={L('Als Pendelstrecke', 'Save as commute')} icon="repeat" variant="light" size={8.5} />
        <MockButton r={R.edit} text={L('Fahrten ändern', 'Change rides')} icon="edit-2" variant="light" size={8.5} />
        <Pulse r={R.showOnMap} active={step === 4} radius={12} />
        <Times r={R.leg1} dep="19:04" arr="19:13" />
        <MockCard
          r={R.leg1}
          mode="SUBURBAN"
          tone="frequent"
          tab={L('Häufige Hinweise', 'Frequent tips')}
          title="S1 → Poppenbüttel"
          subtitle={L('Hamburg Hbf → Barmbek · 6 Halte', 'Hamburg Hbf → Barmbek · 6 stops')}
          tags={[{ text: L('ab Gleis 4', 'from platform 4') }, { text: L('an Gleis 2', 'arr. platform 2') }]}
          footer={L('14 Meldungen in 30 Tagen', '14 reports in 30 days')}
          menu="chevron-right"
        />
        <Times r={R.leg2} dep="19:18" arr="19:27" />
        <MockCard
          r={R.leg2}
          mode="BUS"
          tone="active"
          tab={L('Verspätung', 'Delay')}
          title="118 → Stadtpark"
          subtitle={L('Barmbek → Stadtpark · 4 Halte', 'Barmbek → Stadtpark · 4 stops')}
          tags={[{ text: L('ab Steig B', 'from stop B') }]}
          footer={L('Verspätung · vor 12 Min', 'Delay · 12 min ago')}
          menu="chevron-right"
        />
        <MockButton r={R.track} text={L('Live-Tracking für diese Verbindung', 'Live tracking for this connection')} icon="radio" variant="cyan" size={9.5} />

        {/* --- 4. Verbindung auf der Karte ---------------------------------------------- */}
        <MockScreen show={journeyMap}>
          <CityMap />
          <Route lang={lang} />
          <Tip kind="DELAY" line="U3" p={U3.p} />
          <Tip kind="DELAY" line="118" p={{ x: 268, y: 166 }} />
          <Tip kind="CROWDED" line="S1" p={{ x: 92, y: 196 }} />
          <Fab r={{ ...R.fab, y: R.fab.y - 44 }} icon="maximize" />
          <Fab r={R.fab} icon="navigation" active />
          <Attribution lang={lang} />
          <MapHeader
            title={L('Deine Verbindung auf der Karte', 'Your connection on the map')}
            subtitle={L('Hamburg Hbf → Stadtpark · 19:04–19:27', 'Hamburg Hbf → Stadtpark · 19:04–19:27')}
            lang={lang}
            kind={null}
          />
        </MockScreen>
      </MockScreen>
    </View>
  );
}

const posStyle = (r: Rect) => ({ position: 'absolute' as const, left: r.x, top: r.y, width: r.w, height: r.h });

// ---------------------------------------------------------------------------
// Karte (stilisiert, Farben wie website/map)
// ---------------------------------------------------------------------------

const MAP = {
  land: '#1B2644',
  water: '#0E1830',
  park: '#1F3448',
  block: '#202D4D',
  minor: '#26345A',
  major: '#3A4D7A',
  majorInner: '#2D3C62',
  rail: '#3C4C75',
};

/** Linie von a nach b (gedrehter View mit runden Enden). */
function Seg({ a, b, w, color }: { a: P; b: P; w: number; color: string }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) + w;
  return (
    <View
      style={{
        position: 'absolute',
        left: (a.x + b.x) / 2 - len / 2,
        top: (a.y + b.y) / 2 - w / 2,
        width: len,
        height: w,
        borderRadius: w / 2,
        backgroundColor: color,
        transform: [{ rotate: `${(Math.atan2(dy, dx) * 180) / Math.PI}deg` }],
      }}
    />
  );
}

function Line({ pts, w, color }: { pts: P[]; w: number; color: string }) {
  return (
    <>
      {pts.slice(1).map((b, i) => (
        <Seg key={i} a={pts[i]} b={b} w={w} color={color} />
      ))}
    </>
  );
}

const ELBE: P[] = [
  { x: -20, y: 548 },
  { x: 60, y: 530 },
  { x: 140, y: 542 },
  { x: 220, y: 516 },
  { x: 320, y: 524 },
];
const ROADS_MAJOR: P[][] = [
  [{ x: -10, y: 128 }, { x: 120, y: 118 }, { x: 310, y: 98 }],
  [{ x: -10, y: 404 }, { x: 150, y: 392 }, { x: 310, y: 362 }],
  [{ x: 46, y: 610 }, { x: 64, y: 300 }, { x: 40, y: -10 }],
  [{ x: 150, y: 392 }, { x: 186, y: 250 }, { x: 214, y: -10 }],
];
const ROADS_MINOR: P[][] = [
  [{ x: -10, y: 240 }, { x: 310, y: 222 }],
  [{ x: -10, y: 300 }, { x: 96, y: 296 }],
  [{ x: 196, y: 320 }, { x: 310, y: 310 }],
  [{ x: -10, y: 470 }, { x: 310, y: 452 }],
  [{ x: 110, y: 610 }, { x: 120, y: 400 }],
  [{ x: 250, y: 610 }, { x: 262, y: 230 }, { x: 290, y: -10 }],
  [{ x: 100, y: 128 }, { x: 96, y: -10 }],
  [{ x: 160, y: 470 }, { x: 196, y: 320 }],
];
const RAIL: P[] = [{ x: 40, y: 560 }, { x: 110, y: 430 }, HBF, ...S1_PATH.slice(1), { x: 300, y: 150 }];

/** Stadtplan im Stil der Catch-Karte: Land, Wohngebiete, Park, Alster, Elbe, Straßen, Bahn. */
function CityMap() {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: MAP.land }]}>
      {/* Wohnblöcke */}
      {[
        { x: 70, y: 140, w: 70, h: 80 },
        { x: 14, y: 250, w: 40, h: 120 },
        { x: 200, y: 330, w: 80, h: 110 },
        { x: 124, y: 410, w: 60, h: 40 },
        { x: 14, y: 140, w: 26, h: 90 },
      ].map((r, i) => (
        <Box key={i} r={r} style={{ backgroundColor: MAP.block, borderRadius: 6, opacity: 0.8 }} />
      ))}
      {/* Stadtpark */}
      <Box r={{ x: 150, y: 104, w: 130, h: 52 }} style={{ backgroundColor: MAP.park, borderRadius: 18 }} />
      {/* Außenalster + Binnenalster */}
      <View style={[s.lake, { left: 104, top: 214, width: 44, height: 92, transform: [{ rotate: '14deg' }] }]} />
      <View style={[s.lake, { left: 98, top: 314, width: 24, height: 18, borderRadius: 6 }]} />
      {/* Elbe */}
      <Line pts={ELBE} w={34} color={MAP.water} />
      {/* Straßen */}
      {ROADS_MINOR.map((pts, i) => (
        <Line key={`m${i}`} pts={pts} w={3} color={MAP.minor} />
      ))}
      {ROADS_MAJOR.map((pts, i) => (
        <Line key={`M${i}`} pts={pts} w={7} color={MAP.major} />
      ))}
      {ROADS_MAJOR.map((pts, i) => (
        <Line key={`I${i}`} pts={pts} w={4} color={MAP.majorInner} />
      ))}
      <Line pts={RAIL} w={2} color={MAP.rail} />
      {/* Beschriftungen über den Straßen */}
      <Box r={{ x: 230, y: 118, w: 50, h: 12 }} style={s.mapLabelBox}>
        <MText size={7.5} weight="bold" color="#6F8F9C">
          Stadtpark
        </MText>
      </Box>
      <Box r={{ x: 140, y: 530, w: 60, h: 14 }}>
        <MText size={8} weight="bold" color="#5E6A88">
          Elbe
        </MText>
      </Box>
    </View>
  );
}

/** Hinweis als Pille in der Farbe der Art: Icon + Linie (wie .tip in website/map/map.css). */
function Tip({ kind, line, p, selected }: { kind: ReportKind; line: string; p: P; selected?: boolean }) {
  const w = tipW(line);
  return (
    <View
      style={[
        s.tip,
        { left: p.x - w / 2, top: p.y - 10, width: w, backgroundColor: KIND_COLOR[kind] },
        selected && { borderColor: colors.text, transform: [{ scale: 1.14 }] },
      ]}>
      <View style={s.tipIcon}>
        <MaterialCommunityIcons name={KIND_ICON[kind]} size={10} color={colors.textOnLight} />
      </View>
      <MText size={8.5} weight="extrabold" color={colors.textOnLight}>
        {line}
      </MText>
    </View>
  );
}

function UserDot({ p }: { p: P }) {
  return (
    <>
      <View style={[s.accuracy, { left: p.x - 22, top: p.y - 22 }]} />
      <View style={[s.me, { left: p.x - 7, top: p.y - 7 }]} />
    </>
  );
}

function Fab({ r, icon, active }: { r: Rect; icon: 'navigation' | 'maximize'; active?: boolean }) {
  return (
    <Box r={r} style={s.fab}>
      <Feather name={icon} size={14} color={active ? colors.cyan : colors.text} />
    </Box>
  );
}

function Attribution({ lang }: { lang: 'en' | 'de' }) {
  return (
    <Box r={{ x: 6, y: 576, w: 220, h: 14 }} style={{ alignItems: 'flex-start' }}>
      <View style={s.attribution}>
        <MText size={6.5} weight="semibold" color={colors.textMuted}>
          {`OpenFreeMap © OpenMapTiles © ${lang === 'de' ? 'OpenStreetMap-Mitwirkende' : 'OpenStreetMap contributors'}`}
        </MText>
      </View>
    </Box>
  );
}

const KIND_LABEL: Record<ReportKind, { de: string; en: string }> = {
  DELAY: { de: 'Verspätung', en: 'Delay' },
  CANCELLED: { de: 'Ausfall', en: 'Cancelled' },
  CROWDED: { de: 'Überfüllt', en: 'Crowded' },
  DISRUPTION: { de: 'Störung', en: 'Disruption' },
  CHECK: { de: 'Kontrolle', en: 'Ticket check' },
};

/** Kopf der Karte: Zurück, Titel + Anzahl, Filter "Alle / Verspätung / …" mit Zahlen. */
function MapHeader({ title, subtitle, lang, kind }: { title: string; subtitle: string; lang: 'en' | 'de'; kind: ReportKind | null }) {
  const counts: [ReportKind, number][] = [
    ['DELAY', 2],
    ['CANCELLED', 1],
  ];
  return (
    <Box r={R.header} style={s.header}>
      <MockStatusBar />
      <View style={s.headerRow}>
        <View style={[s.round, { width: 30, height: 30, backgroundColor: colors.surfaceAlt }]}>
          <Feather name="arrow-left" size={14} color={colors.text} />
        </View>
        <View style={{ flex: 1 }}>
          <MText size={12} weight="bold" lines={1}>
            {title}
          </MText>
          <MText size={8.5} weight="medium" color={colors.textMuted} lines={1}>
            {subtitle}
          </MText>
        </View>
      </View>
      <Box r={{ ...R.chips, y: R.chips.y }} style={s.chips}>
        <KindChip label={lang === 'de' ? 'Alle' : 'All'} count={6} selected={kind === null} />
        {counts.map(([k, n]) => (
          <KindChip key={k} kind={k} label={KIND_LABEL[k][lang]} count={n} selected={kind === k} />
        ))}
      </Box>
    </Box>
  );
}

function KindChip({ kind, label, count, selected }: { kind?: ReportKind; label: string; count: number; selected: boolean }) {
  const color = kind ? KIND_COLOR[kind] : colors.lime;
  const fg = selected ? colors.textOnLight : colors.text;
  return (
    <View style={[s.chip, selected ? { backgroundColor: color, borderColor: color } : null]}>
      {kind ? <MaterialCommunityIcons name={KIND_ICON[kind]} size={10} color={selected ? colors.textOnLight : color} /> : null}
      <MText size={8.5} weight="bold" color={fg}>
        {label}
      </MText>
      <View style={[s.count, { backgroundColor: selected ? 'rgba(20,32,58,0.14)' : colors.surfaceAlt }]}>
        <MText size={7.5} weight="bold" color={selected ? colors.textOnLight : colors.textMuted}>
          {count}
        </MText>
      </View>
    </View>
  );
}

/** Karte unten mit Details zum Hinweis (wie TipCard in app/map.tsx). */
function TipCard({ lang }: { lang: 'en' | 'de' }) {
  const de = lang === 'de';
  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        <View style={[s.badge, { backgroundColor: KIND_COLOR.DELAY }]}>
          <MaterialCommunityIcons name={KIND_ICON.DELAY} size={10} color={colors.textOnLight} />
          <MText size={8.5} weight="bold" color={colors.textOnLight}>
            {de ? 'Verspätung' : 'Delay'}
          </MText>
        </View>
        <MText size={8.5} weight="medium" color={colors.textMuted} style={{ flex: 1 }}>
          {de ? 'vor 6 Min' : '6 min ago'}
        </MText>
        <View style={[s.round, { width: 22, height: 22, backgroundColor: colors.surfaceAlt }]}>
          <Feather name="x" size={12} color={colors.textMuted} />
        </View>
      </View>
      <View style={s.cardTop}>
        <LineBadge name="U3" mode="SUBWAY" />
        <MText size={12} weight="bold">
          → Barmbek
        </MText>
      </View>
      <View style={{ gap: 1 }}>
        <MText size={10} weight="semibold" lines={2}>
          {de ? 'Zwischen Mönckebergstraße und Hauptbahnhof Süd' : 'Between Mönckebergstraße and Hauptbahnhof Süd'}
        </MText>
        <MText size={8.5} weight="medium" color={colors.textMuted}>
          {de ? '5–15 Min.' : '5–15 min'}
        </MText>
        <View style={s.confirm}>
          <Feather name="check-circle" size={10} color={colors.lime} />
          <MText size={8.5} weight="medium" color={colors.lime}>
            {de ? 'Von 2 Personen bestätigt' : 'Confirmed by 2 people'}
          </MText>
        </View>
      </View>
      <View style={s.cardBtn}>
        <MText size={9.5} weight="bold" color={colors.textOnLight}>
          {de ? 'Linie öffnen' : 'Open line'}
        </MText>
        <Feather name="arrow-right" size={11} color={colors.textOnLight} />
      </View>
    </View>
  );
}

function LineBadge({ name, mode }: { name: string; mode: Mode }) {
  return (
    <View style={[s.lineBadge, { backgroundColor: modeColor[mode] }]}>
      <MText size={9.5} weight="extrabold" color="#FFFFFF">
        {name}
      </MText>
    </View>
  );
}

/** Eingezeichnete Verbindung: weiß umrandete Linien in Linienfarbe, Start/Umstieg/Ziel mit Gleis. */
function Route({ lang }: { lang: 'en' | 'de' }) {
  const de = lang === 'de';
  return (
    <>
      <Line pts={S1_PATH} w={8} color="#FFFFFF" />
      <Line pts={BUS_PATH} w={8} color="#FFFFFF" />
      <Line pts={S1_PATH} w={4.5} color={modeColor.SUBURBAN} />
      <Line pts={BUS_PATH} w={4.5} color={modeColor.BUS} />
      <RouteBadge p={{ x: 196, y: 282 }} name="S1" color={modeColor.SUBURBAN} />
      <RouteBadge p={{ x: 230, y: 178 }} name="118" color={modeColor.BUS} />
      <RoutePoint p={HBF} kind="start" name="Hamburg Hbf" sub={de ? 'Gleis 4' : 'Platform 4'} />
      <RoutePoint p={BARMBEK} kind="via" name="Barmbek" sub={de ? 'Gleis 2 → Steig B' : 'Platform 2 → Platform B'} left />
      <RoutePoint p={STADTPARK} kind="end" name="Stadtpark" left />
    </>
  );
}

function RouteBadge({ p, name, color }: { p: P; name: string; color: string }) {
  return (
    <View style={[s.routeBadge, { left: p.x - 16, top: p.y - 9, backgroundColor: color }]}>
      <MText size={8.5} weight="extrabold" color="#FFFFFF">
        {name}
      </MText>
    </View>
  );
}

function RoutePoint({ p, kind, name, sub, left }: { p: P; kind: 'start' | 'via' | 'end'; name: string; sub?: string; left?: boolean }) {
  const d = kind === 'end' ? 13 : 10;
  return (
    <>
      <View
        style={[
          s.rpDot,
          { left: p.x - d / 2, top: p.y - d / 2, width: d, height: d, borderRadius: d / 2 },
          kind === 'start' && { backgroundColor: colors.bg, borderColor: '#FFFFFF' },
          kind === 'end' && { backgroundColor: colors.lime },
        ]}
      />
      <View style={[s.rpLabel, { top: p.y - (sub ? 15 : 9) }, left ? { right: 300 - p.x + 10 } : { left: p.x + 10 }]}>
        <MText size={8.5} weight="bold" lines={1}>
          {name}
        </MText>
        {sub ? (
          <MText size={7.5} weight="extrabold" color={colors.lime} lines={1}>
            {sub}
          </MText>
        ) : null}
      </View>
    </>
  );
}

function Times({ r, dep, arr }: { r: Rect; dep: string; arr: string }) {
  return (
    <>
      <Box r={{ x: 14, y: r.y + 1, w: 44, h: 16 }}>
        <MText size={10.5} weight="bold">
          {dep}
        </MText>
      </Box>
      <Box r={{ x: 30, y: r.y + 20, w: 2, h: r.h - 40 }} style={s.dash} />
      <Box r={{ x: 14, y: r.y + r.h - 16, w: 44, h: 16 }}>
        <MText size={10.5} weight="bold" color={colors.textMuted}>
          {arr}
        </MText>
      </Box>
    </>
  );
}

const s = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  round: { borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceDeep,
    borderRadius: 23,
    paddingLeft: 7,
    paddingRight: 14,
  },
  searchIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  mapLabelBox: { alignItems: 'center' },
  lake: { position: 'absolute', backgroundColor: MAP.water, borderRadius: 22 },
  tip: {
    position: 'absolute',
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 2,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  tipIcon: { width: 15, height: 15, borderRadius: 8, backgroundColor: 'rgba(20,32,58,0.14)', alignItems: 'center', justifyContent: 'center' },
  accuracy: { position: 'absolute', width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(46,200,230,0.12)', borderWidth: 1, borderColor: 'rgba(46,200,230,0.4)' },
  me: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: colors.cyan, borderWidth: 2.5, borderColor: '#FFFFFF' },
  fab: { borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  attribution: { backgroundColor: 'rgba(17,26,48,0.78)', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
  header: { backgroundColor: 'rgba(22,32,58,0.95)', borderBottomLeftRadius: 20, borderBottomRightRadius: 20 },
  headerRow: { position: 'absolute', left: 12, right: 12, top: 27, flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { flexDirection: 'row', gap: 5 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  count: { minWidth: 13, height: 13, borderRadius: 7, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 8,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, borderRadius: 10, paddingHorizontal: 8 },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  cardBtn: {
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.lime,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  lineBadge: { height: 20, minWidth: 26, paddingHorizontal: 6, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  routeBadge: {
    position: 'absolute',
    width: 32,
    height: 18,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rpDot: { position: 'absolute', backgroundColor: '#FFFFFF', borderWidth: 2.5, borderColor: colors.bg },
  rpLabel: {
    position: 'absolute',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: 'rgba(17,26,48,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  dash: { borderLeftWidth: 1, borderStyle: 'dashed', borderColor: colors.textFaint },
});

export const map: Tutorial = {
  id: 'map',
  icon: 'map',
  category: 'ride',
  question: {
    de: 'Kann ich Meldungen und meine Strecke auf einer Karte sehen?',
    en: 'Can I see reports and my route on a map?',
  },
  answer: {
    de: 'Ja. Auf Start öffnet das Karten-Symbol oben (oder „Karte“ bei „Gerade gemeldet“) die Karte mit allen Hinweisen der letzten 2 Stunden. Oben filterst du nach Art, ein Tipp auf einen Hinweis zeigt Details. Deine eigene Verbindung siehst du, wenn du sie öffnest und auf „Auf der Karte zeigen“ tippst – mit Umstiegen und Gleisen.',
    en: 'Yes. On Home, the map icon at the top (or “Map” next to “Just reported”) opens the map with all tips from the last 2 hours. Filter by type at the top; tap a tip for details. To see your own connection, open it and tap “Show on map” – with changes and platforms.',
  },
  where: { de: 'Start → Karten-Symbol · Verbindung → Auf der Karte zeigen', en: 'Home → map icon · Connection → Show on map' },
  tryIt: '/map',
  steps: [
    {
      caption: {
        de: 'Tippe auf Start oben auf das Karten-Symbol. „Karte“ bei „Gerade gemeldet“ führt auch dorthin.',
        en: 'On Home, tap the map icon at the top. “Map” next to “Just reported” works too.',
      },
      target: center(R.mapBtn),
      read: 2400,
    },
    {
      caption: {
        de: 'Die Karte zeigt Hinweise der letzten 2 Stunden. Oben filterst du nach Art, z. B. Verspätung.',
        en: 'The map shows tips from the last 2 hours. Filter by type at the top, e.g. Delay.',
      },
      target: { x: 100, y: center(R.chips).y },
      read: 2600,
    },
    {
      caption: {
        de: 'Jeder Hinweis ist eine Pille mit der Linie. Tippe darauf, um Details zu sehen.',
        en: 'Each tip is a pill with its line. Tap it to see details.',
      },
      target: center(tipRect(U3), 6, 2),
      read: 2200,
    },
    {
      caption: {
        de: 'Du siehst, wo es passiert ist und wie viele es bestätigt haben. „Linie öffnen“ zeigt mehr zur Linie.',
        en: 'You see where it happened and how many confirmed it. “Open line” shows more about the line.',
      },
      target: { x: 166, y: R.card.y + 107 },
      tap: false,
      read: 3000,
    },
    {
      caption: {
        de: 'Auch deine Strecke passt auf die Karte: Öffne eine Verbindung und tippe auf „Auf der Karte zeigen“.',
        en: 'Your route fits on the map too: open a connection and tap “Show on map”.',
      },
      target: center(R.showOnMap, 10, 2),
      read: 2600,
    },
    {
      caption: {
        de: 'Fertig: Deine Strecke ist farbig eingezeichnet – mit Umstieg, Gleisen und den Hinweisen unterwegs.',
        en: 'Done: your route is drawn in colour – with the change, platforms and tips along the way.',
      },
    },
  ],
  Scene: MapScene,
};
