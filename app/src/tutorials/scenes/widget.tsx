// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Tutorial "Homescreen-Widget" (nur Android): freie Stelle gedrückt halten → Widgets → Catch →
 * Widget platzieren. Das Widget selbst ist das echte (widget/DeparturesWidget.tsx), gezeichnet mit
 * der Vorschau aus widget/MirrorPreview.tsx und festen Beispieldaten – also genau das, was es zeigt.
 */
import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { GhostLogo } from '@/components/GhostLogo';
import type { Lang } from '@/i18n';
import { colors } from '@/theme';
import type { WidgetSnapshot } from '@/widget/data';
import { DeparturesWidget } from '@/widget/DeparturesWidget';
import { MirrorPreview } from '@/widget/MirrorPreview';
import { Appear, Box, center, MockStatusBar, MText, Pulse, useGlide, type Rect } from '../mock';
import type { SceneProps, Tutorial } from '../types';
import { pick, Wallpaper } from './alertsKit';

type FeatherName = ComponentProps<typeof Feather>['name'];

// Layout (Mock-Telefon 300 × 600)
const COL = [37.5, 112.5, 187.5, 262.5];
const ICON = 42;
const PICKER_TOP = 40;
const ROW_H = 48;
const ROWS_Y = 134;
/** So weit rutschen die Apps unter "Catch" beim Aufklappen */
const EXPAND = 196;
const R = {
  slot: { x: 15, y: 82, w: 270, h: 135 },
  menu: { x: 60, y: 168, w: 180, h: 102 },
  widgetsItem: { x: 64, y: 203, w: 172, h: 32 },
  catchRow: { x: 12, y: ROWS_Y + ROW_H, w: 276, h: ROW_H },
  preview: { x: 32, y: ROWS_Y + 2 * ROW_H + 18, w: 236, h: 118 },
} satisfies Record<string, Rect>;

/** Beispieldaten fürs Widget: Münster Hbf, Mo 9.11. um 9:41 (wie die Uhr im Mock-Telefon). */
const at = (hm: string) => `2026-11-09T${hm}:00+01:00`;
const NOW = Date.parse(at('09:41'));
const rb65 = { key: 'tut:rb65', name: 'RB65', mode: 'REGIONAL' as const };
const rb69 = { key: 'tut:rb69', name: 'RB69', mode: 'REGIONAL' as const };
const re2 = { key: 'tut:re2', name: 'RE2', mode: 'REGIONAL' as const };
const bus10 = { key: 'tut:bus10', name: '10', mode: 'BUS' as const };
const SNAPSHOT: WidgetSnapshot = {
  stopId: 'tutorial',
  stopName: 'Münster Hbf',
  fetchedAt: at('09:41'),
  lineStatus: { line: rb69, level: 'active', lastKind: 'DELAY', lastReportAt: at('09:36'), recentCount: 1 },
  departures: [
    { tripId: 'a', plannedTime: at('09:44'), time: at('09:44'), delayMin: 0, realtime: true, cancelled: false, line: rb65, headsign: 'Rheine', track: '11', level: 'calm', activeKind: null },
    { tripId: 'b', plannedTime: at('09:46'), time: at('09:47'), delayMin: 1, realtime: true, cancelled: false, line: bus10, headsign: 'Gievenbeck', track: 'B1', level: 'calm', activeKind: null },
    { tripId: 'c', plannedTime: at('09:48'), time: at('09:54'), delayMin: 6, realtime: true, cancelled: false, line: rb69, headsign: 'Bielefeld Hbf', track: '5', plannedTrack: '7', level: 'active', activeKind: 'DELAY' },
    { tripId: 'd', plannedTime: at('09:52'), time: at('09:52'), delayMin: null, realtime: false, cancelled: false, line: re2, headsign: 'Düsseldorf Hbf', track: '3', level: 'calm', activeKind: null },
    { tripId: 'e', plannedTime: at('09:58'), time: at('09:58'), delayMin: null, realtime: false, cancelled: true, line: bus10, headsign: 'Roxel', track: 'B2', level: 'calm', activeKind: null },
  ],
};
/** Größe, in der das Widget gezeichnet wird (dp, 4 × 2 Zellen) – danach auf `r` verkleinert */
const W_DP = 360;
const H_DP = 180;

