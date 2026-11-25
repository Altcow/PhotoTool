import * as DB from './db.js';
import * as AI from './ai.js';
import * as Files from './ui_files.js';
import * as MenuUI from './ui_menu.js';
import * as LedgerUI from './ui_ledger.js';
import * as Media from './media.js';
import * as Cloud from './cloud.js';
import * as CloudUI from './ui_cloud.js';
import { pasteIntake } from './ui_paste.js';
import { openRoomJoin } from './ui_room.js';
import { parseRoomParams, getNet } from './netctx.js';
import { validDbUrl } from './net.js';
import { FEATURES } from './config.js';
import { startJournalApp } from './ui_jhome.js';

const { Split, Aggregate, Reconcile, Xlsx } = window;
const MAX_FILE = 20 * 1024 * 1024;
const MAX_FILE_BYTES = MAX_FILE;

/* ---------- 小工具 ---------- */
const DEFAULT_CATS = ['餐飲', '超市/日用', '交通', '購物', '醫療', '娛樂', '居家', '教育', '旅遊', '其他'];
const PAYMENTS = ['現金', '信用卡', '行動支付', '轉帳', '其他'];
const { Modes, Tabletext, SaveBar, Guide, KeepPhoto, Receipt, Ledger } = window;
// 功能旗標(v10):預設在 config.js,覆寫用 ?flags=+camera,-ai 或 localStorage['pt_flags']
const flagRes = window.Flags.applyQuery(location.search, localStorage);
if (flagRes.changed) history.replaceState(null, '', location.pathname + flagRes.clean + location.hash);
const featureOn = name => window.Flags.isOn(name, FEATURES, flagRes.overrides);
const journalMode = featureOn('journal');
const PERIOD_LABELS = [['day', '日'], ['week', '週'], ['month', '月'], ['quarter', '季'], ['half', '半年'], ['year', '年']];

function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') e[k] = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}
const $ = (s, r = document) => r.querySelector(s);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const pad2 = n => (n < 10 ? '0' : '') + n;
function today() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
const fmt = n => (n == null || n === '' || isNaN(n)) ? '-' : Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// 簡易 Markdown:粗體、條列、含 | 的行以 pre 顯示。先跳脫再套樣式,避免 XSS
function mdToHtml(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let inList = false;
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.includes('|')) {
      closeList();
      const blk = [];
      while (i < lines.length && lines[i].includes('|')) blk.push(lines[i++]);
      out.push('<pre>' + esc(blk.join('\n')) + '</pre>');
      continue;
    }
    const m = ln.match(/^\s*[-*•]\s+(.*)$/);
    if (m) { if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + inline(m[1]) + '</li>'); }
    else { closeList(); out.push(ln.trim() ? '<div>' + inline(ln.replace(/^#+\s*/, '')) + '</div>' : '<div style="height:6px"></div>'); }
    i++;
  }
  closeList();
  return out.join('');
}

/* ---------- 設定 ---------- */
function getSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('pt_settings') || '{}'); } catch (_) { s = {}; }
  return Object.assign({ apiKey: '', proxyUrl: '', model: 'claude-sonnet-5-5', classifyModel: 'claude-haiku-5-5', locationEnabled: true, dbUrl: '', fbApiKey: '', useMock: false, myName: '我', myAccount: '', mediaStore: 'local', googleClientId: '', deleteLocalAfterUpload: false, keepPhotos: false, categories: DEFAULT_CATS.slice() }, s);
}
const hasAiKey = s => !!((s.apiKey || '').trim() || (s.proxyUrl || '').trim());
// AI 分析是否啟用:未明確設定時,有金鑰/中轉就開、沒有就關
const aiOn = s => (s.aiEnabled === undefined || s.aiEnabled === null ? hasAiKey(s) : !!s.aiEnabled);
function saveSettings(s) { localStorage.setItem('pt_settings', JSON.stringify(s)); }

/* ---------- 全螢幕頁面堆疊 ---------- */
const screensEl = $('#screens');
const stack = [];
function pushScreen(title, build, onClose, helpKey) {
  const s = el('section', { class: 'screen' });
  const head = el('header', { class: 'bar' }, el('button', { class: 'back', onclick: () => popScreen() }, '‹ 返回'), el('h2', {}, title), el('span', { class: 'bar-r' }, helpKey && Guide.helpFor(helpKey) ? el('button', { class: 'help-btn', 'aria-label': '說明', onclick: () => openHelp(helpKey) }, '?') : null));
  const body = el('div', { class: 'screen-body' });
  s.append(head, body);
  screensEl.append(s);
  const entry = { s, onClose, head, body };
  stack.push(entry);
  onScreensChange();
  build(body, entry);
  return entry;
}
function popScreen() {
  if (globalThis.__tjBusy && globalThis.__tjBusy()) return;   // 處理中不能返回
  const cur = stack[stack.length - 1];
  if (cur && cur.beforeClose && cur.beforeClose() === false) return;   // 例如匯出預覽尚未下載時要先確認
  const t = stack.pop();
  if (!t) return;
  if (t.onClose) t.onClose();
  t.s.remove();
  const top = stack[stack.length - 1];
  if (top && top.refresh) top.refresh();
  onScreensChange();
}


/* ---------- 通用:小提示 toast、固定儲存操作列、說明頁、功能選單、新手引導 ---------- */
function toast(msg, ms) {
  const old = document.getElementById('toast'); if (old) old.remove();
  const t = el('div', { class: 'toast', id: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => { if (t.parentNode) t.remove(); }, ms || 1500);
}
// 底部固定操作列:左側狀態字,右側按鈕。有變更按返回會二次確認(儲存/不儲存/繼續編輯)
function attachSaveBar(entry, cfg) {
  cfg = cfg || {};
  let st = SaveBar.create({ auto: cfg.auto });
  let lastToastAt = 0;
  const status = el('span', { class: 'sb-status', id: 'sbStatus' }, SaveBar.statusText(st));
  const view = el('button', { class: 'btn sb-view hidden', id: 'sbView' }, '查看');
  const save = el('button', { class: 'btn primary sb-save', id: cfg.id || 'sbSave', onclick: () => doSave() }, cfg.label || '💾 儲存');
  const bar = el('div', { class: 'savebar', id: 'savebar' }, status, el('span', { class: 'grow' }), view, ...(cfg.extra || []), save);
  entry.s.append(bar);
  const draw = () => { status.textContent = SaveBar.statusText(st); status.classList.toggle('dirty', st.dirty); };
  const setView = fn => { if (fn) { view.classList.remove('hidden'); view.onclick = fn; } };
  function markSaved(r) { st = SaveBar.markSaved(st, Date.now()); draw(); if (r && (r.toast || r.where)) toast(r.toast || SaveBar.toastText(r.where)); setView(r && r.view); }
  function markAuto(r) { st = SaveBar.markAuto(st, Date.now()); draw(); setView(r && r.view); if (r && (r.toast || r.where) && Date.now() - lastToastAt > 4000) { lastToastAt = Date.now(); toast(r.toast || SaveBar.toastText(r.where)); } }
  function markDirty() { if (!st.dirty) { st = SaveBar.markDirty(st); draw(); } }
  async function doSave() {
    save.disabled = true;
    try { const r = await cfg.onSave(); if (r === false) return false; markSaved(r || {}); return true; }
    catch (e) { alert('儲存失敗:' + (e && e.message ? e.message : e)); return false; }
    finally { save.disabled = false; }
  }
  entry.beforeClose = () => {
    if (!SaveBar.needsLeaveConfirm(st) || entry.leaveForce) return true;
    if (document.getElementById('leaveModal')) return false;
    const m = el('div', { class: 'modal', id: 'leaveModal', role: 'dialog' }, el('div', { class: 'modal-box' }, el('p', {}, '這裡有還沒儲存的變更。'),
      el('div', { class: 'col-btns' },
        el('button', { class: 'big-btn primary', id: 'leaveSave', onclick: async () => { m.remove(); if (await doSave()) { entry.leaveForce = true; popScreen(); } } }, el('span', { class: 'bt' }, '💾 儲存')),
        el('button', { class: 'big-btn danger', id: 'leaveDiscard', onclick: () => { m.remove(); entry.leaveForce = true; popScreen(); } }, el('span', { class: 'bt' }, '不儲存')),
        el('button', { class: 'big-btn', id: 'leaveStayEdit', onclick: () => m.remove() }, el('span', { class: 'bt' }, '繼續編輯')))));
    document.body.append(m);
    return false;
  };
  return { markDirty, markSaved, markAuto, doSave, dirty: () => st.dirty, state: () => st,
    trackInputs(root) { ['input', 'change'].forEach(ev => root.addEventListener(ev, () => markDirty())); }, status };
}
// 「📎 保留照片」開關:初始值取全域預設(預設關),可針對這一筆開啟
function keepSwitch(initial, onChange) {
  const cb = el('input', { type: 'checkbox', id: 'keepPhotoSw', checked: !!initial, style: 'width:22px;height:22px', onchange: e => onChange(e.target.checked) });
  return el('label', { class: 'keep-sw', title: '關閉時照片只用來對照,儲存時不寫入任何照片' }, cb, '📎 保留照片');
}

function openHelp(key) {
  const h = Guide.helpFor(key); if (!h) return;
  pushScreen(h.title + ' 說明', body => {
    body.append(el('div', { class: 'card', id: 'helpBox' }, h.lines.map(l => el('p', { class: 'explain-p' }, l))), el('button', { class: 'big-btn primary', onclick: () => popScreen() }, el('span', { class: 'bt' }, '知道了')));
  });
}

// 回到相機並切到指定模式(功能選單「拍照記帳」「轉 Excel」用)
function goCamera(mode) {
  while (stack.length) { const t = stack.pop(); if (t.onClose) t.onClose(); t.s.remove(); }
  onScreensChange();
  if (mode && Modes.selectable(mode, aiOn(getSettings()))) { home.mode = mode; Modes.remember(localStorage, mode); }
  drawHomeChrome();
}

// 功能選單:你想做什麼?(模式列=拍什麼;這裡=做什麼)
function openFuncMenu() {
  pushScreen('你想做什麼?', body => {
    const go = async f => {
      const a = f.action;
      if (a.type === 'camera') { goCamera(a.mode); return; }
      if (a.type === 'voice') { if (a.kind === 'expense') LedgerUI.openVoiceExpense(); else LedgerUI.openVoiceSplit(); return; }
      if (a.name === 'trips') { const t = await DB.allTrips(); if (t.length) LedgerUI.openTripList(); else LedgerUI.openNewTrip(); }
      else if (a.name === 'room') MenuUI.openCreateRoom();
      else if (a.name === 'stats') LedgerUI.openMyStats();
      else if (a.name === 'ledger') openLedger();
      else if (a.name === 'files') Files.openFiles();
      else if (a.name === 'settings') openSettings();
    };
    body.append(el('div', { class: 'func-grid', id: 'funcGrid' }, Guide.FUNCS.map(f => el('button', { class: 'func-card', 'data-func': f.id, onclick: () => go(f) },
      el('span', { class: 'fi' }, f.icon), el('span', { class: 'ft' }, el('b', {}, f.title), el('small', {}, f.desc))))));
  }, null, 'menu');
}

// 第一次開 App 的引導卡(可略過),看完或略過後不再顯示;設定頁可重看
function openOnboarding() {
  if (document.getElementById('onboard')) return;
  let i = 0;
  const box = el('div', { class: 'onboard', id: 'onboard', role: 'dialog' });
  const finish = () => { Guide.markOnboarded(localStorage); box.remove(); };
  const draw = () => {
    const c = Guide.ONBOARD[i], last = i === Guide.ONBOARD.length - 1;
    box.replaceChildren(el('div', { class: 'ob-card' },
      el('div', { class: 'ob-icon' }, c.icon), el('p', { class: 'ob-text', id: 'obText' }, c.text),
      el('div', { class: 'ob-dots' }, Guide.ONBOARD.map((_, k) => el('span', { class: 'dot' + (k === i ? ' on' : '') }))),
      el('div', { class: 'ob-btns' }, last ? null : el('button', { class: 'big-btn', id: 'obSkip', onclick: finish }, el('span', { class: 'bt' }, '略過')),
        el('button', { class: 'big-btn primary', id: 'obNext', onclick: () => { if (last) finish(); else { i++; draw(); } } }, el('span', { class: 'bt' }, last ? '開始使用' : '下一步')))));
  };
  draw();
  document.body.append(box);
}

function refreshTop() { const t = stack[stack.length - 1]; if (t && t.refresh) t.refresh(); }
const mainEl = $('#main');

/* ---------- 圖片縮放 ---------- */
const isPdf = b => b && b.type === 'application/pdf';
const thumbImg = (b, alt, url) => isPdf(b) ? el('div', { class: 'pdf-tile', 'aria-label': 'PDF 檔' }, 'PDF') : el('img', { src: url || URL.createObjectURL(b), alt });
async function resizeImage(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (_) {
    bmp = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); });
  }
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
  const k = Math.min(1, 1600 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.8));
}

/* ---------- 1. 首頁:相機取景 ---------- */
const compose = { blobs: [], location: null, locPending: null };

function getLocation() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    let done = false;
    const fin = v => { if (done) return; done = true; clearTimeout(t); res(v); };
    const t = setTimeout(() => fin(null), 8000);
    try {
      navigator.geolocation.getCurrentPosition(
        p => fin({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), accuracy: Math.round(p.coords.accuracy || 0), ts: Date.now() }),
        () => fin(null), { enableHighAccuracy: false, timeout: 7000, maximumAge: 60000 });
    } catch (_) { fin(null); }
  });
}
// 第一次拍照時觸發(使用者手勢);被拒或關閉定位時靜默略過
function captureLocation() {
  if (!getSettings().locationEnabled || compose.location || compose.locPending) return;
  compose.locPending = getLocation().then(l => { compose.location = l; compose.locPending = null; });
}
const cam = { stream: null, facing: 'environment', video: null, fallback: false, starting: false, suppress: false };
const home = {};

