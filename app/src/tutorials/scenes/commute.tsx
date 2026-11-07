// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Tutorial "Pendelstrecke": in der Verbindung "Als Pendelstrecke" → Editor (Tage, Erinnerung zum
 * Losgehen) → "Strecke speichern" → die Startseite zeigt "Los um …" samt Erinnerung per Push.
 * Vorbilder: app/commute-edit.tsx, components/CommuteCard.tsx, components/CommuteSections.tsx.
 */
import { Feather } from '@expo/vector-icons';
import { Animated, StyleSheet, View } from 'react-native';

import type { TKey } from '@/i18n';
import { colors } from '@/theme';
import { Appear, Box, center, MockButton, MockCard, MockScreen, MockStackHeader, MockStatusBar, MockTabBar, MText, Pulse, useGlide, type Rect } from '../mock';
import type { SceneProps, Tutorial } from '../types';
import { ChipM, Footer, HomeTop, J, JourneyScreen, KindChips, LineBadgeM, MCap, MNotice, pick, PushCard, RB65, SectionHead, ToggleM, tr, Wallpaper } from './alertsKit';

// Layout (Mock-Telefon 300 × 600) – Editor-Koordinaten ungescrollt
const DAY_W = 34;
const DAY_GAP = 5;
const CARD_Y = 404;
const R = {
  commuteBtn: J.commuteBtn,
  days: { x: 16, y: 236, w: 7 * DAY_W + 6 * DAY_GAP, h: 28 },
  card: { x: 16, y: CARD_Y, w: 268, h: 292 },
  save: { x: 16, y: 548, w: 268, h: 36 },
  plan: { x: 28, y: 286, w: 244, h: 94 },
} satisfies Record<string, Rect>;
/** "5 / 10 / 15 / 20 Min. vorher" (2 × 2 wie in der App) */
const REMIND: { n: number; r: Rect }[] = [
  { n: 5, r: { x: 28, y: CARD_Y + 172, w: 86, h: 22 } },
  { n: 10, r: { x: 119, y: CARD_Y + 172, w: 86, h: 22 } },
  { n: 15, r: { x: 28, y: CARD_Y + 199, w: 86, h: 22 } },
  { n: 20, r: { x: 119, y: CARD_Y + 199, w: 86, h: 22 } },
];
/** So weit scrollt der Editor zur Erinnerung */
const SCROLL = 340;
const CLIP_TOP = 60;
/** Unterkante des sichtbaren Editor-Bereichs (darunter nichts angeschnitten) */
const CLIP_BOTTOM = 526;
const remind15 = REMIND[2].r;

