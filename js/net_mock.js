// 測試用假後端:資料放記憶體,可選用 localStorage 持久 + BroadcastChannel 讓同瀏覽器多分頁共享。
// 刻意模仿 Firebase 的行為:null/空陣列/空物件不保存。
const KEY = 'pt_mock_db';
const strip = v => {
  if (Array.isArray(v)) { const a = v.map(strip).filter(x => x !== null && x !== undefined); return a.length ? a : null; }
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach(k => { const s = strip(v[k]); if (s !== null && s !== undefined) o[k] = s; });
    return Object.keys(o).length ? o : null;
  }
  return v === undefined ? null : v;
};
const parts = p => String(p).split('/').filter(Boolean);

export function createMockStore({ storage = null, channel = null } = {}) {
  let mem = {};
  const load = () => { if (!storage) return mem; try { return JSON.parse(storage.getItem(KEY) || '{}'); } catch (_) { return {}; } };
  const save = db => { if (storage) storage.setItem(KEY, JSON.stringify(db)); else mem = db; };
  const at = (db, p) => parts(p).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), db);
  const listeners = new Set();
  const run = () => listeners.forEach(l => {
    const cur = at(load(), l.path);
    const s = JSON.stringify(cur === undefined ? null : cur);
    if (s !== l.last) { l.last = s; l.cb(cur === undefined ? null : JSON.parse(s)); }
  });
  const changed = () => { run(); if (channel) channel.postMessage(1); };
  if (channel) channel.onmessage = () => run();
  const write = (path, value) => {
    const db = load(), ps = parts(path);
    let cur = db;
    for (let i = 0; i < ps.length - 1; i++) { if (!cur[ps[i]] || typeof cur[ps[i]] !== 'object') cur[ps[i]] = {}; cur = cur[ps[i]]; }
    const s = strip(value === undefined ? null : JSON.parse(JSON.stringify(value)));
    if (s === null) delete cur[ps[ps.length - 1]]; else cur[ps[ps.length - 1]] = s;
    save(strip(db) || {});
    changed();
  };
  return {
    kind: 'mock',
    async get(path) { const v = at(load(), path); return v === undefined ? null : JSON.parse(JSON.stringify(v)); },
    async put(path, value) { write(path, value); },
    async remove(path) { write(path, null); },
    listen(path, cb) {
      const l = { path, cb, last: undefined };
      listeners.add(l);
      queueMicrotask(() => { if (listeners.has(l)) { const cur = at(load(), path); l.last = JSON.stringify(cur === undefined ? null : cur); cb(cur === undefined ? null : JSON.parse(l.last)); } });
      return () => listeners.delete(l);
    },
  };
}
