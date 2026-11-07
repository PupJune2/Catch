// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import pg from 'pg';

export type Db = pg.Pool;

export function createPool(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // bigint/bigserial als string liefern (Standard von pg) – IDs bleiben so verlustfrei.
  return pool;
}
