// Almacén local (IndexedDB). Todo se guarda aquí primero; la sincronización con el PFS va aparte (api.js).
const DB_NAME = 'mensajero';
const DB_VERSION = 1;

let dbPromise = null;

function abrir() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('servicios')) {
        db.createObjectStore('servicios', { keyPath: 'client_uuid' });
      }
      if (!db.objectStoreNames.contains('tarifas')) {
        db.createObjectStore('tarifas', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'clave' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, modo, fn) {
  return abrir().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, modo);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function todos(store) {
  return abrir().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}

export const servicios = {
  todos: () => todos('servicios'),
  guardar: (s) => tx('servicios', 'readwrite', (st) => st.put(s)),
  obtener: (uuid) => abrir().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction('servicios', 'readonly').objectStore('servicios').get(uuid);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  })),
};

export const tarifas = {
  todas: () => todos('tarifas'),
  reemplazar: (lista) => tx('tarifas', 'readwrite', (st) => {
    st.clear();
    lista.forEach((t) => st.put(t));
  }),
};

export const meta = {
  get: (clave) => abrir().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction('meta', 'readonly').objectStore('meta').get(clave);
    req.onsuccess = () => resolve(req.result ? req.result.valor : null);
    req.onerror = () => reject(req.error);
  })),
  set: (clave, valor) => tx('meta', 'readwrite', (st) => st.put({ clave, valor })),
};
