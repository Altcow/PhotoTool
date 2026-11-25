// 共用「處理中」遮罩:全螢幕半透明+轉圈+文字,擋所有點擊;處理中不能返回、不能換頁(hashchange 會被擋回)。
// busy.run(task, {text, timeoutMs, okToast, retryable}) → {ok, value} 或 {ok:false, error}(不丟例外)
//  - 成功:關遮罩(+ toast),回傳 {ok:true, value}
//  - 逾時/失敗:遮罩改顯示錯誤;網路類錯誤有「重試」(重新呼叫 task,呼叫端要讓 task 可重複執行,例如新增類動作沿用同一個 id)、一律有「關閉」
//    按「關閉」回傳 {ok:false, error},呼叫端表單不要關、輸入不會遺失
import { el, toast } from './app.js';

const RETRY_CODES = { TIMEOUT: 1, NETWORK: 1, HTTP: 1 };
let depth = 0, overlay = null, saved = '', box = null;

export const isBusy = () => depth > 0;
globalThis.__tjBusy = isBusy;

const onHash = e => {
  e.stopImmediatePropagation();
  if (location.hash !== saved) { try { history.replaceState(null, '', location.pathname + location.search + saved); } catch (_) { /* 略過 */ } }
};

function enter(text) {
  depth++;
  if (depth === 1) {
    saved = location.hash;
    window.addEventListener('hashchange', onHash, true);
    box = el('div', { class: 'tj-busy-box' });
    overlay = el('div', { class: 'tj-busy', id: 'tjBusy', role: 'alert', 'aria-live': 'assertive' }, box);
    document.body.append(overlay);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  working(text);
}
function leave() {
  depth = Math.max(0, depth - 1);
  if (depth === 0) {
    window.removeEventListener('hashchange', onHash, true);
    if (overlay) overlay.remove();
    overlay = null; box = null;
  }
}
function working(text) { if (box) box.replaceChildren(el('div', { class: 'tj-spin' }), el('div', { class: 'tj-busy-text', id: 'tjBusyText' }, text)); }
function showError(msg, canRetry) {
  return new Promise(resolve => {
    if (!box) { resolve('close'); return; }
    box.replaceChildren(el('div', { class: 'tj-busy-text', id: 'tjBusyErr' }, msg),
      el('div', { class: 'tj-busy-btns' },
        canRetry ? el('button', { class: 'big-btn primary', id: 'tjBusyRetry', onclick: () => resolve('retry') }, '重試') : null,
        el('button', { class: 'big-btn', id: 'tjBusyClose', onclick: () => resolve('close') }, canRetry ? '關閉' : '知道了')));
  });
}

export async function run(task, o) {
  o = o || {};
  const text = o.text || '處理中…', ms = o.timeoutMs || 15000;
  enter(text);
  try {
    for (;;) {
      let timer;
      try {
        const value = await Promise.race([
          Promise.resolve().then(task),
          new Promise((_, rej) => { timer = setTimeout(() => { const e = new Error('處理逾時,網路可能比較慢'); e.code = 'TIMEOUT'; rej(e); }, ms); }),
        ]);
        clearTimeout(timer);
        if (o.okToast) toast(o.okToast);
        return { ok: true, value };
      } catch (e) {
        clearTimeout(timer);
        const canRetry = o.retryable !== undefined ? !!o.retryable : !!(e && RETRY_CODES[e.code]);
        const act = await showError((e && e.message) || '失敗了,請再試一次', canRetry);
        if (act !== 'retry') return { ok: false, error: e };
        working(text);
      }
    }
  } finally { leave(); }
}