function CommuteScene({ step, lang }: SceneProps) {
  const t = tr(lang);
  const L = pick(lang);
  const scrolled = step >= 2;
  const remind = step >= 3 ? 15 : 10;
  const offset = useGlide(scrolled ? -SCROLL : 0, 520);
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((d) => t(`wd.${d}` as TKey));

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* --- 0. Verbindung ---------------------------------------------------------- */}
      <JourneyScreen lang={lang} />
      <Pulse r={R.commuteBtn} active={step === 0} radius={12} />

      {/* --- 1.–3. Neue Pendelstrecke --------------------------------------------- */}
      <MockScreen show={step >= 1}>
        <MockStatusBar />
        <MockStackHeader title={t('commute.new')} />
        <Box r={{ x: 0, y: CLIP_TOP, w: 300, h: CLIP_BOTTOM - CLIP_TOP }} style={{ overflow: 'hidden' }}>
          <Animated.View style={[s.scroll, { transform: [{ translateY: offset }] }]}>
            <MCap r={{ x: 16, y: 66, w: 268, h: 12 }} text={t('commute.name')} />
            <Box r={{ x: 16, y: 80, w: 268, h: 30 }} style={s.input}>
              <Feather name="tag" size={10} color={colors.textMuted} />
              <MText size={10} weight="medium" lines={1}>
                {t('commute.nameTo', { place: 'Greven' })}
              </MText>
            </Box>

            <MCap r={{ x: 16, y: 120, w: 268, h: 12 }} text={t('commute.route')} />
            <Box r={{ x: 16, y: 134, w: 268, h: 76 }} style={s.fields}>
              <PlaceRow label={t('commute.from')} value="Münster Hbf" dot={colors.lime} />
              <View style={s.fieldDivider} />
              <PlaceRow label={t('commute.to')} value="Greven" dot={colors.orange} />
            </Box>
            <Box r={{ x: 242, y: 157, w: 30, h: 30 }} style={s.swap}>
              <Feather name="repeat" size={12} color={colors.textOnLight} style={{ transform: [{ rotate: '90deg' }] }} />
            </Box>

            <MCap r={{ x: 16, y: 222, w: 268, h: 12 }} text={t('commute.days')} />
            {weekdays.map((d, i) => {
              const on = i < 5;
              return (
                <Box key={d} r={{ x: R.days.x + i * (DAY_W + DAY_GAP), y: R.days.y, w: DAY_W, h: DAY_W - 6 }} style={[s.day, on && s.dayOn]}>
                  <MText size={8.5} weight="bold" color={on ? colors.textOnLight : colors.text}>
                    {d}
                  </MText>
                </Box>
              );
            })}
            <ChipM r={{ x: 16, y: 270, w: 56, h: 22 }} text={t('commute.days.weekdays')} selected />
            <ChipM r={{ x: 76, y: 270, w: 64, h: 22 }} text={t('commute.days.all')} />
            <Pulse r={R.days} active={step === 1} radius={14} color={colors.cyan} />

            <MCap r={{ x: 16, y: 304, w: 268, h: 12 }} text={t('commute.time')} />
            <ChipM r={{ x: 16, y: 318, w: 86, h: 22 }} text={t('commute.modeDepart')} icon="log-out" selected color={colors.cyan} />
            <ChipM r={{ x: 106, y: 318, w: 88, h: 22 }} text={t('commute.modeArrive')} icon="flag" />
            <Box r={{ x: 16, y: 348, w: 108, h: 30 }} style={s.stepper}>
              <View style={s.stepBtn}>
                <Feather name="minus" size={10} color={colors.text} />
              </View>
              <MText size={12} weight="bold">
                09:55
              </MText>
              <View style={s.stepBtn}>
                <Feather name="plus" size={10} color={colors.text} />
              </View>
            </Box>
            <Box r={{ x: 16, y: 384, w: 268, h: 12 }}>
              <MText size={8} weight="medium" color={colors.textFaint} lines={1}>
                {t('commute.timeHint')}
              </MText>
            </Box>

            {/* Alarm bei · Erinnerung · Beobachten */}
            <Box r={R.card} style={s.card} />
            <MCap r={{ x: 28, y: CARD_Y + 12, w: 244, h: 12 }} text={t('commute.kindsLabel')} />
            <KindChips x={28} y={CARD_Y + 26} lang={lang} />
            <Box r={{ x: 28, y: CARD_Y + 114, w: 244, h: 1 }} style={s.divider} />
            <SettingRow y={CARD_Y + 124} icon="clock" title={t('commute.reminder')} text={t('commute.reminderText')} />
            {REMIND.map((o) => (
              <ChipM key={o.n} r={o.r} text={t('commute.reminderMin', { n: o.n })} selected={o.n === remind} />
            ))}
            <Pulse r={remind15} active={step === 2} radius={11} />
            <Box r={{ x: 28, y: CARD_Y + 233, w: 244, h: 1 }} style={s.divider} />
            <SettingRow y={CARD_Y + 243} icon="radio" title={t('commute.active')} text={t('commute.activeText')} />
            <MNotice r={{ x: 16, y: CARD_Y + R.card.h + 10, w: 268, h: 56 }} icon="lock" text={t('commute.privacy')} />
          </Animated.View>
        </Box>
        <Footer>
          <MockButton r={R.save} text={t('commute.save')} icon="check" variant="lime" size={10} />
        </Footer>
        <Pulse r={R.save} active={step === 3} radius={18} />
      </MockScreen>

      {/* --- 4. Startseite: Deine Pendelstrecke -------------------------------------- */}
      <MockScreen show={step >= 4} from="fade">
        <HomeTop lang={lang} />
        <SectionHead y={196} title={t('commute.home')} action={t('commute.all')} />
        <Box r={{ x: 16, y: 220, w: 268, h: 204 }} style={s.commuteCard} />
        <Box r={{ x: 28, y: 232, w: 244, h: 30 }} style={s.row}>
          <View style={s.commuteIcon}>
            <Feather name="repeat" size={13} color={colors.textOnLight} />
          </View>
          <View style={{ flex: 1 }}>
            <MText size={11.5} weight="bold" lines={1}>
              {t('commute.nameTo', { place: 'Greven' })}
            </MText>
            <MText size={8.5} weight="medium" color={colors.textMuted} lines={1}>
              {`${t('commute.days.weekdays')} · ${t('commute.departAt', { time: '09:55' })}`}
            </MText>
          </View>
          <View style={s.statePill}>
            <View style={s.stateDot} />
            <MText size={8.5} weight="bold" color={colors.lime}>
              {t('commute.state.watching')}
            </MText>
          </View>
        </Box>
        <Box r={{ x: 28, y: 268, w: 244, h: 12 }} style={s.row}>
          <Feather name="navigation" size={9} color={colors.textMuted} />
          <MText size={8.5} weight="medium" color={colors.textMuted}>
            Münster Hbf → Greven
          </MText>
        </Box>
        <Box r={R.plan} style={s.plan}>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <MText size={7.5} weight="bold" color={colors.textOnLightMuted} style={s.upper}>
                {t('commute.leaveAtLabel')}
              </MText>
              <MText size={24} weight="extrabold" color={colors.textOnLight} style={{ lineHeight: 28 }}>
                09:55
              </MText>
            </View>
            <View style={s.countdown}>
              <MText size={9} weight="bold" color={colors.lime}>
                {t('commute.leaveIn', { n: 14 })}
              </MText>
            </View>
          </View>
          <View style={s.row}>
            <LineBadgeM {...RB65} />
            <MText size={9} weight="bold" color={colors.textOnLight} lines={1}>
              {t('commute.firstLeg', { time: '09:55', stop: 'Münster Hbf' })}
            </MText>
          </View>
          <View style={s.row}>
            <View style={s.levelDot} />
            <MText size={8} weight="medium" color={colors.textOnLightMuted} lines={1}>
              {`${t('commute.status.calm')} · ${t('commute.arrival', { time: '10:08' })}`}
            </MText>
          </View>
        </Box>
        <MockButton r={{ x: 28, y: 388, w: 128, h: 24 }} text={t('commute.showJourney')} icon="git-commit" variant="light" size={8.5} />

        <SectionHead y={436} title={t('home.justReported')} action={t('map.onMap')} />
        <Box r={{ x: 16, y: 458, w: 268, h: 14 }} style={s.row}>
          <Feather name="map-pin" size={9} color={colors.textMuted} />
          <MText size={8} weight="medium" color={colors.textMuted}>
            {t('home.radius')}
          </MText>
        </Box>
        <MockCard
          r={{ x: 16, y: 478, w: 268, h: 66 }}
          mode="BUS"
          tone="active"
          tab={`${t('kind.CROWDED')} · ${t('time.minAgo', { n: 9 })}`}
          title="11 → Coerde"
          subtitle={t('seg.before', { b: 'Hansaplatz' })}
          menu="chevron-right"
        />
        <MockTabBar active="home" lang={lang} />

      </MockScreen>

      {/* --- 5. Erinnerung zum Losgehen (Push auf dem Sperrbildschirm) ---------------- */}
      <MockScreen show={step >= 5} from="fade">
        <Wallpaper id="commute-lock" />
        <Box r={{ x: 0, y: 0, w: 300, h: 600 }} style={{ backgroundColor: 'rgba(8,12,24,0.35)' }} />
        <MockStatusBar />
        <Box r={{ x: 140, y: 40, w: 20, h: 16 }} style={{ alignItems: 'center' }}>
          <Feather name="lock" size={12} color={colors.text} />
        </Box>
        <Box r={{ x: 16, y: 62, w: 268, h: 66 }}>
          <MText size={52} weight="bold" center style={{ lineHeight: 64 }}>
            9:41
          </MText>
        </Box>
        <Box r={{ x: 16, y: 130, w: 268, h: 16 }}>
          <MText size={11} weight="medium" center>
            {L('Montag, 9. November', 'Monday, 9 November')}
          </MText>
        </Box>
        <Appear show={step >= 5} from="down" distance={16} fill={false} style={s.lockPush}>
          <PushCard
            app={L('Catch · jetzt', 'Catch · now')}
            title={L('Nach Greven: Zeit loszugehen', 'To Greven: time to leave')}
            body={L('RB65 um 09:55 ab Münster Hbf', 'RB65 at 09:55 from Münster Hbf')}
          />
        </Appear>
        <Box r={{ x: 110, y: 586, w: 80, h: 4 }} style={s.handle} />
      </MockScreen>
    </View>
  );
}

