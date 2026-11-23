import * as DB from './db.js';
import * as AI from './ai.js';

const { Split, Aggregate, Reconcile } = window;

/* ---------- 小工具 ---------- */
const DEFAULT_CATS = ['餐飲', '超市/日用', '交通', '購物', '醫療', '娛樂', '居家', '教育', '其他'];
const PAYMENTS = ['現金', '信用卡', '行動支付', '轉帳', '其他'];
const MODES = [['auto', '自動判斷'], ['expense', '記帳'], ['split', '分帳'], ['translate', '翻譯'], ['plant', '辨識植物'], ['calc', '算數字']];
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
  return Object.assign({ apiKey: '', proxyUrl: '', model: 'claude-sonnet-5-5', classifyModel: 'claude-haiku-5-5', locationEnabled: true, myName: '我', categories: DEFAULT_CATS.slice() }, s);
}
function saveSettings(s) { localStorage.setItem('pt_settings', JSON.stringify(s)); }

/* ---------- 全螢幕頁面堆疊 ---------- */
const screensEl = $('#screens');
const stack = [];
function pushScreen(title, build, onClose) {
  const s = el('section', { class: 'screen' });
  const head = el('header', { class: 'bar' }, el('button', { class: 'back', onclick: () => popScreen() }, '‹ 返回'), el('h2', {}, title), el('span'));
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
  const t = stack.pop();
  if (!t) return;
  if (t.onClose) t.onClose();
  t.s.remove();
  const top = stack[stack.length - 1];
  if (top && top.refresh) top.refresh();
  onScreensChange();
}

function refreshTop() { const t = stack[stack.length - 1]; if (t && t.refresh) t.refresh(); }
const mainEl = $('#main');

/* ---------- 圖片縮放 ---------- */
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
const cam = { stream: null, facing: 'environment', video: null, fallback: false, starting: false };
const home = {};

