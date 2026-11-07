// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Tutorial "Ohne Internet": Profil → Offline-Fahrpläne → Stadt laden (Fortschrittsbalken) →
 * in der Suche den Chip "Offline" nutzen → Ergebnis "Nur Fahrplan · ohne Echtzeit".
 */
import { Feather } from '@expo/vector-icons';
import { useEffect, useState, type ComponentProps } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { ModeIcon } from '@/components/transit';
import { colors, modeColor } from '@/theme';
import {
  Appear,
  Box,
  center,
  MockChip,
  MockScreen,
  MockStatusBar,
  MockTabBar,
  MockToast,
  MText,
  Pulse,
  useGlide,
  useReduceMotion,
  type Rect,
} from '../mock';
import type { SceneProps, Tutorial } from '../types';
import { MockSearchEmpty, MockSearchForm, SEARCH, searchBottom } from './planShared';

type FeatherName = ComponentProps<typeof Feather>['name'];
type Lang = 'en' | 'de';

const CITY_ROW_H = 54;
const CITIES_Y = 338;
/** Ergebnisse unter dem Suchformular (mit Offline-Chip) */
const RESULTS_Y = searchBottom(true) + 16;
/** So weit scrollt die Suche nach dem Suchen zu den Ergebnissen (wie in der App) */
const SCROLL = RESULTS_Y - 78;

// Layout (Mock-Telefon 300 × 600)
const R = {
  // Profil
  offlineRow: { x: 16, y: 254, w: 268, h: 50 },
  // Offline-Fahrpläne
  muenster: { x: 16, y: CITIES_Y + CITY_ROW_H * 2, w: 268, h: CITY_ROW_H },
  download: { x: 244, y: CITIES_Y + CITY_ROW_H * 2 + 13, w: 28, h: 28 },
  // Suche
  offlineChip: { x: 16, y: SEARCH.offline.y, w: 62, h: 22 },
} satisfies Record<string, Rect>;

