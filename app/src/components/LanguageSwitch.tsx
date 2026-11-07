// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Pressable, StyleSheet, View } from 'react-native';

import { LANGS, useI18n, type Lang } from '@/i18n';
import { colors, fonts, radius } from '@/theme';
import { AppText, Chip, ChipRow } from './ui';

const NAME_KEY = { en: 'lang.en', de: 'lang.de' } as const;

/** Zwei Pill-Chips "English" / "Deutsch" (Profil). */
export function LanguageChips() {
  const { t, lang, setLang } = useI18n();
  return (
    <ChipRow>
      {LANGS.map((l) => (
        <Chip key={l} label={t(NAME_KEY[l])} selected={lang === l} onPress={() => setLang(l)} />
      ))}
    </ChipRow>
  );
}

/** Kompakter Umschalter "EN | DE" (z. B. oben rechts im Login). */
export function LanguageToggle() {
  const { t, lang, setLang } = useI18n();
  return (
    <View style={styles.toggle} accessibilityRole="radiogroup" accessibilityLabel={t('lang.switchA11y')}>
      {LANGS.map((l: Lang) => {
        const active = lang === l;
        return (
          <Pressable
            key={l}
            onPress={() => setLang(l)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t(NAME_KEY[l])}
            hitSlop={6}
            style={[styles.option, active && styles.optionActive]}>
            <AppText style={[styles.label, { color: active ? colors.textOnLight : colors.textMuted }]}>{l.toUpperCase()}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: 'row',
    padding: 3,
    gap: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceDeep,
    borderWidth: 1,
    borderColor: colors.border,
  },
  option: { minWidth: 38, height: 30, paddingHorizontal: 8, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  optionActive: { backgroundColor: colors.lime },
  label: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.5 },
});
