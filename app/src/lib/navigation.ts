// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { router } from 'expo-router';

import type { Departure, Line } from '@/api/contract';

/**
 * Router-Parameter, um eine Linie zu öffnen – optional im Kontext einer konkreten Fahrt
 * (dann kann der Linien-Screen direkt Live-Tracking für genau diese Fahrt anbieten).
 */
export interface LineRouteParams {
  key: string;
  line?: string; // JSON von Line (falls die Linie noch nie gemeldet wurde)
  tripId?: string;
  time?: string;
  headsign?: string;
  directionId?: string;
}

export function lineParams(line: Line, ctx: Partial<Omit<LineRouteParams, 'key' | 'line'>> = {}): LineRouteParams {
  const p: LineRouteParams = { key: line.key, line: JSON.stringify(line) };
  for (const [k, v] of Object.entries(ctx)) if (v) (p as unknown as Record<string, string>)[k] = v;
  return p;
}

export function departureParams(d: Departure): LineRouteParams {
  return lineParams(d.line, { tripId: d.tripId, time: d.time, headsign: d.headsign, directionId: d.directionId });
}

export function openDepartureLine(d: Departure) {
  router.push({ pathname: '/line/[key]', params: { ...departureParams(d) } });
}

export function openLine(line: Line | string, ctx: Partial<Omit<LineRouteParams, 'key' | 'line'>> = {}) {
  const params = typeof line === 'string' ? { key: line } : lineParams(line, ctx);
  router.push({ pathname: '/line/[key]', params: { ...params } });
}

export function parseLineParam(raw: string | undefined): Line | null {
  if (!raw) return null;
  try {
    const l = JSON.parse(raw) as Line;
    return l && typeof l.key === 'string' && typeof l.name === 'string' ? l : null;
  } catch {
    return null;
  }
}
