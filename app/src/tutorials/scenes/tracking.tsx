// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Tutorial "Live-Tracking": Verbindung öffnen → "Alarm bei" wählen → "Live-Tracking für diese
 * Verbindung" → Live-Tab zeigt das Tracking → Popup, sobald jemand auf der Linie etwas meldet.
 * Vorbilder: app/journey.tsx, app/(tabs)/live.tsx, components/AlertOverlay.tsx.
 */
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import type { ReportKind } from '@/api/contract';
import { GhostLogo } from '@/components/GhostLogo';
import type { TKey } from '@/i18n';
import { KIND_COLOR, KIND_ICON } from '@/lib/kinds';
import { colors } from '@/theme';
import { Appear, Box, center, MockCard, MockScreen, MockStatusBar, MockTabBar, MockToast, MText, Pulse, type Rect } from '../mock';
import type { SceneProps, Tutorial } from '../types';
import { CurvedTop, J, J_KINDS, JourneyScreen, KIND_ORDER, KindBadgeM, LineBadgeM, MNotice, pick, RB65, SectionHead, tr } from './alertsKit';

// Layout (Mock-Telefon 300 × 600)
const R = {
  result1: { x: 16, y: 166, w: 268, h: 64 },
  result2: { x: 16, y: 240, w: 268, h: 64 },
  kindOff: J_KINDS[4],
  track: J.track,
  newBtn: { x: 16, y: 96, w: 268, h: 32 },
  trackCard: { x: 16, y: 252, w: 268, h: 108 },
  alertRow: { x: 16, y: 394, w: 268, h: 44 },
  popup: { x: 18, y: 132, w: 264, h: 300 },
} satisfies Record<string, Rect>;
/** Diese Art tippt der Finger weg */
const OFF: ReportKind = 'CHECK';