function OfflineScene({ step, lang }: SceneProps) {
  const de = lang === 'de';
  const L = (d: string, e: string) => (de ? d : e);
  const pct = useProgress(step === 2);
  const scroll = useGlide(step >= 5 ? -SCROLL : 0, 520);

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* --- 1. Profil (nach unten gescrollt) ------------------------------------------ */}
      <MockStatusBar />
      <Section y={32} title={L('Hilfe & Tutorials', 'Help & tutorials')} />
      <Box r={{ x: 16, y: 54, w: 268, h: 56 }} style={s.card}>
        <LinkRow
          icon="help-circle"
          title={L('Hilfe & Tutorials', 'Help & tutorials')}
          text={L('„Kann ich …?“ – kurze Animationen zeigen dir, wo du was findest.', '“Can I …?” – short animations show you where to find what.')}
        />
      </Box>
      <Section y={122} title={L('Sprache / Language', 'Language / Sprache')} />
      <Box r={{ x: 16, y: 144, w: 268, h: 76 }} style={[s.card, { gap: 8, justifyContent: 'center' }]}>
        <View style={s.linkRow}>
          <IconTile icon="globe" />
          <MText size={8.5} weight="medium" color={colors.textMuted} style={{ flex: 1 }}>
            {L('Sprache der App, der Alarme und Push-Benachrichtigungen', 'Language of the app, alerts and push notifications')}
          </MText>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <MockChip text="Deutsch" selected={de} />
          <MockChip text="English" selected={!de} />
        </View>
      </Box>
      <Section y={232} title="Offline" />
      <Box r={R.offlineRow} style={s.card}>
        <LinkRow icon="download-cloud" title={L('Offline-Fahrpläne', 'Offline timetables')} text={L('Verbindungen ohne Internet planen', 'Plan journeys without internet')} />
      </Box>
      <Pulse r={R.offlineRow} active={step === 0} radius={16} />
      <Section y={318} title="Widget" />
      <Box r={{ x: 16, y: 340, w: 268, h: 50 }} style={s.card}>
        <LinkRow icon="layout" title={L('Homescreen-Widget', 'Home-screen widget')} text={L('Nächste Abfahrten auf deinem Homescreen', 'Next departures on your home screen')} />
      </Box>
      <Section y={404} title={L('Datenschutz & Fairness', 'Privacy & fairness')} />
      <Box r={{ x: 16, y: 426, w: 268, h: 60 }} style={[s.card, { justifyContent: 'center' }]}>
        <Note
          icon="lock"
          text={L(
            'Meldungen erscheinen anonym. Gespeichert werden nur Linie, Haltestellen, Uhrzeit, Art und feste Merkmale – kein Freitext, keine Fotos, kein GPS-Verlauf.',
            'Reports appear anonymously. Only line, stops, time, type and fixed attributes are stored – no free text, no photos, no GPS history.',
          )}
        />
      </Box>
      <MockTabBar active="profile" lang={lang} />

      {/* --- 2. Offline-Fahrpläne ------------------------------------------------------- */}
      <MockScreen show={step >= 1}>
        <MockStatusBar />
        <Box r={{ x: 14, y: 30, w: 24, h: 24 }} style={{ justifyContent: 'center' }}>
          <Feather name="arrow-left" size={15} color={colors.text} />
        </Box>
        <Box r={{ x: 16, y: 60, w: 268, h: 60 }} style={{ flexDirection: 'row', gap: 10 }}>
          <View style={s.heroIcon}>
            <Feather name="download-cloud" size={18} color={colors.textOnLight} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <MText size={15} weight="extrabold">
              {L('Offline-Fahrpläne', 'Offline timetables')}
            </MText>
            <MText size={8.5} weight="medium" color={colors.textMuted}>
              {L(
                'Lade deine Städte herunter und plane Verbindungen auch ohne Internet – direkt auf deinem Gerät.',
                'Download your cities and plan journeys even without internet – right on your device.',
              )}
            </MText>
          </View>
        </Box>
        <Box r={{ x: 16, y: 126, w: 268, h: 104 }} style={[s.card, { gap: 7, justifyContent: 'center' }]}>
          <Note
            icon="clock"
            text={L(
              'Nur Fahrplan: keine Echtzeit-Verspätungen, Ausfälle oder Gleiswechsel und keine Hinweise anderer Fahrgäste.',
              'Timetable only: no live delays, cancellations or platform changes, and no tips from other passengers.',
            )}
          />
          <Note
            icon="calendar"
            text={L(
              'Jeder Download gilt etwa 2 Wochen. Neue Fahrpläne gibt es jede Woche – aktualisiere, wenn du online bist.',
              'Each download is valid for about 2 weeks. New timetables come out every week – update when you’re online.',
            )}
          />
          <Note
            icon="lock"
            text={L('Offline-Suchen bleiben auf deinem Gerät – es wird nichts gesendet.', 'Offline searches stay on your device – nothing is sent anywhere.')}
          />
        </Box>
        <Section y={240} title={L('Auf diesem Gerät', 'On this device')} />
        <Box r={{ x: 16, y: 262, w: 268, h: 40 }} style={[s.card, s.linkRow]}>
          <Feather name="map" size={13} color={colors.textMuted} />
          <MText size={8.5} weight="medium" color={colors.textMuted} style={{ flex: 1 }}>
            {L('Noch keine Stadt heruntergeladen. Wähle unten eine aus.', 'No city downloaded yet. Pick one below.')}
          </MText>
        </Box>
        <Section y={314} title={L('Verfügbare Städte', 'Available cities')} />
        <Box r={{ x: 16, y: CITIES_Y - 2, w: 268, h: CITY_ROW_H * 3 + 4 }} style={s.card} />
        <CityRow i={0} name="Hamburg" size={L('42,6 MB · 9.871 Haltestellen', '42.6 MB · 9,871 stops')} lang={lang} />
        <CityRow i={1} name="Köln" size={L('31,2 MB · 6.204 Haltestellen', '31.2 MB · 6,204 stops')} lang={lang} />
        <CityRow
          i={2}
          name="Münster"
          size={L('8,4 MB · 1.318 Haltestellen', '8.4 MB · 1,318 stops')}
          lang={lang}
          progress={step === 2 ? pct : undefined}
        />
        <Pulse r={R.download} active={step === 1} radius={14} />

        {/* --- 3. Suche mit Chip "Offline" --------------------------------------------- */}
        <MockScreen show={step >= 3}>
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: scroll }] }]}>
            <MockSearchForm
              lang={lang}
              from={{ name: 'Münster Hbf' }}
              to={{ name: 'Roxel Kirche' }}
              offline={step >= 4}
            />
            <Pulse r={R.offlineChip} active={step === 3} radius={11} color={colors.cyan} />
            <Pulse r={SEARCH.findOffline} active={step === 4} radius={17} />
            <Appear show={step < 5} duration={200}>
              <MockSearchEmpty lang={lang} y={RESULTS_Y + 14} />
            </Appear>
            <Appear show={step >= 5} from="up" distance={16}>
              <Results lang={lang} />
            </Appear>
          </Animated.View>
          {/* Statusleiste deckt gescrollten Inhalt ab */}
          <Box r={{ x: 0, y: -10, w: 300, h: 34 }} style={{ backgroundColor: colors.bg }} />
          <MockStatusBar />
          <MockTabBar active="search" lang={lang} />
          <MockToast show={step === 3} text={L('Münster ist jetzt offline verfügbar', 'Münster is ready for offline use')} />
        </MockScreen>
      </MockScreen>
    </View>
  );
}

