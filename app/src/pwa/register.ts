// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/** App (Android/iOS): kein Service Worker. Web: register.web.ts. */
export function registerServiceWorker(): void {
  // nichts zu tun
}

export function onOfflineReady(_listener: () => void): () => void {
  return () => undefined;
}
