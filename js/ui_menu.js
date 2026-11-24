// 菜單:建立(拍照/貼上)、編輯器、範本庫、開團頁、開團前菜單確認、點餐入口
// 與 app.js 循環匯入:只在函式內使用
import * as DB from './db.js';
import * as AI from './ai.js';
import { pasteIntake } from './ui_paste.js';
import { el, uuid, today, pad2, pushScreen, popScreen, thumbImg, photoStrip, getSettings, aiOn, openSettings, resizeImage, MAX_FILE_BYTES, toast, attachSaveBar, saveSettings } from './app.js';
import { genToken, NetError } from './net.js';
import { getNet, hasBackend, mockOn, configuredDbUrl } from './netctx.js';
import { openRoomHost, openRoomJoin } from './ui_room.js';

const { Menu, Guide } = window;
const fmtDate = ms => { const d = new Date(ms || 0); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); };
const bigBtn = (icon, text, onclick, cls, id) => el('button', { class: 'big-btn ' + (cls || ''), id, onclick }, el('span', { class: 'bi' }, icon), el('span', { class: 'bt' }, text));
const toLocalInput = ms => { const d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };

/* ---------- 點餐入口 ---------- */
export function openOrderHub() {
  pushScreen('點餐', body => {
    body.append(el('div', { class: 'big-grid' },
      bigBtn('🍹', '開團', () => openCreateRoom(), 'primary', 'hubCreate'),
      bigBtn('📷', '拍菜單建範本', () => openMenuBuilder([]), '', 'hubBuild'),
      bigBtn('📋', '我的菜單', () => openLibrary(), '', 'hubLibrary'),
      bigBtn('👥', '我開的團', () => openMyRooms(), '', 'hubRooms'),
      bigBtn('🔗', '加入點餐團', () => openJoinPrompt(), '', 'hubJoin')));
  });
}

export function openJoinPrompt() {
  pushScreen('加入點餐團', body => {
    const code = el('input', { type: 'text', id: 'joinCode', placeholder: '6 碼房號', maxlength: 6, autocapitalize: 'characters', class: 'code-in' });
    body.append(el('label', { class: 'f' }, '輸入發起人給你的房號(用連結或 QR 進來就不用輸入)'), code,
      bigBtn('➡️', '進入', () => { const c = code.value.trim().toUpperCase(); if (!c) return; popScreen(); openRoomJoin({ code: c }); }, 'primary', 'joinGo'));
  });
}

async function openMyRooms() {
  pushScreen('我開的團', (body, entry) => {
    const draw = async () => {
      const rooms = (await DB.allRooms()).sort((a, b) => b.createdAt - a.createdAt);
      body.replaceChildren();
      if (!rooms.length) { body.append(el('div', { class: 'empty' }, '還沒有開過團。'), bigBtn('🍹', '去開團', () => { popScreen(); openCreateRoom(); }, 'primary', 'roomsEmptyGo')); return; }
      rooms.forEach(r => body.append(el('div', { class: 'card room-row', 'data-code': r.code },
        el('div', { class: 'row' }, el('b', { class: 'grow' }, r.title), el('span', { class: 'tag' }, r.code)),
        el('div', { class: 'muted small' }, fmtDate(r.createdAt) + (Date.now() > r.createdAt + 86400000 ? ' · 已過期' : '')),
        el('div', { class: 'row', style: 'margin-top:8px' },
          bigBtn('▶️', '打開', () => openRoomHost(r), 'primary sm'),
          bigBtn('🗑', '移除紀錄', async () => { if (confirm('只移除這支手機上的紀錄,不會刪除雲端的團。確定?')) { await DB.deleteRoom(r.code); draw(); } }, 'danger sm')))));
    };
    entry.refresh = draw; draw();
  });
}

