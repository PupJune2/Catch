// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { changeRides } from './scenes/changeRides';
import { GROUP_ALERTS } from './scenes/groupAlerts';
import { GROUP_PLAN } from './scenes/groupPlan';
import type { Tutorial, TutorialCategory } from './types';

/** Alle Tutorials ("Kann ich …?") in Anzeige-Reihenfolge. */
export const TUTORIALS: Tutorial[] = [changeRides, ...GROUP_PLAN, ...GROUP_ALERTS];

export const CATEGORY_ORDER: TutorialCategory[] = ['plan', 'ride', 'report', 'app'];

export function tutorialById(id: string | undefined): Tutorial | undefined {
  return TUTORIALS.find((t) => t.id === id);
}

export type { Tutorial, TutorialCategory } from './types';
