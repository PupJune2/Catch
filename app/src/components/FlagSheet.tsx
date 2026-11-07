// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorMessage } from '@/api/client';
import { FLAG_REASONS, type FlagReason, type Report } from '@/api/contract';
import { api } from '@/api/endpoints';
import { useI18n, type TKey } from '@/i18n';
import { kindOf } from '@/lib/kinds';
import { segmentText } from '@/lib/labels';
import { colors, radius, spacing } from '@/theme';
import { KindBadge } from './kinds';
import { useToast } from './Toast';
import { LineBadge } from './transit';
import { AppText, Button, ErrorBox } from './ui';

/** Unteres Sheet "Inhalt melden" mit festen Gründen → POST /v1/reports/:id/flag. */
export function FlagSheet({ report, onClose, onFlagged }: { report: Report | null; onClose: () => void; onFlagged?: (r: Report) => void }) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const toast = useToast();
  const [reason, setReason] = useState<FlagReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason(null);
    setError(null);
  }, [report?.id]);

  if (!report) return null;

  const send = async () => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.flagReport(report.id, reason);
      toast(t('flag.thanks'), 'success');
      onFlagged?.(report);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.close')} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <View style={styles.flagIcon}>
              <Feather name="flag" size={20} color={colors.textOnLight} />
            </View>
            <AppText variant="h2" style={{ flex: 1 }}>
              {t('flag.title')}
            </AppText>
          </View>
          <View style={styles.reportBox}>
            <LineBadge line={report.line} />
            <View style={{ flex: 1, gap: 6 }}>
              <AppText variant="bodyStrong" numberOfLines={2}>
                {segmentText(report)}
              </AppText>
              <KindBadge kind={kindOf(report)} />
            </View>
          </View>
          <AppText variant="small" muted>
            {t('flag.text')}
          </AppText>
          <View style={styles.reasons}>
            {FLAG_REASONS.map((r, i) => {
              const selected = reason === r;
              return (
                <Pressable
                  key={r}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => setReason(r)}
                  style={({ pressed }) => [styles.reason, i > 0 && styles.reasonBorder, pressed && { opacity: 0.8 }]}>
                  <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <View style={styles.radioDot} /> : null}</View>
                  <AppText variant={selected ? 'bodyStrong' : 'body'} style={{ flex: 1 }}>
                    {t(`flag.${r}` as TKey)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          {error ? <ErrorBox message={error} /> : null}
          <Button title={t('flag.send')} icon="flag" size="lg" disabled={!reason} loading={busy} onPress={send} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.raised,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flagIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.lilac, alignItems: 'center', justifyContent: 'center' },
  reportBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceDeep,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  reasons: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md },
  reason: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 14 },
  reasonBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.lime },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.lime },
});