function PlaceRow({ label, value, dot }: { label: string; value: string; dot: string }) {
  return (
    <View style={s.place}>
      <View style={[s.placeDot, { borderColor: dot }]} />
      <View style={{ flex: 1 }}>
        <MText size={7} weight="bold" color={colors.textMuted} style={s.upper}>
          {label}
        </MText>
        <MText size={10.5} weight="bold" lines={1}>
          {value}
        </MText>
      </View>
    </View>
  );
}

function SettingRow({ y, icon, title, text }: { y: number; icon: 'clock' | 'radio'; title: string; text: string }) {
  return (
    <>
      <Box r={{ x: 28, y, w: 206, h: 40 }} style={s.setting}>
        <View style={s.settingIcon}>
          <Feather name={icon} size={12} color={colors.lime} />
        </View>
        <View style={{ flex: 1 }}>
          <MText size={10} weight="bold" lines={1}>
            {title}
          </MText>
          <MText size={8} weight="medium" color={colors.textMuted}>
            {text}
          </MText>
        </View>
      </Box>
      <ToggleM r={{ x: 242, y: y + 11, w: 30, h: 18 }} on />
    </>
  );
}

const s = StyleSheet.create({
  scroll: { position: 'absolute', left: 0, top: -CLIP_TOP, width: 300, height: 1000 },
  upper: { letterSpacing: 0.6, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.surfaceDeep, borderRadius: 15, paddingHorizontal: 11 },
  fields: { backgroundColor: colors.surfaceDeep, borderRadius: 16, paddingHorizontal: 11 },
  place: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 37.5, paddingRight: 40 },
  placeDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
  fieldDivider: { height: 1, backgroundColor: colors.border, marginLeft: 17, marginRight: 40 },
  swap: { borderRadius: 15, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  day: { borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: colors.lime, borderColor: colors.lime },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceDeep, borderRadius: 15, paddingHorizontal: 3 },
  stepBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: 18 },
  divider: { backgroundColor: colors.border },
  setting: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  settingIcon: { width: 28, height: 28, borderRadius: 10, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  commuteCard: { backgroundColor: colors.surface, borderRadius: 18 },
  commuteIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  statePill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.lime, borderRadius: 10, paddingHorizontal: 7, height: 19 },
  stateDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.cyan },
  plan: { backgroundColor: colors.lime, borderRadius: 14, padding: 10, gap: 4 },
  countdown: { backgroundColor: colors.textOnLight, borderRadius: 11, paddingHorizontal: 9, height: 22, justifyContent: 'center' },
  levelDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textOnLight, borderWidth: 1, borderColor: 'rgba(20,32,58,0.35)' },
  lockPush: { position: 'absolute', left: 14, right: 14, top: 176 },
  handle: { borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.7)' },
});

