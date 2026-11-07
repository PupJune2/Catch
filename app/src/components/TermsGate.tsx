// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { api } from '@/api/endpoints';
import { useI18n } from '@/i18n';
import { useAuth, waitForPendingTerms } from '@/lib/auth';
import { openLegal, type LegalPage } from '@/lib/legal';
import { unregisterPush } from '@/lib/notifications';
import { colors, radius, shadow, spacing } from '@/theme';
import { GhostLogo } from './GhostLogo';
import { useToast } from './Toast';
import { AppText, Button, ErrorBox } from './ui';

/**
 * Einmaliges Popup für angemeldete Konten ohne Zustimmung zu den Nutzungsbedingungen
 * (z. B. vor deren Einführung registriert). Akzeptieren → PATCH /v1/me, sonst Abmelden.
 */
export function TermsGate() {
  const { user, signOut } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOpen(false);
    setError(null);
    if (!user) return;
    let cancelled = false;
    (async () => {
      await waitForPendingTerms();
      try {
        const me = await api.me();
        // Nur bei ausdrücklich "null" fragen (ältere Server kennen das Feld nicht)
        if (!cancelled && me.termsAcceptedAt === null) setOpen(true);
      } catch {
        // offline o. Ä. – beim nächsten Start erneut prüfen
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !user) return null;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.acceptTerms();
      setOpen(false);
      toast(t('terms.accepted'), 'success');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setOpen(false);
    await unregisterPush().catch(() => undefined);
    await signOut();
    toast(t('profile.signedOut'), 'success');
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => undefined}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.logo}>
            <GhostLogo size={44} />
          </View>
          <AppText variant="title">{t('terms.modalTitle')}</AppText>
          <AppText variant="body" muted>
            {t('terms.modalText')}
          </AppText>
          <View style={styles.links}>
            <LegalLink page="terms" label={t('legal.terms')} />
            <LegalLink page="privacy" label={t('legal.privacy')} />
          </View>
          {error ? <ErrorBox message={error} /> : null}
          <Button title={t('terms.acceptButton')} icon="check" size="lg" loading={busy} onPress={accept} />
          <Button title={t('profile.signOut')} icon="log-out" variant="ghost" onPress={logout} />
        </View>
      </View>
    </Modal>
  );
}

function LegalLink({ page, label }: { page: LegalPage; label: string }) {
  return (
    <Pressable onPress={() => openLegal(page)} style={({ pressed }) => [styles.link, pressed && { opacity: 0.7 }]} accessibilityRole="link">
      <Feather name="file-text" size={16} color={colors.lime} />
      <AppText variant="bodyStrong" color={colors.lime} style={{ flex: 1 }}>
        {label}
      </AppText>
      <Feather name="external-link" size={15} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colors.raised,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  links: { backgroundColor: colors.surfaceDeep, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 4 },
  link: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12 },
});
