// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GhostLogo } from '@/components/GhostLogo';
import { LanguageToggle } from '@/components/LanguageSwitch';
import { useToast } from '@/components/Toast';
import { AppText, Button, ErrorBox, IconButton, Input, Notice } from '@/components/ui';
import { useI18n } from '@/i18n';
import { authErrorMessage, useAuth } from '@/lib/auth';
import { openLegal } from '@/lib/legal';
import { colors, radius, spacing } from '@/theme';

type Mode = 'login' | 'register' | 'reset';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ reason?: string }>();
  const { signIn, signUp, resetPassword, devSignIn, devMode } = useAuth();
  const { t } = useI18n();
  const toast = useToast();

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [devName, setDevName] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const submit = async () => {
    setError(null);
    if (!email.trim()) return setError(t('login.enterEmail'));
    if (mode !== 'reset' && password.length < 6) return setError(t('login.passwordShort'));
    if (mode === 'register' && name.trim().length < 2) return setError(t('login.nameShort'));
    if (mode === 'register' && !termsAccepted) return setError(t('terms.required'));
    setBusy(true);
    try {
      if (mode === 'login') {
        await signIn(email, password);
        toast(t('login.welcomeBack'), 'success');
        close();
      } else if (mode === 'register') {
        await signUp(email, password, name);
        toast(t('login.created'), 'success');
        close();
      } else {
        await resetPassword(email);
        toast(t('login.resetSent'), 'success');
        setMode('login');
      }
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitDev = async () => {
    if (!devName.trim()) return setError(t('login.devNameMissing'));
    await devSignIn(devName);
    toast(t('login.devSignedIn', { name: devName.trim() }), 'success');
    close();
  };

  const title = mode === 'login' ? t('login.title.login') : mode === 'register' ? t('login.title.register') : t('login.title.reset');

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <LanguageToggle />
          <IconButton icon="x" accessibilityLabel={t('common.close')} onPress={close} />
        </View>

        <View style={styles.hero}>
          <View style={styles.logoRing}>
            <GhostLogo size={88} />
          </View>
          <AppText variant="display" style={{ marginTop: spacing.xl }}>
            {title}
          </AppText>
          <AppText variant="body" muted style={{ marginTop: spacing.xs }}>
            {params.reason
              ? params.reason
              : mode === 'reset'
                ? t('login.resetText')
                : t('login.intro')}
          </AppText>
        </View>

        <View style={styles.form}>
          {mode === 'register' ? (
            <Input icon="user" placeholder={t('login.displayName')} value={name} onChangeText={setName} autoCapitalize="words" />
          ) : null}
          <Input
            icon="mail"
            placeholder={t('login.email')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
          />
          {mode !== 'reset' ? (
            <Input
              icon="lock"
              placeholder={t('login.password')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType={mode === 'register' ? 'newPassword' : 'password'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              onSubmitEditing={submit}
            />
          ) : null}

          {mode === 'register' ? (
            <View style={styles.terms}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: termsAccepted }}
                accessibilityLabel={`${t('legal.terms')} / ${t('legal.privacy')}`}
                onPress={() => {
                  setTermsAccepted((v) => !v);
                  setError(null);
                }}
                hitSlop={10}
                style={[styles.checkbox, termsAccepted && styles.checkboxOn]}>
                {termsAccepted ? <Feather name="check" size={16} color={colors.textOnLight} /> : null}
              </Pressable>
              <AppText variant="small" muted style={{ flex: 1 }}>
                {t('terms.acceptPre')}
                <AppText variant="smallStrong" color={colors.lime} onPress={() => openLegal('terms')} accessibilityRole="link">
                  {t('legal.terms')}
                </AppText>
                {t('terms.acceptMid')}
                <AppText variant="smallStrong" color={colors.lime} onPress={() => openLegal('privacy')} accessibilityRole="link">
                  {t('legal.privacy')}
                </AppText>
                {t('terms.acceptPost')}
              </AppText>
            </View>
          ) : null}

          {error ? <ErrorBox message={error} /> : null}

          <Button
            title={mode === 'login' ? t('login.signIn') : mode === 'register' ? t('login.createAccount') : t('login.sendLink')}
            size="lg"
            loading={busy}
            onPress={submit}
          />

          {mode === 'login' ? (
            <Pressable onPress={() => setMode('reset')} style={styles.link}>
              <AppText variant="smallStrong" muted>
                {t('login.forgot')}
              </AppText>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.switchRow}>
          <AppText variant="body" muted>
            {mode === 'register' ? t('login.haveAccount') : t('login.newHere')}
          </AppText>
          <Pressable
            onPress={() => {
              setError(null);
              setMode(mode === 'register' ? 'login' : 'register');
            }}
            hitSlop={8}>
            <AppText variant="bodyStrong" color={colors.lime}>
              {mode === 'register' ? t('login.signIn') : t('login.createAccount')}
            </AppText>
          </Pressable>
        </View>

        {devMode ? (
          <View style={styles.devBox}>
            <AppText variant="caption" color={colors.cyan}>
              {t('login.devTitle')}
            </AppText>
            <Notice text={t('login.devNotice')} />
            <Input icon="terminal" placeholder={t('login.devPlaceholder')} value={devName} onChangeText={setDevName} autoCapitalize="none" />
            <Button title={t('login.devButton')} variant="cyan" onPress={submitDev} />
          </View>
        ) : null}

        <AppText variant="small" color={colors.textFaint} center style={{ marginTop: spacing.xl }}>
          {t('login.consent')}
        </AppText>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.xl, flexGrow: 1 },
  topRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm },
  hero: { marginTop: spacing.md },
  logoRing: {
    width: 128,
    height: 128,
    borderRadius: 40,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: { gap: spacing.sm, marginTop: spacing.xl },
  link: { alignSelf: 'center', padding: spacing.xs },
  terms: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xs, paddingHorizontal: 4 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -2,
  },
  checkboxOn: { backgroundColor: colors.lime, borderColor: colors.lime },
  switchRow: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: spacing.lg },
  devBox: {
    marginTop: spacing.xl,
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(46,200,230,0.35)',
    borderStyle: 'dashed',
  },
});
