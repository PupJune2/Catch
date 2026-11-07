// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Karte (Web-App): die Kartenseite der Website (website/map/) in einem iframe.
 * Gleiche Schnittstelle wie MapCanvas.tsx (WebView auf Android/iOS). Protokoll: src/lib/mapProtocol.ts
 *
 * Nachrichten werden nur von genau diesem iframe und nur von der Origin der Kartenseite angenommen
 * und nur an diese Origin geschickt.
 */
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useI18n } from '@/i18n';
import { originOf, parseMapMessage, type MapInMessage, type MapOutMessage } from '@/lib/mapProtocol';
import { colors } from '@/theme';

export interface MapCanvasHandle {
  post: (msg: MapInMessage) => void;
  reload: () => void;
}

export interface MapCanvasProps {
  url: string;
  onMessage: (msg: MapOutMessage) => void;
  onLoadError?: () => void;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<MapCanvasHandle>;
}

export function MapCanvas({ url, onMessage, style, ref }: MapCanvasProps) {
  const { t } = useI18n();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [instance, setInstance] = useState(0);
  const origin = useMemo(() => originOf(url), [url]);
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  });

  useImperativeHandle(
    ref,
    () => ({
      post: (msg) => {
        const win = frameRef.current?.contentWindow;
        if (win && origin) win.postMessage(msg, origin);
      },
      reload: () => setInstance((n) => n + 1),
    }),
    [origin],
  );

  useEffect(() => {
    const listener = (e: MessageEvent) => {
      if (!origin || e.origin !== origin) return;
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const msg = parseMapMessage(e.data);
      if (msg) onMessageRef.current(msg);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [origin]);

  return (
    <View style={[styles.root, style]}>
      <iframe
        key={instance}
        ref={frameRef}
        src={url}
        title={t('map.title')}
        // Skripte + eigene Origin (für /v1/map und den Kartendienst-Worker); Links öffnen in neuem Tab
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="strict-origin"
        style={{ border: 0, width: '100%', height: '100%', display: 'block', backgroundColor: colors.bg }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
});
