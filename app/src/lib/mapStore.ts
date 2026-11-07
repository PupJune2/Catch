// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Übergabe an die Karte (/map), ohne große Daten in die URL zu packen:
 *   showJourneyOnMap(journey); router.push('/map?focus=journey');
 * Die Kartenseite holt die Verbindung einmalig mit takeJourneyForMap() ab.
 */
import type { Journey } from '@/api/contract';

let pendingJourney: Journey | null = null;

export function showJourneyOnMap(journey: Journey): void {
  pendingJourney = journey;
}

export function takeJourneyForMap(): Journey | null {
  const j = pendingJourney;
  pendingJourney = null;
  return j;
}
