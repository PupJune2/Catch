// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Tutorial "Verspätung melden": oranges Plus "Melden" → Art (Verspätung) → Linie → Wo genau? →
 * Details → "Verspätung melden" → Danke. Ablauf, Reihenfolge und Texte wie in app/report.tsx.
 */
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Mode, ReportKind } from '@/api/contract';
import { GhostLogo } from '@/components/GhostLogo';
import type { TKey } from '@/i18n';
import { KIND_COLOR, KIND_ICON } from '@/lib/kinds';
import { colors } from '@/theme';
import { Appear, Box, center, MockButton, MockCard, MockScreen, MockStackHeader, MockStatusBar, MockTabBar, MText, Pulse, TAB, type Rect } from '../mock';
import type { SceneProps, Tutorial } from '../types';
import { ChipM, Footer, HomeTop, KIND_ORDER, KindBadgeM, LineBadgeM, MCap, MNotice, OutlineButton, SectionHead, tr } from './alertsKit';

// Layout (Mock-Telefon 300 × 600)
const TILE_Y = 126;
const TILE_STEP = 54;
const tile = (i: number): Rect => ({ x: 16, y: TILE_Y + i * TILE_STEP, w: 268, h: 48 });
const DEP_Y = 150;
const DEP_H = 44;
const R = {
  plus: { x: 131, y: 527, w: 38, h: 38 },
  delayTile: tile(0),
  depList: { x: 16, y: DEP_Y - 4, w: 268, h: 3 * DEP_H + 8 },
  dep0: { x: 20, y: DEP_Y, w: 260, h: DEP_H },
  searchStop: { x: 16, y: 300, w: 268, h: 30 },
  prevBox: { x: 16, y: 128, w: 131, h: 50 },
  nextBox: { x: 153, y: 128, w: 131, h: 50 },
  stops: { x: 16, y: 232, w: 268, h: 158 },
  summary: { x: 16, y: 126, w: 268, h: 72 },
  footerBtn: { x: 16, y: 548, w: 268, h: 36 },
} satisfies Record<string, Rect>;
const STOP_H = 30;
/** Details: Verspätungs-Stufen und "Wann?" */
const TAG_CHIPS: { key: TKey; r: Rect }[] = [
  { key: 'tag.DELAY_UP_TO_5', r: { x: 16, y: 222, w: 74, h: 24 } },
  { key: 'tag.DELAY_5_TO_15', r: { x: 94, y: 222, w: 66, h: 24 } },
  { key: 'tag.DELAY_OVER_15', r: { x: 164, y: 222, w: 80, h: 24 } },
];
const WHEN_CHIPS: { key: TKey; r: Rect }[] = [
  { key: 'report.when.now', r: { x: 16, y: 272, w: 46, h: 24 } },
  { key: 'report.when.5', r: { x: 66, y: 272, w: 64, h: 24 } },
  { key: 'report.when.15', r: { x: 134, y: 272, w: 68, h: 24 } },
  { key: 'report.when.30', r: { x: 206, y: 272, w: 68, h: 24 } },
];

const RB69 = { name: 'RB69', mode: 'REGIONAL' as Mode };
const DELAY: ReportKind = 'DELAY';

