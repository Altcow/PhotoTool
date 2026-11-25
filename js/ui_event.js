// 事件頁:上方文章卡(標題、日期時間、內容、照片縮圖格),下方選項方塊(🍽 選單 / 📍 導覽 / 📄 附件 三個 tab);
// 點餐單頁(#/j/<jid>/m/<eNNN_bNN>);照片上傳/檢視。所有會等網路的動作都走 act()(處理中遮罩、逾時、可重試)。
// cx = {jid, eid, mk, state, role, canEdit, open, render, mem, titleEl}(由 ui_journal.js mountDetail 提供)
import { el, pushScreen, popScreen, toast } from './app.js';
import { ctx, richText, setHash } from './tjctx.js';
import * as busy from './busy.js';
import * as DB from './db.js';
import { openForm, act } from './ui_form.js';

const J = () => window.Journal;
const T = v => J().txt(v);
const FILE_ICON = { pdf: '📄', doc: '📝', xls: '📊', txt: '📃', img: '🖼', other: '🔗' };
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const TAB_HINT = {
  menu: '還沒有點餐單。例:按「＋ 新增選單」建一份「50嵐」,大家就能各自點。',
  nav: '貼上 Google 地圖的分享連結,會變成一顆大按鈕,大家按了直接導航。',
  file: 'Word、Excel、PDF 先放到雲端硬碟並開「知道連結的人可檢視」,再把連結貼到這裡。',
};
const tabKey = (jid, eid) => 'tj_tab_' + jid + '_' + eid;
const ss = { get(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (_) { /* 略過 */ } } };

// 每次掛載詳情頁一份:縮圖、點餐單訂閱、清單摘要
export function eventMem() {
  return {
    thumbs: {}, thumbTried: {}, thumbBusy: false, sum: {}, sumFor: '', menuK: '', menu: null, menuErr: null, menuOff: null,
    dispose() { if (this.menuOff) this.menuOff(); this.menuOff = null; },
  };
}

const dateLine = d => {
  if (!J().isDate(d)) return '';
  const w = new Date(d + 'T00:00:00Z').getUTCDay();
  return J().md(d) + '(' + WEEK[w] + ')';
};
// 「管理」= 一顆有字的按鈕,展開 編輯/上移/下移/刪除
function manageRow(cx, key, items) {
  const on = !!cx.open[key];
  return [el('div', { class: 'tj-edit-row' }, el('button', { class: 'btn sm tj-manage', 'aria-expanded': on ? 'true' : 'false', onclick: () => { cx.open[key] = !on; cx.render(); } }, on ? '收起' : '管理')),
    on ? el('div', { class: 'tj-actions' }, items.filter(Boolean).map(([label, fn, danger]) => el('button', { class: 'btn sm' + (danger ? ' danger' : ''), onclick: fn }, label))) : null];
}

/* ================= 事件頁 ================= */
export function eventView(cx) {
  const L = J(), j = cx.state.j, ev = (j.events || {})[cx.eid];
  if (!ev) return [el('div', { class: 'card', id: 'tjEvGone' }, '找不到這個事件(可能已被刪除)')];
  cx.titleEl.textContent = T(ev.title);
  const blocks = (j.blocks || {})[cx.eid] || {};
  const kids = [articleCard(cx, ev, blocks)];
  const box = optionBox(cx, blocks);
  if (box) kids.push(box);
  loadThumbs(cx);
  loadSummaries(cx, blocks);
  return kids;
}

function articleCard(cx, ev, blocks) {
  const L = J(), canEdit = cx.canEdit;
  const texts = L.sortedList(blocks).filter(b => b.type === 'text');
  const photos = L.sortedList(((cx.state.j.photos || {})[cx.eid]) || {});
  const when = [dateLine(T(ev.date)), L.fmtTimes(T(ev.time), T(ev.endTime))].filter(Boolean).join(' ');
  const desc = T(ev.desc);
  const kids = [el('div', { class: 'tj-info-title' }, T(ev.title)), el('div', { class: 'muted', id: 'tjEvWhen' }, when || '沒有日期')];
  if (desc) kids.push(el('div', { id: 'tjEvDesc' }, richText(desc)));
  texts.forEach(b => kids.push(el('div', { class: 'tj-oldtext', 'data-bid': b.id }, richText(T(b.text) || T(b.title)),
    canEdit ? manageRow(cx, 'b' + b.id, [['編輯', () => editLink(cx, b)], ['上移', () => move(cx, 'blocks/' + cx.eid, blocks, b.id, 'up', x => x.type === 'text')], ['下移', () => move(cx, 'blocks/' + cx.eid, blocks, b.id, 'down', x => x.type === 'text')], ['刪除', () => delAct('刪除這段文字?', () => ctx.jn.deleteBlock(cx.jid, cx.eid, b.id)), true]]) : null)));
  if (photos.length) kids.push(el('div', { class: 'tj-photos', id: 'tjPhotos' }, photos.map((p, i) => {
    const src = cx.mem.thumbs[p.id + '/' + p.v];
    return el('button', { class: 'tj-ph', 'data-iid': p.id, 'aria-label': '照片 ' + (i + 1) + (T(p.cap) ? ':' + T(p.cap) : ''), onclick: () => openViewer(cx, photos, i) },
      src ? el('img', { src, alt: T(p.cap) || '照片 ' + (i + 1) }) : el('span', { class: 'tj-ph-empty' }, navigator.onLine === false ? '離線' : '…'));
  })));
  if (canEdit && !desc && !texts.length && !photos.length) kids.push(el('div', { class: 'muted small', id: 'tjEvHint' }, '按「編輯文章」寫行程說明,也可以加照片。'));
  if (canEdit) {
    const pick = el('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden', id: 'tjPhotoPick', onchange: e => { const fs = Array.from(e.target.files || []); e.target.value = ''; if (fs.length) uploadPhotos(cx, fs); } });
    kids.push(el('div', { class: 'row wrap', style: 'margin-top:10px;gap:8px' },
      el('button', { class: 'btn primary', id: 'tjEditArticle', onclick: () => editArticle(cx, ev) }, '編輯文章'),
      el('label', { class: 'btn', id: 'tjAddPhoto' }, '＋照片', pick)));
  }
  return el('div', { class: 'card tj-article', id: 'tjEvArticle' }, kids);
}