function renderHome() {
  mainEl.replaceChildren();
  const addFiles = async (ev, fromCam) => {
    if (fromCam) captureLocation();
    const files = Array.from(ev.target.files || []).slice(0, 4 - compose.blobs.length);
    ev.target.value = '';
    for (const f of files) {
      if (f.size > MAX_FILE) { alert('檔案「' + f.name + '」超過 20MB,請換小一點的檔案或分次處理。'); continue; }
      try { compose.blobs.push(f.type === 'application/pdf' ? f : await resizeImage(f)); } catch (e) { alert('讀取檔案失敗'); }
    }
    homeRefresh();
    if (!fromCam && files.length && compose.blobs.length) proceed();         // 相簿選圖/PDF:直接進入目前模式的流程
  };
  home.video = el('video', { class: 'cam-video', playsinline: true, muted: true, autoplay: true });
  home.video.muted = true;
  home.fallbackBox = el('div', { class: 'cam-fallback hidden', id: 'camFallback' },
    el('div', { class: 'cam-msg', id: 'camMsg' }),
    el('label', { class: 'btn primary', id: 'btnFileCapture' }, '📷 拍照', el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', id: 'inpCam', onchange: ev => addFiles(ev, true) })));
  home.pendingChip = el('button', { class: 'cam-chip hidden', id: 'btnPending' });
  home.uploadChip = el('button', { class: 'cam-chip hidden', id: 'btnUploads', onclick: () => CloudUI.uploadNow().then(homeRefresh).catch(e => alert(e.message)) });
  home.thumbs = el('div', { class: 'cam-thumbs', id: 'camThumbs' });
  home.shutter = el('button', { class: 'shutter', id: 'btnShutter', 'aria-label': '拍照', onclick: shoot });
  home.flip = el('button', { class: 'cam-btn', id: 'btnFlip', 'aria-label': '切換鏡頭', onclick: () => { cam.facing = cam.facing === 'environment' ? 'user' : 'environment'; startCamera(); } }, '🔄');
  home.done = el('button', { class: 'btn primary hidden', id: 'btnDone', onclick: proceed }, '完成');
  home.flash = el('div', { class: 'cam-flash' });
  home.aiBar = el('div', { class: 'cam-notice hidden', id: 'aiBar' }, el('span', { class: 'nt', id: 'aiBarText' }), el('button', { class: 'btn sm', id: 'aiBarBtn', onclick: () => openAiHelp() }, '啟用 AI'));
  home.modeChips = el('div', { class: 'mode-row', id: 'modeRow' });
  home.modeDesc = el('div', { class: 'cam-hint mode-desc', id: 'modeDesc' });
  home.modeBox = el('div', { class: 'cam-modes', id: 'camModes' }, el('div', { class: 'mode-cap' }, '拍什麼'), home.modeChips);
  home.mode = Modes.recall(localStorage, aiOn(getSettings()));
  mainEl.append(el('div', { class: 'cam' },
    home.video, home.fallbackBox, home.flash,
    el('div', { class: 'cam-head' },
      el('div', { class: 'cam-top' }, el('button', { class: 'cam-func', id: 'btnFunc', onclick: openFuncMenu }, '☰ 功能'), home.pendingChip, home.uploadChip),
      home.modeDesc, home.aiBar),
    el('div', { class: 'cam-bottom' },
      home.modeBox,
      home.thumbs,
      el('div', { class: 'cam-ctl' },
        el('label', { class: 'cam-btn', 'aria-label': '從相簿選' }, '🖼', el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, class: 'hidden', id: 'inpAlbum', onchange: ev => addFiles(ev, false) })),
        home.shutter, home.flip),
      home.done)));
  homeRefresh();
  startCamera();
}

// 模式列與 AI 提示(依目前 AI 狀態重畫;設定改變後回到首頁會更新)
function drawHomeChrome(blockedId) {
  if (!home.modeChips) return;
  const ai = aiOn(getSettings());
  home.mode = Modes.resolveMode(home.mode, ai);
  const bar = Modes.aiBar(ai);
  home.aiBar.classList.toggle('hidden', !bar);
  if (bar) { $('#aiBarText').textContent = bar.text; $('#aiBarBtn').textContent = bar.button; }
  home.modeChips.replaceChildren(...Modes.MODES.map(m => el('button', { class: 'mode-chip' + (m.id === home.mode ? ' on' : ''), 'data-mode': m.id, 'aria-pressed': m.id === home.mode ? 'true' : 'false', onclick: () => {
    if (!Modes.selectable(m.id, aiOn(getSettings()))) { drawHomeChrome(m.id); return; }
    home.mode = m.id; Modes.remember(localStorage, m.id); drawHomeChrome();
  } }, m.icon + ' ' + m.label, m.needsAi && !ai ? el('small', {}, 'AI') : null)));
  const cur = Modes.byId(home.mode);
  home.modeDesc.replaceChildren(blockedId ? el('span', { id: 'modeBlocked' }, Modes.AI_NEEDED_TEXT + ' ', el('button', { class: 'btn sm primary', id: 'modeGoSettings', onclick: () => openAiHelp() }, '去設定')) : el('span', { id: 'modeDescText' }, cur.desc));
  const act = home.modeChips.querySelector('.mode-chip.on'); if (act && act.scrollIntoView) act.scrollIntoView({ inline: 'center', block: 'nearest' });
}

async function homeRefresh() {
  if (!home.thumbs) return;
  drawHomeChrome();
  const n = compose.blobs.length;
  home.thumbs.replaceChildren(...compose.blobs.map((b, i) => el('div', { class: 'thumb' },
    thumbImg(b, '照片' + (i + 1)),
    el('button', { 'aria-label': '移除照片', onclick: () => { compose.blobs.splice(i, 1); homeRefresh(); } }, '×'))));
  home.done.classList.toggle('hidden', n === 0);
  home.done.textContent = '完成(' + n + ' 張)';
  home.shutter.disabled = n >= 4;
  try {
    const p = await DB.allPending();
    home.pendingChip.classList.toggle('hidden', !p.length);
    home.pendingChip.textContent = '待處理 ' + p.length + ' 筆';
    home.pendingChip.onclick = () => processPending(p[0]);
  } catch (_) { /* ignore */ }
  try { const c = await Media.mediaApi().counts(); home.uploadChip.classList.toggle('hidden', !c.waiting); home.uploadChip.textContent = '待上傳 ' + c.waiting + ' 張'; } catch (_) { /* 媒體模組未就緒 */ }
}

function showCamFallback(reason) {
  cam.fallback = true;
  home.video.classList.add('hidden');
  home.fallbackBox.classList.remove('hidden');
  $('#camMsg').textContent = '無法使用相機取景(' + reason + '),請改用下方按鈕拍照,或從左下相簿選圖。';
  home.shutter.classList.add('hidden');
  home.flip.classList.add('hidden');
}

async function startCamera() {
  if (!home.video || cam.starting || cam.suppress || stack.length) return;
  cam.starting = true;
  stopCamera();
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('瀏覽器不支援');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cam.facing }, audio: false });
    if (stack.length) { stream.getTracks().forEach(t => t.stop()); cam.starting = false; return; }
    cam.stream = stream; cam.fallback = false;
    home.video.srcObject = stream;
    home.video.classList.remove('hidden'); home.fallbackBox.classList.add('hidden');
    home.shutter.classList.remove('hidden'); home.flip.classList.remove('hidden');
    try { await home.video.play(); } catch (_) { /* autoplay 被擋時仍可顯示 */ }
  } catch (e) {
    showCamFallback(e.name === 'NotAllowedError' ? '權限被拒' : (e.message || e.name || '未知原因'));
  }
  cam.starting = false;
}
function stopCamera() {
  if (cam.stream) { cam.stream.getTracks().forEach(t => t.stop()); cam.stream = null; }
  if (home.video) home.video.srcObject = null;
}

async function shoot() {
  captureLocation();
  const v = home.video;
  if (!cam.stream || !v.videoWidth || compose.blobs.length >= 4) return;
  const k = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  const b = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.8));
  compose.blobs.push(b);
  home.flash.classList.add('on'); setTimeout(() => home.flash.classList.remove('on'), 120);
  homeRefresh();
}

function onScreensChange() {
  if (journalMode) return;   // 旅遊日誌模式不啟動相機
  if (stack.length) stopCamera();
  else { cam.suppress = false; homeRefresh(); startCamera(); }
}

async function processPending(p) {
  if (!p) return;
  if (!navigator.onLine) { alert('目前沒有網路'); return; }
  await openChat({ blobs: p.blobs, text: p.text, mode: p.mode, hint: p.hint, location: p.location, pendingId: p.id });
}

/* ---------- 2. 拍照前先選模式:完成後直接進入該模式的流程(不再有分類與動作選單) ---------- */
const KIND_LABEL = { receipt: '收據', menu: '菜單', bill_list: '帳單/明細', table: '表格', form: '表單', text_doc: '文件/文字', plant: '植物', object: '物品', screenshot: '螢幕截圖', other: '其他' };

const honestNote = id => { const m = Modes.byId(id); return m && m.noAi ? el('div', { class: 'banner warn', id: 'noAiNote' }, m.noAi) : null; };

// 有 AI:直接呼叫對應 tool(進對話頁,保留原有確認/衝突流程);沒有 AI:手動入口
async function runMode(modeId, blobs, loc) {
  const ai = aiOn(getSettings());
  const fl = Modes.flow(modeId, ai);
  if (fl.kind === 'blocked') { alert(Modes.AI_NEEDED_TEXT); return false; }
  if (fl.kind === 'ai-menu') { MenuUI.openMenuBuilder(blobs, { auto: true }); return true; }
  if (fl.kind === 'ai-auto') { openAuto(blobs, loc); return true; }
  if (fl.kind === 'ai-chat') {
    let hint = '';
    if (modeId === 'translate') hint = '(請翻譯成繁體中文)';
    if (modeId === 'table' && blobs.length > 1) hint = confirm('這 ' + blobs.length + ' 張照片是同一份表格的多頁嗎?\n按「確定」=合併成同一個工作表;按「取消」=每張各一個工作表。')
      ? '(共 ' + blobs.length + ' 份檔案是同一表單的多頁,請合併成同一個工作表依序續接,只保留一份表頭)' : '(共 ' + blobs.length + ' 份檔案,請每份各一個工作表,sheets 依序對應)';
    return openChat({ blobs, text: '', mode: fl.chatMode, hint, location: loc });
  }
  manualFlow(Modes.byId(modeId).manual, blobs, loc, () => { compose.blobs = []; compose.location = null; homeRefresh(); });
  return true;
}

async function proceed() {
  const blobs = compose.blobs.slice();
  if (!blobs.length) return;
  if (compose.locPending) await compose.locPending;
  const loc = compose.location;
  const mode = Modes.resolveMode(home.mode, aiOn(getSettings()));
  const ok = await runMode(mode, blobs, loc);
  // 對話流程成功開始後清掉暫存照片;手動流程由各自儲存後清除(取消則保留,方便重做)
  if (ok && Modes.flow(mode, aiOn(getSettings())).kind === 'ai-chat') { compose.blobs = []; compose.location = null; }
  if (ok && ['ai-menu', 'ai-auto'].includes(Modes.flow(mode, aiOn(getSettings())).kind)) { compose.blobs = []; compose.location = null; }
}

// 「自動」模式:先用小模型分類,再走對應模式。分類失敗時請使用者自己選
function openAuto(blobs, loc) {
  pushScreen('自動判斷', async body => {
    const box = el('div', { class: 'card', id: 'autoBox' }, el('span', { class: 'spin' }), ' 正在判斷照片內容…');
    body.append(box);
    const manualPick = msg => {
      box.replaceChildren(el('div', {}, msg), el('div', { class: 'big-grid two', style: 'margin-top:10px' }, Modes.MODES.filter(m => m.id !== 'auto' && Modes.selectable(m.id, true)).map(m => el('button', { class: 'big-btn', 'data-pick': m.id, onclick: () => { popScreen(); runMode(m.id, blobs, loc); } }, el('span', { class: 'bi' }, m.icon), el('span', { class: 'bt' }, m.label)))));
    };
    if (!navigator.onLine) { manualPick('目前離線,無法自動判斷。請自己選功能:'); return; }
    try {
      const r = await AI.classifyPhotos(getSettings(), blobs);
      const id = Modes.modeFromClassify(r);
      box.replaceChildren(el('div', {}, '這看起來是:', el('b', {}, KIND_LABEL[r.kind] || '其他'), ' → ', Modes.byId(id).label));
      setTimeout(() => { popScreen(); runMode(id, blobs, loc); }, 500);
    } catch (e) { manualPick((e.code === 'NO_KEY' ? '尚未設定 API 金鑰或中轉網址。' : '判斷失敗:' + e.message + '。') + '請自己選功能:'); }
  });
}

// 如何啟用 AI 讀照片(首頁提示與設定頁共用)
function openAiHelp() {
  pushScreen('啟用 AI 讀照片', body => {
    body.append(el('div', { class: 'card', id: 'aiHelp' },
      el('b', {}, 'AI 讀照片是做什麼的?'),
      el('p', {}, '拍收據、表格、菜單後,由 AI 自動讀出金額和內容,你只要核對。沒有啟用也能用,只是要自己手動填。'),
      el('b', {}, '怎麼啟用'),
      el('ol', { class: 'steps' },
        el('li', {}, '到 Anthropic 官方網站的開發者主控台(Console)註冊並設定付款方式。畫面文字可能略有不同。'),
        el('li', {}, '在主控台建立一把 API 金鑰,複製起來。'),
        el('li', {}, '回到本 App「設定」,貼到「Anthropic API 金鑰」,打開「AI 分析」,按「儲存設定」。金鑰只存在這支手機。')),
      el('b', {}, '費用估計'),
      el('p', {}, '一般收據一筆約 US$0.015、約 NT$0.45(這是估算,實際會依照片大小、模型與匯率變動)。')),
      el('button', { class: 'big-btn primary', id: 'aiHelpGo', onclick: () => { popScreen(); openSettings(); } }, el('span', { class: 'bi' }, '⚙️'), el('span', { class: 'bt' }, '前往設定')));
  });
}

