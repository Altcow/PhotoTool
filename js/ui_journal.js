// 日誌頁、事件頁、日誌設定頁(右上 ⚙)與共用編輯表單。資料來自 ctx.jn(journalnet.js)。
// 所有會等網路的動作都走 busy.run(全螢幕處理中遮罩、15 秒逾時、可重試)。
import { el, pushScreen, popScreen, toast } from './app.js';
import { ctx, accountChip, richText, setHash } from './tjctx.js';
import * as busy from './busy.js';

const J = () => window.Journal;
const T = v => J().txt(v);
const ROLE_ICON = { text: '📝', nav: '📍', photo: '🖼', file: '📄', menu: '🍽' };
const OTHER = '__other';
const synced = {};   // 本次開啟期間已同步過首頁索引的 jid+角色

// 一個動作 = 遮罩 + 失敗可重試;回傳 {ok, value, error}
const act = (fn, text, okToast, extra) => busy.run(fn, Object.assign({ text, okToast }, extra || {}));

/* ---------- 共用:表單頁 ---------- */
// fields: [{key,label,type:'text'|'textarea'|'date'|'checkbox'|'select',value,max,hint,required,options,inputmode,showIf:{key,value}}]
// guard: {cur:()=>number(目前已知的 updatedAt), base:number}(儲存前比對,有人剛改過就問是否覆蓋;用已訂閱的資料,不多一次網路往返)
// onSave(values, slot):slot 是這個表單專用的物件,新增類動作用它保存「第一次配到的格子 id」,逾時重試沿用同一個
function openForm({ title, fields, banner, guard, okText, onSave, savingText }) {
  pushScreen(title, body => {
    const inputs = {}, rows = {};
    const slot = {};
    const err = el('div', { class: 'banner warn', id: 'frmErr', style: 'display:none' });
    body.append(err);
    if (banner) body.append(el('div', { class: 'banner', id: 'frmBanner' }, banner));
    const enterBlur = e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } };   // iPhone 鍵盤「前往/完成」只收鍵盤,不送出
    fields.forEach(f => {
      let inp;
      const val = T(f.value);
      if (f.type === 'textarea') { inp = el('textarea', { id: 'f_' + f.key, rows: 6, maxlength: f.max || null }); inp.value = val; }
      else if (f.type === 'checkbox') inp = el('input', { type: 'checkbox', id: 'f_' + f.key, checked: !!f.value, style: 'width:22px;height:22px' });
      else if (f.type === 'select') {
        inp = el('select', { id: 'f_' + f.key, class: 'tj-sel' }, f.options.map(o => el('option', { value: o.value }, o.label)));
        inp.value = val;
        if (inp.value !== val && f.options.length) inp.value = f.options[0].value;
      } else { inp = el('input', { type: f.type || 'text', id: 'f_' + f.key, maxlength: f.max || null, placeholder: f.placeholder || '', inputmode: f.inputmode || null, autocomplete: 'off', onkeydown: enterBlur }); inp.value = val; }
      inputs[f.key] = inp;
      const row = f.type === 'checkbox'
        ? el('label', { class: 'row', style: 'margin:12px 0' }, inp, f.label)
        : el('div', {}, el('label', { class: 'f', for: 'f_' + f.key }, f.label + (f.required ? '(必填)' : '')), inp, f.hint ? el('div', { class: 'muted small' }, f.hint) : null);
      rows[f.key] = row; body.append(row);
    });
    const syncShow = () => fields.forEach(f => { if (f.showIf) rows[f.key].style.display = inputs[f.showIf.key].value === f.showIf.value ? '' : 'none'; });
    fields.forEach(f => { if (f.type === 'select') inputs[f.key].onchange = syncShow; });
    syncShow();
    const ok = el('button', { class: 'big-btn primary', id: 'frmOk', style: 'margin-top:16px' }, okText || '儲存');
    ok.onclick = async () => {
      if (ok.disabled) return;
      const v = {};
      fields.forEach(f => { v[f.key] = f.type === 'checkbox' ? inputs[f.key].checked : inputs[f.key].value; });
      err.style.display = 'none';
      const missing = fields.find(f => f.required && !(f.showIf && inputs[f.showIf.key].value !== f.showIf.value) && !String(v[f.key]).trim());
      if (missing) { err.textContent = missing.label + '不能空白'; err.style.display = ''; return; }
      if (guard && guard.cur() !== guard.base && !confirm('有人剛改過這份內容,要用你的版本覆蓋嗎?')) return;
      ok.disabled = true;
      const r = await act(() => onSave(v, slot), savingText || '儲存中…', '已儲存');
      if (r.ok) { popScreen(); return; }
      err.textContent = (r.error && r.error.message) || '儲存失敗'; err.style.display = ''; ok.disabled = false;   // 表單不關、輸入不遺失
    };
    body.append(ok);
  });
}

