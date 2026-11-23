// Firebase Realtime Database 的 REST + EventSource(SSE)實作,不使用 SDK。
// 網址由使用者在設定頁輸入(或來自分享連結),不內建。依賴全域 Rtdb(js/lib/rtdb.js)
import { NetError } from './net.js';

export function createFirebaseStore(dbUrl) {
  const base = String(dbUrl || '').trim().replace(/\/+$/, '');
  const url = p => base + '/' + String(p).replace(/^\/+/, '') + '.json';
  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(url(path), { method, headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (e) { throw new NetError('NETWORK', '連線失敗,請檢查網路'); }
    if (res.status === 401 || res.status === 403) throw new NetError('PERMISSION', '資料庫拒絕這個操作(權限規則)');
    if (!res.ok) throw new NetError('HTTP', '資料庫錯誤 ' + res.status);
    return method === 'GET' ? res.json() : null;
  }
  return {
    kind: 'firebase',
    async get(path) { return globalThis.Rtdb.fromFirebase(await call('GET', path)); },
    async put(path, value) { await call('PUT', path, value); },
    async remove(path) { await call('DELETE', path); },
    // cb(value) 每次資料變動回傳完整值;onError(err):err.soft = true 表示暫時斷線會自動重連
    listen(path, cb, onError) {
      const R = globalThis.Rtdb;
      let tree = null, stopped = false, es = null, timer = null;
      const fail = e => { if (!stopped && onError) onError(e); };
      if (typeof EventSource === 'undefined') {
        const tick = async () => { try { cb(await this.get(path)); } catch (e) { fail(e); } };
        tick(); timer = setInterval(tick, 3000);
        return () => { stopped = true; clearInterval(timer); };
      }
      es = new EventSource(url(path));
      ['put', 'patch'].forEach(type => es.addEventListener(type, ev => {
        try { tree = R.applyEvent(tree, type, JSON.parse(ev.data)); cb(R.fromFirebase(tree)); } catch (e) { fail(e); }
      }));
      es.addEventListener('cancel', () => fail(new NetError('PERMISSION', '資料庫取消了訂閱(權限規則)')));
      es.addEventListener('auth_revoked', () => fail(new NetError('PERMISSION', '授權已失效')));
      es.onerror = () => { const e = new NetError('NETWORK', '連線中斷,重新連線中…'); e.soft = true; fail(e); };
      return () => { stopped = true; es.close(); };
    },
  };
}
