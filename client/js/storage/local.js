const DB_NAME = "slateboard-phase1";
const STORE_NAME = "boards";
const DB_VERSION = 1;
const BOARD_KEY = "local-board";

function createDebounced(fn, wait) {
  let timeoutId = 0;

  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      fn(...args);
    }, wait);
  };
}

export class LocalBoardStore {
  constructor() {
    this.dbPromise = null;
  }

  async open() {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });

    try {
      return await this.dbPromise;
    } catch (error) {
      console.error("Unable to open IndexedDB", error);
      this.dbPromise = null;
      throw error;
    }
  }

  async save(snapshot) {
    try {
      const db = await this.open();

      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.put(snapshot, BOARD_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (error) {
      console.error("Unable to save board snapshot", error);
      throw error;
    }
  }

  async load() {
    try {
      const db = await this.open();

      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(BOARD_KEY);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("Unable to load board snapshot", error);
      return null;
    }
  }

  createSaver(getSnapshot, onStatusChange) {
    return createDebounced(async () => {
      onStatusChange("Saving...");

      try {
        await this.save(getSnapshot());
        onStatusChange("Saved");
      } catch (error) {
        console.error("Auto-save failed", error);
        onStatusChange("Save failed");
      }
    }, 500);
  }
}