/* ---------- 進入點 ---------- */
export function mountDetail(route, o) {
  const sec = el('section', { class: 'screen tj-detail' + (o.inline ? ' inline' : ''), id: 'tjDetail', 'data-jid': route.jid });
  const titleEl = el('h2', {}, '');
  const dot = el('span', { class: 'tj-dot', id: 'tjJDot' }, '');
  const gearHolder = el('span', { class: 'tj-gear-holder' });
  const head = el('header', { class: 'bar' },
    o.onBack ? el('button', { class: 'back', id: 'tjBack', onclick: o.onBack }, '‹ 返回') : el('span', { class: 'back-spacer' }),
    titleEl, dot, el('span', { class: 'bar-r tj-bar-r' }, gearHolder, accountChip(o.openAccount)));
  const body = el('div', { class: 'screen-body' });
  sec.append(head, body);
  const jid = route.jid;
  let state = null, locked = false, lockInfo = null, off = null, offF = null, following = false, disposed = false, open = {};
  let banned = null, myReq = undefined;
  const hook = { fn: null };
  const roleNow = () => (state && state.meta ? window.Policy.roleOf(ctx.uid, state.meta, state.members) : null);

  const loadLock = async () => {
    lockInfo = { loading: true };
    try {
      const [meta, ban, tries] = await Promise.all([ctx.jn.getMeta(jid), ctx.jn.amBanned(jid).catch(() => false), ctx.jn.myTries(jid).catch(() => null)]);
      lockInfo = { meta, banned: ban, tries };
    } catch (e) { lockInfo = { error: e.message || '讀取失敗' }; }
    if (!disposed) render();
  };
  const sub = () => {
    if (off) off();
    state = null; locked = false; lockInfo = null; banned = null; myReq = undefined;
    off = ctx.jn.subscribeJournal(jid, v => { state = v; dot.textContent = ''; if (!disposed) { render(); if (hook.fn) hook.fn(); } }, e => {
      if (disposed) return;
      if (e && e.code === 'PERMISSION') { locked = true; if (!lockInfo) loadLock(); render(); }
      else if (e && e.soft) dot.textContent = '重新連線中…';
      else { dot.textContent = '離線'; }
    });
  };
  const render = () => {
    gearHolder.replaceChildren();
    if (locked) { titleEl.textContent = (lockInfo && lockInfo.meta && T(lockInfo.meta.title)) || '日誌'; body.replaceChildren(lockedView()); return; }
    if (!state) { body.replaceChildren(el('div', { class: 'muted', id: 'tjLoading' }, '讀取中…')); return; }
    if (!state.meta) { titleEl.textContent = '日誌'; body.replaceChildren(goneView()); return; }
    titleEl.textContent = T(state.meta.title);
    const role = roleNow();
    // 角色與首頁索引不同步時補上(例如被主編加回、升為副編)
    if (role && role !== 'owner' && !synced[jid + role]) { synced[jid + role] = true; ctx.jn.syncIdx(jid, state.meta, role).catch(() => { synced[jid + role] = false; }); }
    if (!role && banned === null) { banned = false; ctx.jn.amBanned(jid).then(b => { banned = !!b; if (!disposed) render(); }).catch(() => { /* 查不到就當沒被移出 */ }); }
    if (role === 'member' && myReq === undefined) { myReq = null; ctx.jn.myReq(jid).then(r => { myReq = r || null; if (!disposed) render(); }).catch(() => { /* 略過 */ }); }
    if (J().settingsAccess(role).gear) gearHolder.append(el('button', { class: 'tj-gear', id: 'tjGear', 'aria-label': '日誌設定', onclick: () => openSettings(jid, () => state, role, sub, hook) }, '⚙'));
    body.replaceChildren(...[].concat(route.eid ? eventView(role) : journalView(role)));
  };

  const removeBtn = () => el('div', { style: 'margin-top:8px' }, el('button', { class: 'btn', id: 'tjRemoveFromList', onclick: async () => { const r = await act(() => ctx.jn.removeFromList(jid), '處理中…', '已從清單移除'); if (r.ok) setHash('#/'); } }, '從清單移除'));
  const goneView = () => el('div', { class: 'card', id: 'tjGone' }, el('b', {}, '這本日誌已刪除或不存在'), removeBtn());
  const bannedView = () => el('div', { class: 'card', id: 'tjBanned' }, el('b', {}, '你已被移出這本日誌'), el('p', { class: 'muted' }, '如果要回來,請主編把你加回。'), removeBtn());
  // 私密日誌、還不是成員:標題/主編/日期 + 密碼欄
  function lockedView() {
    const L = J(), li = lockInfo;
    if (!li || li.loading) return el('div', { class: 'muted', id: 'tjLoading' }, '讀取中…');
    if (li.error) return el('div', { class: 'card', id: 'tjLockErr' }, el('b', {}, '讀取失敗'), el('p', { class: 'muted' }, li.error));
    if (!li.meta) return goneView();
    if (li.banned) return bannedView();
    const meta = li.meta, rule = L.pwRule(), left = L.triesLeft(li.tries, Date.now());
    const pwIn = el('input', { type: 'password', id: 'tjPwIn', inputmode: rule.digits ? 'numeric' : 'text', maxlength: rule.max, autocomplete: 'off', placeholder: '輸入團密碼' });
    const join = async () => {
      if (!pwIn.value) return;
      const r = await act(() => ctx.jn.joinWithPassword(jid, meta, pwIn.value), '加入中…', '已加入', { retryable: false });
      if (r.ok) { lockInfo = null; sub(); return; }
      lockInfo = null; loadLock();   // 重讀剩餘次數
    };
    pwIn.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); pwIn.blur(); } };
    return el('div', { class: 'card', id: 'tjLocked' },
      el('div', { class: 'tj-info-title' }, '🔒 ' + T(meta.title)),
      el('div', { class: 'muted' }, [L.fmtRange(meta.start, meta.end), '主編 ' + T(meta.ownerName)].filter(Boolean).join(' · ')),
      el('p', { class: 'muted' }, '這是私密日誌,輸入團密碼才能加入。'),
      left <= 0 ? el('div', { class: 'banner warn', id: 'tjTooMany' }, '嘗試太多次,1 小時後再試,或請主編直接加你。')
        : [pwIn, left < L.TRY_MAX ? el('div', { class: 'muted small', id: 'tjTriesLeft' }, '還可以試 ' + left + ' 次') : null,
          el('button', { class: 'big-btn primary', id: 'tjPwJoin', style: 'margin-top:10px', onclick: join }, '加入')],
      el('div', { style: 'margin-top:8px' }, el('button', { class: 'btn', id: 'tjLockFollow', onclick: async () => { await act(() => ctx.jn.follow(jid, meta), '處理中…', '已追蹤'); } }, '☆ 追蹤這本日誌')));
  }

  /* ---------- 日誌頁 ---------- */
  const actionRow = (key, buttons) => (open[key] ? el('div', { class: 'tj-actions' }, buttons) : null);
  const moreBtn = key => el('button', { class: 'btn sm tj-more-btn', 'aria-label': '更多(上移、下移、刪除)', 'aria-expanded': open[key] ? 'true' : 'false', onclick: () => { open[key] = !open[key]; render(); } }, open[key] ? '收起' : '更多');
  // 編輯者看得到的一排字:「編輯」「更多」(更多 = 上移/下移/刪除)
  const editRow = (key, onEdit) => el('div', { class: 'tj-edit-row' }, el('button', { class: 'btn sm primary tj-edit-btn', onclick: onEdit }, '編輯'), moreBtn(key));

  function journalView(role) {
    const L = J(), meta = state.meta, j = state.j, canEdit = window.Policy.can(role, 'edit');
    const kids = [];
    kids.push(el('div', { class: 'card tj-info', id: 'tjInfo' },
      el('div', { class: 'tj-info-title' }, (meta.vis === 'private' ? '🔒 ' : '') + T(meta.title)),
      el('div', { class: 'muted' }, [L.fmtRange(meta.start, meta.end), L.roleText(role), role === 'owner' ? '' : '主編 ' + T(meta.ownerName)].filter(Boolean).join(' · '))));
    if (role !== 'owner') {
      kids.push(el('button', { class: 'big-btn' + (following ? '' : ' primary'), id: 'tjFollow', 'aria-pressed': following ? 'true' : 'false', onclick: async () => {
        await act(() => (following ? ctx.jn.unfollow(jid) : ctx.jn.follow(jid, meta)), '處理中…', following ? '已取消追蹤' : '已追蹤,會出現在「追蹤日誌」');
      } }, following ? '★ 已追蹤(按一下取消)' : '☆ 追蹤這本日誌'));
    }
    if (!role) {
      if (banned) kids.push(el('div', { class: 'banner warn', id: 'tjBannedNote' }, '你已被移出這本日誌,請主編把你加回。'));
      else if (meta.vis === 'public') kids.push(el('button', { class: 'big-btn primary', id: 'tjJoin', onclick: async () => {
        const r = await act(() => ctx.jn.joinPublic(jid, meta), '加入中…', '已加入');
        if (r.ok) sub();
      } }, '加入這本日誌'));
      else kids.push(el('div', { class: 'banner', id: 'tjPrivateNote' }, '這是私密日誌,需要團密碼才能加入。'));
    }
    if (role === 'member') {
      const pending = myReq && Number(myReq.at) + 86400000 > Date.now();
      kids.push(pending
        ? el('div', { class: 'banner', id: 'tjReqPending' }, '已申請成為副編,等主編同意(24 小時後可再申請)。')
        : el('button', { class: 'big-btn', id: 'tjReqEditor', onclick: async () => {
          const r = await act(() => ctx.jn.requestEditor(jid), '送出中…', '已送出申請');
          if (r.ok) { myReq = { at: Date.now() }; render(); }
        } }, '申請成為副編'));
    }
    // 宗旨
    const about = j.about, seenKey = 'tj_about_' + jid;
    let seen = ''; try { seen = localStorage.getItem(seenKey) || ''; } catch (_) { /* 略過 */ }
    const aboutStamp = about ? String(about.updatedAt || T(about.text).length) : '';
    const aboutOpen = !seen || seen !== aboutStamp;
    const leaderName = about ? ((about.leaderUid && state.members && state.members[about.leaderUid] && T(state.members[about.leaderUid].name)) || T(about.leader)) : '';
    kids.push(el('div', { class: 'card', id: 'tjAbout' },
      el('div', { class: 'row' }, el('b', { class: 'grow' }, '宗旨'), canEdit ? el('button', { class: 'btn sm primary', id: 'tjEditAbout', onclick: () => editAbout(about) }, '編輯宗旨') : null),
      about && (T(about.text) || leaderName || T(about.phone))
        ? el('details', { open: aboutOpen, ontoggle: e => { if (!e.target.open) { try { localStorage.setItem(seenKey, aboutStamp); } catch (_) { /* 略過 */ } } } },
          el('summary', { class: 'tj-sum' }, aboutOpen ? '收合' : '展開宗旨'),
          T(about.text) ? richText(T(about.text)) : null,
          leaderName ? el('div', { class: 'muted' }, '領隊:' + leaderName) : null,
          T(about.phone) ? el('div', { class: 'muted' }, '電話:' + T(about.phone)) : null)
        : el('div', { class: 'muted' }, canEdit ? '還沒有宗旨,按「編輯宗旨」寫一段給大家看' : '主編還沒有寫宗旨')));
    // 公告
    const notices = L.sortedList(j.notices).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    kids.push(el('div', { class: 'card', id: 'tjNotices' },
      el('div', { class: 'row' }, el('b', { class: 'grow' }, '公告'), canEdit ? el('button', { class: 'btn sm primary', id: 'tjAddNotice', onclick: () => editNotice(null) }, '＋公告') : null),
      notices.length ? notices.map(n => el('div', { class: 'tj-item', 'data-nid': n.id },
        el('details', { open: !!open['n' + n.id + 'x'], ontoggle: e => { open['n' + n.id + 'x'] = e.target.open; } },
          el('summary', { class: 'tj-sum' }, (n.pinned ? '📌 ' : '') + (T(n.title) || '(沒有標題)')),
          T(n.body) ? richText(T(n.body)) : el('div', { class: 'muted' }, '(沒有內容)')),
        canEdit ? [editRow('n' + n.id, () => editNotice(n)), actionRow('n' + n.id, [
          el('button', { class: 'btn sm', onclick: () => move('notices', j.notices, n.id, 'up') }, '上移'),
          el('button', { class: 'btn sm', onclick: () => move('notices', j.notices, n.id, 'down') }, '下移'),
          el('button', { class: 'btn sm danger', onclick: () => del('刪除公告「' + T(n.title) + '」?', () => ctx.jn.deleteNotice(jid, n.id)) }, '刪除')])] : null))
        : el('div', { class: 'muted' }, '目前沒有公告')));
    // 事件
    const events = L.sortedList(j.events);
    kids.push(el('div', { class: 'card', id: 'tjEvents' },
      el('div', { class: 'row' }, el('b', { class: 'grow' }, '事件'), canEdit ? el('button', { class: 'btn sm primary', id: 'tjAddEvent', onclick: () => editEvent(null, events.length) }, '＋事件') : null),
      events.length ? events.map((e, i) => {
        const blocks = L.sortedList((j.blocks || {})[e.id]);
        const icons = Array.from(new Set(blocks.map(b => ROLE_ICON[b.type] || '')));
        return el('div', { class: 'tj-item', 'data-eid': e.id },
          el('div', { class: 'tj-ev' },
            el('button', { class: 'tj-evmain', onclick: () => setHash('#/j/' + jid + '/e/' + e.id) },
              el('span', { class: 'tj-no sm' }, String(i + 1)),
              el('span', { class: 'tj-evt' }, el('b', {}, T(e.title)), el('small', {}, [L.md(T(e.date)), icons.join('')].filter(Boolean).join('  '))))),
          canEdit ? [editRow('e' + e.id, () => editEvent(e)), actionRow('e' + e.id, [
            el('button', { class: 'btn sm', onclick: () => move('events', j.events, e.id, 'up') }, '上移'),
            el('button', { class: 'btn sm', onclick: () => move('events', j.events, e.id, 'down') }, '下移'),
            el('button', { class: 'btn sm danger', onclick: () => del('刪除事件「' + T(e.title) + '」?' + (blocks.length ? '裡面的 ' + blocks.length + ' 個內容會一併刪除。' : ''), () => ctx.jn.deleteEvent(jid, e.id)) }, '刪除')])] : null);
      }) : el('div', { class: 'muted' }, canEdit ? '還沒有事件,按「＋事件」新增(例如:第一天)' : '目前沒有事件')));
    if (role === 'member' || role === 'editor') kids.push(el('div', { style: 'text-align:center;margin:14px 0' }, el('button', { class: 'btn sm', id: 'tjLeave', onclick: async () => { if (!confirm('要退出這本日誌嗎?')) return; const r = await act(() => ctx.jn.leave(jid), '處理中…', '已退出'); if (r.ok) setHash('#/'); } }, '退出日誌')));
    return kids;
  }

  /* ---------- 事件頁 ---------- */
  function eventView(role) {
    const L = J(), ev = (state.j.events || {})[route.eid], canEdit = window.Policy.can(role, 'edit');
    if (!ev) return el('div', { class: 'card', id: 'tjEvGone' }, '找不到這個事件(可能已被刪除)');
    titleEl.textContent = T(ev.title);
    const blocks = L.sortedList((state.j.blocks || {})[route.eid]);
    const kids = [el('div', { class: 'card', id: 'tjEvInfo' }, el('b', {}, T(ev.title)), el('div', { class: 'muted' }, L.md(T(ev.date)) || '沒有日期'),
      canEdit ? el('button', { class: 'btn sm primary', id: 'tjEditEvent', style: 'margin-top:6px', onclick: () => editEvent({ id: route.eid, title: ev.title, date: ev.date }) }, '編輯標題/日期') : null)];
    kids.push(el('div', { id: 'tjBlocks' }, blocks.length ? blocks.map(b => el('div', { class: 'tj-block', 'data-bid': b.id },
      b.type === 'nav' && L.isHttpsUrl(b.url)
        ? el('a', { class: 'big-btn', href: b.url, target: '_blank', rel: 'noopener noreferrer' }, el('span', { class: 'bi' }, '📍'), T(b.title))
        : el('div', { class: 'card' }, richText(T(b.text) || T(b.title))),
      canEdit ? [editRow('b' + b.id, () => editBlock(b)), actionRow('b' + b.id, [
        el('button', { class: 'btn sm', onclick: () => move('blocks/' + route.eid, (state.j.blocks || {})[route.eid], b.id, 'up') }, '上移'),
        el('button', { class: 'btn sm', onclick: () => move('blocks/' + route.eid, (state.j.blocks || {})[route.eid], b.id, 'down') }, '下移'),
        el('button', { class: 'btn sm danger', onclick: () => del('刪除這個內容?', () => ctx.jn.deleteBlock(jid, route.eid, b.id)) }, '刪除')])] : null))
      : el('div', { class: 'muted', style: 'padding:8px' }, canEdit ? '還沒有內容,按下面「＋ 加內容」' : '這個事件還沒有內容')));
    if (canEdit) kids.push(el('button', { class: 'big-btn primary', id: 'tjAddBlock', onclick: () => openAddContent() }, '＋ 加內容'));
    return kids;
  }

  /* ---------- 編輯動作 ---------- */
  const move = (path, map, id, dir) => act(() => ctx.jn.moveItem(jid, path, map, id, dir), '移動中…');
  const del = async (msg, fn) => { if (!confirm(msg)) return; await act(fn, '刪除中…', '已刪除'); };
  const stamp = get => () => { try { return Number(get()) || 0; } catch (_) { return 0; } };
  const editAbout = about => {
    const L = J(), meta = state.meta, opts = L.leaderOptions(state.members, meta.ownerUid);
    const members = state.members || {};
    let sel, other = '';
    if (about && about.leaderUid && members[about.leaderUid]) sel = about.leaderUid;
    else if (about && T(about.leader)) { sel = OTHER; other = T(about.leader); }
    else sel = opts.length ? meta.ownerUid : OTHER;
    if (sel !== OTHER && !opts.some(x => x.uid === sel)) sel = opts.length ? opts[0].uid : OTHER;
    openForm({
      title: '編輯宗旨', banner: meta.vis === 'public' ? '這是公開日誌:所有註冊的人(連結外流時連沒註冊的人)都看得到宗旨,不要寫不想公開的電話。' : null,
      guard: { cur: stamp(() => ((state.j.about || {}).updatedAt)), base: about ? about.updatedAt || 0 : 0 },
      fields: [
        { key: 'text', label: '宗旨', type: 'textarea', value: about && about.text, max: 2000 },
        { key: 'leaderSel', label: '領隊/團長', type: 'select', value: sel, options: opts.map(x => ({ value: x.uid, label: x.name })).concat([{ value: OTHER, label: '其他(自行輸入)' }]) },
        { key: 'leaderOther', label: '領隊名字', value: other, max: 30, showIf: { key: 'leaderSel', value: OTHER } },
        { key: 'phone', label: '聯絡電話', value: about && about.phone, max: 30 }],
      onSave: v => {
        const isOther = v.leaderSel === OTHER, pick = opts.find(x => x.uid === v.leaderSel);
        return ctx.jn.saveAbout(jid, { text: v.text, phone: v.phone, leaderUid: isOther ? '' : v.leaderSel, leader: isOther ? v.leaderOther.trim() : (pick ? pick.name : '') });
      },
    });
  };
  const editNotice = n => openForm({
    title: n ? '編輯公告' : '新增公告',
    guard: n ? { cur: stamp(() => ((state.j.notices || {})[n.id] || {}).updatedAt), base: n.updatedAt || 0 } : null,
    fields: [{ key: 'title', label: '標題', value: n && n.title, max: 60, required: true }, { key: 'body', label: '內容', type: 'textarea', value: n && n.body, max: 2000 }, { key: 'pinned', label: '置頂', type: 'checkbox', value: n && n.pinned }],
    onSave: (v, slot) => (n ? ctx.jn.updateNotice(jid, n.id, v) : (slot.cur = slot.cur || state.j.notices || {}, ctx.jn.addNotice(jid, v, slot))),
  });
  const editEvent = (e, count) => {
    const L = J(), meta = state.meta;
    let title = e ? T(e.title) : '', date = e ? T(e.date) : '';
    if (!e) {   // 新增:依開團日期帶「第N天」與日期
      const n = (count || 0) + 1;
      title = L.dayTitle(n); if (meta.start && n <= (L.dayCount(meta.start, meta.end) || 99)) date = L.addDays(meta.start, n - 1);
    }
    openForm({
      title: e ? '編輯事件' : '新增事件',
      guard: e ? { cur: stamp(() => ((state.j.events || {})[e.id] || {}).updatedAt), base: ((state.j.events || {})[e.id] || {}).updatedAt || 0 } : null,
      fields: [{ key: 'title', label: '事件標題', value: title, max: 60, required: true }, { key: 'date', label: '日期(選填)', type: 'date', value: date }],
      onSave: (v, slot) => (e ? ctx.jn.updateEvent(jid, e.id, v) : (slot.cur = slot.cur || state.j.events || {}, ctx.jn.addEvent(jid, v, slot))),
    });
  };
  const openAddContent = () => pushScreen('加內容', b2 => {
    b2.append(el('div', { class: 'big-grid' },
      el('button', { class: 'big-btn', id: 'addText', onclick: () => { popScreen(); editBlock({ type: 'text' }); } }, el('span', { class: 'bi' }, '📝'), '文字'),
      el('button', { class: 'big-btn', id: 'addNav', onclick: () => { popScreen(); editBlock({ type: 'nav' }); } }, el('span', { class: 'bi' }, '📍'), '導覽(標題+網址按鈕)')));
  });
  const editBlock = b => {
    const isNav = b.type === 'nav', isNew = !b.id;
    openForm({
      title: (isNew ? '新增' : '編輯') + (isNav ? '導覽' : '文字'),
      guard: isNew ? null : { cur: stamp(() => ((((state.j.blocks || {})[route.eid]) || {})[b.id] || {}).updatedAt), base: b.updatedAt || 0 },
      fields: isNav
        ? [{ key: 'title', label: '標題名稱(例如:動物園導引)', value: b.title, max: 60, required: true }, { key: 'url', label: '網址(Google 地圖分享連結等,https:// 開頭)', type: 'url', value: b.url, max: 2000, required: true }]
        : [{ key: 'text', label: '文字', type: 'textarea', value: b.text, max: 4000, required: true }],
      onSave: (v, slot) => {
        const f = Object.assign({ type: b.type }, v);
        if (!isNew) return ctx.jn.updateBlock(jid, route.eid, b.id, f);
        slot.cur = slot.cur || (state.j.blocks || {})[route.eid] || {};
        return ctx.jn.addBlock(jid, route.eid, f, slot);
      },
    });
  };

  sub();
  offF = ctx.jn.watchFollow(jid, v => { following = v; if (state && !disposed) render(); }, () => { /* 追蹤狀態讀不到就當沒追蹤 */ });
  return { el: sec, dispose() { disposed = true; if (off) off(); if (offF) offF(); sec.remove(); } };
}

