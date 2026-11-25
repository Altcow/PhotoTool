// 測試用假後端:資料放記憶體,可選用 localStorage 持久 + BroadcastChannel 讓同瀏覽器多分頁共享。
// 刻意模仿 Firebase 的行為:null/空陣列/空物件不保存。
// 選項 rules(Policy.create 的結果)+ getToken:開啟後每次讀寫先過規則影子(旅遊日誌用);沒給就不檢查(舊測試)。
import { NetError } from './net.js';

const KEY = 'pt_mock_db';
const AUTH_KEY = 'pt_mock_auth';
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
const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
// {".sv":"timestamp"} → 伺服器時間
const resolveSv = (v, now) => {
  if (v && typeof v === 'object') {
    if (v['.sv'] === 'timestamp') return now;
    const o = Array.isArray(v) ? [] : {};
    Object.keys(v).forEach(k => { o[k] = resolveSv(v[k], now); });
    return o;
  }
  return v;
};

// 假 token:mock.<uid>.<到期毫秒>
export const mockToken = (uid, exp) => 'mock.' + uid + '.' + exp;
export function decodeMockToken(t, now) {
  if (!t) return null;
  const m = /^mock\.([^.]+)\.(\d+)$/.exec(String(t));
  if (!m) throw new NetError('AUTH_EXPIRED', '登入資料無效');
  if (Number(m[2]) <= now) throw new NetError('AUTH_EXPIRED', '登入已過期');
  return m[1];
}

export function createMockStore({ storage = null, channel = null, rules = null, getToken = null, now = () => Date.now() } = {}) {
  let mem = {};
  const load = () => { if (!storage) return mem; try { return JSON.parse(storage.getItem(KEY) || '{}'); } catch (_) { return {}; } };
  const save = db => { if (storage) storage.setItem(KEY, JSON.stringify(db)); else mem = db; };
  const at = (db, p) => parts(p).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), db);
  const listeners = new Set();
  const uidNow = async () => {
    if (!getToken) return null;
    let tok;
    try { tok = await getToken(); } catch (e) { throw new NetError('AUTH_EXPIRED', e.message); }
    return decodeMockToken(tok, now());
  };
  const readOk = (db, uid, path) => !rules || rules.canRead(db, uid, path, now());
  const run = () => listeners.forEach(async l => {
    if (!listeners.has(l)) return;
    let db = load(), uid = null;
    try { uid = await uidNow(); } catch (e) { listeners.delete(l); if (l.onError) l.onError(e); return; }
    if (!readOk(db, uid, l.path)) { listeners.delete(l); if (l.onError) l.onError(new NetError('PERMISSION', '這本日誌不再開放給你看')); return; }
    db = load();
    const cur = at(db, l.path);
    const s = JSON.stringify(cur === undefined ? null : cur);
    if (s !== l.last) { l.last = s; l.cb(cur === undefined ? null : JSON.parse(s)); }
  });
  const changed = () => { run(); if (channel) channel.postMessage(1); };
  if (channel) channel.onmessage = () => run();
  const setIn = (db, path, value) => {
    const ps = parts(path);
    let cur = db;
    for (let i = 0; i < ps.length - 1; i++) { if (!cur[ps[i]] || typeof cur[ps[i]] !== 'object') cur[ps[i]] = {}; cur = cur[ps[i]]; }
    const s = strip(value === undefined ? null : clone(value));
    if (s === null) delete cur[ps[ps.length - 1]]; else cur[ps[ps.length - 1]] = s;
  };
  // writes: [[path, value]];全部先驗證再一起寫入(多路徑要嘛全成功要嘛全失敗)
  const commit = async (writes, ifNewPath) => {
    const uid = await uidNow();
    if (ifNewPath) { const cur = at(load(), ifNewPath); if (cur !== undefined && cur !== null) throw new NetError('EXISTS', '這個位置已經有內容了'); }   // 檢查與寫入之間沒有 await,等同伺服器的原子條件寫入
    const t = now();
    const ws = writes.map(([p, v]) => [p, resolveSv(v, t)]);
    const pre = load();
    const post = clone(pre);
    ws.forEach(([p, v]) => setIn(post, p, v));
    const postS = strip(post) || {};
    if (rules) {
      const r = rules.checkWrite(pre, postS, uid, ws.map(w => w[0]), t);
      if (!r.ok) throw new NetError('PERMISSION', '你沒有權限做這件事:' + r.reason);
    }
    save(postS);
    changed();
  };
  return {
    kind: 'mock',
    async get(path) {
      const db = load();
      if (rules && !readOk(db, await uidNow(), path)) throw new NetError('PERMISSION', '你沒有權限做這件事');
      const v = at(db, path); return v === undefined ? null : JSON.parse(JSON.stringify(v));
    },
    async put(path, value, o) {
      await commit([[path, value]], o && o.ifNew ? path : null);
    },
    async patch(path, obj) {
      const base = parts(path).join('/');
      await commit(Object.keys(obj || {}).map(k => [(base ? base + '/' : '') + k, obj[k]]));
    },
    async remove(path) { await commit([[path, null]]); },
    listen(path, cb, onError) {
      const l = { path, cb, onError, last: undefined };
      listeners.add(l);
      queueMicrotask(async () => {
        if (!listeners.has(l)) return;
        try {
          const uid = await uidNow(), db = load();
          if (!readOk(db, uid, path)) { listeners.delete(l); if (onError) onError(new NetError('PERMISSION', '這本日誌不再開放給你看')); return; }
          const cur = at(db, path); l.last = JSON.stringify(cur === undefined ? null : cur); cb(cur === undefined ? null : JSON.parse(l.last));
        } catch (e) { listeners.delete(l); if (onError) onError(e); }
      });
      return () => listeners.delete(l);
    },
  };
}

