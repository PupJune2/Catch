// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

import { errorMessage } from '@/api/client';
import { useI18n } from '@/i18n';

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  /** Lädt neu. `silent` = vorhandene Daten stehen lassen (Pull-to-Refresh, Live-Updates). */
  reload: (silent?: boolean) => Promise<void>;
  setData: (updater: (prev: T | undefined) => T | undefined) => void;
}

/**
 * Kleiner Daten-Hook: lädt beim Mount und wenn sich `deps` ändern.
 * Lädt auch neu, wenn die App-Sprache wechselt (Server-Texte kommen dann in der neuen Sprache).
 * Ergebnisse veralteter Anfragen werden verworfen.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList, enabled = true): AsyncState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const { lang } = useI18n();
  const callId = useRef(0);
  const fnRef = useRef(fn);
  // Immer die neueste Funktion verwenden (läuft vor dem Lade-Effekt unten).
  useEffect(() => {
    fnRef.current = fn;
  });

  const run = useCallback(async (silent = false) => {
    const id = ++callId.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current();
      if (id === callId.current) setDataState(result);
    } catch (e) {
      if (id === callId.current) setError(errorMessage(e));
    } finally {
      if (id === callId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, lang, ...deps]);

  const setData = useCallback((updater: (prev: T | undefined) => T | undefined) => {
    setDataState((prev) => updater(prev));
  }, []);

  return { data, error, loading, reload: run, setData };
}

/** Entprellter Wert (z. B. für Suchfelder). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Re-render jede `ms` Millisekunden (für "vor X Min"-Anzeigen). */
export function useNow(ms = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
