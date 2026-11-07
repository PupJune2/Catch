// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import {
  COMMUTE_REMIND_OPTIONS,
  REPORT_KINDS,
  WEEKDAYS_ALL,
  WEEKDAYS_MON_FRI,
  type Commute,
  type CommuteTimeMode,
  type CreateCommuteBody,
  type Place,
  type ReportKind,
} from '@/api/contract';
import { api } from '@/api/endpoints';
import { TimeStepper } from '@/components/DayStrip';
import { EmptyState } from '@/components/EmptyState';
import { KindMultiSelect } from '@/components/kinds';
import { PlacePicker } from '@/components/PlacePicker';
import { Screen, StackHeader } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { LineBadge } from '@/components/transit';
import { AppText, Button, Card, Chip, ChipRow, ErrorBox, IconButton, Input, Notice, Skeleton, Toggle } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth';
import {
  commuteDraft,
  dayLabel,
  ensurePushForCommutes,
  slotForPlace,
  suggestName,
  toCommutePlace,
  toPlace,
  WEEKDAY_BITS,
  weekdayShort,
} from '@/lib/commutes';
import { confirm } from '@/lib/confirm';
import { formatTime, shortStopName } from '@/lib/format';
import { kindsForBody, kindsFromBody } from '@/lib/kinds';
import { placeTitle, slotLabel, useSavedPlaces } from '@/lib/places';
import { useSettings } from '@/lib/settings';
import { journeyStore } from '@/lib/store';
import { useAsync } from '@/lib/useAsync';
import { colors, radius, spacing } from '@/theme';

const pad = (n: number) => String(n).padStart(2, '0');