function editArticle(cx, ev) {
  const id = cx.eid;
  openForm({
    title: '編輯文章',
    guard: { cur: () => Number((((cx.state.j.events || {})[id]) || {}).updatedAt) || 0, base: Number(ev.updatedAt) || 0 },
    fields: [
      { key: 'title', label: '標題', value: ev.title, max: 60, required: true },
      { key: 'date', label: '日期(選填)', type: 'date', value: ev.date },
      { key: 'time', label: '開始時間(選填)', type: 'time', value: ev.time },
      { key: 'endTime', label: '結束時間(選填)', type: 'time', value: ev.endTime },
      { key: 'desc', label: '內容', type: 'textarea', rows: 8, value: ev.desc, max: J().LIM.desc, hint: 'https:// 開頭的網址會自動變成連結。' }],
    onSave: v => ctx.jn.updateEvent(cx.jid, id, v),
  });
}

const move = (cx, path, map, id, dir, keep) => act(() => ctx.jn.moveItem(cx.jid, path, map, id, dir, keep), '移動中…');
const delAct = async (msg, fn) => { if (!confirm(msg)) return; await act(fn, '刪除中…', '已刪除'); };

/* ---------- 選項方塊 ---------- */
function optionBox(cx, blocks) {
  const L = J(), counts = L.tabCounts(blocks), vis = L.visibleTabs(counts, cx.canEdit);
  if (!vis.length) return null;
  let tab = L.defaultTab(ss.get(tabKey(cx.jid, cx.eid)), counts, cx.canEdit);
  const list = L.sortedList(blocks).filter(b => b.type === tab);
  const tabs = el('div', { class: 'tj-tabs', role: 'tablist', id: 'tjOptTabs' }, L.OPT_TABS.filter(t => vis.indexOf(t[0]) >= 0).map(t => el('button', {
    class: 'tj-tab' + (t[0] === tab ? ' on' : ''), role: 'tab', id: 'tjTab_' + t[0], 'aria-selected': t[0] === tab ? 'true' : 'false',
    onclick: () => { ss.set(tabKey(cx.jid, cx.eid), t[0]); cx.render(); },
  }, t[1] + (counts[t[0]] ? ' ' + counts[t[0]] : ''))));
  const body = el('div', { class: 'tj-tabbody', id: 'tjTabBody' });
  const mng = (b, editFn) => (cx.canEdit ? manageRow(cx, 'b' + b.id, [[tab === 'menu' ? '改名' : '編輯', editFn],
    ['上移', () => move(cx, 'blocks/' + cx.eid, blocks, b.id, 'up', x => x.type === tab)], ['下移', () => move(cx, 'blocks/' + cx.eid, blocks, b.id, 'down', x => x.type === tab)],
    ['刪除', () => (tab === 'menu' ? deleteMenu(cx, b) : delAct('刪除「' + T(b.title) + '」?', () => ctx.jn.deleteBlock(cx.jid, cx.eid, b.id))), true]]) : null);
  if (tab === 'menu') {
    list.forEach(b => {
      const k = L.menuKey(cx.eid, b.id), s = cx.mem.sum[k];
      const line = s ? [s.open ? '點餐中' : '已結單', s.cups + ' ' + (s.kind === 'general' ? '份' : '杯'), s.mine ? '我 ' + s.mine : ''].filter(Boolean).join(' · ') : '';
      body.append(el('div', { class: 'tj-optrow', 'data-bid': b.id },
        el('button', { class: 'tj-menurow', onclick: () => setHash('#/j/' + cx.jid + '/m/' + k) }, el('b', { class: 'grow' }, T(b.title) || '(未命名)'), el('small', { class: 'muted' }, line), el('span', { class: 'tj-chev' }, '›')),
        mng(b, () => renameMenu(cx, b))));
    });
    if (cx.canEdit) body.append(el('button', { class: 'big-btn primary', id: 'tjAddMenu', onclick: () => createMenu(cx, list.length) }, '＋ 新增選單'));
  } else {
    list.forEach(b => {
      const icon = tab === 'nav' ? '📍' : FILE_ICON[b.mime || L.fileMime(b.url)] || '🔗';
      body.append(el('div', { class: 'tj-optrow', 'data-bid': b.id },
        L.isHttpsUrl(b.url) ? el('a', { class: 'big-btn', href: b.url, target: '_blank', rel: 'noopener noreferrer' }, el('span', { class: 'bi' }, icon), T(b.title)) : el('div', { class: 'card' }, T(b.title)),
        mng(b, () => editLink(cx, b))));
    });
    if (cx.canEdit) body.append(el('button', { class: 'big-btn primary', id: tab === 'nav' ? 'tjAddNav' : 'tjAddFile', onclick: () => editLink(cx, { type: tab }) }, tab === 'nav' ? '＋ 新增導覽' : '＋ 新增附件'));
  }
  if (!list.length && cx.canEdit) body.prepend(el('div', { class: 'muted small', id: 'tjTabHint' }, TAB_HINT[tab]));
  return el('div', { class: 'card tj-optbox', id: 'tjOptBox' }, tabs, body);
}

// 導覽、附件(與舊的文字區塊)新增/編輯
function editLink(cx, b) {
  const isNew = !b.id, isNav = b.type === 'nav', isFile = b.type === 'file';
  const name = isNav ? '導覽' : isFile ? '附件' : '文字';
  openForm({
    title: (isNew ? '新增' : '編輯') + name,
    banner: isFile ? '先在雲端硬碟按「分享」→「知道連結的使用者」→「複製連結」,再貼到下面。相簿也可以這樣放。' : null,
    guard: isNew ? null : { cur: () => Number((((cx.state.j.blocks || {})[cx.eid] || {})[b.id] || {}).updatedAt) || 0, base: Number(b.updatedAt) || 0 },
    fields: b.type === 'text'
      ? [{ key: 'text', label: '文字', type: 'textarea', value: b.text, max: 4000, required: true }]
      : [{ key: 'title', label: isNav ? '標題名稱(例如:動物園導引)' : '標題名稱(例如:行程表.pdf)', value: b.title, max: 60, required: true },
        { key: 'url', label: isNav ? '網址(Google 地圖分享連結等,https:// 開頭)' : '雲端硬碟分享連結(https:// 開頭)', type: 'url', value: b.url, max: 2000, required: true }],
    onSave: (v, slot) => {
      const f = Object.assign({ type: b.type }, v);
      if (!isNew) return ctx.jn.updateBlock(cx.jid, cx.eid, b.id, f);
      slot.cur = slot.cur || (cx.state.j.blocks || {})[cx.eid] || {};
      return ctx.jn.addBlock(cx.jid, cx.eid, f, slot);
    },
  });
}

