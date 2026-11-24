// 旅遊日誌外殼:登入分流、首頁(左側清單+4 個 tab+圓形創建鈕)、路由(hash)、直橫式版面。
import { el, toast, pushScreen, popScreen, getSettings } from './app.js';
import * as DB from './db.js';
import * as Auth from './auth.js';
import { makeJournalNet } from './journalnet.js';
import { showLogin } from './ui_login.js';
import { openAccount } from './ui_account.js';
import { mountDetail } from './ui_journal.js';
import { ctx, accountChip, parseRoute, setHash, redrawChips } from './tjctx.js';

let mainEl = null;
let shell = null;   // {offHome, detail, listEl, tab, data, ...}
const TAB_KEY = 'tj_tab';
const EMPTY = {
  mine: '還沒有日誌,按下面「創建」開第一本',
  all: '目前沒有任何公開列出的日誌',
  shared: '別人分享的日誌加入後會出現在這裡',
  follow: '在日誌頁按「追蹤」就會出現在這裡',
};

export async function startJournalApp(main) {
  mainEl = main;
  mainEl.style.background = 'var(--bg)';
  const inv = window.Journal.parseInvite(location.search, location.hash);
  if (inv) {
    try { sessionStorage.setItem('tj_pending_j', inv.jid); } catch (_) { /* 略過 */ }
    history.replaceState(null, '', location.pathname);
  }
  ctx.onLogout = () => { teardown(); Auth.logout(); showLoginPage(); };
  const r = await Auth.autoLogin();
  if (r.session) enter(r.session, '', r.offline);
  else showLoginPage(r.dead ? { email: r.email, notice: '!' + (r.message || '登入已失效,請重新登入') } : {});
}

function showLoginPage(o) {
  teardown();
  showLogin(mainEl, Object.assign({ onDone: ({ session, name }) => enter(session, name, false) }, o || {}));
}

async function enter(session, newName, offline) {
  ctx.uid = session.uid; ctx.email = session.email || '';
  const b = Auth.getBackend();
  ctx.jn = makeJournalNet(b.dbStore, () => ({ uid: ctx.uid, name: ctx.name }));
  ctx.name = (session.email || '旅人').split('@')[0]; ctx.avatar = null;
  mountShell();   // 先用快取畫出首頁,再補資料
  try {
    const p = await ctx.jn.ensureProfile(newName || ctx.name);
    ctx.name = p.name; ctx.avatar = p.avatar || null;
  } catch (e) { if (!offline) toast('讀取個人資料失敗:' + e.message, 3000); }
  redrawChips();
  Auth.googleStatus().then(s => { ctx.google = !!s.google; }).catch(() => { /* 略過 */ });
}

function teardown() {
  if (shell) { if (shell.offHome) shell.offHome(); if (shell.detail) shell.detail.dispose(); shell.cleanup.forEach(f => f()); shell = null; }
  window.onhashchange = null;
  while (document.getElementById('screens').firstChild) document.getElementById('screens').firstChild.remove();
  if (mainEl) mainEl.replaceChildren();
}

const wide = () => window.matchMedia('(orientation: landscape), (min-width: 768px)').matches;