function ReportScene({ step, lang }: SceneProps) {
  const t = tr(lang);
  const kind = (k: ReportKind) => t(`kind.${k}` as TKey);
  const segment = t('seg.between', { a: 'Münster-Hiltrup', b: 'Rinkerode' });
  const sub = Math.min(4, Math.max(1, step));

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* --- 0. Startseite ------------------------------------------------------- */}
      <HomeTop lang={lang} />
      <SectionHead y={196} title={t('home.justReported')} action={t('map.onMap')} />
      <Box r={{ x: 16, y: 218, w: 268, h: 14 }} style={s.row}>
        <Feather name="map-pin" size={9} color={colors.textMuted} />
        <MText size={8} weight="medium" color={colors.textMuted}>
          {t('home.radius')}
        </MText>
      </Box>
      <MockCard
        r={{ x: 16, y: 240, w: 268, h: 80 }}
        mode="BUS"
        tone="active"
        tab={`${kind('DISRUPTION')} · ${t('time.minAgo', { n: 12 })}`}
        title="10 → Gievenbeck"
        subtitle={`${t('seg.between', { a: 'Schloss', b: 'Hüfferstiftung' })} · ${t('tag.DOORS')}`}
        menu="chevron-right"
      />
      <MockCard
        r={{ x: 16, y: 330, w: 268, h: 80 }}
        mode="REGIONAL"
        tone="active"
        tab={`${kind('DELAY')} · ${t('time.minAgo', { n: 34 })}`}
        title="RE2 → Düsseldorf Hbf"
        subtitle={`${t('seg.between', { a: 'Münster Hbf', b: 'Dülmen' })} · ${t('tag.DELAY_5_TO_15')}`}
        menu="chevron-right"
      />
      <MockCard
        r={{ x: 16, y: 420, w: 268, h: 80 }}
        mode="BUS"
        tone="active"
        tab={`${kind('CROWDED')} · ${t('time.minAgo', { n: 51 })}`}
        title="6 → Hiltrup Ost"
        subtitle={`${t('seg.before', { b: 'Hiltrup, Marktallee' })} · ${t('tag.FULL')}`}
        menu="chevron-right"
      />
      <MockTabBar active="home" lang={lang} />
      <Pulse r={R.plus} active={step === 0} radius={19} />

      {/* --- 1.–4. Melden (Schritt 1 von 4 … 4 von 4) ---------------------------------- */}
      <MockScreen show={step >= 1}>
        <MockStatusBar />
        <MockStackHeader title={t('report.title')} subtitle={t('report.step', { n: sub })} />
        <Box r={{ x: 16, y: 62, w: 268, h: 3 }} style={s.progress}>
          {[1, 2, 3, 4].map((i) => (
            <View key={i} style={[s.progressSeg, i <= sub && { backgroundColor: colors.orange }]} />
          ))}
        </Box>

        {/* Schritt 1: Was ist los? */}
        <Title text={t('report.whatSeen')} />
        {KIND_ORDER.map((k, i) => (
          <KindTile key={k} r={tile(i)} kind={k} label={kind(k)} hint={t(`kind.hint.${k}` as TKey)} />
        ))}
        <MNotice r={{ x: 16, y: TILE_Y + 5 * TILE_STEP + 4, w: 268, h: 34 }} icon="shield" text={t('common.ticketHint')} />
        <Pulse r={R.delayTile} active={step === 1} radius={16} />

        {/* Schritt 2: In welcher Linie bist du? */}
        <Panel show={step >= 2}>
          <Title text={t('report.whichLine')} />
          <Box r={{ x: 16, y: 126, w: 268, h: 14 }} style={s.row}>
            <Feather name="navigation" size={9} color={colors.lime} />
            <MText size={9} weight="bold" color={colors.lime}>
              {t('report.nearby')}
            </MText>
          </Box>
          <Box r={R.depList} style={s.list} />
          <DepRow i={0} time="09:28" delay="+6" line={RB69} to="Bielefeld Hbf" sub={`${t('dep.from', { stop: 'Münster Hbf' })}${t('summary.count30_other', { count: 3 })}`} />
          <DepRow
            i={1}
            time="09:36"
            delay="+0"
            line={{ name: '6', mode: 'BUS' }}
            to="Hiltrup Ost"
            sub={`${t('dep.from', { stop: 'Hiltrup Bahnhof' })}${t('summary.count30_other', { count: 2 })}`}
          />
          <DepRow
            i={2}
            time="09:39"
            delay="+2"
            line={{ name: '8', mode: 'BUS' }}
            to="Wolbeck"
            sub={`${t('dep.from', { stop: 'Hiltrup Bahnhof' })}${t('summary.count30_one', { count: 1 })}`}
          />
          <OutlineButton r={R.searchStop} text={t('report.searchStop')} icon="search" />
          <Pulse r={R.dep0} active={step === 2} radius={12} />
        </Panel>

        {/* Schritt 3: Wo genau? */}
        <Panel show={step >= 3}>
          <Box r={{ x: 16, y: 72, w: 268, h: 24 }} style={s.row}>
            <LineBadgeM {...RB69} big />
            <MText size={14} weight="extrabold" lines={1} style={{ flexShrink: 1 }}>
              → Bielefeld Hbf
            </MText>
          </Box>
          <Box r={{ x: 16, y: 100, w: 268, h: 24 }}>
            <MText size={17} weight="extrabold">
              {t('report.whereExactly')}
            </MText>
          </Box>
          <RoleBox r={R.prevBox} label={t('report.prevStop')} value="Münster-Hiltrup" color={colors.lime} />
          <RoleBox r={R.nextBox} label={t('report.nextStop')} value="Rinkerode" color={colors.orange} active />
          <MNotice r={{ x: 16, y: 186, w: 268, h: 40 }} text={t('report.estimateHint')} />
          <Box r={R.stops} style={s.list} />
          <StopRow i={0} time="09:28" name="Münster Hbf" passed />
          <StopRow i={1} time="09:34" name="Münster-Hiltrup" role="prev" tag={t('report.tagPrev')} />
          <StopRow i={2} time="09:40" name="Rinkerode" role="next" tag={t('report.tagNext')} />
          <StopRow i={3} time="09:45" name="Drensteinfurt" />
          <StopRow i={4} time="09:56" name="Hamm (Westf) Hbf" last />
          <Footer>
            <MockButton r={R.footerBtn} text={t('report.next')} icon="arrow-right" variant="lime" size={10} />
          </Footer>
          <Pulse r={R.footerBtn} active={step === 3} radius={18} />
        </Panel>

        {/* Schritt 4: Details */}
        <Panel show={step >= 4}>
          <Title text={t(`kind.q.${DELAY}` as TKey)} />
          <Box r={R.summary} style={[s.summary, { backgroundColor: KIND_COLOR[DELAY] }]}>
            <LineBadgeM {...RB69} big />
            <View style={{ flex: 1 }}>
              <View style={s.row}>
                <MaterialCommunityIcons name={KIND_ICON[DELAY]} size={10} color={colors.textOnLight} />
                <MText size={7.5} weight="bold" color={colors.textOnLight} style={{ letterSpacing: 0.6, textTransform: 'uppercase' }}>
                  {kind(DELAY)}
                </MText>
              </View>
              <MText size={10} weight="bold" color={colors.textOnLight} lines={2}>
                {segment}
              </MText>
              <MText size={8} weight="medium" color={colors.textOnLightMuted} lines={1}>
                {t('report.direction', { stop: 'Bielefeld Hbf' })}
              </MText>
            </View>
          </Box>
          <MCap r={{ x: 16, y: 208, w: 268, h: 12 }} text={t('report.where')} />
          {TAG_CHIPS.map((c, i) => (
            <ChipM key={c.key} r={c.r} text={t(c.key)} selected={i === 1} color={KIND_COLOR[DELAY]} />
          ))}
          <MCap r={{ x: 16, y: 258, w: 268, h: 12 }} text={t('report.whenLabel')} />
          {WHEN_CHIPS.map((c, i) => (
            <ChipM key={c.key} r={c.r} text={t(c.key)} selected={i === 0} color={KIND_COLOR[DELAY]} />
          ))}
          <MNotice r={{ x: 16, y: 310, w: 268, h: 40 }} icon="eye-off" text={t('report.privacy')} />
          <Footer>
            <MockButton r={R.footerBtn} text={t(`kind.submit.${DELAY}` as TKey)} icon="send" variant="orange" size={10} />
          </Footer>
          <Pulse r={R.footerBtn} active={step === 4} radius={18} />
        </Panel>
      </MockScreen>

      {/* --- 5. Danke! ---------------------------------------------------------- */}
      <MockScreen show={step >= 5} from="fade">
        <MockStatusBar />
        <Box r={{ x: 95, y: 84, w: 110, h: 110 }} style={s.doneRing}>
          <GhostLogo size={64} />
        </Box>
        <Box r={{ x: 16, y: 208, w: 268, h: 34 }}>
          <MText size={26} weight="extrabold" center>
            {t('report.thanks')}
          </MText>
        </Box>
        <Box r={{ x: 34, y: 246, w: 232, h: 34 }}>
          <MText size={9.5} weight="medium" color={colors.textMuted} center>
            {t('report.liveNow', { line: RB69.name })}
          </MText>
        </Box>
        <Box r={{ x: 16, y: 292, w: 268, h: 62 }} style={s.doneCard}>
          <LineBadgeM {...RB69} big />
          <View style={{ flex: 1, gap: 5 }}>
            <MText size={10} weight="bold" lines={2}>
              {segment}
            </MText>
            <KindBadgeM kind={DELAY} lang={lang} />
          </View>
        </Box>
        <Footer>
          <OutlineButton r={{ x: 16, y: 548, w: 131, h: 36 }} text={t('report.viewLine')} />
          <MockButton r={{ x: 153, y: 548, w: 131, h: 36 }} text={t('report.done')} variant="lime" size={10} />
        </Footer>
      </MockScreen>
    </View>
  );
}

