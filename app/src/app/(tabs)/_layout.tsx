// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { TabList, TabSlot, Tabs, TabTrigger } from 'expo-router/ui';
import { View } from 'react-native';

import { TabBar } from '@/components/TabBar';
import { colors } from '@/theme';

export default function TabLayout() {
  return (
    <Tabs>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <TabSlot style={{ flex: 1 }} />
      </View>
      <TabBar />
      {/* Definiert die Routen der Tabs; die sichtbare Leiste ist <TabBar /> */}
      <TabList style={{ display: 'none' }}>
        <TabTrigger name="index" href="/" />
        <TabTrigger name="search" href="/search" />
        <TabTrigger name="live" href="/live" />
        <TabTrigger name="profile" href="/profile" />
      </TabList>
    </Tabs>
  );
}
