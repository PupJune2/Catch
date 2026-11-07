// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Bausteine für die Tutorial-Animationen: ein verkleinertes "Mock-Telefon" (300 × 600 Punkte)
 * mit vereinfachten Nachbauten der echten Catch-Oberfläche.
 *
 * Alles ist absolut positioniert (Rect), damit der Finger im Player genau weiß, wohin er tippt.
 * Animationen starten immer im Endzustand des aktuellen Schritts (kein Aufblitzen nach einem
 * Neuladen der Seite) und werden beim Verlassen sauber gestoppt.
 */
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { createContext, useContext, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import type { Mode } from '@/api/contract';
import { colors, fonts, levelStyle, modeColor, modeSurface } from '@/theme';

export const PHONE = { w: 300, h: 600 } as const;
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const center = (r: Rect, dx = 0, dy = 0) => ({ x: r.x + r.w / 2 + dx, y: r.y + r.h / 2 + dy });
export const shift = (r: Rect, dy: number): Rect => ({ ...r, y: r.y + dy });

/** Web kennt keinen nativen Animations-Treiber. */
export const nativeDriver = Platform.OS !== 'web';

/** "Bewegung reduzieren" (Systemeinstellung) – vom Player gesetzt. */
export const MotionContext = createContext({ reduceMotion: false });
export const useReduceMotion = () => useContext(MotionContext).reduceMotion;

type FeatherName = ComponentProps<typeof Feather>['name'];
type Weight = 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold';

// ---------------------------------------------------------------------------
// Grundlagen
// ---------------------------------------------------------------------------

export function MText({
  children,
  size = 11,
  weight = 'semibold',
  color = colors.text,
  lines,
  style,
  center: centered,
}: {
  children: ReactNode;
  size?: number;
  weight?: Weight;
  color?: string;
  lines?: number;
  style?: StyleProp<TextStyle>;
  center?: boolean;
}) {
  return (
    <Text
      numberOfLines={lines}
      style={[{ fontFamily: fonts[weight], fontSize: size, lineHeight: Math.round(size * 1.3), color }, centered && { textAlign: 'center' }, style]}>
      {children}
    </Text>
  );
}

/** Absolut positionierte Fläche. */
export function Box({ r, style, children }: { r: Rect; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  return <View style={[{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h }, style]}>{children}</View>;
}

/** Zahl, die sanft zu einem neuen Wert gleitet (beim ersten Rendern sofort am Ziel). */
export function useGlide(target: number, duration = 380) {
  const [v] = useState(() => new Animated.Value(target));
  const reduce = useReduceMotion();
  useEffect(() => {
    if (reduce) {
      v.setValue(target);
      return;
    }
    const a = Animated.timing(v, { toValue: target, duration, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver });
    a.start();
    return () => a.stop();
  }, [target, duration, reduce, v]);
  return v;
}

/**
 * Ein-/Ausblenden mit Bewegung. `from` = Richtung, aus der es kommt.
 * Startet im aktuellen Zustand → nach einem Neuladen mitten im Tutorial steht alles richtig da.
 */
export function Appear({
  show,
  from = 'fade',
  distance = 24,
  duration = 340,
  fill = true,
  style,
  children,
}: {
  show: boolean;
  from?: 'fade' | 'up' | 'down' | 'right' | 'left' | 'scale';
  distance?: number;
  duration?: number;
  /** true = ganze Fläche (absoluteFill), false = Position kommt aus `style` */
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const v = useGlide(show ? 1 : 0, duration);
  const off = v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] });
  const transform =
    from === 'up'
      ? [{ translateY: off }]
      : from === 'down'
        ? [{ translateY: Animated.multiply(off, -1) }]
        : from === 'right'
          ? [{ translateX: off }]
          : from === 'left'
            ? [{ translateX: Animated.multiply(off, -1) }]
            : from === 'scale'
              ? [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }]
              : [];
  return (
    <Animated.View pointerEvents="none" style={[fill && StyleSheet.absoluteFill, style, { opacity: v, transform }]}>
      {children}
    </Animated.View>
  );
}

/** Pulsierender Ring um ein Element ("hier tippen"). */
export function Pulse({ r, active, color = colors.lime, radius = 14 }: { r: Rect; active: boolean; color?: string; radius?: number }) {
  const reduce = useReduceMotion();
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!active || reduce) {
      v.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver }),
        Animated.delay(250),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduce, v]);
  if (!active) return null;
  const pad = 4;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: r.x - pad,
        top: r.y - pad,
        width: r.w + pad * 2,
        height: r.h + pad * 2,
        borderRadius: radius + pad,
        borderWidth: 2,
        borderColor: color,
        opacity: reduce ? 1 : v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }),
        transform: reduce ? [] : [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
      }}
    />
  );
}

