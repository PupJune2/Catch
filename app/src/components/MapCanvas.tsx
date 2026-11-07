// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Karte (Android/iOS): die Kartenseite der Website (website/map/) in einer WebView.
 * Web-Variante: MapCanvas.web.tsx (iframe). Protokoll: src/lib/mapProtocol.ts
 *
 * - Nur die Origin der Kartenseite darf in der WebView laden; alle anderen Links
 *   (z. B. OpenStreetMap in der Attribution) öffnen im Browser.
 * - Standort kommt von der App (expo-location), nicht aus der WebView.
 */
import { useCallback, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { Linking, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { originOf, parseMapMessage, type MapInMessage, type MapOutMessage } from '@/lib/mapProtocol';
import { colors } from '@/theme';

export interface MapCanvasHandle {
  /** Nachricht an die Kartenseite. */
  post: (msg: MapInMessage) => void;
  /** Seite neu laden (danach kommt wieder "ready"). */
  reload: () => void;
}

export interface MapCanvasProps {
  url: string;
  onMessage: (msg: MapOutMessage) => void;
  /** Seite konnte nicht geladen werden (offline, Server-Fehler). */
  onLoadError?: () => void;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<MapCanvasHandle>;
}

export function MapCanvas({ url, onMessage, onLoadError, style, ref }: MapCanvasProps) {
  // WebView<object>: mit dem Standard-Typparameter (undefined) würden die Props unter TS 6 zu `never`
  const webRef = useRef<WebView<object>>(null);
  // Nach einem Absturz des Web-Prozesses wird die WebView neu angelegt
  const [instance, setInstance] = useState(0);
  const origin = useMemo(() => originOf(url), [url]);

  useImperativeHandle(
    ref,
    () => ({
      post: (msg) => webRef.current?.postMessage(JSON.stringify(msg)),
      reload: () => setInstance((n) => n + 1),
    }),
    [],
  );

  const handleMessage = useCallback(
    (e: WebViewMessageEvent) => {
      // Nur Nachrichten der Kartenseite selbst
      if (origin && originOf(e.nativeEvent.url || '') !== origin) return;
      const msg = parseMapMessage(e.nativeEvent.data);
      if (msg) onMessage(msg);
    },
    [origin, onMessage],
  );

  const shouldLoad = useCallback(
    (req: { url: string }) => {
      if (req.url === 'about:blank' || originOf(req.url) === origin) return true;
      if (/^https?:\/\//i.test(req.url)) Linking.openURL(req.url).catch(() => undefined);
      return false;
    },
    [origin],
  );

  const restart = useCallback(() => setInstance((n) => n + 1), []);

  return (
    <View style={[styles.root, style]}>
      <WebView<object>
        key={instance}
        ref={webRef}
        source={{ uri: url }}
        style={styles.web}
        containerStyle={styles.web}
        originWhitelist={origin ? [origin] : ['https://*']}
        onShouldStartLoadWithRequest={shouldLoad}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        geolocationEnabled={false}
        allowFileAccess={false}
        allowsBackForwardNavigationGestures={false}
        allowsLinkPreview={false}
        bounces={false}
        overScrollMode="never"
        scrollEnabled={false}
        textZoom={100}
        mediaPlaybackRequiresUserAction
        webviewDebuggingEnabled={__DEV__}
        onMessage={handleMessage}
        onError={() => onLoadError?.()}
        // Wird nur für die Seite selbst gemeldet (Hauptdokument), nicht für Kacheln o. Ä.
        onHttpError={() => onLoadError?.()}
        onRenderProcessGone={restart}
        onContentProcessDidTerminate={restart}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
  web: { flex: 1, backgroundColor: colors.bg },
});
