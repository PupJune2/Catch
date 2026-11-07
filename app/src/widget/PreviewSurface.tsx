// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/** Web/iOS: Vorschau mit normalen Views (Android: PreviewSurface.android.tsx, nativ gerendert). */
import type { ReactElement } from 'react';

import { MirrorPreview } from './MirrorPreview';

export function PreviewSurface({ element, width, height }: { element: ReactElement; width: number; height: number }) {
  return <MirrorPreview element={element} width={width} height={height} />;
}
