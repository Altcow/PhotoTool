// 點餐房間畫面:發起人(團資訊/顧客清單/店員清單/點餐)與點餐者(點餐/我的訂單/大家的清單)
// 與 app.js 循環匯入:只在函式內使用
import * as DB from './db.js';
import { el, today, pad2, pushScreen, popScreen, getSettings } from './app.js';
import { getNet, roomUrl } from './netctx.js';
import { STATUS_TEXT } from './net.js';
import { exportSheet } from './ui_export.js';

const { Menu, Order, QR, Sheets } = window;
const fmtTime = ms => { const d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
const bigBtn = (icon, text, onclick, cls, id) => el('button', { class: 'big-btn ' + (cls || ''), id, onclick }, el('span', { class: 'bi' }, icon), el('span', { class: 'bt' }, text));
const money = n => '$' + Order.toInt(n);
function clientId() {
  let id = '';
  try { id = localStorage.getItem('pt_client_id') || ''; if (!id) { id = 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem('pt_client_id', id); } } catch (_) { id = id || 'c' + Math.random().toString(36).slice(2, 10); }
  return id;
}
const loadName = fallback => { try { return localStorage.getItem('pt_order_name') || fallback || ''; } catch (_) { return fallback || ''; } };
const saveName = n => { try { localStorage.setItem('pt_order_name', n); } catch (_) { /* 不影響點餐 */ } };

/* ---------- 複製 / 分享 ---------- */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); alert('已複製'); return; } catch (_) { /* 改手動 */ }
  pushScreen('複製文字', body => {
    const ta = el('textarea', { rows: 12, readonly: true, id: 'copyFallback' }); ta.value = text;
    body.append(el('div', { class: 'muted' }, '自動複製失敗,請長按全選後手動複製。'), ta);
    setTimeout(() => { ta.focus(); ta.select(); }, 50);
  });
}
export async function shareText(text, title) {
  if (navigator.share) { try { await navigator.share({ text, title }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  await copyText(text);
}

/* ---------- QR ---------- */
function qrCanvas(text) {
  try {
    const m = QR.matrix(text), q = 3, n = m.length, s = Math.max(3, Math.floor(280 / (n + 2 * q)));
    const c = document.createElement('canvas'); c.width = c.height = (n + 2 * q) * s; c.className = 'qr';
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
    m.forEach((row, y) => row.forEach((d, x) => { if (d) g.fillRect((x + q) * s, (y + q) * s, s, s); }));
    return c;
  } catch (e) { return el('div', { class: 'muted' }, 'QR 無法產生(連結太長),請改用「分享連結」。'); }
}

/* ---------- 進入點 ---------- */
export async function openRoomJoin({ code, db, mock }) {
  let ctx;
  try { ctx = getNet({ db, mock }); } catch (e) { alert(e.message); return; }
  let jr;
  try { jr = await ctx.net.joinRoom(code); } catch (e) { alert(e.message || '無法加入'); return; }
  openRoomView({ role: 'customer', code, ctx, token: null, first: jr });
}
export function openRoomHost(rec) {
  let ctx;
  try { ctx = getNet({ db: rec.dbUrl, mock: rec.mock }); } catch (e) { alert(e.message); return; }
  openRoomView({ role: 'host', code: rec.code, ctx, token: rec.hostToken, rec });
}

/* ---------- 房間主畫面 ---------- */
function openRoomView(o) {
  const { net } = o.ctx, host = o.role === 'host', me = clientId();
  let st = o.first ? { exists: true, meta: o.first.meta, menus: o.first.menus, orders: [], status: o.first.status } : null;
  let tab = host ? 'info' : 'menu', netMsg = '', unsub = null;
  let q = '', secKey = null, clerkSort = 'name', byGroup = true, nameVal = loadName(host ? (o.rec && o.rec.hostName) || getSettings().myName : '');
  const expanded = new Set();
  let itemsRedraw = null, lastAlloc = null;
  let content, tabsBar, banner, listBox = null, stickBox = null;
  const menusN = () => {
    const ids = String((st.meta && st.meta.menuIds) || '').split(',').filter(Boolean);
    const ms = st.menus.map(Menu.normalize);
    return ms.sort((a, b) => { const ia = ids.indexOf(a.id), ib = ids.indexOf(b.id); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
  };
  const isOpen = () => st && st.status === 'open';
  const mine = () => st.orders.filter(x => x.clientId === me);
  const title = () => (st && st.meta && st.meta.title) || '點餐';
  const dateStr = () => { const d = st && st.meta && st.meta.plannedAt ? new Date(st.meta.plannedAt) : new Date(); return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()); };

  const TABS = host ? [['info', '🏠', '團資訊'], ['all', '📋', '顧客'], ['clerk', '🧾', '店員'], ['menu', '🍹', '點餐'], ['mine', '🙋', '我的']] : [['menu', '🍹', '點餐'], ['mine', '🙋', '我的訂單'], ['all', '📋', '大家的']];

  const infoLine = () => {
    const m = st.meta || {};
    return el('div', { class: 'info-line', id: 'roomInfo' },
      el('b', {}, m.title || ''),
      el('span', { class: 'muted' }, [m.plannedAt ? '🕒 ' + fmtTime(m.plannedAt) : '', m.location ? '📍 ' + m.location : '', m.hostName ? '👤 ' + m.hostName : '', m.deadline ? '⏰ 截止 ' + fmtTime(m.deadline) : ''].filter(Boolean).join('  ')));
  };

  /* --- 點餐頁 --- */
  function sectionsNow() { return Menu.sections(menusN(), (st.meta && st.meta.mergeMode) || 'separate'); }
  function priceTags(it) {
    const keys = Object.keys(it.prices || {});
    if (!keys.length) return [el('span', { class: 'pr' }, it.price != null ? '$' + it.price : '—')];
    const ordered = keys.slice().sort((a, b) => 0);
    const out = ordered.map(k => el('span', { class: 'pr' }, el('i', {}, k), it.prices[k]));
    return out;
  }
  function drawMenuList() {
    if (!listBox) return;
    const secs = sectionsNow();
    if (!secs.length) { listBox.replaceChildren(el('div', { class: 'empty' }, '這個團沒有菜單')); return; }
    if (!secs.find(s => s.key === secKey)) secKey = secs[0].key;
    const sec = secs.find(s => s.key === secKey), qq = q.trim().toLowerCase();
    stickBox.replaceChildren();
    if (secs.length > 1) stickBox.append(el('div', { class: 'chips nowrap', id: 'shopTabs' }, secs.map(s => el('button', { class: 'chip' + (s.key === secKey ? ' on' : ''), 'data-sec': s.key, onclick: () => { secKey = s.key; drawMenuList(); } }, s.title))));
    const cats = sec.categories.map(c => ({ name: c.name, items: c.items.filter(i => !qq || (i.name + ' ' + (i.shop || '')).toLowerCase().includes(qq)) })).filter(c => c.items.length);
    if (cats.length > 1) stickBox.append(el('div', { class: 'chips nowrap', id: 'catChips' }, cats.map((c, i) => el('button', { class: 'chip', onclick: () => { const t = listBox.querySelector('[data-cat="' + i + '"]'); if (t) t.scrollIntoView({ block: 'start' }); } }, c.name))));
    listBox.replaceChildren();
    if (!cats.length) listBox.append(el('div', { class: 'empty' }, qq ? '沒有符合的品項' : '這份菜單沒有品項'));
    cats.forEach((c, ci) => {
      listBox.append(el('div', { class: 'cat-h', 'data-cat': ci }, c.name));
      const grid = el('div', { class: 'mlist' });
      c.items.forEach(it => grid.append(el('div', { class: 'mrow' + (isOpen() ? '' : ' off'), role: 'button', tabindex: 0, 'data-item': it.id, onclick: () => pickItem(it) },
        el('span', { class: 'nm' }, it.name, it.own ? el('em', {}, '自加') : null, it.temp === 'hot' ? el('em', {}, '熱') : null, it.temp === 'cold' ? el('em', {}, '冰') : null, sec.menuId === null ? el('small', {}, Order.shopTag(it.shop)) : null),
        el('span', { class: 'prs' }, priceTags(it)))));
      listBox.append(grid);
    });
    const h = stickBox.offsetHeight; content.style.setProperty('--stick-h', h + 'px');
  }
  function pickItem(it) {
    if (!isOpen()) { alert(STATUS_TEXT[st.status] || '目前不能點餐'); return; }
    const name = nameVal.trim();
    if (!name) { alert('請先輸入你的名字'); const n = document.getElementById('nameIn'); if (n) n.focus(); return; }
    const menu = menusN().find(m => m.id === (it.menuId || m.id) && Order.findItem(m, it.id));
    openOptions({ menu, item: menu ? Order.findItem(menu, it.id) : it, existing: null });
  }
  function openOptions({ menu, item, existing }) {
    pushScreen(item.name, body => {
      const sizes = Menu.sizeChoices(menu, item), ices = Menu.iceChoices(menu, item), sugars = menu.sugar || [];
      const sel = { size: existing ? existing.size : (sizes[0] || ''), ice: existing ? existing.ice : (ices[0] || ''), sugar: existing ? existing.sugar : (sugars[0] || ''), tops: new Set(existing ? existing.toppings || [] : []), qty: existing ? Order.cups(existing) : 1, note: existing ? existing.note || '' : '' };
      const price = el('div', { class: 'opt-price', id: 'optPrice' });
      const groups = el('div', { class: 'opt-groups' });
      const group = (label, list, key) => list.length ? el('div', { class: 'opt-g' }, el('div', { class: 'opt-l' }, label), el('div', { class: 'opt-chips' }, list.map(v => el('button', { class: 'opt-chip' + (sel[key] === v ? ' on' : ''), 'data-opt': key, onclick: () => { sel[key] = v; drawAll(); } }, v)))) : null;
      const unit = () => Order.unitPrice(menu, item.id, sel.size, [...sel.tops]);
      const add = bigBtn('✅', existing ? '儲存修改' : '加入', async () => {
        const up = unit();
        const o2 = Object.assign({}, existing || {}, { clientId: me, name: nameVal.trim(), menuId: menu.id, itemId: item.id, itemName: item.name, size: sel.size, ice: sel.ice, sugar: sel.sugar, toppings: [...sel.tops], qty: sel.qty, unitPrice: up, note: sel.note.trim().slice(0, 100) });
        const errs = Order.validateOrder(o2);
        if (errs.length) { alert(errs.join('\n')); return; }
        add.disabled = true;
        try { await net.putOrder(o.code, o2); popScreen(); } catch (e) { alert('送出失敗:' + (e.message || e)); add.disabled = false; }
      }, 'primary', 'optAdd');
      const note = el('input', { type: 'text', id: 'optNote', maxlength: 100, placeholder: '備註(選填)', value: sel.note, oninput: e => { sel.note = e.target.value; } });
      function drawAll() {
        const up = unit();
        price.textContent = up === null ? '價格待補(不影響點餐,之後依店家總額分攤)' : money(up) + ' × ' + sel.qty + ' = ' + money(up * sel.qty);
        groups.replaceChildren(...[group('尺寸', sizes, 'size'), group('冰度', ices, 'ice'), group('糖度', sugars, 'sugar'),
          (menu.toppings || []).length ? el('div', { class: 'opt-g' }, el('div', { class: 'opt-l' }, '加料'), el('div', { class: 'opt-chips' }, menu.toppings.map(t => el('button', { class: 'opt-chip' + (sel.tops.has(t.name) ? ' on' : ''), 'data-opt': 'top', onclick: () => { if (sel.tops.has(t.name)) sel.tops.delete(t.name); else sel.tops.add(t.name); drawAll(); } }, t.name + (t.price ? ' +' + t.price : ''))))) : null,
          el('div', { class: 'opt-g' }, el('div', { class: 'opt-l' }, '杯數'), el('div', { class: 'qty' }, el('button', { class: 'qbtn', id: 'qtyMinus', 'aria-label': '減少', onclick: () => { sel.qty = Math.max(1, sel.qty - 1); drawAll(); } }, '−'), el('b', { id: 'qtyVal' }, sel.qty), el('button', { class: 'qbtn', id: 'qtyPlus', 'aria-label': '增加', onclick: () => { sel.qty = Math.min(20, sel.qty + 1); drawAll(); } }, '+')))].filter(Boolean));
      }
      drawAll();
      body.append(el('div', { class: 'two-col opt-wrap' }, groups, el('div', {}, note, price, add)));
    });
  }
  function menuTab() {
    const nameIn = el('input', { type: 'text', id: 'nameIn', maxlength: 30, placeholder: '你的名字', value: nameVal, oninput: e => { nameVal = e.target.value; saveName(nameVal); } });
    const search = el('input', { type: 'search', id: 'menuSearch', placeholder: '搜尋品項', value: q, oninput: e => { q = e.target.value; drawMenuList(); } });
    stickBox = el('div', { class: 'stick' }); listBox = el('div', { id: 'menuList' });
    const saveBtn = el('button', { class: 'btn sm', id: 'saveMenus', onclick: async () => { for (const m of menusN()) { const c = Menu.clone(m); c.id = Menu.rid('m'); c.updatedAt = Date.now(); await DB.putMenu(Menu.normalize(c)); } alert('已存到「我的菜單」'); } }, '存到我的菜單');
    content.replaceChildren(el('div', { class: 'menu-top' }, el('div', { class: 'name-row' }, el('span', { class: 'muted' }, '名字'), nameIn), search), stickBox, listBox, el('div', { class: 'tail-act' }, saveBtn));
    drawMenuList();
  }

  /* --- 我的訂單 --- */
  function mineTab() {
    const list = mine();
    content.replaceChildren();
    if (!list.length) { content.append(el('div', { class: 'empty' }, '還沒有點餐,到「點餐」選飲料')); return; }
    const ms = menusN(), multi = ms.length > 1;
    const box = el('div', { class: 'olist', id: 'mineList' });
    list.forEach((x, i) => box.append(orderRow(x, i + 1, multi ? Order.shopTag((Order.findMenu(ms, x.menuId) || {}).shop) : '', {
      canEdit: isOpen(), onEdit: () => { const menu = Order.findMenu(ms, x.menuId), item = menu && Order.findItem(menu, x.itemId); if (!item) { alert('這個品項已被發起人移除,只能刪除'); return; } openOptions({ menu, item, existing: x }); },
      onDelete: async () => { if (!confirm('刪除「' + Order.optionLabel(x) + '」?')) return; try { await net.deleteOrder(o.code, x.id, { clientId: me }); } catch (e) { alert(e.message); } } })));
    content.append(box, el('div', { class: 'total-row' }, el('span', {}, Order.cupCount(list) + ' 杯'), el('b', { id: 'mineTotal' }, list.some(x => !Order.hasPrice(x)) ? '金額待補' : '小計 ' + money(Order.grandTotal(list)))));
    if (!isOpen()) content.prepend(el('div', { class: 'banner' }, STATUS_TEXT[st.status] + ',只能查看'));
  }
  function orderRow(x, n, tag, act) {
    return el('div', { class: 'orow', 'data-oid': x.id },
      el('span', { class: 'no' }, n + '.'),
      el('span', { class: 'ol' }, tag ? el('small', {}, tag) : null, Order.optionLabel(x), x.note ? el('em', {}, '(' + x.note + ')') : null),
      el('span', { class: 'oq' }, '×' + Order.cups(x)), el('span', { class: 'op' }, Order.hasPrice(x) ? money(Order.lineTotal(x)) : '待補'),
      act ? el('span', { class: 'oa' }, act.canEdit && act.onEdit ? el('button', { class: 'btn sm', 'aria-label': '修改', onclick: act.onEdit }, '改') : null, act.canDelete !== false && act.onDelete ? el('button', { class: 'btn sm danger', 'aria-label': '刪除', onclick: act.onDelete }, '✕') : null) : null);
  }

  /* --- 顧客清單 --- */
  function allTab() {
    const ms = menusN(), multi = ms.length > 1, ps = Order.people(st.orders);
    content.replaceChildren();
    const text = Order.customerText(title(), dateStr(), st.orders, ms);
    const box = el('div', { class: 'olist cust', id: 'custList' });
    if (!ps.length) box.append(el('div', { class: 'empty' }, '還沒有人點餐'));
    ps.forEach(p => {
      box.append(el('div', { class: 'ph' }, el('span', {}, p.display), el('span', { class: 'ps' }, p.cups + '杯 ' + (p.unpricedCups ? '金額待補' : '共' + money(p.total)))));
      p.orders.forEach((x, i) => box.append(orderRow(x, i + 1, multi ? Order.shopTag((Order.findMenu(ms, x.menuId) || {}).shop) : '', host && isOpen() ? { onDelete: async () => { if (!confirm('刪除 ' + p.display + ' 的「' + Order.optionLabel(x) + '」?')) return; try { await net.deleteOrder(o.code, x.id, { clientId: me, hostToken: o.token }); } catch (e) { alert(e.message); } } } : null)));
    });
    content.append(box, el('div', { class: 'total-row big' }, el('span', {}, '共 ' + Order.cupCount(st.orders) + ' 杯'), el('b', { id: 'grandTotal' }, '合計 ' + money(Order.grandTotal(st.orders)) + (st.orders.some(x => !Order.hasPrice(x)) ? '(另有價格待補)' : ''))),
      el('div', { class: 'act-row' }, bigBtn('📋', '複製文字', () => copyText(text), 'primary', 'copyCust'), bigBtn('📤', '分享', () => shareText(text, title()), '', 'shareCust')),
      host ? el('div', { class: 'card', id: 'apportionCard' }, el('b', {}, '事後輸入店家報的總金額'), el('div', { class: 'muted small' }, '菜單沒標價、或想依店家總額分攤時用。結單前後都可以。'), lastAlloc && lastAlloc.ok ? el('div', { class: 'banner', id: 'allocLabel' }, '目前顯示:' + lastAlloc.label + '(總額 $' + lastAlloc.total + ')') : null, bigBtn('💰', '輸入店家總額分攤', () => openApportion(), 'primary sm', 'btnApportion')) : null,
      exportSheet(() => Sheets.customer(title(), dateStr(), st.orders, menusN(), lastAlloc && lastAlloc.ok ? lastAlloc : null)));
  }

  /* --- 店員清單(發起人) --- */
  function clerkTab() {
    const ms = menusN();
    content.replaceChildren();
    const ctl = el('div', { class: 'chips', id: 'clerkCtl' },
      [['name', '品名'], ['temp', '冷熱'], ['count', '杯數']].map(([k, l]) => el('button', { class: 'chip' + (clerkSort === k ? ' on' : ''), 'data-sort': k, onclick: () => { clerkSort = k; clerkTab(); } }, '排序:' + l)),
      el('button', { class: 'chip' + (byGroup ? ' on' : ''), id: 'clerkGroupBtn', onclick: () => { byGroup = !byGroup; clerkTab(); } }, '依冷熱分組'));
    content.append(ctl);
    const parts = Order.clerkTexts(ms, st.orders, clerkSort, byGroup);
    if (!parts.length || !st.orders.length) { content.append(el('div', { class: 'empty' }, '還沒有訂單')); return; }
    const wrap = el('div', { class: 'clerk-wrap' });
    parts.forEach(pt => {
      const sec = el('div', { class: 'clerk-sec', 'data-menu': pt.menuId });
      sec.append(el('div', { class: 'clerk-h' }, el('b', {}, pt.shop), el('span', { class: 'muted' }, '共 ' + pt.count + ' 杯')));
      const rows = Order.clerkList(pt.orders, clerkSort);
      const rowEl = r => {
        const k = pt.menuId + '|' + r.key;
        const line = el('div', { class: 'crow', role: 'button', tabindex: 0, 'data-label': r.label, onclick: () => { if (expanded.has(k)) expanded.delete(k); else expanded.add(k); clerkTab(); } },
          el('span', { class: 'cl' }, r.label), el('span', { class: 'cn' }, r.count));
        const out = [line];
        if (expanded.has(k)) out.push(el('div', { class: 'cwho' }, r.who.map(w => w.display + (w.count > 1 ? '×' + w.count : '')).join('、')));
        return out;
      };
      if (byGroup) Order.clerkGroups(rows).forEach(g => { sec.append(el('div', { class: 'cg' }, el('span', {}, g.group), el('span', {}, g.count + ' 杯'))); g.rows.forEach(r => sec.append(...rowEl(r))); });
      else rows.forEach(r => sec.append(...rowEl(r)));
      sec.append(bigBtn('📋', ms.length > 1 ? '複製「' + Order.shopTag(pt.shop) + '」店員文字' : '複製店員文字', () => copyText(pt.text), 'primary', 'copyClerk'));
      wrap.append(sec);
    });
    content.append(wrap, el('div', { class: 'muted small' }, '點一列可展開是誰點的;複製的文字不含名字。'), exportSheet(() => Sheets.clerk(menusN(), st.orders, clerkSort, byGroup, title())));
  }

  /* --- 團資訊(發起人) --- */
  function infoTab() {
    const url = roomUrl(o.code, o.ctx), m = st.meta;
    content.replaceChildren(infoLine(),
      o.ctx.mode === 'mock' ? el('div', { class: 'banner warn', id: 'mockNote' }, '單機預覽(測試模式):只有這支手機看得到,朋友連不進來。') : null,
      el('div', { class: 'big-code', id: 'roomCode' }, o.code),
      el('div', { class: 'chips' }, el('span', { class: 'tag ' + (isOpen() ? 'ok' : 'warn'), id: 'roomStatus' }, STATUS_TEXT[st.status] || st.status), el('span', { class: 'muted' }, Order.cupCount(st.orders) + ' 杯 · ' + Order.people(st.orders).length + ' 人 · ' + money(Order.grandTotal(st.orders)))),
      el('input', { type: 'text', readonly: true, id: 'roomLink', value: url, onfocus: e => e.target.select() }),
      el('div', { class: 'big-grid' },
        bigBtn('📤', '分享連結', () => { const t = '來點餐:' + m.title; if (navigator.share) navigator.share({ url, text: t, title: m.title }).catch(e => { if (e && e.name !== 'AbortError') copyText(url); }); else copyText(url); }, 'primary', 'shareLink'),
        bigBtn('🔗', '複製連結', () => copyText(url), '', 'copyLink'),
        bigBtn('🔳', '顯示 QR', () => { if (qrBox.firstChild) qrBox.replaceChildren(); else qrBox.replaceChildren(qrCanvas(url)); }, '', 'showQr'),
        bigBtn('✏️', '修改團資訊', () => openEditMeta(), '', 'editMeta'),
        bigBtn('➕', '補品項', () => openHostItems(), '', 'hostItems'),
        bigBtn('🔒', '結單', async () => { if (!isOpen()) return; if (!confirm('結單後所有人都不能再點餐或修改,確定結單?')) return; try { await net.closeRoom(o.code, o.token); } catch (e) { alert(e.message); } }, 'danger', 'closeRoom')),
      qrBox);
  }
  const qrBox = el('div', { class: 'qr-box', id: 'qrBox' });

  function openEditMeta() {
    if (!isOpen()) { alert('結單後不能再修改'); return; }
    const m = st.meta;
    const toLocal = ms => { const d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
    pushScreen('修改團資訊', body => {
      const title = el('input', { type: 'text', id: 'emTitle', maxlength: 80, value: m.title || '' });
      const loc = el('input', { type: 'text', id: 'emLocation', maxlength: 120, value: m.location || '' });
      const planned = el('input', { type: 'datetime-local', id: 'emPlanned', value: m.plannedAt ? toLocal(m.plannedAt) : '' });
      const deadline = el('input', { type: 'datetime-local', id: 'emDeadline', value: m.deadline ? toLocal(m.deadline) : '' });
      body.append(el('label', { class: 'f' }, '團名'), title, el('label', { class: 'f' }, '地點'), loc, el('label', { class: 'f' }, '計畫時間'), planned, el('label', { class: 'f' }, '截止下單時間(留空=不設)'), deadline,
        el('div', { class: 'muted small' }, '儲存後會即時同步給所有點餐者。'),
        bigBtn('💾', '儲存', async () => {
          if (!title.value.trim()) { alert('團名不可空白'); return; }
          try {
            await net.updateMeta(o.code, { title: title.value.trim(), location: loc.value.trim(), plannedAt: planned.value ? new Date(planned.value).getTime() : null, deadline: deadline.value ? new Date(deadline.value).getTime() : null }, o.token);
            popScreen();
          } catch (e) { alert('修改失敗:' + (e.message || e)); }
        }, 'primary', 'emSave'));
    });
  }

  // 事後輸入店家報的總金額:有價格的照價,沒價格的杯數均分剩餘金額;全沒價格依杯數;可加運費/服務費(整數)
  function openApportion() {
    pushScreen('輸入店家總額', body => {
      const total = el('input', { type: 'number', inputmode: 'numeric', id: 'apTotal', placeholder: '店家報的總金額(元)', value: lastAlloc && lastAlloc.shopTotal ? lastAlloc.shopTotal : '' });
      const fee = el('input', { type: 'number', inputmode: 'numeric', id: 'apFee', placeholder: '運費/服務費(選填,整數)', value: lastAlloc && lastAlloc.fee ? lastAlloc.fee : '' });
      const out = el('div', { id: 'apOut' });
      const compute = () => {
        out.replaceChildren();
        const tv = Math.round(Number(total.value) || 0), fv = Math.round(Number(fee.value) || 0);
        if (!tv) { lastAlloc = null; out.append(el('div', { class: 'muted' }, '輸入總金額後,這裡會列出每個人要付多少。')); return; }
        const r = Order.apportion(st.orders, tv, { fee: fv });
        if (!r.ok) { lastAlloc = null; out.append(el('div', { class: 'banner warn', id: 'apError' }, r.error || '無法分攤')); return; }
        lastAlloc = r;
        out.append(el('div', { class: 'banner', id: 'apLabel' }, r.label + ' · 總額 $' + r.total), el('div', { class: 'olist' }, r.perPerson.map(p => el('div', { class: 'orow' }, el('span', { class: 'no' }, '•'), el('span', { class: 'ol' }, p.display), el('span', { class: 'oq' }, p.cups + ' 杯'), el('span', { class: 'op' }, money(p.amount))))),
          el('div', { class: 'muted small' }, r.notes.map(n => '※ ' + n).join('\n')),
          el('div', { class: 'act-row' }, bigBtn('📋', '複製文字', () => copyText(Order.allocText(title(), dateStr(), st.orders, menusN(), r)), 'primary', 'apCopy')),
          exportSheet(() => Sheets.customer(title(), dateStr(), st.orders, menusN(), lastAlloc && lastAlloc.ok ? lastAlloc : r)));
      };
      total.addEventListener('input', compute); fee.addEventListener('input', compute);
      body.append(el('label', { class: 'f' }, '店家報的總金額'), total, el('label', { class: 'f' }, '運費/服務費(選填)'), fee, el('div', { class: 'muted small' }, '有標價的杯照價;沒標價的杯子均分剩下的金額;全部沒標價就依杯數分攤。杯數分攤不套用小孩計費權重。'), out);
      compute();
    }, () => { if (tab === 'all') render(); });
  }

  function openHostItems() {
    if (!isOpen()) { alert('結單後不能再改菜單'); return; }
    pushScreen('補品項', (body, entry) => {
      let mi = 0;
      const draw = () => {
        const ms = menusN(); if (!ms.length) return;
        if (mi >= ms.length) mi = 0;
        const m = ms[mi];
        const orderedCount = id => st.orders.filter(x => x.itemId === id && (!x.menuId || x.menuId === m.id)).reduce((a, x) => a + Order.cups(x), 0);
        const push = async mm => { try { await net.putMenu(o.code, mm, o.token); } catch (e) { alert(e.message); } };
        const catSel = el('select', { id: 'hiCat' }, m.categories.map(c => el('option', { value: c.name }, c.name)), el('option', { value: '__new' }, '＋ 新分類'));
        const catNew = el('input', { type: 'text', id: 'hiCatNew', placeholder: '新分類名稱', class: 'hidden' });
        catSel.onchange = () => catNew.classList.toggle('hidden', catSel.value !== '__new');
        if (!m.categories.length) { catSel.value = '__new'; catNew.classList.remove('hidden'); }
        const nm = el('input', { type: 'text', id: 'hiName', placeholder: '品名' }), pr = el('input', { type: 'number', inputmode: 'numeric', id: 'hiPrice', placeholder: '價格' });
        const tp = el('select', { id: 'hiTemp' }, el('option', { value: 'any' }, '冷熱不限'), el('option', { value: 'hot' }, '僅熱'), el('option', { value: 'cold' }, '僅冰'));
        body.replaceChildren(
          ms.length > 1 ? el('div', { class: 'chips' }, ms.map((x, i) => el('button', { class: 'chip' + (i === mi ? ' on' : ''), onclick: () => { mi = i; draw(); } }, x.shop))) : null,
          el('div', { class: 'card' }, el('b', {}, '新增品項(老闆沒拍到的)'), catSel, catNew, nm, pr, tp,
            bigBtn('➕', '加入此團', async () => {
              const price = Menu.priceNum(pr.value);
              if (!nm.value.trim() || price === null) { alert('請填品名與價格'); return; }
              const mm = Menu.clone(m), cname = catSel.value === '__new' ? (catNew.value.trim() || '其他') : catSel.value;
              let c = mm.categories.find(x => x.name === cname); if (!c) { c = { name: cname, items: [] }; mm.categories.push(c); }
              c.items.push({ id: Menu.rid('i'), name: nm.value.trim(), price, prices: {}, note: '', temp: tp.value, own: true });
              await push(mm); nm.value = ''; pr.value = '';
            }, 'primary', 'hiAdd')),
          el('h3', {}, '現有品項(刪除後已點的訂單仍會顯示)'),
          el('div', { class: 'olist' }, m.categories.flatMap(c => c.items.map(it => el('div', { class: 'orow' }, el('span', { class: 'ol' }, c.name + ' · ' + it.name), el('span', { class: 'oa' }, el('button', { class: 'btn sm danger', 'aria-label': '刪除品項', onclick: async () => {
            const n = orderedCount(it.id);
            if (!confirm(n ? '「' + it.name + '」已經有 ' + n + ' 杯訂單。刪除後既有訂單仍會顯示,但別人不能再點。確定刪除?' : '刪除「' + it.name + '」?')) return;
            const mm = Menu.clone(m); mm.categories.forEach(cc => { cc.items = cc.items.filter(x => x.id !== it.id); }); await push(mm);
          } }, '✕')))))));
      };
      itemsRedraw = draw; draw();
    }, () => { itemsRedraw = null; });
  }

  /* --- 繪製 --- */
  function drawTabs() {
    tabsBar.replaceChildren(...TABS.map(([k, ic, tx]) => el('button', { class: 'tab' + (tab === k ? ' on' : ''), 'data-tab': k, onclick: () => { tab = k; render(); } }, el('span', { class: 'ti' }, ic), el('span', {}, tx))));
  }
  function render() {
    if (!st) return;
    drawTabs();
    banner.replaceChildren();
    if (netMsg) banner.append(el('div', { class: 'banner warn', id: 'netMsg' }, netMsg));
    if (st.status !== 'open') banner.append(el('div', { class: 'banner', id: 'statusBanner' }, STATUS_TEXT[st.status] || st.status));
    listBox = stickBox = null;
    if (tab === 'menu') menuTab(); else if (tab === 'mine') mineTab(); else if (tab === 'all') allTab(); else if (tab === 'clerk') clerkTab(); else infoTab();
  }
  function onState(s) {
    if (!s.exists) { netMsg = '找不到這個團(可能已被刪除)'; if (!st) return; render(); return; }
    const had = !!st;
    st = s;
    if (!had) { render(); return; }
    // 正在輸入時不要重畫整頁,只更新清單,避免鍵盤收起
    if (tab === 'menu' && document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && listBox) { drawMenuList(); drawTabs(); banner.replaceChildren(); return; }
    render();
    if (itemsRedraw) itemsRedraw();
  }

  pushScreen(st ? title() : '點餐', (body, entry) => {
    body.classList.add('room-body');
    tabsBar = el('nav', { class: 'tabs', id: 'roomTabs' });
    entry.head.after(tabsBar);
    banner = el('div'); content = el('div', { class: 'room-content', id: 'roomContent' });
    body.append(banner, content);
    if (st) render();
    unsub = net.subscribe(o.code, s => { netMsg = ''; onState(s); }, e => { netMsg = e.message || '連線問題'; if (st) render(); });
  }, () => { if (unsub) unsub(); if (tabsBar) tabsBar.remove(); });
}
