// 分帳記事本(旅遊團模式):團列表、成員、項目列表(待填/已完成/勾選)、項目指派、一次說完、結算、對帳單、結束旅遊
// 與 app.js 循環匯入:只在函式內使用
import * as DB from './db.js';
import * as AI from './ai.js';
import { el, uuid, today, pad2, pushScreen, popScreen, thumbImg, resizeImage, getSettings, aiOn, isPdf, MAX_FILE_BYTES, toast, attachSaveBar, keepSwitch, goCamera } from './app.js';
import { copyText, shareText } from './ui_room.js';
import { exportSheet } from './ui_export.js';
import * as Media from './media.js';

const { Settle, Ledger, Reconcile, Stats, Sheets, KeepPhoto, SaveBar } = window;
const bigBtn = (icon, text, onclick, cls, id) => el('button', { class: 'big-btn ' + (cls || ''), id, onclick }, el('span', { class: 'bi' }, icon), el('span', { class: 'bt' }, text));
const chip = (label, on, fn, extra) => el('button', Object.assign({ class: 'chip' + (on ? ' on' : ''), onclick: fn }, extra || {}), label);
const fmtDay = ms => { const d = new Date(ms || Date.now()); return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()); };
const money = n => '$' + n;
const clone = o => JSON.parse(JSON.stringify(o, (k, v) => (k === 'photos' ? undefined : v)));

async function loadTrip(id) {
  const raw = await DB.getTrip(id);
  if (!raw) return null;
  const t = Ledger.normalizeTrip(raw);
  t.records.forEach((r, i) => { r.photos = (raw.records[i] && raw.records[i].photos) || []; });
  return t;
}
const saveTrip = trip => DB.putTrip(trip);
const ctxOf = trip => ({ weights: Settle.weightsOf(trip) });