function TrackingScene({ step, lang }: SceneProps) {
  const t = tr(lang);
  const L = pick(lang);
  const off = step >= 2 ? [OFF] : [];
  const alerted = step >= 4;
  // Im Live-Tab ist die weggetippte Art schon abgewählt
  const kinds = KIND_ORDER.filter((k) => k !== OFF);
  const segment = t('seg.between', { a: 'Münster-Sprakel', b: 'Greven' });

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* --- 0. Suchergebnisse --------------------------------------------------- */}
      <MockStatusBar />
      <Box r={{ x: 16, y: 30, w: 268, h: 26 }}>
        <MText size={17} weight="extrabold">
          {t('search.titleJourneys')}
        </MText>
      </Box>
      <Box r={{ x: 16, y: 62, w: 268, h: 88 }} style={s.route}>
        <View style={s.routeRow}>
          <View style={[s.routeDot, { borderColor: colors.lime }]} />
          <View>
            <MText size={7} color={colors.textMuted} weight="bold" style={s.upper}>
              {t('search.from')}
            </MText>
            <MText size={10.5}>Münster Hbf</MText>
          </View>
        </View>
        <View style={s.routeLine} />
        <View style={s.routeRow}>
          <View style={[s.routeDot, { borderColor: colors.orange }]} />
          <View>
            <MText size={7} color={colors.textMuted} weight="bold" style={s.upper}>
              {t('search.to')}
            </MText>
            <MText size={10.5}>Greven</MText>
          </View>
        </View>
      </Box>
      <ResultCard r={R.result1} dep="09:55" arr="10:08" dur={t('time.min', { n: 13 })} direct={t('journey.direct')} />
      <ResultCard r={R.result2} dep="10:55" arr="11:08" dur={t('time.min', { n: 13 })} direct={t('journey.direct')} />
      <Pulse r={R.result1} active={step === 0} radius={16} />
      <MockTabBar active="search" lang={lang} />

      {/* --- 1.–2. Verbindung: Alarm bei + Live-Tracking ------------------------------ */}
      <MockScreen show={step >= 1}>
        <JourneyScreen lang={lang} off={off} />
        <Pulse r={R.kindOff} active={step === 1} radius={11} />
        <Pulse r={R.track} active={step === 2} radius={17} color={colors.lime} />
      </MockScreen>

      {/* --- 3.–4. Live-Tab -------------------------------------------------------- */}
      <MockScreen show={step >= 3} from="fade">
        <CurvedTop bottom={138} />
        <MockStatusBar />
        <Box r={{ x: 16, y: 29, w: 160, h: 26 }}>
          <MText size={17} weight="extrabold" lines={1}>
            {t('common.liveTracking')}
          </MText>
        </Box>
        <Box r={{ x: 172, y: 31, w: 80, h: 22 }} style={s.conn}>
          <View style={s.connDot} />
          <MText size={8.5} weight="bold" color={colors.cyan} lines={1}>
            {t('live.connected')}
          </MText>
        </Box>
        <Box r={{ x: 258, y: 29, w: 26, h: 26 }} style={s.round}>
          <Feather name="map" size={11} color={colors.text} />
        </Box>
        <Box r={{ x: 16, y: 60, w: 268, h: 30 }}>
          <MText size={8.5} weight="medium" color={colors.textMuted}>
            {t('live.intro')}
          </MText>
        </Box>
        <Box r={R.newBtn} style={s.cyanBtn}>
          <Feather name="plus" size={11} color={colors.textOnLight} />
          <MText size={10} weight="bold" color={colors.textOnLight}>
            {t('live.new')}
          </MText>
        </Box>

        <SectionHead y={160} title={t('commute.section')} />
        <Box r={{ x: 16, y: 182, w: 268, h: 36 }} style={s.setup}>
          <View style={s.setupIcon}>
            <Feather name="repeat" size={11} color={colors.textOnLight} />
          </View>
          <MText size={10} weight="bold" style={{ flex: 1 }} lines={1}>
            {t('commute.ctaTitle')}
          </MText>
          <Feather name="plus" size={13} color={colors.lime} />
        </Box>

        <SectionHead y={230} title={t('live.activeSection')} />
        <MockCard
          r={R.trackCard}
          mode="REGIONAL"
          tone={alerted ? 'active' : 'live'}
          tab={alerted ? t('alert.reported') : t('tracking.liveActive')}
          title="RB65 → Rheine"
          subtitle={`Münster Hbf → Greven\n${t('time.range', { from: '09:25', to: '10:13' })}`}
          menu="trash-2"
        />
        {/* "Alarm bei: …" – nur die gewählten Arten */}
        <Box r={{ x: 64, y: R.trackCard.y + 76, w: 210, h: 24 }} style={s.kindsRow}>
          {kinds.map((k) => (
            <MaterialCommunityIcons key={k} name={KIND_ICON[k]} size={10} color={colors.text} />
          ))}
          <MText size={7.5} weight="medium" color="rgba(255,255,255,0.86)" lines={2} style={{ flex: 1 }}>
            {t('tracking.onlyKinds', { kinds: kinds.map((k) => t(`kind.${k}` as TKey)).join(', ') })}
          </MText>
        </Box>

        <SectionHead y={372} title={t('live.recentAlerts')} />
        {alerted ? (
          <Box r={R.alertRow} style={s.alertRow}>
            <LineBadgeM {...RB65} />
            <View style={{ flex: 1 }}>
              <MText size={9.5} weight="bold" lines={1}>
                {segment}
              </MText>
              <View style={s.alertMeta}>
                <MaterialCommunityIcons name={KIND_ICON.DELAY} size={9} color={KIND_COLOR.DELAY} />
                <MText size={7.5} weight="medium" color={colors.textMuted} lines={1} style={{ flex: 1 }}>
                  <MText size={7.5} weight="bold" color={KIND_COLOR.DELAY}>
                    {t('kind.DELAY')}
                  </MText>
                  {` · ${t('time.justNow')}${t('live.onYourSection')}`}
                </MText>
              </View>
            </View>
            <View style={s.hot} />
          </Box>
        ) : (
          <Box r={{ x: 16, y: 394, w: 268, h: 14 }}>
            <MText size={8.5} weight="medium" color={colors.textMuted}>
              {t('live.noAlerts')}
            </MText>
          </Box>
        )}
        <MNotice r={{ x: 16, y: 450, w: 268, h: 30 }} icon="bell" text={t('live.tip')} />
        <MockTabBar active="live" lang={lang} />
        <MockToast show={step === 3} text={t('journey.trackingStarted')} />
      </MockScreen>

      {/* --- 4. Live-Alarm (AlertOverlay) ------------------------------------------- */}
      <Appear show={alerted}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} />
      </Appear>
      <Appear show={alerted} from="scale" fill={false} style={{ position: 'absolute', left: R.popup.x, top: R.popup.y, width: R.popup.w }}>
        <View style={s.popup}>
          <View style={s.popTop}>
            <View style={s.ghostWrap}>
              <GhostLogo size={24} color={colors.cream} fill={colors.textOnLight} />
            </View>
            <View style={{ flex: 1 }}>
              <MText size={7.5} weight="bold" color={colors.textOnLight} style={s.upper}>
                {t('alert.liveAlarm')}
              </MText>
              <MText size={14.5} weight="extrabold" color={colors.textOnLight} style={{ lineHeight: 18 }}>
                {L('Verspätung auf deinem Abschnitt – RB65', 'Delay on your section – RB65')}
              </MText>
            </View>
            <Feather name="x" size={14} color={colors.textOnLight} style={{ alignSelf: 'flex-start' }} />
          </View>
          <View style={s.popLine}>
            <LineBadgeM {...RB65} big />
            <MText size={10.5} weight="bold" color={colors.textOnLight}>
              → Rheine
            </MText>
          </View>
          <View style={s.info}>
            <KindBadgeM kind="DELAY" lang={lang} border />
            <MText size={11} weight="bold" color={colors.textOnLight} style={{ marginTop: 3 }}>
              {segment}
            </MText>
            <MText size={8.5} weight="medium" color={colors.textOnLightMuted}>
              {`${t('time.justNow')} · ${t('tag.DELAY_5_TO_15')}`}
            </MText>
          </View>
          <View style={s.actions}>
            <View style={[s.action, { backgroundColor: colors.textOnLight }]}>
              <MText size={9.5} weight="bold">
                {t('alert.view')}
              </MText>
            </View>
            <View style={[s.action, { borderWidth: 1, borderColor: colors.textOnLight }]}>
              <MText size={9.5} weight="bold">
                {t('common.ok')}
              </MText>
            </View>
          </View>
        </View>
      </Appear>
    </View>
  );
}

