// 「貼上文字」共用入口(無 AI 的拍照模式):照片大圖在上(可長按選字,不阻擋)、兩種拿字方式說明、📋 從剪貼簿貼上、文字框、
// 回到 App 時文字框是空的就給一個不干擾的「剛複製了文字?按這裡貼上」(不會自動讀剪貼簿)。
// 提示用「iOS 版本以你的手機畫面為準」,不編造精確選單文字。與 app.js 循環匯入:只在函式內使用
import { el, toast } from './app.js';

export const PASTE_HINT = [
  '想把照片上的字變成文字,有兩種方式(iOS 版本以你的手機畫面為準):',
  '① 長按上面照片裡的字 → 全選 → 拷貝,再按下面的「📋 從剪貼簿貼上」。',
  '② 在下面的文字框長按 → 選「掃描文字」,對準照片掃進來。',
];

// cfg: { photos: Blob[], onText(text, via): 文字變動時呼叫(貼上後立刻自動解析), placeholder, rows }
export function pasteIntake(cfg) {
  const urls = [];
  const photos = (cfg.photos || []).filter(b => b && !(b.type === 'application/pdf'));
  // 照片用一般 <img>:不加 user-select:none、不加 pointer-events:none、不用 canvas 繪製,iOS 才能對網頁內圖片使用「即時文字」
  const imgs = photos.map(b => { const u = URL.createObjectURL(b); urls.push(u); return el('img', { class: 'intake-photo', src: u, alt: '照片(可長按選取照片上的文字)' }); });
  const ta = el('textarea', { id: 'intakeText', rows: cfg.rows || 5, placeholder: cfg.placeholder || '把照片上的字貼在這裡' });
  const hint = el('div', { class: 'intake-hint', id: 'intakeHint' }, PASTE_HINT.map((l, i) => el('div', { class: i ? 'ih-line' : 'ih-head' }, l)));
  const bar = el('div', { class: 'paste-bar hidden', id: 'pasteBar' });
  let debounce = null;
  const fire = via => { if (cfg.onText) cfg.onText(ta.value, via || 'type'); };
  async function fromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (!t || !t.trim()) { toast('剪貼簿裡沒有文字'); return; }
      ta.value = t; bar.classList.add('hidden'); fire('paste');
    } catch (_) {
      ta.focus(); toast('無法直接讀取剪貼簿,請長按文字框選「貼上」');          // 失敗時退回聚焦文字框
    }
  }
  const clipBtn = el('button', { class: 'big-btn primary', id: 'pasteClip', onclick: fromClipboard }, el('span', { class: 'bi' }, '📋'), el('span', { class: 'bt' }, '從剪貼簿貼上'));
  ta.addEventListener('input', () => { bar.classList.add('hidden'); clearTimeout(debounce); debounce = setTimeout(() => fire('type'), 250); });
  ta.addEventListener('paste', () => setTimeout(() => fire('paste'), 0));
  bar.append(el('span', {}, '剛複製了文字?'), el('button', { class: 'btn sm primary', id: 'pasteBarBtn', onclick: fromClipboard }, '按這裡貼上'));
  // 回到 App 時:文字框是空的才提示(不自動讀剪貼簿)
  const onVis = () => {
    if (!node.isConnected) { document.removeEventListener('visibilitychange', onVis); urls.splice(0).forEach(u => URL.revokeObjectURL(u)); return; }
    if (document.visibilityState === 'visible' && !ta.value.trim()) bar.classList.remove('hidden');
  };
  document.addEventListener('visibilitychange', onVis);
  const node = el('div', { class: 'intake', id: 'intake' }, imgs.length ? el('div', { class: 'intake-photos', id: 'intakePhotos' }, imgs) : null, hint, clipBtn, bar, ta);
  return { node, textarea: ta, setText(t) { ta.value = t; fire('set'); }, getText: () => ta.value, release() { urls.splice(0).forEach(u => URL.revokeObjectURL(u)); document.removeEventListener('visibilitychange', onVis); }, fromClipboard };
}
