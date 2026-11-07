// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiError, setTokenProvider } from '@/api/client';
import { api } from '@/api/endpoints';
import { AUTH_MODE } from '@/config';
import { t } from '@/i18n';
import { auth } from './firebase';

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  isDev: boolean;
}

interface AuthContextValue {
  user: AppUser | null;
  /** true, solange der gespeicherte Login noch geladen wird */
  initializing: boolean;
  devMode: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, displayName: string): Promise<void>;
  devSignIn(name: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const DEV_USER_KEY = 'catch.devUser';

/**
 * Läuft gerade die Registrierung (inkl. Zustimmung zu den Nutzungsbedingungen)?
 * Das Popup "Nutzungsbedingungen akzeptieren" wartet darauf, damit es nach der
 * Registrierung nicht kurz aufblitzt.
 */
let pendingTerms: Promise<void> | null = null;
export function waitForPendingTerms(): Promise<void> {
  return pendingTerms ?? Promise.resolve();
}

function toAppUser(u: User): AppUser {
  return { uid: u.uid, email: u.email, displayName: u.displayName, isDev: false };
}

/** Firebase-Fehlercodes → verständliche Meldungen in der App-Sprache. */
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return t('auth.wrongCredentials');
    case 'auth/invalid-email':
      return t('auth.invalidEmail');
    case 'auth/email-already-in-use':
      return t('auth.emailInUse');
    case 'auth/weak-password':
      return t('auth.weakPassword');
    case 'auth/too-many-requests':
      return t('auth.tooMany');
    case 'auth/network-request-failed':
      return t('auth.offline');
    case 'auth/requires-recent-login':
      return t('auth.recentLogin');
    case 'auth/missing-password':
      return t('auth.missingPassword');
    default:
      return (e as Error)?.message || t('auth.failed');
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const devMode = AUTH_MODE === 'dev';
  const [user, setUser] = useState<AppUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  // Login-Zustand beobachten
  useEffect(() => {
    if (devMode) {
      AsyncStorage.getItem(DEV_USER_KEY)
        .then((raw) => {
          if (!raw) return;
          try {
            const { uid, name } = JSON.parse(raw) as { uid: string; name: string };
            setUser({ uid, email: null, displayName: name || uid, isDev: true });
          } catch {
            setUser({ uid: raw, email: null, displayName: raw, isDev: true });
          }
        })
        .finally(() => setInitializing(false));
      return;
    }
    return onAuthStateChanged(auth, (u) => {
      setUser(u ? toAppUser(u) : null);
      setInitializing(false);
    });
  }, [devMode]);

  // Token für alle API-Aufrufe bereitstellen.
  // Dev-Modus: direkt aus dem Speicher lesen statt aus dem React-State – sonst schicken Screens,
  // deren Effekte vor diesem laufen, ihre erste Anfrage noch ohne Token ("bitte anmelden").
  useEffect(() => {
    setTokenProvider(async () => {
      if (devMode) {
        const raw = await AsyncStorage.getItem(DEV_USER_KEY).catch(() => null);
        if (!raw) return null;
        try {
          return `dev:${(JSON.parse(raw) as { uid: string }).uid}`;
        } catch {
          return `dev:${raw}`;
        }
      }
      const current = auth.currentUser;
      return current ? current.getIdToken() : null;
    });
  }, [devMode]);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  /** Registrierung – das Formular verlangt vorher das Häkchen bei den Nutzungsbedingungen. */
  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    let done: () => void = () => undefined;
    pendingTerms = new Promise<void>((resolve) => (done = resolve));
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const name = displayName.trim();
      if (name) {
        await updateProfile(cred.user, { displayName: name });
        setUser(toAppUser(cred.user));
      }
      // Zustimmung + Anzeigenamen auf dem Server speichern. Schlägt das fehl, fragt das
      // Popup beim nächsten Start erneut nach (termsAcceptedAt bleibt dann leer).
      await api.updateMe({ displayName: name || undefined, acceptTerms: true }).catch(() => undefined);
    } finally {
      done();
      pendingTerms = null;
    }
  }, []);

  const devSignIn = useCallback(async (name: string) => {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'dev';
    const displayName = name.trim() || clean;
    await AsyncStorage.setItem(DEV_USER_KEY, JSON.stringify({ uid: clean, name: displayName }));
    setUser({ uid: clean, email: null, displayName, isDev: true });
    // kurz warten, bis der Token-Provider den neuen Nutzer kennt
    setTimeout(() => api.updateMe({ displayName }).catch(() => undefined), 500);
  }, []);

  /**
   * Reset-Mail zuerst über unseren Server (eigenes Design via Resend). Hat der Server noch keinen
   * Mail-Schlüssel (503 mail_not_configured), kennt den Endpunkt nicht (404, ältere Version) oder ist
   * nicht erreichbar, schickt Firebase seine Standard-Mail. 429/400 usw. gehen mit der Server-Meldung an
   * das Formular (authErrorMessage zeigt ApiError.message).
   */
  const resetPassword = useCallback(async (email: string) => {
    const clean = email.trim();
    try {
      await api.requestPasswordReset(clean);
      return;
    } catch (e) {
      // Server nicht erreichbar, zu alt, Mail nicht eingerichtet oder Versand gescheitert →
      // Standard-Mail von Firebase. Nur 400 (ungültige Adresse) und 429 (zu oft) werden angezeigt.
      const fallback = e instanceof ApiError && (e.status === 0 || e.status === 404 || e.status >= 500);
      if (!fallback) throw e;
    }
    await sendPasswordResetEmail(auth, clean);
  }, []);

  const signOut = useCallback(async () => {
    if (devMode) {
      await AsyncStorage.removeItem(DEV_USER_KEY);
      setUser(null);
      return;
    }
    await fbSignOut(auth);
  }, [devMode]);

  const deleteAccount = useCallback(async () => {
    await api.deleteMe();
    if (devMode) {
      await AsyncStorage.removeItem(DEV_USER_KEY);
      setUser(null);
      return;
    }
    const current = auth.currentUser;
    if (current) {
      try {
        await deleteUser(current);
      } catch (e) {
        // Serverdaten sind bereits gelöscht – lokal trotzdem abmelden.
        await fbSignOut(auth);
        throw e;
      }
    }
  }, [devMode]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, initializing, devMode, signIn, signUp, devSignIn, resetPassword, signOut, deleteAccount }),
    [user, initializing, devMode, signIn, signUp, devSignIn, resetPassword, signOut, deleteAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth muss innerhalb von <AuthProvider> verwendet werden');
  return ctx;
}
