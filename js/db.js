// IndexedDB:expenses(帳本)、photos(照片 Blob)、pending(離線排隊的分析請求)
const DB_NAME = 'phototool';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('expenses')) db.createObjectStore('expenses', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const allExpenses = () => tx('expenses', 'readonly', s => s.getAll());
export const getExpense = id => tx('expenses', 'readonly', s => s.get(id));
export const putExpense = rec => tx('expenses', 'readwrite', s => s.put(rec));
export const deleteExpense = async id => {
  const rec = await getExpense(id);
  if (rec && rec.photoIds) for (const pid of rec.photoIds) await deletePhoto(pid);
  return tx('expenses', 'readwrite', s => s.delete(id));
};

export const putPhoto = (id, blob, location) => tx('photos', 'readwrite', s => s.put({ id, blob, location: location || null }));
export const getPhoto = async id => { const r = await tx('photos', 'readonly', s => s.get(id)); return r ? r.blob : null; };
export const deletePhoto = id => tx('photos', 'readwrite', s => s.delete(id));

export const addPending = rec => tx('pending', 'readwrite', s => s.put(rec));
export const allPending = () => tx('pending', 'readonly', s => s.getAll());
export const deletePending = id => tx('pending', 'readwrite', s => s.delete(id));
