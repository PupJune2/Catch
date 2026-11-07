// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
import type { Feather } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import type { ComponentProps, ComponentType } from 'react';

import type { Lang } from '@/i18n';

/** Text in beiden App-Sprachen. */
export interface L10n {
  en: string;
  de: string;
}

export interface TutorialStep {
  caption: L10n;
  /** Wohin der Finger zeigt – Koordinaten im Mock-Telefon (PHONE.w × PHONE.h). Fehlt = kein Finger. */
  target?: { x: number; y: number };
  /** false = nur zeigen, nicht antippen (Standard: antippen) */
  tap?: boolean;
  /** Lesezeit in ms, bevor getippt bzw. weitergeschaltet wird (Standard 2200) */
  read?: number;
}

export interface SceneProps {
  /** Aktueller Schritt (0 … steps.length − 1). Die Szene zeigt den Zustand VOR dem Tippen dieses Schritts. */
  step: number;
  lang: Lang;
}

export type TutorialCategory = 'plan' | 'ride' | 'report' | 'app';

export interface Tutorial {
  id: string;
  icon: ComponentProps<typeof Feather>['name'];
  category: TutorialCategory;
  /** "Kann ich …?" – so wie Nutzer fragen */
  question: L10n;
  /** Kurze Antwort für die FAQ-Liste */
  answer: L10n;
  /** Wo die Funktion steckt, z. B. "Suche → Verbindung → Fahrten ändern" */
  where: L10n;
  /** "Selbst ausprobieren" führt hierhin */
  tryIt?: Href;
  /** Hervorgehoben (neu) */
  featured?: boolean;
  steps: TutorialStep[];
  Scene: ComponentType<SceneProps>;
}
