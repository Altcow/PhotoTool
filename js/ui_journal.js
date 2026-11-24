// 日誌頁、事件頁、日誌設定頁(右上 ⚙)與共用編輯表單。資料來自 ctx.jn(journalnet.js)。
import { el, pushScreen, popScreen, toast } from './app.js';
import { ctx, accountChip, richText, setHash } from './tjctx.js';

const J = () => window.Journal;
const ROLE_ICON = { text: '📝', nav: '📍', photo: '🖼', file: '📄', menu: '🍽' };

/* ---------- 共用:表單頁 ---------- */
// fields: [{key,label,type:'text'|'textarea'|'date'|'checkbox',value,max,hint,required}]
// guard: {read:()=>Promise<number>, base:number}(儲存前比對 updatedAt,有人剛改過就問是否覆蓋)
function openForm({ title, fields, banner, guard, okText, onSave }) {
  pushScreen(title, body => {
    const inputs = {};
    const err = el('div', { class: 'banner warn', id: 'frmErr', style: 'display:none' });
    body.append(err);
    if (banner) body.append(el('div', { class: 'banner', id: 'frmBanner' }, banner));
    fields.forEach(f => {
      let inp;
      if (f.type === 'textarea') inp = el('textarea', { id: 'f_' + f.key, rows: 6, maxlength: f.max || null }, f.value || '');
      else if (f.type === 'checkbox') inp = el('input', { type: 'checkbox', id: 'f_' + f.key, checked: !!f.value, style: 'width:22px;height:22px' });
      else inp = el('input', { type: f.type || 'text', id: 'f_' + f.key, maxlength: f.max || null, placeholder: f.placeholder || '' });
      if (f.type === 'textarea') inp.value = f.value || ''; else if (f.type !== 'checkbox') inp.value = f.value || '';
      inputs[f.key] = inp;
      if (f.type === 'checkbox') body.append(el('label', { class: 'row', style: 'margin:12px 0' }, inp, f.label));
      else body.append(el('label', { class: 'f', for: 'f_' + f.key }, f.label + (f.required ? '(必填)' : '')), inp, f.hint ? el('div', { class: 'muted small' }, f.hint) : null);
    });
    const ok = el('button', { class: 'big-btn primary', id: 'frmOk', style: 'margin-top:16px' }, okText || '儲存');
    ok.onclick = async () => {
      const v = {};
      fields.forEach(f => { v[f.key] = f.type === 'checkbox' ? inputs[f.key].checked : inputs[f.key].value; });
      ok.disabled = true; err.style.display = 'none';
      try {
        if (guard) {
          const now = await guard.read();
          if (now !== guard.base && !confirm('有人剛改過這份內容,要用你的版本覆蓋嗎?')) { ok.disabled = false; return; }
        }
        await onSave(v);
        popScreen();
      } catch (e) { err.textContent = e.message || '儲存失敗'; err.style.display = ''; ok.disabled = false; }
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
  let state = null, locked = false, off = null, offF = null, following = false, disposed = false, open = {};
  const roleNow = () => (state && state.meta ? window.Policy.roleOf(ctx.uid, state.meta, state.members) : null);

  const sub = () => {
    if (off) off();
    state = null; locked = false;
    off = ctx.jn.subscribeJournal(jid, v => { state = v; dot.textContent = ''; if (!disposed) render(); }, e => {
      if (disposed) return;
      if (e && e.code === 'PERMISSION') { locked = true; render(); }
      else if (e && e.soft) dot.textContent = '重新連線中…';
      else { dot.textContent = '離線'; }
    });
  };
  const render = () => {
    gearHolder.replaceChildren();
    if (locked) { titleEl.textContent = '日誌'; body.replaceChildren(lockedView()); return; }
    if (!state) { body.replaceChildren(el('div', { class: 'muted', id: 'tjLoading' }, '讀取中…')); return; }
    if (!state.meta) { titleEl.textContent = '日誌'; body.replaceChildren(goneView()); return; }
    titleEl.textContent = state.meta.title;
    const role = roleNow();
    if (J().settingsAccess(role).gear) gearHolder.append(el('button', { class: 'tj-gear', id: 'tjGear', 'aria-label': '日誌設定', onclick: () => openSettings(jid, () => state, role, sub) }, '⚙'));
    body.replaceChildren(...[].concat(route.eid ? eventView(role) : journalView(role)));
  };

  const lockedView = () => el('div', { class: 'card', id: 'tjLocked' }, el('b', {}, '🔒 這本日誌不公開'), el('p', { class: 'muted' }, '只有成員能看。請向主編要邀請連結或密碼。'));
  const goneView = () => el('div', { class: 'card', id: 'tjGone' }, el('b', {}, '這本日誌已刪除或不存在'),
    el('div', { style: 'margin-top:8px' }, el('button', { class: 'btn', id: 'tjRemoveFromList', onclick: async () => { try { await ctx.jn.removeFromList(jid); toast('已從清單移除'); setHash('#/'); } catch (e) { toast(e.message, 2500); } } }, '從清單移除')));

  /* ---------- 日誌頁 ---------- */
  const actionRow = (key, buttons) => (open[key] ? el('div', { class: 'tj-actions' }, buttons) : null);
  const moreBtn = key => el('button', { class: 'tj-more', 'aria-label': '更多', onclick: () => { open[key] = !open[key]; render(); } }, '⋯');

  function journalView(role) {
    const L = J(), meta = state.meta, j = state.j, canEdit = window.Policy.can(role, 'edit');
    const kids = [];
    kids.push(el('div', { class: 'card tj-info', id: 'tjInfo' },
      el('div', { class: 'tj-info-title' }, (meta.vis === 'private' ? '🔒 ' : '') + meta.title),
      el('div', { class: 'muted' }, [L.fmtRange(meta.start, meta.end), L.roleText(role), role === 'owner' ? '' : '主編 ' + meta.ownerName].filter(Boolean).join(' · '))));
    if (role !== 'owner') {
      kids.push(el('button', { class: 'big-btn' + (following ? '' : ' primary'), id: 'tjFollow', 'aria-pressed': following ? 'true' : 'false', onclick: async ev => {
        ev.currentTarget.disabled = true;
        try { if (following) { await ctx.jn.unfollow(jid); toast('已取消追蹤'); } else { await ctx.jn.follow(jid, meta); toast('已追蹤,會出現在「追蹤日誌」'); } }
        catch (e) { toast(e.message || '操作失敗', 2500); ev.currentTarget.disabled = false; }
      } }, following ? '★ 已追蹤(按一下取消)' : '☆ 追蹤這本日誌'));
    }
    if (!role) {
      kids.push(meta.vis === 'public'
        ? el('button', { class: 'big-btn primary', id: 'tjJoin', onclick: async ev => {
          ev.currentTarget.disabled = true;
          try { await ctx.jn.joinPublic(jid, meta); toast('已加入'); sub(); } catch (e) { toast(e.message || '加入失敗', 3000); ev.currentTarget.disabled = false; }
        } }, '加入這本日誌')
        : el('div', { class: 'banner', id: 'tjPrivateNote' }, '這是私密日誌,需要密碼才能加入(下一版開放)。'));
    }
    // 宗旨
    const about = j.about, seenKey = 'tj_about_' + jid;
    let seen = ''; try { seen = localStorage.getItem(seenKey) || ''; } catch (_) { /* 略過 */ }
    const aboutStamp = about ? String(about.updatedAt || about.text.length) : '';
    const aboutOpen = !seen || seen !== aboutStamp;
    kids.push(el('div', { class: 'card', id: 'tjAbout' },
      el('div', { class: 'row' }, el('b', { class: 'grow' }, '宗旨'), canEdit ? el('button', { class: 'btn sm', id: 'tjEditAbout', onclick: () => editAbout(about) }, '編輯宗旨') : null),
      about && (about.text || about.leader || about.phone)
        ? el('details', { open: aboutOpen, ontoggle: e => { if (!e.target.open) { try { localStorage.setItem(seenKey, aboutStamp); } catch (_) { /* 略過 */ } } } },
          el('summary', { class: 'tj-sum' }, aboutOpen ? '收合' : '展開宗旨'),
          about.text ? richText(about.text) : null,
          about.leader ? el('div', { class: 'muted' }, '領隊:' + about.leader) : null,
          about.phone ? el('div', { class: 'muted' }, '電話:' + about.phone) : null)
        : el('div', { class: 'muted' }, canEdit ? '還沒有宗旨,按「編輯宗旨」寫一段給大家看' : '主編還沒有寫宗旨')));
    // 公告
    const notices = L.sortedList(j.notices).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    kids.push(el('div', { class: 'card', id: 'tjNotices' },
      el('div', { class: 'row' }, el('b', { class: 'grow' }, '公告'), canEdit ? el('button', { class: 'btn sm', id: 'tjAddNotice', onclick: () => editNotice(null) }, '＋公告') : null),
      notices.length ? notices.map(n => el('div', { class: 'tj-item', 'data-nid': n.id },
        el('details', { open: !!open['n' + n.id + 'x'], ontoggle: e => { open['n' + n.id + 'x'] = e.target.open; } },
          el('summary', { class: 'tj-sum' }, (n.pinned ? '📌 ' : '') + n.title),
          n.body ? richText(n.body) : el('div', { class: 'muted' }, '(沒有內容)')),
        canEdit ? [moreBtn('n' + n.id), actionRow('n' + n.id, [
          el('button', { class: 'btn sm', onclick: () => editNotice(n) }, '編輯'),
          el('button', { class: 'btn sm', onclick: () => move('notices', j.notices, n.id, 'up') }, '上移'),
          el('button', { class: 'btn sm', onclick: () => move('notices', j.notices, n.id, 'down') }, '下移'),
          el('button', { class: 'btn sm danger', onclick: () => del('刪除公告「' + n.title + '」?', () => ctx.jn.deleteNotice(jid, n.id)) }, '刪除')])] : null))
        : el('div', { class: 'muted' }, '目前沒有公告')));
    // 事件
    const events = L.sortedList(j.events);
    kids.push(el('div', { class: 'card', id: 'tjEvents' },
      el('div', { class: 'row' }, el('b', { class: 'grow' }, '事件'), canEdit ? el('button', { class: 'btn sm', id: 'tjAddEvent', onclick: () => editEvent(null, events.length) }, '＋事件') : null),
      events.length ? events.map((e, i) => {
        const blocks = L.sortedList((j.blocks || {})[e.id]);
        const icons = Array.from(new Set(blocks.map(b => ROLE_ICON[b.type] || '')));
        return el('div', { class: 'tj-item', 'data-eid': e.id },
          el('div', { class: 'tj-ev' },
            el('button', { class: 'tj-evmain', onclick: () => setHash('#/j/' + jid + '/e/' + e.id) },
              el('span', { class: 'tj-no sm' }, String(i + 1)),
              el('span', { class: 'tj-evt' }, el('b', {}, e.title), el('small', {}, [L.md(e.date), icons.join('')].filter(Boolean).join('  ')))),
            canEdit ? moreBtn('e' + e.id) : null),
          canEdit ? actionRow('e' + e.id, [
            el('button', { class: 'btn sm', onclick: () => editEvent(e) }, '編輯'),
            el('button', { class: 'btn sm', onclick: () => move('events', j.events, e.id, 'up') }, '上移'),
            el('button', { class: 'btn sm', onclick: () => move('events', j.events, e.id, 'down') }, '下移'),
            el('button', { class: 'btn sm danger', onclick: () => del('刪除事件「' + e.title + '」?' + (blocks.length ? '裡面的 ' + blocks.length + ' 個內容會一併刪除。' : ''), () => ctx.jn.deleteEvent(jid, e.id)) }, '刪除')]) : null);
      }) : el('div', { class: 'muted' }, canEdit ? '還沒有事件,按「＋事件」新增(例如:第一天)' : '目前沒有事件')));
    if (role === 'member' || role === 'editor') kids.push(el('div', { style: 'text-align:center;margin:14px 0' }, el('button', { class: 'btn sm', id: 'tjLeave', onclick: () => { if (confirm('要退出這本日誌嗎?')) ctx.jn.leave(jid).then(() => { toast('已退出'); setHash('#/'); }).catch(e => toast(e.message, 2500)); } }, '退出日誌')));
    return kids;
  }

  /* ---------- 事件頁 ---------- */
  function eventView(role) {
    const L = J(), ev = (state.j.events || {})[route.eid], canEdit = window.Policy.can(role, 'edit');
    if (!ev) return el('div', { class: 'card', id: 'tjEvGone' }, '找不到這個事件(可能已被刪除)');
    titleEl.textContent = ev.title;
    const blocks = L.sortedList((state.j.blocks || {})[route.eid]);
    const kids = [el('div', { class: 'card', id: 'tjEvInfo' }, el('b', {}, ev.title), el('div', { class: 'muted' }, L.md(ev.date) || '沒有日期'),
      canEdit ? el('button', { class: 'btn sm', id: 'tjEditEvent', style: 'margin-top:6px', onclick: () => editEvent({ id: route.eid, title: ev.title, date: ev.date }) }, '編輯標題/日期') : null)];
    kids.push(el('div', { id: 'tjBlocks' }, blocks.length ? blocks.map(b => el('div', { class: 'tj-block', 'data-bid': b.id },
      b.type === 'nav' && L.isHttpsUrl(b.url)
        ? el('a', { class: 'big-btn', href: b.url, target: '_blank', rel: 'noopener noreferrer' }, el('span', { class: 'bi' }, '📍'), b.title)
        : el('div', { class: 'card' }, richText(b.text || b.title || '')),
      canEdit ? [el('div', { style: 'text-align:right' }, moreBtn('b' + b.id)), actionRow('b' + b.id, [
        el('button', { class: 'btn sm', onclick: () => editBlock(b) }, '編輯'),
        el('button', { class: 'btn sm', onclick: () => move('blocks/' + route.eid, (state.j.blocks || {})[route.eid], b.id, 'up') }, '上移'),
        el('button', { class: 'btn sm', onclick: () => move('blocks/' + route.eid, (state.j.blocks || {})[route.eid], b.id, 'down') }, '下移'),
        el('button', { class: 'btn sm danger', onclick: () => del('刪除這個內容?', () => ctx.jn.deleteBlock(jid, route.eid, b.id)) }, '刪除')])] : null))
      : el('div', { class: 'muted', style: 'padding:8px' }, canEdit ? '還沒有內容,按下面「＋ 加內容」' : '這個事件還沒有內容')));
    if (canEdit) kids.push(el('button', { class: 'big-btn primary', id: 'tjAddBlock', onclick: () => openAddContent() }, '＋ 加內容'));
    return kids;
  }

  /* ---------- 編輯動作 ---------- */
  const move = async (path, map, id, dir) => { try { await ctx.jn.moveItem(jid, path, map, id, dir); } catch (e) { toast(e.message || '移動失敗', 2500); } };
  const del = async (msg, fn) => { if (!confirm(msg)) return; try { await fn(); toast('已刪除'); } catch (e) { toast(e.message || '刪除失敗', 2500); } };
  const editAbout = about => openForm({
    title: '編輯宗旨', banner: state.meta.vis === 'public' ? '這是公開日誌:所有註冊的人(連結外流時連沒註冊的人)都看得到宗旨,不要寫不想公開的電話。' : null,
    guard: { read: () => ctx.jn.readUpdatedAt('j/' + jid + '/about'), base: about ? about.updatedAt || 0 : 0 },
    fields: [{ key: 'text', label: '宗旨', type: 'textarea', value: about && about.text, max: 2000 }, { key: 'leader', label: '領隊/團長', value: about && about.leader, max: 30 }, { key: 'phone', label: '聯絡電話', value: about && about.phone, max: 30 }],
    onSave: v => ctx.jn.saveAbout(jid, v),
  });
  const editNotice = n => openForm({
    title: n ? '編輯公告' : '新增公告',
    guard: n ? { read: () => ctx.jn.readUpdatedAt('j/' + jid + '/notices/' + n.id), base: n.updatedAt || 0 } : null,
    fields: [{ key: 'title', label: '標題', value: n && n.title, max: 60, required: true }, { key: 'body', label: '內容', type: 'textarea', value: n && n.body, max: 2000 }, { key: 'pinned', label: '置頂', type: 'checkbox', value: n && n.pinned }],
    onSave: v => (n ? ctx.jn.updateNotice(jid, n.id, v) : ctx.jn.addNotice(jid, v)),
  });
  const editEvent = (e, count) => {
    const L = J(), meta = state.meta;
    let title = e ? e.title : '', date = e ? e.date : '';
    if (!e) {   // 新增:依開團日期帶「第N天」與日期
      const n = (count || 0) + 1;
      title = L.dayTitle(n); if (meta.start && n <= (L.dayCount(meta.start, meta.end) || 99)) date = L.addDays(meta.start, n - 1);
    }
    openForm({
      title: e ? '編輯事件' : '新增事件',
      guard: e ? { read: () => ctx.jn.readUpdatedAt('j/' + jid + '/events/' + e.id), base: (state.j.events[e.id] || {}).updatedAt || 0 } : null,
      fields: [{ key: 'title', label: '事件標題', value: title, max: 60, required: true }, { key: 'date', label: '日期(選填)', type: 'date', value: date }],
      onSave: v => (e ? ctx.jn.updateEvent(jid, e.id, v) : ctx.jn.addEvent(jid, v)),
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
      guard: isNew ? null : { read: () => ctx.jn.readUpdatedAt('j/' + jid + '/blocks/' + route.eid + '/' + b.id), base: b.updatedAt || 0 },
      fields: isNav
        ? [{ key: 'title', label: '標題名稱(例如:動物園導引)', value: b.title, max: 60, required: true }, { key: 'url', label: '網址(Google 地圖分享連結等,https:// 開頭)', type: 'url', value: b.url, max: 2000, required: true }]
        : [{ key: 'text', label: '文字', type: 'textarea', value: b.text, max: 4000, required: true }],
      onSave: v => { const f = Object.assign({ type: b.type }, v); return isNew ? ctx.jn.addBlock(jid, route.eid, f) : ctx.jn.updateBlock(jid, route.eid, b.id, f); },
    });
  };

  sub();
  offF = ctx.jn.watchFollow(jid, v => { following = v; if (state && !disposed) render(); }, () => { /* 追蹤狀態讀不到就當沒追蹤 */ });
  return { el: sec, dispose() { disposed = true; if (off) off(); if (offF) offF(); sec.remove(); } };
}

/* ---------- 日誌設定頁(右上 ⚙)---------- */
function openSettings(jid, getState, role, resub) {
  pushScreen('日誌設定', body => {
    const L = J(), st = getState(), meta = st.meta, acc = L.settingsAccess(role);
    // 邀請成員
    const invBox = el('div', { class: 'card', id: 'tjInviteBox' }, el('b', {}, '邀請成員'), el('div', { class: 'muted', id: 'tjInvStatus' }, '讀取中…'));
    body.append(invBox);
    const base = location.origin + location.pathname;
    const drawInv = inv => {
      const ok = L.inviteValid(inv, Date.now());
      const kids = [el('b', {}, '邀請成員')];
      if (!ok) {
        kids.push(el('div', { class: 'muted', id: 'tjInvStatus' }, inv ? '邀請連結已過期。' : '還沒有邀請連結。'),
          role === 'owner' ? el('button', { class: 'btn primary', id: 'tjInvRegen', style: 'margin-top:8px', onclick: regen }, '產生邀請連結') : el('div', { class: 'muted small' }, '請主編產生邀請連結。'));
      } else {
        const url = L.inviteUrl(base, jid, inv.code), days = Math.max(1, Math.ceil((inv.exp - Date.now()) / 86400000));
        const text = '【' + meta.title + '】' + (L.fmtRange(meta.start, meta.end) ? L.fmtRange(meta.start, meta.end) + '\n' : '\n') + '👉 加入日誌:' + url;
        kids.push(el('input', { type: 'text', readonly: true, id: 'tjInvUrl', value: url, onfocus: e => e.target.select() }),
          el('div', { class: 'muted small', id: 'tjInvStatus' }, '約 ' + days + ' 天後到期。' + (meta.vis === 'public' ? '公開日誌:拿到連結的人登入後就能加入。' : '')),
          el('div', { class: 'row wrap', style: 'margin-top:8px' },
            el('button', { class: 'btn', id: 'tjInvCopy', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('已複製連結'); } catch (_) { document.getElementById('tjInvUrl').select(); toast('請長按選取後複製', 2500); } } }, '複製連結'),
            el('a', { class: 'btn', id: 'tjInvLine', href: 'https://line.me/R/share?text=' + encodeURIComponent(text), target: '_blank', rel: 'noopener noreferrer' }, '分享到 LINE'),
            navigator.share ? el('button', { class: 'btn', id: 'tjInvShare', onclick: () => navigator.share({ text }).catch(() => { /* 取消 */ }) }, '其他分享') : null,
            role === 'owner' ? el('button', { class: 'btn', id: 'tjInvRegen', onclick: regen }, '重新產生(舊連結失效)') : null));
      }
      invBox.replaceChildren(...kids);
    };
    const regen = async () => {
      if (!confirm('重新產生後,舊的邀請連結會失效。要繼續嗎?')) return;
      try { drawInv(await ctx.jn.regenInvite(jid)); toast('已產生新連結'); } catch (e) { toast(e.message || '失敗', 2500); }
    };
    ctx.jn.getInvite(jid).then(drawInv).catch(e => { invBox.querySelector('#tjInvStatus').textContent = e.message || '讀取失敗'; });

    // 成員列表
    const members = st.members ? Object.keys(st.members).map(u => Object.assign({ uid: u }, st.members[u])) : [];
    const rank = { owner: 0, editor: 1, member: 2 };
    members.sort((a, b) => (rank[a.role] - rank[b.role]) || (a.joinedAt - b.joinedAt));
    body.append(el('div', { class: 'card', id: 'tjMembers' }, el('b', {}, '成員(' + members.length + ')'),
      members.map(m => el('div', { class: 'tj-mem' }, el('span', {}, m.name + (m.uid === ctx.uid ? '(我)' : '')), el('span', { class: 'tag' }, L.roleText(m.role)))),
      role === 'owner' ? el('div', { class: 'muted small' }, '指定副編、移除成員將在下一版開放。') : null));
    if (!acc.manage) return;

    // 開團日期(主編)
    const t = el('input', { type: 'text', id: 'stTitle', maxlength: 60, value: meta.title });
    const s = el('input', { type: 'date', id: 'stStart', value: meta.start || '' }), e = el('input', { type: 'date', id: 'stEnd', value: meta.end || '' });
    const err = el('div', { class: 'banner warn', id: 'stErr', style: 'display:none' });
    body.append(el('div', { class: 'card', id: 'tjDates' }, el('b', {}, '標題與開團日期'), err,
      el('label', { class: 'f', for: 'stTitle' }, '標題'), t,
      el('div', { class: 'two-col' }, el('div', {}, el('label', { class: 'f', for: 'stStart' }, '出發日'), s), el('div', {}, el('label', { class: 'f', for: 'stEnd' }, '回程日'), e)),
      el('button', { class: 'btn primary', id: 'stSave', style: 'margin-top:8px', onclick: async () => {
        try { err.style.display = 'none'; await ctx.jn.updateJournalMeta(jid, st.meta, { title: t.value, start: s.value, end: e.value }); toast('已儲存'); }
        catch (x) { err.textContent = x.message || '儲存失敗'; err.style.display = ''; }
      } }, '儲存')));
    body.append(el('div', { class: 'card', id: 'tjPrivacy' }, el('b', {}, '公開 / 私密、團密碼'),
      el('div', { class: 'muted small' }, '目前:' + (meta.vis === 'private' ? '🔒 私密' : '🌐 公開') + '。切換公開/私密與修改團密碼將在下一版開放。'),
      el('div', { class: 'row wrap', style: 'margin-top:8px' }, el('button', { class: 'btn', id: 'stVis', disabled: true }, '切換公開/私密'), el('button', { class: 'btn', id: 'stPw', disabled: true }, '修改團密碼'))));
    // 刪除日誌
    const conf = el('input', { type: 'text', id: 'stDelConfirm', placeholder: '輸入日誌標題確認' });
    const delBtn = el('button', { class: 'big-btn danger', id: 'stDelete', disabled: true, onclick: async () => {
      try { await ctx.jn.deleteJournal(jid); popScreen(); toast('日誌已刪除'); setHash('#/'); } catch (x) { toast(x.message || '刪除失敗(可再按一次)', 3000); }
    } }, '刪除這本日誌');
    conf.oninput = () => { delBtn.disabled = conf.value.trim() !== meta.title; };
    body.append(el('div', { class: 'card', id: 'tjDelete' }, el('b', { style: 'color:var(--danger)' }, '刪除日誌'), el('div', { class: 'muted small' }, '會刪除全部宗旨、公告、事件與成員,無法復原。'), conf, el('div', { style: 'margin-top:8px' }, delBtn)));
  });
}