/* ---------- 建立菜單:拍照(AI)/貼上文字/空白 ---------- */
async function extractFromPhotos(blobs, hint) {
  const settings = getSettings();
  const content = [];
  for (const b of blobs) content.push(await AI.fileBlock(b));
  content.push({ type: 'text', text: AI.MODE_HINTS.menu + (hint || '') + '請把這些照片(同一份菜單的多張/多頁)合併成一份菜單。' });
  const tool = AI.TOOLS.find(t => t.name === 'extract_menu');
  const resp = await AI.callModel(settings, [{ role: 'user', content }], AI.buildSystem(today(), settings.categories), { tools: [tool], tool_choice: { type: 'tool', name: 'extract_menu' }, max_tokens: 8000 });
  const tu = (resp.content || []).find(b => b.type === 'tool_use' && b.name === 'extract_menu');
  if (!tu) throw new Error('AI 沒有回傳菜單');
  return Menu.fromExtract(tu.input || {});
}

export function openMenuBuilder(initBlobs, opts) {
  opts = opts || {};
  const blobs = (initBlobs || []).slice();
  const settings = getSettings();
  pushScreen('建立菜單', body => {
    const strip = el('div');
    const drawStrip = () => strip.replaceChildren(blobs.length ? el('div', { class: 'thumbs' }, blobs.map((b, i) => el('div', { class: 'thumb ref' }, thumbImg(b, '菜單照片'), el('button', { 'aria-label': '移除', onclick: () => { blobs.splice(i, 1); drawStrip(); } }, '×')))) : '');
    drawStrip();
    const add = async ev => {
      const files = Array.from(ev.target.files || []).slice(0, 4 - blobs.length); ev.target.value = '';
      for (const f of files) { if (f.size > MAX_FILE_BYTES) { alert('檔案太大'); continue; } try { blobs.push(f.type === 'application/pdf' ? f : await resizeImage(f)); } catch (_) { alert('讀取失敗'); } }
      drawStrip();
    };
    const status = el('div', { class: 'muted', id: 'builderStatus' });
    const ta = el('textarea', { id: 'menuPaste', rows: 5, placeholder: '貼上菜單文字,每行「品名 價格」,例:\n奶茶類\n綠茶 M45 L55\n紅茶 50' });
    const shop = el('input', { type: 'text', id: 'menuShop', placeholder: '店名(選填,可之後改)' });
    const goAI = bigBtn('✨', '用 AI 讀取照片', async () => {
      if (!blobs.length) { alert('請先拍照或選圖'); return; }
      if (!navigator.onLine) { alert('目前離線,無法使用 AI'); return; }
      status.replaceChildren(el('span', { class: 'spin' }), ' AI 讀取中,請稍候…'); goAI.disabled = true;
      try {
        const r = await extractFromPhotos(blobs, '');
        if (shop.value.trim() && !r.menu.shop) r.menu.shop = shop.value.trim();
        const notices = [];
        if (r.defaulted.ice) notices.push('照片沒有冰度選項,已套用台灣常用預設,請確認。');
        if (r.defaulted.sugar) notices.push('照片沒有糖度選項,已套用台灣常用預設,請確認。');
        if (r.unreadable.length) notices.push('看不清楚:' + r.unreadable.join('、'));
        status.textContent = '';
        popScreen(); openMenuEditor(r.menu, { isNew: true, notices, photos: blobs.slice() });
      } catch (e) { status.textContent = '讀取失敗:' + (e.code === 'NO_KEY' ? '尚未設定 API 金鑰或中轉網址' : e.message); goAI.disabled = false; }
    }, 'primary', 'builderAI');
    if (!aiOn(settings)) goAI.classList.add('hidden');
    else if (opts.auto && blobs.length) setTimeout(() => goAI.click(), 0);
    if (opts.focusPaste) setTimeout(() => ta.focus(), 250);
    const intake = !aiOn(settings) ? pasteIntake({ photos: blobs, rows: 4, placeholder: '把菜單上的字貼在這裡(每行「品名 價格」),貼上後直接整理', onText: (t, via) => { ta.value = t; if (via === 'paste' || via === 'set') { const b = document.getElementById('builderText'); if (b) b.click(); } } }) : null;
    body.append(
      ...[intake ? intake.node : null, opts.note && !aiOn(settings) ? el('div', { class: 'banner warn', id: 'noAiNote' }, opts.note) : null].filter(Boolean),
      el('div', { class: 'two-col' },
        el('div', {}, el('label', { class: 'f' }, '菜單照片(多張/多頁會合併,最多 4 張)'), strip,
          el('div', { class: 'row' },
            el('label', { class: 'big-btn sm' }, el('span', { class: 'bi' }, '📷'), el('span', { class: 'bt' }, '拍照'), el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', id: 'builderCam', onchange: add })),
            el('label', { class: 'big-btn sm' }, el('span', { class: 'bi' }, '🖼'), el('span', { class: 'bt' }, '相簿'), el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, class: 'hidden', id: 'builderAlbum', onchange: add }))),
          goAI, status),
        el('div', {}, el('label', { class: 'f' }, '或貼上文字建立'), shop, ta,
          bigBtn('📝', '用文字建立', () => {
            const parsed = Menu.parseText(ta.value);
            if (!parsed.categories.length) { alert('沒有解析到任何品項,請檢查格式(每行:品名 價格)'); return; }
            const m = Menu.fromParsed(parsed, shop.value.trim());
            const notices = parsed.warnings.concat(parsed.skipped.length ? ['這些行無法解析,已略過:' + parsed.skipped.join(' / ')] : []);
            popScreen(); openMenuEditor(m, { isNew: true, notices, photos: blobs.slice() });
          }, '', 'builderText'),
          bigBtn('➕', '空白菜單(手動輸入)', () => { const m = Menu.emptyMenu(shop.value.trim()); popScreen(); openMenuEditor(m, { isNew: true, photos: blobs.slice() }); }, '', 'builderBlank'))));
  });
}

