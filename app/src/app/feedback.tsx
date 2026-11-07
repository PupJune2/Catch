// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { KeyboardAvoidingView, Pressable, StyleSheet, TextInput, View, type TextStyle } from 'react-native';

import { errorMessage } from '@/api/client';
import { FEEDBACK_CATEGORIES, FEEDBACK_MAX_LENGTH, FEEDBACK_MIN_LENGTH, type FeedbackCategory } from '@/api/contract';
import { api } from '@/api/endpoints';
import { Screen, StackHeader } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { AppText, Button, Card, Chip, ChipRow, Notice, Toggle } from '@/components/ui';
import { useI18n, type TKey } from '@/i18n';
import { appPlatform, appVersionWithBuild } from '@/lib/appInfo';
import { useAuth } from '@/lib/auth';
import { colors, fonts, radius, spacing } from '@/theme';

type Rating = 1 | 2 | 3 | 4 | 5;
const STARS: Rating[] = [1, 2, 3, 4, 5];

const CATEGORY: Record<FeedbackCategory, { icon: ComponentProps<typeof Feather>['name']; color: string }> = {
  BUG: { icon: 'alert-triangle', color: colors.orange },
  IDEA: { icon: 'zap', color: colors.cyan },
  PRAISE: { icon: 'heart', color: colors.lime },
  OTHER: { icon: 'message-circle', color: colors.lilac },
};

/** "Feedback senden" → POST /v1/feedback. Geht mit und ohne Login (mit Login: dem Konto zugeordnet). */
export default function FeedbackScreen() {
  const { user } = useAuth();
  const { t, tn } = useI18n();
  const toast = useToast();

  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState<Rating | null>(null);
  const [allowContact, setAllowContact] = useState(false);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);

  // Leerzeichen zählen nicht – "   a " reicht nicht
  const enoughText = message.replace(/\s/g, '').length >= FEEDBACK_MIN_LENGTH;
  const canSend = !!category && enoughText;

  const close = () => (router.canGoBack() ? router.back() : router.replace('/profile'));

  const send = async () => {
    if (!category || !enoughText || busy) return;
    setBusy(true);
    try {
      await api.sendFeedback({
        category,
        message: message.trim(),
        rating: rating ?? undefined,
        allowContact: user ? allowContact : undefined,
        appVersion: appVersionWithBuild(),
        platform: appPlatform(),
      });
      toast(t('feedback.thanks'), 'success');
      // busy bleibt an, damit während der Zurück-Animation nicht doppelt gesendet wird
      close();
    } catch (e) {
      // Text bleibt stehen – nochmal senden ist möglich
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };

  const placeholderKey = (category ? `feedback.placeholder.${category}` : 'feedback.placeholder') as TKey;
  const atLimit = message.length >= FEEDBACK_MAX_LENGTH;

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.root}>
      <Screen
        footer={<Button title={t('feedback.send')} icon="send" size="lg" disabled={!canSend} loading={busy} onPress={send} />}>
        <StackHeader onBack={close} />

        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Feather name="message-circle" size={24} color={colors.textOnLight} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="title" accessibilityRole="header">
              {t('feedback.title')}
            </AppText>
            <AppText variant="body" muted>
              {t('feedback.intro')}
            </AppText>
          </View>
        </View>

        <View style={styles.section}>
          <AppText variant="caption" muted>
            {t('feedback.categoryLabel')}
          </AppText>
          <ChipRow>
            {FEEDBACK_CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={t(`feedback.${c}` as TKey)}
                icon={CATEGORY[c].icon}
                color={CATEGORY[c].color}
                selected={category === c}
                onPress={() => setCategory(c)}
                style={styles.category}
              />
            ))}
          </ChipRow>
        </View>

        <View style={styles.section}>
          <AppText variant="caption" muted>
            {t('feedback.messageLabel')}
          </AppText>
          <View style={[styles.box, focused && styles.boxFocused]}>
            <TextInput
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={FEEDBACK_MAX_LENGTH}
              placeholder={t(placeholderKey)}
              placeholderTextColor={colors.textFaint}
              selectionColor={colors.lime}
              accessibilityLabel={t('feedback.messageLabel')}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              style={styles.boxText}
            />
          </View>
          <AppText variant="small" color={atLimit ? colors.orange : colors.textFaint} style={styles.counter}>
            {`${message.length} / ${FEEDBACK_MAX_LENGTH}`}
          </AppText>
        </View>

        <View style={styles.section}>
          <AppText variant="caption" muted>
            {t('feedback.ratingLabel')}
          </AppText>
          <View style={styles.stars}>
            {STARS.map((n) => {
              const on = rating !== null && n <= rating;
              return (
                <Pressable
                  key={n}
                  accessibilityRole="button"
                  accessibilityLabel={tn('feedback.star', n)}
                  accessibilityState={{ selected: rating === n }}
                  accessibilityHint={rating === n ? t('feedback.ratingHint') : undefined}
                  onPress={() => setRating(rating === n ? null : n)}
                  hitSlop={4}
                  style={({ pressed }) => [styles.star, pressed && { opacity: 0.7, transform: [{ scale: 0.92 }] }]}>
                  <MaterialCommunityIcons name={on ? 'star' : 'star-outline'} size={34} color={on ? colors.lime : colors.textFaint} />
                </Pressable>
              );
            })}
          </View>
        </View>

        {user ? (
          <Card style={styles.contactCard}>
            <View style={styles.contactIcon}>
              <Feather name="mail" size={18} color={colors.lime} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">{t('feedback.contact')}</AppText>
              <AppText variant="small" muted>
                {t('feedback.contactText')}
              </AppText>
            </View>
            <Toggle value={allowContact} onChange={setAllowContact} accessibilityLabel={t('feedback.contact')} />
          </Card>
        ) : null}

        <Notice icon="eye-off" text={t('feedback.privacy')} />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: -spacing.xs },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: colors.lilac,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  section: { gap: spacing.sm },
  // 2 × 2 gleich breite Chips – auch "Sonstiges" passt, ohne einzeln umzubrechen
  category: { flexGrow: 1, flexBasis: '40%', justifyContent: 'center', height: 44 },
  box: {
    borderRadius: radius.md,
    backgroundColor: colors.surfaceDeep,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  boxFocused: { borderColor: 'rgba(199,232,165,0.55)' },
  boxText: {
    height: 160,
    paddingHorizontal: spacing.md,
    paddingTop: 14,
    paddingBottom: 14,
    color: colors.text,
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
    // Web: Fokus-Rahmen des Browsers entfernen
    outlineStyle: 'none' as unknown as undefined,
  } as TextStyle,
  counter: { alignSelf: 'flex-end', marginTop: -4, fontVariant: ['tabular-nums'] },
  stars: { flexDirection: 'row', gap: spacing.xs },
  star: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  contactCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  contactIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
