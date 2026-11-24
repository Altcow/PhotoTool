// Firebase Realtime Database 的 REST + EventSource(SSE)實作,不使用 SDK。
// 網址由使用者在設定頁輸入(或來自分享連結),不內建。依賴全域 Rtdb(js/lib/rtdb.js)
// opts.getToken(force?) → idToken 或 null(未登入,不帶 auth=,給免註冊只讀用);失敗會丟出錯誤
import { NetError } from './net.js';

const EXPIRED_RE = /auth token|expired|could not parse|invalid token/i;

export function createFirebaseStore(dbUrl, opts) {
  opts = opts || {};
  const base = String(dbUrl || '').trim().replace(/\/+$/, '');
  const url = p => base + '/' + String(p).replace(/^\/+/, '') + '.json';
  const withAuth = (u, tok) => (tok ? u + '?auth=' + encodeURIComponent(tok) : u);
  async function token(force) {
    if (!opts.getToken) return null;
    try { return await opts.getToken(force); } catch (e) { throw new NetError('AUTH_EXPIRED', e && e.message ? e.message : '登入已過期,請重新登入'); }
  }
  async function call(method, path, body, retried) {
    const tok = await token(false);
    let res;
    try {
      res = await fetch(withAuth(url(path), tok), { method, headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (e) { throw new NetError('NETWORK', '連線失敗,請檢查網路'); }
    if (res.status === 401 || res.status === 403) {
      let msg = '';
      try { const j = await res.json(); msg = String((j && j.error) || ''); } catch (_) { /* 沒有內容 */ }
      if (opts.getToken && tok && EXPIRED_RE.test(msg) && !/permission denied/i.test(msg)) {
        if (!retried) { await token(true); return call(method, path, body, true); }
        throw new NetError('AUTH_EXPIRED', '登入已過期,請重新登入');
      }
      throw new NetError('PERMISSION', '資料庫拒絕這個操作(權限規則)');
    }
    if (!res.ok) throw new NetError('HTTP', '資料庫錯誤 ' + res.status);
    return method === 'GET' ? res.json() : null;
  }
  return {
    kind: 'firebase',
    async get(path) { return globalThis.Rtdb.fromFirebase(await call('GET', path)); },
    async put(path, value) { await call('PUT', path, value); },
    // 多路徑更新:obj 的鍵是相對 path 的路徑,值為 null = 刪除;可含 {".sv":"timestamp"}
    async patch(path, obj) { await call('PATCH', path, obj); },
    async remove(path) { await call('DELETE', path); },
    // cb(value) 每次資料變動回傳完整值;onError(err):err.soft = true 表示暫時斷線會自動重連
    listen(path, cb, onError) {
      const R = globalThis.Rtdb;
      let tree = null, stopped = false, es = null, timer = null, renew = null, tries = 0;
      const fail = e => { if (!stopped && onError) onError(e); };
      if (typeof EventSource === 'undefined') {
        const tick = async () => { try { cb(await this.get(path)); } catch (e) { fail(e); } };
        tick(); timer = setInterval(tick, 3000);
        return () => { stopped = true; clearInterval(timer); };
      }
      const reopen = (delay, force) => { if (es) { es.close(); es = null; } if (!stopped) setTimeout(() => open(force), delay); };
      const open = async force => {
        if (stopped) return;
        let tok = null;
        try { tok = opts.getToken ? await (force ? token(true) : token(false)) : null; } catch (e) { fail(e); return; }
        if (stopped) return;
        es = new EventSource(withAuth(url(path), tok));
        const cur = es;
        ['put', 'patch'].forEach(type => cur.addEventListener(type, ev => {
          tries = 0;
          try { tree = R.applyEvent(tree, type, JSON.parse(ev.data)); cb(R.fromFirebase(tree)); } catch (e) { fail(e); }
        }));
        cur.addEventListener('cancel', () => fail(new NetError('PERMISSION', '資料庫取消了訂閱(權限規則)')));
        // 授權失效或快到期:換新 token 重開串流
        cur.addEventListener('auth_revoked', () => reopen(0, true));
        cur.onerror = () => {
          const e = new NetError('NETWORK', '連線中斷,重新連線中…'); e.soft = true; fail(e);
          if (opts.getToken) { tries++; reopen(Math.min(15000, 1000 * tries), tries > 1); }   // 用最新 token 重連(瀏覽器自動重連會沿用舊網址)
        };
        if (opts.tokenExp) {
          const left = Number(opts.tokenExp()) - Date.now() - 3 * 60 * 1000;
          clearTimeout(renew);
          if (left > 0) renew = setTimeout(() => reopen(0, true), left);
        }
      };
      if (opts.getToken) open(false);
      else { es = new EventSource(url(path)); wireSync(es); }
      function wireSync(cur) {
        ['put', 'patch'].forEach(type => cur.addEventListener(type, ev => {
          try { tree = R.applyEvent(tree, type, JSON.parse(ev.data)); cb(R.fromFirebase(tree)); } catch (e) { fail(e); }
        }));
        cur.addEventListener('cancel', () => fail(new NetError('PERMISSION', '資料庫取消了訂閱(權限規則)')));
        cur.addEventListener('auth_revoked', () => fail(new NetError('PERMISSION', '授權已失效')));
        cur.onerror = () => { const e = new NetError('NETWORK', '連線中斷,重新連線中…'); e.soft = true; fail(e); };
      }
      return () => { stopped = true; clearTimeout(renew); if (es) es.close(); };
    },
  };
}
