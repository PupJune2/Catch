// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Kleine Aktion "Ins Widget" an Haltestellen (Karte, Abfahrtstafel) – nur in der Android-App.
 * Speichert die Haltestelle fürs Homescreen-Widget, aktualisiert vorhandene Widgets und bietet
 * sonst den Systemdialog "Widget hinzufügen" an.
 */
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import type { Mode } from '@/api/contract';
import { useToast } from '@/components/Toast';
import { AppText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { shortStopName } from '@/lib/format';
import { colors, radius } from '@/theme';
import { saveWidgetConfig, useWidgetConfig } from './config';
import { pinWidget, updateWidgets, widgetCount, WIDGET_SUPPORTED } from './native';

interface Props {
  stop: { id: string; name: string; modes?: Mode[] };
  style?: StyleProp<ViewStyle>;
}

export function AddToWidgetButton(props: Props) {
  return WIDGET_SUPPORTED ? <AddToWidget {...props} /> : null;
}

/** Haltestelle fürs Widget übernehmen; ohne Widget auf dem Homescreen → Systemdialog anbieten. */
export async function applyStopToWidget(
  stop: Props['stop'],
  toast: (m: string, kind?: 'success' | 'error' | 'info') => void,
  t: ReturnType<typeof useI18n>['t'],
): Promise<void> {
  await saveWidgetConfig({ stop: { id: stop.id, name: stop.name, modes: stop.modes } });
  const name = shortStopName(stop.name);
  if ((await widgetCount()) > 0) {
    await updateWidgets();
    toast(t('widget.saved', { stop: name }), 'success');
    return;
  }
  const asked = await pinWidget();
  toast(asked ? t('widget.saved', { stop: name }) : t('widget.pinFailed'), asked ? 'success' : 'info');
}

function AddToWidget({ stop, style }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const config = useWidgetConfig();
  const [busy, setBusy] = useState(false);
  const selected = config.stop?.id === stop.id;

  const onPress = async () => {
    if (selected) {
      router.push('/widget');
      return;
    }
    setBusy(true);
    try {
      await applyStopToWidget(stop, toast, t);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={selected ? t('widget.inWidgetA11y') : t('widget.addActionA11y', { stop: shortStopName(stop.name) })}
      onPress={busy ? undefined : () => void onPress()}
      hitSlop={6}
      style={({ pressed }) => [styles.pill, selected && styles.pillOn, (pressed || busy) && { opacity: 0.7 }, style]}>
      <Feather name={selected ? 'check' : 'plus-square'} size={13} color={selected ? colors.textOnLight : colors.lime} />
      <AppText variant="smallStrong" color={selected ? colors.textOnLight : colors.lime} style={{ fontSize: 12 }}>
        {selected ? t('widget.inWidget') : t('widget.addAction')}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(199,232,165,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(199,232,165,0.35)',
    alignSelf: 'flex-start',
  },
  pillOn: { backgroundColor: colors.lime, borderColor: colors.lime },
});