function mountShell() {
  teardown();
  const J = window.Journal;
  const s = shell = { tab: (() => { try { const t = localStorage.getItem(TAB_KEY); return J.TABS.some(x => x[0] === t) ? t : 'mine'; } catch (_) { return 'mine'; } })(), data: { idx: {}, dir: {}, follows: {} }, detail: null, detailKey: '', cleanup: [], offHome: null, dot: '● 即時' };
  const tabsEl = el('div', { class: 'tabs', id: 'tjTabs', role: 'tablist' });
  const listEl = el('div', { class: 'tj-list', id: 'tjList' });
  const dot = el('span', { class: 'tj-dot', id: 'tjDot' }, '● 即時');
  const fab = el('button', { class: 'tj-fab', id: 'tjCreate', 'aria-label': '創建日誌', onclick: openCreate }, '創建');
  const left = el('div', { class: 'tj-left' },
    el('header', { class: 'bar tj-bar' }, el('h2', {}, '旅遊日誌'), dot, el('span', { class: 'bar-r' }, accountChip(openAccount))),
    tabsEl, listEl, fab);
  const right = el('div', { class: 'tj-right', id: 'tjRight' }, el('div', { class: 'muted' }, '從左邊選一本日誌'));
  mainEl.replaceChildren(el('div', { class: 'tj-app' }, left, right));

  const drawTabs = () => tabsEl.replaceChildren(...J.TABS.map(t => el('button', { class: 'tab' + (t[0] === s.tab ? ' on' : ''), id: 'tab_' + t[0], role: 'tab', 'aria-selected': t[0] === s.tab ? 'true' : 'false', onclick: () => { s.tab = t[0]; try { localStorage.setItem(TAB_KEY, s.tab); } catch (_) { /* 略過 */ } drawTabs(); drawList(); } }, t[1])));
  const drawList = () => {
    const lists = J.classify(s.data.idx, s.data.dir, s.data.follows), items = lists[s.tab], route = parseRoute(location.hash);
    if (!items.length) { listEl.replaceChildren(el('div', { class: 'tj-empty', id: 'tjEmpty' }, EMPTY[s.tab])); return; }
    listEl.replaceChildren(...items.map(it => el('button', { class: 'tj-row' + (route.jid === it.jid ? ' on' : ''), 'data-jid': it.jid, onclick: () => setHash('#/j/' + it.jid) },
      el('span', { class: 'tj-no' }, String(it.no)),
      el('span', { class: 'tj-row-main' },
        el('b', {}, (it.vis === 'private' ? '🔒 ' : '') + (it.title || '(未命名)')),
        el('small', {}, [J.fmtRange(it.start, it.end), J.roleText(it.role), it.ownerName].filter(Boolean).join(' · '))))));
  };
  drawTabs(); drawList();

  // 先用快取畫出首頁
  DB.getJCache('__home').then(r => { if (r && r.data && shell === s && !s.live) { s.data = r.data; drawList(); } }).catch(() => { /* 沒有快取 */ });
  s.offHome = ctx.jn.subscribeHome(v => {
    s.live = true; s.data = v; drawList(); dot.textContent = '● 即時';
    DB.putJCache({ jid: '__home', data: v, at: Date.now() }).catch(() => { /* 快取失敗不影響 */ });
  }, e => { dot.textContent = e && e.soft ? '重新連線中…' : '離線(顯示快取)'; });

  // 路由與版面
  const render = () => {
    const route = parseRoute(location.hash), isWide = wide(), key = route.jid + '|' + route.eid + '|' + isWide;
    drawList();
    document.body.classList.toggle('tj-wide', isWide);
    if (key === s.detailKey) return;
    s.detailKey = key;
    if (s.detail) { s.detail.dispose(); s.detail = null; }
    if (!route.jid) { right.style.visibility = ''; return; }
    const back = route.eid ? () => setHash('#/j/' + route.jid) : (isWide ? null : () => setHash('#/'));
    s.detail = mountDetail(route, { inline: isWide, onBack: back, openAccount });
    document.getElementById('screens').append(s.detail.el);
  };
  window.onhashchange = render;
  const onResize = () => render();
  window.addEventListener('resize', onResize); s.cleanup.push(() => window.removeEventListener('resize', onResize));
  window.addEventListener('orientationchange', onResize); s.cleanup.push(() => window.removeEventListener('orientationchange', onResize));
  s.cleanup.push(() => document.body.classList.remove('tj-wide'));
  let pend = null;
  try { pend = sessionStorage.getItem('tj_pending_j'); sessionStorage.removeItem('tj_pending_j'); } catch (_) { /* 略過 */ }
  if (pend) setHash('#/j/' + pend); else render();
}

function openCreate() {
  pushScreen('創建日誌', (body) => {
    const J = window.Journal;
    const title = el('input', { type: 'text', id: 'cjTitle', maxlength: 60, placeholder: '例如:沖繩 7 天遊' });
    const start = el('input', { type: 'date', id: 'cjStart' }), end = el('input', { type: 'date', id: 'cjEnd' });
    const err = el('div', { class: 'banner warn', id: 'cjErr', style: 'display:none' });
    const ok = el('button', { class: 'big-btn primary', id: 'cjOk', style: 'margin-top:14px' }, '創建');
    ok.onclick = async () => {
      const f = { title: title.value, start: start.value, end: end.value, vis: 'public', tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || '') };
      const e = J.validateJournalForm(f);
      if (e) { err.textContent = e; err.style.display = ''; return; }
      ok.disabled = true; ok.textContent = '建立中…';
      try {
        const { jid } = await ctx.jn.createJournal(f);
        popScreen(); setHash('#/j/' + jid);
        toast('先寫宗旨與公告,再按右上 ⚙ 邀請大家', 3500);
      } catch (x) { err.textContent = x.message || '建立失敗'; err.style.display = ''; ok.disabled = false; ok.textContent = '創建'; }
    };
    body.append(err,
      el('label', { class: 'f', for: 'cjTitle' }, '標題(必填)'), title,
      el('div', { class: 'two-col' }, el('div', {}, el('label', { class: 'f', for: 'cjStart' }, '出發日(選填)'), start), el('div', {}, el('label', { class: 'f', for: 'cjEnd' }, '回程日(選填)'), end)),
      el('div', { class: 'f' }, '公開或私密'),
      el('div', { class: 'big-grid' },
        el('button', { class: 'big-btn primary', id: 'cjPublic', 'aria-pressed': 'true' }, '🌐 公開(登入者都能加入)'),
        el('button', { class: 'big-btn', id: 'cjPrivate', disabled: true }, '🔒 私密(需密碼,下一版開放)')),
      ok);
  });
}
