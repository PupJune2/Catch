// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Spielt ein Tutorial ab: Mock-Telefon mit Szene, Finger, Bildunterschrift und Steuerung.
 *
 * Ablauf je Schritt: Finger gleitet zum Ziel → Lesezeit → Tippen (Ripple) → nächster Schritt.
 * - Der Schritt steht in der URL (?step=3): Neuladen der Seite macht genau dort weiter.
 * - Alle Animationen und Timer werden beim Schrittwechsel/Verlassen gestoppt.
 * - "Bewegung reduzieren" (System): kein Autoplay, Finger springt, Weiter per Knopf.
 */
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { useI18n } from '@/i18n';
import { markTutorialSeen } from '@/lib/tutorialSeen';
import { colors, radius, spacing } from '@/theme';
import { MotionContext, nativeDriver, PHONE } from './mock';
import type { Tutorial } from './types';

const DEFAULT_READ = 2200;
const FINGER = 26;

function useReduceMotionSetting(): boolean | null {
  const [reduce, setReduce] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduce(v))
      .catch(() => alive && setReduce(false));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduce(v));
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

export function TutorialPlayer({ tutorial, initialStep, onStep }: { tutorial: Tutorial; initialStep: number; onStep: (step: number) => void }) {
  const { lang, t } = useI18n();
  const { width, height } = useWindowDimensions();
  const reduceSetting = useReduceMotionSetting();
  const reduce = reduceSetting === true;
  const last = tutorial.steps.length - 1;
  const [step, setStep] = useState(() => Math.max(0, Math.min(last, initialStep)));
  // Autoplay erst, wenn bekannt ist, ob Bewegung reduziert werden soll
  const [playing, setPlaying] = useState(true);
  const autoplay = playing && reduceSetting === false;
  const s = tutorial.steps[step];
  const Scene = tutorial.Scene;

  // Finger
  const start = { x: PHONE.w * 0.62, y: PHONE.h * 0.78 };
  const [pos] = useState(() => new Animated.ValueXY(s.target ?? start));
  const [opacity] = useState(() => new Animated.Value(s.target ? 1 : 0));
  const [press] = useState(() => new Animated.Value(1));
  const [ripple] = useState(() => new Animated.Value(0));

  const goto = useCallback(
    (next: number) => {
      const n = Math.max(0, Math.min(last, next));
      setStep(n);
      onStep(n);
    },
    [last, onStep],
  );

  useEffect(() => {
    if (step === last) markTutorialSeen(tutorial.id);
  }, [step, last, tutorial.id]);

  useEffect(() => {
    const cur = tutorial.steps[step];
    const read = cur.read ?? DEFAULT_READ;
    const timing = (v: Animated.Value | Animated.ValueXY, toValue: number | { x: number; y: number }, duration: number) =>
      Animated.timing(v, { toValue, duration, easing: Easing.inOut(Easing.cubic), useNativeDriver: nativeDriver });

    if (reduce) {
      // Ohne Bewegung: Finger direkt an Ort und Stelle, nichts läuft von selbst
      if (cur.target) pos.setValue(cur.target);
      opacity.setValue(cur.target ? 1 : 0);
      return;
    }

    const parts: Animated.CompositeAnimation[] = [];
    if (cur.target) {
      parts.push(Animated.parallel([timing(pos, cur.target, 700), timing(opacity, 1, 250)]));
    } else {
      parts.push(timing(opacity, 0, 250));
    }
    if (autoplay) {
      parts.push(Animated.delay(read));
      if (cur.target && cur.tap !== false && step < last) {
        ripple.setValue(0);
        parts.push(
          Animated.parallel([
            Animated.sequence([timing(press, 0.72, 110), timing(press, 1, 170)]),
            Animated.timing(ripple, { toValue: 1, duration: 520, easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver }),
          ]),
        );
      }
    }
    const anim = Animated.sequence(parts);
    let done = false;
    anim.start(({ finished }) => {
      if (finished && autoplay && step < last && !done) goto(step + 1);
    });
    return () => {
      done = true;
      anim.stop();
    };
  }, [step, autoplay, reduce, last, tutorial.steps, goto, pos, opacity, press, ripple]);

  // Telefon so groß wie möglich, aber Platz für Text und Knöpfe lassen
  const scale = Math.max(0.5, Math.min((width - 48) / PHONE.w, (height - 360) / PHONE.h, 1.15));
  const frameW = PHONE.w * scale;
  const frameH = PHONE.h * scale;

  const atEnd = step === last;
  const L = (x: { en: string; de: string }) => x[lang];

  return (
    <MotionContext.Provider value={{ reduceMotion: reduce }}>
      <View style={styles.wrap}>
        <View style={[styles.frame, { width: frameW + 12, height: frameH + 12, borderRadius: 30 * scale + 6 }]}>
          <View
            style={[styles.screen, { width: frameW, height: frameH, borderRadius: 26 * scale }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants">
            <View
              style={{
                position: 'absolute',
                width: PHONE.w,
                height: PHONE.h,
                left: (frameW - PHONE.w) / 2,
                top: (frameH - PHONE.h) / 2,
                transform: [{ scale }],
              }}>
              <Scene step={step} lang={lang} />
              {/* Finger mit Tipp-Welle */}
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.fingerWrap,
                  { opacity, transform: [{ translateX: Animated.subtract(pos.x, FINGER / 2) }, { translateY: Animated.subtract(pos.y, FINGER / 2) }] },
                ]}>
                <Animated.View
                  style={[
                    styles.ripple,
                    {
                      opacity: ripple.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.8, 0] }),
                      transform: [{ scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.4] }) }],
                    },
                  ]}
                />
                <Animated.View style={[styles.finger, { transform: [{ scale: press }] }]} />
              </Animated.View>
            </View>
          </View>
        </View>

        {/* Bildunterschrift */}
        <View style={styles.caption} accessibilityLiveRegion="polite">
          <View style={styles.stepBubble}>
            <AppText variant="smallStrong" color={colors.textOnLight}>
              {step + 1}
            </AppText>
          </View>
          <AppText variant="bodyStrong" style={{ flex: 1 }}>
            {L(s.caption)}
          </AppText>
        </View>

        {/* Steuerung */}
        <View style={styles.controls}>
          <CtrlButton icon="chevron-left" label={t('tutorial.prev')} disabled={step === 0} onPress={() => goto(step - 1)} />
          {atEnd ? (
            <CtrlButton
              icon="rotate-ccw"
              label={t('tutorial.replay')}
              big
              onPress={() => {
                setPlaying(!reduce);
                goto(0);
              }}
            />
          ) : (
            <CtrlButton
              icon={autoplay ? 'pause' : 'play'}
              label={autoplay ? t('tutorial.pause') : t('tutorial.play')}
              big
              disabled={reduce}
              onPress={() => setPlaying((p) => !p)}
            />
          )}
          <CtrlButton icon="chevron-right" label={t('tutorial.next')} disabled={atEnd} onPress={() => goto(step + 1)} />
        </View>
        <View style={styles.dots} accessibilityRole="adjustable" accessibilityLabel={t('tutorial.stepOf', { n: step + 1, total: last + 1 })}>
          {tutorial.steps.map((_, i) => (
            <Pressable key={i} hitSlop={8} onPress={() => goto(i)} accessibilityLabel={t('tutorial.stepOf', { n: i + 1, total: last + 1 })}>
              <View style={[styles.dot, i === step && styles.dotOn, i < step && styles.dotDone]} />
            </Pressable>
          ))}
        </View>

        {atEnd && tutorial.tryIt ? (
          <Button title={t('tutorial.tryIt')} icon="arrow-right" onPress={() => router.push(tutorial.tryIt!)} />
        ) : null}
      </View>
    </MotionContext.Provider>
  );
}

