// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Android: echte Vorschau – die Bibliothek rendert das Widget nativ (wie auf dem Homescreen)
 * und liefert ein Bild. Web/iOS: PreviewSurface.tsx (MirrorPreview).
 */
import { useCallback, type ReactElement } from 'react';
import { WidgetPreview } from 'react-native-android-widget';

export function PreviewSurface({ element, width, height }: { element: ReactElement; width: number; height: number }) {
  const render = useCallback(() => element, [element]);
  return <WidgetPreview renderWidget={render} width={width} height={height} />;
}
