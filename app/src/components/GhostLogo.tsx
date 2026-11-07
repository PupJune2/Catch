// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import Svg, { Path, Rect } from 'react-native-svg';

import { useI18n } from '@/i18n';
import { colors } from '@/theme';

/** Pfade des Catch-Geists (viewBox 0 0 100 110). Identisch zu assets/ghost.svg. */
export const GHOST_OUTER =
  'M18 98 C10 94 7 86 7 76 L7 44 C7 20 26 4 50 4 C74 4 91 20 91 44 L91 70 C91 78 94 85 99 92 L95 101 C86 96 75 94 63 96 C49 98 35 102 18 98 Z';
export const GHOST_INNER =
  'M19 84 L17 46 C17 26 31 14 50 14 C69 14 81 27 81 46 L81 72 C81 76 82 79 84 82 C74 78 63 78 52 82 C41 86 30 89 19 84 Z';
export const GHOST_STAR =
  'M58 30 C59.6 38.5 61.5 40.4 70 42 C61.5 43.6 59.6 45.5 58 54 C56.4 45.5 54.5 43.6 46 42 C54.5 40.4 56.4 38.5 58 30 Z';

export function GhostLogo({
  size = 48,
  color = colors.cream,
  fill = colors.ghostFill,
}: {
  /** Breite in px; Höhe ergibt sich aus dem Seitenverhältnis */
  size?: number;
  color?: string;
  fill?: string;
}) {
  const { t } = useI18n();
  return (
    <Svg width={size} height={size * 1.1} viewBox="0 0 100 110" accessibilityLabel={t('common.logo')}>
      <Path d={GHOST_OUTER} fill={color} />
      <Path d={GHOST_INNER} fill={fill} />
      <Rect x={27} y={41} width={13} height={6.5} rx={3.25} fill={color} />
      <Path d={GHOST_STAR} fill={color} />
    </Svg>
  );
}