/** Inhalt eines Melde-Schritts (der Kopf mit "Schritt n von 4" bleibt stehen). */
function Panel({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <Appear show={show} from="right" distance={300} duration={420}>
      <Box r={{ x: 0, y: 68, w: 300, h: 532 }} style={{ backgroundColor: colors.bg }} />
      {children}
    </Appear>
  );
}

function Title({ text }: { text: string }) {
  return (
    <Box r={{ x: 16, y: 74, w: 268, h: 46 }}>
      <MText size={17} weight="extrabold" style={{ lineHeight: 22 }}>
        {text}
      </MText>
    </Box>
  );
}

/** Große Auswahl-Kachel wie KindTile. */
function KindTile({ r, kind, label, hint }: { r: Rect; kind: ReportKind; label: string; hint: string }) {
  return (
    <Box r={r} style={s.tile}>
      <View style={[s.tileIcon, { backgroundColor: KIND_COLOR[kind] }]}>
        <MaterialCommunityIcons name={KIND_ICON[kind]} size={17} color={colors.textOnLight} />
      </View>
      <View style={{ flex: 1 }}>
        <MText size={11} weight="bold">
          {label}
        </MText>
        <MText size={8} weight="medium" color={colors.textMuted} lines={1}>
          {hint}
        </MText>
      </View>
      <Feather name="chevron-right" size={13} color={colors.textMuted} />
    </Box>
  );
}

