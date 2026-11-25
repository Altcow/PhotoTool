/* 旅遊日誌純函式:jid、格子 id、order、日期、tab 分類/排序/序號、網址檢查、欄位長度、姓名與頭像檢查、邀請連結 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Journal = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var LIM = { title: 60, name: 30, about: 2000, leader: 30, phone: 30, noticeBody: 2000, blockText: 4000, blockTitle: 60, url: 2000, avatarPhoto: 16000 };
  var SLOTS = { notice: ['n', 50, 2], link: ['l', 30, 2], event: ['e', 99, 3], block: ['b', 60, 2], phrase: ['p', 80, 2] };

  // 可由 config.js 的 JOURNAL_RULES 覆寫(setRules)。注意:jidLen 要和 Firebase 規則的 jid regex 一致(rules_tj.js JID_LEN)。
  var JID_LEN = 10;
  var PW_RULE = { min: 4, max: 4, digits: true };
  function setRules(r) {
    r = r || {};
    if (r.jidLen) JID_LEN = r.jidLen;
    if (r.pwMin) PW_RULE.min = r.pwMin;
    if (r.pwMax) PW_RULE.max = r.pwMax;
    if (r.pwDigits !== undefined) PW_RULE.digits = !!r.pwDigits;
  }
  function jidPattern() { return '[A-HJ-NP-Z2-9]{' + JID_LEN + '}'; }
  function genJid(rand) {
    rand = rand || Math.random;
    var s = '';
    for (var i = 0; i < JID_LEN; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
    return s;
  }
  function isJid(s) { return new RegExp('^' + jidPattern() + '$').test(String(s || '')); }
  // 顯示用文字:null/undefined/字串 "null"、"undefined" 一律當空字串(避免畫面出現 null)
  function txt(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    return s === 'null' || s === 'undefined' ? '' : s;
  }
  // 私密密碼:回傳錯誤文字或 ''
  function validPw(pw) {
    pw = String(pw == null ? '' : pw);
    if (PW_RULE.digits && !/^\d+$/.test(pw)) return '密碼只能用數字';
    if (pw.length < PW_RULE.min || pw.length > PW_RULE.max) return PW_RULE.min === PW_RULE.max ? '密碼要 ' + PW_RULE.min + ' ' + (PW_RULE.digits ? '位數字' : '個字') : '密碼要 ' + PW_RULE.min + '~' + PW_RULE.max + ' ' + (PW_RULE.digits ? '位數字' : '個字');
    return '';
  }
  function pwRule() { return { min: PW_RULE.min, max: PW_RULE.max, digits: PW_RULE.digits }; }
  // 密碼雜湊的輸入字串(再做 SHA-256 → jkeys 的 key);掺入 jid 讓同密碼在不同日誌的 key 不同
  function pwHashInput(jid, pw) { return 'tj:' + jid + ':' + pw; }
  // 剩餘嘗試次數:try = {n, ts};一小時後重設
  var TRY_MAX = 5, TRY_WINDOW = 3600000;
  function triesLeft(t, now) { if (!t || !(Number(t.ts) + TRY_WINDOW > now)) return TRY_MAX; return Math.max(0, TRY_MAX - (Number(t.n) || 0)); }
  function nextTryN(t, now) { return !t || !(Number(t.ts) + TRY_WINDOW > now) ? 1 : (Number(t.n) || 0) + 1; }

  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  // 格子 id:kind = notice|link|event|block|phrase;回傳最小的未用格子,滿了回傳 null
  function allocSlot(kind, used) {
    var d = SLOTS[kind], set = {};
    (used || []).forEach(function (u) { set[u] = true; });
    for (var i = 1; i <= d[1]; i++) { var id = d[0] + pad(i, d[2]); if (!set[id]) return id; }
    return null;
  }
  function isSlot(kind, id) {
    var d = SLOTS[kind], m = new RegExp('^' + d[0] + '(\\d{' + d[2] + '})$').exec(String(id || ''));
    return !!m && +m[1] >= 1 && +m[1] <= d[1];
  }
  function slotMax(kind) { return SLOTS[kind][1]; }

  function nextOrder(items) {
    var max = 0;
    Object.keys(items || {}).forEach(function (k) { var o = Number(items[k] && items[k].order); if (o > max) max = o; });
    return max + 1000;
  }
  // 依 order 排成陣列 [{id, ...}];order 相同依 id
  function sortedList(map) {
    return Object.keys(map || {}).map(function (k) { return Object.assign({ id: k }, map[k]); })
      .sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0) || (a.id < b.id ? -1 : 1); });
  }
  // 上移/下移 = 與鄰居交換 order;回傳 {a:{id,order}, b:{id,order}} 或 null(已在邊界)
  function swapOrder(map, id, dir) {
    var list = sortedList(map), i = list.findIndex(function (x) { return x.id === id; });
    var j = dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return null;
    var oa = list[i].order, ob = list[j].order;
    if (oa === ob) { oa = (i + 1) * 1000; ob = (j + 1) * 1000; }
    return { a: { id: list[i].id, order: ob }, b: { id: list[j].id, order: oa } };
  }

  // 日期 YYYY-MM-DD
  function isDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  function md(s) { return isDate(s) ? s.slice(5).replace('-', '/') : ''; }
  function fmtRange(start, end) {
    if (!isDate(start)) return '';
    if (!isDate(end) || end === start) return md(start);
    return md(start) + '~' + md(end);
  }
  // 起迄天數(含頭尾)
  function dayCount(start, end) {
    if (!isDate(start) || !isDate(end)) return 0;
    var a = Date.parse(start + 'T00:00:00Z'), b = Date.parse(end + 'T00:00:00Z');
    return b < a ? 0 : Math.round((b - a) / 86400000) + 1;
  }
  var DAY_NAMES = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  function dayTitle(n) { return n >= 1 && n <= 10 ? '第' + DAY_NAMES[n - 1] + '天' : '第' + n + '天'; }
  function addDays(date, n) { return new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }

  // 首頁清單:idx={jid:{role,title,start,at}}, dir={jid:{title,ownerName,vis,start,end,updatedAt}}, follows={jid:{title,at}}
  function entry(jid, dirE, idxE, folE) {
    var s = Object.assign({}, folE || {}, dirE || {}, idxE || {});
    return { jid: jid, title: s.title || '', start: s.start || '', end: (dirE && dirE.end) || '', vis: (dirE && dirE.vis) || '', ownerName: (dirE && dirE.ownerName) || '', role: (idxE && idxE.role) || null, updatedAt: Number((dirE && dirE.updatedAt) || (idxE && idxE.at) || (folE && folE.at) || 0) };
  }
  function sortList(list) {
    return list.slice().sort(function (a, b) {
      var da = a.start || '', db = b.start || '';
      if (da && db) return da < db ? 1 : da > db ? -1 : (b.updatedAt - a.updatedAt);
      if (da) return -1;
      if (db) return 1;
      return b.updatedAt - a.updatedAt;
    });
  }
  function numbered(list) { return list.map(function (x, i) { return Object.assign({ no: i + 1 }, x); }); }
  var TABS = [['mine', '個人日誌'], ['all', '所有日誌'], ['shared', '共用日誌'], ['follow', '追蹤日誌']];
  function classify(idx, dir, follows) {
    idx = idx || {}; dir = dir || {}; follows = follows || {};
    var mine = [], shared = [], all = [], follow = [];
    Object.keys(idx).forEach(function (j) {
      var e = entry(j, dir[j], idx[j], follows[j]);
      if (e.role === 'owner') mine.push(e); else if (e.role === 'editor' || e.role === 'member') shared.push(e);
    });
    Object.keys(dir).forEach(function (j) { all.push(entry(j, dir[j], idx[j], follows[j])); });
    Object.keys(follows).forEach(function (j) { follow.push(entry(j, dir[j], idx[j], follows[j])); });
    return { mine: numbered(sortList(mine)), all: numbered(sortList(all)), shared: numbered(sortList(shared)), follow: numbered(sortList(follow)) };
  }
  var ROLE_TEXT = { owner: '主編', editor: '副編', member: '成員' };
  function roleText(role) { return ROLE_TEXT[role] || '未加入'; }

  // 網址
  function isHttpsUrl(u) {
    u = String(u == null ? '' : u);
    if (u.length > LIM.url || !/^https:\/\//.test(u)) return false;
    if (/[\s<>"]/.test(u)) return false;
    return /^https:\/\/[^\/?#]+/.test(u);
  }
  function driveId(u) {
    var m = /^https:\/\/drive\.google\.com\/(?:file\/d\/|open\?(?:[^#]*&)?id=|uc\?(?:[^#]*&)?id=)([A-Za-z0-9_-]{10,})/.exec(String(u || ''));
    return m ? m[1] : null;
  }
  function fileIcon(url, title) {
    var s = (String(title || '') + ' ' + String(url || '')).toLowerCase();
    if (/\.pdf\b/.test(s)) return '📄';
    if (/\.docx?\b|docs\.google\.com\/document/.test(s)) return '📝';
    if (/\.xlsx?\b|\.csv\b|docs\.google\.com\/spreadsheets/.test(s)) return '📊';
    if (/\.txt\b/.test(s)) return '📃';
    return '🔗';
  }

  // 欄位長度:回傳錯誤文字或 ''
  function checkLen(label, s, max, required) {
    s = String(s == null ? '' : s);
    if (required && !s.trim()) return label + '不能空白';
    if (s.length > max) return label + '最多 ' + max + ' 個字';
    return '';
  }
  function validateJournalForm(f) {
    f = f || {};
    var e = checkLen('標題', f.title, LIM.title, true);
    if (e) return e;
    if (f.start && !isDate(f.start)) return '出發日期格式不對';
    if (f.end && !isDate(f.end)) return '回程日期格式不對';
    if (f.end && !f.start) return '請先填出發日期';
    if (f.start && f.end && f.end < f.start) return '回程日不能早於出發日';
    return '';
  }
  var PHONE = /(\+?\d[\d\- ]{6,}\d)/;
  function hasPhone(s) { return PHONE.test(String(s || '')); }

  // 顯示名稱:1~30 字、不含控制字元
  function validName(s) {
    var v = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if (!v) return { ok: false, msg: '請輸入姓名' };
    if (/[\u0000-\u001f\u007f]/.test(v)) return { ok: false, msg: '姓名含不能用的字元' };
    if (Array.from(v).length > LIM.name) return { ok: false, msg: '姓名最多 ' + LIM.name + ' 個字' };
    return { ok: true, value: v };
  }
  function truncName(s, n) { var a = Array.from(String(s || '')); return a.length > n ? a.slice(0, n).join('') + '…' : a.join(''); }
  function initialOf(name) { var a = Array.from(String(name || '').trim()); return a.length ? a[0].toUpperCase() : '?'; }
  var COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#be185d', '#4d7c0f'];
  function colorOf(name) { var h = 0, s = String(name || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; }
  // avatar: {t:'initial'|'emoji'|'photo'|'google', v, c}
  function validAvatar(a) {
    if (a == null) return { ok: true };
    if (typeof a !== 'object') return { ok: false, msg: '頭像格式不對' };
    var v = a.v == null ? '' : String(a.v);
    if (['initial', 'emoji', 'photo', 'google'].indexOf(a.t) < 0) return { ok: false, msg: '頭像種類不對' };
    if (a.c != null && !/^#[0-9a-fA-F]{6}$/.test(a.c)) return { ok: false, msg: '頭像顏色不對' };
    if (a.t === 'emoji' && (!v || Array.from(v).length > 4)) return { ok: false, msg: 'emoji 不對' };
    if (a.t === 'photo' && (!/^data:image\/jpeg;base64,/.test(v) || v.length > LIM.avatarPhoto)) return { ok: false, msg: '照片頭像太大(上限 ' + LIM.avatarPhoto + ' 字元)' };
    if (a.t === 'google' && !isHttpsUrl(v)) return { ok: false, msg: 'Google 頭像網址不對' };
    return { ok: true };
  }
  // 置中裁正方形:回傳 {sx,sy,sw,sh}
  function squareCrop(w, h) { var s = Math.min(w, h); return { sx: Math.floor((w - s) / 2), sy: Math.floor((h - s) / 2), sw: s, sh: s }; }
  function maskEmail(e) {
    var m = /^([^@]+)@(.+)$/.exec(String(e || ''));
    return m ? m[1].charAt(0) + '***@' + m[2] : '';
  }

  // 邀請連結:?j=<jid>#<128-bit 十六進位代碼>;預設 7 天
  var INVITE_TTL = 7 * 86400000;
  function genInviteCode(bytes) {
    var s = '';
    for (var i = 0; i < 16; i++) { var b = bytes ? bytes[i] : Math.floor(Math.random() * 256); s += (b < 16 ? '0' : '') + (b & 255).toString(16); }
    return s;
  }
  function isInviteCode(c) { return /^[0-9a-f]{32}$/.test(String(c || '')); }
  function inviteUrl(base, jid, code) { return base + '?j=' + jid + '#' + code; }
  // 解析:search 的 j、hash 的代碼(# 後純 32 字元十六進位);回傳 {jid, code} 或 null
  function parseInvite(search, hash) {
    var m = new RegExp('(?:^|[?&])j=(' + jidPattern() + ')(?:&|$)').exec(String(search || ''));
    if (!m) return null;
    var h = String(hash || '').replace(/^#/, '');
    return { jid: m[1], code: isInviteCode(h) ? h : '' };
  }
  function inviteValid(inv, now) { return !!(inv && isInviteCode(inv.code) && Number(inv.exp) > now); }

  // 日誌設定頁能做什麼:owner 全部;editor 邀請+看成員;其他不顯示齒輪
  function settingsAccess(role) {
    return { gear: role === 'owner' || role === 'editor', invite: role === 'owner' || role === 'editor', members: role === 'owner' || role === 'editor', manage: role === 'owner' };
  }

  // 領隊下拉選項:成員(主編第一)+「其他(自行輸入)」;members = {uid:{name,role,joinedAt}}
  function leaderOptions(members, ownerUid) {
    var list = Object.keys(members || {}).map(function (u) { return { uid: u, name: txt(members[u].name) || '(未命名)', role: members[u].role, joinedAt: Number(members[u].joinedAt) || 0 }; });
    var rank = { owner: 0, editor: 1, member: 2 };
    list.sort(function (a, b) { return (a.uid === ownerUid ? -1 : b.uid === ownerUid ? 1 : 0) || ((rank[a.role] || 3) - (rank[b.role] || 3)) || (a.joinedAt - b.joinedAt); });
    return list.map(function (m) { return { uid: m.uid, name: m.name }; });
  }

  return {
    CODE_CHARS: CODE_CHARS, LIM: LIM, TABS: TABS, INVITE_TTL: INVITE_TTL, genJid: genJid, isJid: isJid, allocSlot: allocSlot, isSlot: isSlot, slotMax: slotMax,
    nextOrder: nextOrder, sortedList: sortedList, swapOrder: swapOrder, isDate: isDate, md: md, fmtRange: fmtRange, dayCount: dayCount, dayTitle: dayTitle, addDays: addDays,
    classify: classify, sortList: sortList, numbered: numbered, roleText: roleText, isHttpsUrl: isHttpsUrl, driveId: driveId, fileIcon: fileIcon,
    checkLen: checkLen, validateJournalForm: validateJournalForm, hasPhone: hasPhone, validName: validName, truncName: truncName, initialOf: initialOf,
    colorOf: colorOf, validAvatar: validAvatar, squareCrop: squareCrop, maskEmail: maskEmail,
    genInviteCode: genInviteCode, isInviteCode: isInviteCode, inviteUrl: inviteUrl, parseInvite: parseInvite, inviteValid: inviteValid, settingsAccess: settingsAccess,
    setRules: setRules, jidPattern: jidPattern, txt: txt, validPw: validPw, pwRule: pwRule, pwHashInput: pwHashInput, triesLeft: triesLeft, nextTryN: nextTryN, TRY_MAX: TRY_MAX,
    leaderOptions: leaderOptions,
  };
});
