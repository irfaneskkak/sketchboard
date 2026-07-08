import { isValidDoc, normalizeDoc } from './types';
import type { Doc } from './types';

const DB_NAME = 'sketchboard';
const DB_VERSION = 1;
const STORE = 'documents';
const CURRENT_KEY = 'current';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}

export interface SavedSession {
  doc: Doc;
  savedAt: number;
}

/**
 * Persist the document. Serialized via JSON round-trip so a crash mid-write
 * can never leave live object references in a broken state, and so invalid
 * data is caught on load rather than restored blindly.
 */
export async function saveSession(doc: Doc): Promise<void> {
  const db = await getDB();
  const payload: SavedSession = { doc: JSON.parse(JSON.stringify(doc)), savedAt: Date.now() };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(payload, CURRENT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Load the last saved session; returns null if absent or unusable. */
export async function loadSession(): Promise<SavedSession | null> {
  try {
    const db = await getDB();
    const payload = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(CURRENT_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!payload || typeof payload !== 'object') return null;
    const session = payload as SavedSession;
    if (!isValidDoc(session.doc)) return null;
    return { doc: normalizeDoc(session.doc), savedAt: session.savedAt ?? 0 };
  } catch {
    // Corrupted store or unavailable IndexedDB: fail gracefully with a fresh doc.
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(CURRENT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}
