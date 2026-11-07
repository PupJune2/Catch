// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import type { Journey } from '@/api/contract';

/**
 * Winziger In-Memory-Speicher, um größere Objekte zwischen Screens zu übergeben
 * (Router-Parameter sind nur Strings). Nach einem App-Neustart ist er leer –
 * Screens müssen damit umgehen können.
 */
const journeys = new Map<string, Journey>();

export const journeyStore = {
  put(journey: Journey): string {
    journeys.set(journey.id, journey);
    // nicht unbegrenzt wachsen lassen
    if (journeys.size > 50) {
      const first = journeys.keys().next().value;
      if (first !== undefined) journeys.delete(first);
    }
    return journey.id;
  },
  get(id: string | undefined): Journey | undefined {
    return id ? journeys.get(id) : undefined;
  },
};
