// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import type { Tutorial } from '../types';
import { commuteTutorial } from './commute';
import { reportTutorial } from './report';
import { trackingTutorial } from './tracking';
import { widgetTutorial } from './widget';

/** Tutorials "Melden & Alarme" & "App" (Melden, Live-Tracking, Pendelstrecke, Widget). */
export const GROUP_ALERTS: Tutorial[] = [reportTutorial, trackingTutorial, commuteTutorial, widgetTutorial];
