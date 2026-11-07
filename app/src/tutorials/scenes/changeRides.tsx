// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Vorzeige-Tutorial "Fahrten ändern": Der RE 42 kommt in Lage an, der Umstieg zum Bus ist zu
 * knapp → frühere Fahrt wählen, Catch passt den Rest an.
 */
import { Feather } from '@expo/vector-icons';
import { Animated, StyleSheet, View } from 'react-native';

import { colors } from '@/theme';
import {
  Appear,
  Box,
  center,
  MockButton,
  MockCard,
  MockLine,
  MockPill,
  MockScreen,
  MockSheet,
  MockStackHeader,
  MockStatusBar,
  MockTabBar,
  MockToast,
  MText,
  Pulse,
  shift,
  useGlide,
  type Rect,
} from '../mock';
import type { SceneProps, Tutorial } from '../types';

// Layout (Mock-Telefon 300 × 600)
const R = {
  result1: { x: 16, y: 166, w: 268, h: 76 },
  result2: { x: 16, y: 252, w: 268, h: 76 },
  // Wie in der App: "Auf der Karte zeigen" oben, darunter "Als Pendelstrecke" + "Fahrten ändern"
  mapBtn: { x: 16, y: 110, w: 122, h: 24 },
  commuteBtn: { x: 16, y: 140, w: 112, h: 24 },
  editBtn: { x: 134, y: 140, w: 104, h: 24 },
  hint: { x: 16, y: 174, w: 268, h: 46 },
  card1: { x: 62, y: 178, w: 222, h: 104 },
  pill: { x: 62, y: 292, w: 196, h: 24 },
  card2: { x: 62, y: 326, w: 222, h: 92 },
  track: { x: 16, y: 552, w: 268, h: 34 },
} satisfies Record<string, Rect>;
/** So weit rutscht der Inhalt im Bearbeiten-Modus nach unten (Hinweisbox) */
const EDIT_SHIFT = 56;
const EDIT_SHIFT_DONE = 80;
const SHEET_TOP = 250;
const ROW_H = 42;
const ROWS_Y = 92;
/** Zweite Zeile im Sheet (RB 73, 15 Min früher) – absolut im Telefon */
const pickRow: Rect = { x: 14, y: SHEET_TOP + ROWS_Y + ROW_H, w: 272, h: ROW_H };

