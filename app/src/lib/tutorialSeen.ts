// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

/** Welche Tutorials schon bis zum Ende angesehen wurden (nur auf dem Gerät gespeichert). */
const KEY = 'catch.tutorials.seen';
let seen: Set<string> | null = null;
const listeners = new Set<(s: Set<string>) => void>();

async function load(): Promise<Set<string>> {
  if (seen) return seen;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    seen = new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    seen = new Set();
  }
  return seen;
}

export async function markTutorialSeen(id: string): Promise<void> {
  const s = await load();
  if (s.has(id)) return;
  seen = new Set(s).add(id);
  AsyncStorage.setItem(KEY, JSON.stringify([...seen])).catch(() => undefined);
  for (const l of listeners) l(seen);
}

export function useSeenTutorials(): Set<string> {
  const [value, setValue] = useState<Set<string>>(() => seen ?? new Set());
  useEffect(() => {
    let alive = true;
    load().then((s) => alive && setValue(s));
    listeners.add(setValue);
    return () => {
      alive = false;
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
