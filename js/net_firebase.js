// Firebase Realtime Database 的 REST + EventSource(SSE)實作,不使用 SDK。
// 網址由使用者在設定頁輸入(或來自分享連結),不內建。依賴全域 Rtdb(js/lib/rtdb.js)
// opts.getToken(force?) → idToken 或 null(未登入,不帶 auth=,給免註冊只讀用);失敗會丟出錯誤
import { NetError } from './net.js';

const EXPIRED_RE = /auth token|expired|could not parse|invalid token/i;
// Firebase RTDB 只支援 HTTP/1.1,瀏覽器對同一主機最多同時 6 條連線;串流(SSE)佔滿後,寫入的 fetch 會永遠排隊(畫面「卡住」)。
// 所以同時開的串流最多 MAX_SSE 條,其餘(或呼叫端標 poll)改成定時 GET;寫入成功後立刻重讀所有輪詢中的節點。
const MAX_SSE = 4, POLL_MS = 6000, FETCH_TIMEOUT_MS = 15000;

export function createFirebaseStore(dbUrl, opts) {
  opts = opts || {};
  const base = String(dbUrl || '').trim().replace(/\/+$/, '');
  const url = p => base + '/' + String(p).replace(/^\/+/, '') + '.json';
  const withAuth = (u, tok) => (tok ? u + '?auth=' + encodeURIComponent(tok) : u);
  async function token(force) {
    if (!opts.getToken) return null;
    try { return await opts.getToken(force); } catch (e) { throw new NetError('AUTH_EXPIRED', e && e.message ? e.message : '登入已過期,請重新登入'); }
  }
  async function call(method, path, body, retried, ifNew) {
    const tok = await token(false);
    let res;
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS) : null;
    try {
      res = await fetch(withAuth(url(path), tok), { method, signal: ac ? ac.signal : undefined, headers: body !== undefined ? Object.assign({ 'content-type': 'application/json' }, ifNew ? { 'if-match': 'null_etag' } : {}) : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (e) {
      if (ac && ac.signal.aborted) throw new NetError('TIMEOUT', '連線逾時,請檢查網路後重試');
      throw new NetError('NETWORK', '連線失敗,請檢查網路');
    } finally { if (timer) clearTimeout(timer); }
    if (res.status === 401 || res.status === 403) {
      let msg = '';
      try { const j = await res.json(); msg = String((j && j.error) || ''); } catch (_) { /* 沒有內容 */ }
      if (opts.getToken && tok && EXPIRED_RE.test(msg) && !/permission denied/i.test(msg)) {
        if (!retried) { await token(true); return call(method, path, body, true, ifNew); }
        throw new NetError('AUTH_EXPIRED', '登入已過期,請重新登入');
      }
      throw new NetError('PERMISSION', '你沒有權限做這件事');
    }
    if (res.status === 412) throw new NetError('EXISTS', '這個位置已經有內容了');
    if (!res.ok) throw new NetError('HTTP', '伺服器暫時有問題(' + res.status + ')');
    if (method === 'GET') return res.json();
    pollers.forEach(f => f());   // 寫入成功:輪詢中的節點立刻重讀
    return null;
  }
  const pollers = new Set();
  let sseCount = 0;
  return {
    kind: 'firebase',
    async get(path) { return globalThis.Rtdb.fromFirebase(await call('GET', path)); },
    // o.ifNew:只在該路徑目前沒有資料時寫入(If-Match: null_etag),已存在 → 丟 EXISTS
    async put(path, value, o) { await call('PUT', path, value, false, !!(o && o.ifNew)); },
    // 多路徑更新:obj 的鍵是相對 path 的路徑,值為 null = 刪除;可含 {".sv":"timestamp"}
    async patch(path, obj) { await call('PATCH', path, obj); },
    async remove(path) { await call('DELETE', path); },
    // cb(value) 每次資料變動回傳完整值;onError(err):err.soft = true 表示暫時斷線會自動重連
    // o.poll = true:不佔串流連線,改定時 GET(給次要節點用,見上方 MAX_SSE 說明)
    listen(path, cb, onError, o) {
      const R = globalThis.Rtdb;
      let tree = null, stopped = false, es = null, timer = null, renew = null, tries = 0;
      const fail = e => { if (!stopped && onError) onError(e); };
      if (typeof EventSource === 'undefined' || (o && o.poll) || sseCount >= MAX_SSE) {
        let last, busy = false, bad = false;
        const tick = async () => {
          if (busy || stopped) return;
          busy = true;
          try {
            const v = await this.get(path), s = JSON.stringify(v === undefined ? null : v);
            bad = false;
            if (!stopped && s !== last) { last = s; cb(v); }
          } catch (e) { last = undefined; if (!bad) { bad = true; fail(e); } } finally { busy = false; }
        };
        tick(); timer = setInterval(tick, POLL_MS); pollers.add(tick);
        return () => { stopped = true; clearInterval(timer); pollers.delete(tick); };
      }
      sseCount++;
      // 用 shallow 讀取探測:回 401/403 且內容是 Permission denied → 這個節點對我不開放
      const denied = async () => {
        try {
          const tok = opts.getToken ? await opts.getToken(false) : null;
          const res = await fetch(withAuth(url(path), tok) + (tok ? '&' : '?') + 'shallow=true');
          if (res.status !== 401 && res.status !== 403) return false;
          let msg = ''; try { const j = await res.json(); msg = String((j && j.error) || ''); } catch (_) { /* 沒有內容 */ }
          return /permission denied/i.test(msg);
        } catch (_) { return false; }
      };
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
        cur.addEventListener('cancel', () => fail(new NetError('PERMISSION', '這本日誌不再開放給你看')));
        // 授權失效或快到期:換新 token 重開串流
        cur.addEventListener('auth_revoked', () => reopen(0, true));
        cur.onerror = async () => {
          // 沒有權限讀的節點(例如私密日誌、非成員),連線時是 HTTP 401,EventSource 只給一個沒有內容的 error:先探一下是不是權限問題,是就回報 PERMISSION、不再重連
          if (await denied()) { if (stopped || es !== cur) return; cur.close(); es = null; fail(new NetError('PERMISSION', '這本日誌不再開放給你看')); return; }
          if (stopped || es !== cur) return;
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
        cur.addEventListener('cancel', () => fail(new NetError('PERMISSION', '這本日誌不再開放給你看')));
        cur.addEventListener('auth_revoked', () => fail(new NetError('PERMISSION', '授權已失效')));
        cur.onerror = () => { const e = new NetError('NETWORK', '連線中斷,重新連線中…'); e.soft = true; fail(e); };
      }
      return () => { stopped = true; sseCount--; clearTimeout(renew); if (es) es.close(); };
    },
  };
}