/** Neue Pendelstrecke anlegen (?id fehlt) oder bearbeiten (?id=…). */
export default function CommuteEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = typeof id === 'string' && id.length > 0;
  const { user } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const saved = useSavedPlaces();
  const { settings, update } = useSettings();

  const existing = useAsync<Commute | null>(
    () => api.commutes().then((r) => r.commutes.find((c) => c.id === id) ?? null),
    [id, user?.uid],
    !!user && isEdit,
  );
  const preview = useAsync(() => api.commutePreview(id!), [id, user?.uid], !!user && isEdit);

  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [weekdays, setWeekdays] = useState<number>(WEEKDAYS_MON_FRI);
  const [hours, setHours] = useState(7);
  const [minutes, setMinutes] = useState(30);
  const [timeMode, setTimeMode] = useState<CommuteTimeMode>('depart');
  const [kinds, setKinds] = useState<ReportKind[]>([...REPORT_KINDS]);
  const [remindOn, setRemindOn] = useState(true);
  const [remind, setRemind] = useState(10);
  const [active, setActive] = useState(true);
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);
  const touchedPlaces = useRef(false);
  const fromDraft = useRef(false);

  // Formular füllen: bestehende Strecke, Entwurf (z. B. aus einer Verbindung) oder Zuhause → Arbeit
  useEffect(() => {
    if (initialized.current) return;
    if (isEdit) {
      const c = existing.data;
      if (!c) return;
      setName(c.name);
      setNameTouched(true);
      setFrom(toPlace(c.from));
      setTo(toPlace(c.to));
      setWeekdays(c.weekdays);
      const [h, m] = c.time.split(':').map(Number);
      setHours(h);
      setMinutes(m);
      setTimeMode(c.timeMode);
      setKinds(kindsFromBody(c.kinds));
      setRemindOn(c.remindMinutes !== null);
      if (c.remindMinutes !== null) setRemind(c.remindMinutes);
      setActive(c.active);
      initialized.current = true;
      return;
    }
    const d = commuteDraft.take();
    if (d) {
      fromDraft.current = true;
      touchedPlaces.current = true;
      if (d.from) setFrom(d.from);
      if (d.to) setTo(d.to);
      if (d.weekdays) setWeekdays(d.weekdays);
      if (d.timeMode) setTimeMode(d.timeMode);
      if (d.time && /^\d{2}:\d{2}$/.test(d.time)) {
        const [h, m] = d.time.split(':').map(Number);
        setHours(h);
        setMinutes(m);
      }
    }
    initialized.current = true;
  }, [isEdit, existing.data]);

  // Gespeicherte Orte laden asynchron → Zuhause/Arbeit vorschlagen, solange nichts gewählt wurde
  useEffect(() => {
    if (isEdit || touchedPlaces.current) return;
    if (saved.home && !from) setFrom(saved.home);
    if (saved.work && !to) setTo(saved.work);
  }, [isEdit, saved.home, saved.work, from, to]);

  const effectiveName = nameTouched ? name : suggestName(saved, to);

  if (!user) {
    return (
      <Screen>
        <StackHeader title={t('commute.new')} />
        <EmptyState
          title={t('live.signInTitle')}
          text={t('commute.signInText')}
          action={t('home.signIn')}
          onAction={() => router.push({ pathname: '/login', params: { reason: t('commute.loginReason') } })}
        />
      </Screen>
    );
  }

  if (isEdit && existing.data === null && !existing.loading) {
    return (
      <Screen>
        <StackHeader title={t('commute.edit')} />
        <EmptyState title={t('err.404')} action={t('commute.title')} onAction={() => router.replace('/commutes')} />
      </Screen>
    );
  }

  const close = () => {
    if (fromDraft.current) router.replace('/commutes');
    else if (router.canGoBack()) router.back();
    else router.replace('/commutes');
  };

  const toggleDay = (bit: number) => setWeekdays((w) => w ^ (1 << bit));

  const save = async () => {
    setError(null);
    if (!from || !to) return setError(t('commute.pickBoth'));
    if (from.id === to.id) return setError(t('commute.same'));
    if ((weekdays & WEEKDAYS_ALL) === 0) return setError(t('commute.pickDay'));
    const body: CreateCommuteBody = {
      name: effectiveName.trim().slice(0, 40) || t('commute.nameDefault'),
      from: toCommutePlace(from),
      to: toCommutePlace(to),
      weekdays,
      time: `${pad(hours)}:${pad(minutes)}`,
      timeMode,
      active,
      kinds: kindsForBody(kinds),
      remindMinutes: remindOn ? remind : null,
    };
    setBusy(true);
    try {
      const wasActive = existing.data?.active ?? false;
      if (isEdit) await api.updateCommute(id, body);
      else await api.createCommute(body);
      // Erste aktive Strecke: Push erlauben (sonst kommen Alarme und Erinnerung nicht an)
      if (active && !wasActive && Platform.OS !== 'web') {
        const msg = await ensurePushForCommutes(settings.push, () => update({ push: true }));
        if (msg) toast(msg, 'error');
      }
      toast(t('commute.saved'), 'success');
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!isEdit) return;
    const ok = await confirm(t('commute.deleteTitle'), t('commute.deleteText'), t('commute.deleteConfirm'), true);
    if (!ok) return;
    try {
      await api.deleteCommute(id);
      toast(t('commute.deleted'), 'success');
      close();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const swap = () => {
    touchedPlaces.current = true;
    setFrom(to);
    setTo(from);
  };

  const quick = (['home', 'work'] as const).flatMap((slot) => (saved[slot] ? [{ slot, place: saved[slot]! }] : []));
  const loadingExisting = isEdit && !existing.data;
  const plan = preview.data?.plan;

  return (
    <Screen
      footer={<Button title={t('commute.save')} icon="check" size="lg" loading={busy} disabled={loadingExisting} onPress={save} />}>
      <StackHeader
        title={isEdit ? t('commute.edit') : t('commute.new')}
        onBack={close}
        right={isEdit ? <IconButton icon="trash-2" accessibilityLabel={t('commute.delete')} onPress={remove} /> : undefined}
      />

      {isEdit ? (
        <Card style={{ gap: spacing.sm }}>
          <View style={styles.previewHead}>
            <AppText variant="caption" muted style={{ flex: 1 }}>
              {t('commute.next')}
            </AppText>
            {preview.data ? (
              <AppText variant="smallStrong" color={colors.lilac}>
                {dayLabel(preview.data.targetAt)} · {formatTime(preview.data.targetAt)}
              </AppText>
            ) : null}
          </View>
          {preview.loading && !preview.data ? <Skeleton height={64} /> : null}
          {preview.error ? <ErrorBox message={preview.error} onRetry={() => preview.reload()} /> : null}
          {preview.data && !plan ? <Notice icon="alert-circle" text={t('commute.noJourney')} /> : null}
          {plan ? (
            <>
              <View style={styles.previewRow}>
                <View>
                  <AppText variant="caption" muted>
                    {t('commute.leaveAtLabel')}
                  </AppText>
                  <AppText variant="title" color={colors.lime}>
                    {formatTime(plan.leaveAt)}
                  </AppText>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  {plan.firstLine ? (
                    <View style={styles.firstLeg}>
                      <LineBadge line={plan.firstLine} size="sm" />
                      <AppText variant="smallStrong" numberOfLines={2} style={{ flex: 1 }}>
                        {t('commute.firstLeg', { time: formatTime(plan.firstDeparture), stop: shortStopName(plan.firstStop?.name) })}
                        {plan.delayMin && plan.delayMin > 0 ? <AppText variant="smallStrong" color={colors.orange}>{`  +${plan.delayMin}`}</AppText> : null}
                      </AppText>
                    </View>
                  ) : (
                    <AppText variant="smallStrong">{t('commute.walkOnly', { min: plan.journey.durationMin })}</AppText>
                  )}
                  <AppText variant="small" muted>
                    {t('commute.arrival', { time: formatTime(plan.journey.arrival) })}
                  </AppText>
                </View>
              </View>
              <Button
                title={t('commute.showJourney')}
                icon="git-commit"
                variant="light"
                size="sm"
                full={false}
                onPress={() => router.push({ pathname: '/journey', params: { id: journeyStore.put(plan.journey) } })}
              />
            </>
          ) : null}
        </Card>
      ) : null}

      <View style={{ gap: spacing.xs }}>
        <AppText variant="caption" muted>
          {t('commute.name')}
        </AppText>
        <Input
          value={effectiveName}
          onChangeText={(v) => {
            setNameTouched(true);
            setName(v);
          }}
          placeholder={t('commute.namePh')}
          maxLength={40}
          icon="tag"
        />
      </View>

      <View style={{ gap: spacing.sm }}>
        <AppText variant="caption" muted>
          {t('commute.route')}
        </AppText>
        <View>
          <View style={styles.fields}>
            <PlaceField label={t('commute.from')} place={from} placeholder={t('commute.fromPh')} dot={colors.lime} onPress={() => setPicker('from')} />
            <View style={styles.fieldDivider} />
            <PlaceField label={t('commute.to')} place={to} placeholder={t('commute.toPh')} dot={colors.orange} onPress={() => setPicker('to')} />
          </View>
          <Pressable onPress={swap} style={styles.swap} accessibilityLabel={t('commute.swap')}>
            <Feather name="repeat" size={18} color={colors.textOnLight} style={{ transform: [{ rotate: '90deg' }] }} />
          </Pressable>
        </View>
        {quick.length > 0 ? (
          // Zuhause/Arbeit (nur auf dem Gerät gespeichert) als Schnellwahl: füllt das erste leere Feld, sonst das Ziel
          <ChipRow>
            {quick.map((q) => (
              <Chip
                key={q.slot}
                label={slotLabel(q.slot)}
                icon={q.slot === 'home' ? 'home' : 'briefcase'}
                selected={from?.id === q.place.id || to?.id === q.place.id}
                onPress={() => {
                  touchedPlaces.current = true;
                  if (!from) setFrom(q.place);
                  else setTo(q.place);
                }}
              />
            ))}
          </ChipRow>
        ) : null}
      </View>

      <View style={{ gap: spacing.sm }}>
        <AppText variant="caption" muted>
          {t('commute.days')}
        </AppText>
        <View style={styles.days}>
          {WEEKDAY_BITS.map((bit) => {
            const on = (weekdays & (1 << bit)) !== 0;
            return (
              <Pressable
                key={bit}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => toggleDay(bit)}
                style={({ pressed }) => [styles.day, on && styles.dayOn, pressed && { opacity: 0.8 }]}>
                <AppText variant="smallStrong" color={on ? colors.textOnLight : colors.text}>
                  {weekdayShort(bit)}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <ChipRow>
          <Chip label={t('commute.days.weekdays')} selected={weekdays === WEEKDAYS_MON_FRI} onPress={() => setWeekdays(WEEKDAYS_MON_FRI)} />
          <Chip label={t('commute.days.all')} selected={weekdays === WEEKDAYS_ALL} onPress={() => setWeekdays(WEEKDAYS_ALL)} />
        </ChipRow>
      </View>

      <View style={{ gap: spacing.sm }}>
        <AppText variant="caption" muted>
          {t('commute.time')}
        </AppText>
        <ChipRow>
          <Chip label={t('commute.modeDepart')} icon="log-out" selected={timeMode === 'depart'} onPress={() => setTimeMode('depart')} color={colors.cyan} />
          <Chip label={t('commute.modeArrive')} icon="flag" selected={timeMode === 'arrive'} onPress={() => setTimeMode('arrive')} color={colors.cyan} />
        </ChipRow>
        <View style={styles.timeRow}>
          <TimeStepper
            hours={hours}
            minutes={minutes}
            step={5}
            onChange={(h, m) => {
              setHours(h);
              setMinutes(m);
            }}
          />
        </View>
        <AppText variant="small" color={colors.textFaint}>
          {t('commute.timeHint')}
        </AppText>
      </View>

      <Card style={{ gap: spacing.lg }}>
        <KindMultiSelect value={kinds} onChange={setKinds} label={t('commute.kindsLabel')} />
        <View style={styles.divider} />
        <SettingRow icon="clock" title={t('commute.reminder')} text={t('commute.reminderText')}>
          <Toggle value={remindOn} onChange={setRemindOn} accessibilityLabel={t('commute.reminder')} />
        </SettingRow>
        {remindOn ? (
          <ChipRow style={{ marginTop: -spacing.xs }}>
            {COMMUTE_REMIND_OPTIONS.map((n) => (
              <Chip key={n} label={t('commute.reminderMin', { n })} selected={remind === n} onPress={() => setRemind(n)} />
            ))}
          </ChipRow>
        ) : null}
        <View style={styles.divider} />
        <SettingRow icon="radio" title={t('commute.active')} text={t('commute.activeText')}>
          <Toggle value={active} onChange={setActive} accessibilityLabel={t('commute.active')} />
        </SettingRow>
      </Card>

      {error ? <ErrorBox message={error} /> : null}

      <Notice icon="lock" text={t('commute.privacy')} />
      {isEdit ? <Button title={t('commute.delete')} icon="trash-2" variant="ghost" onPress={remove} /> : null}

      <PlacePicker
        visible={picker !== null}
        title={picker === 'to' ? t('commute.pickTo') : t('commute.pickFrom')}
        onClose={() => setPicker(null)}
        onSelect={(c) => {
          touchedPlaces.current = true;
          if (picker === 'from') setFrom(c.place);
          else setTo(c.place);
        }}
      />
    </Screen>
  );
}

function PlaceField({ label, place, placeholder, dot, onPress }: { label: string; place: Place | null; placeholder: string; dot: string; onPress: () => void }) {
  const saved = useSavedPlaces();
  const slot = slotForPlace(saved, place);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.field, pressed && { opacity: 0.8 }]}>
      <View style={[styles.fieldDot, { borderColor: dot }]} />
      <View style={{ flex: 1 }}>
        <AppText variant="caption" muted>
          {label}
        </AppText>
        <AppText variant="bodyStrong" color={place ? colors.text : colors.textFaint} numberOfLines={1}>
          {place ? (slot ? `${slotLabel(slot)} · ${placeTitle(place)}` : placeTitle(place)) : placeholder}
        </AppText>
      </View>
    </Pressable>
  );
}

function SettingRow({ icon, title, text, children }: { icon: 'clock' | 'radio'; title: string; text: string; children: ReactNode }) {
  return (
    <View style={styles.setting}>
      <View style={styles.settingIcon}>
        <Feather name={icon} size={18} color={colors.lime} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        <AppText variant="small" muted>
          {text}
        </AppText>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  firstLeg: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fields: { backgroundColor: colors.surfaceDeep, borderRadius: radius.card, paddingHorizontal: spacing.md },
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 14, paddingRight: 56 },
  fieldDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
  fieldDivider: { height: 1, backgroundColor: colors.border, marginLeft: 26, marginRight: 56 },
  swap: {
    position: 'absolute',
    right: 14,
    top: '50%',
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  days: { flexDirection: 'row', gap: 6 },
  day: {
    flex: 1,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayOn: { backgroundColor: colors.lime, borderColor: colors.lime },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  divider: { height: 1, backgroundColor: colors.border },
  setting: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  settingIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