/** Text, der Buchstabe für Buchstabe getippt wird, solange `active`. Danach (`done`) vollständig. */
export function Typing({
  text,
  active,
  done,
  speed = 75,
  size = 11,
  color = colors.text,
  placeholder,
}: {
  text: string;
  active: boolean;
  done: boolean;
  speed?: number;
  size?: number;
  color?: string;
  placeholder?: string;
}) {
  const reduce = useReduceMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active || reduce) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => {
      clearInterval(id);
      setN(0);
    };
  }, [active, reduce, text, speed]);
  const shown = done || (active && reduce) ? text : active ? text.slice(0, n) : '';
  if (!shown && placeholder) return <MText size={size} color={colors.textFaint}>{placeholder}</MText>;
  return (
    <MText size={size} color={color}>
      {shown}
      {active && !done && !reduce ? <MText size={size} color={colors.lime}>|</MText> : null}
    </MText>
  );
}

// ---------------------------------------------------------------------------
// Catch-Oberfläche im Kleinen
// ---------------------------------------------------------------------------

export function MockStatusBar() {
  return (
    <Box r={{ x: 0, y: 0, w: PHONE.w, h: 22 }} style={styles.statusBar}>
      <MText size={9.5} weight="bold">
        9:41
      </MText>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <Feather name="wifi" size={10} color={colors.text} />
        <Feather name="battery" size={11} color={colors.text} />
      </View>
    </Box>
  );
}

export type TabId = 'home' | 'search' | 'report' | 'live' | 'profile';
const TAB_Y = 548;
const TAB_ORDER: TabId[] = ['home', 'search', 'report', 'live', 'profile'];
const TAB_ICONS: Record<TabId, FeatherName> = { home: 'home', search: 'search', report: 'plus', live: 'radio', profile: 'user' };
const TAB_LABELS: Record<TabId, { en: string; de: string }> = {
  home: { en: 'Home', de: 'Start' },
  search: { en: 'Search', de: 'Suche' },
  report: { en: 'Report', de: 'Melden' },
  live: { en: 'Live', de: 'Live' },
  profile: { en: 'Profile', de: 'Profil' },
};
/** Mittelpunkte der Tabs (für den Finger). */
export const TAB: Record<TabId, { x: number; y: number }> = Object.fromEntries(
  TAB_ORDER.map((id, i) => [id, { x: 12 + (276 / 5) * (i + 0.5), y: id === 'report' ? TAB_Y - 2 : TAB_Y + 20 }]),
) as Record<TabId, { x: number; y: number }>;

export function MockTabBar({ active, lang }: { active?: TabId; lang: 'en' | 'de' }) {
  return (
    <Box r={{ x: 12, y: TAB_Y, w: 276, h: 44 }} style={styles.tabBar}>
      {TAB_ORDER.map((id) =>
        id === 'report' ? (
          <View key={id} style={styles.tab}>
            <View style={styles.reportBtn}>
              <Feather name="plus" size={18} color={colors.textOnLight} />
            </View>
            <MText size={7.5} weight="semibold" style={{ marginTop: 1 }}>
              {TAB_LABELS[id][lang]}
            </MText>
          </View>
        ) : (
          <View key={id} style={styles.tab}>
            <View style={[styles.tabIcon, active === id && { backgroundColor: colors.lime }]}>
              <Feather name={TAB_ICONS[id]} size={13} color={active === id ? colors.textOnLight : colors.textMuted} />
            </View>
            <MText size={7.5} color={active === id ? colors.text : colors.textMuted}>
              {TAB_LABELS[id][lang]}
            </MText>
          </View>
        ),
      )}
    </Box>
  );
}

/** Kopfzeile eines Unterbildschirms mit Zurück-Pfeil. */
export function MockStackHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Box r={{ x: 0, y: 24, w: PHONE.w, h: 34 }} style={{ alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', left: 14, top: 9 }}>
        <Feather name="arrow-left" size={15} color={colors.text} />
      </View>
      <MText size={11.5} weight="bold">
        {title}
      </MText>
      {subtitle ? (
        <MText size={8.5} color={colors.textMuted} weight="medium">
          {subtitle}
        </MText>
      ) : null}
    </Box>
  );
}