// 假的 Firebase Auth REST(identitytoolkit / securetoken),給旅遊日誌模擬模式與測試用:帳號放在 storage
export function createMockAuthFetch({ storage = null, now = () => Date.now(), ttl = 3600 * 1000 } = {}) {
  let mem = { users: {}, refresh: {}, sent: [] };
  const load = () => { if (!storage) return mem; try { return Object.assign({ users: {}, refresh: {}, sent: [] }, JSON.parse(storage.getItem(AUTH_KEY) || '{}')); } catch (_) { return { users: {}, refresh: {}, sent: [] }; } };
  const save = d => { if (storage) storage.setItem(AUTH_KEY, JSON.stringify(d)); else mem = d; };
  const rnd = n => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const err = m => reply(400, { error: { code: 400, message: m } });
  const tokens = uid => {
    const d = load(), rt = 'rt' + rnd(24);
    d.refresh[rt] = uid; save(d);
    return { localId: uid, refreshToken: rt, idToken: mockToken(uid, now() + ttl), expiresIn: String(Math.floor(ttl / 1000)) };
  };
  const uidOf = idToken => { try { return decodeMockToken(idToken, now()); } catch (_) { return null; } };
  const fetchFn = async (u, init) => {
    const url = String(u), d = load();
    const body = init && init.body ? (String(init.headers && init.headers['content-type']).includes('json') ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body))) : {};
    if (/securetoken\.googleapis\.com\/v1\/token/.test(url)) {
      const uid = d.refresh[body.refresh_token];
      if (!uid || !d.users[uid]) return err('INVALID_REFRESH_TOKEN');
      return reply(200, { id_token: mockToken(uid, now() + ttl), refresh_token: body.refresh_token, expires_in: String(Math.floor(ttl / 1000)), user_id: uid });
    }
    const m = /accounts:(\w+)/.exec(url);
    if (!m) return err('UNKNOWN');
    const email = String(body.email || '').trim().toLowerCase();
    if (m[1] === 'signUp') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('INVALID_EMAIL');
      if (String(body.password || '').length < 6) return err('WEAK_PASSWORD : Password should be at least 6 characters');
      if (Object.values(d.users).some(x => x.email === email)) return err('EMAIL_EXISTS');
      const uid = 'u' + rnd(20);
      d.users[uid] = { email, password: body.password, providers: ['password'] }; save(d);
      return reply(200, Object.assign({ email }, tokens(uid)));
    }
    if (m[1] === 'signInWithPassword') {
      const e = Object.entries(d.users).find(([, x]) => x.email === email && x.password === body.password);
      if (!e) return err('INVALID_LOGIN_CREDENTIALS');
      return reply(200, Object.assign({ email }, tokens(e[0])));
    }
    if (m[1] === 'sendOobCode') { d.sent.push({ type: body.requestType, email, at: now() }); save(d); return reply(200, { email }); }
    if (m[1] === 'lookup') {
      const uid = uidOf(body.idToken);
      if (!uid || !d.users[uid]) return err('INVALID_ID_TOKEN');
      const x = d.users[uid];
      return reply(200, { users: [{ localId: uid, email: x.email, providerUserInfo: x.providers.map(p => ({ providerId: p, photoUrl: p === 'google.com' ? 'https://lh3.googleusercontent.com/mock' : undefined })) }] });
    }
    if (m[1] === 'signInWithIdp') {
      // 假的 Google id token:'g:<email>'
      const gt = /id_token=([^&]+)/.exec(String(body.postBody || ''));
      const gm = gt && /^g:(.+@.+)$/.exec(decodeURIComponent(gt[1]));
      if (!gm) return err('INVALID_IDP_RESPONSE');
      const gmail = gm[1].toLowerCase();
      const linked = Object.entries(d.users).find(([, x]) => x.googleEmail === gmail);
      if (body.idToken) {
        const uid = uidOf(body.idToken);
        if (!uid || !d.users[uid]) return err('INVALID_ID_TOKEN');
        if (linked && linked[0] !== uid) return err('FEDERATED_USER_ID_ALREADY_LINKED');
        d.users[uid].googleEmail = gmail; if (d.users[uid].providers.indexOf('google.com') < 0) d.users[uid].providers.push('google.com'); save(d);
        return reply(200, Object.assign({ email: d.users[uid].email, photoUrl: 'https://lh3.googleusercontent.com/mock', displayName: gmail.split('@')[0] }, tokens(uid)));
      }
      let uid = linked && linked[0];
      if (!uid) { uid = 'u' + rnd(20); d.users[uid] = { email: gmail, googleEmail: gmail, providers: ['google.com'] }; save(d); }
      return reply(200, Object.assign({ email: d.users[uid].email, photoUrl: 'https://lh3.googleusercontent.com/mock', displayName: gmail.split('@')[0] }, tokens(uid)));
    }
    return err('UNKNOWN');
  };
  fetchFn.sent = () => load().sent;
  return fetchFn;
}
