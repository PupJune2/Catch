// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, fonts, radius, spacing } from '@/theme';
import { useI18n } from '@/i18n';

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

type Variant = 'display' | 'title' | 'h2' | 'h3' | 'body' | 'bodyStrong' | 'small' | 'smallStrong' | 'caption' | 'mono';

const variantStyles: Record<Variant, TextStyle> = {
  display: { fontFamily: fonts.extrabold, fontSize: 38, lineHeight: 42, letterSpacing: -1.2 },
  title: { fontFamily: fonts.extrabold, fontSize: 28, lineHeight: 33, letterSpacing: -0.8 },
  h2: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  h3: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21 },
  small: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  smallStrong: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, letterSpacing: 0.8, textTransform: 'uppercase' },
  mono: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, fontVariant: ['tabular-nums'] },
};

export interface AppTextProps extends TextProps {
  variant?: Variant;
  color?: string;
  muted?: boolean;
  center?: boolean;
}

export function AppText({ variant = 'body', color, muted, center, style, ...rest }: AppTextProps) {
  return (
    <Text
      {...rest}
      style={[
        variantStyles[variant],
        { color: color ?? (muted ? colors.textMuted : colors.text) },
        center && { textAlign: 'center' },
        style,
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'cyan' | 'ghost' | 'light';

const buttonColors: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.lime, fg: colors.textOnLight },
  secondary: { bg: 'transparent', fg: colors.text, border: colors.borderStrong },
  danger: { bg: colors.orange, fg: '#1A1206' },
  cyan: { bg: colors.cyan, fg: colors.textOnLight },
  ghost: { bg: 'transparent', fg: colors.textMuted },
  light: { bg: colors.surfaceAlt, fg: colors.text },
};

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'lg' | 'sm';
  icon?: ComponentProps<typeof Feather>['name'];
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  full?: boolean;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  disabled,
  style,
  full = true,
}: ButtonProps) {
  const c = buttonColors[variant];
  const height = size === 'lg' ? 58 : size === 'sm' ? 38 : 50;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive }}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        {
          height,
          backgroundColor: c.bg,
          borderColor: c.border ?? 'transparent',
          borderWidth: c.border ? 1.5 : 0,
          opacity: inactive ? 0.55 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed && !inactive ? 0.985 : 1 }],
          paddingHorizontal: size === 'sm' ? 14 : 22,
          alignSelf: full ? 'stretch' : 'flex-start',
        },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={c.fg} />
      ) : (
        <>
          {icon ? <Feather name={icon} size={size === 'sm' ? 15 : 18} color={c.fg} /> : null}
          <AppText
            variant={size === 'sm' ? 'smallStrong' : 'bodyStrong'}
            color={c.fg}
            style={size === 'lg' ? { fontSize: 16 } : undefined}>
            {title}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  color = colors.text,
  bg = colors.surfaceAlt,
  size = 42,
  accessibilityLabel,
}: {
  icon: ComponentProps<typeof Feather>['name'];
  onPress?: () => void;
  color?: string;
  bg?: string;
  size?: number;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
        styles.center,
        pressed && { opacity: 0.7 },
      ]}>
      <Feather name={icon} size={size * 0.45} color={color} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

export function Chip({
  label,
  selected,
  onPress,
  color = colors.lime,
  icon,
  style,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
  icon?: ComponentProps<typeof Feather>['name'];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected ? { backgroundColor: color, borderColor: color } : { backgroundColor: colors.surface },
        pressed && { opacity: 0.8 },
        style,
      ]}>
      {icon ? <Feather name={icon} size={14} color={selected ? colors.textOnLight : colors.textMuted} /> : null}
      <AppText variant="smallStrong" color={selected ? colors.textOnLight : colors.text}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function ChipRow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.chipRow, style]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Card, Section
// ---------------------------------------------------------------------------

export function Card({
  children,
  style,
  onPress,
  color = colors.surface,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  color?: string;
}) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, { backgroundColor: color }, pressed && { opacity: 0.88 }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, { backgroundColor: color }, style]}>{children}</View>;
}

