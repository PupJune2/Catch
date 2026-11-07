// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Tutorial "Adresse statt Haltestelle": In der Suche auf "Start wählen" tippen, die Adresse
 * eintippen, am Icon Adresse / Haltestelle / Ort unterscheiden und die Adresse übernehmen.
 */
import { Feather } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ModeIcon } from '@/components/transit';
import { colors } from '@/theme';
import { Appear, Box, center, MockScreen, MockStatusBar, MockTabBar, MText, Pulse, Typing, type Rect } from '../mock';
import type { SceneProps, Tutorial } from '../types';
import { MockSearchEmpty, MockSearchForm, SEARCH, searchBottom, useAfter } from './planShared';

type FeatherName = ComponentProps<typeof Feather>['name'];

const ROW_H = 46;
const ROWS_Y = 112;
const QUERY = 'Weseler Str 108';
/** So lange tippt `Typing` (75 ms je Zeichen) – danach erscheinen die Treffer */
const TYPE_MS = QUERY.length * 75 + 250;

// Layout (Mock-Telefon 300 × 600)
const R = {
  close: { x: 14, y: 28, w: 28, h: 28 },
  input: { x: 16, y: 64, w: 268, h: 38 },
  current: { x: 16, y: 142, w: 268, h: ROW_H },
  notice: { x: 22, y: 200, w: 256, h: 44 },
  address: { x: 16, y: ROWS_Y, w: 268, h: ROW_H },
  /** Spalte mit den drei Icons (Adresse, Haltestelle, Ort) */
  icons: { x: 24, y: ROWS_Y + 8, w: 30, h: ROW_H * 2 + 30 },
} satisfies Record<string, Rect>;
const KEYBOARD: Rect = { x: 0, y: 430, w: 300, h: 170 };

function AddressScene({ step, lang }: SceneProps) {
  const de = lang === 'de';
  const L = (d: string, e: string) => (de ? d : e);
  const picking = step >= 1 && step <= 4;
  const typing = step >= 2;
  // Treffer kommen, sobald fertig getippt ist (bzw. sofort in späteren Schritten)
  const typed = useAfter(step === 2, TYPE_MS);
  const results = step >= 3 || typed;
  const picked = step >= 5;

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* --- 1. Suche ------------------------------------------------------------ */}
      <MockStatusBar />
      <MockSearchForm
        lang={lang}
        from={picked ? { name: 'Weseler Straße 108', detail: '48151 Münster', icon: 'map-pin' } : null}
      />
      <Pulse r={SEARCH.from} active={step === 0} radius={14} />
      <MockSearchEmpty lang={lang} y={searchBottom(false) + 30} />
      <MockTabBar active="search" lang={lang} />

      {/* --- 2. Ort wählen (Vollbild, fährt von unten herein) ------------------------- */}
      <MockScreen show={picking} from="up">
        <MockStatusBar />
        <Box r={R.close} style={s.close}>
          <Feather name="x" size={14} color={colors.text} />
        </Box>
        <Box r={{ x: 50, y: 28, w: 200, h: 28 }} style={s.centerBox}>
          <MText size={12} weight="bold">
            Start
          </MText>
        </Box>
        <Box r={R.input} style={[s.input, s.inputFocused]}>
          <Feather name="search" size={12} color={colors.textMuted} />
          {step === 1 ? <View style={s.cursor} /> : null}
          <View style={{ flex: 1 }}>
            <Typing
              text={QUERY}
              active={step === 2}
              done={step > 2}
              size={10.5}
              placeholder={L('Adresse, Haltestelle oder Ort', 'Address, stop or place')}
            />
          </View>
          {typing ? <Feather name="x-circle" size={12} color={colors.textMuted} /> : null}
        </Box>

        {/* Vor dem Tippen: Zuhause/Arbeit, aktueller Standort, Hinweis */}
        <Appear show={!typing} duration={200}>
          <Box r={{ x: 16, y: 112, w: 268, h: 22 }} style={{ flexDirection: 'row', gap: 6 }}>
            <DashedChip text={L('Zuhause festlegen', 'Add home')} />
            <DashedChip text={L('Arbeit festlegen', 'Add work')} />
          </Box>
          <PlaceRow
            r={R.current}
            tile={colors.lime}
            icon={<Feather name="navigation" size={13} color={colors.textOnLight} />}
            title={L('Aktueller Standort', 'Current location')}
            detail={L('Nutzt einmalig deine Position', 'Uses your position once')}
          />
          <Pulse r={R.current} active={step === 1} radius={12} color={colors.cyan} />
          <Box r={R.notice} style={{ flexDirection: 'row', gap: 6 }}>
            <Feather name="lock" size={10} color={colors.textMuted} style={{ marginTop: 1 }} />
            <MText size={8} weight="medium" color={colors.textMuted} style={{ flex: 1 }}>
              {L(
                'Tippe bei einem Treffer auf ⋯, um ihn als Zuhause, Arbeit oder Favorit zu speichern. Nur auf diesem Gerät gespeichert.',
                'Tap ⋯ next to a result to save it as Home, Work or favourite. Saved only on this device.',
              )}
            </MText>
          </Box>
        </Appear>

        {/* Treffer: Adresse (Pin), Haltestelle (Fahrzeug), Ort (Fahne) */}
        <Appear show={results} from="up" distance={10}>
          <PlaceRow
            r={R.address}
            icon={<Feather name="map-pin" size={13} color={colors.cyan} />}
            title="Weseler Straße 108"
            detail={L('48151 Münster · 1,2 km entfernt', '48151 Münster · 1.2 km away')}
            more
          />
          <Sep y={ROWS_Y + ROW_H} />
          <PlaceRow
            r={{ ...R.address, y: ROWS_Y + ROW_H + 1 }}
            icon={<ModeIcon mode="BUS" size={14} color={colors.lime} />}
            title="Weseler Straße"
            detail={L('Münster · 350 m entfernt', 'Münster · 350 m away')}
            modes={<ModeIcon mode="BUS" size={12} color={colors.textMuted} />}
            more
          />
          <Sep y={ROWS_Y + ROW_H * 2 + 1} />
          <PlaceRow
            r={{ ...R.address, y: ROWS_Y + ROW_H * 2 + 2 }}
            icon={<Feather name="flag" size={13} color={colors.lilac} />}
            title="Spielplatz Weseler Straße"
            detail={L('Münster · 900 m entfernt', 'Münster · 900 m away')}
            more
          />
          <Pulse r={R.icons} active={step === 3} radius={10} color={colors.cyan} />
          <Pulse r={R.address} active={step === 4} radius={12} />
        </Appear>

        {/* Das Suchfeld ist sofort aktiv (autoFocus) – die Tastatur ist offen */}
        <MockKeyboard lang={lang} />
      </MockScreen>
    </View>
  );
}

