// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { api } from '@/api/endpoints';
import { StatStrip } from '@/components/charts';
import { ProfileCommuteRow } from '@/components/CommuteSections';
import { GhostLogo } from '@/components/GhostLogo';
import { LanguageChips } from '@/components/LanguageSwitch';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { TrustStatus } from '@/components/TrustBadge';
import { AppText, Button, Card, ErrorBox, Notice, SectionHeader, Toggle } from '@/components/ui';
import { API_URL, DATA_SOURCE_URLS, DONATION_URL, DONATIONS_ENABLED, SOURCE_URL } from '@/config';
import { useI18n, type TKey } from '@/i18n';
import { authErrorMessage, useAuth } from '@/lib/auth';
import { confirm } from '@/lib/confirm';
import * as Linking from 'expo-linking';
import { openLegal, type LegalPage } from '@/lib/legal';
import { registerForPush, unregisterPush } from '@/lib/notifications';
import { APP_VERSION } from '@/lib/appInfo';
import { useSettings } from '@/lib/settings';
import { useSeenTutorials } from '@/lib/tutorialSeen';
import { useAsync, useNow } from '@/lib/useAsync';
import { formatBytes, regionDaysLeft, storageUsed, useInstalledRegions } from '@/offline/storage';
import { TUTORIALS } from '@/tutorials';
import { colors, radius, spacing } from '@/theme';
import { WidgetCard } from '@/widget/WidgetCard';

const TRUST_KEYS: TKey[] = ['profile.trust.0', 'profile.trust.1', 'profile.trust.2', 'profile.trust.3'];

