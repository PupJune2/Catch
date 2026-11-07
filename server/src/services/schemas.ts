// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/** Gemeinsame Eingabe-Schemas (zod). */
import { z } from 'zod';
import type { Line } from '../contract.js';
import { makeLineKey } from '../transit/lineKey.js';

export const modeSchema = z.enum(['BUS', 'TRAM', 'SUBWAY', 'SUBURBAN', 'REGIONAL', 'LONG_DISTANCE', 'FERRY', 'OTHER']);

export const lineSchema = z.object({
  key: z.string().max(120).optional(),
  name: z.string().trim().min(1).max(40),
  mode: modeSchema,
  operator: z.string().trim().max(120).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const stopSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
});

/** Linie normalisieren: Der Schlüssel wird IMMER serverseitig berechnet. */
export function normalizeLine(l: z.infer<typeof lineSchema>): Line {
  const line: Line = { key: makeLineKey(l.mode, l.name, l.operator), name: l.name, mode: l.mode };
  if (l.operator) line.operator = l.operator;
  if (l.color) line.color = l.color.toLowerCase();
  if (l.textColor) line.textColor = l.textColor.toLowerCase();
  return line;
}