/* ---------- 點餐單:清單摘要(tab 列用)---------- */
async function loadSummaries(cx, blocks) {
  const L = J(), m = cx.mem;
  if (!cx.role || m.sumFor === cx.eid) return;   // 非成員讀不到點餐資料
  m.sumFor = cx.eid;
  const ids = Object.keys(blocks).filter(b => blocks[b].type === 'menu');
  for (const b of ids) {
    const k = L.menuKey(cx.eid, b);
    try {
      const d = (await ctx.jn.getMenuData(cx.jid, k)) || {};
      const orders = Object.values(d.orders || {});
      m.sum[k] = { open: !d.meta || d.meta.status !== 'closed', kind: L.menuKind(d.meta, d.menus && d.menus.m1), cups: window.Order.cupCount(orders), mine: window.Order.cupCount(orders.filter(o => o.uid === ctx.uid)) };
    } catch (_) { /* 讀不到就不顯示摘要 */ }
  }
  if (ids.length) cx.render();
}

/* ---------- 點餐單:建立、改名、刪除 ---------- */
function createMenu(cx, count) {
  pushScreen('新增選單', body => {
    const L = J(), MN = window.Menu;
    let kind = 'drink', src = 'manual', tpl = null;
    const slot = { cur: (cx.state.j.blocks || {})[cx.eid] || {} };
    const name = el('input', { type: 'text', id: 'cmName', maxlength: 60, autocomplete: 'off' });
    name.value = L.menuListTitle(count + 1);
    name.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } };
    const err = el('div', { class: 'banner warn', id: 'cmErr', style: 'display:none' });
    const kindBox = el('div', { class: 'big-grid', id: 'cmKind' });
    const srcBox = el('div', { class: 'big-grid', id: 'cmSrc' });
    const srcArea = el('div', { id: 'cmSrcArea' });
    const paste = el('textarea', { id: 'cmPaste', rows: 7, placeholder: '一行一個品項,例:\n紅茶 30\n珍珠奶茶 50' });
    const draw = () => {
      kindBox.replaceChildren(
        el('button', { class: 'big-btn' + (kind === 'drink' ? ' primary' : ''), id: 'cmDrink', 'aria-pressed': kind === 'drink' ? 'true' : 'false', onclick: () => { kind = 'drink'; draw(); } }, '🧋 飲料(可選冰塊、甜度)'),
        el('button', { class: 'big-btn' + (kind === 'general' ? ' primary' : ''), id: 'cmGeneral', 'aria-pressed': kind === 'general' ? 'true' : 'false', onclick: () => { kind = 'general'; draw(); } }, '🍱 一般(數量與備註)'));
      srcBox.replaceChildren(...[['manual', '✍️ 手動輸入'], ['paste', '📋 貼上文字'], ['tpl', '📚 我的菜單範本']].map(([k, l]) =>
        el('button', { class: 'big-btn' + (src === k ? ' primary' : ''), id: 'cmSrc_' + k, 'aria-pressed': src === k ? 'true' : 'false', onclick: () => { src = k; draw(); } }, l)));
      srcArea.replaceChildren();
      if (src === 'manual') srcArea.append(el('div', { class: 'muted small' }, '建立後在點餐單頁按「編輯品項」加入品項。'));
      if (src === 'paste') srcArea.append(paste);
      if (src === 'tpl') {
        const lst = el('div', { id: 'cmTpl' }, el('div', { class: 'muted' }, '讀取中…'));
        srcArea.append(lst);
        DB.allMenus().then(ms => {
          if (!ms.length) { lst.replaceChildren(el('div', { class: 'muted small' }, '這支手機還沒有菜單範本,請改用「貼上文字」或「手動輸入」。')); return; }
          lst.replaceChildren(...ms.map(mm => el('button', { class: 'tj-pick-row' + (tpl && tpl.id === mm.id ? ' on' : ''), onclick: () => { tpl = mm; draw(); } }, (T(mm.shop) || '(未命名)') + ' · ' + MN.countItems(MN.normalize(mm)) + ' 項')));
        }).catch(() => lst.replaceChildren(el('div', { class: 'muted small' }, '讀不到菜單範本')));
      }
    };
    draw();
    const ok = el('button', { class: 'big-btn primary', id: 'cmOk', style: 'margin-top:14px' }, '建立');
    ok.onclick = async () => {
      if (ok.disabled) return;
      let menu = MN.emptyMenu('');
      if (src === 'paste') {
        const p = MN.parseText(paste.value || '');
        if (!p.categories.length) { err.textContent = '沒有讀到品項,請一行寫一個品項(例:紅茶 30)'; err.style.display = ''; return; }
        menu = MN.fromParsed(p, '');
      } else if (src === 'tpl') {
        if (!tpl) { err.textContent = '請先選一份菜單範本'; err.style.display = ''; return; }
        menu = MN.normalize(tpl);
      }
      if (kind === 'general') { menu.ice = []; menu.sugar = []; }
      err.style.display = 'none'; ok.disabled = true;
      const r = await act(() => ctx.jn.createMenuList(cx.jid, cx.eid, { title: name.value, kind, menu }, slot), '建立中…', '已建立');
      ok.disabled = false;
      if (!r.ok) { err.textContent = (r.error && r.error.message) || '建立失敗'; err.style.display = ''; return; }
      ss.set(tabKey(cx.jid, cx.eid), 'menu');
      cx.mem.sumFor = '';
      popScreen(); setHash('#/j/' + cx.jid + '/m/' + r.value);
    };
    body.append(err, el('label', { class: 'f', for: 'cmName' }, '清單名稱(必填,例:50嵐01、蔥油餅、午餐)'), name,
      el('div', { class: 'f' }, '類型'), kindBox, el('div', { class: 'f' }, '品項從哪裡來'), srcBox, srcArea, ok);
  });
}
function renameMenu(cx, b) {
  openForm({
    title: '改清單名稱', fields: [{ key: 'title', label: '清單名稱', value: b.title, max: 60, required: true }],
    onSave: v => ctx.jn.renameMenuList(cx.jid, cx.eid, b.id, v.title),
  });
}
async function deleteMenu(cx, b) {
  const k = J().menuKey(cx.eid, b.id), s = cx.mem.sum[k];
  if (!confirm('刪除點餐單「' + T(b.title) + '」?' + (s && s.cups ? '裡面的 ' + s.cups + ' 份點單也會一起刪除。' : ''))) return;
  await act(async () => {
    let ids = [];
    try { ids = Object.keys(((await ctx.jn.getMenuData(cx.jid, k)) || {}).orders || {}); } catch (_) { /* 讀不到就只刪區塊與菜單 */ }
    await ctx.jn.deleteMenuList(cx.jid, cx.eid, b.id, ids);
  }, '刪除中…', '已刪除');
}