/* ---------- 菜單編輯器(就地修改 menu 物件) ---------- */
const splitList = s => String(s).split(/[、,,\n]/).map(x => x.trim()).filter(Boolean);
export function menuEditor(menu) {
  const root = el('div', { class: 'editor' });
  const itemsBox = el('div');
  const num = v => (v === '' ? null : Menu.priceNum(v));
  const field = (label, node, hint) => [el('label', { class: 'f' }, label), node, hint ? el('div', { class: 'muted small' }, hint) : null];
  const shop = el('input', { type: 'text', id: 'edShop', value: menu.shop, placeholder: '店名', oninput: e => { menu.shop = e.target.value; } });
  const sizes = el('input', { type: 'text', id: 'edSizes', value: menu.sizes.join('、'), placeholder: '例:M、L 或 中、大(沒有尺寸就留空)', onchange: e => { menu.sizes = [...new Set(splitList(e.target.value))]; drawItems(); } });
  const ice = el('input', { type: 'text', id: 'edIce', value: menu.ice.join('、'), onchange: e => { menu.ice = [...new Set(splitList(e.target.value))]; } });
  const sugar = el('input', { type: 'text', id: 'edSugar', value: menu.sugar.join('、'), onchange: e => { menu.sugar = [...new Set(splitList(e.target.value))]; } });
  const tops = el('textarea', { id: 'edTops', rows: 2, placeholder: '加料,每行「名稱 加價」,例:珍珠 10', onchange: e => {
    menu.toppings = e.target.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(/^(.*?)[\s:：$]*(\d+)\s*元?$/); return m ? { name: m[1].trim(), price: Number(m[2]) } : { name: l, price: 0 }; }).filter(t => t.name);
  } });
  tops.value = menu.toppings.map(t => t.name + ' ' + t.price).join('\n');

  function drawItems() {
    itemsBox.replaceChildren(...menu.categories.map((c, ci) => el('div', { class: 'card ed-cat', 'data-cat': ci },
      el('div', { class: 'row' },
        el('input', { type: 'text', class: 'grow', value: c.name, 'aria-label': '分類名稱', oninput: e => { c.name = e.target.value; } }),
        el('button', { class: 'btn sm danger', 'aria-label': '刪除分類', onclick: () => { if (!c.items.length || confirm('刪除分類「' + c.name + '」和裡面 ' + c.items.length + ' 個品項?')) { menu.categories.splice(ci, 1); drawItems(); } } }, '刪分類')),
      el('div', { class: 'ed-items' }, c.items.map((it, ii) => el('div', { class: 'ed-item' },
        el('div', { class: 'row' },
          el('input', { type: 'text', class: 'grow', value: it.name, placeholder: '品名', 'aria-label': '品名', oninput: e => { it.name = e.target.value; } }),
          it.own ? el('span', { class: 'tag' }, '自加') : null,
          el('button', { class: 'btn sm danger', 'aria-label': '刪除品項', onclick: () => { c.items.splice(ii, 1); drawItems(); } }, '×')),
        el('div', { class: 'ed-prices' },
          el('label', {}, el('span', { class: 'muted small' }, menu.sizes.length ? '通用價' : '價格'), el('input', { type: 'number', inputmode: 'numeric', value: it.price ?? '', 'aria-label': '價格', oninput: e => { it.price = num(e.target.value); } })),
          menu.sizes.map(s => el('label', {}, el('span', { class: 'muted small' }, s), el('input', { type: 'number', inputmode: 'numeric', value: it.prices[s] ?? '', 'aria-label': s + ' 價格', oninput: e => { const v = num(e.target.value); if (v === null) delete it.prices[s]; else it.prices[s] = v; } }))),
          el('label', {}, el('span', { class: 'muted small' }, '冷熱'), (() => { const s = el('select', { 'aria-label': '冷熱', onchange: e => { it.temp = e.target.value; } }, el('option', { value: 'any' }, '不限'), el('option', { value: 'hot' }, '僅熱'), el('option', { value: 'cold' }, '僅冰')); s.value = it.temp; return s; })()))))),
      el('button', { class: 'btn sm block', 'data-additem': ci, onclick: () => { c.items.push({ id: Menu.rid('i'), name: '', price: null, prices: {}, note: '', temp: 'any', own: true }); drawItems(); } }, '＋ 新增品項(自加)'))),
      el('button', { class: 'btn block', id: 'edAddCat', onclick: () => { menu.categories.push({ name: '新分類', items: [] }); drawItems(); } }, '＋ 新增分類'));
  }
  drawItems();

  const paste = el('textarea', { rows: 3, id: 'edPaste', placeholder: '貼上更多品項文字(每行「品名 價格」),會加到下面' });
  const doPaste = () => {
    const p = Menu.parseText(paste.value);
    if (!p.categories.length) { alert('沒有解析到品項'); return; }
    p.sizes.forEach(s => { if (!menu.sizes.includes(s)) menu.sizes.push(s); });
    p.categories.forEach(pc => { const ex = menu.categories.find(c => c.name === pc.name); const items = pc.items.map(i => Object.assign({ id: Menu.rid('i'), own: true }, i)); if (ex) ex.items.push(...items); else menu.categories.push({ name: pc.name, items }); });
    paste.value = ''; sizes.value = menu.sizes.join('、'); drawItems();
    if (p.warnings.length || p.skipped.length) alert(p.warnings.concat(p.skipped.length ? ['略過:' + p.skipped.join(' / ')] : []).join('\n'));
  };
  root.append(
    el('div', { class: 'two-col' },
      el('div', {}, ...field('店名', shop), ...field('尺寸(用「、」分隔)', sizes, '尺寸價格在每個品項填;沒填的尺寸沿用通用價'),
        ...field('加料與加價', tops)),
      el('div', {}, ...field('冰度選項', ice, '照片沒列時是台灣常用預設,可改'), ...field('糖度選項', sugar),
        el('label', { class: 'f' }, '貼上文字追加品項'), paste, el('button', { class: 'btn sm', id: 'edPasteBtn', onclick: doPaste }, '加入貼上的品項'))),
    el('h3', {}, '分類與品項'), itemsBox);
  return root;
}