export function SectionHeader({
  title,
  action,
  onAction,
  style,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <AppText variant="h2" style={{ flex: 1 }}>
        {title}
      </AppText>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <AppText variant="smallStrong" color={colors.lime}>
            {action}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Toggle (Bild 2)
// ---------------------------------------------------------------------------

export function Toggle({ value, onChange, accessibilityLabel }: { value: boolean; onChange: (v: boolean) => void; accessibilityLabel: string }) {
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: value ? 1 : 0, duration: 160, useNativeDriver: false }).start();
  }, [value, anim]);
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [3, 25] });
  const bg = anim.interpolate({ inputRange: [0, 1], outputRange: [colors.surfaceAlt, colors.lime] });
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      onPress={() => onChange(!value)}
      hitSlop={8}>
      <Animated.View style={[styles.toggleTrack, { backgroundColor: bg }]}>
        <Animated.View
          style={[
            styles.toggleKnob,
            { transform: [{ translateX }], backgroundColor: value ? colors.textOnLight : colors.textMuted },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Input (Bild 2: dunkle Pill-Felder, Fokus-Rand)
// ---------------------------------------------------------------------------

export interface InputProps extends TextInputProps {
  icon?: ComponentProps<typeof Feather>['name'];
  onClear?: () => void;
  containerStyle?: StyleProp<ViewStyle>;
}

export function Input({ icon, onClear, containerStyle, style, onFocus, onBlur, ...rest }: InputProps) {
  const { t } = useI18n();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.input, focused && styles.inputFocused, containerStyle]}>
      {icon ? <Feather name={icon} size={18} color={focused ? colors.lime : colors.textMuted} /> : null}
      <TextInput
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.lime}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.inputText, style]}
      />
      {onClear && rest.value ? (
        <Pressable onPress={onClear} hitSlop={10} accessibilityLabel={t('common.clearInput')}>
          <Feather name="x-circle" size={18} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Skeleton, Dashes, Notice
// ---------------------------------------------------------------------------

export function Skeleton({ height = 20, width, style }: { height?: number; width?: number | `${number}%`; style?: StyleProp<ViewStyle> }) {
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={[{ height, width: width ?? '100%', borderRadius: 14, backgroundColor: colors.surfaceAlt, opacity }, style]}
    />
  );
}

export function SkeletonList({ count = 3, height = 110 }: { count?: number; height?: number }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} style={{ borderRadius: radius.card }} />
      ))}
    </View>
  );
}

/**
 * Gestrichelte Linie (horizontal oder vertikal), plattformunabhängig.
 * Die Striche liegen absolut im Container, damit sie dessen Größe nicht beeinflussen –
 * die Länge bestimmt allein das Layout (z. B. flex: 1).
 */
export function Dashes({
  vertical,
  color = colors.borderStrong,
  style,
  count = 80,
}: {
  vertical?: boolean;
  color?: string;
  style?: StyleProp<ViewStyle>;
  count?: number;
}) {
  return (
    <View style={[{ overflow: 'hidden' }, vertical ? { width: 1.5 } : { height: 1.5 }, style]}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          flexDirection: vertical ? 'column' : 'row',
          gap: 5,
        }}>
        {Array.from({ length: count }, (_, i) => (
          <View
            key={i}
            style={vertical ? { width: 1.5, height: 5, backgroundColor: color } : { height: 1.5, width: 6, backgroundColor: color }}
          />
        ))}
      </View>
    </View>
  );
}

export function Notice({
  icon = 'info',
  text,
  color = colors.textMuted,
  style,
}: {
  icon?: ComponentProps<typeof Feather>['name'];
  text: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.notice, style]}>
      <Feather name={icon} size={16} color={color} style={{ marginTop: 2 }} />
      <AppText variant="small" color={color} style={{ flex: 1 }}>
        {text}
      </AppText>
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.errorBox}>
      <Feather name="alert-triangle" size={18} color={colors.orange} />
      <AppText variant="small" style={{ flex: 1 }}>
        {message}
      </AppText>
      {onRetry ? (
        <Pressable onPress={onRetry} hitSlop={8}>
          <AppText variant="smallStrong" color={colors.lime}>
            {t('common.retry')}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  button: {
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  card: { borderRadius: radius.card, padding: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  toggleTrack: { width: 52, height: 30, borderRadius: 15, justifyContent: 'center' },
  toggleKnob: { width: 24, height: 24, borderRadius: 12 },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 54,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceDeep,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  inputFocused: { borderColor: 'rgba(199,232,165,0.55)' },
  inputText: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.medium,
    fontSize: 15,
    height: '100%',
    // Web: Fokus-Rahmen des Browsers entfernen
    outlineStyle: 'none' as unknown as undefined,
  } as TextStyle,
  notice: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,122,26,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,122,26,0.35)',
  },
});