function downloadText(text, name) {
  const f = new File([text], name, { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(f), download: name }); document.body.append(a); a.click(); a.remove();
}
async function shareJson(text, name) {
  const f = new File([text], name, { type: 'application/json' });
  try { if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  downloadText(text, name);
}

/* ---------- 團列表 ---------- */
export function openTripList() {
  pushScreen('分帳記事本', (body, entry) => {
    const list = el('div', { id: 'tripList', class: 'lib-grid' });
    const draw = async () => {
      const all = (await DB.allTrips()).map(Ledger.normalizeTrip).sort((a, b) => b.createdAt - a.createdAt);
      list.replaceChildren();
      if (!all.length) list.append(el('div', { class: 'empty', id: 'tripEmpty' }, '還沒有旅遊團。先建成員,再記每一筆花費。'), el('button', { class: 'big-btn primary', id: 'tripEmptyNew', onclick: () => openNewTrip() }, el('span', { class: 'bi' }, '➕'), el('span', { class: 'bt' }, '新增旅遊團')));
      all.forEach(t => {
        const done = t.records.filter(Settle.isDone).length, todo = t.records.length - done;
        list.append(el('div', { class: 'card trip-row', 'data-id': t.id },
          el('div', { class: 'row' }, el('b', { class: 'grow' }, t.name)),
          el('div', { class: 'muted small' }, t.members.length + ' 人 · ' + done + ' 筆已完成' + (todo ? ' · ' + todo + ' 筆待填' : '') + ' · ' + fmtDay(t.createdAt)),
          el('div', { class: 'row wrap', style: 'margin-top:8px' },
            el('button', { class: 'btn sm primary', 'data-act': 'open', onclick: () => openTrip(t.id) }, '開啟'),
            el('button', { class: 'btn sm', 'data-act': 'rename', onclick: async () => { const n = prompt('旅遊團名稱', t.name); if (n && n.trim()) { const raw = await DB.getTrip(t.id); raw.name = n.trim(); await DB.putTrip(raw); draw(); } } }, '改名'),
            el('button', { class: 'btn sm', 'data-act': 'export', onclick: async () => shareJson(Ledger.toExport([await DB.getTrip(t.id)]), (t.name || '旅遊團').replace(/[\\/:*?"<>|]/g, ' ') + '.trip.json') }, '匯出'),
            el('button', { class: 'btn sm', 'data-act': 'clone', onclick: async () => { const n = prompt('新旅遊團名稱(會帶入同樣的成員、家庭與小孩設定,不帶記錄)', t.name + '(新)'); if (!n || !n.trim()) return; const raw = await DB.getTrip(t.id); await DB.putTrip(Ledger.normalizeTrip({ id: uuid(), name: n.trim(), createdAt: Date.now(), members: raw.members, families: raw.families, info: raw.info, meId: raw.meId, records: [] })); draw(); } }, '複製成員到新團'),
            el('button', { class: 'btn sm danger', 'data-act': 'delete', onclick: async () => { if (!confirm('確定刪除旅遊團「' + t.name + '」和裡面所有記錄?')) return; if (!confirm('再確認一次:刪除後無法復原,確定刪除?')) return; await DB.deleteTrip(t.id); draw(); } }, '刪除'))));
      });
    };
    entry.refresh = draw;
    body.append(el('div', { class: 'big-grid' },
      bigBtn('➕', '新增旅遊團', () => openNewTrip(), 'primary', 'tripNew'),
      el('label', { class: 'big-btn' }, el('span', { class: 'bi' }, '📥'), el('span', { class: 'bt' }, '匯入'), el('input', { type: 'file', accept: '.json,application/json', class: 'hidden', id: 'tripImport', onchange: async e => {
        const f = e.target.files[0]; e.target.value = ''; if (!f) return;
        const r = Ledger.fromImport(await f.text());
        if (r.error) { alert('匯入失敗:' + r.error); return; }
        const have = new Set((await DB.allTrips()).map(x => x.id)); let add = 0;
        for (const t of r.trips) { if (have.has(t.id)) continue; await DB.putTrip(t); add++; }
        alert('匯入完成:新增 ' + add + ' 個,略過重複 ' + (r.trips.length - add) + ' 個(匯出檔不含照片)'); draw();
      } })),
      bigBtn('📊', '我的旅行', () => openMyStats(), '', 'tripStatsBtn'),
      bigBtn('📤', '匯出全部', async () => { const all = await DB.allTrips(); if (all.length) shareJson(Ledger.toExport(all), '分帳記事本.trip.json'); }, '', 'tripExportAll')),
      list);
    draw();
  }, null, 'trips');
}

export function openNewTrip() {
  pushScreen('新增旅遊團', body => {
    const name = el('input', { type: 'text', id: 'ntName', value: '旅遊 ' + fmtDay(Date.now()), maxlength: 60 });
    const members = el('textarea', { id: 'ntMembers', rows: 6, placeholder: '先貼上或口述成員名單,用逗號、頓號、空白或換行分隔。\n小孩可在名字後加 (小孩)、(小孩0.5)、(小孩免費)。\n家庭可寫一行:A家庭:小唐 小唐太太 小唐兒子(小孩)' });
    body.append(el('label', { class: 'f' }, '團名'), name, el('label', { class: 'f' }, '成員名單(之後所有選擇都從這份名單來)'), members,
      el('div', { class: 'muted small' }, '建立後還可以逐一調整家庭、大人/小孩與計費權重。'),
      bigBtn('✅', '建立旅遊團', async () => {
        const p = Ledger.parseMembers(members.value);
        if (!name.value.trim()) { alert('請輸入團名'); return; }
        if (!p.members.length) { alert('請至少輸入一位成員'); return; }
        const info = {}; p.members.forEach(m => { info[m] = p.info[m] || { kind: 'adult', weight: 1 }; });
        const trip = Ledger.normalizeTrip({ id: uuid(), name: name.value.trim(), createdAt: Date.now(), members: p.members, families: p.families, info, records: [] });
        await saveTrip(trip); popScreen(); openTrip(trip.id);
      }, 'primary', 'ntCreate'));
  });
}

/* ---------- 成員 ---------- */
function openMembers(trip, onChange) {
  pushScreen('成員', (body, entry) => {
    let sbM = null;
    const list = el('div', { id: 'memList' });
    const commit = async () => { await saveTrip(trip); if (sbM) sbM.markAuto({ where: '旅遊團「' + trip.name + '」' }); if (onChange) onChange(); };
    const draw = () => {
      list.replaceChildren(...trip.members.map(m => {
        const inf = trip.info[m] || { kind: 'adult', weight: 1 }, child = inf.kind === 'child';
        const wsel = el('select', { 'aria-label': '計費權重', onchange: async e => { const v = e.target.value === 'x' ? Number(prompt('自訂權重(例 0.7)', String(inf.weight))) : Number(e.target.value); if (isFinite(v) && v >= 0) trip.info[m] = { kind: 'child', weight: v }; await commit(); draw(); } },
          [[1, '權重 1'], [0.5, '半價 0.5'], [0, '免費 0']].map(([v, l]) => el('option', { value: v }, l)), el('option', { value: 'x' }, '自訂…'));
        wsel.value = [1, 0.5, 0].includes(inf.weight) ? String(inf.weight) : 'x'; if (wsel.value === 'x') wsel.options[3].textContent = '自訂 ' + inf.weight;
        return el('div', { class: 'card mem-row', 'data-m': m },
          el('div', { class: 'row' },
            el('b', { class: 'grow', onclick: async () => { const n = prompt('改名', m); if (n === null) return; const r = Ledger.renameMember(trip, m, n); if (!r.ok) { alert(r.error); return; } await commit(); draw(); } }, m + ' ✏️'),
            el('button', { class: 'btn sm danger', 'aria-label': '刪除成員', onclick: async () => { if (Ledger.memberUsed(trip, m)) { alert('「' + m + '」已被記錄使用,不能刪除(可先改記錄)'); return; } if (!confirm('刪除成員「' + m + '」?')) return; trip.members = trip.members.filter(x => x !== m); delete trip.families[m]; delete trip.info[m]; await commit(); draw(); } }, '✕')),
          el('div', { class: 'row wrap', style: 'margin-top:6px' },
            chip('大人', !child, async () => { trip.info[m] = { kind: 'adult', weight: 1 }; await commit(); draw(); }, { 'data-kind': 'adult' }),
            chip('小孩', child, async () => { trip.info[m] = { kind: 'child', weight: inf.weight !== undefined ? inf.weight : 1 }; await commit(); draw(); }, { 'data-kind': 'child' }),
            child ? wsel : null,
            el('input', { type: 'text', class: 'fam-in', placeholder: '家庭(選填)', value: trip.families[m] || '', 'aria-label': '家庭', onchange: async e => { const v = Ledger.cleanName(e.target.value); if (v) trip.families[m] = v; else delete trip.families[m]; await commit(); } })));
      }));
    };
    const add = el('input', { type: 'text', id: 'memAdd', placeholder: '新增成員(可一次貼多個)' });
    body.append(list, el('div', { class: 'row', style: 'margin-top:10px' }, add, el('button', { class: 'btn primary', id: 'memAddBtn', onclick: async () => {
      const p = Ledger.parseMembers(add.value); let n = 0;
      p.members.forEach(m => { if (!trip.members.includes(m)) { trip.members.push(m); trip.info[m] = p.info[m] || { kind: 'adult', weight: 1 }; if (p.families[m]) trip.families[m] = p.families[m]; n++; } });
      add.value = ''; if (n) { await commit(); draw(); }
    } }, '加入')));
    draw();
  });
}

/* ---------- 團頁:項目列表 ---------- */
async function openTrip(id) {
  const trip = await loadTrip(id);
  if (!trip) return;
  pushScreen(trip.name, (body, entry) => {
    let filter = 'all', check = false; const sel = new Set();
    const top = el('div'), list = el('div', { id: 'recList', class: 'rlist' });
    { const me0 = Stats.resolveMe(trip, getSettings().myName); if (me0 && trip.meId !== me0) { trip.meId = me0; saveTrip(trip); } }
    const stateOf = r => (!Settle.isDone(r) ? 'todo' : (Settle.allocate(r, Settle.allMembers(trip), ctxOf(trip)).ok ? 'done' : 'bad'));
    const persist = () => saveTrip(trip);

    function drawTop() {
      const n = { all: trip.records.length, todo: trip.records.filter(r => stateOf(r) !== 'done').length };
      n.done = n.all - n.todo;
      const act = [el('div', { class: 'big-grid two' },
        bigBtn('➕', '新增項目', () => openRecord(trip, null, refresh), 'primary', 'btnAddRec'), bigBtn('🎤', '一次說完/貼上', () => openNote(trip, refresh), '', 'btnNote'),
        bigBtn('📋', '貼上清單', () => openDrinkList(trip, refresh), '', 'btnDrink'), bigBtn('👥', '成員 ' + trip.members.length, () => openMembers(trip, refresh), '', 'btnMembers'),
        bigBtn('💰', check && sel.size ? '結算已勾選 ' + sel.size : '結算費用', () => openSettle(trip, check && sel.size ? { recordIds: [...sel] } : {}), 'primary', 'btnSettle'))];
      const meRow = el('div', { class: 'me-row', id: 'meRow' }, el('span', { class: 'muted small' }, '我是:'), ...trip.members.map(m => chip(m, trip.meId === m, async () => { trip.meId = trip.meId === m ? '' : m; await persist(); drawTop(); }, { 'data-me': m })),
        trip.meId ? el('span', { class: 'muted small' }, Stats.familyOf(trip, trip.meId).length > 1 ? '我家:' + Stats.familyOf(trip, trip.meId).join('、') : '') : el('span', { class: 'warn-t small' }, '請點選「我是誰」,統計才會算我家'));
      top.replaceChildren(...act, meRow,
        el('div', { class: 'chips', id: 'recFilter' }, [['all', '全部 ' + n.all], ['todo', '待填 ' + n.todo], ['done', '已完成 ' + n.done]].map(([k, l]) => chip(l, filter === k, () => { filter = k; drawTop(); drawList(); }, { 'data-filter': k })),
          chip(check ? '☑ 勾選中' : '☐ 勾選', check, () => { check = !check; if (!check) sel.clear(); drawTop(); drawList(); }, { id: 'btnCheckMode' }),
          check ? chip('全選', false, () => { trip.records.filter(r => stateOf(r) === 'done').forEach(r => sel.add(r.id)); drawTop(); drawList(); }, { id: 'btnSelAll' }) : null,
          check ? chip('取消', false, () => { sel.clear(); drawTop(); drawList(); }, { id: 'btnSelNone' }) : null),
        check ? el('div', { class: 'muted small' }, '勾選模式:只結算勾選的項目(沒勾=全部)') : '');
    }
    function drawList() {
      list.replaceChildren();
      const rs = trip.records.filter(r => filter === 'all' || (filter === 'done' ? stateOf(r) === 'done' : stateOf(r) !== 'done'));
      if (!rs.length) list.append(el('div', { class: 'empty' }, trip.records.length ? '沒有符合的項目' : '還沒有項目。按「新增項目」或「一次說完/貼上」。'));
      rs.forEach(r => {
        const st = stateOf(r);
        const parts = Ledger.cleanName(r.payer) ? '付款:' + r.payer : '付款人未填';
        list.append(el('div', { class: 'rrow' + (st !== 'done' ? ' todo' : ''), role: 'button', tabindex: 0, 'data-rid': r.id, onclick: () => { if (check && st === 'done') { if (sel.has(r.id)) sel.delete(r.id); else sel.add(r.id); drawTop(); drawList(); return; } if (r.requireAssign) openCupAssign(trip, r, refresh); else openRecord(trip, r, refresh); } },
          check ? el('span', { class: 'ck' }, st === 'done' ? (sel.has(r.id) ? '☑' : '☐') : '—') : null,
          el('span', { class: 'rt' }, r.title + (r.qty ? ' ×' + r.qty : ''), el('small', {}, parts + (st === 'done' ? ' · ' + Object.keys(Settle.allocate(r, Settle.allMembers(trip), ctxOf(trip)).shares).length + ' 人分攤' : ''))),
          el('span', { class: 'ra' }, r.amount > 0 ? money(r.amount) : '—'),
          el('span', { class: 'tag ' + (st === 'done' ? 'ok' : 'warn') }, st === 'done' ? '已完成' : st === 'bad' ? '需處理' : '待填')));
      });
    }
    const refresh = async () => { drawTop(); drawList(); };
    entry.refresh = refresh;                 // 子畫面都就地修改同一個 trip 物件,不重讀資料庫(避免讀到還沒存完的舊資料)

    body.append(top, list); refresh();
  }, null, 'trip');
}

/* ---------- 成員選擇列(多選):全員/只有大人/只有小孩/家庭一鍵 ---------- */
function pickerRow(trip, selected, onChange, idp) {
  const box = el('div', { class: 'picker', id: idp });
  const draw = () => {
    const fams = Ledger.familyNames(trip);
    box.replaceChildren(
      el('div', { class: 'chips' }, chip('全員', selected.length === trip.members.length, () => { selected.splice(0, selected.length, ...Ledger.quickPick(trip, 'all')); changed(); }, { 'data-quick': 'all' }),
        chip('只有大人', false, () => { selected.splice(0, selected.length, ...Ledger.quickPick(trip, 'adults')); changed(); }, { 'data-quick': 'adults' }),
        chip('只有小孩', false, () => { selected.splice(0, selected.length, ...Ledger.quickPick(trip, 'children')); changed(); }, { 'data-quick': 'children' }),
        chip('清空', false, () => { selected.splice(0, selected.length); changed(); }, { 'data-quick': 'none' })),
      fams.length ? el('div', { class: 'chips' }, fams.map(f => chip('🏠 ' + f, Ledger.familyMembers(trip, f).every(p => selected.includes(p)), () => { const nx = Ledger.toggleFamily(selected, trip, f); selected.splice(0, selected.length, ...nx); changed(); }, { 'data-family': f }))) : null,
      el('div', { class: 'chips' }, trip.members.map(m => chip((Ledger.isChild(trip, m) ? '🧒 ' : '') + m, selected.includes(m), () => { const i = selected.indexOf(m); if (i >= 0) selected.splice(i, 1); else { selected.push(m); const ord = trip.members; selected.sort((a, b) => ord.indexOf(a) - ord.indexOf(b)); } changed(); }, { 'data-member': m }))));
  };
  const changed = () => { draw(); onChange(); };
  draw();
  return box;
}

/* ---------- 項目詳情 ---------- */
function openRecord(trip, rec, onDone) {
  const isNew = !rec;
  const r = rec ? Object.assign(clone(rec), { photos: (rec.photos || []).slice() }) : Ledger.normalizeRecord({ id: uuid(), title: '', payer: '', amount: 0, status: 'todo', source: 'manual', participants: trip.members.slice() });
  if (!r.photos) r.photos = [];
  let storedN = r.photos.length, keep = KeepPhoto.fromSettings(getSettings(), undefined), sbR = null, lastNew = 0;
  if (!isNew && !r.participants.length && (r.split.mode || 'equal') === 'equal') r.participants = trip.members.slice();
  let timer = null, saved = false;
  const members = () => Settle.allMembers(trip);
  const alloc = () => Settle.allocate(r, members(), ctxOf(trip));
  const type = () => (r.split.mode === 'items' ? 'items' : 'equal');
  async function persist() {
    clearTimeout(timer); timer = null;
    if (!isNew && !trip.records.some(x => x.id === r.id)) return;
    if (!r.title.trim() && !(r.amount > 0)) return;       // 完全空白不存
    r.status = alloc().ok ? 'done' : 'todo';
    const newOnes = r.photos.slice(storedN);
    const out = Object.assign({}, r);
    out.photos = r.photos.slice(0, storedN); out.mediaIds = (r.mediaIds || []).slice(0, storedN);          // 沒開「保留照片」:新照片不寫入
    lastNew = 0;
    if (keep && newOnes.length) {
      const ids = await KeepPhoto.persist(newOnes, true, b => Media.saveMedia(b, { kind: 'trip', ownerId: r.id }));
      out.photos = out.photos.concat(newOnes); out.mediaIds = out.mediaIds.concat(ids); r.mediaIds = out.mediaIds.slice(); storedN = out.photos.length; lastNew = newOnes.length;
    }
    const i = trip.records.findIndex(x => x.id === r.id);
    if (i >= 0) trip.records[i] = out; else trip.records.push(out);
    saved = true;
    await saveTrip(trip);
    if (sbR) sbR.markAuto({ toast: KeepPhoto.toast('旅遊團「' + trip.name + '」', keep, Math.max(lastNew, r.photos.length - storedN)) });
    return true;
  }
  const later = () => { if (sbR) sbR.markDirty(); clearTimeout(timer); timer = setTimeout(persist, 500); };

  pushScreen(isNew ? '新增項目' : '項目', (body, entry) => {
    const preview = el('div', { id: 'recPreview', class: 'rpreview' });
    const splitBox = el('div', { id: 'splitBox' }), payerBox = el('div', { id: 'payerBox' }), aiBox = el('div', { id: 'aiBox' }), photoBox = el('div', { id: 'photoBox' });
    const typeBox = el('div', { class: 'row', id: 'typeBox' });
    const title = el('input', { type: 'text', id: 'recTitle', value: r.title, placeholder: '這筆花在什麼(例:飲料)', oninput: e => { r.title = e.target.value; later(); } });
    const qty = el('input', { type: 'number', inputmode: 'numeric', id: 'recQty', value: r.qty || '', placeholder: '數量(選填,如 10 杯)', oninput: e => { r.qty = Math.max(0, Math.round(Number(e.target.value) || 0)); if (r.qty > 0 && type() === 'equal') { if (r.split.mode !== 'shares') r.split = { mode: 'shares', shares: {} }; } else if (!r.qty && r.split.mode === 'shares') { r.split = { mode: 'equal' }; if (!r.participants.length) r.participants = trip.members.slice(); } applyUnit(); drawSplit(); drawPreview(); later(); } });
    const unit = el('input', { type: 'number', inputmode: 'numeric', id: 'recUnit', value: r.unitPrice || '', placeholder: '單價(選填)', oninput: e => { r.unitPrice = Math.max(0, Math.round(Number(e.target.value) || 0)); applyUnit(); drawPreview(); later(); } });
    const amount = el('input', { type: 'number', inputmode: 'numeric', id: 'recAmount', value: r.amount || '', placeholder: '總額(元)', oninput: e => { r.amount = Math.max(0, Math.round(Number(e.target.value) || 0)); drawPreview(); later(); } });
    const dateIn = el('input', { type: 'date', id: 'recDate', value: r.date, onchange: e => { const d = Reconcile.normalizeDate(e.target.value); if (d) { r.date = d; later(); } } });
    function applyUnit() { if (r.qty > 0 && r.unitPrice > 0 && type() === 'equal') { r.amount = r.qty * r.unitPrice; amount.value = r.amount; } }

    function drawType() {
      typeBox.replaceChildren(
        el('button', { class: 'big-btn sm' + (type() === 'equal' ? ' primary' : ''), id: 'typeEqual', onclick: () => {
          if (type() === 'equal') return;
          if (!confirm('改回「平均分」會丟掉品項明細,確定?')) return;
          const c = Settle.toEqual(r); Object.assign(r, c); if (!r.participants.length) r.participants = trip.members.slice(); drawAll(); later();
        } }, el('span', { class: 'bt' }, '平均分')),
        el('button', { class: 'big-btn sm' + (type() === 'items' ? ' primary' : ''), id: 'typeItems', onclick: () => {
          if (type() === 'items') return;
          const c = Settle.toItems(Object.assign(r, { fees: r.fees || [] })); Object.assign(r, c);
          r.items.forEach(it => { if (!it.people.length) it.people = trip.members.slice(); }); r.qty = 0; drawAll(); later();
        } }, el('span', { class: 'bt' }, '明細帳')));
    }
    function drawPayer() {
      payerBox.replaceChildren(el('label', { class: 'f' }, '先付款的人(單選)'), el('div', { class: 'chips' }, trip.members.map(m => chip((Ledger.isChild(trip, m) ? '🧒 ' : '') + m, r.payer === m, () => { r.payer = m; drawPayer(); drawPreview(); later(); }, { 'data-payer': m }))));
    }
    function drawSplit() {
      splitBox.replaceChildren();
      if (type() === 'equal' && r.qty > 0) {
        const shares = r.split.shares || (r.split.shares = {});
        const used = () => Object.keys(shares).reduce((a, k) => a + (shares[k] || 0), 0);
        const status = el('div', { class: 'qty-status', id: 'qtyStatus' });
        const upd = () => { const u = used(); status.textContent = '已分配 ' + u + '/' + r.qty; status.className = 'qty-status' + (u === r.qty ? ' ok' : ' warn'); };
        splitBox.append(el('label', { class: 'f' }, '每人幾份(+/-)'), status);
        trip.members.forEach(m => {
          const val = el('b', { class: 'cval', 'data-count': m }, String(shares[m] || 0));
          const set = v => { v = Math.max(0, v); if (v) shares[m] = v; else delete shares[m]; val.textContent = String(shares[m] || 0); upd(); drawPreview(); later(); };
          splitBox.append(el('div', { class: 'counter-row', 'data-m': m }, el('span', { class: 'cn' }, (Ledger.isChild(trip, m) ? '🧒 ' : '') + m), el('button', { class: 'qbtn sm', 'aria-label': '減少', onclick: () => set((shares[m] || 0) - 1) }, '−'), val, el('button', { class: 'qbtn sm', 'aria-label': '增加', onclick: () => set((shares[m] || 0) + 1) }, '+')));
        });
        splitBox.append(el('button', { class: 'btn sm', id: 'qtyEven', onclick: () => { const ms = trip.members; const base = Math.floor(r.qty / ms.length), rem = r.qty - base * ms.length; Object.keys(shares).forEach(k => delete shares[k]); ms.forEach((m, i) => { const v = base + (i < rem ? 1 : 0); if (v) shares[m] = v; }); drawSplit(); drawPreview(); later(); } }, '平均分配'));
        upd();
      } else if (type() === 'equal') {
        splitBox.append(el('label', { class: 'f' }, '誰要分攤(多選)'), pickerRow(trip, r.participants, () => { drawPreview(); later(); }, 'partPicker'),
          el('label', { class: 'row wrap', style: 'margin:8px 0' }, el('input', { type: 'checkbox', id: 'useW', checked: r.useWeights !== false, style: 'width:24px;height:24px', onchange: e => { r.useWeights = e.target.checked; drawPreview(); later(); } }), el('span', {}, '套用小孩計費權重(大人 1、小孩依成員設定)')));
      } else {
        splitBox.append(el('label', { class: 'f' }, '品項(每個品項選誰要分攤)'));
        r.items.forEach((it, i) => splitBox.append(el('div', { class: 'card item-card', 'data-item': i },
          el('div', { class: 'row' }, el('input', { type: 'text', class: 'grow', value: it.name, placeholder: '品名', 'aria-label': '品名', oninput: e => { it.name = e.target.value; later(); } }),
            el('input', { type: 'number', inputmode: 'numeric', style: 'width:96px', value: it.amount || '', placeholder: '金額', 'aria-label': '金額', oninput: e => { it.amount = Math.max(0, Math.round(Number(e.target.value) || 0)); drawSum(); drawPreview(); later(); } }),
            el('button', { class: 'btn sm danger', 'aria-label': '刪除品項', onclick: () => { r.items.splice(i, 1); drawSplit(); drawPreview(); later(); } }, '✕')),
          pickerRow(trip, it.people, () => { drawPreview(); later(); }, 'itemPicker' + i))));
        const sumBox = el('div', { class: 'rsum', id: 'itemsSum' }), fee = el('input', { type: 'number', inputmode: 'numeric', id: 'recFee', style: 'width:120px', value: (r.fees[0] && r.fees[0].amount) || '', placeholder: '服務費/稅', oninput: e => { const v = Math.max(0, Math.round(Number(e.target.value) || 0)); r.fees = v ? [{ name: '服務費/稅', amount: v }] : []; drawSum(); drawPreview(); later(); } });
        function drawSum() {
          const tot = Settle.itemsTotal(r), d = r.amount - tot;
          sumBox.replaceChildren(el('span', {}, '品項+費用合計 ' + money(tot) + ',總額 ' + money(r.amount)), d !== 0 ? el('b', { class: 'warn-t' }, d > 0 ? ' 還差 ' + d + ' 元' : ' 多了 ' + (-d) + ' 元') : el('b', { class: 'ok-t' }, ' ✓ 相符'),
            d !== 0 ? el('button', { class: 'btn sm', id: 'setTotal', onclick: () => { r.amount = tot; amount.value = tot; drawSum(); drawPreview(); later(); } }, '總額改為合計') : null);
        }
        splitBox.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', id: 'addItem', onclick: () => { r.items.push({ name: '', qty: 1, amount: 0, people: trip.members.slice() }); drawSplit(); } }, '＋ 品項'), el('span', { class: 'muted small' }, '服務費/稅:'), fee), sumBox);
        drawSum();
      }
    }
    function drawPreview() {
      const a = alloc();
      preview.replaceChildren();
      if (!a.ok) { preview.append(el('div', { class: 'banner warn', id: 'recError' }, (r.payer ? '' : '還沒選付款人。') + (r.amount > 0 ? '' : '還沒填總額。') + (a.code === 'NO_PAYER' || a.code === 'BAD_AMOUNT' ? '' : a.error) || '待填'), el('div', { class: 'muted small' }, '未完成的項目會標為「待填」,不計入結算。')); return; }
      preview.append(el('div', { class: 'tag ok', id: 'recOk' }, '已完成'), el('div', { class: 'pv-list' }, Object.keys(a.shares).filter(k => a.shares[k] > 0 || true).map(k => el('span', { class: 'pv' }, k + ' ', el('b', {}, money(a.shares[k]))))),
        el('div', { class: 'muted small' }, '均分餘數每人 1 元,依名單順序分給前面的人。' + (type() === 'equal' && r.useWeights !== false && r.participants.some(p => Ledger.isChild(trip, p) && ((trip.info[p] || {}).weight !== 1)) ? '已套用小孩計費權重。' : '')));
    }
    function drawAI() {
      const ta = el('textarea', { id: 'aiText', rows: 2, placeholder: '用文字或鍵盤麥克風說明,例:冰棒小凱沒吃,小新吃兩份' });
      const ai = aiOn(getSettings());
      const out = el('div', { id: 'aiOut' });
      aiBox.replaceChildren(el('label', { class: 'f' }, '文字/語音說明分攤'), ta,
        el('button', { class: 'btn sm', id: 'aiGo', disabled: !ai, onclick: async () => {
          if (!ta.value.trim()) return;
          if (!navigator.onLine) { alert('目前離線'); return; }
          out.replaceChildren(el('span', { class: 'spin' }), ' 整理中…');
          try { await aiUpdate(ta.value.trim(), out); } catch (e) { out.textContent = '失敗:' + (e.code === 'NO_KEY' ? '尚未設定 API 金鑰' : e.message); }
        } }, '用 AI 整理'), ai ? null : el('span', { class: 'muted small' }, ' (AI 未啟用:請直接用上面的選擇)'), out);
    }
    async function aiUpdate(text, out) {
      const settings = getSettings(), tool = AI.TOOLS.find(t => t.name === 'update_split');
      const ctx = { title: r.title, amount: r.amount, payer: r.payer, members: trip.members, current: { mode: r.split.mode, participants: r.participants, shares: r.split.shares, items: r.items } };
      const resp = await AI.callModel(settings, [{ role: 'user', content: [{ type: 'text', text: '(使用者選擇的動作:說明這一筆怎麼分,請使用 update_split;人名只能用成員名單內的名字)\n目前記錄:' + JSON.stringify(ctx) + '\n使用者說明:' + text }] }], AI.buildSystem(today(), settings.categories), { tools: [tool], tool_choice: { type: 'tool', name: 'update_split' }, max_tokens: 2000 });
      const tu = (resp.content || []).find(b => b.type === 'tool_use' && b.name === 'update_split');
      if (!tu) throw new Error('AI 沒有回傳結果');
      const inp = tu.input || {}, notes = [];
      const fix = n => { const m = Ledger.matchName(n, trip.members); if (m.status === 'exact') return m.member; notes.push('「' + n + '」不在成員名單,已略過' + (m.candidates.length ? '(相近:' + m.candidates.join('、') + ')' : '')); return null; };
      const fixList = l => (l || []).map(fix).filter(Boolean);
      const fixMap = o => { const x = {}; Object.keys(o || {}).forEach(k => { const m = fix(k); if (m) x[m] = Math.round(Number(o[k]) || 0); }); return x; };
      const draft = { participants: inp.participants ? fixList(inp.participants) : null, shares: inp.shares ? fixMap(inp.shares) : null, amounts: inp.amounts ? fixMap(inp.amounts) : null,
        items: inp.items ? inp.items.map(i => ({ name: i.name, qty: i.qty || 1, amount: Math.round(Number(i.amount) || 0), people: fixList(i.people) })) : null };
      const lines = [];
      if (draft.participants) lines.push('平均分給:' + draft.participants.join('、'));
      if (draft.shares) lines.push('份數:' + Object.keys(draft.shares).map(k => k + '×' + draft.shares[k]).join('、'));
      if (draft.amounts) lines.push('各人金額:' + Object.keys(draft.amounts).map(k => k + ' ' + draft.amounts[k]).join('、'));
      if (draft.items) lines.push('品項:' + draft.items.map(i => i.name + ' ' + i.amount + '→' + (i.people.length ? i.people.join('/') : '全員')).join(';'));
      (inp.questions || []).forEach(q => lines.push('AI 想確認:' + q.text + (q.options && q.options.length ? '(' + q.options.join(' / ') + ')' : '')));
      out.replaceChildren(el('div', { class: 'card' }, el('b', {}, '變更預覽'), ...(lines.length ? lines : ['(沒有變更)']).map(l => el('div', {}, l)), ...notes.map(n => el('div', { class: 'muted small' }, n)),
        el('div', { class: 'row', style: 'margin-top:8px' }, el('button', { class: 'btn sm primary', id: 'aiApply', onclick: () => {
          if (draft.items) { r.split = { mode: 'items' }; r.items = draft.items; r.qty = 0; }
          else if (draft.amounts) { r.split = { mode: 'amounts', amounts: draft.amounts }; }
          else if (draft.shares) { r.split = { mode: 'shares', shares: draft.shares }; if (r.qty && Object.keys(draft.shares).reduce((a, k) => a + draft.shares[k], 0) !== r.qty) r.qty = 0; }
          else if (draft.participants) { r.split = { mode: 'equal' }; r.participants = draft.participants; }
          out.replaceChildren(); drawAll(); later();
        } }, '套用'), el('button', { class: 'btn sm', onclick: () => out.replaceChildren() }, '取消'))));
    }
    function drawPhotos() {
      const ai = aiOn(getSettings());
      const add = async ev => { const files = Array.from(ev.target.files || []); ev.target.value = ''; for (const f of files) { if (f.size > MAX_FILE_BYTES) { alert('檔案太大'); continue; } try { const b = f.type === 'application/pdf' ? f : await resizeImage(f); r.photos.push(b); } catch (_) { alert('讀取失敗'); } } drawPhotos(); later(); };
      const out = el('div', { id: 'receiptOut' });
      photoBox.replaceChildren(el('label', { class: 'f' }, '收據照片(可選)'),
        r.photos.length ? el('div', { class: 'thumbs' }, r.photos.map((b, i) => el('div', { class: 'thumb' }, thumbImg(b, '收據'), el('button', { 'aria-label': '移除', onclick: async () => { if (i < storedN) { if (!confirm('刪除這張已保留的照片?(釋放空間,無法復原)')) return; const mid = (r.mediaIds || [])[i]; if (mid) await Media.deleteMedia(mid); if (r.mediaIds) r.mediaIds.splice(i, 1); storedN--; toast('已刪除照片,釋放空間'); } r.photos.splice(i, 1); drawPhotos(); later(); } }, '×')))) : null,
        el('div', { class: 'muted small', id: 'photoKeepInfo' }, KeepPhoto.detailText(storedN) + (r.photos.length > storedN ? ';新加的 ' + (r.photos.length - storedN) + ' 張' + (keep ? '儲存時會保留' : '只用來對照,不會保留') : '')),
        el('div', { class: 'row wrap' },
          el('label', { class: 'btn sm' }, '📷 拍照', el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', id: 'recCam', onchange: add })),
          el('label', { class: 'btn sm' }, '🖼 相簿/PDF', el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, class: 'hidden', id: 'recAlbum', onchange: add })),
          r.photos.length && ai ? el('button', { class: 'btn sm primary', id: 'readReceipt', onclick: async () => { out.replaceChildren(el('span', { class: 'spin' }), ' 讀取收據…'); try { await readReceipt(out); } catch (e) { out.textContent = '失敗:' + (e.code === 'NO_KEY' ? '尚未設定 API 金鑰' : e.message); } } }, '🧾 讀取收據品項') : null),
        !ai ? el('div', { class: 'muted small' }, 'AI 未啟用:照片只存為附件,品項請在「明細帳」手動輸入。') : null, out);
    }
    async function readReceipt(out) {
      const settings = getSettings(), tool = AI.TOOLS.find(t => t.name === 'extract_receipt'), content = [];
      for (const b of r.photos) content.push(await AI.fileBlock(b));
      content.push({ type: 'text', text: '請用 extract_receipt 列出收據品項與金額(照抄,不加總)。' });
      const resp = await AI.callModel(settings, [{ role: 'user', content }], AI.buildSystem(today(), settings.categories), { tools: [tool], tool_choice: { type: 'tool', name: 'extract_receipt' }, max_tokens: 4000 });
      const tu = (resp.content || []).find(b => b.type === 'tool_use' && b.name === 'extract_receipt');
      if (!tu) throw new Error('AI 沒有回傳結果');
      applyReceipt(tu.input || {}); out.textContent = '已列出品項,請指定每個品項由誰分攤';
    }
    function applyReceipt(inp) {
      const items = (inp.items || []).map(i => ({ name: String(i.name || ''), qty: i.qty || 1, amount: Math.round(Number(i.amount) || 0), people: trip.members.slice() }));
      const fees = (inp.extra_fees || []).map(f => ({ name: String(f.name || '費用'), amount: Math.round(Number(f.amount) || 0) })).filter(f => f.amount);
      const tot = items.reduce((a, i) => a + i.amount, 0) + fees.reduce((a, f) => a + f.amount, 0), recTotal = Math.round(Number(inp.total) || 0) || tot;
      if (r.amount > 0 && r.amount !== recTotal && !confirm('收據總額 ' + recTotal + ' 與記錄金額 ' + r.amount + ' 不同。\n按「確定」改用收據金額,按「取消」保留原金額(會顯示差額)。')) { /* 保留 */ } else r.amount = recTotal;
      r.split = { mode: 'items' }; r.items = items; r.fees = fees.length ? [{ name: '服務費/稅', amount: fees.reduce((a, f) => a + f.amount, 0) }] : []; r.qty = 0; amount.value = r.amount;
      if (!r.title.trim() && inp.store) { r.title = inp.store; title.value = r.title; }
      drawAll(); later();
    }
    function drawAll() { drawType(); drawPayer(); drawSplit(); drawPreview(); drawAI(); drawPhotos(); }
    body.append(typeBox, el('label', { class: 'f' }, '項目名稱'), title,
      el('div', { class: 'row wrap fields3' }, el('div', { class: 'grow' }, el('label', { class: 'f' }, '數量'), qty), el('div', { class: 'grow' }, el('label', { class: 'f' }, '單價'), unit), el('div', { class: 'grow' }, el('label', { class: 'f' }, '總額'), amount)),
      el('label', { class: 'f' }, '日期'), dateIn, payerBox, splitBox, preview, aiBox, photoBox,
      isNew ? null : el('button', { class: 'btn danger block', id: 'recDelete', style: 'margin-top:14px', onclick: async () => { if (!confirm('刪除這個項目?')) return; trip.records = trip.records.filter(x => x.id !== r.id); clearTimeout(timer); saved = false; isNew || (rec = null); await saveTrip(trip); popScreen(); } }, '刪除項目'));
    drawAll();
    entry.s.dataset.rec = '1';
    sbR = attachSaveBar(entry, { auto: true, id: 'btnSaveRecord',
      onSave: async () => { const ok = await persist(); if (!ok) { alert('請先填項目名稱或金額'); return false; } return { toast: KeepPhoto.toast('旅遊團「' + trip.name + '」', keep, Math.max(lastNew, r.photos.length - storedN)) }; },
      extra: [keepSwitch(keep, v => { keep = v; drawPhotos(); later(); })] });
  }, async () => { await persist(); if (onDone) onDone(); });
}

/* ---------- 一次說完 / 貼上 ---------- */
function openNote(trip, onDone) {
  pushScreen('一次說完/貼上', body => {
    const ta = el('textarea', { id: 'noteText', rows: 6, placeholder: '點鍵盤上的麥克風口述,或貼上文字,可一次說多筆。\n例:買飲料 小玉付 1024 元,冰棒 小凱付 240 元\n只列項目也可以:飲料10杯、午餐、門票(之後再填金額)' });
    const out = el('div', { id: 'noteOut' }), status = el('div', { class: 'muted', id: 'noteStatus' });
    let rows = [];
    function todoFrom(seg) {
      let title = seg.trim(), qty = 0, m = title.match(/^(.+?)\s*[x×*]\s*(\d+)\s*(杯|個|份|瓶|張|人)?$/i) || title.match(/^(.+?)\s*(\d+)\s*(杯|個|份|瓶|張)$/);
      if (m) { title = m[1].trim(); qty = Number(m[2]); }
      return { title, payer: '', rawPayer: '', amount: 0, qty, status: 'todo', cands: [], payerStatus: '' };
    }
    function drawRows() {
      out.replaceChildren();
      if (!rows.length) return;
      out.append(el('h3', {}, '預覽(可改,確認才寫入)'));
      rows.forEach((x, i) => {
        const sel = el('select', { 'aria-label': '付款人', onchange: e => { const v = e.target.value; if (v.startsWith('+')) { x.newMember = v.slice(1); x.payer = ''; } else { x.payer = v; x.newMember = ''; } drawRows(); } },
          el('option', { value: '' }, x.rawPayer && !x.payer ? '「' + x.rawPayer + '」不在名單,請選' : '付款人?'), trip.members.map(m => el('option', { value: m }, m + (x.cands.includes(m) ? '(相近)' : ''))),
          x.rawPayer && x.payerStatus === 'unknown' ? el('option', { value: '+' + x.rawPayer }, '＋新增成員「' + x.rawPayer + '」') : null);
        sel.value = x.newMember ? '+' + x.newMember : x.payer;
        out.append(el('div', { class: 'card note-row', 'data-i': i },
          el('div', { class: 'row' }, el('input', { type: 'text', class: 'grow', value: x.title, 'aria-label': '標題', oninput: e => { x.title = e.target.value; } }),
            el('input', { type: 'number', inputmode: 'numeric', style: 'width:96px', value: x.amount || '', placeholder: '金額', 'aria-label': '金額', oninput: e => { x.amount = Math.round(Number(e.target.value) || 0); } }),
            el('button', { class: 'btn sm danger', 'aria-label': '刪除', onclick: () => { rows.splice(i, 1); drawRows(); } }, '✕')),
          el('div', { class: 'row', style: 'margin-top:6px' }, sel, x.qty ? el('span', { class: 'tag' }, '×' + x.qty) : null, el('span', { class: 'tag ' + ((x.payer || x.newMember) && x.amount > 0 ? 'ok' : 'warn') }, (x.payer || x.newMember) && x.amount > 0 ? '可完成' : '存成待填'))));
      });
      out.append(bigBtn('✅', '確認寫入 ' + rows.length + ' 筆', async () => {
        let n = 0;
        for (const x of rows) {
          if (!x.title.trim()) continue;
          let payer = x.payer;
          if (x.newMember && !trip.members.includes(x.newMember)) { trip.members.push(x.newMember); trip.info[x.newMember] = { kind: 'adult', weight: 1 }; payer = x.newMember; } else if (x.newMember) payer = x.newMember;
          const done = payer && x.amount > 0;
          trip.records.push(Ledger.normalizeRecord({ id: uuid(), title: x.title.trim(), payer: payer || '', amount: x.amount, participants: trip.members.slice(), status: done ? 'done' : 'todo', qty: x.qty, date: x.date || undefined, source: 'note' })); n++;
        }
        await saveTrip(trip); toast(SaveBar.toastText('旅遊團「' + trip.name + '」')); if (onDone) onDone(); popScreen();
      }, 'primary', 'noteConfirm'));
    }
    async function organise() {
      const text = ta.value.trim(); if (!text) return;
      const settings = getSettings(); let res = null, note = '';
      if (aiOn(settings) && navigator.onLine) {
        status.replaceChildren(el('span', { class: 'spin' }), ' AI 整理中…');
        try {
          const tool = AI.TOOLS.find(t => t.name === 'parse_expenses');
          const resp = await AI.callModel(settings, [{ role: 'user', content: [{ type: 'text', text: '(使用者選擇的動作:一次說完多筆付費,請使用 parse_expenses)\n成員名單(人名只能對照這份名單):' + trip.members.join('、') + '\n使用者說的話:' + text }] }], AI.buildSystem(today(), settings.categories), { tools: [tool], tool_choice: { type: 'tool', name: 'parse_expenses' }, max_tokens: 3000 });
          const tu = (resp.content || []).find(b => b.type === 'tool_use' && b.name === 'parse_expenses');
          if (!tu) throw new Error('AI 沒有回傳結果');
          const inp = tu.input || {};
          res = { records: (inp.records || []).map(x => ({ title: String(x.title || ''), payer: String(x.payer || ''), amount: Math.round(Number(x.amount) || 0) })), unparsed: (inp.unclear || []).map(t => ({ text: t })) };
          note = (inp.questions || []).map(q => 'AI 想確認:' + q.text + (q.options && q.options.length ? '(' + q.options.join(' / ') + ')' : '')).join('\n');
        } catch (e) { note = 'AI 失敗(' + (e.code === 'NO_KEY' ? '尚未設定金鑰' : e.message) + '),改用內建規則解析。'; res = null; }
      } else if (aiOn(settings)) note = '目前離線,使用內建規則解析。';
      if (!res) res = Ledger.parseNote(text, trip.members);
      rows = res.records.map(x => {
        const m = Ledger.matchName(x.payer, trip.members);
        return { date: x.date || '', title: x.title, amount: x.amount > 0 ? x.amount : 0, qty: 0, payer: m.status === 'exact' ? m.member : '', rawPayer: m.status === 'exact' ? '' : x.payer, payerStatus: m.status, cands: m.candidates, newMember: '' };
      }).concat((res.unparsed || []).map(u => todoFrom(u.text)));
      status.textContent = note + (res.unparsed && res.unparsed.length ? '\n沒辦法解析的段落已列成「待填」項目,可再補金額。' : '');
      drawRows();
    }
    body.append(el('div', { class: 'muted small' }, '人名會對照成員名單:' + trip.members.join('、')), ta, bigBtn('🪄', '整理成記錄', organise, 'primary', 'noteGo'), status, out);
  });
}

/* ---------- 結算費用(隨時即時試算,每次按都重新計算,不存快照) ---------- */
function downloadTxt(text, name) {
  const f = new File([text], name, { type: 'text/plain' });
  const a = el('a', { href: URL.createObjectURL(f), download: name }); document.body.append(a); a.click(); a.remove();
}
async function saveTxt(text, name) {
  const f = new File([text], name, { type: 'text/plain' });
  try { if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  downloadTxt(text, name);
}
function openSettle(trip, opts) {
  opts = opts || {};
  pushScreen('結算費用', body => {
    const hasFam = Ledger.familyNames(trip).length > 0;
    let groupBy = hasFam ? 'family' : 'person', mode = 'min', target = '__summary';
    const box = el('div');
    const compute = () => Settle.settleTrip(trip, { recordIds: opts.recordIds, groupBy });
    const day = () => fmtDay(Date.now());
    function openStatement(res, name) {
      pushScreen(name + ' 對帳單', b => {
        const pre = el('pre', { class: 'stmt-text big', id: 'stmtText' });
        const upd = () => { pre.textContent = Settle.reportText(trip, res, day(), mode, name); };
        const chips = el('div', { class: 'chips' });
        const drawChips = () => chips.replaceChildren(chip('最少轉帳', mode === 'min', () => { mode = 'min'; drawChips(); upd(); }, { id: 'stmtMin' }), chip('依每筆明細', mode === 'detail', () => { mode = 'detail'; drawChips(); upd(); }, { id: 'stmtDetail' }));
        drawChips(); upd();
        b.append(chips, pre, el('div', { class: 'act-row' }, bigBtn('📋', '複製文字', () => copyText(pre.textContent), 'primary', 'stmtCopy'), bigBtn('📤', '分享', () => shareText(pre.textContent, name + ' 對帳單'), '', 'stmtShare')));
      });
    }
    function draw() {
      const res = compute();
      box.replaceChildren();
      box.append(el('div', { class: 'banner', id: 'settleInfo' }, '即時試算 · 已選 ' + res.selectedCount + ' 筆' + (opts.recordIds ? '(勾選)' : '(全部已完成)') + ' · 總花費 ' + money(res.totalSpent)
        + (res.pendingCount ? ' · 尚有 ' + res.pendingCount + ' 筆待填,未納入' : '')));
      if (res.errors.length) box.append(el('div', { class: 'banner warn', id: 'settleErr' }, '有 ' + res.errors.length + ' 筆無法計算(未納入):' + res.errors.map(e => e.title + '(' + e.error + ')').join('、')));
      box.append(el('div', { class: 'chips' },
        hasFam ? chip('以家庭', groupBy === 'family', () => { groupBy = 'family'; target = '__summary'; draw(); }, { id: 'gbFamily' }) : null, hasFam ? chip('以個人', groupBy === 'person', () => { groupBy = 'person'; target = '__summary'; draw(); }, { id: 'gbPerson' }) : null,
        chip('最少轉帳', mode === 'min', () => { mode = 'min'; draw(); }, { id: 'modeMin' }), chip('依每筆明細', mode === 'detail', () => { mode = 'detail'; draw(); }, { id: 'modeDetail' })));
      // 每家庭/每人要付或可收,一眼可見(點進看對帳單與要付給誰)
      box.append(el('div', { class: 'big-totals', id: 'bigTotals' }, res.rows.map(r => el('button', { class: 'big-total ' + (r.net > 0 ? 'recv' : r.net < 0 ? 'pay' : ''), 'data-name': r.name, onclick: () => openStatement(res, r.name) },
        el('span', { class: 'bn' }, r.name), el('b', { class: 'bv' }, r.net > 0 ? '可收 ' + money(r.net) : r.net < 0 ? '要付 ' + money(-r.net) : '打平')))));
      box.append(el('table', { class: 't rtable', id: 'settleRows' }, el('tr', {}, el('th', {}, '名稱'), el('th', { class: 'n' }, '已付'), el('th', { class: 'n' }, '應分攤'), el('th', { class: 'n' }, '淨額')),
        res.rows.map(r => el('tr', {}, el('td', {}, r.name), el('td', { class: 'n' }, r.paid), el('td', { class: 'n' }, r.share), el('td', { class: 'n ' + (r.net > 0 ? 'ok-t' : r.net < 0 ? 'warn-t' : '') }, (r.net > 0 ? '+' : '') + r.net)))));
      box.append(el('div', { class: 'muted small', id: 'balanceCheck' }, '淨額加總:' + res.sumNet + (res.balanced ? ' ✓' : ' ✗')));
      box.append(el('h3', {}, '誰付給誰'));
      const tr = mode === 'detail' ? Settle.detailTransfers(res) : res.transfers;
      const tl = el('div', { class: 'olist xfer', id: 'xferList' });
      if (!tr.length) tl.append(el('div', { class: 'empty' }, '無須轉帳'));
      tr.forEach(x => tl.append(el('div', { class: 'xrow' }, el('span', { class: 'xn' }, x.from + ' → ' + x.to), el('b', { class: 'xa' }, money(x.amount)), x.title ? el('small', {}, x.title) : null)));
      box.append(tl);
      // 輸出:圖片 PNG / PDF / Excel / 文字(先預覽再下載;每次都由當下記錄重新計算)
      const sel = el('select', { id: 'reportTarget', 'aria-label': '文字內容', onchange: e => { target = e.target.value; } },
        el('option', { value: '__summary' }, '文字:總表'), el('option', { value: '__all' }, '文字:全部對帳單'), res.rows.map(r => el('option', { value: r.name }, '文字:' + r.name + ' 的對帳單')));
      sel.value = target;
      const mkSpec = () => { const cur = compute(), sp = Sheets.settle(trip, cur, day(), mode); sp.text = Settle.reportText(trip, cur, day(), mode, target); return sp; };
      box.append(el('h3', {}, '匯出'), sel, exportSheet(mkSpec));
      box.append(saveBox(res));
    }
    function saveBox(res) {
      const sets = getSettings(), cats = sets.categories.includes('旅遊') ? sets.categories : sets.categories.concat(['旅遊']);
      const cat = el('select', { id: 'saveCat', 'aria-label': '分類' }, cats.map(c => el('option', { value: c }, c))); cat.value = '旅遊';
      const note = el('div', { class: 'muted small', id: 'saveNote' });
      const me = Stats.resolveMe(trip, sets.myName);
      async function save(whole) {
        if (!me) { alert('請先在旅遊團頁點選「我是誰」'); return; }
        const rows = Stats.familyShareRows(trip, { myName: sets.myName }).filter(r => !opts.recordIds || opts.recordIds.includes(r.recordId));
        let added = 0, skipped = 0;
        const put = async (id, date, total, store, why) => { if (await DB.getExpense(id)) { skipped++; return; } await DB.putExpense({ id, date, store, total, currency: 'TWD', items: [], payment_method: '', category: cat.value, payer: sets.myName || me, shared: false, note: '分帳:' + trip.name + '(' + why + ')', photoIds: [], location: null, createdAt: Date.now(), updatedAt: Date.now() }); added++; };
        if (whole) { const tot = rows.reduce((a, r) => a + r.share, 0); if (tot > 0) await put('trip-' + trip.id + '-total-fam', rows.map(r => r.date).sort().pop(), tot, trip.name, '我家整團'); }
        else for (const r of rows) await put('trip-' + trip.id + '-' + r.recordId + '-fam', r.date, r.share, r.title, '我家的份');
        toast(SaveBar.toastText('記帳本') + '(' + added + ' 筆)');
        note.textContent = '已存入記帳本 ' + added + ' 筆' + (skipped ? ',略過已存過的 ' + skipped + ' 筆' : '');
      }
      return el('div', { class: 'card', id: 'saveBox' }, el('b', {}, '把我家的份存入記帳本'), el('div', { class: 'muted small' }, me ? '我是 ' + me + ',我家:' + Stats.familyOf(trip, me).join('、') : '還沒選「我是誰」(回旅遊團頁點選)'), el('div', { class: 'row', style: 'margin:6px 0' }, cat),
        el('div', { class: 'row' }, bigBtn('🗂', '逐筆存', () => save(false), 'sm', 'saveEach'), bigBtn('Σ', '整個團存一筆', () => save(true), 'sm', 'saveTotal')), note);
    }
    body.append(box); draw();
  });
}

/* ---------- 貼上清單(外部 AI 整理好的飲料清單)→ 預覽 → 一筆明細帳 ---------- */
function openDrinkList(trip, onDone) {
  pushScreen('貼上清單', body => {
    const ta = el('textarea', { id: 'drinkText', rows: 6, placeholder: '一行一個品項,例:\n凍檸茶 * 2 半糖 少冰 大 單杯75\n鮮奶茶 * 4 半糖 熱 大 單杯 75\n多多綠 * 1 半糖少冰 中 55' });
    const status = el('div', { class: 'muted', id: 'drinkStatus' }), out = el('div', { id: 'drinkOut' });
    const title = el('input', { type: 'text', id: 'drinkTitle', value: '飲料', 'aria-label': '標題' });
    let lines = [], unparsed = [];
    const ai = aiOn(getSettings());
    const total = () => ({ cups: lines.reduce((a, l) => a + (l.qty || 0), 0), amount: lines.reduce((a, l) => a + (l.total || 0), 0) });
    const recalc = l => { l.qty = Math.max(1, Math.round(Number(l.qty) || 1)); if (l.kind === 'total') { l.unit = l.total % l.qty === 0 ? l.total / l.qty : null; } else { l.total = (l.unit || 0) * l.qty; } };
    function drawPreview() {
      out.replaceChildren();
      if (!lines.length && !unparsed.length) return;
      const tt = total();
      out.append(el('div', { class: 'banner', id: 'drinkTotals' }, '共 ' + tt.cups + ' 杯 · 合計 ' + money(tt.amount)), el('label', { class: 'f' }, '標題'), title);
      lines.forEach((l, i) => out.append(el('div', { class: 'card drink-row' + (l.confirm ? ' confirm' : ''), 'data-i': i },
        el('div', { class: 'row' }, el('input', { type: 'text', class: 'grow', value: l.name, 'aria-label': '品名', oninput: e => { l.name = e.target.value; } }),
          el('input', { type: 'number', inputmode: 'numeric', style: 'width:64px', value: l.qty, 'aria-label': '杯數', onchange: e => { l.qty = Number(e.target.value); recalc(l); l.confirm = l.confirm && l.kind === 'default-unit'; drawPreview(); } }),
          el('button', { class: 'btn sm danger', 'aria-label': '刪除', onclick: () => { lines.splice(i, 1); drawPreview(); } }, '✕')),
        el('div', { class: 'row wrap', style: 'margin-top:6px' },
          el('input', { type: 'text', class: 'grow', value: Ledger.lineDesc(l), placeholder: '糖度 冰度 尺寸', 'aria-label': '規格', onchange: e => { const d = Ledger.parseDrinkList('x * 1 ' + e.target.value + ' 1').lines[0]; if (d) { l.sugar = d.sugar; l.ice = d.ice; l.size = d.size; l.note = d.note; } } }),
          el('input', { type: 'number', inputmode: 'numeric', style: 'width:84px', value: l.unit === null ? '' : l.unit, placeholder: '單杯價', 'aria-label': '單杯價', onchange: e => { l.unit = Math.max(0, Math.round(Number(e.target.value) || 0)); l.kind = 'unit'; l.confirm = false; recalc(l); drawPreview(); } }),
          el('b', { class: 'dtot' }, '小計 ' + money(l.total)),
          l.confirm ? el('button', { class: 'tag warn confirm-tag', onclick: () => { l.confirm = false; drawPreview(); } }, '待確認(點此確認)') : null))));
      unparsed.forEach((u, i) => out.append(el('div', { class: 'card unparsed', 'data-u': i }, el('div', { class: 'warn-t' }, '未能解析:' + u.text + '(' + u.reason + ')'),
        el('div', { class: 'row', style: 'margin-top:4px' }, el('button', { class: 'btn sm', onclick: () => { ta.value = u.text; unparsed.splice(i, 1); drawPreview(); ta.focus(); } }, '放回上面修改'), el('button', { class: 'btn sm', onclick: () => { unparsed.splice(i, 1); drawPreview(); } }, '略過')))));
      out.append(bigBtn('✅', '建立記錄(' + tt.cups + ' 杯)', async () => {
        if (!lines.length) { alert('沒有可建立的品項'); return; }
        const rec = Ledger.drinkListToRecord(lines.filter(l => l.name.trim()), { title: title.value.trim() || '飲料', id: uuid() });
        rec.participants = trip.members.slice();
        trip.records.push(rec); await saveTrip(trip); toast(SaveBar.toastText('旅遊團「' + trip.name + '」'));
        if (onDone) onDone(); popScreen(); openCupAssign(trip, rec, onDone);
      }, 'primary', 'drinkCreate'));
    }
    function parse() {
      const r = Ledger.parseDrinkList(ta.value);
      lines = r.lines; unparsed = r.unparsed;
      status.textContent = lines.length || unparsed.length ? '解析了 ' + lines.length + ' 行' + (unparsed.length ? ',' + unparsed.length + ' 行未能解析(請手動補)' : '') : '沒有內容';
      drawPreview();
    }
    async function fromPhoto(ev) {
      const files = Array.from(ev.target.files || []); ev.target.value = ''; if (!files.length) return;
      if (!navigator.onLine) { alert('目前離線'); return; }
      status.replaceChildren(el('span', { class: 'spin' }), ' AI 讀取照片…');
      try {
        const blobs = []; for (const f of files.slice(0, 4)) blobs.push(f.type === 'application/pdf' ? f : await resizeImage(f));
        const settings = getSettings(), tool = AI.TOOLS.find(t => t.name === 'extract_receipt'), content = [];
        for (const b of blobs) content.push(await AI.fileBlock(b));
        content.push({ type: 'text', text: '請用 extract_receipt 列出帳單品項與金額(照抄,不加總;品名不要修正)。' });
        const resp = await AI.callModel(settings, [{ role: 'user', content }], AI.buildSystem(today(), settings.categories), { tools: [tool], tool_choice: { type: 'tool', name: 'extract_receipt' }, max_tokens: 4000 });
        const tu = (resp.content || []).find(b => b.type === 'tool_use' && b.name === 'extract_receipt');
        if (!tu) throw new Error('AI 沒有回傳結果');
        const inp = tu.input || {};
        lines = (inp.items || []).map(i => { const qty = Math.max(1, Math.round(Number(i.qty) || 1)), tot = Math.round(Number(i.amount) || 0); return { name: String(i.name || ''), qty, sugar: '', ice: '', size: '', note: '', unit: tot % qty === 0 ? tot / qty : null, total: tot, kind: 'total', confirm: false, raw: '' }; }).filter(l => l.name && l.total > 0);
        unparsed = (inp.unreadable || []).map(t => ({ text: String(t), reason: 'AI 看不清楚' }));
        status.textContent = 'AI 列出 ' + lines.length + ' 個品項,請核對後建立';
        drawPreview();
      } catch (e) { status.textContent = '讀取失敗:' + (e.code === 'NO_KEY' ? '尚未設定 API 金鑰' : e.message); }
    }
    body.append(
      el('div', { class: 'muted small' }, '把外部 AI(ChatGPT 等)整理好的清單貼在這裡。格式:'),
      el('pre', { class: 'sample', id: 'drinkSample' }, '品名 * 數量 糖度 冰度 尺寸 單杯價格\n凍檸茶 * 2 半糖 少冰 大 單杯75\n多多綠 * 1 半糖少冰 中 55'),
      el('div', { class: 'row wrap' }, bigBtn('📝', '複製給 AI 的整理指令', () => copyText(Ledger.DRINK_PROMPT), 'sm', 'copyPrompt')),
      ta,
      el('div', { class: 'row wrap' }, bigBtn('🪄', '解析清單', parse, 'primary sm', 'drinkParse'),
        ai ? el('label', { class: 'big-btn sm' }, el('span', { class: 'bi' }, '📷'), el('span', { class: 'bt' }, '拍帳單(AI)'), el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, class: 'hidden', id: 'drinkPhoto', onchange: fromPhoto })) : null),
      ai ? null : el('div', { class: 'muted small' }, '未啟用 AI:帳單照片請先請外部 AI 整理成上面的格式再貼上。'),
      status, out);
  });
}

/* ---------- 逐杯指派 ---------- */
function openCupAssign(trip, rec, onDone) {
  const r = rec;                                  // 就地修改,離開時存檔
  pushScreen('逐杯指派', (body, entry) => {
    const members = () => trip.members;
    const ctx = () => ctxOf(trip);
    const summary = el('div', { class: 'banner', id: 'cupSummary' }), payerBox = el('div', { id: 'cupPayer' }), list = el('div', { id: 'cupList' });
    let timer = null;
    let sbC = null;
    const persist = async () => { clearTimeout(timer); const a = Settle.allocate(r, Settle.allMembers(trip), ctx()); r.status = a.ok ? 'done' : 'todo'; await saveTrip(trip); if (sbC) sbC.markAuto({ where: '旅遊團「' + trip.name + '」' }); };
    const later = () => { if (sbC) sbC.markDirty(); clearTimeout(timer); timer = setTimeout(persist, 400); };
    const lineIdx = () => [...new Set(r.items.map(i => i.line))];
    function drawSummary() {
      const a = Settle.allocate(r, Settle.allMembers(trip), ctx()), asg = Ledger.assignedCount(r);
      summary.className = 'banner' + (a.ok ? '' : ' warn');
      summary.textContent = r.title + ' · 共 ' + r.items.length + ' 杯 · 合計 ' + money(Settle.itemsTotal(r)) + ' · 已指派 ' + asg + '/' + r.items.length + (r.payer ? '' : ' · 還沒選先付款人') + (a.ok ? ' · 已完成' : ' · 待填');
    }
    function drawPayer() {
      payerBox.replaceChildren(el('label', { class: 'f' }, '先付款的人(單選)'), el('div', { class: 'chips' }, members().map(m => chip((Ledger.isChild(trip, m) ? '🧒 ' : '') + m, r.payer === m, () => { r.payer = m; drawPayer(); drawSummary(); later(); }, { 'data-payer': m }))));
    }
    function drawList() {
      list.replaceChildren();
      lineIdx().forEach(li => {
        const cups = r.items.filter(i => i.line === li), first = cups[0];
        const counts = {}; cups.forEach(c => c.people.forEach(p => { counts[p] = (counts[p] || 0) + 1; }));
        const card = el('div', { class: 'card cup-line', 'data-line': li },
          el('div', { class: 'row' }, el('b', { class: 'grow' }, first.name + (first.desc ? ' ' + first.desc : '') + ' ×' + cups.length), el('b', { class: 'dtot' }, money(cups.reduce((a, c) => a + c.amount, 0)))));
        card.append(el('div', { class: 'muted small' }, '整行一次指派:'), el('div', { class: 'chips' }, members().map(m => chip(m, cups.every(c => c.people.length === 1 && c.people[0] === m), () => { Ledger.assignLine(r, li, cups.every(c => c.people.length === 1 && c.people[0] === m) ? null : m); drawList(); drawSummary(); later(); }, { 'data-line-member': m }))));
        // 每人幾杯 計數器
        const cnt = el('details', { class: 'counter-box' }, el('summary', {}, '每人幾杯(+/−)'));
        members().forEach(m => {
          const val = el('b', { class: 'cval', 'data-count': m }, String(counts[m] || 0));
          const apply = v => { counts[m] = Math.max(0, v); Ledger.assignLineCounts(r, li, counts, members()); drawList(); drawSummary(); later(); };
          cnt.append(el('div', { class: 'counter-row' }, el('span', { class: 'cn' }, m), el('button', { class: 'qbtn sm', 'aria-label': '減少', onclick: () => apply((counts[m] || 0) - 1) }, '−'), val, el('button', { class: 'qbtn sm', 'aria-label': '增加', onclick: () => apply((counts[m] || 0) + 1) }, '+')));
        });
        card.append(cnt);
        cups.forEach((c, k) => card.append(el('div', { class: 'cup-row' + (c.people.length ? '' : ' un'), 'data-cup': k },
          el('span', { class: 'cup-n' }, '第 ' + (k + 1) + ' 杯 ' + money(c.amount)),
          el('div', { class: 'chips' }, members().map(m => chip(m, c.people.includes(m), () => { c.people = c.people.length === 1 && c.people[0] === m ? [] : [m]; drawList(); drawSummary(); later(); }, { 'data-cup-member': m }))))));
        list.append(card);
      });
    }
    body.append(summary, payerBox, list, el('div', { class: 'row', style: 'margin-top:14px' },
      bigBtn('🗑', '刪除這筆', async () => { if (!confirm('刪除「' + r.title + '」?')) return; trip.records = trip.records.filter(x => x.id !== r.id); clearTimeout(timer); timer = null; await saveTrip(trip); entry.deleted = true; popScreen(); }, 'danger', 'cupDelete')));
    drawPayer(); drawSummary(); drawList();
    entry.s.dataset.cup = '1';
    entry.persist = persist;
    sbC = attachSaveBar(entry, { auto: true, id: 'btnSaveCup', onSave: async () => { await persist(); return { where: '旅遊團「' + trip.name + '」' }; } });
  }, async () => { await (async () => { const a = Settle.allocate(r, Settle.allMembers(trip), ctxOf(trip)); if (trip.records.some(x => x.id === r.id)) { r.status = a.ok ? 'done' : 'todo'; await saveTrip(trip); } })(); if (onDone) onDone(); });
}

/* ---------- 我的旅行統計 ---------- */
export function openMyStats() {
  pushScreen('我的旅行', (body, entry) => {
    let year = '', month = '';
    const box = el('div');
    const draw = async () => {
      const sets = getSettings();
      const trips = (await DB.allTrips()).map(Ledger.normalizeTrip);
      const per = Stats.availablePeriods(trips);
      if (year && !per.years.includes(year)) { year = ''; month = ''; }
      const range = Stats.periodRange(year, month), list = Stats.allStats(trips, { myName: sets.myName, range }), ov = Stats.overview(list);
      const label = (year ? year + '年' + (month ? Number(month) + '月' : '') : '全部期間');
      const meLabel = (sets.myName || '') + (sets.myAccount ? ' / ' + sets.myAccount : '');
      const ys = el('select', { id: 'statYear', 'aria-label': '年', onchange: e => { year = e.target.value; month = ''; draw(); } }, el('option', { value: '' }, '全部年份'), per.years.map(y => el('option', { value: y }, y + ' 年')));
      ys.value = year;
      const months = per.months.filter(m => m.startsWith(year + '-'));
      const ms = el('select', { id: 'statMonth', 'aria-label': '月', disabled: !year, onchange: e => { month = e.target.value; draw(); } }, el('option', { value: '' }, '全部月份'), months.map(m => el('option', { value: m.slice(5) }, Number(m.slice(5)) + ' 月')));
      ms.value = month;
      box.replaceChildren(el('div', { class: 'row' }, ys, ms), meLabel ? el('div', { class: 'muted small' }, '我:' + meLabel) : null,
        el('div', { class: 'big-totals', id: 'statOverview' },
          [['全團總花費', money(ov.totalSpent), ''], ['我家應分攤', money(ov.familyShare), ''], ['我實際付出', money(ov.myPaid), ''], ['我家淨額', (ov.familyNet > 0 ? '+' : '') + ov.familyNet, ov.familyNet > 0 ? 'recv' : ov.familyNet < 0 ? 'pay' : '']].map(([n, v, c]) => el('div', { class: 'big-total ' + c }, el('span', { class: 'bn' }, n), el('b', { class: 'bv' }, v)))),
        ov.pending ? el('div', { class: 'banner warn', id: 'statPending' }, '尚有 ' + ov.pending + ' 筆待填,未納入') : null,
        el('div', { id: 'statList' }, list.length ? list.map(s => el('div', { class: 'stat-row', 'data-id': s.tripId, role: 'button', tabindex: 0, onclick: () => openTripStats(trips.find(t => t.id === s.tripId), range, label) },
          el('span', { class: 'sn' }, el('b', {}, s.name), el('small', {}, (s.range ? (s.range.min === s.range.max ? s.range.min : s.range.min + ' ~ ' + s.range.max) : '尚無已完成記錄') + (s.me ? '' : ' · 未選「我是誰」'))),
          el('span', { class: 'stat-nums' }, el('span', {}, '全團'), el('span', {}, '我家'), el('span', {}, '淨額'), el('b', {}, money(s.totalSpent)), el('b', {}, money(s.familyShare)), el('b', { class: s.familyNet > 0 ? 'ok-t' : s.familyNet < 0 ? 'warn-t' : '' }, (s.familyNet > 0 ? '+' : '') + s.familyNet)))) : [el('div', { class: 'empty' }, '這段期間沒有旅遊團記錄')]),
        el('h3', {}, '匯出'), exportSheet(() => Sheets.stats(ov, list, label, meLabel)));
    };
    entry.refresh = draw;
    body.append(box); draw();
  });
}
function openTripStats(trip, range, label) {
  const sets = getSettings();
  pushScreen(trip.name, body => {
    const s = Stats.tripStats(trip, { myName: sets.myName, range });
    body.append(el('div', { class: 'big-totals', id: 'tripStatTotals' }, [['全團總花費', money(s.totalSpent), ''], ['我家應分攤', money(s.familyShare), ''], ['我實際付出', money(s.myPaid), ''], ['我家淨額', (s.familyNet > 0 ? '+' : '') + s.familyNet, s.familyNet > 0 ? 'recv' : s.familyNet < 0 ? 'pay' : '']].map(([n, v, c]) => el('div', { class: 'big-total ' + c }, el('span', { class: 'bn' }, n), el('b', { class: 'bv' }, v)))),
      s.me ? el('div', { class: 'muted small' }, '我是 ' + s.me + (s.family.length > 1 ? ',我家:' + s.family.join('、') : '')) : el('div', { class: 'banner warn' }, '這個團還沒選「我是誰」,我家的數字會是 0(到旅遊團頁點選)'),
      s.pending ? el('div', { class: 'banner warn' }, '尚有 ' + s.pending + ' 筆待填,未納入') : null,
      el('h3', {}, '依日期'),
      el('div', { id: 'dayList' }, s.byDate.length ? s.byDate.map(d => el('div', { class: 'day', 'data-date': d.date },
        el('div', { class: 'day-h' }, el('span', {}, d.date), el('span', { class: 'muted small' }, '全團 ' + money(d.total) + ' · 我家 ' + money(d.familyShare) + ' · 我付 ' + money(d.myPaid))),
        el('div', { class: 'olist' }, d.records.map(r => el('div', { class: 'orow' }, el('span', { class: 'no' }, '•'), el('span', { class: 'ol' }, r.title, el('em', {}, '(' + r.payer + ' 付)')), el('span', { class: 'oq' }, money(r.amount)), el('span', { class: 'op' }, '我家 ' + money(r.familyShare))))))) : [el('div', { class: 'empty' }, '這段期間沒有已完成記錄')]),
      el('h3', {}, '匯出'), exportSheet(() => { const x = Stats.tripStats(trip, { myName: sets.myName, range }); return Sheets.stats(Stats.overview([x]), [x], label + ' · ' + trip.name, ''); }));
  });
}

/* ---------- 一句話記帳 / 一句話分帳(不用拍照) ---------- */
// 個人記帳:「午餐 120,飲料 60」沒有付款人,視為我自己付;可帶日期(11/23、昨天…)
function personalRecords(text) {
  const records = [], unparsed = [];
  String(text || '').normalize('NFKC').split(/[\n,;、。]+/).forEach(raw => {
    let seg = raw.trim(); if (!seg) return;
    const dx = Ledger.extractDate(seg, today()); if (dx.date) seg = dx.rest.trim();
    const m = seg.match(/^(.*?)\s*([0-9][0-9,]*(?:\.\d+)?|[零〇一二兩两三四五六七八九十百千萬万壹貳參肆伍陸柒捌玖拾佰仟]+)\s*(?:元|塊|圓)?$/);
    const amt = m ? Reconcile.parseAmount(m[2]) : null;
    if (!m || amt === null || amt <= 0 || Math.floor(amt) !== amt) { unparsed.push(raw.trim()); return; }
    records.push({ title: m[1].replace(/[:：\-—\s]+$/, '').trim() || '支出', amount: amt, date: dx.date || today() });
  });
  return { records, unparsed };
}
export function openVoiceExpense() {
  pushScreen('一句話記帳', body => {
    const settings = getSettings();
    const cats = settings.categories.length ? settings.categories : ['餐飲'];
    const ta = el('textarea', { id: 'voiceText', rows: 4, placeholder: '點鍵盤上的麥克風,說一句。例:午餐 120,飲料 60,捷運 30' });
    const out = el('div', { id: 'voiceOut' }), status = el('div', { class: 'muted', id: 'voiceStatus' });
    let rows = [];
    const draw = () => {
      out.replaceChildren();
      if (!rows.length) return;
      out.append(el('h3', {}, '預覽(可改,確認才寫入記帳本)'));
      rows.forEach((x, i) => {
        const cat = el('select', { 'aria-label': '分類', onchange: e => { x.category = e.target.value; } }, cats.map(c => el('option', { value: c }, c))); cat.value = x.category;
        out.append(el('div', { class: 'card voice-row', 'data-i': i },
          el('div', { class: 'row' }, el('input', { type: 'text', class: 'grow', value: x.title, 'aria-label': '項目', oninput: e => { x.title = e.target.value; } }),
            el('input', { type: 'number', inputmode: 'numeric', style: 'width:96px', value: x.amount, 'aria-label': '金額', oninput: e => { x.amount = Math.round(Number(e.target.value) || 0); } }),
            el('button', { class: 'btn sm danger', 'aria-label': '刪除', onclick: () => { rows.splice(i, 1); draw(); } }, '✕')),
          el('div', { class: 'row', style: 'margin-top:6px' }, el('input', { type: 'date', value: x.date, 'aria-label': '日期', onchange: e => { const d = Reconcile.normalizeDate(e.target.value); if (d) x.date = d; } }), cat)));
      });
      out.append(bigBtn('✅', '確認寫入 ' + rows.length + ' 筆', async () => {
        const ok = rows.filter(x => x.title.trim() && x.amount > 0);
        if (!ok.length) { alert('沒有可以寫入的項目'); return; }
        for (const x of ok) await DB.putExpense({ id: uuid(), date: x.date, store: x.title.trim(), total: x.amount, currency: 'TWD', items: [], payment_method: '', category: x.category, payer: settings.myName, shared: false, note: '一句話記帳', photoIds: [], location: null, createdAt: Date.now(), updatedAt: Date.now() });
        toast('已存到 記帳本(' + ok.length + ' 筆,未保留照片)'); popScreen();
      }, 'primary', 'voiceConfirm'));
    };
    async function organise() {
      const text = ta.value.trim(); if (!text) return;
      let res = null, note = '';
      if (aiOn(settings) && navigator.onLine) {
        status.replaceChildren(el('span', { class: 'spin' }), ' AI 整理中…');
        try {
          const tool = AI.TOOLS.find(t => t.name === 'parse_expenses');
          const resp = await AI.callModel(settings, [{ role: 'user', content: [{ type: 'text', text: '(使用者選擇的動作:一句話個人記帳,請使用 parse_expenses;沒有付款人時 payer 填「我」)\n使用者說的話:' + text }] }], AI.buildSystem(today(), settings.categories), { tools: [tool], tool_choice: { type: 'tool', name: 'parse_expenses' }, max_tokens: 2000 });
          const tu = (resp.content || []).find(b => b.type === 'tool_use' && b.name === 'parse_expenses');
          if (!tu) throw new Error('AI 沒有回傳結果');
          res = { records: (tu.input.records || []).map(x => ({ title: String(x.title || ''), amount: Math.round(Number(x.amount) || 0), date: today() })), unparsed: tu.input.unclear || [] };
        } catch (e) { note = 'AI 失敗(' + e.message + '),改用內建規則。'; }
      }
      if (!res) res = personalRecords(text);
      rows = res.records.map(r => ({ title: r.title, amount: r.amount, date: r.date, category: cats.includes('餐飲') ? '餐飲' : cats[0] }));
      status.textContent = note + (res.unparsed.length ? '看不懂這幾段,請自己補:' + res.unparsed.join(' / ') : '') + (!rows.length && !res.unparsed.length ? '沒有內容' : '');
      draw();
    }
    body.append(el('div', { class: 'muted small' }, '不用拍照。用鍵盤上的麥克風口述,或直接打字。沒說付款人就當作你自己付。'), ta, bigBtn('🪄', '整理成記錄', organise, 'primary', 'voiceGo'), status, out);
    setTimeout(() => { try { ta.focus(); } catch (_) { /* 不影響 */ } }, 200);
  });
}
export async function openVoiceSplit() {
  const trips = (await DB.allTrips()).map(Ledger.normalizeTrip);
  if (!trips.length) { openNewTrip(); return; }
  const go = async id => { const t = await loadTrip(id); if (t) openNote(t, () => {}); };
  if (trips.length === 1) { go(trips[0].id); return; }
  pushScreen('要記在哪一團?', body => { trips.forEach(t => body.append(bigBtn('🧾', t.name, () => { popScreen(); go(t.id); }, '', 'pickTrip'))); });
}
