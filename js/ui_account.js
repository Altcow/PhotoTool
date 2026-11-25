// 個人頁:頭像、姓名、綁定 Google、登出(email 只給自己看)。
import { el, pushScreen, popScreen, toast } from './app.js';
import * as Auth from './auth.js';
import * as busy from './busy.js';
import { ctx, avatarEl, redrawChips } from './tjctx.js';

const EMOJIS = ['🐻', '🐱', '🐶', '🦊', '🐼', '🐸', '🌴', '✈️', '🍜', '📷', '⛰️', '🌸'];

// 照片 → 置中裁正方形、縮到 96×96、JPEG(約 5~8KB)→ data URL
export async function photoToAvatar(file) {
  const J = window.Journal;
  const bmp = await (window.createImageBitmap ? createImageBitmap(file) : new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }));
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight, c = J.squareCrop(w, h);
  const cv = document.createElement('canvas'); cv.width = cv.height = 96;
  cv.getContext('2d').drawImage(bmp, c.sx, c.sy, c.sw, c.sh, 0, 0, 96, 96);
  for (const q of [0.7, 0.55, 0.4]) {
    const url = cv.toDataURL('image/jpeg', q);
    if (J.validAvatar({ t: 'photo', v: url }).ok) return url;
  }
  throw new Error('照片太大,請換一張');
}

const PRIVACY = [
  ['我們收哪些資料', '你的姓名(暱稱)、email、頭像,以及你建立或加入的日誌內容。其他人看得到你的姓名與頭像;email 只有你自己看得到。'],
  ['email 與密碼註冊', '密碼會送到帳號服務(由 Google 提供)處理。請勿使用重要帳號(例如銀行、主要信箱)的密碼。'],
  ['Google 登入', '我們拿不到你的 Google 密碼,只會收到 Google 提供的身分資料(email、姓名、頭像)。要收回授權:到 Google 帳號的「安全性」→「第三方存取權」(畫面可能略有不同),找到「旅遊日誌」移除存取權。'],
  ['公開日誌', '公開日誌的宗旨、公告、行程,在連結被轉傳時沒註冊的人也看得到。不想公開請設成私密。'],
];
function openPrivacy() {
  pushScreen('隱私說明', body => {
    PRIVACY.forEach(([h, t]) => body.append(el('div', { class: 'card' }, el('b', {}, h), el('p', { class: 'explain-p' }, t))));
  });
}