function ResultCard({ r, dep, arr, dur, direct }: { r: Rect; dep: string; arr: string; dur: string; direct: string }) {
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <LineBadgeM {...RB65} />
        <MText size={8.5} color={colors.textMuted}>
          {direct}
        </MText>
      </View>
    </Box>
  );
}

const s = StyleSheet.create({
  upper: { letterSpacing: 0.6, textTransform: 'uppercase' },
  route: { backgroundColor: colors.surfaceDeep, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'space-between' },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
  routeLine: { height: 1, backgroundColor: colors.border, marginLeft: 17 },
  result: { backgroundColor: colors.surface, borderRadius: 16, padding: 12 },
  conn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderColor: colors.cyan, borderRadius: 11 },
  connDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.cyan },
  round: { borderRadius: 13, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  cyanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: colors.cyan, borderRadius: 16 },
  setup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(199,232,165,0.28)',
  },
  setupIcon: { width: 24, height: 24, borderRadius: 8, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  kindsRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderRadius: 13, paddingHorizontal: 8 },
  alertMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  hot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.orange },
  popup: { backgroundColor: colors.orange, borderRadius: 20, padding: 14, gap: 10 },
  popTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  ghostWrap: { width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(20,32,58,0.12)', alignItems: 'center', justifyContent: 'center' },
  popLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  info: { backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 12, padding: 9, gap: 2 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});

export const trackingTutorial: Tutorial = {
  id: 'tracking',
  icon: 'radio',
  category: 'report',
  question: {
    de: 'Kann ich gewarnt werden, wenn auf meiner Strecke etwas passiert?',
    en: 'Can I get an alert when something happens on my route?',
  },
  answer: {
    de: 'Ja, mit Live-Tracking. Öffne deine Verbindung, wähle unter „Alarm bei“, worüber du gewarnt werden willst, und tippe auf „Live-Tracking für diese Verbindung“. Sobald jemand auf deinen Linien etwas meldet, bekommst du sofort ein Popup mit Ton – mit Push auch, wenn die App zu ist. Deine Trackings findest du im Tab „Live“, dafür brauchst du ein Konto.',
    en: 'Yes, with live tracking. Open your connection, choose under “Alert me about” what you want to be warned about, and tap “Live tracking for this connection”. As soon as someone reports something on your lines, you get a popup with sound – with push even when the app is closed. Your trackings are in the Live tab; you need an account for this.',
  },
  where: {
    de: 'Suche → Verbindung → Live-Tracking für diese Verbindung',
    en: 'Search → connection → Live tracking for this connection',
  },
  tryIt: '/search',
  steps: [
    {
      caption: { de: 'Such deine Verbindung und öffne sie.', en: 'Search for your connection and open it.' },
      target: center(R.result1),
      read: 1800,
    },
    {
      caption: {
        de: 'Unter „Alarm bei“ wählst du, worüber du gewarnt wirst. Tippe weg, was dich nicht interessiert.',
        en: 'Under “Alert me about” you choose what to be warned about. Tap off what you don’t need.',
      },
      target: center(R.kindOff, -30),
      read: 2800,
    },
    {
      caption: { de: 'Tippe auf „Live-Tracking für diese Verbindung“.', en: 'Tap “Live tracking for this connection”.' },
      target: center(R.track, 100),
      read: 1800,
    },
    {
      caption: {
        de: 'Im Tab „Live“ siehst du dein Tracking. Catch beobachtet jetzt deine Strecke – auch wenn die App zu ist.',
        en: 'The Live tab shows your tracking. Catch now watches your route – even when the app is closed.',
      },
      target: center(R.trackCard, 30, -10),
      tap: false,
      read: 3000,
    },
    {
      caption: {
        de: 'Meldet jemand etwas auf deiner Strecke, kommt sofort ein Alarm mit Ton – auch als Push.',
        en: 'When someone reports something on your route, an alert with sound pops up right away – also as a push.',
      },
    },
  ],
  Scene: TrackingScene,
};