function CtrlButton({
  icon,
  label,
  onPress,
  disabled,
  big,
}: {
  icon: 'chevron-left' | 'chevron-right' | 'play' | 'pause' | 'rotate-ccw';
  label: string;
  onPress: () => void;
  disabled?: boolean;
  big?: boolean;
}) {
  const size = big ? 56 : 44;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.ctrl,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: big ? colors.lime : colors.surfaceAlt },
        disabled && { opacity: 0.35 },
        pressed && { transform: [{ scale: 0.94 }] },
      ]}>
      <Feather name={icon} size={big ? 24 : 20} color={big ? colors.textOnLight : colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.md },
  frame: { backgroundColor: '#0A0F1E', padding: 6, borderWidth: 1, borderColor: colors.borderStrong },
  screen: { overflow: 'hidden', backgroundColor: colors.bg },
  fingerWrap: { position: 'absolute', left: 0, top: 0, width: FINGER, height: FINGER },
  finger: {
    width: FINGER,
    height: FINGER,
    borderRadius: FINGER / 2,
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderWidth: 2,
    borderColor: 'rgba(20,32,58,0.55)',
  },
  ripple: {
    position: 'absolute',
    width: FINGER,
    height: FINGER,
    borderRadius: FINGER / 2,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  caption: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 76,
  },
  stepBubble: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  ctrl: { alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt },
  dotOn: { width: 22, backgroundColor: colors.lime },
  dotDone: { backgroundColor: colors.textMuted },
});
