/* 把一段文字變成表格:以 Tab、逗號、兩個以上空白、直線符號分欄,每行一列;自動猜分欄方式、欄數,數字欄轉成數值。純函式。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tabletext = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DELIMS = ['tab', 'comma', 'spaces2', 'pipe', 'space1', 'group'];
  var LABELS = { auto: '自動', tab: 'Tab', comma: '逗號', spaces2: '兩個以上空白', pipe: '直線 |', space1: '單一空白', group: '每 N 行一列' };
  var THOUSAND = /(\d),(?=\d{3}(?!\d))/g;

  function lines(text) {
    return String(text == null ? '' : text).normalize('NFKC').replace(/\r/g, '').split('\n').map(function (l) { return l.replace(/\s+$/, ''); }).filter(function (l) { return l.trim() !== ''; });
  }
  function isSeparatorRow(l) { return /^[\s|:\-+=]+$/.test(l) && /-|=/.test(l); }
  function stripPipe(l) { return l.trim().replace(/^\|/, '').replace(/\|$/, ''); }

  function csvSplit(l, protect) {
    var s = protect ? l.replace(THOUSAND, '$1\u0001') : l, out = [], cur = '', q = false, i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s[i];
      if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"' && cur.trim() === '') { q = true; cur = ''; }
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(function (c) { return c.replace(/\u0001/g, ',').trim(); });
  }
  function splitOne(l, delim, target) {
    if (delim === 'tab') return l.split('\t').map(function (c) { return c.trim(); });
    if (delim === 'pipe') return stripPipe(l).split('|').map(function (c) { return c.trim(); });
    if (delim === 'spaces2') return l.trim().split(/\s{2,}|　+|\t/).map(function (c) { return c.trim(); });
    if (delim === 'space1') return l.trim().split(/\s+/);
    // comma:沒加引號的千分位(1,200)預設也會被拆開;若保護千分位後欄數剛好等於多數列的欄數,就用保護後的結果
    var naive = csvSplit(l, false);
    if (target && naive.length > target) { var prot = csvSplit(l, true); if (prot.length === target) return prot; }
    return naive;
  }
  function modal(counts) {
    var freq = {}, best = 0, bestN = 0;
    counts.forEach(function (c) { freq[c] = (freq[c] || 0) + 1; });
    Object.keys(freq).forEach(function (k) { if (freq[k] > bestN || (freq[k] === bestN && Number(k) > best)) { best = Number(k); bestN = freq[k]; } });
    return best;
  }

  // 猜分欄方式
  function detect(ls) {
    var body = ls.filter(function (l) { return !isSeparatorRow(l); }), n = body.length;
    if (!n) return 'space1';
    var half = Math.max(1, Math.ceil(n / 2));
    if (body.filter(function (l) { return l.indexOf('\t') >= 0; }).length >= half) return 'tab';
    if (n >= 2 && body.filter(function (l) { return l.indexOf('|') >= 0; }).length >= half) return 'pipe';
    var commaCounts = body.map(function (l) { return (l.replace(THOUSAND, '$1').match(/,/g) || []).length; });
    var cm = modal(commaCounts);
    if (cm >= 1 && commaCounts.filter(function (c) { return c === cm; }).length >= Math.max(1, Math.ceil(n * 0.7))) return 'comma';
    if (body.filter(function (l) { return /\S(\s{2,}|　+)\S/.test(l); }).length >= half) return 'spaces2';
    return 'space1';
  }

  var NUM_RE = /^[-+]?\d+(\.\d+)?$/;
  function cleanNum(v) {
    var s = String(v).trim().replace(/^(NT\$|TWD|US\$|\$|¥|￥|＄)/i, '').replace(/(元|塊|圓)$/, '').replace(/,/g, '').trim();
    return NUM_RE.test(s) ? s : null;
  }
  // 整欄(略過空格)都是數字才算數字欄;有前導 0 的整數(電話、編號)不算
  function numericCols(body, cols) {
    var out = [];
    for (var c = 0; c < cols; c++) {
      var any = false, ok = true;
      for (var r = 0; r < body.length && ok; r++) {
        var v = body[r][c]; if (v === undefined || String(v).trim() === '') continue;
        var n = cleanNum(v); if (n === null || (/^0\d/.test(n) && n.indexOf('.') < 0)) ok = false; else any = true;
      }
      if (ok && any) out.push(c);
    }
    return out;
  }

  /* ---- 即時文字常輸出「每格一行」:偵測每 N 行一列 ---- */
  function lineKind(l) { return cleanNum(l) !== null ? 'n' : 't'; }
  // 依重複的「文字行/數字行」型樣找 N(2~8);可含一組表頭。回傳 {n, header, sig} 或 null
  function detectGroup(text) {
    var ls = lines(text); if (ls.length < 4) return null;
    var kinds = ls.map(lineKind), best = null;
    for (var N = 2; N <= 8; N++) {
      for (var hd = 0; hd <= 1; hd++) {
        var start = hd ? N : 0, body = kinds.length - start;
        if (body < 2 * N || body % N !== 0) continue;
        var groups = body / N, ok = true, nn = 0, sig = [];
        for (var c = 0; c < N && ok; c++) {
          var nums = 0; for (var g = 0; g < groups; g++) if (kinds[start + g * N + c] === 'n') nums++;
          var frac = nums / groups;
          if (frac > 0.2 && frac < 0.8) ok = false;                 // 這一欄時而數字時而文字 → 不是穩定欄位
          sig.push(frac >= 0.8 ? 'n' : 't'); if (frac >= 0.8) nn++;
        }
        if (!ok || nn === 0) continue;
        if (hd && sig.some(function (x, c) { return x === 'n' && kinds[c] === 'n'; })) continue;   // 表頭組不該有數字
        if (!best || (N === best.n && hd && !best.header)) best = { n: N, header: !!hd, sig: sig };
      }
      if (best) break;                                              // 較小的 N 優先
    }
    return best;
  }
  function detectHeader(rows) {
    if (rows.length < 2) return false;
    var first = rows[0];
    if (first.some(function (v) { return String(v).trim() !== '' && cleanNum(v) !== null; })) return false;
    return true;
  }

  // opts: { delimiter: 'auto'|DELIMS, header: true|false|'auto', groupN: 數字|'auto' }
  function parse(text, opts) {
    opts = opts || {};
    var ls = lines(text).filter(function (l, i, a) { return !isSeparatorRow(l) || a.length === 1; });
    var empty = { delimiter: 'auto', used: 'space1', rows: [], cols: 0, columns: [], body: [], numericCols: [], warnings: [], group: null };
    if (!ls.length) return empty;
    var want = opts.delimiter || 'auto', used, rows, group = null, warnings = [];
    if (want === 'group') {
      var gd = detectGroup(text), n = opts.groupN && opts.groupN !== 'auto' ? Number(opts.groupN) : (gd ? gd.n : 0);
      if (n >= 2) { used = 'group'; group = { n: n, header: gd && gd.n === n ? gd.header : null }; }
      else { used = 'space1'; warnings.push('找不到固定的「每幾行一列」,請手動輸入 N。'); }
    } else if (want === 'auto') {
      var det = detect(ls), gd2 = detectGroup(text);
      if (det === 'space1' && gd2) { used = 'group'; group = { n: gd2.n, header: gd2.header }; } else used = det;
    } else used = want;
    if (used === 'group') {
      var cells = ls, n2 = group.n, rr = [];
      for (var i = 0; i < cells.length; i += n2) { var row = cells.slice(i, i + n2); while (row.length < n2) row.push(''); rr.push(row); }
      rows = rr;
      if (cells.length % n2) warnings.push('行數不是 ' + n2 + ' 的倍數,最後一列已補空格。');
    } else {
      var target = 0;
      if (used === 'comma') target = modal(ls.map(function (l) { return csvSplit(l, true).length; }));
      rows = ls.map(function (l) { return splitOne(l, used, target); });
    }
    var counts = rows.map(function (r) { return r.length; }), cols = modal(counts), maxc = Math.max.apply(null, counts);
    if (counts.some(function (c) { return c !== cols; })) warnings.push('有些列的欄數和多數列不同,已補空格;可以換一種分欄方式再看看。');
    if (used === 'space1' && cols > 1) warnings.push('用單一空白分欄:品名裡有空白的話會被拆開。');
    var width = Math.max(cols, 1), padded = rows.map(function (r) { var x = r.slice(0, Math.max(width, maxc)); while (x.length < Math.max(width, maxc)) x.push(''); return x; });
    var ncols = padded[0].length;
    var header;
    if (opts.header === 'auto') header = group && group.header !== null ? group.header : detectHeader(padded);
    else header = opts.header !== false && padded.length > 1;
    if (header && padded.length < 2) header = false;
    var columns = header ? padded[0].slice() : [];
    var body = header ? padded.slice(1) : padded;
    var nc = numericCols(body, ncols);
    var outBody = body.map(function (r) { return r.map(function (v, c) { if (nc.indexOf(c) >= 0 && String(v).trim() !== '') return cleanNum(v); return v; }); });
    return { delimiter: want, used: used, rows: padded, cols: ncols, columns: columns, body: outBody, numericCols: nc, warnings: warnings, group: group, header: header };
  }

  /* ---- 欄位快速修整(純函式,回傳新表格 {columns, rows}) ---- */
  function cloneSheet(s) { return { columns: (s.columns || []).slice(), rows: (s.rows || []).map(function (r) { return r.slice(); }) }; }
  function mergeCols(s, i, sep) {
    var c = cloneSheet(s), j = i + 1; if (j >= Math.max(c.columns.length, c.rows[0] ? c.rows[0].length : 0)) return c;
    var join = function (a, b) { return [a, b].filter(function (x) { return String(x == null ? '' : x).trim() !== ''; }).join(sep === undefined ? ' ' : sep); };
    if (c.columns.length) { c.columns[i] = join(c.columns[i], c.columns[j]); c.columns.splice(j, 1); }
    c.rows.forEach(function (r) { r[i] = join(r[i], r[j]); r.splice(j, 1); });
    return c;
  }
  // 依符號(預設:空白/逗號/冒號/斜線/橫線)在第一個符號處拆成兩欄;沒有符號的列,後面欄留空
  function splitCol(s, i, symbol) {
    var c = cloneSheet(s), re = symbol ? new RegExp(String(symbol).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : /[\s,,、::\-\/]+/;
    var sp = function (v) { v = String(v == null ? '' : v); var m = v.match(re); if (!m) return [v, '']; return [v.slice(0, m.index).trim(), v.slice(m.index + m[0].length).trim()]; };
    if (c.columns.length) { var h = sp(c.columns[i]); c.columns.splice(i, 1, h[0] || c.columns[i], h[1] || (c.columns[i] + '2')); }
    c.rows.forEach(function (r) { var x = sp(r[i]); r.splice(i, 1, x[0], x[1]); });
    return c;
  }
  function deleteCol(s, i) { var c = cloneSheet(s); if (c.columns.length) c.columns.splice(i, 1); c.rows.forEach(function (r) { r.splice(i, 1); }); return c; }
  function moveCol(s, i, dir) {
    var c = cloneSheet(s), j = i + (dir < 0 ? -1 : 1), n = Math.max(c.columns.length, c.rows[0] ? c.rows[0].length : 0);
    if (j < 0 || j >= n) return c;
    var sw = function (a) { var t = a[i]; a[i] = a[j]; a[j] = t; };
    if (c.columns.length) sw(c.columns); c.rows.forEach(sw); return c;
  }
  // 整欄設為數字:能轉的轉成數字字串(清掉 $、元、千分位);設為文字:原樣保留(例如電話、編號)
  function setColType(s, i, type) {
    var c = cloneSheet(s);
    if (type === 'number') c.rows.forEach(function (r) { var n = cleanNum(r[i]); if (n !== null) r[i] = n; });
    return c;
  }
  function deleteEmptyRows(s) { var c = cloneSheet(s); c.rows = c.rows.filter(function (r) { return r.some(function (v) { return String(v == null ? '' : v).trim() !== ''; }); }); return c; }

  /* ---- 同一模式下記住解析設定 ---- */
  function remember(storage, mode, st) { try { storage.setItem('pt_tt_' + mode, JSON.stringify({ delimiter: st.delimiter || 'auto', groupN: st.groupN || 'auto', header: st.header === undefined ? 'auto' : st.header })); return true; } catch (e) { return false; } }
  function recall(storage, mode) {
    var def = { delimiter: 'auto', groupN: 'auto', header: 'auto' };
    try { var v = JSON.parse(storage.getItem('pt_tt_' + mode)); if (v && typeof v === 'object') return { delimiter: DELIMS.concat(['auto']).indexOf(v.delimiter) >= 0 ? v.delimiter : 'auto', groupN: v.groupN === 'auto' || (Number(v.groupN) >= 2 && Number(v.groupN) <= 12) ? v.groupN : 'auto', header: v.header === true || v.header === false ? v.header : 'auto' }; } catch (e) { /* 用預設 */ }
    return def;
  }
  return { detectGroup: detectGroup, detectHeader: detectHeader, mergeCols: mergeCols, splitCol: splitCol, deleteCol: deleteCol, moveCol: moveCol, setColType: setColType, deleteEmptyRows: deleteEmptyRows, remember: remember, recall: recall, DELIMS: DELIMS, LABELS: LABELS, parse: parse, detect: function (t) { return detect(lines(t)); }, cleanNum: cleanNum };
});
