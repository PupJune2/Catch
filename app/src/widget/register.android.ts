// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Registriert den Headless-Task des Homescreen-Widgets (nur Android). Wird vom Einstiegspunkt
 * app/index.ts geladen – auch wenn Android die App nur für das Widget im Hintergrund startet.
 */
import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { widgetTaskHandler } from './taskHandler';

registerWidgetTaskHandler(widgetTaskHandler);
