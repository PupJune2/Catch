// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Tutorial "Farben und Angaben auf den Karten": Reiter = Meldungslage der Linie
 * (Ruhig / Häufige Hinweise / Gerade gemeldet), Kartenkörper = Verkehrsmittel,
 * Marken = Gleis bzw. Steig, orange = Gleiswechsel. Nur Zeige-Schritte.
 */
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useState, type ComponentProps } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import type { Mode } from '@/api/contract';
import { ModeIcon } from '@/components/transit';
import { colors, modeSurface } from '@/theme';
import { Box, MockButton, MockStackHeader, MockStatusBar, MText, Pulse, type Rect } from '../mock';
import type { SceneProps, Tutorial } from '../types';

type McName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type Tone = 'calm' | 'frequent' | 'active';
const TONE: Record<Tone, string> = { calm: colors.lime, frequent: colors.lilac, active: colors.orange };

const CARD_H = 102;
const TAB_H = 22;
/** Oberkante der Gleis-Marken im Kartenkörper (Reiter + Innenabstand + Titelzeile + Abstand) */
const TAGS_DY = TAB_H + 9 + 26 + 6;

// Layout (Mock-Telefon 300 × 600)
const R = {
  card1: { x: 62, y: 112, w: 222, h: CARD_H },
  card2: { x: 62, y: 226, w: 222, h: CARD_H },
  card3: { x: 62, y: 340, w: 222, h: CARD_H },
  tip: { x: 20, y: 458, w: 260, h: 44 },
  track: { x: 16, y: 552, w: 268, h: 34 },
} satisfies Record<string, Rect>;

/** Reiter-Pill einer Karte (Breite gemessen; vor dem ersten Layout grob nach Textlänge). */
function pillRect(card: Rect, width: number | undefined, text: string, icon = false): Rect {
  return { x: card.x + 5, y: card.y + 4, w: width ?? 14 + text.length * 3.8 + (icon ? 12 : 0), h: 15 };
}
/** Erste Gleis-Marke einer Karte */
function tagRect(card: Rect, width: number | undefined, text: string): Rect {
  return { x: card.x + 10, y: card.y + TAGS_DY, w: width ?? 10 + text.length * 3.3, h: 15 };
}

/** Breiten von Reiter-Pills und Gleis-Marken (für die Puls-Ringe – Textbreite hängt von der Sprache ab). */
function useWidths() {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const measure = (key: string) => (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setWidths((prev) => (prev[key] === w ? prev : { ...prev, [key]: w }));
  };
  return [widths, measure] as const;
}

function CardColorsScene({ step, lang }: SceneProps) {
  const de = lang === 'de';
  const L = (d: string, e: string) => (de ? d : e);
  const tab1 = L('Ruhig', 'Quiet');
  const tab2 = L('Häufige Hinweise', 'Frequent tips');
  const tab3 = L('Verspätung', 'Delay');
  const changed = L('ab Gleis 4 (statt 3)', 'from platform 4 (was 3)');
  const [w, measure] = useWidths();

  return (
    <View style={StyleSheet.absoluteFill}>
      <MockStatusBar />
      <MockStackHeader title={L('Deine Verbindung', 'Your connection')} subtitle={L('Sa 7.11. · 1 Std · 2 Umstiege', 'Sat 7/11 · 1 h · 2 changes')} />
      <Box r={{ x: 16, y: 62, w: 268, h: 44 }}>
        <MText size={14} weight="extrabold" lines={1}>
          Lüneburg
        </MText>
        <MText size={14} weight="extrabold" color={colors.textMuted} lines={1}>
          → Hamburg, Stadtpark
        </MText>
      </Box>

      <Times r={R.card1} dep="18:12" arr="18:42" />
      <LegCard
        r={R.card1}
        mode="REGIONAL"
        tone="calm"
        tab={tab1}
        onTabLayout={measure('pill1')}
        title="RE3 → Hamburg Hbf"
        subtitle={L('Lüneburg → Hamburg Hbf · 4 Halte', 'Lüneburg → Hamburg Hbf · 4 stops')}
        tags={[{ text: L('ab Gleis 1', 'from platform 1') }, { text: L('an Gleis 11', 'arr. platform 11') }]}
        footer={L('2 Meldungen in 30 Tagen', '2 reports in 30 days')}
        count="2×"
        progress={0.1}
      />
      <Times r={R.card2} dep="18:49" arr="18:58" />
      <LegCard
        r={R.card2}
        mode="SUBURBAN"
        tone="frequent"
        tab={tab2}
        onTabLayout={measure('pill2')}
        onTagLayout={measure('tag2')}
        title="S1 → Poppenbüttel"
        subtitle={L('Hamburg Hbf → Barmbek · 6 Halte', 'Hamburg Hbf → Barmbek · 6 stops')}
        tags={[{ text: changed, changed: true }, { text: L('an Gleis 2', 'arr. platform 2') }]}
        footer={L('14 Meldungen in 30 Tagen', '14 reports in 30 days')}
        count="14×"
        progress={0.7}
      />
      <Times r={R.card3} dep="19:04" arr="19:12" />
      <LegCard
        r={R.card3}
        mode="BUS"
        tone="active"
        tab={tab3}
        tabIcon="clock-outline"
        onTabLayout={measure('pill3')}
        title="118 → Stadtpark"
        subtitle={L('Barmbek → Stadtpark · 4 Halte', 'Barmbek → Stadtpark · 4 stops')}
        tags={[{ text: L('ab Steig B', 'from stop B') }]}
        footer={L('Verspätung · vor 4 Min', 'Delay · 4 min ago')}
        count="9×"
        progress={1}
      />

      {/* Puls: was gerade erklärt wird */}
      <Pulse r={pillRect(R.card1, w.pill1, tab1)} active={step === 0} radius={9} color={colors.lime} />
      <Pulse r={pillRect(R.card2, w.pill2, tab2)} active={step === 1} radius={9} color={colors.lilac} />
      <Pulse r={pillRect(R.card3, w.pill3, tab3, true)} active={step === 2} radius={9} color={colors.orange} />
      {[R.card1, R.card2, R.card3].map((r) => (
        <Pulse key={r.y} r={{ ...r, y: r.y + TAB_H, h: r.h - TAB_H }} active={step === 3} radius={16} color={colors.text} />
      ))}
      <Pulse r={tagRect(R.card2, w.tag2, changed)} active={step === 4} radius={8} color={colors.orange} />

      <Box r={R.tip} style={{ flexDirection: 'row', gap: 6 }}>
        <Feather name="info" size={10} color={colors.textMuted} style={{ marginTop: 1 }} />
        <MText size={8} weight="medium" color={colors.textMuted} style={{ flex: 1 }}>
          {L(
            'Tippe auf eine Linie, um zu sehen, wann und wo Verspätungen, Überfüllung und andere Hinweise am häufigsten vorkommen.',
            'Tap a line to see when and where delays, crowding and other reports happen most often.',
          )}
        </MText>
      </Box>
      <MockButton r={R.track} text={L('Live-Tracking für diese Verbindung', 'Live tracking for this connection')} icon="radio" variant="cyan" size={9.5} />
    </View>
  );
}