/* ================= 點餐單頁 ================= */
export function menuView(cx) {
  const L = J(), O = window.Order, MN = window.Menu, m = cx.mem, k = cx.mk, pk = L.parseMenuKey(k);
  const block = (((cx.state.j.blocks || {})[pk.eid]) || {})[pk.bid];
  if (m.menuK !== k) {
    if (m.menuOff) m.menuOff();
    m.menuK = k; m.menu = null; m.menuErr = null;
    if (cx.role) m.menuOff = ctx.jn.subscribeMenu(cx.jid, k, v => { m.menu = v; m.menuErr = null; cx.render(); if (m.onMenu) m.onMenu(); }, e => { if (e && e.soft) return; m.menuErr = e; cx.render(); });
  }
  cx.titleEl.textContent = T((m.menu && m.menu.meta && m.menu.meta.title) || (block && block.title)) || '點餐單';
  if (!block && !(m.menu && m.menu.meta)) return [el('div', { class: 'card', id: 'tjMenuGone' }, '找不到這份點餐單(可能已被刪除)')];
  if (!cx.role) return [el('div', { class: 'card', id: 'tjMenuNoMember' }, el('b', {}, '加入日誌後才能點餐'), el('p', { class: 'muted' }, '回到日誌首頁按「加入」。'))];
  if (m.menuErr) return [el('div', { class: 'card', id: 'tjMenuErr' }, el('b', {}, '讀不到點餐單'), el('p', { class: 'muted' }, m.menuErr.message || ''))];
  if (!m.menu) return [el('div', { class: 'muted', id: 'tjLoading' }, '讀取中…')];
  const meta = m.menu.meta || {}, menu = MN.normalize((m.menu.menus || {}).m1 || {}), kind = L.menuKind(meta, (m.menu.menus || {}).m1);
  const ordersMap = m.menu.orders || {}, orders = Object.keys(ordersMap).map(id => Object.assign({ id }, ordersMap[id]));
  const open = meta.status !== 'closed', isMgr = cx.canEdit || meta.managerUid === ctx.uid, unit = kind === 'general' ? '份' : '杯';
  const mgrName = (cx.state.members && cx.state.members[meta.managerUid] && T(cx.state.members[meta.managerUid].name)) || '';
  const mine = orders.filter(o => o.uid === ctx.uid);
  const itemIds = {};
  menu.categories.forEach(c => c.items.forEach(i => { itemIds[i.id] = 1; }));
  const kids = [];
  kids.push(el('div', { class: 'card', id: 'tjMenuHead' },
    el('div', { class: 'tj-info-title' }, T(meta.title || (block && block.title))),
    el('div', { class: 'muted', id: 'tjMenuStatus' }, [open ? '點餐中' : '已結單', mgrName ? '負責人 ' + mgrName : '', '全團 ' + O.cupCount(orders) + ' ' + unit + ' $' + O.grandTotal(orders)].filter(Boolean).join(' · ')),
    open ? null : el('div', { class: 'banner warn', id: 'tjMenuClosed' }, '已結單,要改請找負責人解單。')));
  // 品項
  const cats = menu.categories.filter(c => c.items.length);
  kids.push(el('div', { class: 'card', id: 'tjMenuItems' }, el('b', {}, '品項'),
    cats.length ? cats.map(c => [cats.length > 1 ? el('div', { class: 'muted small', style: 'margin-top:8px' }, T(c.name)) : null,
      c.items.map(it => el('button', { class: 'tj-itemrow', disabled: !open, 'data-item': it.id, onclick: () => orderSheet(cx, menu, kind, it, orders) },
        el('span', { class: 'grow' }, T(it.name) + (T(it.note) ? '(' + T(it.note) + ')' : '')), el('span', { class: 'muted' }, priceText(it)), el('span', { class: 'tj-chev' }, '›')))])
      : el('div', { class: 'muted' }, isMgr ? '還沒有品項,按下面「編輯品項」加入。' : '還沒有品項。')));
  // 我的點單
  kids.push(el('div', { class: 'card', id: 'tjMyOrders' }, el('b', {}, '我的點單 共 ' + O.cupCount(mine) + ' ' + unit + ' $' + O.grandTotal(mine)),
    mine.length ? mine.map(o => el('div', { class: 'tj-mem-row', 'data-sid': o.id },
      el('span', { class: 'grow' }, O.optionLabel(o) + ' ×' + O.cups(o) + (itemIds[o.itemId] ? '' : '(已下架)') + (T(o.note) ? '(' + T(o.note) + ')' : '')),
      el('span', { class: 'muted' }, O.hasPrice(o) ? '$' + O.lineTotal(o) : '時價'),
      open ? el('button', { class: 'btn sm', 'data-act': 'cancel', onclick: () => { if (confirm('取消這筆「' + O.optionLabel(o) + '」?')) act(() => ctx.jn.cancelOrder(cx.jid, k, o.id), '取消中…', '已取消'); } }, '取消') : null))
      : el('div', { class: 'muted' }, '還沒有點。按上面的品項加入。')));
  // 大家的點單
  const ps = O.people(orders);
  kids.push(el('details', { class: 'card', id: 'tjAllOrders', open: !!cx.open.allOrders, ontoggle: e => { cx.open.allOrders = e.target.open; } },
    el('summary', { class: 'tj-sum' }, '大家的點單(' + ps.length + ' 人)'),
    ps.length ? ps.map(p => el('div', { class: 'tj-person' }, el('b', {}, p.display + ' ' + p.cups + ' ' + unit + (p.unpricedCups ? ' 金額待補' : ' $' + p.total)),
      p.orders.map(o => el('div', { class: 'muted small' }, O.optionLabel(o) + ' ×' + O.cups(o) + (T(o.note) ? '(' + T(o.note) + ')' : '')))))
      : el('div', { class: 'muted' }, '目前沒有點單')));
  // 試算與匯出
  const title = T(meta.title || (block && block.title)), day = T(((cx.state.j.events || {})[pk.eid] || {}).date);
  kids.push(el('div', { class: 'card', id: 'tjMenuTools' }, el('div', { class: 'row wrap', style: 'gap:8px' },
    el('button', { class: 'btn', id: 'tjSplit', onclick: () => splitScreen(cx, k, meta, orders, menu, title, day, isMgr) }, '試算每人應付'),
    el('button', { class: 'btn', id: 'tjExpShop', onclick: () => textScreen('訂單彙整(給店家)', O.clerkTexts([Object.assign({}, menu, { shop: title })], orders).map(g => g.text).join('\n\n') || '(目前沒有訂單)') }, '匯出給店家'),
    el('button', { class: 'btn', id: 'tjExpPeople', onclick: () => textScreen('每人點單(給團員)', O.customerText(title, L.md(day) || '', orders, [menu])) }, '匯出每人點單'))));
  if (isMgr) kids.push(el('div', { class: 'card', id: 'tjMenuMgr' }, el('b', {}, '負責人 / 編輯者'), el('div', { class: 'row wrap', style: 'gap:8px;margin-top:8px' },
    open ? el('button', { class: 'btn danger', id: 'tjCloseMenu', onclick: () => { if (confirm('要結單嗎?結單後大家不能再加點或取消。')) act(() => ctx.jn.setMenuOpen(cx.jid, k, false, meta), '處理中…', '已結單'); } }, '結單')
      : el('button', { class: 'btn primary', id: 'tjOpenMenu', onclick: () => act(() => ctx.jn.setMenuOpen(cx.jid, k, true, meta), '處理中…', '已解單') }, '解單'),
    el('button', { class: 'btn', id: 'tjEditItems', onclick: () => itemsScreen(cx, k, kind) }, '編輯品項'),
    el('button', { class: 'btn', id: 'tjChangeMgr', onclick: () => changeManager(cx, k, meta) }, '換負責人'))));
  return kids;
}
const priceText = it => {
  const ps = Object.keys(it.prices || {});
  if (ps.length) return ps.map(s => s + ' $' + it.prices[s]).join(' / ');
  return it.price === null || it.price === undefined ? '時價' : '$' + it.price;
};

