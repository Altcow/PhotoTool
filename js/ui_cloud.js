// 媒體存放位置(本機 / Google 雲端硬碟):設定卡、選擇雲端服務頁、登入前說明頁、上傳狀態與批次上傳
// 與 app.js 循環匯入:只在函式內使用
import * as DB from './db.js';
import * as Cloud from './cloud.js';
import { mediaApi } from './media.js';
import { el, uuid, pushScreen, popScreen, getSettings, saveSettings } from './app.js';

const { CloudGate } = window;
const bigBtn = (icon, text, onclick, cls, id) => el('button', { class: 'big-btn ' + (cls || ''), id, onclick }, el('span', { class: 'bi' }, icon), el('span', { class: 'bt' }, text));
const mb = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const setSetting = patch => saveSettings(Object.assign({}, getSettings(), patch));

/* ---------- 上傳(首頁「待上傳」與設定頁共用) ---------- */
export async function uploadNow() {
  const m = mediaApi();
  const r = await m.processQueue();
  if (r.paused === 'auth') {
    if (confirm('登入已過期,請重新連線。要現在重新連線嗎?')) { try { await Cloud.connect(); return uploadNow(); } catch (e) { alert(connectMessage(e)); } }
  } else if (r.paused === 'offline') alert('目前沒有網路,連線後會再上傳。');
  else if (r.failed) alert(r.failed + ' 張上傳失敗(本機原圖都還在),可在設定頁重試。');
  return r;
}
export function connectMessage(e) {
  if (e && e.code === 'NO_CLIENT_ID') return '需要先設定 Google 用戶端 ID(設定頁「媒體存放位置」)。步驟見「Google登入設定步驟.md」。';
  if (e && e.code === 'NO_EXPLAINER') return '請先閱讀「登入前說明」。';
  return (e && e.message) || '連線失敗';
}

/* ---------- 選擇雲端服務頁 ---------- */
export function openServicePicker(onConnected) {
  pushScreen('選擇雲端服務', body => {
    body.append(
      bigBtn('☁️', 'Google 雲端硬碟', () => {
        const g = Cloud.gate();
        if (g.code === 'NO_CLIENT_ID') {
          popScreen();
          const inp = document.getElementById('setGoogleId');
          if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); }
          const note = document.getElementById('googleIdNeed'); if (note) note.classList.remove('hidden');
          return;
        }
        openExplainer(onConnected);
      }, 'primary', 'svcGoogle'),
      el('button', { class: 'big-btn dis', disabled: true, id: 'svcOneDrive' }, el('span', { class: 'bi' }, '☁️'), el('span', { class: 'bt' }, 'OneDrive(即將推出)')),
      el('button', { class: 'big-btn dis', disabled: true, id: 'svcDropbox' }, el('span', { class: 'bi' }, '☁️'), el('span', { class: 'bt' }, 'Dropbox(即將推出)')),
      el('div', { class: 'muted', style: 'margin-top:10px' }, 'iCloud 網頁 App 無法連線,不支援。'));
  });
}

/* ---------- 登入前說明(必經,不可略過) ---------- */
export function openExplainer(onConnected) {
  pushScreen('登入前說明', body => {
    const standalone = CloudGate.isStandalone(window);
    body.append(el('div', { class: 'explain', id: 'explainer' }, CloudGate.explainerLines(standalone).map(t => el('p', { class: 'explain-p' }, t))));
    if (standalone) body.append(bigBtn('📋', '複製網址', async () => { try { await navigator.clipboard.writeText(location.origin + location.pathname); alert('已複製網址'); } catch (_) { prompt('請手動複製網址', location.origin + location.pathname); } }, 'sm', 'copyUrl'));
    const status = el('div', { class: 'muted', id: 'connectStatus' });
    body.append(status, el('div', { class: 'sticky-act' },
      bigBtn('✅', '我了解,前往登入', async () => {
        Cloud.acknowledgeExplainer();
        status.replaceChildren(el('span', { class: 'spin' }), ' 正在開啟 Google 登入…');
        try {
          await Cloud.connect();
          setSetting({ mediaStore: 'drive' });
          popScreen(); popScreen();
          if (onConnected) onConnected();
          mediaApi().notify();
          uploadNow().catch(e => console.warn(e));
        } catch (e) { status.textContent = connectMessage(e); }
      }, 'primary', 'explainGo'),
      bigBtn('✖', '取消', () => popScreen(), '', 'explainCancel')));
  });
}

/* ---------- 把現有照片全部上傳 ---------- */
async function legacyEmbedded() {
  const out = [];
  for (const f of await DB.allFiles()) (f.photos || []).forEach((b, i) => { if (!(f.mediaIds && f.mediaIds[i])) out.push({ kind: 'file', rec: f, i, blob: b }); });
  for (const t of await DB.allTrips()) (t.records || []).forEach(r => (r.photos || []).forEach((b, i) => { if (!(r.mediaIds && r.mediaIds[i])) out.push({ kind: 'trip', trip: t, rec: r, i, blob: b }); }));
  return out;
}
async function uploadAllExisting(refresh) {
  const m = mediaApi(), lp = await m.localPending(), legacy = await legacyEmbedded();
  const count = lp.count + legacy.length, bytes = lp.bytes + legacy.reduce((a, x) => a + (x.blob.size || 0), 0);
  if (!count) { alert('沒有需要上傳的照片'); return; }
  if (!confirm('要把現有 ' + count + ' 張照片/附件上傳到你的 Google 雲端硬碟嗎?\n預估大小約 ' + mb(bytes) + '。\n(本機原圖會保留)')) return;
  const files = new Map(), trips = new Map();
  for (const x of legacy) {                                 // 檔案紀錄/分帳記事本裡內嵌的舊照片 → 建立媒體紀錄並排入佇列
    const id = await m.saveMedia(x.blob, { kind: x.kind, ownerId: x.rec.id });
    x.rec.mediaIds = x.rec.mediaIds || []; x.rec.mediaIds[x.i] = id;
    if (x.kind === 'file') files.set(x.rec.id, x.rec); else trips.set(x.trip.id, x.trip);
  }
  for (const f of files.values()) await DB.putFile(f);
  for (const t of trips.values()) await DB.putTrip(t);
  await m.enqueueExisting(lp.ids);
  if (refresh) refresh();
  uploadNow().catch(e => console.warn(e));
}