/** Status-Karte wie auf "Deine Verbindung": Reiter (Lage), Balken (Meldungen in 30 Tagen), Körper in Fahrzeugfarbe. */
function LegCard({
  r,
  mode,
  tone,
  tab,
  tabIcon,
  onTabLayout,
  onTagLayout,
  title,
  subtitle,
  tags,
  footer,
  count,
  progress,
}: {
  r: Rect;
  mode: Mode;
  tone: Tone;
  tab: string;
  tabIcon?: McName;
  /** misst die Reiter-Pill bzw. die erste Gleis-Marke */
  onTabLayout?: (e: LayoutChangeEvent) => void;
  onTagLayout?: (e: LayoutChangeEvent) => void;
  title: string;
  subtitle: string;
  tags: { text: string; changed?: boolean }[];
  footer: string;
  count: string;
  progress: number;
}) {
  const body = modeSurface[mode];
  const color = TONE[tone];
  return (
    <Box r={r}>
      <View style={s.tabRow}>
        <View style={[s.tab, { backgroundColor: body }]}>
          <View style={[s.tabPill, { backgroundColor: color }]} onLayout={onTabLayout}>
            {tabIcon ? <MaterialCommunityIcons name={tabIcon} size={9} color={colors.textOnLight} /> : null}
            <MText size={8} weight="bold" color={colors.textOnLight} lines={1}>
              {tab}
            </MText>
          </View>
        </View>
        <View style={s.meta}>
          <View style={s.meter}>
            <View style={[s.meterFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: color }]} />
          </View>
          <MText size={8} weight="bold" color={color}>
            {count}
          </MText>
        </View>
      </View>
      <View style={[s.body, { backgroundColor: body, height: r.h - TAB_H }]}>
        <View style={s.cardRow}>
          <View style={s.diamond}>
            <View style={{ transform: [{ rotate: '-45deg' }] }}>
              <ModeIcon mode={mode} size={13} color={colors.text} />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <MText size={11} weight="bold" lines={1}>
              {title}
            </MText>
            <MText size={8.5} weight="medium" color="rgba(255,255,255,0.86)" lines={1}>
              {subtitle}
            </MText>
          </View>
          <Feather name="chevron-right" size={13} color={colors.text} />
        </View>
        <View style={s.tags}>
          {tags.map((t, i) => (
            <View key={t.text} style={[s.tag, t.changed && { backgroundColor: colors.orange }]} onLayout={i === 0 ? onTagLayout : undefined}>
              <MText size={7.5} weight="bold" color={t.changed ? colors.textOnLight : colors.text} lines={1}>
                {t.text}
              </MText>
            </View>
          ))}
        </View>
        <MText size={8.5} weight="bold" style={{ marginTop: 4 }} lines={1}>
          {footer}
        </MText>
      </View>
    </Box>
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
  tabRow: { flexDirection: 'row', alignItems: 'flex-end', height: TAB_H },
  tab: { height: TAB_H, borderTopLeftRadius: 14, borderTopRightRadius: 14, paddingHorizontal: 5, paddingTop: 4 },
  tabPill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 8, paddingHorizontal: 7, height: 15 },
  meta: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5, paddingBottom: 6 },
  meter: { width: 34, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  meterFill: { height: 4, borderRadius: 2 },
  body: { borderRadius: 16, borderTopLeftRadius: 0, paddingHorizontal: 10, paddingVertical: 9 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 26 },
  diamond: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: colors.textOnLight,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
    marginHorizontal: 3,
  },
  tags: { flexDirection: 'row', gap: 4, marginTop: 6 },
  tag: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 6, paddingHorizontal: 5, height: 15, justifyContent: 'center', flexShrink: 1 },
  dash: { borderLeftWidth: 1, borderStyle: 'dashed', borderColor: colors.textFaint },
});