export type ButtonVariant = 'lime' | 'light' | 'cyan' | 'orange' | 'dark';
const BTN: Record<ButtonVariant, { bg: string; fg: string }> = {
  lime: { bg: colors.lime, fg: colors.textOnLight },
  light: { bg: colors.surfaceAlt, fg: colors.text },
  cyan: { bg: colors.cyan, fg: colors.textOnLight },
  orange: { bg: colors.orange, fg: colors.textOnLight },
  dark: { bg: colors.surfaceDeep, fg: colors.text },
};

export function MockButton({ r, text, icon, variant = 'lime', size = 10 }: { r: Rect; text: string; icon?: FeatherName; variant?: ButtonVariant; size?: number }) {
  const c = BTN[variant];
  return (
    <Box r={r} style={[styles.button, { backgroundColor: c.bg, borderRadius: r.h / 2 }]}>
      {icon ? <Feather name={icon} size={size + 1} color={c.fg} /> : null}
      <MText size={size} weight="bold" color={c.fg} lines={1}>
        {text}
      </MText>
    </Box>
  );
}

export function MockChip({ text, selected, icon, color = colors.lime }: { text: string; selected?: boolean; icon?: FeatherName; color?: string }) {
  return (
    <View style={[styles.chip, selected ? { backgroundColor: color, borderColor: color } : null]}>
      {icon ? <Feather name={icon} size={9} color={selected ? colors.textOnLight : colors.text} /> : null}
      <MText size={8.5} weight="bold" color={selected ? colors.textOnLight : colors.text}>
        {text}
      </MText>
    </View>
  );
}

/** Linien-Pill [RE42] in Linienfarbe. */
export function MockLine({ name, mode, color }: { name: string; mode: Mode; color?: string }) {
  return (
    <View style={[styles.line, { backgroundColor: color ?? modeColor[mode] }]}>
      <MText size={8.5} weight="extrabold" color="#FFFFFF">
        {name}
      </MText>
    </View>
  );
}

const MODE_ICON: Record<Mode, ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  BUS: 'bus',
  TRAM: 'tram',
  SUBWAY: 'subway-variant',
  SUBURBAN: 'train',
  REGIONAL: 'train',
  LONG_DISTANCE: 'train-variant',
  FERRY: 'ferry',
  OTHER: 'map-marker',
};

export type CardTone = 'calm' | 'frequent' | 'active' | 'live';
const TONE_COLOR: Record<CardTone, string> = { calm: colors.lime, frequent: colors.lilac, active: colors.orange, live: colors.cyan };

/**
 * Status-Karte wie in der App: Reiter mit Status oben links, Körper in Fahrzeugfarbe.
 * `r.h` ist die Gesamthöhe inkl. Reiter (22).
 */
export function MockCard({
  r,
  mode,
  tone = 'calm',
  tab,
  title,
  subtitle,
  menu,
  tags,
  footer,
}: {
  r: Rect;
  mode: Mode;
  tone?: CardTone;
  tab?: string;
  title: string;
  subtitle?: string;
  menu?: FeatherName;
  tags?: { text: string; changed?: boolean }[];
  footer?: string;
}) {
  const body = modeSurface[mode];
  return (
    <Box r={r}>
      <View style={[styles.cardTab, { backgroundColor: body }]}>
        <View style={[styles.cardTabPill, { backgroundColor: TONE_COLOR[tone] }]}>
          <MText size={8} weight="bold" color={colors.textOnLight}>
            {tab ?? levelStyle[tone === 'live' ? 'calm' : tone].label}
          </MText>
        </View>
      </View>
      <View style={[styles.cardBody, { backgroundColor: body, height: r.h - 22 }]}>
        <View style={styles.cardRow}>
          <View style={styles.diamond}>
            <View style={{ transform: [{ rotate: '-45deg' }] }}>
              <MaterialCommunityIcons name={MODE_ICON[mode]} size={13} color={colors.text} />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <MText size={11} weight="bold" lines={1}>
              {title}
            </MText>
            {subtitle ? (
              <MText size={8.5} weight="medium" color="rgba(255,255,255,0.86)" lines={2}>
                {subtitle}
              </MText>
            ) : null}
          </View>
          {menu ? <Feather name={menu} size={13} color={colors.text} /> : null}
        </View>
        {tags?.length ? (
          <View style={styles.tags}>
            {tags.map((t) => (
              <View key={t.text} style={[styles.tag, t.changed && { backgroundColor: colors.orange }]}>
                <MText size={7.5} weight="bold" color={t.changed ? colors.textOnLight : colors.text}>
                  {t.text}
                </MText>
              </View>
            ))}
          </View>
        ) : null}
        {footer ? (
          <MText size={8.5} weight="bold" style={{ marginTop: 3 }}>
            {footer}
          </MText>
        ) : null}
      </View>
    </Box>
  );
}

