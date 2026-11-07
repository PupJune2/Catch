// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import { REPORT_KINDS, REPORT_TAGS, type ReportKind, type ReportTag } from '@/api/contract';
import { t, type TKey } from '@/i18n';

/**
 * Darstellung der Hinweis-Arten: Icon + Label + Akzentfarbe.
 * Die Akzentfarben sind bewusst andere als die Status-Farben (lime/lila/orange),
 * damit "Art" und "Lage" nicht verwechselt werden.
 */
export type KindIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export const KIND_ICON: Record<ReportKind, KindIconName> = {
  DELAY: 'clock-outline',
  CANCELLED: 'close-circle-outline',
  CROWDED: 'account-group-outline',
  DISRUPTION: 'alert-outline',
  CHECK: 'ticket-confirmation-outline',
};

export const KIND_COLOR: Record<ReportKind, string> = {
  DELAY: '#FFC94D',
  CANCELLED: '#FF8A8A',
  CROWDED: '#8FB8FF',
  DISRUPTION: '#FFA8D2',
  CHECK: '#7EDCC4',
};

/** Ältere Server liefern evtl. noch keine Art → wie früher "Kontrolle". */
export function kindOf(r: { kind?: ReportKind | null }): ReportKind {
  return r.kind && REPORT_KINDS.includes(r.kind) ? r.kind : 'CHECK';
}

export function kindLabel(kind: ReportKind): string {
  return t(`kind.${kind}` as TKey);
}

export function kindHint(kind: ReportKind): string {
  return t(`kind.hint.${kind}` as TKey);
}

export function kindQuestion(kind: ReportKind): string {
  return t(`kind.q.${kind}` as TKey);
}

export function kindSubmit(kind: ReportKind): string {
  return t(`kind.submit.${kind}` as TKey);
}

/** Auswahl → Wert für die API: alle gewählt = [] (heißt "alle Arten", auch künftige). */
export function kindsForBody(selected: ReportKind[]): ReportKind[] {
  const set = new Set(selected);
  return set.size >= REPORT_KINDS.length ? [] : REPORT_KINDS.filter((k) => set.has(k));
}

/** Gespeicherte Auswahl ([] = alle) → Liste für die Chips. */
export function kindsFromBody(kinds: ReportKind[] | undefined | null): ReportKind[] {
  return kinds && kinds.length ? REPORT_KINDS.filter((k) => kinds.includes(k)) : [...REPORT_KINDS];
}

const CURRENT_TAGS = new Set<ReportTag>(REPORT_TAGS);

/** Merkmale zum Anzeigen – veraltete (Personenbeschreibungen) werden nicht mehr gezeigt. */
export function visibleTags(tags: ReportTag[]): ReportTag[] {
  return tags.filter((tag) => CURRENT_TAGS.has(tag));
}
