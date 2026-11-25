// 旅遊日誌共用狀態與小元件(登入者、頭像、帳號鈕、路由)。與 app.js 循環匯入,只在函式內使用。
import { el } from './app.js';

// 防呆:DOM 的 append/prepend/replaceChildren 收到 null、false、undefined 會變成文字「null」,收到陣列會變成「[object …]」。
// v10 的「事件出現兩個 null」就是表單把沒有說明的欄位 append(null)。這裡統一略過空值、攤平陣列。
['append', 'prepend', 'replaceChildren'].forEach(fn => {
  const orig = Element.prototype[fn];
  if (!orig || orig.__tjSafe) return;
  const safe = function (...a) { return orig.apply(this, a.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false)); };
  safe.__tjSafe = true;
  Element.prototype[fn] = safe;
});

export const ctx = { jn: null, uid: '', name: '', email: '', avatar: null, google: false, onLogout: null };

export const setHash = h => { if (location.hash === h) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h; };
export function parseRoute(hash) {
  const m = new RegExp('^#/j/(' + window.Journal.jidPattern() + ')(?:/e/(e\\d{3})|/m/((e\\d{3})_b\\d{2}))?$').exec(String(hash || ''));
  return m ? { jid: m[1], eid: m[2] || m[4] || '', mk: m[3] || '' } : { jid: '', eid: '', mk: '' };
}

// 頭像:預設姓名首字+底色圓;emoji;照片(data URL);Google(網址)
export function avatarEl(profile, size) {
  const J = window.Journal, name = (profile && profile.name) || ctx.name || '?', a = (profile && profile.avatar) || null;
  const s = size || 32;
  const box = el('span', { class: 'tj-av', style: 'width:' + s + 'px;height:' + s + 'px;font-size:' + Math.round(s * 0.5) + 'px', 'aria-hidden': 'true' });
  if (a && a.t === 'photo' && /^data:image\/jpeg;base64,/.test(a.v || '')) { box.append(el('img', { src: a.v, alt: '' })); return box; }
  if (a && a.t === 'google' && J.isHttpsUrl(a.v)) { box.append(el('img', { src: a.v, alt: '', referrerpolicy: 'no-referrer' })); return box; }
  if (a && a.t === 'emoji' && a.v) { box.style.background = a.c || J.colorOf(name); box.textContent = a.v; return box; }
  box.style.background = (a && a.c) || J.colorOf(name);
  box.textContent = J.initialOf(name);
  return box;
}
// 右上角帳號:小頭像+姓名(過長截斷),點了進個人頁
export function accountChip(onOpen) {
  const b = el('button', { class: 'tj-chip', 'aria-label': '個人頁', onclick: () => onOpen && onOpen() });
  const draw = () => b.replaceChildren(avatarEl({ name: ctx.name, avatar: ctx.avatar }, 28), el('span', { class: 'tj-chip-name' }, window.Journal.truncName(ctx.name, 8)));
  draw();
  b.redraw = draw;
  chips.add(b);
  return b;
}
const chips = new Set();
export function redrawChips() { chips.forEach(c => { if (c.isConnected) c.redraw(); else chips.delete(c); }); }

// 內文:換行保留;只把 https:// 網址變連結(textContent,不用 innerHTML)
export function richText(text) {
  const out = [], re = /https:\/\/[^\s<>"]+/g;
  let last = 0, m;
  const J = window.Journal;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(J.isHttpsUrl(m[0]) ? el('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer' }, m[0]) : m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return el('div', { class: 'tj-text' }, out);
}