const APPS: { de: string; en: string; icon: FeatherName | 'catch'; color: string }[] = [
  { de: 'Kalender', en: 'Calendar', icon: 'calendar', color: '#4F8DF5' },
  { de: 'Uhr', en: 'Clock', icon: 'clock', color: '#5C6BC0' },
  { de: 'Wetter', en: 'Weather', icon: 'cloud', color: '#F2A33A' },
  { de: 'Galerie', en: 'Gallery', icon: 'image', color: '#E35D6A' },
  { de: 'Karten', en: 'Maps', icon: 'map-pin', color: '#34A853' },
  { de: 'Musik', en: 'Music', icon: 'music', color: '#AB47BC' },
  { de: 'Catch', en: 'Catch', icon: 'catch', color: colors.bg },
  { de: 'Einstellungen', en: 'Settings', icon: 'settings', color: '#78909C' },
];
const DOCK: { icon: FeatherName; color: string }[] = [
  { icon: 'phone', color: '#34A853' },
  { icon: 'message-circle', color: '#4F8DF5' },
  { icon: 'globe', color: '#F2A33A' },
  { icon: 'camera', color: '#607D8B' },
];
const PICKER_APPS: { de: string; en: string; icon: FeatherName | 'catch'; color: string; count: number }[] = [
  { de: 'Akku', en: 'Battery', icon: 'battery-charging', color: '#43A047', count: 1 },
  { de: 'Catch', en: 'Catch', icon: 'catch', color: colors.bg, count: 1 },
  { de: 'Kalender', en: 'Calendar', icon: 'calendar', color: '#4F8DF5', count: 2 },
  { de: 'Uhr', en: 'Clock', icon: 'clock', color: '#5C6BC0', count: 3 },
  { de: 'Wetter', en: 'Weather', icon: 'cloud', color: '#F2A33A', count: 1 },
];

function WidgetScene({ step, lang }: SceneProps) {
  const L = pick(lang);
  const picker = step === 2 || step === 3;
  const expanded = step >= 3;
  const placed = step >= 4;
  const below = useGlide(expanded ? EXPAND : 0, 420);

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* --- Android-Startbildschirm ---------------------------------------------- */}
      <Wallpaper id="widget-home" />
      <MockStatusBar />
      <Box r={{ x: 20, y: 40, w: 260, h: 30 }}>
        <MText size={12} weight="bold" lines={1}>
          {L('Montag, 9. Nov.', 'Monday, 9 Nov')}
        </MText>
        <View style={s.row}>
          <Feather name="cloud" size={9} color="rgba(255,255,255,0.8)" />
          <MText size={8.5} weight="medium" color="rgba(255,255,255,0.8)">
            8 °C
          </MText>
        </View>
      </Box>
      {APPS.map((a, i) => (
        <AppIcon key={a.de} x={COL[i % 4]} y={292 + Math.floor(i / 4) * 74} icon={a.icon} color={a.color} label={L(a.de, a.en)} />
      ))}
      {DOCK.map((d, i) => (
        <AppIcon key={d.icon} x={COL[i]} y={452} icon={d.icon} color={d.color} />
      ))}
      <Box r={{ x: 16, y: 512, w: 268, h: 36 }} style={s.searchPill}>
        <Feather name="search" size={13} color="#5B6275" />
        <View style={{ flex: 1 }} />
        <Feather name="mic" size={13} color="#5B6275" />
      </Box>
      <Box r={{ x: 110, y: 586, w: 80, h: 4 }} style={s.handle} />
      <Pulse r={{ x: 126, y: 126, w: 48, h: 48 }} active={step === 0} radius={24} color="#FFFFFF" />

      {/* Platziertes Widget */}
      <Appear show={placed} from="scale" fill={false} style={{ position: 'absolute', left: R.slot.x, top: R.slot.y, width: R.slot.w, height: R.slot.h }}>
        <CatchWidget r={{ x: 0, y: 0, w: R.slot.w, h: R.slot.h }} lang={lang} />
      </Appear>

      {/* --- 1. Menü nach langem Drücken ------------------------------------------- */}
      <Appear show={step === 1}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(8,12,24,0.35)' }]} />
      </Appear>
      <Appear show={step === 1} from="scale" fill={false} style={{ position: 'absolute', left: R.menu.x, top: R.menu.y, width: R.menu.w, height: R.menu.h }}>
        <View style={s.menu}>
          <MenuItem icon="image" text={L('Hintergrund & Stil', 'Wallpaper & style')} />
          <MenuItem icon="grid" text={L('Widgets', 'Widgets')} />
          <MenuItem icon="settings" text={L('Einstellungen', 'Settings')} />
        </View>
      </Appear>
      <Pulse r={R.widgetsItem} active={step === 1} radius={10} color="#FFFFFF" />

      {/* --- 2.–3. Widget-Auswahl ----------------------------------------------------- */}
      <Appear show={picker} from="up" distance={560} duration={420} style={{ top: PICKER_TOP }}>
        <View style={s.picker}>
          <View style={s.pickerHandle} />
        </View>
      </Appear>
      <Appear show={picker} from="up" distance={560} duration={420}>
        <Box r={{ x: 16, y: PICKER_TOP + 18, w: 268, h: 22 }}>
          <MText size={15} weight="bold" center>
            Widgets
          </MText>
        </Box>
        <Box r={{ x: 16, y: PICKER_TOP + 48, w: 268, h: 32 }} style={s.pickerSearch}>
          <Feather name="search" size={11} color="#9AA0B4" />
          <MText size={9.5} weight="medium" color="#9AA0B4">
            {L('Widgets suchen', 'Search widgets')}
          </MText>
        </Box>
        {PICKER_APPS.map((a, i) => {
          const row = <PickerRow key={a.de} i={i} a={a} lang={lang} open={a.icon === 'catch' && expanded} />;
          return i >= 2 ? (
            <Animated.View key={a.de} style={[StyleSheet.absoluteFill, { transform: [{ translateY: below }] }]}>
              {row}
            </Animated.View>
          ) : (
            row
          );
        })}
        <Pulse r={R.catchRow} active={step === 2} radius={12} color="#FFFFFF" />

        {/* Catch aufgeklappt: Vorschau des Widgets (4 × 2) */}
        <Appear show={expanded} from="fade" fill={false} style={s.previewWrap}>
          <View style={s.previewCard} />
        </Appear>
        <Appear show={expanded} from="down" distance={10}>
          <CatchWidget r={R.preview} lang={lang} />
          <Box r={{ x: 32, y: R.preview.y + R.preview.h + 8, w: 236, h: 26 }} style={{ alignItems: 'center' }}>
            <MText size={9.5} weight="bold" color="#FFFFFF">
              Catch
            </MText>
            <MText size={8} weight="medium" color="#9AA0B4">
              4 × 2
            </MText>
          </Box>
          <Pulse r={R.preview} active={step === 3} radius={16} color="#FFFFFF" />
        </Appear>
      </Appear>
    </View>
  );
}