/* ---------- 對話頁 ---------- */
function openChat(init) {
  return new Promise(resolve => {
    const settings = getSettings();
    const chat = { photoBlobs: init.blobs, location: init.location || null, apiMessages: [], items: [], busy: false, lastToolIds: [], queued: false, started: false };
    const urls = init.blobs.map(b => URL.createObjectURL(b));
    let log, input, sendBtn;

    const activeCard = () => { for (let i = chat.items.length - 1; i >= 0; i--) if (['record', 'split', 'calc', 'table'].includes(chat.items[i].k)) return chat.items[i]; return null; };

    function render(keep) {
      const st = log.scrollTop;
      log.replaceChildren();
      const act = activeCard();
      chat.items.forEach(it => {
        if (it.k === 'user') {
          log.append(el('div', { class: 'bubble user' },
            it.first && urls.length ? el('div', { class: 'thumbs' }, urls.map((u, i) => el('div', { class: 'thumb' }, thumbImg(init.blobs[i], '照片', u)))) : null,
            it.text));
        } else if (it.k === 'answer') {
          const d = el('div', { class: 'bubble ai' }); d.innerHTML = mdToHtml(it.text); log.append(d);
        } else if (it.k === 'err') {
          log.append(el('div', { class: 'bubble err' }, it.text));
        } else if (it.k === 'record') {
          log.append(it === act ? recordCard(it.draft, chat, rerender, send) : el('div', { class: 'bubble ai muted' }, '(記帳草稿已被新版本取代)'));
        } else if (it.k === 'calc') {
          log.append(it === act ? calcCard(it) : el('div', { class: 'bubble ai muted' }, '(計算結果已被新版本取代)'));
        } else if (it.k === 'table') {
          log.append(it === act ? tableCard(it, rerender) : el('div', { class: 'bubble ai muted' }, '(表格已被新版本取代)'));
        } else if (it.k === 'split') {
          log.append(it === act ? splitCard(it, chat, rerender) : el('div', { class: 'bubble ai muted' }, '(分帳結果已被新版本取代)'));
        }
      });
      if (chat.busy) log.append(el('div', { class: 'bubble ai' }, el('span', { class: 'spin' }), ' 分析中…'));
      sendBtn.disabled = chat.busy;
      log.scrollTop = keep === true ? st : log.scrollHeight;
    }
    const rerender = () => render(true);

    async function send(text, opts = {}) {
      if (chat.busy) return false;
      const content = [];
      const first = chat.apiMessages.length === 0;
      if (chat.lastToolIds.length) chat.lastToolIds.forEach(id => content.push({ type: 'tool_result', tool_use_id: id, content: 'ok' }));
      let userText = text;
      if (first) {
        for (const b of init.blobs) content.push(await AI.fileBlock(b));
        userText = (AI.MODE_HINTS[init.mode] || '') + (init.hint || '') + (text || '請分析這些照片');
      } else {
        const a = activeCard();
        if (a && a.k === 'table') userText += '\n\n(目前表格:' + JSON.stringify(tableToJson(a)) + ')';
        if (a && a.k === 'record' && !a.draft.saved) userText += '\n\n(目前記帳草稿:' + JSON.stringify(a.draft.data) + ')';
      }
      content.push({ type: 'text', text: userText });

      if (first && !navigator.onLine) {
        await DB.addPending({ id: init.pendingId || uuid(), createdAt: Date.now(), text: init.text, mode: init.mode, hint: init.hint, location: init.location, blobs: init.blobs });
        chat.queued = true;
        alert('目前沒有網路,已排入「待處理」,恢復連線後可在相機首頁左上「待處理」處理。');
        popScreen();
        return true;
      }

      chat.apiMessages.push({ role: 'user', content });
      if (!opts.silent) chat.items.push({ k: 'user', text: text || '(僅照片)', first });
      chat.busy = true; render();
      try {
        const resp = await AI.callModel(settings, chat.apiMessages, AI.buildSystem(today(), settings.categories), init.mode === 'excel' || init.mode === 'menu' ? { max_tokens: 8000 } : {});
        const blocks = (resp.content || []).filter(b => b.type === 'tool_use' || b.type === 'text');
        chat.apiMessages.push({ role: 'assistant', content: blocks });
        chat.lastToolIds = blocks.filter(b => b.type === 'tool_use').map(b => b.id);
        const tools = blocks.filter(b => b.type === 'tool_use');
        if (!tools.length) chat.items.push({ k: 'answer', text: blocks.map(b => b.text).join('\n') || '(無回應)' });
        tools.forEach(tu => handleTool(tu));
        if (init.pendingId && first) { await DB.deletePending(init.pendingId); init.pendingId = null; }
        chat.started = true;
      } catch (e) {
        chat.apiMessages.pop();
        if (!opts.silent) chat.items.pop();
        const net = e instanceof TypeError;
        if (first && net && !chat.queued) {
          await DB.addPending({ id: init.pendingId || uuid(), createdAt: Date.now(), text: init.text, mode: init.mode, hint: init.hint, location: init.location, blobs: init.blobs });
          chat.queued = true; chat.busy = false;
          alert('連線失敗,已排入「待處理」。');
          popScreen();
          return true;
        }
        chat.items.push({ k: 'err', text: (e.code === 'NO_KEY' ? '尚未設定 API 金鑰或中轉網址,請到「設定」頁填寫。' : net ? '連線失敗,請檢查網路後重試。' : e.message) });
        if (first && input && !input.value) input.value = init.text || '';
        chat.busy = false; render();
        return false;
      }
      chat.busy = false; render();
      return true;
    }

    function handleTool(tu) {
      const inp = tu.input || {};
      if (tu.name === 'answer') chat.items.push({ k: 'answer', text: inp.text || '' });
      else if (tu.name === 'record_expense') chat.items.push({ k: 'record', draft: makeDraft(inp, settings) });
      else if (tu.name === 'split_bill') chat.items.push(makeSplit(inp));
      else if (tu.name === 'extract_table') { const tb = makeTable(inp); tb.photos = chat.photoBlobs; tb.location = chat.location; chat.items.push(tb); }
      else if (tu.name === 'calc_numbers') chat.items.push(makeCalc(inp));
      else chat.items.push({ k: 'answer', text: JSON.stringify(inp, null, 2) });
    }

    pushScreen('分析結果', (body, entry) => {
      body.style.cssText = 'padding:0;overflow:hidden';
      log = el('div', { class: 'chat-log' });
      input = el('textarea', { placeholder: '追問或補充(可用鍵盤麥克風)', rows: 1, id: 'chatInput' });
      sendBtn = el('button', { class: 'btn primary', id: 'chatSend', onclick: async () => { const t = input.value.trim(); if (!t) return; input.value = ''; const ok = await send(t); if (!ok && !chat.queued) input.value = t; } }, '送出');
      body.append(el('div', { class: 'chat-wrap' }, log, el('div', { class: 'chat-in' }, input, sendBtn)));
      render();
      entry.s.dataset.chat = '1';
      send(init.text);
    }, () => { urls.forEach(u => URL.revokeObjectURL(u)); resolve(chat.started || chat.queued); });
  });
}

/* ---------- 記帳草稿 ---------- */
const FIELD_KEYS = ['date', 'store', 'total', 'currency', 'payment_method', 'category', 'payer', 'shared', 'note'];

function makeDraft(inp, settings) {
  const { data, issues } = Reconcile.normalizeDraft(inp, today());
  if (!data.payer) data.payer = settings.myName;
  if (!data.currency) data.currency = 'TWD';
  const draft = {
    data, issues,
    conflicts: (inp.conflicts || []).map(c => ({ field: c.field, voice_value: String(c.voice_value ?? ''), receipt_value: String(c.receipt_value ?? ''), resolved: false, editing: false })),
    questions: (inp.questions || []).slice(0, 5).map(q => ({ id: q.id, field: q.field || '', text: q.text, options: (q.options || []).slice(0, 5), done: false, skipped: false })),
    calcChoice: null, saved: false, notes: inp.confidence_notes || '', photos: null,
  };
  return draft;
}

function setField(draft, field, raw) {
  const d = draft.data;
  const mItem = String(field).match(/^items\[(\d+)\]\.(\w+)$/);
  if (mItem && d.items[+mItem[1]]) {
    const it = d.items[+mItem[1]], k = mItem[2];
    it[k] = k === 'name' ? raw : Reconcile.parseAmount(raw);
    return true;
  }
  if (field === 'total') { const v = Reconcile.parseAmount(raw); if (v === null) return false; d.total = v; draft.calcChoice = null; return true; }
  if (field === 'date') { const v = Reconcile.normalizeDate(raw, { today: today() }); if (!v) return false; d.date = v; return true; }
  if (field === 'shared') { d.shared = /^(true|是|y|yes|1|共用|家庭)/i.test(String(raw).trim()); return true; }
  if (FIELD_KEYS.includes(field)) { d[field] = String(raw).trim(); return true; }
  return false;
}

function calcConflict(draft) { return draft.calcChoice ? null : Reconcile.itemsTotalConflict(draft.data); }

function draftReady(draft, settings) {
  const d = draft.data;
  if (!Reconcile.normalizeDate(d.date)) return false;
  if (d.total == null || isNaN(d.total)) return false;
  if (!d.category || !d.payer) return false;
  if (draft.conflicts.some(c => !c.resolved)) return false;
  if (calcConflict(draft)) return false;
  if (draft.questions.some(q => !q.done && !q.skipped)) return false;
  return true;
}