export const cardColors: Tutorial = {
  id: 'card-colors',
  icon: 'info',
  category: 'ride',
  question: {
    de: 'Was bedeuten die Farben und Angaben auf den Karten?',
    en: 'What do the colours and labels on the cards mean?',
  },
  answer: {
    de: 'Der farbige Reiter oben links zeigt die Lage auf der Linie: Ruhig (grün), Häufige Hinweise (lila) oder Gerade gemeldet (orange – dann steht dort, was gemeldet wurde, z. B. „Verspätung“). Die Farbe der Karte steht für das Verkehrsmittel, z. B. Rot für Regionalzüge, Grün für S-Bahnen und Blau für U-Bahnen. Die Marken darunter zeigen Gleis oder Steig – orange heißt Gleiswechsel. Der Balken rechts zählt die Meldungen der letzten 30 Tage.',
    en: 'The coloured tab at the top left shows the situation on the line: Quiet (green), Frequent tips (lilac) or just reported (orange – then it says what was reported, e.g. “Delay”). The card colour stands for the vehicle, e.g. red for regional trains, green for S-Bahn and blue for U-Bahn. The tags below show the platform or stop – orange means a platform change. The bar on the right counts the reports of the last 30 days.',
  },
  where: { de: 'Suche → Verbindung öffnen', en: 'Search → open a connection' },
  tryIt: '/search',
  steps: [
    {
      caption: {
        de: 'Der Reiter oben links zeigt die Lage auf der Linie. Grün „Ruhig“: gerade nichts gemeldet.',
        en: 'The tab at the top left shows the situation on the line. Green “Quiet”: nothing reported right now.',
      },
      target: { x: 118, y: R.card1.y + 13 },
      tap: false,
      read: 3000,
    },
    {
      caption: {
        de: 'Lila „Häufige Hinweise“: Auf dieser Linie wurde in den letzten 30 Tagen oft etwas gemeldet.',
        en: 'Lilac “Frequent tips”: lots of reports on this line over the last 30 days.',
      },
      target: { x: 166, y: R.card2.y + 13 },
      tap: false,
      read: 3000,
    },
    {
      caption: {
        de: 'Orange: gerade gemeldet, in der letzten Stunde. Im Reiter steht, was los ist – hier eine Verspätung.',
        en: 'Orange: just reported, within the last hour. The tab says what’s up – here a delay.',
      },
      target: { x: 152, y: R.card3.y + 13 },
      tap: false,
      read: 3000,
    },
    {
      caption: {
        de: 'Die Kartenfarbe zeigt das Fahrzeug: Rot = Regionalzug, Grün = S-Bahn, Magenta = Bus, Blau = U-Bahn.',
        en: 'The card colour shows the vehicle: red = regional train, green = S-Bahn, magenta = bus, blue = U-Bahn.',
      },
      target: { x: 258, y: R.card2.y + 72 },
      tap: false,
      read: 3400,
    },
    {
      caption: {
        de: '„ab Gleis 4“ zeigt, wo es losgeht. Orange heißt Gleiswechsel – „(statt 3)“ ist das alte Gleis.',
        en: '“from platform 4” shows where you leave. Orange means a platform change – “(was 3)” is the old one.',
      },
      target: { x: 45, y: R.card2.y + TAGS_DY + 8 },
      tap: false,
      read: 3200,
    },
    {
      caption: {
        de: 'Kurz: Reiter = Lage, Kartenfarbe = Verkehrsmittel, Marken = Gleis/Steig. Orange heißt: aufpassen!',
        en: 'In short: tab = situation, card colour = vehicle, tags = platform/stop. Orange means: watch out!',
      },
    },
  ],
  Scene: CardColorsScene,
};