/* ---------- 範本編輯頁 ---------- */
export function openMenuEditor(menu, opts) {
  opts = opts || {};
  let isNew = !!opts.isNew, skipAsk = false;
  pushScreen(isNew ? '新菜單' : '編輯菜單', (body, entry) => {
    if (opts.notices && opts.notices.length) body.append(el('div', { class: 'banner', id: 'edNotices' }, opts.notices.join('\n')));
    if (opts.photos && opts.photos.length) body.append(photoStrip(opts.photos), el('div', { class: 'muted small' }, '照片只用來對照,不會存起來(菜單範本只存文字)。'));
    body.append(el('div', { class: 'muted small' }, '價格可以先留空,點餐時會顯示「價格待補」,結單後再輸入店家總額分攤。'), menuEditor(menu));
    const sb = attachSaveBar(entry, {
      id: 'edSave', label: '💾 存為範本',
      onSave: async () => {
        if (!(await saveTemplate(menu))) return false;
        const first = isNew; isNew = false;
        if (!skipAsk && Guide.afterTemplateSave(first) === 'ask-open-room') setTimeout(() => openAskRoom(menu), 0);
        return { where: '我的菜單', view: () => openLibrary() };
      },
      extra: [el('button', { class: 'btn', id: 'edSaveRoom', onclick: async () => { skipAsk = true; const ok = await sb.doSave(); skipAsk = false; if (ok) openCreateRoom([menu.id]); } }, '🍹 存好並開團')],
    });
    sb.trackInputs(body);
  });
}
// 菜單範本存好之後:要馬上開團嗎?
function openAskRoom(menu) {
  pushScreen(Guide.ASK_ROOM.title, body => {
    body.append(el('p', { class: 'explain-p', id: 'askText' }, '「' + (menu.shop || '這份菜單') + '」已存成範本。'),
      bigBtn('🍹', '開團', () => { popScreen(); openCreateRoom([menu.id]); }, 'primary', 'askRoom'),
      bigBtn('📋', Guide.ASK_ROOM.secondary, () => popScreen(), '', 'askNo'));
  });
}
async function saveTemplate(menu) {
  const errs = Menu.validate(menu);
  if (errs.length) { alert('還不能儲存:\n' + errs.slice(0, 6).join('\n')); return false; }
  const m = Menu.normalize(Object.assign(Menu.clone(menu), { updatedAt: Date.now() }));
  await DB.putMenu(m);
  menu.updatedAt = m.updatedAt;
  return true;
}