function recordCard(draft, chat, rerender, send) {
  const settings = getSettings();
  const d = draft.data;
  const card = el('div', { class: 'card', id: 'recordCard' });
  card.append(el('div', { class: 'row' }, el('h2', { class: 'grow' }, '記帳草稿'), draft.saved ? el('span', { class: 'tag ok' }, '已存入') : el('span', { class: 'tag warn' }, '待確認')));
  if (draft.saved && draft.savedId) card.append(el('div', { class: 'row', style: 'margin:6px 0' }, el('span', { class: 'muted small' }, KeepPhoto.detailText(draft.keptCount || 0)), el('button', { class: 'btn sm', id: 'btnViewSaved', onclick: () => openDetail(draft.savedId) }, '查看這筆')));
  const cats = settings.categories.includes(d.category) || !d.category ? settings.categories : settings.categories.concat([d.category]);

  const f = (label, node) => [el('label', { class: 'f' }, label), node];
  const bind = (k, extra) => e => { if (setField(draft, k, e.target.value)) { if (extra) extra(); rerenderBtn(); } };
  const dateIn = el('input', { type: 'date', value: d.date, disabled: draft.saved, onchange: e => { setField(draft, 'date', e.target.value); rerender(); } });
  card.append(
    ...f('日期', dateIn), ...f('店名', el('input', { type: 'text', value: d.store || '', disabled: draft.saved, onchange: bind('store') })),
    ...f('總額', el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: d.total ?? '', disabled: draft.saved, onchange: e => { if (e.target.value === '') { d.total = null; } else setField(draft, 'total', e.target.value); rerender(); } })),
    ...f('分類', selectOf(cats, d.category, v => { d.category = v; rerender(); }, draft.saved, '(請選擇)')),
    ...f('付款方式', selectOf(PAYMENTS.includes(d.payment_method) || !d.payment_method ? PAYMENTS : PAYMENTS.concat([d.payment_method]), d.payment_method, v => { d.payment_method = v; rerender(); }, draft.saved, '(未指定)')),
    ...f('付款人', el('input', { type: 'text', value: d.payer || '', disabled: draft.saved, onchange: e => { d.payer = e.target.value.trim(); rerender(); } })),
    el('label', { class: 'row', style: 'margin:10px 0' }, el('input', { type: 'checkbox', checked: d.shared, disabled: draft.saved, style: 'width:22px;height:22px', onchange: e => { d.shared = e.target.checked; } }), '家庭共用'));
  if (d.items.length) {
    card.append(el('label', { class: 'f' }, '品項'), el('table', { class: 't' },
      el('tr', {}, el('th', {}, '品名'), el('th', { class: 'n' }, '數量'), el('th', { class: 'n' }, '單價'), el('th', { class: 'n' }, '金額')),
      d.items.map(it => el('tr', {}, el('td', {}, it.name), el('td', { class: 'n' }, fmt(it.qty)), el('td', { class: 'n' }, fmt(it.unit_price)), el('td', { class: 'n' }, fmt(it.amount))))));
  }
  if (draft.notes) card.append(el('div', { class: 'muted small' }, '模型備註:' + draft.notes));
  if (draft.issues.includes('date')) card.append(el('div', { class: 'tag warn' }, '日期格式無法辨識,請手動選擇'));

  // conflicts(模型提出 + 程式驗算)
  const allConf = draft.conflicts.map(c => ({ c, calc: false }));
  const cc = calcConflict(draft);
  if (cc) allConf.push({ c: cc, calc: true });
  if (allConf.length && !draft.saved) card.append(el('h3', {}, '不一致需要確認'));
  allConf.forEach(({ c, calc }) => {
    if (draft.saved) return;
    const box = el('div', { class: 'conf' + (c.resolved ? ' done' : '') });
    const label = calc ? '總額與品項加總不符' : '欄位「' + c.field + '」不一致';
    box.append(el('div', {}, el('b', {}, label), c.resolved ? el('span', { class: 'tag ok', style: 'margin-left:6px' }, '已選') : null));
    box.append(el('div', { class: 'small' }, (calc ? '寫的總額:' : '語音:') + c.voice_value + ' ｜ ' + (calc ? '品項加總:' : '收據:') + c.receipt_value));
    const apply = (val) => {
      if (calc) { draft.calcChoice = 'x'; if (!setField(draft, 'total', val)) { draft.calcChoice = null; return; } draft.calcChoice = 'x'; }
      else {
        const known = FIELD_KEYS.includes(c.field) || /^items\[/.test(c.field);
        if (known) { if (!setField(draft, c.field, val)) { alert('這個值無法套用,請改用「自己輸入」'); return; } }
        else draft.data.note = (draft.data.note ? draft.data.note + ';' : '') + c.field + ':' + val;
        c.resolved = true; c.editing = false;
      }
      rerender();
    };
    if (c.editing) {
      const inp = el('input', { type: 'text', id: 'confInput', placeholder: '輸入正確的值' });
      box.append(el('div', { class: 'row', style: 'margin-top:6px' }, inp, el('button', { class: 'btn primary sm', onclick: () => { if (inp.value.trim()) apply(inp.value.trim()); } }, '確定')));
    } else if (!c.resolved) {
      box.append(el('div', { class: 'row wrap', style: 'margin-top:6px' },
        el('button', { class: 'btn sm', onclick: () => apply(c.voice_value) }, calc ? '用總額' : '用語音'),
        el('button', { class: 'btn sm', onclick: () => apply(c.receipt_value) }, calc ? '用品項加總' : '用收據'),
        el('button', { class: 'btn sm', onclick: () => { c.editing = true; rerender(); } }, '自己輸入')));
    }
    card.append(box);
  });

  // questions
  if (draft.questions.length && !draft.saved) card.append(el('h3', {}, '請回答'));
  draft.questions.forEach(q => {
    if (draft.saved) return;
    const box = el('div', { class: 'q' + (q.done || q.skipped ? ' done' : '') });
    box.append(el('div', {}, el('b', {}, q.text), q.done ? el('span', { class: 'tag ok', style: 'margin-left:6px' }, '已回答:' + q.answer) : q.skipped ? el('span', { class: 'tag', style: 'margin-left:6px' }, '已略過') : null));
    if (!q.done) {
      const answer = async txt => {
        txt = String(txt).trim(); if (!txt) return;
        if (q.field && FIELD_KEYS.includes(q.field)) {
          if (!setField(draft, q.field, txt)) { alert('這個答案無法填入「' + q.field + '」,請換個寫法'); return; }
          q.done = true; q.answer = txt; q.skipped = false; rerender();
        } else {
          q.done = true; q.answer = txt; q.skipped = false;
          await send('回答「' + q.text + '」:' + txt);
        }
      };
      const free = el('input', { type: 'text', placeholder: '其他答案(可用鍵盤麥克風)' });
      box.append(
        el('div', { class: 'chips' }, q.options.map(o => el('button', { class: 'chip', onclick: () => answer(o) }, o))),
        el('div', { class: 'row' }, free, el('button', { class: 'btn sm', onclick: () => answer(free.value) }, '回答'), el('button', { class: 'btn sm', onclick: () => { q.skipped = true; rerender(); } }, '略過')));
    }
    card.append(box);
  });

  const saveBtn = el('button', { class: 'btn primary block', id: 'btnSaveExpense', style: 'margin-top:12px', disabled: draft.saved || !draftReady(draft, settings), onclick: async () => {
    const keep = KeepPhoto.fromSettings(getSettings(), draft.keep), n = (chat.photoBlobs || []).length;
    await saveDraft(draft, chat.photoBlobs, chat.location, keep);
    toast(KeepPhoto.toast('記帳本', keep, n));
    rerender();
  } }, draft.saved ? '已存入記帳本' : '存入記帳本');
  function rerenderBtn() { saveBtn.disabled = draft.saved || !draftReady(draft, settings); }
  if (!draft.saved && (chat.photoBlobs || []).length) card.append(keepSwitch(KeepPhoto.fromSettings(getSettings(), draft.keep), v => { draft.keep = v; }));
  card.append(saveBtn);
  return card;
}

function selectOf(options, value, onChange, disabled, placeholder) {
  const s = el('select', { disabled, onchange: e => onChange(e.target.value) },
    el('option', { value: '' }, placeholder || ''), options.map(o => el('option', { value: o }, o)));
  s.value = value || '';
  return s;
}

async function saveDraft(draft, photoBlobs, loc, keep) {
  const d = draft.data;
  const photoIds = await KeepPhoto.persist(photoBlobs, keep, b => Media.saveMedia(b, { kind: 'expense', location: loc }));   // 沒開「保留照片」就一張都不存
  draft.keptCount = photoIds.length;
  const rec = {
    id: uuid(), date: d.date, store: d.store || '', total: d.total, currency: d.currency || 'TWD', items: d.items,
    payment_method: d.payment_method || '', category: d.category, payer: d.payer, shared: !!d.shared, note: d.note || '',
    photoIds, location: loc || null, createdAt: Date.now(), updatedAt: Date.now(),
  };
  await DB.putExpense(rec);
  draft.saved = true;
  draft.savedId = rec.id;
}

/* ---------- 分帳卡 ---------- */
function makeSplit(inp) {
  let result = null, error = '';
  try { result = Split.calculate(inp); } catch (e) { error = e.message; }
  return { k: 'split', input: inp, result, error, saved: false };
}

function splitCard(it, chat, rerender) {
  const settings = getSettings();
  const wrap = el('div', {});
  if (it.error) return el('div', { class: 'bubble err' }, '分帳失敗:' + it.error);
  const r = it.result;
  const head = el('div', { class: 'card' },
    el('div', { class: 'row' }, el('h2', { class: 'grow' }, '分帳結果'), el('span', { class: 'money' }, '共 ' + fmt(r.grandTotal) + ' 元')),
    el('div', { class: 'muted small' }, '品項 ' + fmt(r.itemsTotal) + ' + 附加費 ' + fmt(r.feesTotal)));
  if (r.receiptTotal != null) head.append(el('div', { class: 'small' }, r.matchesReceipt ? el('span', { class: 'tag ok' }, '與收據總額 ' + fmt(r.receiptTotal) + ' 相符') : el('span', { class: 'tag warn' }, '與收據總額 ' + fmt(r.receiptTotal) + ' 差 ' + fmt(r.receiptDiff))));
  if (!r.balanced) head.append(el('div', { class: 'tag warn' }, '內部加總不平衡(請回報)'));
  wrap.append(head);
  r.people.forEach(p => {
    wrap.append(el('div', { class: 'card' },
      el('div', { class: 'row' }, el('b', { class: 'grow' }, p.name), el('span', { class: 'money' }, fmt(p.total) + ' 元')),
      el('table', { class: 't' },
        p.items.map(i => el('tr', {}, el('td', {}, i.name + (i.shared_with > 1 ? '(÷' + i.shared_with + ')' : '')), el('td', { class: 'n' }, fmt(i.share)))),
        p.fees.map(f => el('tr', {}, el('td', { class: 'muted' }, f.name), el('td', { class: 'n' }, fmt(f.amount)))),
        el('tr', {}, el('td', {}, '小計 / 費用'), el('td', { class: 'n' }, fmt(p.subtotal) + ' / ' + fmt(p.feeTotal))))));
  });
  if (r.notes.length) wrap.append(el('div', { class: 'card small' }, el('b', {}, '備註'), el('ul', { style: 'margin:4px 0;padding-left:18px' }, r.notes.map(n => el('li', {}, n)))));
  const unclear = it.input.unclear || [];
  if (unclear.length) wrap.append(el('div', { class: 'card small' }, el('b', {}, '看不清楚/需確認'), el('ul', { style: 'margin:4px 0;padding-left:18px' }, unclear.map(n => el('li', {}, n)))));

  // 存入記帳本
  if (it.saved) { wrap.append(el('div', { class: 'banner' }, '已存入記帳本')); return wrap; }
  const store = el('input', { type: 'text', placeholder: '店名(選填)', id: 'splitStore' });
  const date = el('input', { type: 'date', value: today(), id: 'splitDate' });
  const who = selectOf(r.people.map(p => p.name), r.people.some(p => p.name === settings.myName) ? settings.myName : r.people[0].name, () => {}, false, '');
  who.id = 'splitWho';
  const doSave = async whole => {
    const meName = who.value;
    const me = r.people.find(p => p.name === meName);
    const items = whole ? it.input.items.map(i => ({ name: i.name, qty: i.qty ?? null, unit_price: null, amount: i.amount })) : me.items.map(i => ({ name: i.name, qty: null, unit_price: null, amount: i.share })).concat(me.fees.map(f => ({ name: f.name, qty: null, unit_price: null, amount: f.amount })));
    const rec = {
      id: uuid(), date: Reconcile.normalizeDate(date.value) || today(), store: store.value.trim(), total: whole ? r.grandTotal : me.total, currency: 'TWD',
      items, payment_method: '', category: '餐飲', payer: settings.myName, shared: false,
      note: whole ? '分帳(整張):' + r.people.map(p => p.name + ' ' + fmt(p.total)).join('、') : '分帳(' + meName + ' 那份)', photoIds: [], location: chat.location || null, createdAt: Date.now(), updatedAt: Date.now(),
    };
    const keep = KeepPhoto.fromSettings(getSettings(), it.keep);
    rec.photoIds.push(...await KeepPhoto.persist(chat.photoBlobs || [], keep, b => Media.saveMedia(b, { kind: 'expense', location: chat.location })));
    await DB.putExpense(rec);
    toast(KeepPhoto.toast('記帳本', keep, (chat.photoBlobs || []).length));
    it.saved = true; rerender();
  };
  wrap.append(el('div', { class: 'card' },
    el('b', {}, '存入記帳本'),
    (chat.photoBlobs || []).length ? keepSwitch(KeepPhoto.fromSettings(getSettings(), it.keep), v => { it.keep = v; }) : null,
    el('label', { class: 'f' }, '日期'), date, el('label', { class: 'f' }, '店名'), store, el('label', { class: 'f' }, '我是誰'), who,
    el('div', { class: 'row', style: 'margin-top:10px' },
      el('button', { class: 'btn primary grow', id: 'btnSaveMine', onclick: () => doSave(false) }, '存我的那份'),
      el('button', { class: 'btn grow', id: 'btnSaveWhole', onclick: () => doSave(true) }, '存整張'))));
  return wrap;
}

/* ---------- 計算卡(數字由程式運算) ---------- */
const CALC_OPS = [['sum', '加總'], ['avg', '平均'], ['diff', '第一個減其餘'], ['product', '連乘'], ['min', '最小'], ['max', '最大'], ['count', '個數']];
function makeCalc(inp) {
  const nums = (inp.numbers || []).map(n => ({ label: n.label || '', value: Reconcile.parseAmount(n.value), on: true })).filter(n => n.value !== null);
  return { k: 'calc', nums, op: CALC_OPS.some(o => o[0] === inp.op) ? inp.op : 'sum', note: inp.note || '' };
}
function calcCard(it) {
  const card = el('div', { class: 'card', id: 'calcCard' }, el('h2', {}, '數字計算'));
  const res = el('div', { class: 'money', id: 'calcResult', style: 'font-size:24px;margin-top:8px' });
  const upd = () => {
    const vals = it.nums.filter(n => n.on).map(n => n.value);
    const r = Reconcile.calcNumbers(vals, it.op);
    res.textContent = r ? '= ' + fmt(r.value) : '(請至少勾選一個數字)';
    if (r) res.title = r.expr;
  };
  const opBox = el('div', { class: 'chips' });
  const drawOps = () => opBox.replaceChildren(...CALC_OPS.map(([k, l]) => el('button', { class: 'chip' + (it.op === k ? ' on' : ''), 'data-op': k, onclick: () => { it.op = k; drawOps(); upd(); } }, l)));
  drawOps();
  if (!it.nums.length) card.append(el('div', { class: 'muted' }, '沒有讀到數字,請在下方輸入補充或重拍。'));
  card.append(el('table', { class: 't' }, it.nums.map(n => el('tr', {},
    el('td', { style: 'width:34px' }, el('input', { type: 'checkbox', checked: n.on, style: 'width:22px;height:22px', onchange: e => { n.on = e.target.checked; upd(); } })),
    el('td', {}, n.label),
    el('td', { class: 'n', style: 'width:110px' }, el('input', { type: 'number', step: 'any', value: n.value, onchange: e => { const v = Reconcile.parseAmount(e.target.value); if (v !== null) { n.value = v; upd(); } } }))))));
  card.append(opBox, res);
  if (it.note) card.append(el('div', { class: 'muted small' }, it.note));
  upd();
  return card;
}

/* ---------- 2. 記帳本 ---------- */
/* ---------- 手動入口(AI 分析關閉或沒有金鑰時) ---------- */
function photoStrip(blobs) {
  return el('div', { class: 'thumbs', id: 'refPhotos' }, blobs.map(b => el('div', { class: 'thumb ref' }, thumbImg(b, '參考照片'))));
}
function manualFlow(id, blobs, loc, onDone) {
  if (id === 'expense') return openExpenseForm(null, { photos: blobs, location: loc, onSaved: onDone, noAi: true });
  if (id === 'split') return openManualSplit(blobs, loc, onDone);
  if (id === 'calc') return openManualCalc(blobs);
  if (id === 'table') return openManualTable(blobs, loc, onDone);
  if (id === 'menu') return MenuUI.openMenuBuilder(blobs, { note: Modes.byId('menu').noAi });
}

