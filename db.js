// db.js — wrapper IndexedDB simple, sans dépendance externe
const DB_NAME = 'parcelles-db';
const DB_VERSION = 1;
const STORE_PARCELS = 'parcels';
const STORE_PROSPECTS = 'prospects';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_PARCELS)) {
        db.createObjectStore(STORE_PARCELS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_PROSPECTS)) {
        db.createObjectStore(STORE_PROSPECTS, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDb().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

const DB = {
  async getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async get(storeName, id) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async put(storeName, record) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  },

  async delete(storeName, id) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  },

  async exportAll() {
    const parcels = await DB.getAll(STORE_PARCELS);
    const prospects = await DB.getAll(STORE_PROSPECTS);
    return { exportedAt: new Date().toISOString(), parcels, prospects };
  },

  async importAll(data) {
    if (Array.isArray(data.parcels)) {
      for (const p of data.parcels) await DB.put(STORE_PARCELS, p);
    }
    if (Array.isArray(data.prospects)) {
      for (const p of data.prospects) await DB.put(STORE_PROSPECTS, p);
    }
  },

  STORE_PARCELS,
  STORE_PROSPECTS
};

window.DB = DB;
