// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Pendler-Modus an den Einstiegspunkten: Startseite ("Deine Pendelstrecke"), Live-Tab
 * (Abschnitt "Pendelstrecken" über den manuellen Trackings) und Profil (Zeile "Meine Pendelstrecken").
 * Jede Komponente lädt ihre Daten selbst, damit die Tabs nur eine Zeile brauchen.
 */
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import type { Commute } from '@/api/contract';
import { api } from '@/api/endpoints';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { nextCommute } from '@/lib/commutes';
import { journeyStore } from '@/lib/store';
import { useAsync, useNow } from '@/lib/useAsync';
import { useRealtime } from '@/realtime/RealtimeProvider';
import { colors, radius, spacing } from '@/theme';
import { CommuteCard } from './CommuteCard';
import { useToast } from './Toast';
import { AppText, Card, SectionHeader } from './ui';

/** Liste der Strecken – lädt beim Fokus und nach jedem Alarm neu. */
export function useCommuteList() {
  const { user } = useAuth();
  const { onAlert } = useRealtime();
  const list = useAsync(() => api.commutes(), [user?.uid], !!user);
  const reload = list.reload;
  const uid = user?.uid;
  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      reload(true);
      // Losgeh-Zeit und Status ändern sich mit den Live-Daten → ab und zu nachladen
      const timer = setInterval(() => reload(true), 120_000);
      return () => clearInterval(timer);
    }, [uid, reload]),
  );
  useEffect(() => onAlert(() => (uid ? reload(true) : undefined)), [onAlert, reload, uid]);
  return list;
}

/** Nächste Verbindung live holen und auf dem Verbindungs-Bildschirm zeigen. */
export function useOpenCommuteJourney() {
  const toast = useToast();
  const { t } = useI18n();
  const [opening, setOpening] = useState<string | null>(null);
  const open = async (c: Commute) => {
    setOpening(c.id);
    try {
      const p = await api.commutePreview(c.id);
      if (!p.plan) toast(t('commute.noJourney'), 'info');
      else router.push({ pathname: '/journey', params: { id: journeyStore.put(p.plan.journey) } });
    } catch (e) {
      // Ohne Netz: wenigstens die zuletzt berechnete Verbindung zeigen
      if (c.plan) router.push({ pathname: '/journey', params: { id: journeyStore.put(c.plan.journey) } });
      else toast(errorMessage(e), 'error');
    } finally {
      setOpening(null);
    }
  };
  return { open, opening };
}

const openEditor = (c?: Commute) => router.push(c ? { pathname: '/commute-edit', params: { id: c.id } } : '/commute-edit');

function SetupCard({ compact }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => openEditor()}
      style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}>
      <View style={styles.ctaIcon}>
        <Feather name="repeat" size={18} color={colors.textOnLight} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong">{t('commute.ctaTitle')}</AppText>
        {!compact ? (
          <AppText variant="small" muted>
            {t('commute.ctaText')}
          </AppText>
        ) : null}
      </View>
      <Feather name="plus" size={20} color={colors.lime} />
    </Pressable>
  );
}

/** Startseite: die nächste (oder gerade laufende) Strecke mit "Los um 07:36". */
export function HomeCommuteSection() {
  const { t } = useI18n();
  const now = useNow(30_000);
  const list = useCommuteList();
  const { open, opening } = useOpenCommuteJourney();
  if (!list.data) return null;
  const commutes = list.data.commutes;
  const next = nextCommute(commutes, now);
  if (commutes.length === 0) return <SetupCard />;
  if (!next) return null;
  return (
    <View>
      <SectionHeader title={t('commute.home')} action={t('commute.all')} onAction={() => router.push('/commutes')} />
      <CommuteCard
        commute={next}
        now={now}
        onPress={() => openEditor(next)}
        onShowJourney={() => open(next)}
        loadingJourney={opening === next.id}
      />
    </View>
  );
}

/** Live-Tab: alle Strecken kompakt, über den manuellen Trackings. */
export function LiveCommuteSection() {
  const { t } = useI18n();
  const now = useNow(30_000);
  const list = useCommuteList();
  if (!list.data) return null;
  const all = list.data.commutes;
  // Pausierte Strecken nur in "Meine Pendelstrecken", hier nur das, was beobachtet wird
  const commutes = all.filter((c) => c.active);
  return (
    <View>
      <SectionHeader
        title={t('commute.section')}
        action={all.length ? t('commute.manage') : undefined}
        onAction={() => router.push('/commutes')}
      />
      {all.length === 0 ? (
        <SetupCard compact />
      ) : commutes.length === 0 ? (
        <AppText variant="small" muted>
          {t('commute.allPaused')}
        </AppText>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <AppText variant="small" muted>
            {t('commute.liveHint')}
          </AppText>
          {commutes.map((c) => (
            <CommuteCard key={c.id} commute={c} now={now} compact onPress={() => openEditor(c)} />
          ))}
        </View>
      )}
    </View>
  );
}

/** Profil: Zeile "Meine Pendelstrecken" → Liste. */
export function ProfileCommuteRow() {
  const { t } = useI18n();
  return (
    <View>
      <SectionHeader title={t('commute.section')} />
      <Card style={styles.rowCard}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/commutes')}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
          <View style={styles.rowIcon}>
            <Feather name="repeat" size={18} color={colors.lime} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">{t('commute.title')}</AppText>
            <AppText variant="small" muted>
              {t('commute.profileText')}
            </AppText>
          </View>
          <Feather name="chevron-right" size={18} color={colors.textMuted} />
        </Pressable>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(199,232,165,0.28)',
    borderStyle: 'dashed',
  },
  ctaIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  rowCard: { paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
