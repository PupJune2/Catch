// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Ländliche Ziele, Wochenende: Fährt in den nächsten Stunden nichts bis in die Nähe einer Adresse,
 * zeigt MOTIS sonst erst die Verbindung am nächsten Morgen. Dann suchen wir ein zweites Mal mit
 * bis zu 60 Min. Fußweg an der Adresse und bieten diese Verbindungen zusätzlich an (klar markiert).
 *
 * Beispiel: Gelsenkirchen → Dülmen-Börnste am Sonntag: RE42 + 59 Min. zu Fuß statt "morgen 05:25".
 * Oft fährt dort ein AST (Anruf-Sammel-Taxi), das nicht in den offenen Fahrplandaten steht.
 */
import type { Journey } from '../contract.js';

/** Erst wenn die erste normale Verbindung später als das losfährt, wird zusätzlich gesucht. */
export const LONG_WALK_GAP_MS = 3 * 3600_000;
/** Längster Fußweg in der zweiten Suche (Sekunden). */
export const LONG_WALK_MAX_SEC = 3600;

/** "52.5,13.4" (Koordinate statt Haltestelle)? Erwartet die Ausgabe von motisPlaceParam. */
export function isCoordinate(motisPlace: string): boolean {
  return /^-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?$/.test(motisPlace);
}

/** Braucht es den zweiten Versuch mit langem Fußweg? */
export function needsLongWalk(journeys: Journey[], requestedAt: number): boolean {
  if (!journeys.length) return true;
  const first = Math.min(...journeys.map((j) => Date.parse(j.departure)));
  return first - requestedAt > LONG_WALK_GAP_MS;
}

/**
 * Aus der zweiten Suche nur, was wirklich hilft: fährt in den nächsten 3 Stunden los und ist früher
 * da als die beste normale Verbindung. Markiert mit longWalk und der Länge des längsten Fußwegs.
 */
export function pickLongWalk(primary: Journey[], alternatives: Journey[], requestedAt: number): Journey[] {
  const bestArrival = primary.length ? Math.min(...primary.map((j) => Date.parse(j.arrival))) : Infinity;
  return alternatives
    .filter((j) => Date.parse(j.departure) - requestedAt <= LONG_WALK_GAP_MS && Date.parse(j.arrival) < bestArrival)
    .filter((j) => j.legs.some((l) => !l.walking))
    .map((j) => ({
      ...j,
      id: `lw-${j.id}`,
      longWalk: true,
      longWalkMin: Math.max(0, ...j.legs.filter((l) => l.walking).map((l) => l.durationMin)),
    }));
}