/* ---------- 範本庫 ---------- */
async function shareMenuFile(menus, name) {
  const text = Menu.toExport(menus);
  const file = new File([text], (name || '菜單').replace(/[\\/:*?"<>|]/g, ' ') + '.menu.json', { type: 'application/json' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = el('a', { href: URL.createObjectURL(file), download: file.name }); document.body.append(a); a.click(); a.remove();
}
async function importMenus(text) {
  const r = Menu.fromImport(text);
  if (r.error) { alert('匯入失敗:' + r.error); return 0; }
  for (const m of r.menus) { m.updatedAt = Date.now(); await DB.putMenu(m); }
  alert('已匯入 ' + r.menus.length + ' 份菜單');
  return r.menus.length;
}
export function openLibrary() {
  pushScreen('我的菜單', (body, entry) => {
    const list = el('div', { id: 'libList', class: 'lib-grid' });
    const draw = async () => {
      const all = (await DB.allMenus()).map(Menu.normalize).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      list.replaceChildren();
      if (!all.length) list.append(el('div', { class: 'empty', id: 'libEmpty' }, '還沒有菜單範本。拍一張菜單,或貼上文字。'), el('div', { class: 'big-grid two' }, bigBtn('📷', '拍菜單建立', () => openMenuBuilder([]), 'primary', 'libEmptyShoot'), bigBtn('✍️', '貼文字建立', () => openMenuBuilder([], { focusPaste: true }), '', 'libEmptyPaste')));
      all.forEach(m => list.append(el('div', { class: 'card lib-row', 'data-id': m.id },
        el('b', {}, m.shop || '(未命名)'), el('div', { class: 'muted small' }, Menu.countItems(m) + ' 個品項 · ' + fmtDate(m.updatedAt)),
        el('div', { class: 'row wrap', style: 'margin-top:8px' },
          el('button', { class: 'btn sm primary', 'data-act': 'edit', onclick: () => openMenuEditor(m, { noOrder: true }) }, '編輯'),
          el('button', { class: 'btn sm', 'data-act': 'copy', onclick: async () => { const c = Menu.clone(m); c.id = Menu.rid('m'); c.shop += '(複製)'; c.updatedAt = Date.now(); await DB.putMenu(Menu.normalize(c)); draw(); } }, '複製'),
          el('button', { class: 'btn sm', 'data-act': 'rename', onclick: async () => { const n = prompt('菜單名稱', m.shop); if (n && n.trim()) { m.shop = n.trim(); m.updatedAt = Date.now(); await DB.putMenu(m); draw(); } } }, '改名'),
          el('button', { class: 'btn sm', 'data-act': 'export', onclick: () => shareMenuFile([m], m.shop) }, '匯出'),
          el('button', { class: 'btn sm', 'data-act': 'copyjson', onclick: async () => { try { await navigator.clipboard.writeText(Menu.toExport([m])); alert('已複製 JSON 文字,可貼給家人'); } catch (_) { prompt('請手動複製', Menu.toExport([m])); } } }, '複製文字'),
          el('button', { class: 'btn sm danger', 'data-act': 'delete', onclick: async () => { if (confirm('確定刪除菜單「' + m.shop + '」?')) { await DB.deleteMenu(m.id); draw(); } } }, '刪除')))));
    };
    entry.refresh = draw;
    body.append(
      el('div', { class: 'big-grid' },
        bigBtn('📷', '拍菜單新增', () => openMenuBuilder([]), 'primary', 'libAdd'),
        el('label', { class: 'big-btn' }, el('span', { class: 'bi' }, '📥'), el('span', { class: 'bt' }, '匯入檔案'), el('input', { type: 'file', accept: '.json,application/json', class: 'hidden', id: 'libImportFile', onchange: async e => { const f = e.target.files[0]; e.target.value = ''; if (f && await importMenus(await f.text())) draw(); } })),
        bigBtn('📋', '貼上文字匯入', async () => { const t = prompt('貼上菜單 JSON 文字'); if (t && await importMenus(t)) draw(); }, '', 'libImportText'),
        bigBtn('📤', '匯出全部', async () => { const all = await DB.allMenus(); if (all.length) shareMenuFile(all, '全部菜單'); }, '', 'libExportAll')),
      list);
    draw();
  }, null, 'library');
}

/* ---------- 開團頁 ---------- */
export async function openCreateRoom(preselect) {
  const library = (await DB.allMenus()).map(Menu.normalize).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const settings = getSettings();
  pushScreen('開團', (body, entry) => {
    const gate = Guide.roomGate({ hasBackend: hasBackend(), libraryCount: library.length });
    if (gate.kind === 'need-db') {
      body.append(el('div', { class: 'card', id: 'needDb' }, el('h2', {}, gate.title),
        el('p', { class: 'explain-p' }, '大家要連到同一個資料庫,才能即時看到彼此點的飲料。這只要設定一次。'),
        el('p', { class: 'explain-p' }, '到設定頁填入你自己的資料庫網址(步驟見「Firebase設定步驟.md」)。'),
        el('p', { class: 'explain-p' }, '只想先看看流程?選「先用單機預覽」,在這支手機上試玩;結果只有這支手機看得到。')),
        bigBtn('⚙️', '前往設定', () => openSettings(), 'primary', 'needDbSettings'),
        bigBtn('🧪', '先用單機預覽', () => { saveSettings(Object.assign({}, getSettings(), { useMock: true })); entry.refresh = null; popScreen(); openCreateRoom(preselect); }, '', 'needDbPreview'));
      entry.refresh = () => { if (hasBackend()) { entry.refresh = null; popScreen(); openCreateRoom(preselect); } };
      return;
    }
    if (gate.kind === 'empty-library') {
      body.append(el('div', { class: 'card', id: 'emptyLib' }, el('h2', {}, gate.title), el('p', { class: 'explain-p' }, '先有菜單,才能開團。拍一張菜單,或把菜單文字貼上來。')),
        bigBtn('📷', '拍菜單建立', () => openMenuBuilder([]), 'primary', 'rmGoBuild'),
        bigBtn('✍️', '貼文字建立', () => openMenuBuilder([], { focusPaste: true }), '', 'rmGoPaste'));
      entry.refresh = async () => { const n = (await DB.allMenus()).length; if (n) { entry.refresh = null; popScreen(); openCreateRoom(preselect); } };
      return;
    }
    const sel = new Set(preselect || (library.length === 1 ? [library[0].id] : []));
    let titleEdited = false;
    const d0 = new Date(); d0.setMinutes(0, 0, 0); d0.setHours(d0.getHours() + 1);
    const title = el('input', { type: 'text', id: 'rmTitle', maxlength: 80, oninput: () => { titleEdited = true; } });
    const planned = el('input', { type: 'datetime-local', id: 'rmPlanned', value: toLocalInput(d0.getTime()) });
    const loc = el('input', { type: 'text', id: 'rmLocation', maxlength: 120, placeholder: '例:公司 3 樓會議室' });
    const host = el('input', { type: 'text', id: 'rmHost', maxlength: 40, value: settings.myName || '' });
    const deadline = el('input', { type: 'datetime-local', id: 'rmDeadline' });
    const merge = el('select', { id: 'rmMerge' }, el('option', { value: 'separate' }, '各自獨立(每家店一個區段)'), el('option', { value: 'merged' }, '合併排列(依分類合併成一個清單)'));
    const mergeRow = el('div', { id: 'rmMergeRow' }, el('label', { class: 'f' }, '多份菜單的排列方式'), merge);
    const pick = el('div', { class: 'pick-grid', id: 'rmPick' });
    const reason = el('div', { class: 'reason', id: 'rmReason' });
    const go = bigBtn('➡️', '下一步:確認菜單', () => next(), 'primary', 'rmNext');
    const extra = el('div');
    const defaultTitle = () => { const ms = library.filter(m => sel.has(m.id)); return (ms.length ? ms.map(m => m.shop).join('+') : '團購') + ' ' + today().replace(/-/g, '/'); };
    function refresh() {
      if (!titleEdited) title.value = defaultTitle();
      pick.replaceChildren(...library.map(m => el('button', { class: 'pick' + (sel.has(m.id) ? ' on' : ''), 'data-id': m.id, onclick: () => { if (sel.has(m.id)) sel.delete(m.id); else sel.add(m.id); refresh(); } },
        el('span', { class: 'pk' }, sel.has(m.id) ? '☑' : '☐'), el('b', {}, m.shop || '(未命名)'), el('span', { class: 'muted small' }, Menu.countItems(m) + ' 個品項'))));
      mergeRow.classList.toggle('hidden', sel.size < 2);
      const c = Menu.canOpenRoom(library, [...sel], hasBackend());
      go.disabled = !c.ok; reason.textContent = c.ok ? '' : c.reason; reason.classList.toggle('hidden', c.ok);
      extra.replaceChildren();
      if (c.code === 'EMPTY_LIBRARY') extra.append(bigBtn('📷', '去拍菜單', () => openMenuBuilder([]), 'primary', 'rmGoBuild'));
      if (c.code === 'NO_DB') extra.append(bigBtn('⚙️', '去設定', () => openSettings(), '', 'rmGoSettings'));
    }
    entry.refresh = async () => { const fresh = (await DB.allMenus()).map(Menu.normalize); library.length = 0; library.push(...fresh.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))); refresh(); };
    function next() {
      const c = Menu.canOpenRoom(library, [...sel], hasBackend());
      if (!c.ok) return;
      if (!title.value.trim()) { alert('請輸入團名'); return; }
      const fields = {
        title: title.value.trim(), plannedAt: planned.value ? new Date(planned.value).getTime() : null, location: loc.value.trim(), hostName: host.value.trim() || settings.myName || '發起人',
        deadline: deadline.value ? new Date(deadline.value).getTime() : null, mergeMode: sel.size > 1 ? merge.value : 'separate',
      };
      if (fields.deadline && fields.deadline < Date.now()) { alert('截止時間已經過了'); return; }
      openConfirmMenus(library.filter(m => sel.has(m.id)).map(Menu.clone), fields);
    }
    body.append(el('div', { class: 'two-col' },
      el('div', {}, el('label', { class: 'f' }, '選擇菜單(可多選)'), pick, mergeRow),
      el('div', {}, el('label', { class: 'f' }, '團名'), title, el('label', { class: 'f' }, '計畫時間'), planned, el('label', { class: 'f' }, '地點'), loc,
        el('label', { class: 'f' }, '發起人名稱'), host, el('label', { class: 'f' }, '截止下單時間(選填)'), deadline)),
      reason, extra, go);
    if (mockOn()) body.prepend(el('div', { class: 'banner warn', id: 'previewNote' }, '單機預覽(測試模式):結果只有這支手機看得到。'));
    refresh();
  }, null, 'room');
}

/* ---------- 開團前:菜單確認與編輯 ---------- */
function openConfirmMenus(menus, fields) {
  pushScreen('確認菜單', body => {
    const sync = new Set();
    let active = 0;
    const tabs = el('div', { class: 'chips' }), box = el('div');
    const draw = () => {
      tabs.replaceChildren(...(menus.length > 1 ? menus.map((m, i) => el('button', { class: 'chip' + (i === active ? ' on' : ''), onclick: () => { active = i; draw(); } }, m.shop || '(未命名)')) : []));
      const m = menus[active];
      box.replaceChildren(
        el('div', { class: 'muted small' }, '這裡的修改只影響這一團(可勾選同步回範本)。可新增老闆沒被拍到的品項。'),
        el('label', { class: 'row', style: 'margin:8px 0' }, el('input', { type: 'checkbox', id: 'confSync', checked: sync.has(m.id), style: 'width:24px;height:24px', onchange: e => { if (e.target.checked) sync.add(m.id); else sync.delete(m.id); } }), '同步回範本'),
        menuEditor(m));
    };
    draw();
    body.append(tabs, box, el('div', { class: 'sticky-act' },
      bigBtn('✅', '確認並開團', async function () {
        for (const m of menus) {
          const errs = Menu.validate(m);
          if (errs.length) { alert('「' + (m.shop || '未命名') + '」還不能開團:\n' + errs.slice(0, 6).join('\n')); return; }
        }
        const btn = document.getElementById('confGo'); btn.disabled = true;
        try {
          const snaps = menus.map(m => Menu.normalize(Menu.clone(m)));
          const { net, mode, dbUrl } = getNet();
          const token = genToken();
          const f = Object.assign({}, fields, { menuIds: snaps.map(m => m.id).join(',') });
          const { code, meta } = await net.createRoom(f, snaps, token);
          const rec = { code, title: fields.title, createdAt: meta.createdAt, hostToken: token, dbUrl, mock: mode === 'mock' };
          await DB.putRoom(rec);
          for (const m of snaps) if (sync.has(m.id)) await DB.putMenu(Object.assign({}, m, { updatedAt: Date.now() }));
          popScreen(); popScreen();
          openRoomHost(rec);
        } catch (e) { alert('開團失敗:' + (e.message || e)); btn.disabled = false; }
      }, 'primary', 'confGo')));
  });
}
export { configuredDbUrl, mockOn, NetError, uuid };