export type PillTone = 'ok' | 'tight' | 'missed' | 'info';
const PILL: Record<PillTone, { fg: string; bg: string; icon: FeatherName }> = {
  ok: { fg: colors.textMuted, bg: colors.surface, icon: 'shuffle' },
  tight: { fg: colors.orange, bg: 'rgba(255,122,26,0.16)', icon: 'alert-triangle' },
  missed: { fg: colors.danger, bg: 'rgba(255,107,91,0.16)', icon: 'alert-triangle' },
  info: { fg: colors.cyan, bg: 'rgba(46,200,230,0.14)', icon: 'info' },
};

export function MockPill({ r, text, tone = 'ok', icon, trailing }: { r: Rect; text: string; tone?: PillTone; icon?: FeatherName; trailing?: FeatherName }) {
  const c = PILL[tone];
  return (
    <Box r={r} style={[styles.pill, { backgroundColor: c.bg, borderRadius: r.h / 2 }]}>
      <Feather name={icon ?? c.icon} size={10} color={c.fg} />
      <MText size={8.5} weight="bold" color={c.fg} lines={1} style={{ flexShrink: 1 }}>
        {text}
      </MText>
      {trailing ? <Feather name={trailing} size={9} color={c.fg} /> : null}
    </Box>
  );
}

/** Untere Sheet-Ebene mit abgedunkeltem Hintergrund. */
export function MockSheet({ show, top, children }: { show: boolean; top: number; children: ReactNode }) {
  const v = useGlide(show ? 1 : 0, 380);
  return (
    <>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay, opacity: v }]} />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.sheet,
          { top, height: PHONE.h - top },
          { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [PHONE.h - top + 20, 0] }) }] },
        ]}>
        <View style={styles.sheetHandle} />
        {children}
      </Animated.View>
    </>
  );
}

/** Kurze Bestätigung oben ("Verbindung angepasst"). */
export function MockToast({ show, text, tone = 'success' }: { show: boolean; text: string; tone?: 'success' | 'info' | 'error' }) {
  const bg = tone === 'success' ? colors.lime : tone === 'error' ? colors.danger : colors.cyan;
  return (
    <Appear show={show} from="down" fill={false} style={{ position: 'absolute', top: 28, left: 20, right: 20, height: 34 }}>
      <View style={[styles.toast, { backgroundColor: bg }]}>
        <Feather name={tone === 'error' ? 'alert-circle' : 'check-circle'} size={12} color={colors.textOnLight} />
        <MText size={9.5} weight="bold" color={colors.textOnLight} lines={2} style={{ flexShrink: 1 }}>
          {text}
        </MText>
      </View>
    </Appear>
  );
}

/** Ganzer Bildschirm, der wie beim Navigieren von rechts hereinschiebt. */
export function MockScreen({ show, children, from = 'right' }: { show: boolean; children: ReactNode; from?: 'right' | 'up' | 'fade' }) {
  return (
    <Appear show={show} from={from} distance={from === 'right' ? PHONE.w : 60} duration={420} style={{ backgroundColor: colors.bg }}>
      {children}
    </Appear>
  );
}

const styles = StyleSheet.create({
  statusBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.surfaceDeep,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    paddingBottom: 5,
  },
  tab: { flex: 1, alignItems: 'center', gap: 1 },
  tabIcon: { width: 30, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  reportBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginTop: -20,
    backgroundColor: colors.orange,
    borderWidth: 3,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  line: { height: 16, paddingHorizontal: 5, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  cardTab: { alignSelf: 'flex-start', height: 22, borderTopLeftRadius: 14, borderTopRightRadius: 14, paddingHorizontal: 5, paddingTop: 4 },
  cardTabPill: { borderRadius: 8, paddingHorizontal: 7, height: 15, justifyContent: 'center' },
  cardBody: { borderRadius: 16, borderTopLeftRadius: 0, paddingHorizontal: 10, paddingVertical: 9 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  tag: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 6, paddingHorizontal: 5, height: 15, justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: colors.raised,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  sheetHandle: { width: 34, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center', marginBottom: 8 },
  toast: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 10,
  },
});