function PlaceRow({
  r,
  icon,
  tile = colors.surface,
  title,
  detail,
  modes,
  more,
}: {
  r: Rect;
  icon: ReactNode;
  tile?: string;
  title: string;
  detail: string;
  modes?: ReactNode;
  more?: boolean;
}) {
  return (
    <Box r={r} style={s.row}>
      <View style={[s.tile, { backgroundColor: tile }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <MText size={10.5} lines={1}>
          {title}
        </MText>
        <MText size={8.5} weight="medium" color={colors.textMuted} lines={1}>
          {detail}
        </MText>
      </View>
      {modes}
      {more ? <Feather name="more-horizontal" size={13} color={colors.textMuted} /> : null}
    </Box>
  );
}

/** Vereinfachte Bildschirmtastatur (QWERTZ bzw. QWERTY). */
function MockKeyboard({ lang }: { lang: 'en' | 'de' }) {
  const de = lang === 'de';
  const rows = de ? ['qwertzuiop', 'asdfghjklö', 'yxcvbnm'] : ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  return (
    <Box r={KEYBOARD} style={s.keyboard}>
      {rows.map((row, i) => (
        <View key={row} style={s.keyRow}>
          {i === 2 ? <Key wide icon="arrow-up" /> : null}
          {row.split('').map((k) => (
            <Key key={k} label={k} />
          ))}
          {i === 2 ? <Key wide icon="delete" /> : null}
        </View>
      ))}
      <View style={s.keyRow}>
        <Key wide label="123" />
        <View style={[s.key, { flex: 1 }]} />
        <View style={[s.key, s.keyGo]}>
          <MText size={8.5} weight="bold" color={colors.textOnLight}>
            {de ? 'Suchen' : 'Search'}
          </MText>
        </View>
      </View>
    </Box>
  );
}

function Key({ label, icon, wide }: { label?: string; icon?: FeatherName; wide?: boolean }) {
  return (
    <View style={[s.key, wide && s.keyWide]}>
      {icon ? (
        <Feather name={icon} size={10} color={colors.text} />
      ) : (
        <MText size={wide ? 8 : 10} weight="medium">
          {label}
        </MText>
      )}
    </View>
  );
}

const Sep = ({ y }: { y: number }) => <Box r={{ x: 62, y, w: 222, h: 1 }} style={{ backgroundColor: colors.border }} />;

function DashedChip({ text, icon = 'plus' }: { text: string; icon?: FeatherName }) {
  return (
    <View style={s.dashed}>
      <Feather name={icon} size={9} color={colors.textMuted} />
      <MText size={8.5} weight="bold">
        {text}
      </MText>
    </View>
  );
}

const s = StyleSheet.create({
  close: { borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  centerBox: { alignItems: 'center', justifyContent: 'center' },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    borderRadius: 19,
    backgroundColor: colors.surfaceDeep,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  inputFocused: { borderColor: 'rgba(199,232,165,0.55)' },
  cursor: { width: 1.5, height: 13, backgroundColor: colors.lime, marginRight: -5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  tile: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  keyboard: { backgroundColor: colors.surfaceDeep, paddingTop: 8, paddingHorizontal: 4, gap: 6 },
  keyRow: { flexDirection: 'row', justifyContent: 'center', gap: 4 },
  key: { height: 28, minWidth: 24, flexShrink: 1, borderRadius: 5, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  keyWide: { minWidth: 34, paddingHorizontal: 6, backgroundColor: colors.surface },
  keyGo: { minWidth: 60, backgroundColor: colors.lime },
  dashed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
});

export const address: Tutorial = {
  id: 'address',
  icon: 'home',
  category: 'plan',
  question: {
    de: 'Kann ich meine Adresse statt einer Haltestelle eingeben?',
    en: 'Can I enter my address instead of a stop?',
  },
  answer: {
    de: 'Ja. Tippe in der Suche auf „Start wählen“ oder „Ziel wählen“ und gib Straße und Hausnummer ein – Haltestellen und Orte findest du im selben Feld. Am Icon erkennst du die Art: Pin = Adresse, Fahrzeug = Haltestelle, Fahne = Ort. Mit „Aktueller Standort“ startest du direkt dort, wo du gerade bist.',
    en: 'Yes. In Search, tap “Choose start” or “Choose destination” and type a street with house number – stops and places are found in the same field. The icon shows the type: pin = address, vehicle = stop, flag = place. “Current location” starts right where you are.',
  },
  where: { de: 'Suche → Start wählen / Ziel wählen', en: 'Search → Choose start / Choose destination' },
  tryIt: '/search',
  steps: [
    {
      caption: { de: 'Tippe in der Suche auf „Start wählen“.', en: 'In Search, tap “Choose start”.' },
      target: center(SEARCH.from, 12, 4),
      read: 1800,
    },
    {
      caption: {
        de: 'Die Ortsauswahl öffnet sich. Tipp: „Aktueller Standort“ nimmt einfach deine Position als Start.',
        en: 'The place picker opens. Tip: “Current location” simply uses your position as the start.',
      },
      target: center(R.current, 30, 2),
      tap: false,
      read: 2800,
    },
    {
      caption: {
        de: 'Tippe deine Adresse ein – Straße und Hausnummer reichen, z. B. „Weseler Str 108“.',
        en: 'Type your address – street and house number are enough, e.g. “Weseler Str 108”.',
      },
      read: 2800,
    },
    {
      caption: {
        de: 'Am Icon erkennst du, was ein Treffer ist: Pin = Adresse, Fahrzeug = Haltestelle, Fahne = Ort.',
        en: 'The icon shows what a result is: pin = address, vehicle = stop, flag = place.',
      },
      target: { x: center(R.icons).x, y: R.icons.y + R.icons.h + 18 },
      tap: false,
      read: 3200,
    },
    { caption: { de: 'Tippe auf die Adresse.', en: 'Tap the address.' }, target: center(R.address, 60, 2), read: 1600 },
    {
      caption: {
        de: 'Fertig: Die Adresse steht im Von-Feld. Den Fußweg zur Haltestelle plant Catch automatisch mit.',
        en: 'Done: the address is in the From field. Catch plans the walk to the stop for you.',
      },
    },
  ],
  Scene: AddressScene,
};
