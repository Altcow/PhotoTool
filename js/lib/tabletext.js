/* 把一段文字變成表格:以 Tab、逗號、兩個以上空白、直線符號分欄,每行一列;自動猜分欄方式、欄數,數字欄轉成數值。純函式。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tabletext = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DELIMS = ['tab', 'comma', 'spaces2', 'pipe', 'space1'];
  var LABELS = { auto: '自動', tab: 'Tab', comma: '逗號', spaces2: '兩個以上空白', pipe: '直線 |', space1: '單一空白' };
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

  // opts: { delimiter: 'auto'|DELIMS, header: true|false }
  function parse(text, opts) {
    opts = opts || {};
    var ls = lines(text).filter(function (l, i, a) { return !isSeparatorRow(l) || a.length === 1; });
    if (!ls.length) return { delimiter: 'auto', used: 'space1', rows: [], cols: 0, columns: [], body: [], numericCols: [], warnings: [] };
    var used = opts.delimiter && opts.delimiter !== 'auto' ? opts.delimiter : detect(ls);
    var target = 0;
    if (used === 'comma') target = modal(ls.map(function (l) { return csvSplit(l, true).length; }));
    var rows = ls.map(function (l) { return splitOne(l, used, target); });
    var counts = rows.map(function (r) { return r.length; }), cols = modal(counts), maxc = Math.max.apply(null, counts);
    var warnings = [];
    if (counts.some(function (c) { return c !== cols; })) warnings.push('有些列的欄數和多數列不同,已補空格;可以換一種分欄方式再看看。');
    if (used === 'space1' && cols > 1) warnings.push('用單一空白分欄:品名裡有空白的話會被拆開。');
    var width = Math.max(cols, 1), padded = rows.map(function (r) { var x = r.slice(0, Math.max(width, maxc)); while (x.length < Math.max(width, maxc)) x.push(''); return x; });
    var ncols = padded[0].length;
    var header = opts.header !== false && padded.length > 1;
    var columns = header ? padded[0].slice() : [];
    var body = header ? padded.slice(1) : padded;
    var nc = numericCols(body, ncols);
    var outBody = body.map(function (r) { return r.map(function (v, c) { if (nc.indexOf(c) >= 0 && String(v).trim() !== '') return cleanNum(v); return v; }); });
    return { delimiter: opts.delimiter || 'auto', used: used, rows: padded, cols: ncols, columns: columns, body: outBody, numericCols: nc, warnings: warnings };
  }
  return { DELIMS: DELIMS, LABELS: LABELS, parse: parse, detect: function (t) { return detect(lines(t)); }, cleanNum: cleanNum };
});