// 點單小頁:數量、(飲料)尺寸/冰塊/甜度、備註
function orderSheet(cx, menu, kind, it, orders) {
  pushScreen(T(it.name), body => {
    const MN = window.Menu, O = window.Order, k = cx.mk;
    const sizes = MN.sizeChoices(menu, it), ices = kind === 'drink' ? MN.iceChoices(menu, it) : [], sugars = kind === 'drink' ? (menu.sugar || []) : [];
    const st = { qty: 1, size: sizes[0] || '', ice: ices[0] || '', sugar: sugars[0] || '' };
    const slot = { cur: Object.assign({}, cx.mem.menu && cx.mem.menu.orders) };
    const note = el('input', { type: 'text', id: 'osNote', maxlength: 200, autocomplete: 'off', placeholder: '(選填)例:不要香菜' });
    note.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); note.blur(); } };
    const box = el('div', {});
    const chips = (label, list, key) => (list.length ? [el('div', { class: 'f' }, label), el('div', { class: 'tj-pick' }, list.map(v => el('button', { class: 'tj-chip-opt' + (st[key] === v ? ' on' : ''), 'aria-pressed': st[key] === v ? 'true' : 'false', onclick: () => { st[key] = v; draw(); } }, v)))] : null);
    const draw = () => {
      const price = O.basePrice(it, st.size);
      box.replaceChildren(
        el('div', { class: 'tj-info-title' }, T(it.name)), el('div', { class: 'muted', id: 'osPrice' }, price === null ? '時價' : '$' + price + (st.qty > 1 ? ' × ' + st.qty + ' = $' + price * st.qty : '')),
        chips('尺寸', sizes, 'size'), chips('冰塊', ices, 'ice'), chips('甜度', sugars, 'sugar'),
        el('div', { class: 'f' }, '數量'),
        el('div', { class: 'tj-stepper' },
          el('button', { class: 'btn', id: 'osMinus', 'aria-label': '減少', onclick: () => { st.qty = Math.max(1, st.qty - 1); draw(); } }, '−'),
          el('b', { id: 'osQty' }, String(st.qty)),
          el('button', { class: 'btn', id: 'osPlus', 'aria-label': '增加', onclick: () => { st.qty = Math.min(99, st.qty + 1); draw(); } }, '＋')));
    };
    draw();
    const ok = el('button', { class: 'big-btn primary', id: 'osOk', style: 'margin-top:16px' }, '加入我的點單');
    ok.onclick = async () => {
      if (ok.disabled) return;
      ok.disabled = true;
      const r = await act(() => ctx.jn.addOrder(cx.jid, k, { itemId: it.id, itemName: it.name, unitPrice: O.basePrice(it, st.size), qty: st.qty, size: st.size, ice: st.ice, sugar: st.sugar, note: note.value }, slot), '送出中…', '已加入');
      ok.disabled = false;
      if (r.ok) popScreen();
    };
    body.append(box, el('label', { class: 'f', for: 'osNote' }, '備註'), note, ok);
  });
}

