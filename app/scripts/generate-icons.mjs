// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
// Erzeugt App-Icon, Android-Adaptive-Icon, Splash- und Favicon-PNGs aus assets/ghost.svg.
// Benötigt Playwright (`npm i -D playwright && npx playwright install chromium`).
// Aufruf: npm run icons
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'assets/ghost.svg'), 'utf8');
const BG = '#16203A';

/** [Datei, Größe, Hintergrund, Anteil der Geist-Breite an der Kantenlänge] */
const targets = [
  ['assets/images/icon.png', 1024, BG, 0.56],
  ['assets/images/adaptive-icon.png', 1024, 'transparent', 0.42],
  ['assets/images/splash-icon.png', 512, 'transparent', 0.9],
  ['assets/images/favicon.png', 96, BG, 0.66],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, bg, share] of targets) {
  const w = Math.round(size * share);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${bg}">
    <div style="width:${w}px;height:${Math.round(w * 1.1)}px;transform:translateY(${Math.round(size * 0.01)}px)">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`);
  await page.screenshot({ path: join(root, file), omitBackground: bg === 'transparent' });
  console.log('✓', file);
}
await browser.close();