function openManualCalc(blobs) {
  pushScreen('計算', body => {
    const it = makeCalc({ numbers: [], op: 'sum' });
    const box = el('div');
    const draw = () => box.replaceChildren(calcCard(it));
    const ta = el('textarea', { id: 'calcPaste', placeholder: '輸入或貼上數字,以空白、逗號、換行分隔', rows: 3 });
    const add = () => {
      const toks = [].concat(...ta.value.split(/[\s、;;]+/).filter(Boolean).map(t => (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? [t] : t.split(/[,,]+/)))).filter(Boolean);
      let bad = 0;
      toks.forEach(t => { const v = Reconcile.parseAmount(t); if (v === null) bad++; else it.nums.push({ label: '', value: v, on: true }); });
      ta.value = bad ? toks.filter(t => Reconcile.parseAmount(t) === null).join(' ') : '';
      if (bad) alert(bad + ' 個項目不是數字,已留在輸入框');
      draw();
    };
    const intake = pasteIntake({ photos: blobs, rows: 4, placeholder: '把照片上的數字貼在這裡', onText: t => {
      it.nums = it.nums.filter(n => !n.fromScan);
      Receipt.numbers(t).forEach(x => it.nums.push({ label: x.label, value: x.value, on: true, fromScan: true }));
      draw();
    } });
    body.append(honestNote('calc'), intake.node, el('label', { class: 'f' }, '或自己輸入數字'), ta,
      el('button', { class: 'btn primary', id: 'calcAdd', onclick: add }, '加入'), box);
    draw();
  });
}

function openManualSplit(blobs, loc, onDone) {
  pushScreen('分帳/結帳', body => {
    const st = { people: [], items: [{ name: '', amount: '', who: new Set() }], feePct: '', total: '' };
    const peopleIn = el('input', { type: 'text', id: 'spPeople', placeholder: '人名,用空白或逗號分隔(例:小明 小華 阿姨)' });
    const itemsBox = el('div'), resBox = el('div', { id: 'spResult' });
    const feeIn = el('input', { type: 'number', id: 'spFee', inputmode: 'decimal', step: 'any', placeholder: '服務費 %(例:10,選填)', oninput: e => { st.feePct = e.target.value; } });
    const totIn = el('input', { type: 'number', id: 'spTotal', inputmode: 'decimal', step: 'any', placeholder: '收據總額(選填,供核對)', oninput: e => { st.total = e.target.value; } });
    const readPeople = () => { st.people = peopleIn.value.split(/[\s,、,]+/).map(x => x.trim()).filter((x, i, a) => x && a.indexOf(x) === i); st.items.forEach(i => { i.who.forEach(w => { if (!st.people.includes(w)) i.who.delete(w); }); }); drawItems(); };
    peopleIn.addEventListener('change', readPeople);
    const drawItems = () => {
      itemsBox.replaceChildren(...st.items.map((it, idx) => el('div', { class: 'card sp-item' },
        el('div', { class: 'row' },
          el('input', { type: 'text', class: 'grow', placeholder: '品名', value: it.name, 'aria-label': '品名', oninput: e => { it.name = e.target.value; } }),
          el('input', { type: 'number', inputmode: 'decimal', step: 'any', style: 'width:90px', placeholder: '金額', value: it.amount, 'aria-label': '金額', oninput: e => { it.amount = e.target.value; } }),
          el('button', { class: 'btn sm', 'aria-label': '刪除品項', onclick: () => { st.items.splice(idx, 1); if (!st.items.length) st.items.push({ name: '', amount: '', who: new Set() }); drawItems(); } }, '×')),
        st.people.length ? el('div', { class: 'chips' }, st.people.map(p => el('button', { class: 'chip' + (it.who.has(p) ? ' on' : ''), 'data-who': p, onclick: () => { if (it.who.has(p)) it.who.delete(p); else it.who.add(p); drawItems(); } }, p)),
          el('span', { class: 'muted small' }, it.who.size ? '' : '(不選=全部人均分)')) : null)));
    };
    drawItems();
    const calcBtn = el('button', { class: 'btn primary block', id: 'spCalc', onclick: () => {
      readPeople();
      if (!st.people.length) { alert('請先輸入人名'); return; }
      const items = st.items.filter(i => i.name.trim() || String(i.amount).trim() !== '');
      if (!items.length) { alert('請輸入品項與金額'); return; }
      const amt = items.map(i => Reconcile.parseAmount(i.amount));
      if (amt.some(a => a === null)) { alert('有品項的金額不是數字'); return; }
      const inp = {
        items: items.map((i, k) => ({ name: i.name.trim() || '品項' + (k + 1), qty: 1, amount: amt[k] })), people: st.people,
        assignments: items.map((i, k) => { const w = [...i.who]; return { item_index: k, people: w.length ? w : st.people, mode: w.length === 1 ? 'individual' : 'equal' }; }),
        extra_fees: Number(st.feePct) > 0 ? [{ name: '服務費 ' + st.feePct + '%', percent: Number(st.feePct), allocate: 'proportional' }] : [],
      };
      if (st.total !== '' && Reconcile.parseAmount(st.total) !== null) inp.receipt_total = Reconcile.parseAmount(st.total);
      const sp = makeSplit(inp);
      const chat = { photoBlobs: blobs, location: loc };
      const draw = () => { resBox.replaceChildren(splitCard(sp, chat, draw)); if (sp.saved) onDone(); };
      draw();
      resBox.scrollIntoView();
    } }, '算出每人應付');
    const intake = pasteIntake({ photos: blobs, rows: 4, placeholder: '把帳單上的字貼在這裡', onText: t => {
      let list = Receipt.parseItems(t).map(i => ({ name: i.name + (i.qty > 1 ? ' ×' + i.qty : ''), amount: String(i.amount) }));
      if (!list.length) list = Ledger.parseDrinkList(t).lines.map(l => ({ name: l.name + (l.qty > 1 ? ' ×' + l.qty : ''), amount: String(l.total) }));
      if (list.length) { st.items = list.map(i => ({ name: i.name, amount: i.amount, who: new Set() })); drawItems(); }
      const tc = Receipt.totalCandidates(t); if (tc.total) { totIn.value = tc.total.value; st.total = String(tc.total.value); }
    } });
    body.append(honestNote('split'), intake.node, el('div', { class: 'muted small' }, '已自動填入的品項與金額都是猜的,請逐項確認。'), el('label', { class: 'f' }, '人名'), peopleIn, el('label', { class: 'f' }, '品項與誰吃(點人名選擇)'), itemsBox,
      el('button', { class: 'btn sm', id: 'spAddItem', onclick: () => { st.items.push({ name: '', amount: '', who: new Set() }); drawItems(); } }, '＋ 品項'),
      el('label', { class: 'f' }, '服務費'), feeIn, el('label', { class: 'f' }, '收據總額'), totIn, calcBtn, resBox);
  });
}

function openManualTable(blobs, loc) {
  pushScreen('表格', (body, entry) => {
    const it = makeTable({ title: '', sheets: [{ name: '工作表1', columns: ['欄1', '欄2', '欄3'], rows: [['', '', ''], ['', '', ''], ['', '', '']] }] });
    it.photos = blobs.slice(); it.location = loc || null; it.hideSave = true;
    it.keep = KeepPhoto.fromSettings(getSettings(), undefined);
    const st = Tabletext.recall(localStorage, 'table');                 // 同一模式下記住分欄方式 / 每 N 行 / 表頭
    let pristine = true, sbT = null;
    const box = el('div', { id: 'tblBox' });
    const draw = () => { box.replaceChildren(tableCard(it, draw, true)); drawOps(); };
    const info = el('div', { class: 'muted small', id: 'tblInfo' }), pv = el('div', { class: 'tbl-wrap', id: 'tblPreview' });
    const delimBox = el('div', { class: 'chips', id: 'tblDelims' }), hdrBox = el('div', { class: 'chips', id: 'tblHeader' }), opsBox = el('div', { id: 'tblOps' });
    const groupN = el('input', { type: 'number', id: 'tblGroupN', min: 2, max: 12, style: 'width:84px;min-height:36px', placeholder: 'N', value: st.groupN === 'auto' ? '' : st.groupN, 'aria-label': '每幾行一列', oninput: e => { st.groupN = e.target.value ? Number(e.target.value) : 'auto'; save(); refresh(); } });
    const save = () => Tabletext.remember(localStorage, 'table', st);
    const parsed = () => Tabletext.parse(intake.getText(), { delimiter: st.delimiter, groupN: st.groupN, header: st.header });
    function drawSettings() {
      delimBox.replaceChildren(...['auto'].concat(Tabletext.DELIMS).map(d => el('button', { class: 'chip' + (st.delimiter === d ? ' on' : ''), 'data-delim': d, onclick: () => { st.delimiter = d; save(); drawSettings(); refresh(); } }, Tabletext.LABELS[d])), st.delimiter === 'group' ? groupN : '');
      hdrBox.replaceChildren(...[['auto', '表頭:自動'], [true, '有表頭'], [false, '沒有表頭']].map(([v, l]) => el('button', { class: 'chip' + (st.header === v ? ' on' : ''), 'data-header': String(v), onclick: () => { st.header = v; save(); drawSettings(); refresh(); } }, l)));
    }
    function preview() {
      const p = parsed(); pv.replaceChildren(); info.textContent = '';
      if (!p.rows.length) return null;
      info.textContent = '分欄方式:' + Tabletext.LABELS[p.used] + (st.delimiter === 'auto' ? '(自動判斷' + (p.group ? ',每 ' + p.group.n + ' 行一列' : '') + ')' : (p.group ? ',每 ' + p.group.n + ' 行一列' : '')) + ' · ' + p.cols + ' 欄 · ' + p.body.length + ' 列' + (p.header ? '(含表頭)' : '') + (p.numericCols.length ? ' · 數字欄:第 ' + p.numericCols.map(c => c + 1).join('、') + ' 欄' : '') + (p.warnings.length ? '\n' + p.warnings.join(' ') : '');
      const rows = p.body.slice(0, 8);
      pv.append(el('table', { class: 'tbl ro' }, p.columns.length ? el('tr', {}, p.columns.map(c => el('th', {}, c))) : null, rows.map(r => el('tr', {}, r.map((v, c) => el('td', { class: p.numericCols.includes(c) ? 'n' : '' }, v))))));
      return p;
    }
    function apply() {
      const p = parsed(); if (!p.rows.length) return false;
      const sh = it.sheets[0]; sh.columns = p.columns.slice(); sh.rows = p.body.map(r => r.slice());
      sh.hbad = sh.columns.map(() => ''); sh.bad = sh.rows.map(r => r.map(() => '')); it.active = 0; draw();
      if (sbT) sbT.markDirty();
      return true;
    }
    function refresh() { preview(); if (pristine) apply(); }
    // 欄位快速修整:選一欄 → 合併右欄 / 拆分 / 刪除 / 左移 / 右移 / 設為數字 / 刪除空列
    let col = 0;
    function applyOp(fn) {
      const sh = it.sheets[0]; const out = fn({ columns: sh.columns, rows: sh.rows });
      sh.columns = out.columns; sh.rows = out.rows; sh.hbad = sh.columns.map(() => ''); sh.bad = sh.rows.map(r => r.map(() => '')); pristine = false; draw(); if (sbT) sbT.markDirty();
    }
    function drawOps() {
      const sh = it.sheets[0], n = Math.max(sh.columns.length, sh.rows[0] ? sh.rows[0].length : 0);
      if (col >= n) col = Math.max(0, n - 1);
      const sel = el('select', { id: 'colSel', 'aria-label': '選一欄', onchange: e => { col = Number(e.target.value); } }, Array.from({ length: n }, (_, i) => el('option', { value: i }, '第 ' + (i + 1) + ' 欄' + (sh.columns[i] ? ':' + sh.columns[i] : ''))));
      sel.value = String(col);
      const b = (id, label, fn) => el('button', { class: 'btn sm', id, onclick: fn }, label);
      opsBox.replaceChildren(el('label', { class: 'f' }, '欄位快速修整(先選一欄)'), sel, el('div', { class: 'row wrap', style: 'margin-top:6px' },
        b('opMerge', '合併右欄', () => applyOp(s => Tabletext.mergeCols(s, col))), b('opSplit', '拆分欄', () => { const sym = prompt('依哪個符號拆開?(留空=空白/逗號/冒號/斜線/橫線)', ''); if (sym === null) return; applyOp(s => Tabletext.splitCol(s, col, sym || undefined)); }),
        b('opDel', '刪除欄', () => applyOp(s => Tabletext.deleteCol(s, col))), b('opLeft', '← 左移', () => { const c = col; applyOp(s => Tabletext.moveCol(s, c, -1)); col = Math.max(0, c - 1); drawOps(); }), b('opRight', '右移 →', () => { const c = col; applyOp(s => Tabletext.moveCol(s, c, 1)); col = c + 1; drawOps(); }),
        b('opNum', '整欄設為數字', () => applyOp(s => Tabletext.setColType(s, col, 'number'))), b('opText', '整欄設為文字', () => { /* 文字就是原樣,不動 */ toast('這一欄會保持文字(不轉數字)'); }), b('opEmpty', '刪除空列', () => applyOp(s => Tabletext.deleteEmptyRows(s)))));
    }
    const intake = pasteIntake({ photos: blobs, rows: 5, placeholder: '把照片上的字貼在這裡(也可以貼從 Excel/網頁複製的內容)', onText: (t, via) => { refresh(); } });
    const convert = el('button', { class: 'btn primary block', id: 'tblPasteBtn', onclick: () => { if (!apply()) { alert('還沒有文字可以變成表格。請先把照片上的字貼進上面的框。'); return; } pristine = false; box.scrollIntoView({ block: 'start' }); } }, '把文字變成表格(會取代下面目前的內容)');
    body.append(honestNote('table'), intake.node,
      el('label', { class: 'f' }, '分欄方式(每行一列;「每 N 行一列」給「每格一行」的掃描結果)'), delimBox, hdrBox, info, pv, convert,
      el('h3', {}, '表格'), opsBox, box);
    drawSettings(); draw();
    sbT = attachSaveBar(entry, { id: 'btnSaveTable', onSave: async () => { const n = it.photos.length; await Files.saveTable(it, { silent: true }); return { toast: KeepPhoto.toast('檔案', it.keep, n), view: () => Files.openFiles() }; }, extra: [keepSwitch(it.keep, v => { it.keep = v; sbT.markDirty(); })] });
    box.addEventListener('input', () => { pristine = false; sbT.markDirty(); });
    sbT.trackInputs(box); box.addEventListener('click', e => { if (e.target.closest && e.target.closest('button')) { pristine = false; sbT.markDirty(); } });
  }, () => { /* 離開時對照照片隨畫面釋放 */ });
}