export const commuteTutorial: Tutorial = {
  id: 'commute',
  icon: 'repeat',
  category: 'plan',
  question: {
    de: 'Kann ich meine tägliche Strecke speichern und erinnert werden, wann ich los muss?',
    en: 'Can I save my daily route and get reminded when to leave?',
  },
  answer: {
    de: 'Ja. Öffne die Verbindung und tippe auf „Als Pendelstrecke“ – Start, Ziel und Uhrzeit sind schon eingetragen. Wähle die Tage und unter „Erinnerung zum Losgehen“, wie früh Catch dich erinnert, dann tippe auf „Strecke speichern“. Catch beobachtet die Strecke ab jetzt automatisch, zeigt dir auf „Start“, wann du los musst, und warnt dich bei Hinweisen auf deinen Linien.',
    en: 'Yes. Open the connection and tap “Save as commute” – start, destination and time are already filled in. Choose the days and, under “Time-to-leave reminder”, how early Catch should remind you, then tap “Save commute”. From then on Catch watches the route automatically, shows you on Home when to leave and warns you about tips on your lines.',
  },
  where: {
    de: 'Verbindung → Als Pendelstrecke (oder Profil → Meine Pendelstrecken)',
    en: 'Connection → Save as commute (or Profile → My commutes)',
  },
  tryIt: '/commutes',
  steps: [
    {
      caption: { de: 'Öffne deine Verbindung und tippe auf „Als Pendelstrecke“.', en: 'Open your connection and tap “Save as commute”.' },
      target: center(R.commuteBtn, 20),
      read: 2000,
    },
    {
      caption: {
        de: 'Start, Ziel und Uhrzeit übernimmt Catch aus der Verbindung. Wähle die Tage – hier Mo–Fr.',
        en: 'Catch takes start, destination and time from the connection. Choose the days – here Mon–Fri.',
      },
      target: center(R.days, 20, 4),
      tap: false,
      read: 3000,
    },
    {
      caption: {
        de: 'Unter „Erinnerung zum Losgehen“ wählst du, wie früh Catch dich erinnert – z. B. 15 Min. vorher.',
        en: 'Under “Time-to-leave reminder” choose how early Catch reminds you – e.g. 15 min before.',
      },
      target: center({ ...remind15, y: remind15.y - SCROLL }, 16),
      read: 2800,
    },
    {
      caption: { de: 'Tippe auf „Strecke speichern“.', en: 'Tap “Save commute”.' },
      target: center(R.save, 80),
      read: 1600,
    },
    {
      caption: {
        de: 'Gespeichert! Auf „Start“ siehst du jetzt, wann du los musst – berechnet mit Live-Daten.',
        en: 'Saved! Home now shows when you need to leave – based on live data.',
      },
      target: center(R.plan, 40, -16),
      tap: false,
      read: 3000,
    },
    {
      caption: {
        de: 'Und 15 Min. vorher kommt eine Push, dass du los musst. Bei Meldungen auf deinen Linien warnt dich Catch auch.',
        en: 'And 15 min before, a push tells you it’s time to leave. Catch also warns you about reports on your lines.',
      },
    },
  ],
  Scene: CommuteScene,
};