/** Abfahrt in der Liste "Gerade in deiner Nähe unterwegs" (DepartureRow mit showStop). */
function DepRow({ i, time, delay, line, to, sub }: { i: number; time: string; delay: string; line: { name: string; mode: Mode }; to: string; sub: string }) {
  return (
    <Box r={{ x: 22, y: DEP_Y + i * DEP_H, w: 256, h: DEP_H }} style={[s.depRow, i > 0 && s.rowBorder]}>
      <View style={{ width: 34 }}>
        <MText size={10} weight="bold">
          {time}
        </MText>
        <MText size={8} weight="bold" color={delay === '+0' ? colors.lime : colors.orange}>
          {delay}
        </MText>
      </View>
      <LineBadgeM {...line} />
      <View style={{ flex: 1 }}>
        <MText size={10} weight="bold" lines={1}>
          {to}
        </MText>
        <MText size={7.5} weight="medium" color={colors.textMuted} lines={1}>
          {sub}
        </MText>
      </View>
      <Feather name="chevron-right" size={12} color={colors.textMuted} />
    </Box>
  );
}

function RoleBox({ r, label, value, color, active }: { r: Rect; label: string; value: string; color: string; active?: boolean }) {
  return (
    <Box r={r} style={[s.roleBox, active && { borderColor: color, backgroundColor: `${color}1F` }]}>
      <MText size={7.5} weight="bold" color={active ? color : colors.textMuted} style={{ letterSpacing: 0.4, textTransform: 'uppercase' }}>
        {label}
      </MText>
      <MText size={10.5} weight="bold" lines={1}>
        {value}
      </MText>
    </Box>
  );
}

