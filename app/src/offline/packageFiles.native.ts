// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Ablage der Fahrplanpakete in der App (Android/iOS): <documentDirectory>/offline/<id>.json.
 * Das Dokumentverzeichnis wird vom System nicht aufgeräumt (anders als der Cache).
 *
 * Atomar: erst in "<id>.json.tmp" schreiben, dann umbenennen – ein abgebrochener Download
 * oder ein App-Abbruch beim Schreiben hinterlässt nie ein halbes Paket unter dem echten Namen.
 * (Web-Gegenstück: packageFiles.ts mit IndexedDB.)
 */
import { Directory, File, Paths } from 'expo-file-system';

function dir(): Directory {
  const d = new Directory(Paths.document, 'offline');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

export const packageFiles = {
  async write(id: string, text: string): Promise<void> {
    const d = dir();
    const tmp = new File(d, `${id}.json.tmp`);
    if (tmp.exists) tmp.delete();
    await tmp.write(text);
    await tmp.move(new File(d, `${id}.json`), { overwrite: true });
  },

  async read(id: string): Promise<string | null> {
    const f = new File(dir(), `${id}.json`);
    if (!f.exists) return null;
    return f.text();
  },

  async remove(id: string): Promise<void> {
    const d = dir();
    for (const name of [`${id}.json`, `${id}.json.tmp`]) {
      const f = new File(d, name);
      if (f.exists) f.delete();
    }
  },

  /** Gespeicherte Paket-IDs (zum Aufräumen verwaister Dateien). Reste von Abbrüchen (.tmp) werden gelöscht. */
  async list(): Promise<string[]> {
    const ids: string[] = [];
    for (const entry of dir().list()) {
      if (!(entry instanceof File)) continue;
      if (entry.name.endsWith('.json.tmp')) {
        try {
          entry.delete();
        } catch {
          // egal – wird beim nächsten Mal versucht
        }
      } else if (entry.name.endsWith('.json')) {
        ids.push(entry.name.slice(0, -'.json'.length));
      }
    }
    return ids;
  },
};
