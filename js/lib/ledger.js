/* 分帳記事本:口述/貼上文字的規則解析、成員歸併、活動資料正規化與匯出入(純函式) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./reconcile.js'));
  else root.Ledger = factory(root.Reconcile);
})(typeof self !== 'undefined' ? self : this, function (Reconcile) {
  var EXPORT_FORMAT = 'phototool-trips';
  var NUM = '(?:[0-9][0-9,]*(?:\\.[0-9]+)?|[零〇○一二兩两三四五六七八九十百千萬万壹貳參肆伍陸柒捌玖拾佰仟]+)';
  var VERB = '(?:先付了|先付|付了|付|出了|出|墊了|墊|刷了|刷)';
  var UNIT = '(?:元|塊錢|塊|圓)?';
  var P1 = new RegExp('^(.+?)\\s+(\\S{1,6}?)' + VERB + '\\s*(' + NUM + ')\\s*' + UNIT + '$');
  var P2 = new RegExp('^(\\S{1,6}?)' + VERB + '\\s*(.+?)\\s*(' + NUM + ')\\s*' + UNIT + '$');
  var P4 = new RegExp('^(\\S{1,6}?)' + VERB + '\\s*(' + NUM + ')\\s*' + UNIT + '\\s*(.+)$');

  function rid(prefix) { return prefix + Math.random().toString(36).slice(2, 9); }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // 名字正規化:全形轉半形、去前後空白
  function cleanName(s) { return String(s == null ? '' : s).normalize('NFKC').trim(); }
  function nameKey(s) { return cleanName(s).replace(/\s+/g, '').toLowerCase(); }

  // 把 incoming 的名字併進 existing(忽略大小寫與空白差異),回傳 {members, map(原名→正式名)}
  function mergeNames(existing, incoming) {
    var members = [], keys = {}, map = {};
    (existing || []).forEach(function (n) { var c = cleanName(n), k = nameKey(n); if (c && !keys[k]) { keys[k] = c; members.push(c); } });
    (incoming || []).forEach(function (n) {
      var c = cleanName(n), k = nameKey(n);
      if (!c) return;
      if (!keys[k]) { keys[k] = c; members.push(c); }
      map[n] = keys[k];
    });
    return { members: members, map: map };
  }

  /* ---- 成員名單比對:名單是人名的唯一來源 ---- */
  function lev(a, b) {
    var m = a.length, n = b.length, d = [], i, j;
    for (i = 0; i <= m; i++) { d[i] = [i]; }
    for (j = 1; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  // 完全相符 → exact;相近(差一個字、互相包含、同姓同長)→ near(列出候選);否則 unknown
  function matchName(name, members) {
    var k = nameKey(name), list = (members || []).map(cleanName).filter(Boolean);
    if (!k) return { status: 'unknown', member: '', candidates: [] };
    for (var i = 0; i < list.length; i++) if (nameKey(list[i]) === k) return { status: 'exact', member: list[i], candidates: [] };
    var cand = list.filter(function (m) {
      var mk = nameKey(m);
      if (k.length >= 2 && mk.length >= 2 && lev(k, mk) <= 1) return true;
      if (k.length >= 2 && mk.length >= 2 && (mk.indexOf(k) >= 0 || k.indexOf(mk) >= 0)) return true;
      return false;
    });
    return cand.length ? { status: 'near', member: '', candidates: cand } : { status: 'unknown', member: '', candidates: [] };
  }
  // 貼上/口述的成員名單:逗號、頓號、分號、空白、換行分隔;「A家庭:小唐 小唐太太」一行設定家庭;名字後加 (小孩)、(小孩0.5)、(小孩免費)
  function parseMembers(text) {
    var names = [], families = {}, info = {};
    String(text == null ? '' : text).normalize('NFKC').replace(/\r/g, '').split('\n').forEach(function (line) {
      var fam = '', body = line;
      var m = line.match(/^\s*([^:,;、]+?)\s*:\s*(.+)$/);
      if (m) { fam = cleanName(m[1]); body = m[2]; }
      body.split(/[\s,;、]+/).forEach(function (tok) {
        if (!tok) return;
        var kind = 'adult', w = 1, mm = tok.match(/^(.+?)\((小孩|兒童|child)(免費|半價|[0-9.]+)?\)$/i);
        if (mm) { tok = mm[1]; kind = 'child'; w = mm[3] === '免費' ? 0 : mm[3] === '半價' ? 0.5 : mm[3] ? Number(mm[3]) : 1; if (!isFinite(w) || w < 0) w = 1; }
        var n = cleanName(tok);
        if (!n) return;
        if (names.indexOf(n) < 0) names.push(n);
        if (fam) families[n] = fam;
        if (kind === 'child') info[n] = { kind: 'child', weight: w };
      });
    });
    return { members: names, families: families, info: info };
  }
  function familyMembers(trip, fam) { return (trip.members || []).filter(function (p) { return (trip.families || {})[p] === fam; }); }
  function familyNames(trip) { var out = []; (trip.members || []).forEach(function (p) { var f = (trip.families || {})[p]; if (f && out.indexOf(f) < 0) out.push(f); }); return out; }
  function isChild(trip, p) { return !!(trip.info && trip.info[p] && trip.info[p].kind === 'child'); }
  // 快速選取:all / adults / children
  function quickPick(trip, kind) {
    return (trip.members || []).filter(function (p) { return kind === 'all' ? true : kind === 'children' ? isChild(trip, p) : !isChild(trip, p); });
  }
  // 家庭一鍵選取/取消:整戶都已選 → 全部取消,否則整戶加入(保持成員順序)
  function toggleFamily(selected, trip, fam) {
    var fm = familyMembers(trip, fam), sel = (selected || []).slice();
    var all = fm.length > 0 && fm.every(function (p) { return sel.indexOf(p) >= 0; });
    sel = sel.filter(function (p) { return fm.indexOf(p) < 0; });
    if (!all) sel = sel.concat(fm);
    return (trip.members || []).filter(function (p) { return sel.indexOf(p) >= 0; }).concat(sel.filter(function (p) { return (trip.members || []).indexOf(p) < 0; }));
  }

  // 成員是否被記錄引用(刪除前檢查)
  function memberUsed(trip, name) {
    return (trip.records || []).some(function (r) {
      var inItems = (r.items || []).some(function (i) { return (i.people || []).indexOf(name) >= 0; });
      var sp = r.split || {};
      return r.payer === name || (r.participants || []).indexOf(name) >= 0 || inItems || (sp.shares && sp.shares[name] !== undefined) || (sp.amounts && sp.amounts[name] !== undefined);
    });
  }
  // 成員改名:所有引用一併更新(名字不可與現有成員重複)
  function renameMember(trip, oldName, newName) {
    var nu = cleanName(newName);
    if (!nu) return { ok: false, error: '名字不可空白' };
    if (nu === oldName) return { ok: true };
    if (trip.members.indexOf(nu) >= 0) return { ok: false, error: '已有同名成員' };
    var sw = function (list) { return (list || []).map(function (p) { return p === oldName ? nu : p; }); };
    var swKey = function (o) { if (o && o[oldName] !== undefined) { o[nu] = o[oldName]; delete o[oldName]; } };
    trip.members = sw(trip.members); swKey(trip.families); swKey(trip.info);
    (trip.records || []).forEach(function (r) {
      if (r.payer === oldName) r.payer = nu;
      r.participants = sw(r.participants);
      (r.items || []).forEach(function (i) { i.people = sw(i.people); });
      if (r.split) { swKey(r.split.shares); swKey(r.split.amounts); }
    });
    return { ok: true };
  }


  /* ---- 貼上清單(外部 AI 整理好的「品名 * 數量 糖度 冰度 尺寸 單杯價格」,一行一品項,容錯解析) ---- */
  var SUGAR_RE = /(正常糖|全糖|少糖|半糖|微糖|無糖|[一二三四五六七八九十0-9]分糖)/;
  var ICE_RE = /(正常冰|少冰|微冰|去冰|多冰|半冰|常溫|熱|溫)/;
  var SIZE_RE = /^(大杯|中杯|小杯|大|中|小|L|M|S)$/i;
  var QTY_RE = /^(.+?)\s*(?:[*＊×xX乘])\s*(\d+)\s*(?:杯|份|個)?\s*(.*)$/;
  var UNIT_RE = /(?:單杯|每杯|單價|@)\s*\$?\s*(\d+(?:\.\d+)?)\s*元?/;
  var TOTAL_RE = /(?:合計|總共|總計|共|總)\s*\$?\s*(\d+(?:\.\d+)?)\s*元?/;
  var DRINK_PROMPT = '請把我提供的文字或照片(飲料訂單/收據)整理成純文字清單,一行一個品項,格式如下:\n品名 * 數量 糖度 冰度 尺寸 單杯價格\n例如:\n凍檸茶 * 2 半糖 少冰 大 單杯75\n鮮奶茶 * 4 半糖 熱 大 單杯75\n多多綠 * 1 半糖少冰 中 55\n規則:\n1. 品名照原文,不要自行修正錯字。\n2. 沒有的欄位(糖度、冰度、尺寸)可以省略,但順序不要變。\n3. 價格如果是每杯的單價,前面寫「單杯」;如果是這一行的總價,前面寫「共」。\n4. 價格看不清楚或不確定,請在該行後面加註「(價格不確定)」,不要自己猜。\n5. 只輸出清單,不要多餘的說明。';
  function toPrice(str) {
    var v = Number(str);
    return isFinite(v) && Math.floor(v) === v && v > 0 ? v : null;
  }
  // 回傳 {lines:[{name,qty,sugar,ice,size,note,unit,total,kind,confirm,raw}], unparsed:[{text,reason}], totalCups, totalAmount}
  function parseDrinkList(text) {
    var lines = [], unparsed = [];
    String(text == null ? '' : text).normalize('NFKC').replace(/\r/g, '').split('\n').forEach(function (raw) {
      var line = raw.trim().replace(/^[-•*·●○◆◇▪]+\s+/, '').replace(/^\d{1,2}[.、)]\s+/, '');
      if (!line) return;
      var name, qty, rest, m = line.match(QTY_RE);
      if (m) { name = m[1].trim(); qty = Number(m[2]); rest = m[3]; }
      else { var parts = line.split(/\s+/); name = parts[0]; qty = 1; rest = parts.slice(1).join(' '); }
      if (!name || /^[0-9]+$/.test(name)) { unparsed.push({ text: raw.trim(), reason: '看不到品名' }); return; }
      if (!(qty >= 1) || qty > 99) { unparsed.push({ text: raw.trim(), reason: '數量不合理' }); return; }
      var unit = null, total = null, kind = '', confirm = false, um, tm;
      if (/不確定/.test(rest)) { confirm = true; rest = rest.replace(/[(][^)]*不確定[^)]*[)]|不確定/g, ' '); }
      if ((um = rest.match(UNIT_RE))) { unit = toPrice(um[1]); rest = rest.replace(UNIT_RE, ' '); kind = 'unit'; if (unit === null) { unparsed.push({ text: raw.trim(), reason: '單價不是正整數' }); return; } total = unit * qty; }
      else if ((tm = rest.match(TOTAL_RE))) { total = toPrice(tm[1]); rest = rest.replace(TOTAL_RE, ' '); kind = 'total'; if (total === null) { unparsed.push({ text: raw.trim(), reason: '總價不是正整數' }); return; } unit = total % qty === 0 ? total / qty : null; }
      var sugar = '', ice = '', sm = rest.match(SUGAR_RE);
      if (sm) { sugar = sm[1]; rest = rest.replace(SUGAR_RE, ' '); }
      var im = rest.match(ICE_RE);
      if (im) { ice = im[1]; rest = rest.replace(ICE_RE, ' '); }
      var toks = rest.split(/\s+/).filter(Boolean), size = '', notes = [];
      if (!kind) {
        var last = toks[toks.length - 1], pm = last && last.match(/^\$?(\d+(?:\.\d+)?)元?$/);
        if (pm) {
          var v = toPrice(pm[1]); toks.pop();
          if (v === null) { unparsed.push({ text: raw.trim(), reason: '價格不是正整數' }); return; }
          unit = v; total = v * qty;
          if (qty > 1) { kind = 'default-unit'; confirm = true; } else kind = 'single';
        }
      }
      if (!kind) { unparsed.push({ text: raw.trim(), reason: '沒有價格' }); return; }
      toks.forEach(function (t) { if (!size && SIZE_RE.test(t)) size = /^[a-z]$/i.test(t) ? t.toUpperCase() : t; else notes.push(t); });
      if (/價格不確定|不確定/.test(raw)) confirm = true;
      lines.push({ name: name, qty: qty, sugar: sugar, ice: ice, size: size, note: notes.join(' ').replace(/[()()]/g, '').trim(), unit: unit, total: total, kind: kind, confirm: confirm, raw: raw.trim() });
    });
    return { lines: lines, unparsed: unparsed, totalCups: lines.reduce(function (a, l) { return a + l.qty; }, 0), totalAmount: lines.reduce(function (a, l) { return a + l.total; }, 0) };
  }
  // 一行的每一杯金額:單價 → 每杯相同;總價除不盡 → 餘數每杯 1 元依序給前面
  function cupAmounts(line) {
    var out = [], i;
    if (line.unit !== null && line.unit !== undefined && line.unit * line.qty === line.total) { for (i = 0; i < line.qty; i++) out.push(line.unit); return out; }
    var base = Math.floor(line.total / line.qty), rem = line.total - base * line.qty;
    for (i = 0; i < line.qty; i++) out.push(base + (i < rem ? 1 : 0));
    return out;
  }
  function lineDesc(l) { return [l.sugar, l.ice, l.size, l.note].filter(Boolean).join(' '); }
  // 清單 → 一筆明細帳記錄:每一杯一個品項(people 空 = 尚未指派),全部指派完才算完成
  function drinkListToRecord(lines, opts) {
    opts = opts || {};
    var items = [];
    lines.forEach(function (l, li) { cupAmounts(l).forEach(function (amt) { items.push({ name: l.name, desc: lineDesc(l), qty: 1, amount: amt, people: [], line: li }); }); });
    return normalizeRecord({ id: opts.id || rid('r'), title: opts.title || '飲料', payer: opts.payer || '', amount: items.reduce(function (a, i) { return a + i.amount; }, 0), status: 'todo', split: { mode: 'items' }, items: items, requireAssign: true, source: 'note' });
  }
  // 整行一次指派同一人(或 null = 清除)
  function assignLine(rec, line, member) {
    rec.items.forEach(function (it) { if (it.line === line) it.people = member ? [member] : []; });
    return rec;
  }
  // 每人幾杯:依成員順序把該行的杯子依序分給各人(counts 加總超過杯數的部分忽略,不足的杯保持未指派)
  function assignLineCounts(rec, line, counts, order) {
    var cups = rec.items.filter(function (it) { return it.line === line; }), k = 0;
    cups.forEach(function (c) { c.people = []; });
    (order || Object.keys(counts)).forEach(function (m) {
      for (var n = counts[m] || 0; n > 0 && k < cups.length; n--) cups[k++].people = [m];
    });
    return rec;
  }
  function assignedCount(rec) { return rec.items.filter(function (it) { return it.people.length > 0; }).length; }

  function toAmount(numStr) {
    var v = Reconcile.parseAmount(numStr);
    if (v === null || !isFinite(v)) return null;
    return v;
  }
  function makeRec(title, payer, numStr) {
    var amt = toAmount(numStr);
    if (amt === null) return { error: '看不懂金額「' + numStr + '」' };
    if (amt <= 0) return { error: '金額必須大於 0' };
    if (Math.floor(amt) !== amt) return { error: '金額必須是整數元' };
    title = cleanName(title).replace(/^[,，:：\-—\s]+|[,，:：\-—\s]+$/g, '');
    payer = cleanName(payer);
    if (!payer) return { error: '看不到付款人' };
    return { rec: { title: title || '未命名', payer: payer, amount: amt, source: 'note' } };
  }

  function parseSegment(seg, known) {
    var m, r, i;
    // 標題與人名之間沒空白(「買飲料小玉付1024」):先用已知成員名字切
    var names = (known || []).map(cleanName).filter(Boolean).sort(function (a, b) { return b.length - a.length; });
    for (i = 0; i < names.length; i++) {
      var re = new RegExp('^(.+?)' + esc(names[i]) + VERB + '\\s*(' + NUM + ')\\s*' + UNIT + '$');
      if ((m = seg.match(re))) { r = makeRec(m[1], names[i], m[2]); if (r.rec) return r; }
    }
    if ((m = seg.match(P1))) { r = makeRec(m[1], m[2], m[3]); if (r.rec) return r; }
    if ((m = seg.match(P2)) && !/^[\d,.\s]*$/.test(m[2])) { r = makeRec(m[2], m[1], m[3]); if (r.rec) return r; }
    if ((m = seg.match(P4))) { r = makeRec(m[3], m[1], m[2]); if (r.rec) return r; }
    return { error: /\d|[零〇○一二兩两三四五六七八九十百千萬万]/.test(seg) ? '看不懂這一段的句型' : '沒有金額' };
  }

  // 解析一段口述/貼上的文字 → {records, unparsed:[{text,reason}], members}
  // 從一段話取出日期(2026-11-23、11/23、11月23日、今天/昨天/前天);回傳 {date, rest}
  function extractDate(seg, todayStr) {
    var t = todayStr || localDay(Date.now()), y = Number(t.slice(0, 4)), m, date = null, rest = seg;
    var take = function (re, fn) { var mm = rest.match(re); if (mm) { var d = fn(mm); if (d) { date = d; rest = rest.replace(re, ' ').trim(); return true; } } return false; };
    var ymd = function (yy, mo, dd) { return Reconcile.normalizeDate(yy + '-' + mo + '-' + dd); };
    var shift = function (n) { var p = t.split('-'), d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n); return localDay(d.getTime()); };
    if (take(/(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})[日號号]?/, function (x) { return ymd(x[1], x[2], x[3]); })) return { date: date, rest: rest };
    if (take(/(\d{1,2})月(\d{1,2})[日號号]?/, function (x) { return ymd(y, x[1], x[2]); })) return { date: date, rest: rest };
    if (take(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?!\d)/, function (x) { return ymd(y, x[1], x[2]); })) return { date: date, rest: rest };
    if (take(/前天/, function () { return shift(-2); })) return { date: date, rest: rest };
    if (take(/昨天/, function () { return shift(-1); })) return { date: date, rest: rest };
    if (take(/今天/, function () { return shift(0); })) return { date: date, rest: rest };
    return { date: null, rest: seg };
  }
  function parseNote(text, knownMembers, opts) {
    var todayStr = opts && opts.today;
    var curDate = null;
    var norm = String(text == null ? '' : text).normalize('NFKC').replace(/\r/g, '').replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
    var segs = norm.split(/[\n,,、;;。]+/);
    var records = [], unparsed = [], payers = [];
    segs.forEach(function (raw) {
      var seg = raw.normalize('NFKC').trim();
      if (!seg) return;
      var dx = extractDate(seg, todayStr);
      if (dx.date && !dx.rest.replace(/[\s,:：]/g, '')) { curDate = dx.date; return; }   // 單獨一段只有日期:套用到後面的記錄
      var r = parseSegment(dx.date ? dx.rest : seg, (knownMembers || []).concat(payers));
      if (r.rec) { var dd = dx.date || curDate; if (dd) r.rec.date = dd; records.push(r.rec); payers.push(r.rec.payer); } else unparsed.push({ text: seg, reason: r.error });
    });
    // 有成員名單時:名單是人名的唯一來源。完全相符直接用;相近列候選;不在名單內標 unknown(由使用者選擇或新增成員)
    if (knownMembers && knownMembers.length) {
      records.forEach(function (rec) {
        var mm = matchName(rec.payer, knownMembers);
        if (mm.status === 'exact') rec.payer = mm.member;
        else { rec.payerStatus = mm.status; rec.payerCandidates = mm.candidates; }
      });
      return { records: records, unparsed: unparsed, members: knownMembers.slice() };
    }
    var merged = mergeNames([], payers);
    records.forEach(function (rec) { rec.payer = merged.map[rec.payer] || rec.payer; });
    return { records: records, unparsed: unparsed, members: merged.members };
  }

  /* ---- 活動資料正規化 / 匯出入 ---- */
  function uniq(list) { var out = []; (list || []).forEach(function (x) { x = cleanName(x); if (x && out.indexOf(x) < 0) out.push(x); }); return out; }
  function intOrZero(v) { var n = Number(v); return isFinite(n) ? Math.round(n) : 0; }
  function arr(v) { return Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.keys(v).map(function (k) { return v[k]; }) : []); }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function localDay(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  // 記錄日期 YYYY-MM-DD;無效或沒給就用建立時間(ts)當天
  function normDate(v, ts) {
    var d = v ? Reconcile.normalizeDate(String(v)) : null;
    return d || localDay(Number(ts) || Date.now());
  }
  function normalizeRecord(raw) {
    raw = raw || {};
    var split = raw.split && typeof raw.split === 'object' ? raw.split : {};
    var mode = ['equal', 'shares', 'amounts', 'items'].indexOf(split.mode) >= 0 ? split.mode : 'equal';
    var s = { mode: mode };
    if (mode === 'shares') { s.shares = {}; Object.keys(split.shares || {}).forEach(function (k) { s.shares[cleanName(k)] = intOrZero(split.shares[k]); }); }
    if (mode === 'amounts') { s.amounts = {}; Object.keys(split.amounts || {}).forEach(function (k) { s.amounts[cleanName(k)] = intOrZero(split.amounts[k]); }); }
    return {
      id: String(raw.id || rid('r')), title: String(raw.title == null ? '' : raw.title).trim().slice(0, 80), payer: cleanName(raw.payer), amount: intOrZero(raw.amount),
      participants: uniq(arr(raw.participants)), split: s,
      items: arr(raw.items).map(function (it) { it = it || {}; var o = { name: String(it.name == null ? '' : it.name).trim().slice(0, 80), qty: it.qty == null ? 1 : Number(it.qty) || 1, amount: intOrZero(it.amount), people: uniq(arr(it.people)) }; if (it.desc) o.desc = String(it.desc).slice(0, 60); if (it.line !== undefined && it.line !== null) o.line = Number(it.line) || 0; return o; }),
      fees: arr(raw.fees).map(function (f) { f = f || {}; return { name: String(f.name == null ? '' : f.name).trim().slice(0, 40), amount: intOrZero(f.amount) }; }),
      note: String(raw.note == null ? '' : raw.note).slice(0, 300), ts: Number(raw.ts) || Date.now(), source: raw.source === 'note' ? 'note' : 'manual',
      date: normDate(raw.date, raw.ts), status: raw.status === 'todo' ? 'todo' : 'done', requireAssign: !!raw.requireAssign, qty: Math.max(0, intOrZero(raw.qty)), unitPrice: Math.max(0, intOrZero(raw.unitPrice)), useWeights: raw.useWeights === false ? false : true,
    };
  }
  function normalizeFamilies(f) {
    var out = {};
    if (f && typeof f === 'object') Object.keys(f).forEach(function (k) { var n = cleanName(k), v = cleanName(f[k]); if (n && v) out[n] = v; });
    return out;
  }
  function normalizeInfo(f) {
    var out = {};
    if (f && typeof f === 'object') Object.keys(f).forEach(function (k) {
      var n = cleanName(k), v = f[k] || {};
      if (!n) return;
      var kind = v.kind === 'child' ? 'child' : 'adult', w = Number(v.weight);
      out[n] = { kind: kind, weight: kind === 'child' && isFinite(w) && w >= 0 ? w : 1 };
    });
    return out;
  }
  function normalizeTrip(raw) {
    raw = raw || {};
    return { id: String(raw.id || rid('t')), name: String(raw.name == null ? '' : raw.name).trim().slice(0, 60) || '未命名活動', createdAt: Number(raw.createdAt) || Date.now(), currency: 'TWD',
      members: uniq(arr(raw.members)), families: normalizeFamilies(raw.families), info: normalizeInfo(raw.info), meId: cleanName(raw.meId), records: arr(raw.records).map(normalizeRecord) };
  }
  function toExport(trips) {
    return JSON.stringify({ format: EXPORT_FORMAT, version: 1, trips: trips.map(function (t) { var c = normalizeTrip(t); return c; }) });
  }
  // 回傳 {trips, error};newIds=true 時一律給新 id(避免覆蓋既有活動)
  function fromImport(text, opts) {
    var j;
    try { j = JSON.parse(text); } catch (e) { return { trips: [], error: '不是有效的 JSON' }; }
    if (!j || j.format !== EXPORT_FORMAT || !Array.isArray(j.trips)) return { trips: [], error: '格式不符(不是分帳記事本檔案)' };
    var trips = j.trips.map(function (t) { var n = normalizeTrip(t); if (opts && opts.newIds) { n.id = rid('t'); n.records.forEach(function (r) { r.id = rid('r'); }); } return n; });
    if (!trips.length) return { trips: [], error: '檔案裡沒有活動' };
    return { trips: trips, error: '' };
  }

  return { localDay: localDay, normDate: normDate, extractDate: extractDate, DRINK_PROMPT: DRINK_PROMPT, parseDrinkList: parseDrinkList, cupAmounts: cupAmounts, lineDesc: lineDesc, drinkListToRecord: drinkListToRecord, assignLine: assignLine, assignLineCounts: assignLineCounts, assignedCount: assignedCount, memberUsed: memberUsed, renameMember: renameMember, matchName: matchName, parseMembers: parseMembers, familyMembers: familyMembers, familyNames: familyNames, isChild: isChild, quickPick: quickPick, toggleFamily: toggleFamily, parseNote: parseNote, mergeNames: mergeNames, cleanName: cleanName, nameKey: nameKey, normalizeRecord: normalizeRecord, normalizeTrip: normalizeTrip, toExport: toExport, fromImport: fromImport, rid: rid };
});