/* ---------- 日誌設定頁(右上 ⚙)---------- */
function openSettings(jid, getState, role, resub, hook) {
  pushScreen('日誌設定', body => {
    const L = J(), acc = L.settingsAccess(role), meta = () => (getState() || {}).meta || {};
    const owner = role === 'owner';
    // 邀請成員
    const invBox = el('div', { class: 'card', id: 'tjInviteBox' }, el('b', {}, '邀請成員'), el('div', { class: 'muted', id: 'tjInvStatus' }, '讀取中…'));
    body.append(invBox);
    const base = location.origin + location.pathname;
    const drawInv = inv => {
      const ok = L.inviteValid(inv, Date.now()), mt = meta();
      const kids = [el('b', {}, '邀請成員')];
      if (!ok) {
        kids.push(el('div', { class: 'muted', id: 'tjInvStatus' }, inv ? '邀請連結已過期。' : '還沒有邀請連結。'),
          owner ? el('button', { class: 'btn primary', id: 'tjInvRegen', style: 'margin-top:8px', onclick: regen }, '產生邀請連結') : el('div', { class: 'muted small' }, '請主編產生邀請連結。'));
      } else {
        const url = L.inviteUrl(base, jid, inv.code), days = Math.max(1, Math.ceil((inv.exp - Date.now()) / 86400000));
        const text = '【' + T(mt.title) + '】' + (L.fmtRange(mt.start, mt.end) ? L.fmtRange(mt.start, mt.end) + '\n' : '\n') + '👉 加入日誌:' + url;
        kids.push(el('input', { type: 'text', readonly: true, id: 'tjInvUrl', value: url, onfocus: e => e.target.select() }),
          el('div', { class: 'muted small', id: 'tjInvStatus' }, '約 ' + days + ' 天後到期。' + (mt.vis === 'public' ? '公開日誌:拿到連結的人登入後就能加入。' : '私密日誌:拿到連結還要輸入團密碼才能加入(密碼請另外告訴對方)。')),
          el('div', { class: 'row wrap', style: 'margin-top:8px' },
            el('button', { class: 'btn', id: 'tjInvCopy', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('已複製連結'); } catch (_) { document.getElementById('tjInvUrl').select(); toast('請長按選取後複製', 2500); } } }, '複製連結'),
            el('a', { class: 'btn', id: 'tjInvLine', href: 'https://line.me/R/share?text=' + encodeURIComponent(text), target: '_blank', rel: 'noopener noreferrer' }, '分享到 LINE'),
            navigator.share ? el('button', { class: 'btn', id: 'tjInvShare', onclick: () => navigator.share({ text }).catch(() => { /* 取消 */ }) }, '其他分享') : null,
            owner ? el('button', { class: 'btn', id: 'tjInvRegen', onclick: regen }, '重新產生(舊連結失效)') : null));
      }
      invBox.replaceChildren(...kids);
    };
    const regen = async () => {
      if (!confirm('重新產生後,舊的邀請連結會失效。要繼續嗎?')) return;
      const r = await act(() => ctx.jn.regenInvite(jid), '產生中…', '已產生新連結');
      if (r.ok) drawInv(r.value);
    };
    ctx.jn.getInvite(jid).then(drawInv).catch(e => { const x = invBox.querySelector('#tjInvStatus'); if (x) x.textContent = e.message || '讀取失敗'; });

    // 成員(主編:指定/取消副編、移出、副編申請、已移出名單與加回)
    const extra = { reqs: null, bans: null };
    const memBox = el('div', { class: 'card', id: 'tjMembers' });
    const loadExtra = async () => {
      if (owner) {
        try { extra.reqs = (await ctx.jn.listReqs(jid)) || {}; } catch (_) { extra.reqs = null; }
        try { extra.bans = (await ctx.jn.listBans(jid)) || {}; } catch (_) { extra.bans = null; }
      }
      drawMembers();
    };
    const doThen = async (fn, text, ok) => { const r = await act(fn, text, ok); await loadExtra(); return r; };
    const drawMembers = () => {
      const st = getState() || {}, rank = { owner: 0, editor: 1, member: 2 };
      const members = st.members ? Object.keys(st.members).map(u => Object.assign({ uid: u }, st.members[u])) : [];
      members.sort((a, b) => (rank[a.role] - rank[b.role]) || (a.joinedAt - b.joinedAt));
      const kids = [el('b', {}, '成員(' + members.length + ')')];
      members.forEach(m => {
        const nm = T(m.name) || '(未命名)';
        kids.push(el('div', { class: 'tj-mem-row', 'data-uid': m.uid },
          el('span', { class: 'grow' }, nm + (m.uid === ctx.uid ? '(我)' : '')), el('span', { class: 'tag' }, L.roleText(m.role)),
          owner && m.role !== 'owner' ? [
            el('button', { class: 'btn sm', 'data-act': 'role', onclick: () => doThen(() => ctx.jn.setRole(jid, m.uid, m.role === 'editor' ? 'member' : 'editor'), '處理中…', m.role === 'editor' ? '已取消副編' : '已設為副編') }, m.role === 'editor' ? '取消副編' : '設為副編'),
            el('button', { class: 'btn sm danger', 'data-act': 'remove', onclick: () => { if (confirm('要把「' + nm + '」移出這本日誌嗎?\n被移出的人不能自己再加入(換了密碼也一樣),要你按「加回」才能回來。')) doThen(() => ctx.jn.removeMember(jid, m.uid, nm), '處理中…', '已移出'); } }, '移出')] : null));
      });
      if (owner) {
        const reqs = extra.reqs ? Object.keys(extra.reqs) : [];
        if (reqs.length) {
          kids.push(el('div', { class: 'muted', style: 'margin-top:10px' }, '副編申請'));
          reqs.forEach(u => kids.push(el('div', { class: 'tj-mem-row', 'data-req': u },
            el('span', { class: 'grow' }, T(extra.reqs[u].name) || '(未命名)'),
            (st.members && st.members[u]) ? [
              el('button', { class: 'btn sm primary', 'data-act': 'approve', onclick: () => doThen(() => ctx.jn.setRole(jid, u, 'editor'), '處理中…', '已同意') }, '同意'),
              el('button', { class: 'btn sm', 'data-act': 'reject', onclick: () => doThen(() => ctx.jn.rejectReq(jid, u), '處理中…', '已拒絕') }, '拒絕')]
              : el('button', { class: 'btn sm', onclick: () => doThen(() => ctx.jn.rejectReq(jid, u), '處理中…') }, '清除'))));
        }
        const bans = extra.bans ? Object.keys(extra.bans) : [];
        if (bans.length) {
          kids.push(el('div', { class: 'muted', style: 'margin-top:10px' }, '已移出的人'));
          bans.forEach(u => kids.push(el('div', { class: 'tj-mem-row', 'data-ban': u },
            el('span', { class: 'grow' }, T(extra.bans[u].name) || '(未命名)'),
            el('button', { class: 'btn sm primary', 'data-act': 'addback', onclick: () => doThen(() => ctx.jn.addBack(jid, u, T(extra.bans[u].name)), '處理中…', '已加回') }, '加回'))));
        }
      }
      memBox.replaceChildren(...kids);
    };
    body.append(memBox);
    drawMembers(); loadExtra();

    // 公開/私密與團密碼(副編只能看密碼)
    const pvBox = el('div', { class: 'card', id: 'tjPrivacy' });
    let pwShown = null;
    const ruleText = () => { const r = L.pwRule(); return (r.min === r.max ? r.min : r.min + '~' + r.max) + (r.digits ? ' 位數字' : ' 個字'); };
    const drawPrivacy = () => {
      const mt = meta(), priv = mt.vis === 'private';
      const kids = [el('b', {}, '公開 / 私密、團密碼'), el('div', { class: 'muted small', id: 'tjVisNow' }, '目前:' + (priv ? '🔒 私密(要團密碼才能加入)' : '🌐 公開(登入的人都能加入)'))];
      if (priv) {
        kids.push(el('div', { class: 'row wrap', style: 'margin-top:8px' },
          el('button', { class: 'btn', id: 'stShowPw', onclick: async () => {
            if (pwShown !== null) { pwShown = null; drawPrivacy(); return; }
            const r = await act(() => ctx.jn.getSecret(jid), '讀取中…');
            if (r.ok) { pwShown = T(r.value && r.value.pw) || '(沒有密碼)'; drawPrivacy(); }
          } }, pwShown !== null ? '隱藏團密碼' : '顯示團密碼')));
        if (pwShown !== null) kids.push(el('div', { class: 'tj-pwbox', id: 'tjPwShown' }, pwShown));
      }
      if (owner) {
        kids.push(el('div', { class: 'row wrap', style: 'margin-top:8px' },
          el('button', { class: 'btn', id: 'stVis', onclick: () => (priv ? toPublic() : toPrivate()) }, priv ? '改成公開' : '改成私密'),
          priv ? el('button', { class: 'btn', id: 'stPw', onclick: changePw }, '修改團密碼') : null),
        el('div', { class: 'muted small' }, '團密碼規則:' + ruleText()));
      }
      pvBox.replaceChildren(...kids);
    };
    const pwField = (key, label) => { const r = L.pwRule(); return { key, label, value: '', max: r.max, inputmode: r.digits ? 'numeric' : null, required: true }; };
    const toPrivate = () => openForm({
      title: '改成私密', okText: '改成私密',
      banner: '改成私密後,現有成員不受影響;新的人要輸入團密碼才能加入。團密碼:' + ruleText() + '。',
      fields: [pwField('pw', '設定團密碼')],
      onSave: async v => { await ctx.jn.setVisibility(jid, 'private', v.pw.trim()); pwShown = null; setTimeout(drawPrivacy, 400); },
    });
    const toPublic = async () => {
      if (!confirm('改成公開後,所有登入的人都能加入,連結外流時沒註冊的人也看得到內容。要繼續嗎?')) return;
      const r = await act(() => ctx.jn.setVisibility(jid, 'public'), '處理中…', '已改成公開');
      if (r.ok) { pwShown = null; setTimeout(drawPrivacy, 400); }
    };
    const changePw = () => openForm({
      title: '修改團密碼', okText: '改密碼',
      banner: '改密碼不會踢掉現有成員;舊密碼立刻失效。團密碼:' + ruleText() + '。',
      fields: [pwField('pw', '新的團密碼'), pwField('pw2', '再輸入一次')],
      onSave: async v => {
        if (v.pw !== v.pw2) throw new Error('兩次輸入的密碼不一樣');
        await ctx.jn.changePassword(jid, v.pw.trim()); pwShown = null; setTimeout(drawPrivacy, 400);
      },
    });
    body.append(pvBox);
    drawPrivacy();
    hook.fn = () => { drawMembers(); drawPrivacy(); };
    if (!acc.manage) return;

    // 開團日期(主編)
    const mt0 = meta();
    const t = el('input', { type: 'text', id: 'stTitle', maxlength: 60, value: T(mt0.title) });
    const s = el('input', { type: 'date', id: 'stStart', value: T(mt0.start) }), e = el('input', { type: 'date', id: 'stEnd', value: T(mt0.end) });
    const err = el('div', { class: 'banner warn', id: 'stErr', style: 'display:none' });
    t.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); t.blur(); } };
    body.append(el('div', { class: 'card', id: 'tjDates' }, el('b', {}, '標題與開團日期'), err,
      el('label', { class: 'f', for: 'stTitle' }, '標題'), t,
      el('div', { class: 'two-col' }, el('div', {}, el('label', { class: 'f', for: 'stStart' }, '出發日'), s), el('div', {}, el('label', { class: 'f', for: 'stEnd' }, '回程日'), e)),
      el('button', { class: 'btn primary', id: 'stSave', style: 'margin-top:8px', onclick: async () => {
        err.style.display = 'none';
        const r = await act(() => ctx.jn.updateJournalMeta(jid, meta(), { title: t.value, start: s.value, end: e.value }), '儲存中…', '已儲存');
        if (!r.ok) { err.textContent = (r.error && r.error.message) || '儲存失敗'; err.style.display = ''; }
      } }, '儲存')));
    // 刪除日誌
    const conf = el('input', { type: 'text', id: 'stDelConfirm', placeholder: '輸入日誌標題確認' });
    const delBtn = el('button', { class: 'big-btn danger', id: 'stDelete', disabled: true, onclick: async () => {
      const r = await act(() => ctx.jn.deleteJournal(jid), '刪除中…', '日誌已刪除');
      if (r.ok) { popScreen(); setHash('#/'); }
    } }, '刪除這本日誌');
    conf.oninput = () => { delBtn.disabled = conf.value.trim() !== T(meta().title); };
    body.append(el('div', { class: 'card', id: 'tjDelete' }, el('b', { style: 'color:var(--danger)' }, '刪除日誌'), el('div', { class: 'muted small' }, '會刪除全部宗旨、公告、事件與成員,無法復原。'), conf, el('div', { style: 'margin-top:8px' }, delBtn)));
  }, () => { hook.fn = null; });
}
