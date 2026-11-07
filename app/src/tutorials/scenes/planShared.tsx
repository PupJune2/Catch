// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Gemeinsame Bausteine der Tutorials "Adresse" und "Offline": der Suche-Tab im Kleinen
 * (Von/Nach, "Wann?", Offline-Chip, "Verbindungen suchen") – Layout wie in app/(tabs)/search.tsx.
 */
import { Feather } from '@expo/vector-icons';
import { useEffect, useState, type ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { GhostLogo } from '@/components/GhostLogo';
import { colors } from '@/theme';
import { Box, MockButton, MockChip, MText, useReduceMotion, type Rect } from '../mock';

type FeatherName = ComponentProps<typeof Feather>['name'];
type Lang = 'en' | 'de';

/** Inhalt eines Von/Nach-Felds (leer = Platzhalter). */
export interface FieldValue {
  name: string;
  /** grau dahinter, z. B. PLZ + Ort einer Adresse */
  detail?: string;
  /** Icon je Art: Adresse = map-pin, Ort = flag, aktueller Standort = navigation */
  icon?: FeatherName;
}

// Layout (Mock-Telefon 300 × 600)
export const SEARCH = {
  title: { x: 16, y: 30, w: 268, h: 24 },
  chips: { x: 16, y: 60, w: 268, h: 22 },
  fields: { x: 16, y: 90, w: 268, h: 88 },
  /** Von-Zeile ohne Tausch-Knopf (für Finger & Puls) */
  from: { x: 16, y: 90, w: 224, h: 44 },
  to: { x: 16, y: 134, w: 224, h: 44 },
  swap: { x: 246, y: 120, w: 28, h: 28 },
  when: { x: 16, y: 188, w: 214, h: 40 },
  now: { x: 236, y: 197, w: 48, h: 22 },
  offline: { x: 16, y: 238, w: 66, h: 22 },
  find: { x: 16, y: 240, w: 268, h: 34 },
  findOffline: { x: 16, y: 272, w: 268, h: 34 },
} satisfies Record<string, Rect>;

/** Unterkante des Suchformulars (für Inhalt darunter). */
export const searchBottom = (offlineChip: boolean) => (offlineChip ? SEARCH.findOffline : SEARCH.find).y + 34;

/**
 * Kopf des Suche-Tabs. `offline` fehlt = kein Offline-Chip (keine Stadt geladen),
 * sonst Chip "Offline" (an/aus).
 */
export function MockSearchForm({
  lang,
  from,
  to,
  offline,
}: {
  lang: Lang;
  from?: FieldValue | null;
  to?: FieldValue | null;
  offline?: boolean;
}) {
  const de = lang === 'de';
  const L = (d: string, e: string) => (de ? d : e);
  return (
    <>
      <Box r={SEARCH.title}>
        <MText size={17} weight="extrabold">
          {L('Wohin geht’s?', 'Where to?')}
        </MText>
      </Box>
      <Box r={SEARCH.chips} style={s.row}>
        <MockChip text={L('Verbindung', 'Connection')} icon="git-commit" selected />
        <MockChip text={L('Abfahrtstafel', 'Departure board')} icon="clock" />
      </Box>

      <Box r={SEARCH.fields} style={s.fields}>
        <Field label={L('Von', 'From')} value={from} placeholder={L('Start wählen', 'Choose start')} dot={colors.lime} />
        <View style={s.divider} />
        <Field label={L('Nach', 'To')} value={to} placeholder={L('Ziel wählen', 'Choose destination')} dot={colors.orange} />
      </Box>
      <Box r={SEARCH.swap} style={s.swap}>
        <Feather name="repeat" size={12} color={colors.textOnLight} style={{ transform: [{ rotate: '90deg' }] }} />
      </Box>

      {/* "Wann?": ein Feld für Tag + Uhrzeit (öffnet ein Sheet); "Jetzt" nur bei anderer Zeit */}
      <Box r={SEARCH.when} style={s.when}>
        <View style={s.whenIcon}>
          <Feather name="clock" size={12} color={colors.textOnLight} />
        </View>
        <View style={{ flex: 1 }}>
          <MText size={10} weight="bold">
            {L('Heute, 19:25', 'Today, 19:25')}
          </MText>
          <MText size={7.5} weight="medium" color={colors.textMuted}>
            {L('Abfahrt', 'Departure')}
          </MText>
        </View>
        <Feather name="chevron-down" size={12} color={colors.textMuted} />
      </Box>
      <Box r={SEARCH.now} style={s.center}>
        <MockChip text={L('Jetzt', 'Now')} />
      </Box>

      {offline !== undefined ? (
        <Box r={SEARCH.offline} style={s.left}>
          <MockChip text="Offline" icon="wifi-off" selected={offline} color={colors.cyan} />
        </Box>
      ) : null}

      <MockButton
        r={offline !== undefined ? SEARCH.findOffline : SEARCH.find}
        text={L('Verbindungen suchen', 'Find connections')}
        icon="search"
        size={10}
      />
    </>
  );
}

function Field({ label, value, placeholder, dot }: { label: string; value?: FieldValue | null; placeholder: string; dot: string }) {
  return (
    <View style={s.field}>
      <View style={[s.dot, { borderColor: dot }]} />
      <View style={{ flex: 1 }}>
        <MText size={7} weight="bold" color={colors.textMuted} style={s.caption}>
          {label}
        </MText>
        <View style={s.value}>
          {value?.icon ? <Feather name={value.icon} size={9.5} color={colors.textMuted} /> : null}
          <MText size={10.5} color={value ? colors.text : colors.textFaint} lines={1} style={{ flexShrink: 1 }}>
            {value ? value.name : placeholder}
            {value?.detail ? (
              <MText size={8} weight="medium" color={colors.textMuted}>
                {'  '}
                {value.detail}
              </MText>
            ) : null}
          </MText>
        </View>
      </View>
    </View>
  );
}

/** "Plane deine Fahrt" unter dem Formular, solange noch nichts gesucht wurde. */
export function MockSearchEmpty({ lang, y }: { lang: Lang; y: number }) {
  const de = lang === 'de';
  return (
    <Box r={{ x: 30, y, w: 240, h: 110 }} style={{ alignItems: 'center', gap: 4 }}>
      <GhostLogo size={34} />
      <MText size={11.5} weight="bold" center style={{ marginTop: 4 }}>
        {de ? 'Plane deine Fahrt' : 'Plan your trip'}
      </MText>
      <MText size={8} weight="medium" color={colors.textMuted} center>
        {de
          ? 'Wähle Start und Ziel. Zu jeder Linie siehst du Live-Hinweise anderer Fahrgäste – Verspätungen, Überfüllung, Störungen und mehr.'
          : 'Choose a start and destination. For every line you see live tips from other passengers – delays, crowding, disruptions and more.'}
      </MText>
    </Box>
  );
}

/**
 * Wird `true`, sobald `active` seit `ms` gilt (z. B. Treffer nach dem Tippen).
 * Mit "Bewegung reduzieren" sofort `true`.
 */
export function useAfter(active: boolean, ms: number): boolean {
  const reduce = useReduceMotion();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!active || reduce) return;
    const id = setTimeout(() => setDone(true), ms);
    return () => {
      clearTimeout(id);
      setDone(false);
    };
  }, [active, reduce, ms]);
  return active && (reduce || done);
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  center: { alignItems: 'center', justifyContent: 'center' },
  left: { alignItems: 'flex-start', justifyContent: 'center' },
  fields: { backgroundColor: colors.surfaceDeep, borderRadius: 16, paddingHorizontal: 12 },
  field: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 32 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5 },
  caption: { letterSpacing: 0.6, textTransform: 'uppercase' },
  value: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 18, marginRight: 32 },
  swap: { borderRadius: 14, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  when: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceDeep,
    borderRadius: 18,
    paddingHorizontal: 8,
  },
  whenIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
});