// 匯出文字:複製 / 分享到 LINE / 其他分享
function textScreen(title, text) {
  pushScreen(title, body => {
    const ta = el('textarea', { id: 'expText', rows: 14, readonly: true });
    ta.value = text;
    body.append(ta, el('div', { class: 'row wrap', style: 'gap:8px;margin-top:10px' },
      el('button', { class: 'btn primary', id: 'expCopy', onclick: async () => { try { await navigator.clipboard.writeText(text); toast('已複製'); } catch (_) { ta.select(); toast('請長按選取後複製', 2500); } } }, '複製'),
      el('a', { class: 'btn', id: 'expLine', href: 'https://line.me/R/share?text=' + encodeURIComponent(text.slice(0, 1800)), target: '_blank', rel: 'noopener noreferrer' }, '分享到 LINE'),
      navigator.share ? el('button', { class: 'btn', id: 'expShare', onclick: () => navigator.share({ text }).catch(() => { /* 取消 */ }) }, '其他分享') : null));
  });
}

// 試算每人應付:店家總額(選填)+ 運費/折扣 → order.apportion;負責人可存成本單總額
function splitScreen(cx, k, meta, orders, menu, title, day, isMgr) {
  pushScreen('試算每人應付', body => {
    const O = window.Order;
    const total = el('input', { type: 'number', id: 'spTotal', inputmode: 'numeric', min: 0, placeholder: '店家總額(沒填就用品項價格合計)' });
    const fee = el('input', { type: 'number', id: 'spFee', inputmode: 'numeric', placeholder: '運費/服務費(折扣請填負數)' });
    total.value = meta.shopTotal || ''; fee.value = meta.fee || '';
    const out = el('div', { id: 'spOut' });
    let last = null;
    const calc = () => {
      const t = Number(total.value) || O.grandTotal(orders);
      const a = O.apportion(orders, t, { fee: Number(fee.value) || 0 });
      last = a;
      if (!a.perPerson) { out.replaceChildren(el('div', { class: 'banner warn' }, a.error || '無法試算')); return; }
      out.replaceChildren(el('div', { class: 'card' }, el('b', {}, a.label + ' · 合計 $' + a.sum),
        a.perPerson.map(p => el('div', { class: 'tj-mem-row' }, el('span', { class: 'grow' }, p.display), el('span', { class: 'muted' }, p.cups + ' 份'), el('b', {}, '$' + p.amount))),
        a.notes.map(n => el('div', { class: 'muted small' }, '※ ' + n))),
        el('div', { class: 'row wrap', style: 'gap:8px' },
          el('button', { class: 'btn', id: 'spExport', onclick: () => textScreen('每人應付(給團員)', O.allocText(title, J().md(day) || '', orders, [menu], a)) }, '匯出每人應付'),
          isMgr ? el('button', { class: 'btn primary', id: 'spSave', onclick: () => act(() => ctx.jn.saveTotals(cx.jid, k, total.value, fee.value), '儲存中…', '已存成本單總額') }, '存成本單總額') : null));
    };
    total.oninput = calc; fee.oninput = calc;
    body.append(el('label', { class: 'f', for: 'spTotal' }, '店家總額'), total, el('label', { class: 'f', for: 'spFee' }, '運費/服務費'), fee, out);
    calc();
  });
}

function changeManager(cx, k, meta) {
  const L = J(), opts = L.leaderOptions(cx.state.members, cx.state.meta.ownerUid);
  openForm({
    title: '換負責人', fields: [{ key: 'uid', label: '負責人(可結單、解單、改品項)', type: 'select', value: meta.managerUid, options: opts.map(o => ({ value: o.uid, label: o.name })) }],
    onSave: v => ctx.jn.setManager(cx.jid, k, v.uid),
  });
}

// 品項編輯:每一項 品名/價格/備註;新增、編輯、刪除、上移/下移;貼上更多
function itemsScreen(cx, k, kind) {
  pushScreen('編輯品項', (body, entry) => {
    const MN = window.Menu;
    const cur = () => MN.normalize(((cx.mem.menu && cx.mem.menu.menus) || {}).m1 || {});
    const save = menu => act(() => ctx.jn.saveMenuItems(cx.jid, k, menu, kind), '儲存中…', '已儲存');
    const flat = menu => { const out = []; menu.categories.forEach((c, ci) => c.items.forEach((it, ii) => out.push({ ci, ii, it, cat: c.name }))); return out; };
    const draw = () => {
      const menu = cur(), list = flat(menu);
      body.replaceChildren(
        el('div', { class: 'muted small' }, '共 ' + list.length + ' 項(最多 ' + J().LIM.menuItems + ' 項)。價格空白=時價。'),
        el('div', { id: 'itList' }, list.map(x => el('div', { class: 'tj-mem-row', 'data-item': x.it.id },
          el('span', { class: 'grow' }, T(x.it.name) + (T(x.it.note) ? '(' + T(x.it.note) + ')' : '')), el('span', { class: 'muted' }, priceText(x.it)),
          manageRow({ open: cx.open, render: draw }, 'it' + x.it.id, [
            ['編輯', () => itemForm(x.it, v => { const m = cur(), it = findIt(m, x.it.id); if (!it) throw new Error('這個品項已被刪除'); Object.assign(it, v); return ctx.jn.saveMenuItems(cx.jid, k, m, kind); })],
            ['上移', () => { const m = cur(), c = m.categories[x.ci]; if (x.ii > 0) { [c.items[x.ii - 1], c.items[x.ii]] = [c.items[x.ii], c.items[x.ii - 1]]; save(m); } }],
            ['下移', () => { const m = cur(), c = m.categories[x.ci]; if (x.ii < c.items.length - 1) { [c.items[x.ii + 1], c.items[x.ii]] = [c.items[x.ii], c.items[x.ii + 1]]; save(m); } }],
            ['刪除', () => { if (!confirm('刪除「' + T(x.it.name) + '」?已點的單會保留。')) return; const m = cur(); m.categories[x.ci].items.splice(x.ii, 1); save(m); }, true]])))),
        el('div', { class: 'row wrap', style: 'gap:8px;margin-top:12px' },
          el('button', { class: 'big-btn primary', id: 'itAdd', onclick: () => itemForm(null, v => { const m = cur(); if (!m.categories.length) m.categories.push({ name: kind === 'general' ? '餐點' : '飲品', items: [] }); if (window.Menu.countItems(m) >= J().LIM.menuItems) throw new Error('品項最多 ' + J().LIM.menuItems + ' 個'); m.categories[m.categories.length - 1].items.push(Object.assign({ id: 'i' + Math.random().toString(36).slice(2, 8), prices: {}, temp: 'any' }, v)); return ctx.jn.saveMenuItems(cx.jid, k, m, kind); }) }, '＋ 新增品項'),
          el('button', { class: 'big-btn', id: 'itPaste', onclick: () => openForm({
            title: '貼上更多品項', fields: [{ key: 'text', label: '一行一個品項(例:紅茶 30)', type: 'textarea', rows: 8, required: true }],
            onSave: v => { const p = MN.parseText(v.text); if (!p.categories.length) throw new Error('沒有讀到品項'); const add = MN.fromParsed(p, ''); const m = cur(); add.categories.forEach(c => { const same = m.categories.find(x => x.name === c.name); if (same) same.items.push(...c.items); else m.categories.push(c); }); return ctx.jn.saveMenuItems(cx.jid, k, m, kind); },
          }) }, '📋 貼上更多')));
    };
    const findIt = (m, id) => { for (const c of m.categories) for (const it of c.items) if (it.id === id) return it; return null; };
    const itemForm = (it, onSave) => openForm({
      title: it ? '編輯品項' : '新增品項',
      fields: [{ key: 'name', label: '品名', value: it && it.name, max: J().LIM.itemName, required: true }, { key: 'price', label: '價格(空白=時價)', type: 'number', inputmode: 'numeric', value: it && it.price !== null && it.price !== undefined ? String(it.price) : '' }, { key: 'note', label: '備註(選填,例:大杯)', value: it && it.note, max: J().LIM.itemNote }],
      onSave: v => onSave({ name: v.name.trim(), price: v.price === '' ? null : Math.max(0, Math.round(Number(v.price) || 0)), note: v.note.trim() }),
    });
    entry.refresh = draw;
    cx.mem.onMenu = draw;   // 品項存好後 SSE 回來就重畫
    draw();
  }, () => { cx.mem.onMenu = null; });
}

