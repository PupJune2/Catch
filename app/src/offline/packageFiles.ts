// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Ablage der Fahrplanpakete im Web: IndexedDB (localStorage wäre mit 1–8 MB je Paket zu klein).
 * Ein put() in einer Transaktion ist atomar – ein abgebrochener Download hinterlässt nichts.
 * (App-Gegenstück: packageFiles.native.ts mit expo-file-system.)
 */

const DB_NAME = 'catch-offline';
const STORE = 'packages';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    }).catch((e) => {
      dbPromise = null; // nächster Versuch darf neu öffnen
      throw e;
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        let result: T;
        req.onsuccess = () => {
          result = req.result;
        };
        // Erst nach dem Commit melden – dann ist der Wert wirklich gespeichert
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? req.error ?? new Error('IndexedDB error'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      }),
  );
}

export const packageFiles = {
  async write(id: string, text: string): Promise<void> {
    await run('readwrite', (s) => s.put(text, id));
  },

  async read(id: string): Promise<string | null> {
    const v = await run<unknown>('readonly', (s) => s.get(id));
    return typeof v === 'string' ? v : null;
  },

  async remove(id: string): Promise<void> {
    await run('readwrite', (s) => s.delete(id));
  },

  async list(): Promise<string[]> {
    const keys = await run('readonly', (s) => s.getAllKeys());
    return keys.filter((k): k is string => typeof k === 'string');
  },
};