/** Halt im Fahrtverlauf mit Schiene; Letzte (lime) / Nächste (orange). */
function StopRow({ i, time, name, passed, role, tag, last }: { i: number; time: string; name: string; passed?: boolean; role?: 'prev' | 'next'; tag?: string; last?: boolean }) {
  const y = R.stops.y + 4 + i * STOP_H;
  const c = role === 'prev' ? colors.lime : role === 'next' ? colors.orange : null;
  const dot = c ? 11 : 7;
  return (
    <Box r={{ x: 20, y, w: 260, h: STOP_H }} style={s.stopRow}>
      <View style={s.rail}>
        <View style={[s.railLine, i === 0 && { top: '50%' }, last && { bottom: '50%' }, role === 'prev' && { backgroundColor: colors.orange }]} />
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: c ?? (passed ? colors.textFaint : colors.text) }} />
      </View>
      <MText size={9} weight="medium" color={colors.textMuted} style={{ width: 32 }}>
        {time}
      </MText>
      <MText size={9.5} weight={c ? 'bold' : 'medium'} color={c ?? (passed ? colors.textMuted : colors.text)} lines={1} style={{ flex: 1 }}>
        {name}
      </MText>
      {tag && c ? (
        <View style={[s.stopTag, { backgroundColor: c }]}>
          <MText size={7.5} weight="bold" color={colors.textOnLight}>
            {tag}
          </MText>
        </View>
      ) : null}
    </Box>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  progress: { flexDirection: 'row', gap: 4 },
  progressSeg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.surfaceAlt },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 9 },
  tileIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  list: { backgroundColor: colors.surface, borderRadius: 16 },
  depRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  roleBox: { borderRadius: 13, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 9, paddingVertical: 7, gap: 3 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rail: { width: 18, height: '100%', alignItems: 'center', justifyContent: 'center' },
  railLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.surfaceAlt, borderRadius: 1 },
  stopTag: { borderRadius: 8, paddingHorizontal: 6, height: 15, justifyContent: 'center' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingHorizontal: 12 },
  doneRing: { borderRadius: 38, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  doneCard: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 11 },
});

export const reportTutorial: Tutorial = {
  id: 'report',
  icon: 'plus-circle',
  category: 'report',
  question: {
    de: 'Wie melde ich, dass mein Zug Verspätung hat?',
    en: 'How do I report that my train is delayed?',
  },
  answer: {
    de: 'Tippe unten in der Mitte auf das orange Plus „Melden“, wähle „Verspätung“ und dann deinen Zug – Catch schlägt vor, was gerade in deiner Nähe fährt. Prüf kurz, zwischen welchen Halten du bist, gib optional an, wie viel Verspätung es ist, und tippe auf „Verspätung melden“. Dafür brauchst du ein Konto – für andere erscheint deine Meldung anonym.',
    en: 'Tap the orange plus “Report” at the bottom centre, choose “Delay” and then your train – Catch suggests what’s moving near you right now. Check which stops you’re between, optionally say how late it is, and tap “Report delay”. You need an account for this – to others, your report is anonymous.',
  },
  where: { de: 'Melden (oranges Plus unten in der Mitte)', en: 'Report (orange plus at the bottom centre)' },
  tryIt: '/report',
  steps: [
    {
      caption: {
        de: 'Tippe unten in der Mitte auf das orange Plus „Melden“. Dafür brauchst du ein Konto.',
        en: 'Tap the orange plus “Report” at the bottom centre. You need an account for this.',
      },
      target: TAB.report,
      read: 2600,
    },
    {
      caption: { de: 'Was ist los? Tippe auf „Verspätung“.', en: 'What’s happening? Tap “Delay”.' },
      target: center(R.delayTile, 50),
      read: 1800,
    },
    {
      caption: {
        de: 'Wähle deinen Zug. Oben steht, was gerade in deiner Nähe unterwegs ist.',
        en: 'Pick your train. At the top you see what’s moving near you right now.',
      },
      target: center(R.dep0, 30),
      read: 2400,
    },
    {
      caption: {
        de: 'Catch schätzt, zwischen welchen Halten du gerade bist. Passt das, tippe auf „Weiter“.',
        en: 'Catch estimates which stops you’re between. If that’s right, tap “Next”.',
      },
      target: center(R.footerBtn, 80),
      read: 2800,
    },
    {
      caption: {
        de: 'Wie viel Verspätung? Wähle eine Stufe (optional) und tippe auf „Verspätung melden“.',
        en: 'How late is it? Pick a level (optional) and tap “Report delay”.',
      },
      target: center(R.footerBtn, 80),
      read: 3000,
    },
    {
      caption: {
        de: 'Danke! Dein Hinweis ist sofort live – wer die Linie verfolgt, wird gewarnt. Für andere bleibst du anonym.',
        en: 'Thank you! Your tip is live right away – everyone tracking the line gets warned. Others won’t see who you are.',
      },
    },
  ],
  Scene: ReportScene,
};