/** Das echte Catch-Widget, in dp gezeichnet und auf `r` verkleinert. */
function CatchWidget({ r, lang }: { r: Rect; lang: Lang }) {
  const scale = r.w / W_DP;
  return (
    <Box r={r}>
      <View style={{ position: 'absolute', left: (r.w - W_DP) / 2, top: (r.h - H_DP) / 2, width: W_DP, height: H_DP, transform: [{ scale }] }}>
        <MirrorPreview
          element={<DeparturesWidget view={{ kind: 'data', snapshot: SNAPSHOT, stale: false }} lang={lang} width={W_DP} height={H_DP} now={NOW} />}
          width={W_DP}
          height={H_DP}
        />
      </View>
    </Box>
  );
}

function AppGlyph({ icon, color, size }: { icon: FeatherName | 'catch'; color: string; size: number }) {
  return (
    <View style={[s.appIcon, { width: size, height: size, borderRadius: size * 0.32, backgroundColor: color }]}>
      {icon === 'catch' ? <GhostLogo size={size * 0.55} /> : <Feather name={icon} size={size * 0.45} color="#FFFFFF" />}
    </View>
  );
}

function AppIcon({ x, y, icon, color, label }: { x: number; y: number; icon: FeatherName | 'catch'; color: string; label?: string }) {
  return (
    <Box r={{ x: x - 36, y, w: 72, h: label ? 60 : ICON }} style={{ alignItems: 'center', gap: 4 }}>
      <AppGlyph icon={icon} color={color} size={ICON} />
      {label ? (
        <MText size={8} weight="medium" color="#FFFFFF" lines={1}>
          {label}
        </MText>
      ) : null}
    </Box>
  );
}

function MenuItem({ icon, text }: { icon: FeatherName; text: string }) {
  return (
    <View style={s.menuItem}>
      <Feather name={icon} size={12} color="#FFFFFF" />
      <MText size={10} weight="medium" color="#FFFFFF" lines={1}>
        {text}
      </MText>
    </View>
  );
}