export default function ProfileScreen() {
  const { user, signOut, deleteAccount } = useAuth();
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const toast = useToast();
  const me = useAsync(() => api.me(), [user?.uid], !!user);
  const [deleting, setDeleting] = useState(false);

  const togglePush = async (on: boolean) => {
    update({ push: on });
    if (Platform.OS === 'web') {
      toast(t('profile.pushOnlyApp'), 'info');
      return;
    }
    if (on) {
      const r = await registerForPush();
      if (!r.ok) toast(r.message, 'error');
      else toast(t('profile.pushOn'), 'success');
    } else {
      await unregisterPush();
    }
  };

  const logout = async () => {
    await unregisterPush();
    await signOut();
    toast(t('profile.signedOut'), 'success');
  };

  const remove = async () => {
    const ok = await confirm(
      t('profile.deleteTitle'),
      t('profile.deleteText'),
      t('profile.deleteConfirm'),
      true,
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteAccount();
      toast(t('profile.deleted'), 'success');
      router.replace('/');
    } catch (e) {
      const code = (e as { code?: string })?.code;
      toast(code ? authErrorMessage(e) : errorMessage(e), 'error');
    } finally {
      setDeleting(false);
    }
  };

  if (!user) {
    return (
      <Screen
        withTabBar
        header={
          <View style={{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg }}>
            <GhostLogo size={84} />
            <AppText variant="title" center>
              {t('profile.joinTitle')}
            </AppText>
            <AppText variant="body" muted center style={{ maxWidth: 320 }}>
              {t('profile.joinText')}
            </AppText>
          </View>
        }>
        <Button title={t('profile.signInOrRegister')} size="lg" onPress={() => router.push('/login')} />
        <HelpCard />
        <LanguageCard />
        <OfflineCard />
        <WidgetCard />
        <AboutCard />
        <SupportCard />
        <FeedbackCard />
        <LegalCard />
        <SourcesCard />
        <CreditLine />
      </Screen>
    );
  }

  const m = me.data;
  const trust = Math.max(0, Math.min(3, m?.trustLevel ?? 0));

  return (
    <Screen
      withTabBar
      refreshing={me.loading && !!me.data}
      onRefresh={() => me.reload()}
      header={
        <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
          <View style={styles.headRow}>
            <View style={styles.avatar}>
              <AppText variant="title" color={colors.textOnLight}>
                {(user.displayName ?? user.email ?? '?').charAt(0).toUpperCase()}
              </AppText>
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="h2" numberOfLines={1}>
                {user.displayName ?? m?.displayName ?? t('profile.noName')}
              </AppText>
              <AppText variant="small" muted numberOfLines={1}>
                {user.isDev ? t('profile.devAccount') : (m?.email ?? user.email ?? '')}
              </AppText>
            </View>
          </View>
          <View style={styles.trustPill}>
            <Feather name="award" size={16} color={colors.textOnLight} />
            <AppText variant="smallStrong" color={colors.textOnLight}>
              {t(TRUST_KEYS[trust])}
            </AppText>
            <View style={styles.trustDots}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[styles.trustDot, i < trust && { backgroundColor: colors.textOnLight }]} />
              ))}
            </View>
          </View>
        </View>
      }>
      {me.error ? <ErrorBox message={me.error} onRetry={() => me.reload()} /> : null}
      <StatStrip
        stats={[
          { value: String(m?.reportsCount ?? '–'), label: t('profile.stat.reports') },
          { value: String(m?.confirmationsReceived ?? '–'), label: t('profile.stat.confirmed'), color: colors.lime },
          { value: `${trust}/3`, label: t('profile.stat.trust'), color: colors.lilac },
        ]}
      />
      <TrustStatus me={m} />

      <View>
        <SectionHeader title={t('profile.notifications')} />
        <Card style={{ gap: spacing.lg }}>
          <SettingRow icon="bell" title={t('profile.push')} text={t('profile.pushText')}>
            <Toggle value={settings.push} onChange={togglePush} accessibilityLabel={t('profile.push')} />
          </SettingRow>
          <SettingRow icon="volume-2" title={t('profile.sound')} text={t('profile.soundText')}>
            <Toggle value={settings.sound} onChange={(v) => update({ sound: v })} accessibilityLabel={t('profile.sound')} />
          </SettingRow>
        </Card>
      </View>

      {/* Pendler-Modus: gespeicherte Strecken */}
      <ProfileCommuteRow />

      <HelpCard />

      <LanguageCard />

      <OfflineCard />

      <WidgetCard />

      <AboutCard />

      <SupportCard />

      <FeedbackCard />

      <LegalCard />

      <SourcesCard />

      <View style={{ gap: spacing.sm }}>
        <Button title={t('profile.signOut')} icon="log-out" variant="secondary" onPress={logout} />
        <Button title={t('profile.delete')} icon="trash-2" variant="ghost" loading={deleting} onPress={remove} />
      </View>

      <AppText variant="small" color={colors.textFaint} center>
        {t('profile.version', { version: APP_VERSION, server: API_URL.replace(/^https?:\/\//, '') })}
      </AppText>
      <CreditLine />
    </Screen>
  );
}

function SettingRow({
  icon,
  title,
  text,
  children,
}: {
  icon: ComponentProps<typeof Feather>['name'];
  title: string;
  text: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.setting}>
      <View style={styles.settingIcon}>
        <Feather name={icon} size={18} color={colors.lime} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        <AppText variant="small" muted>
          {text}
        </AppText>
      </View>
      {children}
    </View>
  );
}

/** Sprachwahl: "Language / Sprache" mit zwei Pill-Chips. */
function LanguageCard() {
  const { t } = useI18n();
  return (
    <View>
      <SectionHeader title={t('profile.language')} />
      <Card style={{ gap: spacing.md }}>
        <View style={styles.setting}>
          <View style={styles.settingIcon}>
            <Feather name="globe" size={18} color={colors.lime} />
          </View>
          <AppText variant="small" muted style={{ flex: 1 }}>
            {t('profile.languageText')}
          </AppText>
        </View>
        <LanguageChips />
      </Card>
    </View>
  );
}

function AboutCard() {
  const { t } = useI18n();
  return (
    <View>
      <SectionHeader title={t('profile.about')} />
      <Card style={{ gap: spacing.md }}>
        <Notice icon="lock" text={t('profile.about1')} />
        <Notice icon="map-pin" text={t('profile.about2')} />
        <Notice icon="shield" text={t('common.ticketHint')} />
      </Card>
    </View>
  );
}

/** Zeile "Offline-Fahrpläne" → /offline (Städte für die Planung ohne Internet). */
function OfflineCard() {
  const { t, tn } = useI18n();
  const { installed } = useInstalledRegions();
  const now = useNow(60_000);
  const expired = installed.filter((r) => regionDaysLeft(r, now) < 0).length;
  const text = installed.length
    ? `${tn('offline.cities', installed.length)} · ${formatBytes(storageUsed(installed))}${expired ? ` · ${t('offline.expiredShort')}` : ''}`
    : t('offline.profileText');
  return (
    <View>
      <SectionHeader title={t('offline.section')} />
      <Card style={styles.legalCard}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/offline')}
          style={({ pressed }) => [styles.legalRow, pressed && { opacity: 0.7 }]}>
          <View style={styles.settingIcon}>
            <Feather name="download-cloud" size={18} color={colors.lime} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">{t('offline.title')}</AppText>
            <AppText variant="small" color={expired ? colors.orange : colors.textMuted}>
              {text}
            </AppText>
          </View>
          <Feather name="chevron-right" size={18} color={colors.textMuted} />
        </Pressable>
      </Card>
    </View>
  );
}

/** "Hilfe & Tutorials" → /help (FAQ mit Animationen). Zeigt, wie viele noch nicht angesehen wurden. */
function HelpCard() {
  const { t, tn } = useI18n();
  const seen = useSeenTutorials();
  const unseen = TUTORIALS.filter((tu) => !seen.has(tu.id)).length;
  return (
    <View>
      <SectionHeader title={t('help.title')} />
      <Card style={styles.legalCard}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/help')}
          style={({ pressed }) => [styles.legalRow, pressed && { opacity: 0.7 }]}>
          <View style={styles.settingIcon}>
            <Feather name="help-circle" size={18} color={colors.lime} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">{t('help.title')}</AppText>
            <AppText variant="small" muted>
              {t('help.profileText')}
            </AppText>
          </View>
          {unseen > 0 ? (
            <View style={styles.newPill}>
              <AppText variant="smallStrong" color={colors.textOnLight}>
                {tn('help.unseen', unseen)}
              </AppText>
            </View>
          ) : null}
          <Feather name="chevron-right" size={18} color={colors.textMuted} />
        </Pressable>
      </Card>
    </View>
  );
}

/** "Catch unterstützen" → Ko-fi (externer Browser). Ausblendbar per EXPO_PUBLIC_DONATIONS=off. */
function SupportCard() {
  const { t } = useI18n();
  if (!DONATIONS_ENABLED) return null;
  return (
    <View>
      <SectionHeader title={t('support.title')} />
      <Card style={styles.supportCard}>
        <View style={styles.supportHead}>
          <View style={styles.supportIcon}>
            <Feather name="coffee" size={22} color={colors.textOnLight} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyStrong">{t('support.heading')}</AppText>
            <AppText variant="small" muted>
              {t('support.text')}
            </AppText>
          </View>
        </View>
        <Button title={t('support.button')} icon="heart" onPress={() => Linking.openURL(DONATION_URL).catch(() => undefined)} />
        <AppText variant="small" color={colors.textFaint} center>
          {t('support.note')}
        </AppText>
      </Card>
    </View>
  );
}

/** Zeile "Feedback senden" → /feedback (mit und ohne Login). */
function FeedbackCard() {
  const { t } = useI18n();
  return (
    <View>
      <SectionHeader title={t('feedback.title')} />
      <Card style={styles.legalCard}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/feedback')}
          style={({ pressed }) => [styles.legalRow, pressed && { opacity: 0.7 }]}>
          <View style={styles.settingIcon}>
            <Feather name="message-circle" size={18} color={colors.lime} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">{t('profile.feedback')}</AppText>
            <AppText variant="small" muted>
              {t('profile.feedbackText')}
            </AppText>
          </View>
          <Feather name="chevron-right" size={18} color={colors.textMuted} />
        </Pressable>
      </Card>
    </View>
  );
}

const LEGAL: { page: LegalPage; key: TKey; icon: ComponentProps<typeof Feather>['name'] }[] = [
  { page: 'terms', key: 'legal.terms', icon: 'file-text' },
  { page: 'privacy', key: 'legal.privacy', icon: 'lock' },
  { page: 'notice', key: 'legal.notice', icon: 'info' },
];

/** Links zu Nutzungsbedingungen, Datenschutz und Impressum (junify.live, Sprache der App). */
function LegalCard() {
  const { t } = useI18n();
  return (
    <View>
      <SectionHeader title={t('legal.title')} />
      <Card style={styles.legalCard}>
        {LEGAL.map((l, i) => (
          <Pressable
            key={l.page}
            accessibilityRole="link"
            onPress={() => openLegal(l.page)}
            style={({ pressed }) => [styles.legalRow, i > 0 && styles.legalBorder, pressed && { opacity: 0.7 }]}>
            <View style={styles.settingIcon}>
              <Feather name={l.icon} size={18} color={colors.lime} />
            </View>
            <AppText variant="bodyStrong" style={{ flex: 1 }}>
              {t(l.key)}
            </AppText>
            <Feather name="external-link" size={16} color={colors.textMuted} />
          </Pressable>
        ))}
      </Card>
    </View>
  );
}

const SOURCES: { url: string; title: TKey; text: TKey; icon: ComponentProps<typeof Feather>['name'] }[] = [
  { url: DATA_SOURCE_URLS.transitous, title: 'sources.transitous', text: 'sources.transitousText', icon: 'clock' },
  { url: DATA_SOURCE_URLS.delfi, title: 'sources.delfi', text: 'sources.delfiText', icon: 'download-cloud' },
  { url: DATA_SOURCE_URLS.osm, title: 'sources.osm', text: 'sources.osmText', icon: 'map' },
  { url: SOURCE_URL, title: 'sources.code', text: 'sources.codeText', icon: 'github' },
];

/** Urheber-Hinweis (Pflicht nach NOTICE.md, AGPL-3.0 § 7 b) – ganz unten im Profil. */
function CreditLine() {
  const { t } = useI18n();
  return (
    <AppText variant="small" color={colors.textFaint} center>
      {t('sources.credit')}
    </AppText>
  );
}

/**
 * Datenquellen & Open Source: Transitous verlangt einen sichtbaren Link auf seine Quellenliste,
 * OpenStreetMap und DELFI (CC BY 4.0) eine Namensnennung; der Quellcode steht unter AGPL-3.0.
 */
function SourcesCard() {
  const { t } = useI18n();
  return (
    <View>
      <SectionHeader title={t('sources.title')} />
      <Card style={styles.legalCard}>
        {SOURCES.map((src, i) => (
          <Pressable
            key={src.url}
            accessibilityRole="link"
            onPress={() => Linking.openURL(src.url).catch(() => undefined)}
            style={({ pressed }) => [styles.legalRow, i > 0 && styles.legalBorder, pressed && { opacity: 0.7 }]}>
            <View style={styles.settingIcon}>
              <Feather name={src.icon} size={18} color={colors.lime} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">{t(src.title)}</AppText>
              <AppText variant="small" muted>
                {t(src.text)}
              </AppText>
            </View>
            <Feather name="external-link" size={16} color={colors.textMuted} />
          </Pressable>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  legalCard: { paddingVertical: 6 },
  supportCard: { gap: spacing.md, borderWidth: 1, borderColor: 'rgba(199,232,165,0.28)' },
  supportHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  supportIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  newPill: { backgroundColor: colors.cyan, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  legalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  legalBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: colors.lilac,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  trustDots: { flexDirection: 'row', gap: 4, marginLeft: 4 },
  trustDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(20,32,58,0.25)' },
  setting: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  settingIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
