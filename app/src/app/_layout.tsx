// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AlertOverlay } from '@/components/AlertOverlay';
import { AppServices } from '@/components/AppServices';
import { NotificationBridge } from '@/components/NotificationBridge';
import { TermsGate } from '@/components/TermsGate';
import { ToastProvider } from '@/components/Toast';
import { I18nProvider, useI18n } from '@/i18n';
import { AuthProvider } from '@/lib/auth';
import { SettingsProvider } from '@/lib/settings';
import { RealtimeProvider } from '@/realtime/RealtimeProvider';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, primary: colors.lime, text: colors.text, border: colors.border },
};

export default function RootLayout() {
  return (
    <I18nProvider>
      <Root />
    </I18nProvider>
  );
}

function Root() {
  // Gespeicherte Sprache laden, bevor etwas gerendert wird (kein Aufblitzen der falschen Sprache)
  const { ready: langReady } = useI18n();
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  const ready = (fontsLoaded || !!fontError) && langReady;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme}>
        <SettingsProvider>
          <AuthProvider>
            <RealtimeProvider>
              <ToastProvider>
                <StatusBar style="light" />
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="line/[key]" />
                  <Stack.Screen name="journey" />
                  <Stack.Screen name="feedback" />
                  {/* Karte: Wischen zum Zurückgehen aus, sonst kollidiert es mit dem Verschieben der Karte */}
                  <Stack.Screen name="map" options={{ gestureEnabled: false }} />
                  <Stack.Screen name="login" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="report" options={{ presentation: 'fullScreenModal' }} />
                  <Stack.Screen name="track-new" options={{ presentation: 'modal' }} />
                </Stack>
                <AlertOverlay />
                <TermsGate />
                <NotificationBridge />
                <AppServices />
              </ToastProvider>
            </RealtimeProvider>
          </AuthProvider>
        </SettingsProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