/* ================= 照片 ================= */
// 縮圖:先看本機快取,缺的才一次 GET 這個事件的全部縮圖
async function loadThumbs(cx) {
  const L = J(), m = cx.mem, photos = ((cx.state.j.photos || {})[cx.eid]) || {};
  const need = Object.keys(photos).filter(i => photos[i] && photos[i].v && !m.thumbs[i + '/' + photos[i].v] && !m.thumbTried[cx.eid + '/' + i + '/' + photos[i].v]);
  if (!need.length || m.thumbBusy) return;
  m.thumbBusy = true;
  let changed = false;
  try {
    const miss = [];
    for (const i of need) {
      const rec = await DB.getImg(L.photoKey(cx.jid, cx.eid, i, photos[i].v, 't')).catch(() => null);
      if (rec && rec.b64) { m.thumbs[i + '/' + photos[i].v] = 'data:image/jpeg;base64,' + rec.b64; changed = true; } else miss.push(i);
    }
    if (miss.length && navigator.onLine !== false) {
      miss.forEach(i => { m.thumbTried[cx.eid + '/' + i + '/' + photos[i].v] = 1; });
      const all = (await ctx.jn.getThumbs(cx.jid, cx.eid).catch(() => null)) || {};
      for (const i of miss) {
        const t = all[i] && all[i].t;
        if (!t) continue;
        m.thumbs[i + '/' + photos[i].v] = 'data:image/jpeg;base64,' + t; changed = true;
        DB.putImg({ k: L.photoKey(cx.jid, cx.eid, i, photos[i].v, 't'), b64: t, at: Date.now() }).catch(() => { /* 快取失敗不影響 */ });
      }
    }
  } finally { m.thumbBusy = false; }
  if (changed) cx.render();
}

// 壓縮:縮圖(長邊 320、q0.6)+ 大圖(長邊 1280、q0.7,太大就降級);逐張處理、用完立刻釋放
async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (_) {
    const url = URL.createObjectURL(file);
    try { return await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('讀不到這張照片')); im.src = url; }); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  }
}
function encode(bmp, w0, h0, step) {
  const s = J().fitScale(w0, h0, step.long), c = document.createElement('canvas');
  c.width = s.w; c.height = s.h;
  c.getContext('2d').drawImage(bmp, 0, 0, s.w, s.h);
  const b64 = c.toDataURL('image/jpeg', step.q).replace(/^data:image\/jpeg;base64,/, '');
  c.width = c.height = 0;
  return { b64, w: s.w, h: s.h };
}
export async function compressPhoto(file) {
  const L = J(), bmp = await loadBitmap(file);
  try {
    const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight;
    let t = null, d = null;
    for (const st of L.THUMB_STEPS) { t = encode(bmp, w0, h0, st); if (L.validB64(t.b64, L.LIM.thumbB64)) break; }
    for (let i = 0; i < L.FULL_STEPS.length; i++) { d = encode(bmp, w0, h0, L.FULL_STEPS[i]); if (L.fullOk(d.b64, i)) break; }
    if (!L.validB64(t.b64, L.LIM.thumbB64) || !L.validB64(d.b64, L.LIM.fullB64)) throw new Error('這張照片無法壓縮,請換一張');
    return { w: d.w, h: d.h, t: t.b64, d: d.b64, size: Math.round((t.b64.length + d.b64.length) * 0.75) };
  } finally { if (bmp.close) bmp.close(); }
}