/* ---------- 設定頁「媒體存放位置」卡片 ---------- */
export function mediaCard() {
  const box = el('div', { class: 'card', id: 'mediaCard' });
  let counts = { pending: 0, uploading: 0, done: 0, failed: 0, waiting: 0 };
  let drawn = false;
  async function draw() {
    if (drawn && !box.isConnected) return;            // 設定頁已關閉
    const m = mediaApi(); counts = await m.counts();
    const s = getSettings(), st = Cloud.status(), isDrive = s.mediaStore === 'drive';
    const idIn = el('input', { type: 'text', id: 'setGoogleId', value: s.googleClientId || '', placeholder: '例:1234-abc.apps.googleusercontent.com', autocomplete: 'off', onchange: e => { setSetting({ googleClientId: e.target.value.trim() }); draw(); } });
    const rows = [
      el('b', {}, '媒體存放位置'),
      el('div', { class: 'muted small' }, '照片/附件由你自己存放,App 不會傳到我們的伺服器。'),
      el('div', { class: 'big-grid two' },
        bigBtn('📱', '本機', () => { setSetting({ mediaStore: 'local' }); draw(); }, isDrive ? '' : 'primary', 'storeLocal'),
        bigBtn('☁️', '雲端硬碟', () => openServicePicker(() => draw()), isDrive ? 'primary' : '', 'storeDrive')),
      el('div', { class: 'muted small' }, isDrive ? '新的照片會先存在這支手機,再上傳到你的 Google 雲端硬碟。' : '目前只存在這支手機(預設)。'),
      el('label', { class: 'f' }, 'Google 用戶端 ID(公開識別碼,不是密碼)'), idIn,
      el('div', { class: 'warn-t small hidden', id: 'googleIdNeed' }, '需要先設定 Google 用戶端 ID,才能連線。'),
      el('div', { class: 'muted small' }, 'App 不內建用戶端 ID。取得方式見「Google登入設定步驟.md」。'),
    ];
    if (st.state === 'connected') rows.push(el('div', { class: 'banner', id: 'cloudState' }, '已連線' + (st.account ? ':' + st.account : '')));
    else if (st.state === 'expired') rows.push(el('div', { class: 'banner warn', id: 'cloudState' }, '登入已過期,請重新連線'));
    const btns = [];
    if (st.state === 'expired') btns.push(bigBtn('🔁', '重新連線', async () => { try { if (!Cloud.explainerAcked()) { openExplainer(() => draw()); return; } await Cloud.connect(); draw(); uploadNow().catch(e => console.warn(e)); } catch (e) { alert(Cloud.gate().ok ? connectMessage(e) : connectMessage(e)); } }, 'primary sm', 'cloudReconnect'));
    if (st.state !== 'off') btns.push(bigBtn('⛔', '中斷連線', async () => { if (!confirm('中斷連線後會收回這支手機上的授權,不會刪除雲端或本機的任何檔案。確定?')) return; await Cloud.disconnect(); setSetting({ mediaStore: 'local' }); draw(); }, 'danger sm', 'cloudDisconnect'));
    if (btns.length) rows.push(el('div', { class: 'row' }, ...btns));
    if (counts.waiting || counts.failed) {
      rows.push(el('div', { class: 'banner', id: 'pendingLine' }, '待上傳 ' + counts.waiting + ' 張' + (counts.failed ? ' · 失敗 ' + counts.failed + ' 張' : '')));
      rows.push(el('div', { class: 'row wrap' }, bigBtn('⬆️', '現在上傳', () => uploadNow().then(draw), 'primary sm', 'uploadNow'),
        counts.failed ? bigBtn('🔁', '重試失敗的', async () => { await m.retryFailed(); uploadNow().then(draw); }, 'sm', 'retryFailed') : null,
        bigBtn('🗑', '清除未完成', async () => { if (confirm('清除佇列中未完成的上傳?(本機照片不會刪除)')) { await m.clearUnfinished(); draw(); } }, 'sm', 'clearQueue')));
    }
    if (isDrive) rows.push(bigBtn('📤', '把現有照片全部上傳到雲端', () => uploadAllExisting(draw), 'sm', 'uploadAll'));
    rows.push(el('details', { class: 'adv', id: 'mediaAdv' }, el('summary', {}, '進階'),
      el('label', { class: 'row', style: 'margin:8px 0' }, el('input', { type: 'checkbox', id: 'delLocal', checked: !!s.deleteLocalAfterUpload, style: 'width:24px;height:24px', onchange: e => { setSetting({ deleteLocalAfterUpload: e.target.checked }); } }), '上傳成功後刪除本機副本(需要時再從雲端取回)')));
    box.replaceChildren(...rows.filter(Boolean)); drawn = true;
  }
  draw();
  mediaApi().onChange(draw); Cloud.onChange(draw);
  return box;
}
