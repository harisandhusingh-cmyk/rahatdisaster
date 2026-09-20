export type AppDatabaseSnapshot = Record<string, unknown>;

const DB_NAME = 'rahat-db';
const STORE_NAME = 'app-state';
const STATE_KEY = 'workspace';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not supported in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
  });
}

export async function saveAppState(snapshot: AppDatabaseSnapshot): Promise<void> {
  const db = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(snapshot, STATE_KEY);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Failed to save app state.'));
  });

  db.close();
}

export async function loadAppState(): Promise<AppDatabaseSnapshot | null> {
  try {
    const db = await openDatabase();
    const result = await new Promise<AppDatabaseSnapshot | null>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(STATE_KEY);

      request.onsuccess = () => {
        const value = request.result as AppDatabaseSnapshot | undefined;
        resolve(value ?? null);
      };
      request.onerror = () => reject(request.error ?? new Error('Failed to load app state.'));
    });

    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function clearAppState(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(STATE_KEY);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('Failed to clear app state.'));
    });
    db.close();
  } catch {
    // Ignore cleanup failures so the app still works in restricted browsers.
  }
}
