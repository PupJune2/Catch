// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Gemeinsame Bausteine der Tutorials "Melden & Alarme" / "App" (Melden, Live-Tracking,
 * Pendelstrecke, Widget): Verbindungs-Bildschirm, Kopf der Startseite, Arten-Chips, Hinweise,
 * Handy-Hintergrund und Push-Mitteilung.
 *
 * Alle Texte kommen über `translate()` direkt aus den App-Wörterbüchern (i18n/de.ts, en.ts),
 * damit die Tutorials wortgleich zur echten Oberfläche bleiben.
 */
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect as SvgRect, Stop } from 'react-native-svg';

import type { Mode, ReportKind } from '@/api/contract';
import { GhostLogo } from '@/components/GhostLogo';
import { translate, type Lang, type TKey } from '@/i18n';
import { KIND_COLOR, KIND_ICON } from '@/lib/kinds';
import { colors, modeColor } from '@/theme';
import { Box, MockButton, MockCard, MockStackHeader, MockStatusBar, MText, PHONE, type Rect } from '../mock';

type FeatherName = ComponentProps<typeof Feather>['name'];

/** Übersetzer für die Sprache der Szene. */
export function tr(lang: Lang) {
  return (key: TKey, params?: Record<string, string | number>) => translate(lang, key, params);
}

/** Text in beiden Sprachen (für Dinge, die es so nicht im Wörterbuch gibt, z. B. Haltestellen-Zeilen). */
export const pick = (lang: Lang) => (de: string, en: string) => (lang === 'de' ? de : en);

export const KIND_ORDER: ReportKind[] = ['DELAY', 'CANCELLED', 'CROWDED', 'DISRUPTION', 'CHECK'];

// ---------------------------------------------------------------------------
// Kleine Bausteine
// ---------------------------------------------------------------------------

/** Überschrift in Großbuchstaben wie AppText "caption". */
export function MCap({ r, text, color = colors.textMuted }: { r: Rect; text: string; color?: string }) {
  return (
    <Box r={r}>
      <MText size={7.5} weight="bold" color={color} lines={1} style={{ letterSpacing: 0.6, textTransform: 'uppercase' }}>
        {text}
      </MText>
    </Box>
  );
}

/** Hinweis mit Icon (wie `Notice`). */
export function MNotice({ r, icon = 'info', text, color = colors.textMuted }: { r: Rect; icon?: FeatherName; text: string; color?: string }) {
  return (
    <Box r={r} style={{ flexDirection: 'row', gap: 6 }}>
      <Feather name={icon} size={10} color={color} style={{ marginTop: 1 }} />
      <MText size={8} weight="medium" color={color} style={{ flex: 1 }}>
        {text}
      </MText>
    </Box>
  );
}

/** Abschnitts-Titel mit Aktion rechts ("Alle", "Karte" …). */
export function SectionHead({ y, title, action }: { y: number; title: string; action?: string }) {
  return (
    <Box r={{ x: 16, y, w: 268, h: 18 }} style={styles.sectionHead}>
      <MText size={12.5} weight="extrabold" lines={1} style={{ flexShrink: 1 }}>
        {title}
      </MText>
      {action ? (
        <MText size={8.5} weight="bold" color={colors.lime}>
          {action}
        </MText>
      ) : null}
    </Box>
  );
}

/** Linien-Badge in Linienfarbe, optional groß mit Verkehrsmittel-Icon. */
export function LineBadgeM({ name, mode, color, big }: { name: string; mode: Mode; color?: string; big?: boolean }) {
  const h = big ? 22 : 16;
  return (
    <View style={[styles.badge, { height: h, paddingHorizontal: big ? 7 : 5, backgroundColor: color ?? modeColor[mode] }]}>
      {big ? <MaterialCommunityIcons name={mode === 'BUS' ? 'bus' : 'train'} size={11} color="#FFFFFF" /> : null}
      <MText size={big ? 10.5 : 8.5} weight="extrabold" color="#FFFFFF">
        {name}
      </MText>
    </View>
  );
}

/** Pill einer Hinweis-Art ("Verspätung") wie `KindBadge`. */
export function KindBadgeM({ kind, lang, border }: { kind: ReportKind; lang: Lang; border?: boolean }) {
  return (
    <View style={[styles.kindBadge, { backgroundColor: KIND_COLOR[kind] }, border && { borderWidth: 1, borderColor: colors.textOnLight }]}>
      <MaterialCommunityIcons name={KIND_ICON[kind]} size={10} color={colors.textOnLight} />
      <MText size={8} weight="bold" color={colors.textOnLight}>
        {translate(lang, `kind.${kind}` as TKey)}
      </MText>
    </View>
  );
}

