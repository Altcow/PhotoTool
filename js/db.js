// IndexedDB:jcache(旅遊日誌離線快取)、jimg(事件照片快取)、expenses(帳本)、photos(照片 Blob)、pending(離線排隊的分析請求)、files(檔案紀錄)、menus(菜單範本)、rooms(我開過的團)、trips(分帳記事本活動)、uploads(雲端上傳佇列)
const DB_NAME = 'phototool';
const DB_VER = 6;
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
      ['files', 'menus', 'rooms', 'trips', 'uploads'].forEach(n => { if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: n === 'rooms' ? 'code' : 'id' }); });
      if (!db.objectStoreNames.contains('jcache')) db.createObjectStore('jcache', { keyPath: 'jid' });   // v10 旅遊日誌快取(只新增)
      if (!db.objectStoreNames.contains('jimg')) db.createObjectStore('jimg', { keyPath: 'k' });   // v12 事件照片快取 {k:<jid>/<eid>/<iNN>/<v>/t|f, b64}(只新增)
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

export const allFiles = () => tx('files', 'readonly', s => s.getAll());
export const getFile = id => tx('files', 'readonly', s => s.get(id));
export const putFile = rec => tx('files', 'readwrite', s => s.put(rec));
export const deleteFile = id => tx('files', 'readwrite', s => s.delete(id));

export const allMenus = () => tx('menus', 'readonly', s => s.getAll());
export const getMenu = id => tx('menus', 'readonly', s => s.get(id));
export const putMenu = rec => tx('menus', 'readwrite', s => s.put(rec));
export const deleteMenu = id => tx('menus', 'readwrite', s => s.delete(id));

// 我開過的團(含發起人密鑰 hostToken,只存本機)
export const allRooms = () => tx('rooms', 'readonly', s => s.getAll());
export const getRoom = code => tx('rooms', 'readonly', s => s.get(code));
export const putRoom = rec => tx('rooms', 'readwrite', s => s.put(rec));
export const deleteRoom = code => tx('rooms', 'readwrite', s => s.delete(code));

export const allTrips = () => tx('trips', 'readonly', s => s.getAll());
export const getTrip = id => tx('trips', 'readonly', s => s.get(id));
export const putTrip = rec => tx('trips', 'readwrite', s => s.put(rec));
export const deleteTrip = id => tx('trips', 'readwrite', s => s.delete(id));

// 媒體紀錄(photos store)含雲端欄位:storage / driveFileId / uploadState / attempts / lastError;舊資料沒有這些欄位視為本機
export const getPhotoRec = id => tx('photos', 'readonly', s => s.get(id));
export const putPhotoRec = rec => tx('photos', 'readwrite', s => s.put(rec));
export const allPhotoRecs = () => tx('photos', 'readonly', s => s.getAll());
export const allUploads = () => tx('uploads', 'readonly', s => s.getAll());
export const putUpload = e => tx('uploads', 'readwrite', s => s.put(e));
export const deleteUpload = id => tx('uploads', 'readwrite', s => s.delete(id));

// 旅遊日誌快取:{jid, data, at};jid='__home' 放首頁清單
export const getJCache = jid => tx('jcache', 'readonly', s => s.get(jid));
export const putJCache = rec => tx('jcache', 'readwrite', s => s.put(rec));
export const deleteJCache = jid => tx('jcache', 'readwrite', s => s.delete(jid));
// 事件照片快取(key 含版本碼 v,格子被重用也不會拿到舊圖)
export const getImg = k => tx('jimg', 'readonly', s => s.get(k));
export const putImg = rec => tx('jimg', 'readwrite', s => s.put(rec));
