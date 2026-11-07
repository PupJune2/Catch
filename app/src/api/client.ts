// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import { API_URL } from '@/config';
import { getLang, t, type TKey } from '@/i18n';
import type { ApiError as ApiErrorBody } from './contract';

/** Fehler eines API-Aufrufs mit anzeigbarer Meldung (in der App-Sprache). */
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Liefert das aktuelle Auth-Token (Firebase-ID-Token oder "dev:<name>"), oder null. */
type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider = async () => null;

export function setTokenProvider(fn: TokenProvider) {
  tokenProvider = fn;
}

export function getAuthToken(): Promise<string | null> {
  return tokenProvider();
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Query;
  body?: unknown;
  /** required: wirft 401 ohne Login · optional: Token mitsenden, wenn vorhanden · none */
  auth?: 'required' | 'optional' | 'none';
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Query): string {
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  return `${API_URL}${path}${qs ? `?${qs}` : ''}`;
}

const STATUS_KEYS: Record<number, TKey> = {
  400: 'err.400',
  401: 'err.401',
  403: 'err.403',
  404: 'err.404',
  409: 'err.409',
  429: 'err.429',
  502: 'err.502',
  503: 'err.503',
};

function statusMessage(status: number): string {
  const key = STATUS_KEYS[status];
  return key ? t(key) : t('err.unexpected', { status });
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, auth = 'none', signal } = opts;
  // Der Server antwortet (Fehlermeldungen, Prognose-Texte) in der App-Sprache.
  const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': getLang() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (auth !== 'none') {
    const token = await tokenProvider();
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (auth === 'required') throw new ApiError(401, 'unauthenticated', t('err.loginRequired'));
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', t('err.network'));
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      res.status,
      err.error ?? `http_${res.status}`,
      err.message ?? statusMessage(res.status),
    );
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return t('err.generic');
}
