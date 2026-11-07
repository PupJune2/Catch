// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import type { Tutorial } from '../types';
import { address } from './address';
import { cardColors } from './cardColors';
import { map } from './mapTutorial';
import { offline } from './offlineTutorial';

/** Tutorials "Fahrten planen" & "Unterwegs" (Adresse, Farben/Gleise, Karte, Offline). */
export const GROUP_PLAN: Tutorial[] = [address, cardColors, map, offline];