function uploadPhotos(cx, files) {
  const L = J(), room = L.photoRoom(cx.state.j.photos, cx.eid);
  if (room <= 0) { toast(L.countPhotos(cx.state.j.photos) >= L.LIM.photosPerJournal ? '這本日誌照片已達 ' + L.LIM.photosPerJournal + ' 張,請刪掉一些或改貼雲端硬碟連結' : '這個事件的照片已達上限', 3500); return; }
  const list = files.slice(0, room);
  if (files.length > room) toast('這次只能再加 ' + room + ' 張,其他的沒有上傳', 3000);
  const jobs = list.map(f => ({ f, slot: {}, done: false, err: null }));
  const known = Object.assign({}, ((cx.state.j.photos || {})[cx.eid]) || {});
  const total = jobs.length;
  act(async () => {
    let n = jobs.filter(x => x.done).length;
    for (const job of jobs) {
      if (job.done) continue;
      busy.setText('上傳中 ' + (n + 1) + '/' + total);
      try {
        if (!job.p) job.p = await compressPhoto(job.f);
        job.slot.cur = job.slot.cur || known;
        const id = await ctx.jn.addPhoto(cx.jid, cx.eid, job.p, job.slot);
        known[id] = { order: job.slot.order, v: job.slot.v };
        cx.mem.thumbs[id + '/' + job.slot.v] = 'data:image/jpeg;base64,' + job.p.t;
        DB.putImg({ k: L.photoKey(cx.jid, cx.eid, id, job.slot.v, 't'), b64: job.p.t, at: Date.now() }).catch(() => { /* 略過 */ });
        DB.putImg({ k: L.photoKey(cx.jid, cx.eid, id, job.slot.v, 'f'), b64: job.p.d, at: Date.now() }).catch(() => { /* 略過 */ });
        job.done = true; job.p = null; n++;
      } catch (e) {
        if (e && (e.code === 'NOT_READY' || e.code === 'FULL')) throw e;   // 不能重試的錯誤
        job.err = e;
      }
    }
    const bad = jobs.filter(x => !x.done).length;
    if (bad) { const e = new Error('有 ' + bad + ' 張沒有上傳成功(已完成 ' + n + ' 張),按「重試」再傳剩下的'); e.code = 'NETWORK'; throw e; }
    return n;
  }, '上傳中 1/' + total, null, { timeoutMs: 30000 + total * 60000 }).then(r => {
    const n = jobs.filter(x => x.done).length;
    if (r.ok) toast('已加入 ' + n + ' 張');
    else if (n) toast('已加入 ' + n + ' 張', 2500);
    cx.render();
  });
}

// 全螢幕看大圖:左右滑或按 ‹ ›;編輯者可改說明、排序、刪除;儲存到手機
function openViewer(cx, photos, start) {
  pushScreen('照片', (body, entry) => {
    const L = J();
    let i = start;
    entry.s.classList.add('tj-viewer');
    const img = el('img', { id: 'pvImg', alt: '' });
    const stage = el('div', { class: 'tj-pv-stage' }, img);
    const info = el('div', { class: 'tj-pv-info' });
    const show = async () => {
      const list = L.sortedList(((cx.state.j.photos || {})[cx.eid]) || {});
      if (!list.length) { popScreen(); return; }
      const p = list[Math.min(i, list.length - 1)]; i = list.indexOf(p);
      const tk = cx.mem.thumbs[p.id + '/' + p.v];
      img.src = tk || ''; img.alt = T(p.cap) || '照片 ' + (i + 1);
      info.replaceChildren(el('div', { class: 'tj-pv-cap', id: 'pvCap' }, (i + 1) + ' / ' + list.length + (T(p.cap) ? ' · ' + T(p.cap) : '')),
        el('div', { class: 'row wrap', style: 'gap:8px;justify-content:center' },
          el('button', { class: 'btn', id: 'pvPrev', disabled: i === 0, onclick: () => { i--; show(); } }, '‹ 上一張'),
          el('button', { class: 'btn', id: 'pvNext', disabled: i === list.length - 1, onclick: () => { i++; show(); } }, '下一張 ›'),
          el('button', { class: 'btn', id: 'pvSave', onclick: () => savePhoto(p, i) }, '儲存到手機')),
        cx.canEdit ? el('div', { class: 'row wrap', style: 'gap:8px;justify-content:center;margin-top:8px' },
          el('button', { class: 'btn', id: 'pvCapEdit', onclick: () => openForm({ title: '照片說明', fields: [{ key: 'cap', label: '說明(選填)', value: p.cap, max: L.LIM.photoCap }], onSave: v => ctx.jn.setPhotoCap(cx.jid, cx.eid, p.id, v.cap) }) }, '說明'),
          el('button', { class: 'btn', id: 'pvUp', disabled: i === 0, onclick: async () => { const r = await act(() => ctx.jn.moveItem(cx.jid, 'photos/' + cx.eid, (cx.state.j.photos || {})[cx.eid], p.id, 'up'), '移動中…'); if (r.ok) { i--; setTimeout(show, 300); } } }, '往前'),
          el('button', { class: 'btn', id: 'pvDown', disabled: i === list.length - 1, onclick: async () => { const r = await act(() => ctx.jn.moveItem(cx.jid, 'photos/' + cx.eid, (cx.state.j.photos || {})[cx.eid], p.id, 'down'), '移動中…'); if (r.ok) { i++; setTimeout(show, 300); } } }, '往後'),
          el('button', { class: 'btn danger', id: 'pvDel', onclick: async () => { if (!confirm('刪除這張照片?')) return; const r = await act(() => ctx.jn.deletePhoto(cx.jid, cx.eid, p.id), '刪除中…', '已刪除'); if (r.ok) setTimeout(show, 300); } }, '刪除')) : null);
      const full = await getFull(cx, p);
      if (full && img.alt === (T(p.cap) || '照片 ' + (i + 1))) img.src = full;
    };
    const savePhoto = async (p, n) => {
      const full = await getFull(cx, p);
      if (!full) { toast('還沒讀到大圖,請稍後再試', 2500); return; }
      const blob = await (await fetch(full)).blob(), name = '照片' + (n + 1) + '.jpg';
      const file = typeof File === 'function' ? new File([blob], name, { type: 'image/jpeg' }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file] }).catch(() => { /* 取消 */ }); return; }
      const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
    };
    let x0 = null;
    stage.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', e => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      const n = L.sortedList(((cx.state.j.photos || {})[cx.eid]) || {}).length;
      if (dx < -50 && i < n - 1) { i++; show(); } else if (dx > 50 && i > 0) { i--; show(); }
    });
    entry.refresh = show;
    body.append(stage, info);
    show();
  });
}
async function getFull(cx, p) {
  const L = J(), key = L.photoKey(cx.jid, cx.eid, p.id, p.v, 'f');
  const rec = await DB.getImg(key).catch(() => null);
  if (rec && rec.b64) return 'data:image/jpeg;base64,' + rec.b64;
  try {
    const d = await ctx.jn.getFull(cx.jid, cx.eid, p.id);
    if (!d) return null;
    DB.putImg({ k: key, b64: d, at: Date.now() }).catch(() => { /* 略過 */ });
    return 'data:image/jpeg;base64,' + d;
  } catch (_) { return null; }
}