function PickerRow({ i, a, lang, open }: { i: number; a: (typeof PICKER_APPS)[number]; lang: Lang; open: boolean }) {
  const L = pick(lang);
  return (
    <Box r={{ x: 16, y: ROWS_Y + i * ROW_H, w: 268, h: ROW_H }} style={[s.pickerRow, i > 0 && s.pickerBorder]}>
      <AppGlyph icon={a.icon} color={a.color} size={30} />
      <View style={{ flex: 1 }}>
        <MText size={11} weight="bold" color="#FFFFFF">
          {L(a.de, a.en)}
        </MText>
        <MText size={8.5} weight="medium" color="#9AA0B4">
          {a.count === 1 ? '1 Widget' : `${a.count} Widgets`}
        </MText>
      </View>
      <Feather name={open ? 'chevron-up' : 'chevron-down'} size={14} color="#9AA0B4" />
    </Box>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  appIcon: { alignItems: 'center', justifyContent: 'center' },
  searchPill: { flexDirection: 'row', alignItems: 'center', borderRadius: 18, backgroundColor: 'rgba(238,241,247,0.92)', paddingHorizontal: 14 },
  handle: { borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.7)' },
  menu: { flex: 1, backgroundColor: '#2A2F3F', borderRadius: 16, paddingVertical: 3, paddingHorizontal: 4 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 9, height: 32, paddingHorizontal: 10 },
  picker: { flex: 1, backgroundColor: '#1F2333', borderTopLeftRadius: 22, borderTopRightRadius: 22, alignItems: 'center' },
  pickerHandle: { width: 34, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 8 },
  pickerSearch: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#2C3145', borderRadius: 16, paddingHorizontal: 12 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pickerBorder: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  previewWrap: { position: 'absolute', left: 16, top: ROWS_Y + 2 * ROW_H + 4, width: 268, height: EXPAND - 12 },
  previewCard: { flex: 1, backgroundColor: '#2C3145', borderRadius: 16 },
});

export const widgetTutorial: Tutorial = {
  id: 'widget',
  icon: 'grid',
  category: 'app',
  question: {
    de: 'Gibt es ein Widget für den Startbildschirm?',
    en: 'Is there a home-screen widget?',
  },
  answer: {
    de: 'Ja, auf Android. Halte eine freie Stelle auf dem Startbildschirm gedrückt, tippe auf „Widgets“ und zieh das Catch-Widget auf den Bildschirm – oder tippe in Catch unter Profil → Homescreen-Widget auf „Zum Homescreen hinzufügen“. Das Widget zeigt die nächsten Abfahrten an deiner Haltestelle und auf Wunsch die Hinweis-Lage deiner Lieblingslinie.',
    en: 'Yes, on Android. Long-press an empty spot on your home screen, tap “Widgets” and drag the Catch widget onto the screen – or in Catch, go to Profile → Home-screen widget and tap “Add to home screen”. The widget shows the next departures at your stop and, if you like, the tip status of your favourite line.',
  },
  where: {
    de: 'Startbildschirm lange drücken → Widgets → Catch (oder Profil → Homescreen-Widget)',
    en: 'Long-press home screen → Widgets → Catch (or Profile → Home-screen widget)',
  },
  tryIt: '/widget',
  steps: [
    {
      caption: {
        de: 'Nur auf Android: Halte eine freie Stelle auf dem Startbildschirm gedrückt.',
        en: 'Android only: long-press an empty spot on your home screen.',
      },
      target: { x: 150, y: 150 },
      read: 2600,
    },
    { caption: { de: 'Tippe auf „Widgets“.', en: 'Tap “Widgets”.' }, target: center(R.widgetsItem, 10), read: 1600 },
    { caption: { de: 'Such in der Liste „Catch“ und tippe darauf.', en: 'Find “Catch” in the list and tap it.' }, target: center(R.catchRow, 30), read: 2000 },
    {
      caption: {
        de: 'Halte das Widget gedrückt und zieh es auf eine freie Stelle.',
        en: 'Press and hold the widget and drag it to an empty spot.',
      },
      target: center(R.preview),
      read: 2400,
    },
    {
      caption: {
        de: 'Fertig! Das Widget zeigt Abfahrten und die Lage deiner Linie. Haltestelle wählen: Profil → Homescreen-Widget.',
        en: 'Done! The widget shows departures and your line’s status. Choose the stop: Profile → Home-screen widget.',
      },
    },
  ],
  Scene: WidgetScene,
};
