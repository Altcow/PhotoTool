// 個人頁:頭像、姓名、綁定 Google、登出(email 只給自己看)。
import { el, pushScreen, popScreen, toast, openSettings } from './app.js';
import * as Auth from './auth.js';
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
  ['email 與密碼註冊', '密碼會送到 Firebase(Google 提供的帳號服務)處理。請勿使用重要帳號(例如銀行、主要信箱)的密碼。'],
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
    let status = { google: ctx.google };
    const avBox = el('div', { class: 'tj-av-big', id: 'tjAvBox' });
    const drawAv = () => avBox.replaceChildren(avatarEl({ name: ctx.name, avatar: ctx.avatar }, 84));
    drawAv();
    const nameI = el('input', { type: 'text', id: 'tjMyName', maxlength: 30, value: ctx.name });
    const save = async patch => {
      try { await ctx.jn.saveProfile(patch); if (patch.name) ctx.name = patch.name.trim().replace(/\s+/g, ' '); if (patch.avatar !== undefined) ctx.avatar = patch.avatar; drawAv(); redrawChips(); toast('已儲存'); }
      catch (e) { toast(e.message || '儲存失敗', 2500); }
    };
    const emojiRow = el('div', { class: 'chips', id: 'tjEmojis' }, EMOJIS.map(e => el('button', { class: 'chip', onclick: () => save({ avatar: { t: 'emoji', v: e, c: window.Journal.colorOf(ctx.name) } }) }, e)));
    const photoIn = el('input', { type: 'file', accept: 'image/*', class: 'hidden', id: 'tjPhotoIn', onchange: async ev => {
      const f = ev.target.files && ev.target.files[0]; ev.target.value = '';
      if (!f) return;
      try { save({ avatar: { t: 'photo', v: await photoToAvatar(f) } }); } catch (e) { toast(e.message || '讀取照片失敗', 2500); }
    } });
    const googleBox = el('div', { class: 'card', id: 'tjGoogleBox' });
    const drawGoogle = () => {
      if (status.google) googleBox.replaceChildren(el('div', { class: 'row' }, el('b', { id: 'tjGoogleOk' }, '✓ Google 已登入')),
        status.photoUrl ? el('button', { class: 'btn sm', id: 'tjUseGAvatar', style: 'margin-top:8px', onclick: () => save({ avatar: { t: 'google', v: status.photoUrl } }) }, '使用 Google 頭像') : null);
      else googleBox.replaceChildren(el('button', { class: 'big-btn', id: 'tjBindGoogle', onclick: async ev => {
        const btn = ev.currentTarget;
        try {
          btn.disabled = true;
          const g = await Auth.getGoogleIdToken();
          const r = await Auth.bindGoogle(g);
          status = { google: true, photoUrl: r.photoUrl }; ctx.google = true; toast('✓ Google 已登入');
        } catch (e) { if (e && e.message !== '已取消') toast(e.message || '綁定失敗', 3000); }
        drawGoogle();
      } }, '綁定 Google'));
    };
    drawGoogle();
    Auth.googleStatus().then(s => { if (s.google) { status = s; ctx.google = true; drawGoogle(); } }).catch(() => { /* 查不到就維持畫面 */ });

    body.append(
      el('div', { class: 'card tj-acct' }, avBox,
        el('div', { class: 'muted small', id: 'tjMyEmail' }, ctx.email),
        el('label', { class: 'f', for: 'tjMyName' }, '姓名'), nameI,
        el('button', { class: 'btn primary', id: 'tjSaveName', style: 'margin-top:8px', onclick: () => {
          const v = window.Journal.validName(nameI.value);
          if (!v.ok) { toast(v.msg, 2500); return; }
          save({ name: v.value });
        } }, '儲存姓名')),
      el('div', { class: 'card' }, el('b', {}, '頭像'),
        el('div', { class: 'row wrap', style: 'margin:8px 0' },
          el('button', { class: 'btn', id: 'tjAvInitial', onclick: () => save({ avatar: { t: 'initial', c: window.Journal.colorOf(ctx.name) } }) }, '用姓名首字'),
          el('label', { class: 'btn', id: 'tjAvPhoto' }, '換照片', photoIn)),
        emojiRow),
      googleBox,
      el('button', { class: 'big-btn', id: 'tjAdvSettings', style: 'margin:10px 0', onclick: () => openSettings() }, '進階設定(資料庫、金鑰)'),
      el('button', { class: 'big-btn danger', id: 'tjLogout', onclick: () => {
        if (!confirm('要登出嗎?(這支手機會刪除登入資料)')) return;
        popScreen(); if (ctx.onLogout) ctx.onLogout();
      } }, '登出'),
      el('div', { style: 'text-align:center;margin-top:6px' }, el('button', { class: 'link-btn muted', id: 'tjPrivacy', onclick: openPrivacy }, '隱私說明')),
      el('div', { class: 'muted small', style: 'text-align:center' }, '旅遊日誌 v10'));
  });
}