function renderHome() {
  mainEl.replaceChildren();
  const addFiles = async (ev, fromCam) => {
    if (fromCam) captureLocation();
    const files = Array.from(ev.target.files || []).slice(0, 4 - compose.blobs.length);
    ev.target.value = '';
    for (const f of files) { try { compose.blobs.push(await resizeImage(f)); } catch (e) { alert('讀取圖片失敗'); } }
    homeRefresh();
  };
  home.video = el('video', { class: 'cam-video', playsinline: true, muted: true, autoplay: true });
  home.video.muted = true;
  home.fallbackBox = el('div', { class: 'cam-fallback hidden', id: 'camFallback' },
    el('div', { class: 'cam-msg', id: 'camMsg' }),
    el('label', { class: 'btn primary', id: 'btnFileCapture' }, '📷 拍照', el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', id: 'inpCam', onchange: ev => addFiles(ev, true) })));
  home.pendingChip = el('button', { class: 'cam-chip hidden', id: 'btnPending' });
  home.thumbs = el('div', { class: 'cam-thumbs', id: 'camThumbs' });
  home.shutter = el('button', { class: 'shutter', id: 'btnShutter', 'aria-label': '拍照', onclick: shoot });
  home.flip = el('button', { class: 'cam-btn', id: 'btnFlip', 'aria-label': '切換鏡頭', onclick: () => { cam.facing = cam.facing === 'environment' ? 'user' : 'environment'; startCamera(); } }, '🔄');
  home.done = el('button', { class: 'btn primary hidden', id: 'btnDone', onclick: openActions }, '完成');
  home.flash = el('div', { class: 'cam-flash' });
  mainEl.append(el('div', { class: 'cam' },
    home.video, home.fallbackBox, home.flash,
    el('div', { class: 'cam-top' }, home.pendingChip, el('div', { class: 'grow' }),
      el('button', { class: 'cam-btn', id: 'btnLedger', 'aria-label': '記帳本', onclick: openLedger }, '📒'),
      el('button', { class: 'cam-btn', id: 'btnSettings', 'aria-label': '設定', onclick: openSettings }, '⚙️')),
    el('div', { class: 'cam-bottom' },
      home.thumbs,
      el('div', { class: 'cam-ctl' },
        el('label', { class: 'cam-btn', 'aria-label': '從相簿選' }, '🖼', el('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden', id: 'inpAlbum', onchange: ev => addFiles(ev, false) })),
        home.shutter, home.flip),
      home.done)));
  homeRefresh();
  startCamera();
}

async function homeRefresh() {
  if (!home.thumbs) return;
  const n = compose.blobs.length;
  home.thumbs.replaceChildren(...compose.blobs.map((b, i) => el('div', { class: 'thumb' },
    el('img', { src: URL.createObjectURL(b), alt: '照片' + (i + 1) }),
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
  if (!home.video || cam.starting) return;
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
  if (stack.length) stopCamera();
  else { homeRefresh(); startCamera(); }
}

async function processPending(p) {
  if (!p) return;
  if (!navigator.onLine) { alert('目前沒有網路'); return; }
  await openChat({ blobs: p.blobs, text: p.text, mode: p.mode, hint: p.hint, location: p.location, pendingId: p.id });
}

/* ---------- 2. 分類結果 + 動作選單 ---------- */
const KIND_LABEL = { receipt: '收據', menu: '菜單', bill_list: '帳單/明細', text_doc: '文件/文字', plant: '植物', object: '物品', screenshot: '螢幕截圖', other: '其他' };
const ACTIONS = [
  { id: 'expense', icon: '🧾', label: '記帳', desc: '讀取收據,核對後記入記帳本' },
  { id: 'split', icon: '👥', label: '分帳/結帳', desc: '誰點什麼、服務費,算出每人應付' },
  { id: 'calc', icon: '🧮', label: '計算', desc: '抽出照片中的數字,由程式加減乘除' },
  { id: 'translate', icon: '🌐', label: '翻譯', desc: '翻譯照片上的文字' },
  { id: 'lookup', icon: '🔍', label: '查資料', desc: '辨識物件/植物等並給詳細資料' },
  { id: 'other', icon: '💬', label: '其他', desc: '自由輸入或口述你的問題' },
];
const KIND_ACTIONS = {
  receipt: ['expense', 'split', 'calc'], menu: ['translate', 'lookup', 'calc'], bill_list: ['split', 'expense', 'calc'],
  text_doc: ['translate', 'calc'], plant: ['lookup'], object: ['lookup', 'other'], screenshot: ['other', 'translate'], other: ['other'],
};
const ACTION_ALIAS = { record: 'expense', record_expense: 'expense', expense: 'expense', split: 'split', split_bill: 'split', checkout: 'split', calc: 'calc', calculate: 'calc', translate: 'translate', lookup: 'lookup', search: 'lookup', identify: 'lookup', other: 'other' };
const LANGS = ['繁體中文', '简体中文', 'English', '日本語', '한국어', 'Français', 'Español'];

function openActions() {
  const blobs = compose.blobs.slice();
  if (!blobs.length) return;
  let used = false;
  const settings = getSettings();
  pushScreen('要做什麼?', body => {
    const statusBox = el('div', { class: 'card', id: 'classifyBox' }, el('span', { class: 'spin' }), ' 正在判斷照片內容…');
    const list = el('div', { id: 'actionList' });
    const text = el('textarea', { id: 'actText', placeholder: '想問什麼?點鍵盤上的麥克風可語音輸入(選填)' });
    const lang = el('select', { id: 'actLang', 'aria-label': '翻譯目標語言' }, LANGS.map(l => el('option', { value: l }, l)));
    body.append(
      el('div', { class: 'thumbs' }, blobs.map(b => el('div', { class: 'thumb' }, el('img', { src: URL.createObjectURL(b), alt: '照片' })))),
      statusBox, el('label', { class: 'f' }, '補充說明(選填)'), text,
      el('label', { class: 'f' }, '翻譯目標語言(選翻譯時使用)'), lang,
      el('h3', {}, '要拿這張照片做什麼?'), list);

    const drawActions = recommended => {
      const rec = recommended.filter((a, i) => recommended.indexOf(a) === i);
      const order = rec.concat(ACTIONS.map(a => a.id).filter(id => !rec.includes(id)));
      list.replaceChildren(...order.map(id => {
        const a = ACTIONS.find(x => x.id === id);
        return el('button', { class: 'act-btn' + (rec.includes(id) ? ' rec' : ''), 'data-action': id, onclick: async () => {
          const hint = id === 'translate' ? '(請翻譯成' + lang.value + ')' : '';
          if (compose.locPending) await compose.locPending;
          const ok = await openChat({ blobs, text: text.value.trim(), mode: id, hint, location: compose.location });
          if (ok) used = true;
        } }, el('span', { class: 'act-ico' }, a.icon),
        el('span', { class: 'grow' }, el('b', {}, a.label), el('span', { class: 'muted small', style: 'display:block' }, a.desc)),
        rec.includes(id) ? el('span', { class: 'tag' }, '推薦') : null);
      }));
    };
    drawActions([]);

    (async () => {
      if (!navigator.onLine) { statusBox.textContent = '目前離線,略過自動分類,請直接選動作(送出後會排入待處理)。'; return; }
      try {
        const r = await AI.classifyPhotos(settings, blobs);
        const kind = KIND_LABEL[r.kind] ? r.kind : 'other';
        const sug = (r.suggested_actions || []).map(a => ACTION_ALIAS[a]).filter(Boolean);
        statusBox.replaceChildren(el('div', {}, '這看起來是:', el('b', {}, KIND_LABEL[kind])), r.summary ? el('div', { class: 'muted' }, r.summary) : null,
          r.detected && r.detected.numbers && r.detected.numbers.length ? el('div', { class: 'muted small' }, '偵測到數字:' + r.detected.numbers.slice(0, 8).join('、')) : null);
        statusBox.dataset.kind = kind;
        drawActions(sug.concat(KIND_ACTIONS[kind] || []));
      } catch (e) {
        statusBox.textContent = (e.code === 'NO_KEY' ? '尚未設定 API 金鑰或中轉網址(設定頁)' : '分類失敗:' + e.message) + '。仍可直接選動作。';
      }
    })();
  }, () => { if (used) { compose.blobs = []; compose.location = null; } });
}

/* ---------- 對話頁 ---------- */
function openChat(init) {
  return new Promise(resolve => {
    const settings = getSettings();
    const chat = { photoBlobs: init.blobs, location: init.location || null, apiMessages: [], items: [], busy: false, lastToolIds: [], queued: false, started: false };
    const urls = init.blobs.map(b => URL.createObjectURL(b));
    let log, input, sendBtn;

    const activeCard = () => { for (let i = chat.items.length - 1; i >= 0; i--) if (['record', 'split', 'calc'].includes(chat.items[i].k)) return chat.items[i]; return null; };

    function render(keep) {
      const st = log.scrollTop;
      log.replaceChildren();
      const act = activeCard();
      chat.items.forEach(it => {
        if (it.k === 'user') {
          log.append(el('div', { class: 'bubble user' },
            it.first && urls.length ? el('div', { class: 'thumbs' }, urls.map(u => el('div', { class: 'thumb' }, el('img', { src: u, alt: '照片' })))) : null,
            it.text));
        } else if (it.k === 'answer') {
          const d = el('div', { class: 'bubble ai' }); d.innerHTML = mdToHtml(it.text); log.append(d);
        } else if (it.k === 'err') {
          log.append(el('div', { class: 'bubble err' }, it.text));
        } else if (it.k === 'record') {
          log.append(it === act ? recordCard(it.draft, chat, rerender, send) : el('div', { class: 'bubble ai muted' }, '(記帳草稿已被新版本取代)'));
        } else if (it.k === 'calc') {
          log.append(it === act ? calcCard(it) : el('div', { class: 'bubble ai muted' }, '(計算結果已被新版本取代)'));
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
        for (const b of init.blobs) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await AI.blobToBase64(b) } });
        userText = (AI.MODE_HINTS[init.mode] || '') + (init.hint || '') + (text || '請分析這些照片');
      } else {
        const a = activeCard();
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
        const resp = await AI.callModel(settings, chat.apiMessages, AI.buildSystem(today(), settings.categories));
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
    await saveDraft(draft, chat.photoBlobs, chat.location);
    rerender();
  } }, draft.saved ? '已存入記帳本' : '存入記帳本');
  function rerenderBtn() { saveBtn.disabled = draft.saved || !draftReady(draft, settings); }
  card.append(saveBtn);
  return card;
}

function selectOf(options, value, onChange, disabled, placeholder) {
  const s = el('select', { disabled, onchange: e => onChange(e.target.value) },
    el('option', { value: '' }, placeholder || ''), options.map(o => el('option', { value: o }, o)));
  s.value = value || '';
  return s;
}

async function saveDraft(draft, photoBlobs, loc) {
  const d = draft.data;
  const photoIds = [];
  for (const b of (photoBlobs || [])) { const id = uuid(); await DB.putPhoto(id, b, loc); photoIds.push(id); }
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
    for (const b of (chat.photoBlobs || [])) { const id = uuid(); await DB.putPhoto(id, b, chat.location); rec.photoIds.push(id); }
    await DB.putExpense(rec);
    it.saved = true; rerender();
  };
  wrap.append(el('div', { class: 'card' },
    el('b', {}, '存入記帳本'),
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
const ledgerFilter = { q: '', month: '', category: '', payment: '', payer: '', place: '' };

function openLedger() {
  pushScreen('記帳本', (body, entry) => { entry.refresh = () => renderLedgerTab(body); renderLedgerTab(body); });
}
function openSettings() { pushScreen('設定', body => renderSettingsTab(body)); }

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
    if (!rows.length) { list.append(el('div', { class: 'empty' }, all.length ? '沒有符合的紀錄' : '還沒有紀錄,點「＋ 記一筆」或用拍照記帳')); return; }
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
      const b = await DB.getPhoto(pid);
      if (b) { const u = URL.createObjectURL(b); urls.push(u); body.append(el('img', { class: 'photo-view', src: u, alt: '收據照片' })); }
    }
    body.append(el('div', { class: 'row' },
      el('button', { class: 'btn grow', id: 'btnEdit', onclick: () => { popScreen(); openExpenseForm(r); } }, '編輯'),
      el('button', { class: 'btn danger grow', id: 'btnDelete', onclick: async () => { if (confirm('確定刪除這筆紀錄?')) { await DB.deleteExpense(id); popScreen(); } } }, '刪除')));
  });
}

/* 新增/編輯表單 */
function openExpenseForm(rec) {
  const settings = getSettings();
  const isNew = !rec;
  const r = rec ? JSON.parse(JSON.stringify(rec)) : { id: uuid(), date: today(), store: '', total: null, currency: 'TWD', items: [], payment_method: '', category: '', payer: settings.myName, shared: false, note: '', photoIds: [], createdAt: Date.now() };
  const newPhotos = [];
  pushScreen(isNew ? '新增紀錄' : '編輯紀錄', body => {
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
    (async () => { for (const pid of (r.photoIds || [])) { const b = await DB.getPhoto(pid); if (b) photoBox.append(el('img', { class: 'photo-view', src: URL.createObjectURL(b), alt: '照片' })); } })();
    const f = (l, n) => [el('label', { class: 'f' }, l), n];
    body.append(
      ...f('日期', inDate), ...f('店名', inStore), ...f('總額', inTotal), ...f('分類', inCat), newCat,
      ...f('付款方式', inPay), ...f('付款人', inPayer),
      el('label', { class: 'row', style: 'margin:10px 0' }, inShared, '家庭共用'),
      ...f('備註', inNote), el('label', { class: 'f' }, '品項(選填)'), itemsBox,
      el('label', { class: 'f' }, '照片'), photoBox,
      el('label', { class: 'btn', style: 'margin-top:6px' }, '＋ 加照片', el('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async e => { const fl = e.target.files[0]; if (!fl) return; const b = await resizeImage(fl); newPhotos.push(b); photoBox.append(el('img', { class: 'photo-view', src: URL.createObjectURL(b), alt: '新照片' })); } })),
      el('button', { class: 'btn primary block', id: 'btnSaveForm', style: 'margin-top:14px', onclick: async () => {
        const date = Reconcile.normalizeDate(inDate.value);
        const total = Reconcile.parseAmount(inTotal.value);
        let cat = newCat.value.trim() || inCat.value;
        if (!date) { alert('請輸入正確日期'); return; }
        if (total === null) { alert('請輸入總額'); return; }
        if (!cat) { alert('請選擇分類'); return; }
        if (newCat.value.trim() && !settings.categories.includes(cat)) { settings.categories.push(cat); saveSettings(settings); }
        for (const b of newPhotos) { const id = uuid(); await DB.putPhoto(id, b); r.photoIds.push(id); }
        Object.assign(r, { date, store: inStore.value.trim(), total, category: cat, payment_method: inPay.value, payer: inPayer.value.trim() || settings.myName, shared: inShared.checked, note: inNote.value.trim(), updatedAt: Date.now() });
        r.items = r.items.filter(i => i.name || i.amount != null);
        await DB.putExpense(r);
        popScreen();
      } }, '儲存'));
  });
}

/* 匯出 / 匯入 */
async function exportData(withPhotos) {
  const expenses = await DB.allExpenses();
  const out = { format: 'phototool', version: 1, exportedAt: new Date().toISOString(), settings: { categories: getSettings().categories }, expenses };
  if (withPhotos) {
    out.photos = {};
    for (const r of expenses) for (const pid of (r.photoIds || [])) {
      const b = await DB.getPhoto(pid);
      if (b) out.photos[pid] = 'data:' + (b.type || 'image/jpeg') + ';base64,' + await AI.blobToBase64(b);
    }
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
    const s = getSettings(); const cats = (j.settings && j.settings.categories) || [];
    let ch = false; cats.forEach(c => { if (!s.categories.includes(c)) { s.categories.push(c); ch = true; } });
    if (ch) saveSettings(s);
    alert('匯入完成:新增 ' + added + ' 筆,略過重複 ' + skipped + ' 筆');
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
async function renderSettingsTab(root) {
  const s = getSettings();
  let persisted = '不支援';
  try { if (navigator.storage && navigator.storage.persisted) persisted = (await navigator.storage.persisted()) ? '已啟用(資料不易被系統清除)' : '未啟用(瀏覽器可能在空間不足時清除資料)'; } catch (_) { /* ignore */ }
  const locOn = el('input', { type: 'checkbox', id: 'setLoc', checked: s.locationEnabled !== false, style: 'width:22px;height:22px' });
  const api = el('input', { type: 'password', id: 'setKey', value: s.apiKey, placeholder: 'sk-ant-...', autocomplete: 'off' });
  const proxy = el('input', { type: 'url', id: 'setProxy', value: s.proxyUrl, placeholder: '(選填)中轉網址;填了就不使用金鑰直連' });
  const model = el('input', { type: 'text', id: 'setModel', value: s.model });
  const cmodel = el('input', { type: 'text', id: 'setCModel', value: s.classifyModel });
  const me = el('input', { type: 'text', id: 'setMe', value: s.myName });
  const cats = el('textarea', { id: 'setCats', rows: 3 }, s.categories.join('、'));
  cats.value = s.categories.join('、');
  const f = (l, n, hint) => [el('label', { class: 'f' }, l), n, hint ? el('div', { class: 'muted small' }, hint) : null];
  root.append(el('div', { class: 'card' },
    ...f('Anthropic API 金鑰', api, '只存在這支手機本機。僅測試用,勿在公用裝置輸入。'),
    ...f('中轉網址 Proxy URL', proxy, '格式同 messages API,不帶金鑰;未填則直連 api.anthropic.com。'),
    ...f('主流程模型名稱', model),
    ...f('分類用模型名稱(較小、較省)', cmodel),
    el('label', { class: 'row', style: 'margin:12px 0 0' }, locOn, '拍照時記錄位置(被拒絕會自動略過)'),
    el('div', { class: 'muted small', id: 'persistInfo' }, '持久儲存:' + persisted),
    ...f('我的名稱', me, '新記帳的付款人預設值;報表的「我/家人」也依此判斷。'),
    ...f('分類(用「、」或逗號分隔)', cats),
    el('button', { class: 'btn primary block', id: 'btnSaveSettings', style: 'margin-top:12px', onclick: () => {
      const cl = cats.value.split(/[、,，\n]/).map(x => x.trim()).filter(Boolean);
      saveSettings({ apiKey: api.value.trim(), proxyUrl: proxy.value.trim(), model: model.value.trim() || 'claude-sonnet-5-5', classifyModel: cmodel.value.trim() || 'claude-haiku-5-5', locationEnabled: locOn.checked, myName: me.value.trim() || '我', categories: cl.length ? cl : DEFAULT_CATS.slice() });
      alert('已儲存');
    } }, '儲存設定')));
  root.append(el('div', { class: 'muted small', style: 'text-align:center' }, '多功能拍照工具 v1'));
}

/* ---------- 啟動 ---------- */
renderHome();
if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(() => { /* 不影響主功能 */ }); }
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 離線功能不可用,不影響主功能 */ });
}
window.addEventListener('online', () => { if (!stack.length) homeRefresh(); });
