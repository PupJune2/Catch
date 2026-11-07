// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme';
import { AppText, Dashes } from './ui';

/**
 * Zeitleiste aus Bild 1: links Uhrzeiten mit gestricheltem Verbinder,
 * rechts der Inhalt (Karte).
 */
export function TimelineItem({
  top,
  bottom,
  topSub,
  bottomSub,
  children,
  accent,
  separator = true,
  compact = false,
}: {
  top: string;
  bottom?: string;
  topSub?: string;
  bottomSub?: string;
  children: ReactNode;
  /** Farbe für die Uhrzeiten (z. B. Verspätung) */
  accent?: string;
  separator?: boolean;
  compact?: boolean;
}) {
  return (
    <View>
      <View style={[styles.row, compact && { minHeight: 0 }]}>
        <View style={styles.left}>
          <AppText variant="mono" color={accent ?? colors.text} style={styles.time}>
            {top}
          </AppText>
          {topSub ? (
            <AppText variant="small" color={colors.orange} style={styles.sub}>
              {topSub}
            </AppText>
          ) : null}
          {bottom ? (
            <>
              <Dashes vertical style={styles.connector} />
              {bottomSub ? (
                <AppText variant="small" color={colors.orange} style={styles.sub}>
                  {bottomSub}
                </AppText>
              ) : null}
              <AppText variant="mono" muted style={styles.time}>
                {bottom}
              </AppText>
            </>
          ) : null}
        </View>
        <View style={styles.content}>{children}</View>
      </View>
      {separator ? <Dashes style={styles.separator} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, minHeight: 110 },
  left: { width: 52, alignItems: 'flex-start', paddingTop: 2 },
  time: { fontSize: 15 },
  sub: { fontSize: 11.5, lineHeight: 14 },
  connector: { flex: 1, marginLeft: 16, marginVertical: 6, minHeight: 16 },
  content: { flex: 1 },
  separator: { marginVertical: spacing.lg, marginLeft: 64 },
});