/** Auswahl-Chip wie im echten Alarm/Details-Bereich (feste Größe → der Finger trifft genau). */
export function ChipM({ r, text, selected, color = colors.lime, icon }: { r: Rect; text: string; selected?: boolean; color?: string; icon?: FeatherName }) {
  return (
    <Box r={r} style={[styles.chip, { borderRadius: r.h / 2 }, selected ? { backgroundColor: color, borderColor: color } : null]}>
      {icon ? <Feather name={icon} size={9} color={selected ? colors.textOnLight : colors.textMuted} /> : null}
      <MText size={8.5} weight="bold" color={selected ? colors.textOnLight : colors.text} lines={1}>
        {text}
      </MText>
    </Box>
  );
}

/** Schalter (an/aus). */
export function ToggleM({ r, on }: { r: Rect; on: boolean }) {
  return (
    <Box r={r} style={[styles.toggle, { borderRadius: r.h / 2, backgroundColor: on ? colors.lime : colors.surfaceAlt, alignItems: on ? 'flex-end' : 'flex-start' }]}>
      <View style={[styles.knob, { width: r.h - 6, height: r.h - 6, borderRadius: (r.h - 6) / 2 }]} />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// "Alarm bei": Arten als Mehrfachauswahl (KindMultiSelect)
// ---------------------------------------------------------------------------

const KIND_CHIP_W = [92, 88, 88, 92, 102];
const KIND_CHIP_H = 22;

/** Feste Plätze der fünf Arten-Chips (2 · 2 · 1 wie in der App), ab linker oberer Ecke. */
export function kindChipRects(x: number, y: number): Rect[] {
  const pos: [number, number][] = [
    [0, 0],
    [97, 0],
    [0, 27],
    [93, 27],
    [0, 54],
  ];
  return pos.map(([dx, dy], i) => ({ x: x + dx, y: y + dy, w: KIND_CHIP_W[i], h: KIND_CHIP_H }));
}

export function KindChips({ x, y, lang, off = [] }: { x: number; y: number; lang: Lang; off?: ReportKind[] }) {
  const rects = kindChipRects(x, y);
  return (
    <>
      {KIND_ORDER.map((k, i) => {
        const on = !off.includes(k);
        const c = KIND_COLOR[k];
        return (
          <Box key={k} r={rects[i]} style={[styles.chip, { borderRadius: KIND_CHIP_H / 2 }, on ? { backgroundColor: c, borderColor: c } : { backgroundColor: colors.surface }]}>
            <Feather name={on ? 'check' : 'plus'} size={9} color={on ? colors.textOnLight : colors.textMuted} />
            <MaterialCommunityIcons name={KIND_ICON[k]} size={10} color={on ? colors.textOnLight : c} />
            <MText size={8.5} weight="bold" color={on ? colors.textOnLight : colors.text} lines={1}>
              {translate(lang, `kind.${k}` as TKey)}
            </MText>
          </Box>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bildschirm-Teile
// ---------------------------------------------------------------------------

/** Heller, gewölbter Kopfbereich der Tab-Bildschirme (CurvedHeader). */
export function CurvedTop({ bottom }: { bottom: number }) {
  return (
    <>
      <Box r={{ x: 0, y: 0, w: PHONE.w, h: bottom }} style={{ backgroundColor: colors.raised }} />
      <View style={{ position: 'absolute', left: 0, top: bottom - 1, width: PHONE.w, height: 16 }}>
        <Svg width={PHONE.w} height={16} viewBox="0 0 100 34" preserveAspectRatio="none">
          <Path d="M0 0 H100 V34 Q50 -6 0 34 Z" fill={colors.raised} />
        </Svg>
      </View>
    </>
  );
}

/** Feste Fußleiste unter einem Unterbildschirm (Screen footer). */
export function Footer({ children }: { children: ReactNode }) {
  return (
    <>
      <Box r={{ x: 0, y: 538, w: PHONE.w, h: PHONE.h - 538 }} style={styles.footer} />
      {children}
    </>
  );
}

/** Umrandeter Knopf (Button variant "secondary"). */
export function OutlineButton({ r, text, icon }: { r: Rect; text: string; icon?: FeatherName }) {
  return (
    <Box r={r} style={[styles.outline, { borderRadius: r.h / 2 }]}>
      {icon ? <Feather name={icon} size={10} color={colors.text} /> : null}
      <MText size={9.5} weight="bold" lines={1}>
        {text}
      </MText>
    </Box>
  );
}

/** Kopf der Startseite: Logo, Begrüßung, "Wohin geht's?" (unten bei y ≈ 192 gewölbt). */
export const HOME_TOP = 178;
export function HomeTop({ lang }: { lang: Lang }) {
  const t = tr(lang);
  return (
    <>
      <CurvedTop bottom={HOME_TOP} />
      <MockStatusBar />
      <Box r={{ x: 16, y: 28, w: 268, h: 28 }} style={styles.brandRow}>
        <GhostLogo size={20} />
        <MText size={13.5} weight="bold" style={{ flex: 1 }}>
          Catch
        </MText>
        <View style={[styles.dot, { backgroundColor: colors.lime }]} />
        <View style={styles.roundBtn}>
          <Feather name="map" size={11} color={colors.text} />
        </View>
        <View style={[styles.roundBtn, { backgroundColor: colors.lime }]}>
          <MText size={10.5} weight="bold" color={colors.textOnLight}>
            L
          </MText>
        </View>
      </Box>
      <Box r={{ x: 16, y: 64, w: 268, h: 54 }}>
        <MText size={20} weight="extrabold" style={{ lineHeight: 25 }}>
          {pick(lang)('Guten Morgen,\nLena', 'Good morning,\nLena')}
        </MText>
      </Box>
      <Box r={{ x: 16, y: 124, w: 268, h: 42 }} style={styles.searchCard}>
        <View style={styles.searchIcon}>
          <Feather name="search" size={12} color={colors.textOnLight} />
        </View>
        <View style={{ flex: 1 }}>
          <MText size={10.5} weight="bold">
            {t('home.whereTo')}
          </MText>
          <MText size={8.5} weight="medium" color={colors.textMuted}>
            {t('home.whereToSub')}
          </MText>
        </View>
        <Feather name="arrow-right" size={12} color={colors.textMuted} />
      </Box>
    </>
  );
}

/** Ruhiger Handy-Hintergrund (Abenddämmerung mit sanften Hügeln) für Startbildschirm/Sperrbildschirm. */
export function Wallpaper({ id }: { id: string }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Svg width={PHONE.w} height={PHONE.h} viewBox={`0 0 ${PHONE.w} ${PHONE.h}`}>
        <Defs>
          <LinearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#1B2648" />
            <Stop offset="0.55" stopColor="#3D5283" />
            <Stop offset="1" stopColor="#9C86A8" />
          </LinearGradient>
        </Defs>
        <SvgRect x={0} y={0} width={PHONE.w} height={PHONE.h} fill={`url(#sky-${id})`} />
        <Path d="M0 470 Q70 430 150 455 T300 440 V600 H0 Z" fill="#33406A" opacity={0.85} />
        <Path d="M0 520 Q90 480 180 510 T300 500 V600 H0 Z" fill="#232E52" />
      </Svg>
    </View>
  );
}

/** Push-Mitteilung (hell, mit Catch-Geist). */
export function PushCard({ app, title, body }: { app: string; title: string; body: string }) {
  return (
    <View style={styles.push}>
      <View style={styles.pushIcon}>
        <GhostLogo size={13} />
      </View>
      <View style={{ flex: 1 }}>
        <MText size={7.5} weight="medium" color="#5B6275">
          {app}
        </MText>
        <MText size={9.5} weight="bold" color={colors.textOnLight} lines={1}>
          {title}
        </MText>
        <MText size={8.5} weight="medium" color="#3B4357" lines={1}>
          {body}
        </MText>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Verbindung Münster Hbf → Greven (Live-Tracking & Pendelstrecke)
// ---------------------------------------------------------------------------

export const RB65 = { name: 'RB65', mode: 'REGIONAL' as Mode };

/** Layout des Verbindungs-Bildschirms. */
export const J = {
  mapBtn: { x: 16, y: 110, w: 128, h: 24 },
  commuteBtn: { x: 150, y: 110, w: 134, h: 24 },
  editBtn: { x: 16, y: 140, w: 104, h: 24 },
  card: { x: 62, y: 178, w: 222, h: 104 },
  kinds: { x: 16, y: 294, w: 268, h: 112 },
  tip: { x: 16, y: 418, w: 268, h: 40 },
  track: { x: 16, y: 552, w: 268, h: 34 },
} satisfies Record<string, Rect>;
/** Arten-Chips im Kasten "Alarm bei" */
export const J_KINDS = kindChipRects(J.kinds.x + 12, J.kinds.y + 24);

/**
 * "Deine Verbindung": RB65 Münster Hbf 09:55 → Greven 10:08 (direkt), darunter "Alarm bei"
 * und unten "Live-Tracking für diese Verbindung". Hervorhebungen setzt die Szene selbst darüber.
 */
export function JourneyScreen({ lang, off = [] }: { lang: Lang; off?: ReportKind[] }) {
  const t = tr(lang);
  const L = pick(lang);
  return (
    <>
      <MockStatusBar />
      <MockStackHeader
        title={t('journey.yours')}
        subtitle={`${L('Mo., 09.11.', 'Mon 09/11')} · ${t('time.min', { n: 13 })} · ${t('journey.direct.lower')}`}
      />
      <Box r={{ x: 16, y: 62, w: 268, h: 44 }}>
        <MText size={14} weight="extrabold" lines={1}>
          Münster Hbf
        </MText>
        <MText size={14} weight="extrabold" color={colors.textMuted} lines={1}>
          → Greven
        </MText>
      </Box>
      <MockButton r={J.mapBtn} text={t('place.showOnMap')} icon="map" variant="light" size={8.5} />
      <MockButton r={J.commuteBtn} text={t('commute.saveFromJourney')} icon="repeat" variant="light" size={8.5} />
      <MockButton r={J.editBtn} text={t('journey.edit')} icon="edit-2" variant="light" size={8.5} />

      {/* Fahrt mit Zeiten links (TimelineItem) */}
      <Box r={{ x: 14, y: J.card.y + 1, w: 44, h: 16 }}>
        <MText size={10.5} weight="bold">
          09:55
        </MText>
      </Box>
      <Box r={{ x: 30, y: J.card.y + 20, w: 2, h: J.card.h - 40 }} style={styles.dash} />
      <Box r={{ x: 14, y: J.card.y + J.card.h - 16, w: 44, h: 16 }}>
        <MText size={10.5} weight="bold" color={colors.textMuted}>
          10:08
        </MText>
      </Box>
      <MockCard
        r={J.card}
        mode="REGIONAL"
        tab={t('level.calm')}
        title="RB65 → Rheine"
        subtitle={`Münster Hbf → Greven · ${t('journey.stops_other', { count: 3 })}`}
        tags={[{ text: t('track.dep.rail', { track: 11 }) }, { text: t('track.arr.rail', { track: 1 }) }]}
        footer={t('summary.none30')}
        menu="chevron-right"
      />

      {/* Alarm bei */}
      <Box r={J.kinds} style={styles.kindsBox} />
      <MCap r={{ x: J.kinds.x + 12, y: J.kinds.y + 9, w: 200, h: 12 }} text={t('kind.alertMe')} />
      <KindChips x={J.kinds.x + 12} y={J.kinds.y + 24} lang={lang} off={off} />

      <MNotice r={J.tip} text={t('journey.tip')} />

      <Footer>
        <MockButton r={J.track} text={t('journey.trackButton')} icon="radio" variant="cyan" size={9.5} />
      </Footer>
    </>
  );
}

const styles = StyleSheet.create({
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 5, alignSelf: 'center' },
  kindBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: 9, paddingHorizontal: 7, height: 17 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 6,
  },
  toggle: { padding: 3, justifyContent: 'center' },
  knob: { backgroundColor: colors.textOnLight },
  footer: { backgroundColor: 'rgba(22,32,58,0.96)', borderTopWidth: 1, borderTopColor: colors.border },
  outline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: colors.borderStrong },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  roundBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  searchCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surfaceDeep, borderRadius: 21, paddingHorizontal: 8 },
  searchIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  kindsBox: { backgroundColor: colors.surface, borderRadius: 16 },
  dash: { borderLeftWidth: 1, borderStyle: 'dashed', borderColor: colors.textFaint },
  push: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EEF1F7', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 8 },
  pushIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
});
