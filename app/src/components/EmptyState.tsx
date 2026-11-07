// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme';
import { GhostLogo } from './GhostLogo';
import { AppText, Button } from './ui';

export function EmptyState({
  title,
  text,
  action,
  onAction,
  size = 64,
}: {
  title: string;
  text?: string;
  action?: string;
  onAction?: () => void;
  size?: number;
}) {
  return (
    <View style={styles.wrap}>
      <GhostLogo size={size} />
      <AppText variant="h3" center style={{ marginTop: spacing.md }}>
        {title}
      </AppText>
      {text ? (
        <AppText variant="small" muted center style={{ maxWidth: 300 }}>
          {text}
        </AppText>
      ) : null}
      {action ? (
        <Button title={action} onPress={onAction} variant="secondary" size="sm" full={false} style={{ marginTop: spacing.sm }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
});