function ChangeRidesScene({ step, lang }: SceneProps) {
  const de = lang === 'de';
  const L = (d: string, e: string) => (de ? d : e);
  const editing = step >= 3;
  const done = step >= 5;
  const offset = useGlide(done ? EDIT_SHIFT_DONE : editing ? EDIT_SHIFT : 0);

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* --- 1. Suchergebnisse ------------------------------------------------ */}
      <MockStatusBar />
      <Box r={{ x: 16, y: 30, w: 268, h: 26 }}>
        <MText size={17} weight="extrabold">
          {L('Wohin geht’s?', 'Where to?')}
        </MText>
      </Box>
      <Box r={{ x: 16, y: 62, w: 268, h: 88 }} style={s.route}>
        <View style={s.routeRow}>
          <View style={[s.routeDot, { borderColor: colors.lime }]} />
          <View>
            <MText size={7} color={colors.textMuted} weight="bold">
              {L('VON', 'FROM')}
            </MText>
            <MText size={10.5}>Bielefeld Hbf</MText>
          </View>
        </View>
        <View style={s.routeLine} />
        <View style={s.routeRow}>
          <View style={[s.routeDot, { borderColor: colors.orange }]} />
          <View>
            <MText size={7} color={colors.textMuted} weight="bold">
              {L('NACH', 'TO')}
            </MText>
            <MText size={10.5}>Lage (Lippe), Am Duftgarten</MText>
          </View>
        </View>
      </Box>
      <ResultCard r={R.result1} dep="06:46" arr="07:22" dur={L('36 Min', '36 min')} change={L('1 Umstieg', '1 change')} first="RE42" second="741" />
      <ResultCard r={R.result2} dep="07:46" arr="08:22" dur={L('36 Min', '36 min')} change={L('1 Umstieg', '1 change')} first="RE42" second="741" />
      <Pulse r={R.result1} active={step === 0} radius={16} />
      <MockTabBar active="search" lang={lang} />

      {/* --- 2. Verbindung ----------------------------------------------------- */}
      <MockScreen show={step >= 1}>
        <MockStatusBar />
        <MockStackHeader
          title={L('Deine Verbindung', 'Your connection')}
          subtitle={done ? L('Mo 9.11. · 51 Min · 1 Umstieg', 'Mon 9/11 · 51 min · 1 change') : L('Mo 9.11. · 36 Min · 1 Umstieg', 'Mon 9/11 · 36 min · 1 change')}
        />
        <Box r={{ x: 16, y: 62, w: 268, h: 44 }}>
          <MText size={14} weight="extrabold" lines={1}>
            Bielefeld Hbf
          </MText>
          <MText size={14} weight="extrabold" color={colors.textMuted} lines={1}>
            → Lage, Am Duftgarten
          </MText>
        </Box>
        <MockButton r={R.mapBtn} text={L('Auf der Karte zeigen', 'Show on map')} icon="map" variant="light" size={8.5} />
        <MockButton r={R.commuteBtn} text={L('Als Pendelstrecke', 'Save as commute')} icon="repeat" variant="light" size={8.5} />
        <MockButton r={R.editBtn} text={editing ? L('Fertig', 'Done') : L('Fahrten ändern', 'Change rides')} icon={editing ? 'check' : 'edit-2'} variant={editing ? 'cyan' : 'light'} size={8.5} />
        <Pulse r={R.editBtn} active={step === 2} radius={12} />

        {/* Hinweisbox im Bearbeiten-Modus */}
        <Appear show={editing} from="down" distance={10} fill={false} style={{ position: 'absolute', left: R.hint.x, top: R.hint.y, width: R.hint.w }}>
          <View style={[s.hint, { height: done ? 70 : R.hint.h }]}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Feather name="edit-2" size={10} color={colors.text} style={{ marginTop: 1 }} />
              <MText size={8.5} weight="medium" style={{ flex: 1 }}>
                {L(
                  'Tippe auf eine Fahrt, um eine frühere oder spätere zu wählen. Den Rest passt Catch an.',
                  'Tap a ride to pick an earlier or later one. Catch adjusts the rest.',
                )}
              </MText>
            </View>
            {done ? (
              <View style={s.resetBtn}>
                <Feather name="rotate-ccw" size={9} color={colors.text} />
                <MText size={8} weight="bold">
                  {L('Ursprüngliche Verbindung', 'Original connection')}
                </MText>
              </View>
            ) : null}
          </View>
        </Appear>

        {/* Fahrten (rutschen im Bearbeiten-Modus nach unten) */}
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: offset }] }]}>
          <Times r={R.card1} dep={done ? '06:31' : '06:46'} arr={done ? '06:58' : '07:12'} />
          <MockCard
            r={R.card1}
            mode="REGIONAL"
            tab={L('Ruhig', 'Quiet')}
            title={done ? 'RB73 → Lemgo' : 'RE42 → Münster'}
            subtitle={L('Bielefeld Hbf → Lage, Bahnhof · 5 Halte', 'Bielefeld Hbf → Lage, Bahnhof · 5 stops')}
            tags={[{ text: L('ab Gleis 2', 'from platform 2') }, { text: L('an Gleis 3', 'arr. platform 3') }]}
            footer={L('Keine Meldungen in 30 Tagen', 'No reports in 30 days')}
            menu={editing ? 'edit-2' : 'chevron-right'}
          />
          <Pulse r={R.card1} active={step === 3} radius={16} color={colors.cyan} />
          <MockPill
            r={R.pill}
            tone={done ? 'ok' : 'tight'}
            text={done ? L('Umstieg in Lage: 17 Min', 'Change at Lage: 17 min') : L('Umstieg in Lage: 3 Min · knapp', 'Change at Lage: 3 min · tight')}
            trailing="edit-2"
          />
          <Pulse r={R.pill} active={step === 1} radius={12} color={colors.orange} />
          <Times r={R.card2} dep="07:15" arr="07:22" />
          <MockCard
            r={R.card2}
            mode="BUS"
            tab={L('Ruhig', 'Quiet')}
            title="741 → Am Duftgarten"
            subtitle={L('Lage, Bahnhof → Am Duftgarten · 4 Halte', 'Lage, Bahnhof → Am Duftgarten · 4 stops')}
            tags={[{ text: L('ab Steig 71', 'from stop 71') }]}
            menu={editing ? 'edit-2' : 'chevron-right'}
          />
        </Animated.View>

        <MockButton r={R.track} text={L('Live-Tracking für diese Verbindung', 'Live tracking for this connection')} icon="radio" variant="cyan" size={9.5} />
        <MockToast show={done} text={L('Verbindung angepasst – 15 Min früher los', 'Connection updated – leave 15 min earlier')} />

        {/* --- 3. Andere Fahrt wählen --------------------------------------------- */}
        <MockSheet show={step === 4} top={SHEET_TOP}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 36 }}>
            <View style={s.sheetIcon}>
              <Feather name="shuffle" size={13} color={colors.textOnLight} />
            </View>
            <View>
              <MText size={12.5} weight="extrabold">
                {L('Andere Fahrt wählen', 'Pick another ride')}
              </MText>
              <MText size={8.5} color={colors.textMuted} weight="medium">
                Bielefeld Hbf → Lage, Bahnhof
              </MText>
            </View>
          </View>
          <MText size={8} color={colors.textMuted} weight="medium" style={{ height: 30, marginTop: 4 }}>
            {L('Direktfahrten zwischen diesen Haltestellen. Den Rest der Verbindung passt Catch an.', 'Direct rides between these stops. Catch adjusts the rest of your connection.')}
          </MText>
          <View style={s.list}>
            <OptionRow dep="05:46" arr="06:12" line="RE42" to="Münster" right={L('1 Std früher', '1 h earlier')} sub={L('1 Std Umstieg', '1 h to change')} />
            <OptionRow dep="06:31" arr="06:58" line="RB73" to="Lemgo" right={L('15 Min früher', '15 min earlier')} sub={L('17 Min Umstieg', '17 min to change')} border />
            <OptionRow dep="06:46" arr="07:12" line="RE42" to="Münster" current={L('Aktuell', 'Current')} border />
            <OptionRow dep="07:46" arr="08:12" line="RE42" to="Münster" right={L('1 Std später', '1 h later')} sub={L('neuer Anschluss', 'new connection')} subColor={colors.cyan} border />
          </View>
          <Pulse r={{ x: 14, y: ROWS_Y + ROW_H, w: 272, h: ROW_H }} active={step === 4} radius={10} />
        </MockSheet>
      </MockScreen>
    </View>
  );
}

