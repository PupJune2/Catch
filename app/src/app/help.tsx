// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen, StackHeader } from '@/components/Screen';
import { AppText, Button, Card, Input, SectionHeader } from '@/components/ui';
import { useI18n, type TKey } from '@/i18n';
import { useSeenTutorials } from '@/lib/tutorialSeen';
import { CATEGORY_ORDER, TUTORIALS, type Tutorial } from '@/tutorials';
import { colors, radius, spacing } from '@/theme';

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/**
 * Hilfe & Tutorials: häufige Fragen ("Kann ich …?") mit kurzer Antwort, Fundort und
 * Animation. Die aufgeklappte Frage steht in der URL (?open=<id>) – übersteht ein Neuladen.
 */
export default function HelpScreen() {
  const { t, lang } = useI18n();
  const params = useLocalSearchParams<{ open?: string }>();
  const [query, setQuery] = useState('');
  const seen = useSeenTutorials();
  const open = params.open;
  const toggle = (id: string) => router.setParams({ open: open === id ? '' : id });

  const matches = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return TUTORIALS;
    return TUTORIALS.filter((tu) => norm(`${tu.question[lang]} ${tu.answer[lang]} ${tu.where[lang]}`).includes(q));
  }, [query, lang]);

  const featured = query ? [] : TUTORIALS.filter((tu) => tu.featured);

  return (
    <Screen>
      <StackHeader title={t('help.title')} subtitle={t('help.subtitle')} />

      <Input icon="search" placeholder={t('help.search')} value={query} onChangeText={setQuery} onClear={() => setQuery('')} returnKeyType="search" />

      {featured.map((tu) => (
        <Card key={tu.id} style={styles.featured} onPress={() => router.push({ pathname: '/tutorial/[id]', params: { id: tu.id } })}>
          <View style={styles.featuredTop}>
            <View style={styles.newBadge}>
              <AppText variant="smallStrong" color={colors.textOnLight}>
                {t('help.featured')}
              </AppText>
            </View>
            <Feather name={tu.icon} size={18} color={colors.cyan} />
          </View>
          <AppText variant="h3">{tu.question[lang]}</AppText>
          <View style={styles.watch}>
            <Feather name="play-circle" size={18} color={colors.lime} />
            <AppText variant="smallStrong" color={colors.lime}>
              {t('help.watch')}
            </AppText>
          </View>
        </Card>
      ))}

      {matches.length === 0 ? (
        <AppText variant="body" muted center style={{ marginVertical: spacing.lg }}>
          {t('help.noResults', { q: query.trim() })}
        </AppText>
      ) : null}

      {CATEGORY_ORDER.map((cat) => {
        const list = matches.filter((tu) => tu.category === cat);
        if (!list.length) return null;
        return (
          <View key={cat}>
            <SectionHeader title={t(`help.cat.${cat}` as TKey)} />
            <Card style={styles.list}>
              {list.map((tu, i) => (
                <FaqRow key={tu.id} tutorial={tu} first={i === 0} open={open === tu.id || !!query.trim() && list.length === 1} seen={seen.has(tu.id)} onToggle={() => toggle(tu.id)} />
              ))}
            </Card>
          </View>
        );
      })}

      <Card onPress={() => router.push('/feedback')} style={styles.missing}>
        <Feather name="message-circle" size={18} color={colors.lime} />
        <AppText variant="bodyStrong" style={{ flex: 1 }}>
          {t('help.missing')}
        </AppText>
        <Feather name="chevron-right" size={18} color={colors.textMuted} />
      </Card>
    </Screen>
  );
}

function FaqRow({ tutorial, first, open, seen, onToggle }: { tutorial: Tutorial; first: boolean; open: boolean; seen: boolean; onToggle: () => void }) {
  const { t, lang } = useI18n();
  return (
    <View style={[!first && styles.border]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}>
        <View style={styles.icon}>
          <Feather name={tutorial.icon} size={17} color={colors.lime} />
        </View>
        <AppText variant="bodyStrong" style={{ flex: 1 }}>
          {tutorial.question[lang]}
        </AppText>
        {seen ? <Feather name="check-circle" size={16} color={colors.lime} accessibilityLabel={t('help.seen')} /> : null}
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
      </Pressable>
      {open ? (
        <View style={styles.body}>
          <AppText variant="body" color={colors.text}>
            {tutorial.answer[lang]}
          </AppText>
          <View style={styles.whereRow}>
            <Feather name="map-pin" size={14} color={colors.textMuted} style={{ marginTop: 2 }} />
            <AppText variant="small" muted style={{ flex: 1 }}>
              {t('help.where')}: {tutorial.where[lang]}
            </AppText>
          </View>
          <View style={styles.actions}>
            <Button
              title={t('help.watch')}
              icon="play-circle"
              size="sm"
              full={false}
              onPress={() => router.push({ pathname: '/tutorial/[id]', params: { id: tutorial.id } })}
            />
            {tutorial.tryIt ? (
              <Button title={t('help.try')} icon="arrow-right" variant="light" size="sm" full={false} onPress={() => router.push(tutorial.tryIt!)} />
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  featured: { gap: spacing.sm, borderWidth: 1, borderColor: colors.cyan },
  featuredTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  newBadge: { backgroundColor: colors.cyan, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  watch: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  list: { paddingVertical: 4 },
  border: { borderTopWidth: 1, borderTopColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12 },
  icon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  body: { gap: spacing.sm, paddingBottom: spacing.md, paddingLeft: 48 },
  whereRow: { flexDirection: 'row', gap: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  missing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