/* ---------- 轉 Excel:可編輯表格 ---------- */
const cellStr = v => (v == null ? '' : String(v));
function makeTable(inp) {
  const sheets = (Array.isArray(inp.sheets) ? inp.sheets : []).map((s, i) => {
    const columns = (Array.isArray(s.columns) ? s.columns : []).map(cellStr);
    const rows = (Array.isArray(s.rows) ? s.rows : []).map(r => (Array.isArray(r) ? r : [r]).map(cellStr));
    const ncol = Math.max(columns.length, ...rows.map(r => r.length), 0);
    if (columns.length) while (columns.length < ncol) columns.push('');
    rows.forEach(r => { while (r.length < ncol) r.push(''); });
    return { name: cellStr(s.name) || ('工作表' + (i + 1)), columns, rows, notes: cellStr(s.notes), bad: rows.map(r => r.map(() => '')), hbad: columns.map(() => '') };
  });
  if (!sheets.length) sheets.push({ name: '工作表1', columns: [], rows: [], notes: '', bad: [], hbad: [] });
  const lost = [];
  (Array.isArray(inp.unreadable) ? inp.unreadable : []).forEach(u => {
    if (!u) return;
    const sh = sheets.find(s => s.name === u.sheet) || (Number.isInteger(u.sheet) ? sheets[u.sheet - 1] : null) || sheets[0];
    const r = Number(u.row), c = Number(u.col) - 1, why = cellStr(u.reason) || '讀不清楚';
    if (r === 0 && sh.hbad[c] !== undefined) sh.hbad[c] = why;
    else if (r >= 1 && sh.bad[r - 1] && sh.bad[r - 1][c] !== undefined) sh.bad[r - 1][c] = why;
    else lost.push('(' + sh.name + ' 第 ' + u.row + ' 列第 ' + u.col + ' 欄)' + why);
  });
  return { k: 'table', title: cellStr(inp.title), sheets, active: 0, lost };
}
function tableToJson(it) { return { title: it.title, sheets: it.sheets.map(s => ({ name: s.name, columns: s.columns, rows: s.rows, notes: s.notes })) }; }
function fileBase(it) { return (it.title || 'table').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').trim().slice(0, 60) || 'table'; }
function anchorDownload(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
// iPhone:優先系統分享(可存到檔案/Excel);不支援就一般下載
function saveBlob(blob, name) {
  try {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name }).catch(e => { if (e && e.name !== 'AbortError') anchorDownload(blob, name); });
      return;
    }
  } catch (_) { /* 改用下載 */ }
  anchorDownload(blob, name);
}
function tableCard(it, rerender, manual) {
  const sh = it.sheets[it.active] || it.sheets[0];
  const card = el('div', { class: 'card', id: 'tableCard' }, el('h2', {}, '表格結果'));
  card.append(el('input', { id: 'tblTitle', value: it.title, placeholder: '標題(檔名)', 'aria-label': '標題', oninput: e => { it.title = e.target.value; } }));
  if (it.sheets.length > 1) card.append(el('div', { class: 'sheet-tabs' }, it.sheets.map((s, i) => el('button', { class: 'btn sm' + (i === it.active ? ' primary' : ''), 'data-sheet': i, onclick: () => { it.active = i; rerender(); } }, s.name))));
  card.append(el('label', { class: 'f' }, '工作表名稱'), el('input', { id: 'tblSheetName', value: sh.name, oninput: e => { sh.name = e.target.value; } }));
  if (sh.notes) card.append(el('div', { class: 'muted small', id: 'tblNotes' }, '備註:' + sh.notes));
  const ncol = Math.max(sh.columns.length, ...sh.rows.map(r => r.length), 0);
  const hasHead = sh.columns.length > 0;
  const mk = (val, why, onInput) => {
    const inp = el('input', { value: val, class: why ? 'bad' : '', title: why || '', 'aria-label': '儲存格', oninput: e => { onInput(e.target.value); if (inp.classList.contains('bad')) { inp.classList.remove('bad'); inp.title = ''; } } });
    return inp;
  };
  const table = el('table', { class: 'tbl', id: 'tblEdit' });
  const delRow = el('tr', { class: 'tbl-del' }, el('td'));
  for (let c = 0; c < ncol; c++) delRow.append(el('td', {}, el('button', { class: 'x', 'aria-label': '刪除第 ' + (c + 1) + ' 欄', 'data-delcol': c, onclick: () => {
    if (ncol <= 1) return;
    sh.columns.splice(c, 1); sh.hbad.splice(c, 1); sh.rows.forEach(r => r.splice(c, 1)); sh.bad.forEach(r => r.splice(c, 1)); rerender();
  } }, '×')));
  table.append(delRow);
  if (hasHead) {
    const tr = el('tr', { class: 'tbl-head' }, el('th', {}, ''));
    sh.columns.forEach((v, c) => tr.append(el('th', {}, mk(v, sh.hbad[c], x => { sh.columns[c] = x; sh.hbad[c] = ''; }))));
    table.append(tr);
  }
  sh.rows.forEach((r, ri) => {
    const tr = el('tr', {}, el('td', {}, el('button', { class: 'x', 'aria-label': '刪除第 ' + (ri + 1) + ' 列', 'data-delrow': ri, onclick: () => { sh.rows.splice(ri, 1); sh.bad.splice(ri, 1); rerender(); } }, '×')));
    for (let c = 0; c < ncol; c++) tr.append(el('td', {}, mk(r[c] == null ? '' : r[c], sh.bad[ri][c], x => { r[c] = x; sh.bad[ri][c] = ''; })));
    table.append(tr);
  });
  card.append(el('div', { class: 'tbl-wrap' }, table));
  const nBad = sh.hbad.filter(Boolean).length + sh.bad.reduce((a, r) => a + r.filter(Boolean).length, 0);
  if (nBad) card.append(el('div', { class: 'small', id: 'tblBadNote' }, '黃色格子(' + nBad + ' 格)是讀不清楚的,請對照原圖確認;修改後黃色會消失。游標停留可看原因。'));
  if (it.lost.length) card.append(el('div', { class: 'muted small' }, '其他讀不清楚之處:' + it.lost.join(';')));
  card.append(el('div', { class: 'row-btns' },
    el('button', { class: 'btn sm', id: 'tblAddRow', onclick: () => {
      const n = Math.max(ncol, 1);
      sh.rows.push(new Array(n).fill('')); sh.bad.push(new Array(n).fill(''));
      if (hasHead) while (sh.columns.length < n) { sh.columns.push(''); sh.hbad.push(''); }
      rerender();
    } }, '＋ 新增列'),
    el('button', { class: 'btn sm', id: 'tblAddCol', onclick: () => {
      if (hasHead) { sh.columns.push(''); sh.hbad.push(''); }
      sh.rows.forEach((r, i) => { while (r.length < ncol) r.push(''); r.push(''); sh.bad[i].push(''); });
      rerender();
    } }, '＋ 新增欄')));
  const out = s2 => ({ name: s2.name, columns: s2.columns, rows: s2.rows });
  card.append(el('div', { class: 'row-btns' },
    el('button', { class: 'btn primary', id: 'tblXlsx', onclick: () => saveBlob(new Blob([Xlsx.build(it.sheets.map(out))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileBase(it) + '.xlsx') }, '下載 .xlsx'),
    el('button', { class: 'btn', id: 'tblCsv', onclick: () => saveBlob(new Blob([Xlsx.toCSV(it.sheets.map(out))], { type: 'text/csv;charset=utf-8' }), fileBase(it) + '.csv') }, '下載 CSV')));
  card.append(el('div', { class: 'row-btns' },
    it.hideSave ? null : el('button', { class: 'btn primary', id: 'tblSave', onclick: async () => { try { await Files.saveTable(it); rerender(); } catch (e) { alert('儲存失敗:' + e.message); } } }, it.fileId ? '儲存變更' : '儲存'),
    it.hideSave || !(it.photos || []).length || it.fileId ? null : keepSwitch(it.keep !== undefined ? it.keep : KeepPhoto.fromSettings(getSettings(), undefined), v => { it.keep = v; }),
    el('button', { class: 'btn', id: 'tblSaveShare', onclick: async () => { try { await Files.saveAndShare(it); rerender(); } catch (e) { alert('分享失敗:' + e.message); } } }, '儲存並分享(LINE/雲端硬碟…)')));
  if (it.fileId) card.append(el('div', { class: 'tag ok', id: 'tblSaved' }, '已儲存到「檔案」'));
  card.append(el('div', { class: 'muted small' }, manual ? '可直接點格子修改,用「新增列/欄」與 × 調整表格大小。' : '可直接點格子修改。想批次修正(例如「第三欄是單價,改成數字」),請在下方輸入指令送出。'));
  return card;
}

const ledgerFilter = { q: '', month: '', category: '', payment: '', payer: '', place: '' };

function openLedger() {
  pushScreen('記帳本', (body, entry) => { entry.refresh = () => renderLedgerTab(body); renderLedgerTab(body); }, null, 'ledger');
}
function openSettings() { pushScreen('設定', (body, entry) => renderSettingsTab(body, entry), null, 'settings'); }

async function renderLedgerTab(root) {
  const all = await DB.allExpenses();
  const settings = getSettings();
  root.replaceChildren();
  all.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
  const months = [...new Set(all.map(r => (r.date || '').slice(0, 7)).filter(Boolean))];
  const cats = [...new Set(settings.categories.concat(all.map(r => r.category).filter(Boolean)))];
  const pays = [...new Set(all.map(r => r.payment_method).filter(Boolean))];
  const payers = [...new Set(all.map(r => r.payer).filter(Boolean))];

  root.append(el('div', { class: 'row' }, el('div', { class: 'grow' }),
    el('button', { class: 'btn sm primary', id: 'btnAdd', onclick: () => openExpenseForm(null) }, '＋ 記一筆'),
    el('button', { class: 'btn sm', id: 'btnReport', onclick: openReport }, '報表')));
  const list = el('div', { id: 'ledgerList' });
  const places = Aggregate.groupByLocation(all);
  const placeSel = () => { const s = el('select', { id: 'placeFilter', 'aria-label': '地點', onchange: e => { ledgerFilter.place = e.target.value; draw(); } }, el('option', { value: '' }, '地點:全部'), places.map(p => el('option', { value: p.key }, p.key + '(' + p.count + ' 筆)'))); s.value = ledgerFilter.place; return s; };
  const sel = (key, label, opts) => { const s = el('select', { 'aria-label': label, onchange: e => { ledgerFilter[key] = e.target.value; draw(); } }, el('option', { value: '' }, label + ':全部'), opts.map(o => el('option', { value: o }, o))); s.value = ledgerFilter[key]; return s; };
  root.append(
    el('input', { type: 'search', id: 'searchBox', placeholder: '搜尋店名/品項/備註', value: ledgerFilter.q, oninput: e => { ledgerFilter.q = e.target.value; draw(); } }),
    el('div', { class: 'row wrap', style: 'margin:8px 0' }, ...[sel('month', '月份', months), sel('category', '分類', cats), sel('payment', '付款', pays), sel('payer', '付款人', payers), placeSel()].map(s => el('div', { style: 'flex:1 1 45%' }, s))),
    list,
    el('h3', {}, '資料'),
    el('div', { class: 'row wrap' },
      el('button', { class: 'btn', id: 'btnExport', onclick: () => exportData(false) }, '匯出 JSON'),
      el('button', { class: 'btn', id: 'btnExportPhotos', onclick: () => exportData(true) }, '匯出(含照片)'),
      el('label', { class: 'btn' }, '匯入 JSON', el('input', { type: 'file', accept: 'application/json,.json', class: 'hidden', id: 'importFile', onchange: importData }))));

  function draw() {
    const q = ledgerFilter.q.trim().toLowerCase();
    const rows = all.filter(r =>
      (!ledgerFilter.month || (r.date || '').startsWith(ledgerFilter.month)) &&
      (!ledgerFilter.category || r.category === ledgerFilter.category) &&
      (!ledgerFilter.payment || r.payment_method === ledgerFilter.payment) &&
      (!ledgerFilter.payer || r.payer === ledgerFilter.payer) &&
      (!ledgerFilter.place || Aggregate.locationKey(r.location) === ledgerFilter.place) &&
      (!q || [r.store, r.note].concat((r.items || []).map(i => i.name)).some(s => String(s || '').toLowerCase().includes(q))));
    list.replaceChildren();
    if (!rows.length) { list.append(el('div', { class: 'empty', id: 'ledgerEmpty' }, all.length ? '沒有符合的紀錄' : '還沒有紀錄。拍收據記一筆,或自己填一筆。'), all.length ? null : el('div', { class: 'big-grid two' }, el('button', { class: 'big-btn primary', id: 'emptyAdd', onclick: () => openExpenseForm(null) }, el('span', { class: 'bi' }, '＋'), el('span', { class: 'bt' }, '記一筆')), el('button', { class: 'big-btn', id: 'emptyShoot', onclick: () => goCamera('expense') }, el('span', { class: 'bi' }, '📷'), el('span', { class: 'bt' }, '拍收據記帳')))); return; }
    let curMonth = '', group = null, sum = 0;
    const flush = () => { if (group) group.querySelector('.sum').textContent = fmt(sum) + ' 元'; };
    rows.forEach(r => {
      const m = (r.date || '').slice(0, 7);
      if (m !== curMonth) { flush(); curMonth = m; sum = 0; group = el('div', { class: 'group-h' }, el('span', {}, m || '無日期'), el('span', { class: 'sum' })); list.append(group); }
      sum += Number(r.total || 0);
      list.append(el('button', { class: 'rec', onclick: () => openDetail(r.id) },
        el('div', { class: 'meta' }, el('b', {}, r.store || '(未填店名)'), el('span', { class: 'muted small' }, (r.date || '') + ' · ' + (r.category || '') + ' · ' + (r.payer || ''))),
        el('span', { class: 'money' }, fmt(r.total))));
    });
    flush();
  }
  draw();
}

/* 詳情 */
function openDetail(id) {
  pushScreen('詳情', async body => {
    const r = await DB.getExpense(id);
    if (!r) { body.append(el('div', { class: 'empty' }, '找不到這筆紀錄')); return; }
    const urls = [];
    body.append(el('div', { class: 'card' },
      el('div', { class: 'row' }, el('h2', { class: 'grow' }, r.store || '(未填店名)'), el('span', { class: 'money' }, fmt(r.total) + ' ' + (r.currency || ''))),
      el('div', { class: 'muted' }, [r.date, r.category, r.payment_method, '付款人:' + (r.payer || '-'), r.shared ? '家庭共用' : ''].filter(Boolean).join(' · ')),
      r.note ? el('div', {}, '備註:' + r.note) : null,
      r.location ? el('div', { class: 'small', id: 'locInfo' }, '📍 ', el('a', { href: 'https://maps.google.com/?q=' + r.location.lat + ',' + r.location.lng, target: '_blank', rel: 'noopener' }, r.location.lat + ', ' + r.location.lng), ' (±' + (r.location.accuracy || '?') + ' m)') : null));
    if (r.items && r.items.length) body.append(el('div', { class: 'card' }, el('table', { class: 't' },
      el('tr', {}, el('th', {}, '品名'), el('th', { class: 'n' }, '數量'), el('th', { class: 'n' }, '單價'), el('th', { class: 'n' }, '金額')),
      r.items.map(it => el('tr', {}, el('td', {}, it.name), el('td', { class: 'n' }, fmt(it.qty)), el('td', { class: 'n' }, fmt(it.unit_price)), el('td', { class: 'n' }, fmt(it.amount)))))));
    for (const pid of (r.photoIds || [])) {
      let b = null;
      try { b = await Media.getMedia(pid); } catch (e) { body.append(el('div', { class: 'muted', id: 'needCloud' }, '🖼 ' + e.message)); }
      if (b) { const u = URL.createObjectURL(b); urls.push(u); body.append(el('img', { class: 'photo-view', src: u, alt: '收據照片' })); }
    }
    const nPh = (r.photoIds || []).length;
    body.append(el('div', { class: 'row', id: 'photoInfo', style: 'margin:8px 0' }, el('span', { class: 'muted grow', id: 'photoInfoText' }, KeepPhoto.detailText(nPh)),
      nPh ? el('button', { class: 'btn sm danger', id: 'btnDelPhotos', onclick: async () => {
        if (!confirm('刪除這筆的 ' + nPh + ' 張照片?(只刪照片,帳目保留。已上傳到雲端硬碟的檔案不會被刪)')) return;
        for (const pid of r.photoIds) await Media.deleteMedia(pid);
        r.photoIds = []; r.updatedAt = Date.now(); await DB.putExpense(r);
        toast('已刪除照片,釋放空間'); popScreen(); openDetail(id);
      } }, '🗑 刪除照片') : null));
    body.append(el('div', { class: 'row' },
      el('button', { class: 'btn grow', id: 'btnEdit', onclick: () => { popScreen(); openExpenseForm(r); } }, '編輯'),
      el('button', { class: 'btn danger grow', id: 'btnDelete', onclick: async () => { if (confirm('確定刪除這筆紀錄?')) { await DB.deleteExpense(id); popScreen(); } } }, '刪除')));
  });
}

/* 新增/編輯表單 */
function openExpenseForm(rec, extra) {
  const settings = getSettings();
  const isNew = !rec;
  const r = rec ? JSON.parse(JSON.stringify(rec)) : { id: uuid(), date: today(), store: '', total: null, currency: 'TWD', items: [], payment_method: '', category: '', payer: settings.myName, shared: false, note: '', photoIds: [], createdAt: Date.now() };
  const newPhotos = ((extra && extra.photos) || []).filter(b => !isPdf(b));
  let keep = KeepPhoto.fromSettings(settings, undefined);
  const previewUrls = [];
  pushScreen(isNew ? '新增紀錄' : '編輯紀錄', (body, entry) => {
    const cats = settings.categories.includes(r.category) || !r.category ? settings.categories : settings.categories.concat([r.category]);
    const inDate = el('input', { type: 'date', id: 'fDate', value: r.date });
    const inStore = el('input', { type: 'text', id: 'fStore', value: r.store });
    const inTotal = el('input', { type: 'number', id: 'fTotal', inputmode: 'decimal', step: 'any', value: r.total ?? '' });
    const inCat = selectOf(cats, r.category, () => {}, false, '(請選擇)'); inCat.id = 'fCat';
    const inPay = selectOf(PAYMENTS.includes(r.payment_method) || !r.payment_method ? PAYMENTS : PAYMENTS.concat([r.payment_method]), r.payment_method, () => {}, false, '(未指定)'); inPay.id = 'fPay';
    const inPayer = el('input', { type: 'text', id: 'fPayer', value: r.payer });
    const inShared = el('input', { type: 'checkbox', id: 'fShared', checked: !!r.shared, style: 'width:22px;height:22px' });
    const inNote = el('input', { type: 'text', id: 'fNote', value: r.note || '' });
    const newCat = el('input', { type: 'text', id: 'fNewCat', placeholder: '新增分類(選填)' });
    const itemsBox = el('div');
    const drawItems = () => {
      itemsBox.replaceChildren(el('table', { class: 't' },
        el('tr', {}, el('th', {}, '品名'), el('th', { class: 'n' }, '數量'), el('th', { class: 'n' }, '金額'), el('th')),
        r.items.map((it, i) => el('tr', {},
          el('td', {}, el('input', { type: 'text', value: it.name || '', 'aria-label': '品名', onchange: e => { it.name = e.target.value; } })),
          el('td', { style: 'width:62px' }, el('input', { type: 'number', step: 'any', value: it.qty ?? '', 'aria-label': '數量', onchange: e => { it.qty = e.target.value === '' ? null : Number(e.target.value); } })),
          el('td', { style: 'width:80px' }, el('input', { type: 'number', step: 'any', value: it.amount ?? '', 'aria-label': '金額', onchange: e => { it.amount = e.target.value === '' ? null : Number(e.target.value); } })),
          el('td', {}, el('button', { class: 'btn sm', 'aria-label': '刪除品項', onclick: () => { r.items.splice(i, 1); drawItems(); } }, '×'))))),
        el('button', { class: 'btn sm', id: 'btnAddItem', onclick: () => { r.items.push({ name: '', qty: null, unit_price: null, amount: null }); drawItems(); } }, '＋ 品項'));
    };
    drawItems();
    const photoBox = el('div');
    (async () => { for (const pid of (r.photoIds || [])) { let b = null; try { b = await Media.getMedia(pid); } catch (e) { photoBox.append(el('div', { class: 'muted' }, '🖼 ' + e.message)); } if (b) photoBox.append(el('img', { class: 'photo-view', src: URL.createObjectURL(b), alt: '照片' })); } })();
    const guessNote = el('div', { class: 'banner warn hidden', id: 'guessNote' }, '已自動填入,標黃的欄位是猜的,請逐欄確認後再儲存。');
    const candBox = el('div', { class: 'chips', id: 'totalCands' });
    const guess = (inp) => { inp.classList.add('guess'); const clr = () => { inp.classList.remove('guess'); inp.removeEventListener('input', clr); }; inp.addEventListener('input', clr); };
    function prefill(text) {
      const rc = Receipt.parse(text, { today: today() });
      candBox.replaceChildren();
      if (!rc.store && !rc.date && !rc.total && !rc.items.length) { guessNote.classList.add('hidden'); return; }
      if (rc.store) { inStore.value = rc.store; guess(inStore); }
      if (rc.date) { inDate.value = rc.date; guess(inDate); }
      if (rc.total) { inTotal.value = rc.total.value; guess(inTotal); }
      if (rc.candidates.length > 1) candBox.append(el('span', { class: 'muted small' }, '其他可能的總額:'), ...rc.candidates.filter(c => !rc.total || c.value !== rc.total.value).map(c => el('button', { class: 'chip', 'data-cand': c.value, onclick: () => { inTotal.value = c.value; guess(inTotal); sb.markDirty(); } }, '$' + c.value)));
      if (rc.items.length) { r.items = rc.items.map(i => ({ name: i.name, qty: i.qty, unit_price: null, amount: i.amount })); drawItems(); }
      const extraNote = [rc.taxId ? '統編 ' + rc.taxId : '', rc.invoiceNo ? '發票 ' + rc.invoiceNo : ''].filter(Boolean).join(' ');
      if (extraNote) { inNote.value = [inNote.value.trim(), extraNote].filter(Boolean).join(' '); guess(inNote); }
      guessNote.classList.remove('hidden'); sb.markDirty();
    }
    const intake = extra && extra.noAi ? pasteIntake({ photos: extra.photos, rows: 4, placeholder: '把收據上的字貼在這裡,會自動預填', onText: t => prefill(t) }) : null;
    const showNew = b => { const u = URL.createObjectURL(b); previewUrls.push(u); photoBox.append(el('img', { class: 'photo-view new-photo', src: u, alt: '新照片' })); };
    if (!(extra && extra.noAi)) newPhotos.forEach(showNew);
    const f = (l, n) => [el('label', { class: 'f' }, l), n];
    body.append(
      ...(extra && extra.noAi ? [el('div', { class: 'banner warn', id: 'expenseNote' }, '無 AI 不會自動讀金額,請手動填,或貼上照片上的文字讓 App 預填。'), intake.node, guessNote] : []),
      ...f('日期', inDate), ...f('店名', inStore), ...f('總額', inTotal), candBox, ...f('分類', inCat), newCat,
      ...f('付款方式', inPay), ...f('付款人', inPayer),
      el('label', { class: 'row', style: 'margin:10px 0' }, inShared, '家庭共用'),
      ...f('備註', inNote), el('label', { class: 'f' }, '品項(選填)'), itemsBox,
      el('label', { class: 'f' }, '照片'), photoBox,
      el('label', { class: 'btn', style: 'margin-top:6px' }, '＋ 加照片', el('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async e => { const fl = e.target.files[0]; if (!fl) return; const b = await resizeImage(fl); newPhotos.push(b); showNew(b); } })),
      el('div', { class: 'muted small', style: 'margin-top:10px' }, '改完請按下面的「儲存」。照片預設不保留(只拿來對照);要留請打開「📎 保留照片」。'));
    async function doSave() {
      const date = Reconcile.normalizeDate(inDate.value);
      const total = Reconcile.parseAmount(inTotal.value);
      let cat = newCat.value.trim() || inCat.value;
      if (!date) { alert('請輸入正確日期'); return false; }
      if (total === null || total <= 0) { alert('請輸入總額(大於 0)。無 AI 不會自動讀金額,請對照照片手動填。'); return false; }
      if (!cat) { alert('請選擇分類'); return false; }
      if (newCat.value.trim() && !settings.categories.includes(cat)) { settings.categories.push(cat); saveSettings(settings); }
      const added = newPhotos.length;
      r.photoIds.push(...await KeepPhoto.persist(newPhotos, keep, b => Media.saveMedia(b, { kind: 'expense', location: extra && extra.location })));   // 沒開「保留照片」就不寫入任何 Blob
      newPhotos.length = 0;
      Object.assign(r, { date, store: inStore.value.trim(), total, category: cat, payment_method: inPay.value, payer: inPayer.value.trim() || settings.myName, shared: inShared.checked, note: inNote.value.trim(), updatedAt: Date.now() });
      r.items = r.items.filter(i => i.name || i.amount != null);
      if (isNew && extra && extra.location && !r.location) r.location = extra.location;
      await DB.putExpense(r);
      if (!keep) { photoBox.querySelectorAll('.new-photo').forEach(i => i.remove()); previewUrls.splice(0).forEach(u => URL.revokeObjectURL(u)); }   // 對照用的照片儲存後釋放
      if (extra && extra.onSaved) { const f = extra.onSaved; extra.onSaved = null; f(); }
      return { toast: KeepPhoto.toast('記帳本', keep, added), view: () => openDetail(r.id) };
    }
    const sb = attachSaveBar(entry, { id: 'btnSaveForm', onSave: doSave, extra: [keepSwitch(keep, v => { keep = v; sb.markDirty(); })] });
    sb.trackInputs(body);
    if (isNew && extra && extra.noAi) setTimeout(() => { try { inTotal.focus(); } catch (_) { /* 不影響填寫 */ } }, 150);   // 金額欄自動聚焦
  }, () => { previewUrls.splice(0).forEach(u => URL.revokeObjectURL(u)); }, null);
}

/* 匯出 / 匯入 */
async function exportData(withPhotos) {
  const expenses = await DB.allExpenses();
  const files = await DB.allFiles(), menus = await DB.allMenus();
  const out = { format: 'phototool', version: 2, exportedAt: new Date().toISOString(), settings: { categories: getSettings().categories }, expenses, menus,
    files: files.map(f => Object.assign({}, f, { photos: undefined, photoCount: (f.photos || []).length })) };
  if (withPhotos) {
    out.photos = {};
    for (const r of expenses) for (const pid of (r.photoIds || [])) {
      let b = null; try { b = await Media.getMedia(pid); } catch (_) { /* 雲端取不到就略過這張 */ }
      if (b) out.photos[pid] = 'data:' + (b.type || 'image/jpeg') + ';base64,' + await AI.blobToBase64(b);
    }
  }
  if (withPhotos) {
    out.filePhotos = {};
    for (const f of files) { out.filePhotos[f.id] = []; for (const b of (f.photos || [])) out.filePhotos[f.id].push('data:' + (b.type || 'image/jpeg') + ';base64,' + await AI.blobToBase64(b)); }
  }
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'phototool-' + today() + '.json' });
  document.body.append(a); a.click(); a.remove();
}

async function importData(ev) {
  const file = ev.target.files[0]; ev.target.value = '';
  if (!file) return;
  try {
    const j = JSON.parse(await file.text());
    if (j.format !== 'phototool' || !Array.isArray(j.expenses)) throw new Error('格式不符');
    const have = new Set((await DB.allExpenses()).map(r => r.id));
    let added = 0, skipped = 0;
    for (const r of j.expenses) {
      if (!r.id || have.has(r.id)) { skipped++; continue; }
      for (const pid of (r.photoIds || [])) {
        const data = j.photos && j.photos[pid];
        if (data) { const res = await fetch(data); await DB.putPhoto(pid, await res.blob()); }
      }
      if (j.photos) r.photoIds = (r.photoIds || []).filter(pid => j.photos[pid]); else r.photoIds = [];
      await DB.putExpense(r); added++;
    }
    let fAdded = 0, mAdded = 0;
    const haveF = new Set((await DB.allFiles()).map(r => r.id)), haveM = new Set((await DB.allMenus()).map(r => r.id));
    for (const f of (j.files || [])) {
      if (!f.id || haveF.has(f.id)) continue;
      const photos = [];
      for (const d of ((j.filePhotos && j.filePhotos[f.id]) || [])) photos.push(await (await fetch(d)).blob());
      delete f.photoCount; f.photos = photos; await DB.putFile(f); fAdded++;
    }
    for (const m of (j.menus || [])) { if (m.id && !haveM.has(m.id)) { await DB.putMenu(m); mAdded++; } }
    added += fAdded + mAdded;
    const s = getSettings(); const cats = (j.settings && j.settings.categories) || [];
    let ch = false; cats.forEach(c => { if (!s.categories.includes(c)) { s.categories.push(c); ch = true; } });
    if (ch) saveSettings(s);
    alert('匯入完成:新增 ' + added + ' 筆(含檔案與菜單),略過重複 ' + skipped + ' 筆');
  } catch (e) { alert('匯入失敗:' + e.message); }
  refreshTop();
}

/* 報表 */
function openReport() {
  const settings = getSettings();
  const st = { period: 'month', anchor: today(), payer: 'all' };
  pushScreen('報表', async body => {
    const all = await DB.allExpenses();
    const out = el('div', { id: 'reportOut' });
    const ctl = el('div');
    const draw = () => {
      ctl.replaceChildren(
        el('div', { class: 'chips' }, PERIOD_LABELS.map(([k, l]) => el('button', { class: 'chip' + (st.period === k ? ' on' : ''), onclick: () => { st.period = k; draw(); } }, l))),
        el('div', { class: 'chips' }, [['all', '全部'], ['me', '我'], ['family', '家人']].map(([k, l]) => el('button', { class: 'chip' + (st.payer === k ? ' on' : ''), onclick: () => { st.payer = k; draw(); } }, l))));
      const s = Aggregate.summarize(all, { period: st.period, anchor: st.anchor, payerFilter: { mode: st.payer, me: settings.myName } });
      out.replaceChildren(
        el('div', { class: 'row' },
          el('button', { class: 'btn sm', id: 'btnPrev', onclick: () => { st.anchor = Aggregate.shiftAnchor(st.anchor, st.period, -1); draw(); } }, '‹'),
          el('div', { class: 'grow right', style: 'text-align:center' }, el('b', {}, s.range.label)),
          el('button', { class: 'btn sm', id: 'btnNext', onclick: () => { st.anchor = Aggregate.shiftAnchor(st.anchor, st.period, 1); draw(); } }, '›')),
        el('div', { class: 'card', style: 'margin-top:10px' }, el('div', { class: 'muted' }, '合計(' + s.count + ' 筆)'), el('div', { class: 'money', style: 'font-size:24px' }, fmt(s.total) + ' 元')),
        ...(s.categories.length ? s.categories.map(c => el('div', { class: 'bar-row' },
          el('div', { class: 'row' }, el('span', { class: 'grow' }, c.category), el('span', { class: 'money' }, fmt(c.amount)), el('span', { class: 'muted small', style: 'width:52px;text-align:right' }, c.pct + '%')),
          el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill', style: 'width:' + c.pct + '%' })))) : [el('div', { class: 'empty' }, '這段期間沒有紀錄')]));
    };
    body.append(ctl, out);
    draw();
  });
}

/* ---------- 3. 設定 ---------- */
async function renderSettingsTab(root, entry) {
  const s = getSettings();
  let persisted = '不支援';
  try { if (navigator.storage && navigator.storage.persisted) persisted = (await navigator.storage.persisted()) ? '已啟用(資料不易被系統清除)' : '未啟用(瀏覽器可能在空間不足時清除資料)'; } catch (_) { /* ignore */ }
  const locOn = el('input', { type: 'checkbox', id: 'setLoc', checked: s.locationEnabled !== false, style: 'width:22px;height:22px' });
  const aiCb = el('input', { type: 'checkbox', id: 'setAI', checked: aiOn(s), style: 'width:22px;height:22px' });
  const api = el('input', { type: 'password', id: 'setKey', value: s.apiKey, placeholder: 'sk-ant-...', autocomplete: 'off' });
  const proxy = el('input', { type: 'url', id: 'setProxy', value: s.proxyUrl, placeholder: '(選填)中轉網址;填了就不使用金鑰直連' });
  const model = el('input', { type: 'text', id: 'setModel', value: s.model });
  const cmodel = el('input', { type: 'text', id: 'setCModel', value: s.classifyModel });
  const me = el('input', { type: 'text', id: 'setMe', value: s.myName });
  const acct = el('input', { type: 'text', id: 'setAccount', value: s.myAccount || '', placeholder: '(選填)純本機顯示,App 沒有登入系統' });
  const mockCb = el('input', { type: 'checkbox', id: 'setMock', checked: !!s.useMock, style: 'width:22px;height:22px' });
  const cats = el('textarea', { id: 'setCats', rows: 3 }, s.categories.join('、'));
  cats.value = s.categories.join('、');
  const f = (l, n, hint) => [el('label', { class: 'f' }, l), n, hint ? el('div', { class: 'muted small' }, hint) : null];
  const aiNow = aiOn(s);
  if (featureOn('ai')) root.append(el('div', { class: 'card', id: 'aiStatusCard' },
    el('div', { class: 'row' }, el('b', { class: 'grow' }, 'AI 讀照片'), el('span', { class: 'tag ' + (aiNow ? 'ok' : 'warn'), id: 'aiStatusTag' }, aiNow ? '已啟用' : '未啟用')),
    el('div', { class: 'muted', id: 'aiStatusText' }, aiNow ? '拍照後 AI 會自動讀出內容,你只要核對。' : '未啟用:無法自動讀取照片,記帳/表格等仍可手動使用。'),
    el('div', { class: 'muted small' }, '一般收據一筆約 US$0.015、約 NT$0.45(估算)。'),
    el('div', { class: 'row wrap', style: 'margin-top:8px' }, el('button', { class: 'btn', id: 'aiHelpBtn', onclick: () => openAiHelp() }, aiNow ? '費用與說明' : '怎麼啟用?'), el('button', { class: 'btn', id: 'reOnboard', onclick: () => { Guide.resetOnboarding(localStorage); openOnboarding(); } }, '重看新手引導'))));
  const keepCb = el('input', { type: 'checkbox', id: 'setKeepPhotos', checked: !!s.keepPhotos, style: 'width:22px;height:22px' });
  const mainCard = el('div', { class: 'card', id: 'settingsMain' },
    ...(featureOn('ai') ? [el('label', { class: 'row', style: 'margin:0 0 8px' }, aiCb, 'AI 分析(關閉時全部手動操作,不呼叫 AI)'),
      ...f('Anthropic API 金鑰', api, '只存在這支手機本機。僅測試用,勿在公用裝置輸入。'),
      ...f('中轉網址 Proxy URL', proxy, '格式同 messages API,不帶金鑰;未填則直連 api.anthropic.com。'),
      ...f('主流程模型名稱', model),
      ...f('分類用模型名稱(較小、較省)', cmodel)] : []),
    ...(featureOn('camera') ? [el('label', { class: 'row', style: 'margin:12px 0 0' }, locOn, '拍照時記錄位置(被拒絕會自動略過)'),
      el('label', { class: 'row', style: 'margin:12px 0 0' }, keepCb, '📎 保留照片(預設關:照片只用來對照,儲存時不寫入;每一筆儲存時可個別開啟)')] : []),
    el('div', { class: 'muted small', id: 'persistInfo' }, '持久儲存:' + persisted),
    el('details', { class: 'adv', id: 'advBox' }, el('summary', {}, '進階'), el('label', { class: 'row', style: 'margin:8px 0 0' }, mockCb, '測試模式(假連線,只有同一個瀏覽器的分頁互通,不經網路;一般使用請勿開啟)')),
    ...(featureOn('export') ? [el('div', { class: 'row-btns' },
      el('button', { class: 'btn', id: 'btnExportAll', onclick: () => exportData(false) }, '匯出全部檔案'),
      el('button', { class: 'btn', id: 'btnExportAllPhotos', onclick: () => exportData(true) }, '匯出全部(含照片)'),
      el('label', { class: 'btn' }, '匯入', el('input', { type: 'file', accept: 'application/json,.json', class: 'hidden', id: 'importFile2', onchange: importData })))] : []),
    ...(featureOn('ledger') ? [...f('我的帳號 ID/暱稱', acct, '只存在這支手機、只用來顯示;不會上傳,也沒有登入。'),
      ...f('我的名稱', me, '新記帳的付款人預設值;報表的「我/家人」也依此判斷。'),
      ...f('分類(用「、」或逗號分隔)', cats)] : []),
  );
  root.append(mainCard);
  const saveForm = async () => {
      const cl = cats.value.split(/[、,，\n]/).map(x => x.trim()).filter(Boolean);
      saveSettings(Object.assign({}, getSettings(), { aiEnabled: (hasAiKey(s) !== hasAiKey({ apiKey: api.value, proxyUrl: proxy.value }) || aiCb.checked === hasAiKey({ apiKey: api.value, proxyUrl: proxy.value })) ? undefined : aiCb.checked, apiKey: api.value.trim(), proxyUrl: proxy.value.trim(), model: model.value.trim() || 'claude-sonnet-5-5', classifyModel: cmodel.value.trim() || 'claude-haiku-5-5', locationEnabled: locOn.checked, keepPhotos: keepCb.checked, myAccount: acct.value.trim(), useMock: mockCb.checked, myName: me.value.trim() || '我', categories: cl.length ? cl : DEFAULT_CATS.slice() }));
        return { where: '設定' };
  };
  const sbS = attachSaveBar(entry, { id: 'btnSaveSettings', onSave: saveForm });
  sbS.trackInputs(mainCard);
  if (featureOn('cloud')) root.append(CloudUI.mediaCard());
  root.append(el('div', { class: 'muted small', style: 'text-align:center' }, '旅遊日誌 v12'));
}

/* ---------- 啟動 ---------- */
Media.initMedia({
  store: { getRec: DB.getPhotoRec, putRec: DB.putPhotoRec, delRec: DB.deletePhoto, allRecs: DB.allPhotoRecs, allUploads: DB.allUploads, putUpload: DB.putUpload, delUpload: DB.deleteUpload },
  drive: window.Drive, uq: window.UploadQ, fetch: (u, i) => fetch(u, i), settings: () => getSettings(), tokenInfo: () => Cloud.tokenInfo(),
  online: () => navigator.onLine, uuid, now: () => Date.now(),
});
Media.mediaApi().recover().catch(e => console.warn('上傳佇列復原失敗', e));
Media.mediaApi().onChange(() => { if (!stack.length) homeRefresh(); });
const roomParams = journalMode ? null : parseRoomParams(location.search);
if (roomParams) cam.suppress = true;
if (journalMode) { startJournalApp(mainEl).catch(e => { console.error(e); mainEl.textContent = '啟動失敗:' + e.message; }); }
else {
  renderHome();
  if (roomParams) openRoomJoin(roomParams);
  else if (Guide.shouldShowOnboarding(localStorage)) openOnboarding();
  cleanupRooms();
}
if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(() => { /* 不影響主功能 */ }); }
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 離線功能不可用,不影響主功能 */ });
}
window.addEventListener('online', () => { if (!stack.length) homeRefresh(); });

// 發起人開 App 時清掉自己建過、已過 24 小時的房(沒網路就保留紀錄,下次再試)
async function cleanupRooms() {
  try {
    const rooms = await DB.allRooms();
    for (const r of rooms) {
      if (Date.now() <= r.createdAt + 24 * 3600 * 1000) continue;
      try { const { net } = getNet({ db: r.dbUrl, mock: r.mock }); await net.deleteRoom(r.code); await DB.deleteRoom(r.code); } catch (e) { console.warn('清除過期房失敗', r.code, e.message); }
    }
  } catch (e) { console.warn('清除過期房失敗', e.message); }
}

export { featureOn, toast, attachSaveBar, keepSwitch, openHelp, openFuncMenu, goCamera, el, $, uuid, pad2, today, fmt, esc, pushScreen, popScreen, refreshTop, thumbImg, resizeImage, isPdf, anchorDownload, saveBlob, makeTable, tableToJson, tableCard, fileBase, getSettings, saveSettings, selectOf, openSettings, aiOn, photoStrip, MAX_FILE_BYTES };