function ResultCard({ r, dep, arr, dur, change, first, second }: { r: Rect; dep: string; arr: string; dur: string; change: string; first: string; second: string }) {
  return (
    <Box r={r} style={s.result}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <MText size={13} weight="extrabold">
          {dep} → {arr}
        </MText>
        <MText size={9.5} color={colors.textMuted}>
          {dur}
        </MText>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
        <MockLine name={first} mode="REGIONAL" />
        <Feather name="chevron-right" size={10} color={colors.textMuted} />
        <MockLine name={second} mode="BUS" />
        <MText size={8.5} color={colors.textMuted} style={{ marginLeft: 6 }}>
          {change}
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

function OptionRow({
  dep,
  arr,
  line,
  to,
  right,
  sub,
  subColor = colors.textMuted,
  current,
  border,
}: {
  dep: string;
  arr: string;
  line: string;
  to: string;
  right?: string;
  sub?: string;
  subColor?: string;
  current?: string;
  border?: boolean;
}) {
  return (
    <View style={[s.row, border && s.rowBorder]}>
      <View style={{ width: 36 }}>
        <MText size={9.5} weight="bold">
          {dep}
        </MText>
        <MText size={9.5} weight="bold" color={colors.textMuted}>
          {arr}
        </MText>
      </View>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <MockLine name={line} mode="REGIONAL" />
        <MText size={8.5} lines={1} style={{ flexShrink: 1 }}>
          {to}
        </MText>
      </View>
      {current ? (
        <View style={s.current}>
          <MText size={8} weight="bold" color={colors.textOnLight}>
            {current}
          </MText>
        </View>
      ) : (
        <View style={{ alignItems: 'flex-end' }}>
          <MText size={8.5} weight="bold" color={right?.includes('früher') || right?.includes('earlier') ? colors.lime : colors.text}>
            {right}
          </MText>
          <MText size={8} color={subColor}>
            {sub}
          </MText>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  route: { backgroundColor: colors.surfaceDeep, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'space-between' },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
  routeLine: { height: 1, backgroundColor: colors.border, marginLeft: 17 },
  result: { backgroundColor: colors.surface, borderRadius: 16, padding: 12 },
  hint: { borderRadius: 14, borderWidth: 1, borderColor: colors.cyan, backgroundColor: colors.surface, padding: 8, gap: 6 },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 8,
    height: 20,
  },
  dash: { borderLeftWidth: 1, borderStyle: 'dashed', borderColor: colors.textFaint },
  sheetIcon: { width: 26, height: 26, borderRadius: 9, backgroundColor: colors.cyan, alignItems: 'center', justifyContent: 'center' },
  list: { backgroundColor: colors.surfaceDeep, borderRadius: 12, paddingHorizontal: 8, marginTop: 2 },
  row: { height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  current: { backgroundColor: colors.lime, borderRadius: 8, paddingHorizontal: 7, height: 16, justifyContent: 'center' },
});

export const changeRides: Tutorial = {
  id: 'change-rides',
  icon: 'shuffle',
  category: 'plan',
  featured: true,
  question: {
    de: 'Kann ich einen früheren Zug nehmen, wenn der Umstieg zu knapp ist?',
    en: 'Can I take an earlier train if the change is too tight?',
  },
  answer: {
    de: 'Ja. Öffne die Verbindung und tippe auf „Fahrten ändern“. Dann tippst du auf den Zug oder Bus und wählst eine frühere oder spätere Fahrt zwischen denselben Haltestellen. Catch sucht davor und danach automatisch passende Anschlüsse. Tipp: Ein Tipp auf den Umstiegs-Hinweis öffnet die Auswahl direkt.',
    en: 'Yes. Open the connection and tap “Change rides”. Then tap the train or bus and pick an earlier or later ride between the same stops. Catch finds matching connections before and after it automatically. Tip: tapping the change hint opens the choice directly.',
  },
  where: { de: 'Suche → Verbindung öffnen → Fahrten ändern', en: 'Search → open a connection → Change rides' },
  tryIt: '/search',
  steps: [
    {
      caption: { de: 'Such wie gewohnt deine Verbindung und öffne sie.', en: 'Search for your connection as usual and open it.' },
      target: center(R.result1),
    },
    {
      caption: {
        de: 'Zwischen den Fahrten siehst du, wie viel Zeit du zum Umsteigen hast. Orange heißt: knapp!',
        en: 'Between rides you see how much time you have to change. Orange means: tight!',
      },
      target: center(R.pill, 40),
      tap: false,
      read: 2800,
    },
    { caption: { de: 'Tippe auf „Fahrten ändern“.', en: 'Tap “Change rides”.' }, target: center(R.editBtn), read: 1600 },
    {
      caption: { de: 'Tippe auf die Fahrt, die du tauschen möchtest – hier den RE 42.', en: 'Tap the ride you want to swap – here the RE 42.' },
      target: center(shift(R.card1, EDIT_SHIFT), 10, -6),
      read: 2000,
    },
    {
      caption: {
        de: 'Wähle eine frühere Fahrt. Rechts siehst du sofort, wie viel Zeit du dann zum Umsteigen hast.',
        en: 'Pick an earlier ride. On the right you instantly see how much time you’ll then have to change.',
      },
      target: center(pickRow, 30, -8),
      read: 2800,
    },
    {
      caption: {
        de: 'Fertig: 17 Minuten zum Umsteigen statt 3. Den Rest passt Catch an – „Ursprüngliche Verbindung“ macht alles rückgängig.',
        en: 'Done: 17 minutes to change instead of 3. Catch adjusts the rest – “Original connection” undoes everything.',
      },
    },
  ],
  Scene: ChangeRidesScene,
};
