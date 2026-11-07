// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Mehrsprachigkeit: Englisch (Standard) und Deutsch.
 *
 * - Texte stehen in ./en.ts und ./de.ts (gleiche Schlüssel – fehlt einer in de.ts, meckert tsc).
 * - In Komponenten: `const { t, tn } = useI18n();` → `t('home.title')`, `tn('common.reports', 3)`.
 * - Außerhalb von Komponenten (Helfer, API-Client): `t()` / `getLang()` lesen die aktuelle Sprache.
 * - Die Wahl wird in AsyncStorage gespeichert (im Web: localStorage) und vor dem ersten Rendern geladen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { de } from './de';
import { en, type Dict } from './en';

export type Lang = 'en' | 'de';
export type TKey = keyof Dict;
type Params = Record<string, string | number>;

/** Basisschlüssel für Pluralformen: "x_one" + "x_other" → "x". */
export type PluralKey = { [K in TKey]: K extends `${infer B}_one` ? B : never }[TKey];

export const LANGS: Lang[] = ['en', 'de'];
export const DEFAULT_LANG: Lang = 'en';
const STORAGE_KEY = 'catch.lang';
const dicts: Record<Lang, Dict> = { en, de };

let current: Lang = DEFAULT_LANG;

/** Aktuelle Sprache (für Code außerhalb von React, z. B. den API-Client). */
export function getLang(): Lang {
  return current;
}

/** BCP-47-Locale für Datums-/Zahlenformate. 24-h-Uhrzeiten auch auf Englisch (en-GB). */
export function localeOf(lang: Lang): string {
  return lang === 'de' ? 'de-DE' : 'en-GB';
}

export function translate(lang: Lang, key: TKey, params?: Params): string {
  let s: string = dicts[lang][key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

export function translatePlural(lang: Lang, base: PluralKey, count: number, params?: Params): string {
  const key = `${base}_${count === 1 ? 'one' : 'other'}` as TKey;
  return translate(lang, key, { count, ...params });
}

/** Übersetzung mit der aktuellen Sprache (außerhalb von Komponenten). */
export function t(key: TKey, params?: Params): string {
  return translate(current, key, params);
}

export function tn(base: PluralKey, count: number, params?: Params): string {
  return translatePlural(current, base, count, params);
}

function applyToDocument(lang: Lang) {
  if (Platform.OS === 'web' && typeof document !== 'undefined') document.documentElement.lang = lang;
}

interface I18nState {
  lang: Lang;
  ready: boolean;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18nState>({ lang: DEFAULT_LANG, ready: true, setLang: () => undefined });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(current);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!alive) return;
        if (stored === 'en' || stored === 'de') {
          current = stored;
          setLangState(stored);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!alive) return;
        applyToDocument(current);
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const setLang = useCallback((next: Lang) => {
    current = next; // vor dem Neu-Rendern setzen, damit Helfer sofort die neue Sprache nutzen
    setLangState(next);
    applyToDocument(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ lang, ready, setLang }), [lang, ready, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const { lang, ready, setLang } = useContext(I18nContext);
  return useMemo(
    () => ({
      lang,
      ready,
      setLang,
      locale: localeOf(lang),
      t: (key: TKey, params?: Params) => translate(lang, key, params),
      tn: (base: PluralKey, count: number, params?: Params) => translatePlural(lang, base, count, params),
    }),
    [lang, ready, setLang],
  );
}