/** Download-Fortschritt in % (läuft während des Schritts hoch; ohne Bewegung fest). */
function useProgress(active: boolean): number {
  const reduce = useReduceMotion();
  const [pct, setPct] = useState(6);
  useEffect(() => {
    if (!active || reduce) return;
    const t0 = Date.now();
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / 2600);
      setPct(Math.round(6 + 90 * p));
      if (p >= 1) clearInterval(id);
    }, 80);
    return () => {
      clearInterval(id);
      setPct(6);
    };
  }, [active, reduce]);
  return reduce ? 64 : pct;
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

function Section({ y, title }: { y: number; title: string }) {
  return (
    <Box r={{ x: 16, y, w: 268, h: 18 }}>
      <MText size={13.5} weight="bold">
        {title}
      </MText>
    </Box>
  );
}

function IconTile({ icon, color = colors.lime }: { icon: FeatherName; color?: string }) {
  return (
    <View style={s.tile}>
      <Feather name={icon} size={13} color={color} />
    </View>
  );
}

function LinkRow({ icon, title, text }: { icon: FeatherName; title: string; text: string }) {
  return (
    <View style={[s.linkRow, { flex: 1 }]}>
      <IconTile icon={icon} />
      <View style={{ flex: 1 }}>
        <MText size={10.5}>{title}</MText>
        <MText size={8.5} weight="medium" color={colors.textMuted}>
          {text}
        </MText>
      </View>
      <Feather name="chevron-right" size={13} color={colors.textMuted} />
    </View>
  );
}

function Note({ icon, text }: { icon: FeatherName; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      <Feather name={icon} size={10} color={colors.textMuted} style={{ marginTop: 1 }} />
      <MText size={8} weight="medium" color={colors.textMuted} style={{ flex: 1 }}>
        {text}
      </MText>
    </View>
  );
}