export function openAccount() {
  pushScreen('個人頁', (body, entry) => {
    const J = window.Journal;
    let status = { google: ctx.google };
    let draft = ctx.avatar ? Object.assign({}, ctx.avatar) : { t: 'initial' };   // 還沒儲存的頭像選擇(選了立刻預覽)
    const avBox = el('div', { class: 'tj-av-big', id: 'tjAvBox' });
    const nameI = el('input', { type: 'text', id: 'tjMyName', maxlength: 30, autocomplete: 'off' });
    nameI.value = ctx.name || '';
    nameI.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); nameI.blur(); } };
    const pickBox = el('div', { id: 'tjPickBox' });
    const nameNow = () => J.txt(nameI.value).trim() || ctx.name;
    const previewAv = () => (draft.t === 'initial' ? { t: 'initial', c: J.colorOf(nameNow()) } : draft);
    const isOn = (t, v) => draft.t === t && (v === undefined || draft.v === v);
    const draw = () => {
      avBox.replaceChildren(avatarEl({ name: nameNow(), avatar: previewAv() }, 84));
      const tile = (id, on, label, kid, onclick) => el('button', { class: 'tj-pick-item' + (on ? ' on' : ''), id, type: 'button', 'aria-pressed': on ? 'true' : 'false', 'aria-label': label, onclick }, kid);
      const photoIn = el('input', { type: 'file', accept: 'image/*', class: 'hidden', id: 'tjPhotoIn', onchange: async ev => {
        const f = ev.target.files && ev.target.files[0]; ev.target.value = '';
        if (!f) return;
        try { draft = { t: 'photo', v: await photoToAvatar(f) }; draw(); } catch (e) { toast(e.message || '讀取照片失敗', 2500); }
      } });
      pickBox.replaceChildren(
        el('div', { class: 'muted small' }, '姓名首字'),
        el('div', { class: 'tj-pick' }, tile('tjAvInitial', isOn('initial'), '用姓名首字', avatarEl({ name: nameNow(), avatar: { t: 'initial', c: J.colorOf(nameNow()) } }, 40), () => { draft = { t: 'initial' }; draw(); })),
        el('div', { class: 'muted small' }, '表情圖案'),
        el('div', { class: 'tj-pick', id: 'tjEmojis' }, EMOJIS.map((e, k) => tile('tjEmoji' + k, isOn('emoji', e), '圖案 ' + e, e, () => { draft = { t: 'emoji', v: e, c: J.colorOf(nameNow()) }; draw(); }))),
        el('div', { class: 'muted small' }, '照片'),
        el('div', { class: 'tj-pick' },
          el('label', { class: 'tj-pick-item' + (isOn('photo') ? ' on' : ''), id: 'tjAvPhoto', style: 'font-size:15px;padding:4px 12px' }, isOn('photo') ? '✓ 已選照片(換一張)' : '📷 選照片', photoIn),
          status.photoUrl ? tile('tjUseGAvatar', isOn('google'), '用 Google 頭像', 'G', () => { draft = { t: 'google', v: status.photoUrl }; draw(); }) : null));
    };
    nameI.oninput = () => draw();
    draw();
    const googleBox = el('div', { class: 'card', id: 'tjGoogleBox' });
    const drawGoogle = () => {
      if (status.google) googleBox.replaceChildren(el('div', { class: 'row' }, el('b', { id: 'tjGoogleOk' }, '✓ Google 已登入')));
      else if (!Auth.googleAvailable()) googleBox.replaceChildren();
      else googleBox.replaceChildren(el('button', { class: 'big-btn', id: 'tjBindGoogle', onclick: async () => {
        const r = await busy.run(async () => { const g = await Auth.getGoogleIdToken(); return Auth.bindGoogle(g); }, { text: '綁定中…', retryable: false });
        if (r.ok) { status = { google: true, photoUrl: r.value.photoUrl }; ctx.google = true; toast('✓ Google 已登入'); draw(); }
        else if (r.error && r.error.message !== '已取消') toast(r.error.message || '綁定失敗', 3000);
        drawGoogle();
      } }, '綁定 Google'));
    };
    drawGoogle();
    Auth.googleStatus().then(s => { if (s.google) { status = s; ctx.google = true; drawGoogle(); draw(); } }).catch(() => { /* 查不到就維持畫面 */ });

    const saveBtn = el('button', { class: 'big-btn primary', id: 'tjSaveProfile', style: 'margin-top:12px', onclick: async () => {
      const v = J.validName(nameI.value);
      if (!v.ok) { toast(v.msg, 2500); return; }
      const patch = { name: v.value, avatar: draft.t === 'initial' ? { t: 'initial', c: J.colorOf(v.value) } : draft };
      const r = await busy.run(() => ctx.jn.saveProfile(patch), { text: '儲存中…', okToast: '已儲存' });
      if (!r.ok) { toast((r.error && r.error.message) || '儲存失敗', 2500); return; }
      ctx.name = v.value; ctx.avatar = patch.avatar; draft = Object.assign({}, patch.avatar); nameI.value = v.value; draw(); redrawChips();
    } }, '儲存');

    body.append(
      el('div', { class: 'card tj-acct' }, avBox,
        el('div', { class: 'muted small', id: 'tjMyEmail' }, ctx.email),
        el('label', { class: 'f', for: 'tjMyName' }, '姓名'), nameI,
        el('div', { class: 'f' }, '頭像(選了馬上預覽,按「儲存」才會套用)'), pickBox, saveBtn),
      googleBox,
      el('button', { class: 'big-btn danger', id: 'tjLogout', style: 'margin-top:10px', onclick: () => {
        if (!confirm('要登出嗎?(這支手機會刪除登入資料)')) return;
        popScreen(); if (ctx.onLogout) ctx.onLogout();
      } }, '登出'),
      el('div', { style: 'text-align:center;margin-top:6px' }, el('button', { class: 'link-btn muted', id: 'tjPrivacy', onclick: openPrivacy }, '隱私說明')),
      el('div', { class: 'muted small', style: 'text-align:center' }, '旅遊日誌 v13'));
  });
}