/** Stadt in "Verfügbare Städte": Größe, Gültigkeit, Download-Knopf – beim Laden Prozent + Balken. */
function CityRow({ i, name, size, lang, progress }: { i: number; name: string; size: string; lang: Lang; progress?: number }) {
  const y = CITIES_Y + i * CITY_ROW_H;
  const loading = progress !== undefined;
  return (
    <>
      {i > 0 ? <Box r={{ x: 28, y, w: 244, h: 1 }} style={{ backgroundColor: colors.border }} /> : null}
      <Box r={{ x: 28, y, w: 244, h: CITY_ROW_H }} style={s.cityRow}>
        <IconTile icon="map-pin" color={colors.textMuted} />
        <View style={{ flex: 1 }}>
          <MText size={10.5}>{name}</MText>
          <MText size={8} weight="medium" color={colors.textMuted}>
            {size}
          </MText>
          <MText size={8} weight="medium" color={colors.textMuted}>
            {lang === 'de' ? 'Gültig bis 21.11.' : 'Valid until 21/11'}
          </MText>
        </View>
        {loading ? (
          <View style={s.busy}>
            <Feather name="loader" size={11} color={colors.lime} />
            <MText size={9} weight="bold" color={colors.lime}>
              {`${progress} %`}
            </MText>
          </View>
        ) : (
          <View style={s.download}>
            <Feather name="download" size={13} color={colors.textOnLight} />
          </View>
        )}
      </Box>
      {loading ? (
        <Box r={{ x: 66, y: y + CITY_ROW_H - 6, w: 206, h: 3 }} style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${progress}%` }]} />
        </Box>
      ) : null}
    </>
  );
}

/** Ergebnis der Offline-Suche: Banner + Verbindungen mit "Nur Fahrplan · ohne Echtzeit". */
function Results({ lang }: { lang: Lang }) {
  const de = lang === 'de';
  const L = (d: string, e: string) => (de ? d : e);
  const y = RESULTS_Y;
  return (
    <>
      <Box r={{ x: 16, y, w: 268, h: 20 }}>
        <MText size={13.5} weight="bold" lines={1}>
          Münster Hbf → Roxel Kirche
        </MText>
      </Box>
      <Box r={{ x: 16, y: y + 20, w: 268, h: 14 }}>
        <MText size={8.5} weight="medium" color={colors.textMuted}>
          {L('Jetzt · Abfahrt', 'Now · Departure')}
        </MText>
      </Box>
      <Box r={{ x: 16, y: y + 40, w: 268, h: 56 }} style={s.banner}>
        <View style={s.bannerIcon}>
          <Feather name="wifi-off" size={12} color={colors.textOnLight} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <MText size={9.5} weight="bold">
            {L('Offline · Fahrplan ohne Echtzeit', 'Offline · timetable without live data')}
          </MText>
          <MText size={8} weight="medium" color={colors.textMuted}>
            {L(
              'Auf deinem Gerät berechnet mit dem Fahrplan Münster (gültig bis 21.11.).',
              'Calculated on your device with the Münster timetable (valid until 21/11).',
            )}
          </MText>
        </View>
      </Box>
      <SmallButton r={{ x: 16, y: y + 104, w: 268, h: 26 }} icon="chevron-up" text={L('Früher', 'Earlier')} />
      <JourneyCard y={y + 138} dep="18:52" arr="19:11" lang={lang} />
      <JourneyCard y={y + 244} dep="19:07" arr="19:26" lang={lang} />
      <SmallButton r={{ x: 16, y: y + 350, w: 268, h: 26 }} icon="chevron-down" text={L('Später', 'Later')} />
    </>
  );
}

function SmallButton({ r, icon, text }: { r: Rect; icon: FeatherName; text: string }) {
  return (
    <Box r={r} style={s.smallBtn}>
      <Feather name={icon} size={11} color={colors.text} />
      <MText size={9} weight="bold">
        {text}
      </MText>
    </Box>
  );
}

function JourneyCard({ y, dep, arr, lang }: { y: number; dep: string; arr: string; lang: Lang }) {
  const de = lang === 'de';
  return (
    <Box r={{ x: 16, y, w: 268, h: 96 }} style={s.journey}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <MText size={13} weight="extrabold">
              {dep}
            </MText>
            <Feather name="arrow-right" size={10} color={colors.textMuted} />
            <MText size={13} weight="extrabold">
              {arr}
            </MText>
          </View>
          <MText size={8.5} weight="medium" color={colors.textMuted}>
            {de ? '19 Min · Direkt' : '19 min · Direct'}
          </MText>
        </View>
        <Feather name="chevron-right" size={13} color={colors.textMuted} />
      </View>
      <View style={s.legs}>
        <Walk min="3" />
        <Feather name="chevron-right" size={9} color={colors.textFaint} />
        <View style={[s.line, { backgroundColor: modeColor.BUS }]}>
          <MText size={8.5} weight="extrabold" color="#FFFFFF">
            5
          </MText>
        </View>
        <Feather name="chevron-right" size={9} color={colors.textFaint} />
        <Walk min="2" />
      </View>
      <View style={s.status}>
        <Feather name="wifi-off" size={9} color={colors.cyan} />
        <MText size={8.5} weight="bold" color={colors.cyan}>
          {de ? 'Nur Fahrplan · ohne Echtzeit' : 'Timetable only · no live data'}
        </MText>
      </View>
    </Box>
  );
}

function Walk({ min }: { min: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
      <ModeIcon mode="WALK" size={11} color={colors.textMuted} />
      <MText size={8} weight="medium" color={colors.textMuted}>
        {min}
      </MText>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 12 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tile: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  heroIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  download: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  progressTrack: { borderRadius: 2, backgroundColor: colors.surfaceDeep, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: colors.lime },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(46,200,230,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(46,200,230,0.35)',
  },
  bannerIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.cyan, alignItems: 'center', justifyContent: 'center' },
  smallBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 13, backgroundColor: colors.surfaceAlt },
  journey: { backgroundColor: colors.surface, borderRadius: 16, padding: 12, gap: 7 },
  legs: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  line: { height: 15, minWidth: 20, paddingHorizontal: 5, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(46,200,230,0.13)',
  },
});

export const offline: Tutorial = {
  id: 'offline',
  icon: 'download-cloud',
  category: 'app',
  question: {
    de: 'Funktioniert Catch auch ohne Internet?',
    en: 'Does Catch work without internet?',
  },
  answer: {
    de: 'Ja, mit Offline-Fahrplänen: Unter Profil → Offline-Fahrpläne lädst du deine Stadt herunter (gilt etwa 2 Wochen). Danach planst du Verbindungen auch ohne Internet – ohne Netz rechnet Catch automatisch auf dem Gerät, mit dem Chip „Offline“ in der Suche auch absichtlich. Live-Daten wie Verspätungen, Gleiswechsel und Hinweise anderer Fahrgäste gibt es offline nicht.',
    en: 'Yes, with offline timetables: under Profile → Offline timetables you download your city (valid for about 2 weeks). Then you can plan journeys without internet – with no connection Catch calculates on your device automatically, and the “Offline” chip in Search does it on purpose. Live data such as delays, platform changes and tips from other passengers isn’t available offline.',
  },
  where: { de: 'Profil → Offline-Fahrpläne', en: 'Profile → Offline timetables' },
  tryIt: '/offline',
  steps: [
    {
      caption: { de: 'Öffne Profil und tippe unter „Offline“ auf „Offline-Fahrpläne“.', en: 'Open Profile and tap “Offline timetables” under “Offline”.' },
      target: center(R.offlineRow, 60, 2),
      read: 2200,
    },
    {
      caption: {
        de: 'Wähle deine Stadt und tippe auf den Download-Knopf. Ein Download gilt etwa 2 Wochen.',
        en: 'Pick your city and tap the download button. A download is valid for about 2 weeks.',
      },
      target: center(R.download),
      read: 2400,
    },
    {
      caption: {
        de: 'Der Fahrplan wird jetzt auf dein Gerät geladen. Danach klappt die Suche in dieser Stadt auch ohne Internet.',
        en: 'The timetable is now saved to your device. After that, search works in this city even without internet.',
      },
      read: 2800,
    },
    {
      caption: {
        de: 'In der Suche gibt es jetzt den Chip „Offline“. Tippe ihn an, um ohne Internet zu planen.',
        en: 'Search now has an “Offline” chip. Tap it to plan without internet.',
      },
      target: center(R.offlineChip, 4, 2),
      read: 2600,
    },
    {
      caption: {
        de: 'Tippe auf „Verbindungen suchen“. Hast du gar kein Netz, rechnet Catch sogar automatisch offline.',
        en: 'Tap “Find connections”. With no connection at all, Catch even switches to offline by itself.',
      },
      target: center(SEARCH.findOffline, 84, 2),
      read: 2600,
    },
    {
      caption: {
        de: 'Fertig: „Nur Fahrplan · ohne Echtzeit“ – offline gibt es keine Verspätungen, Gleiswechsel oder Live-Hinweise.',
        en: 'Done: “Timetable only · no live data” – offline there are no delays, platform changes or live tips.',
      },
    },
  ],
  Scene: OfflineScene,
};
