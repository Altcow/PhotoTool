/* 驗算與正規化:日期、中文數字金額、品項加總 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Reconcile = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DIGITS = { '零': 0, '〇': 0, '○': 0, '一': 1, '二': 2, '兩': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  var UNITS = { '十': 10, '百': 100, '千': 1000 };

  // 中文(含混合阿拉伯)數字轉數字;無法解析回 null
  function cnToNumber(str) {
    if (str == null) return null;
    var s = String(str).trim().replace(/[,，\s]/g, '');
    if (!s) return null;
    var neg = false;
    if (s[0] === '-' || s[0] === '負') { neg = true; s = s.slice(1); }
    var dot = s.search(/[點点.]/);
    var intPart = dot >= 0 ? s.slice(0, dot) : s;
    var fracPart = dot >= 0 ? s.slice(dot + 1) : '';
    var iv = parseInt_(intPart);
    if (iv === null) return null;
    var val = iv;
    if (fracPart) {
      var f = '';
      for (var i = 0; i < fracPart.length; i++) {
        var c = fracPart[i];
        if (/\d/.test(c)) f += c;
        else if (DIGITS[c] !== undefined) f += DIGITS[c];
        else return null;
      }
      val = Number(iv + '.' + f);
    }
    return neg ? -val : val;
  }

  function parseInt_(s) {
    if (s === '') return 0;
    if (/^\d+$/.test(s)) return Number(s);
    var hasUnit = /[十百千萬万億亿]/.test(s);
    var i, c;
    if (!hasUnit) {
      var out = '';
      for (i = 0; i < s.length; i++) {
        c = s[i];
        if (/\d/.test(c)) out += c;
        else if (DIGITS[c] !== undefined) out += DIGITS[c];
        else return null;
      }
      return Number(out);
    }
    var total = 0, section = 0, num = 0, lastUnit = 0, hasNum = false, zero = false;
    i = 0;
    while (i < s.length) {
      c = s[i];
      if (/\d/.test(c)) {
        var j = i; while (j < s.length && /\d/.test(s[j])) j++;
        num = Number(s.slice(i, j)); hasNum = true; i = j; continue;
      }
      if (c === '零' || c === '〇' || c === '○') { zero = true; i++; continue; }
      if (DIGITS[c] !== undefined) { num = DIGITS[c]; hasNum = true; i++; continue; }
      if (UNITS[c]) {
        section += (hasNum ? num : 1) * UNITS[c];
        lastUnit = UNITS[c]; num = 0; hasNum = false; i++; continue;
      }
      if (c === '萬' || c === '万') { section += num; total += (section || 1) * 10000; section = 0; num = 0; hasNum = false; lastUnit = 10000; i++; continue; }
      if (c === '億' || c === '亿') { section += num; total = (total + section) * 100000000; section = 0; num = 0; hasNum = false; lastUnit = 0; i++; continue; }
      return null;
    }
    if (hasNum) {
      // 「一百二」=120、「一千二」=1200
      if (lastUnit >= 100 && num < 10 && !zero) num = num * (lastUnit / 10);
      section += num;
    }
    return total + section;
  }

  // 金額字串 -> 數字;支援 "NT$1,234"、"七十五元"、"75"
  function parseAmount(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v == null) return null;
    var s = String(v).trim().replace(/NT\$?|TWD|\$|＄|元|塊|块|圓|圆/gi, '').replace(/[,，\s]/g, '');
    if (!s) return null;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return cnToNumber(s);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function validYMD(y, m, d) {
    if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }

  // 日期正規化 -> YYYY-MM-DD 或 null。opts.today 供缺年份時補年。
  function normalizeDate(input, opts) {
    if (input == null) return null;
    var s = String(input).trim();
    if (!s) return null;
    var roc = false;
    if (/^(民國|民国|中華民國|中华民国)/.test(s)) { roc = true; s = s.replace(/^(中華民國|中华民国|民國|民国)\s*/, ''); }
    var m, y, mo, d;
    if (/^\d{8}$/.test(s)) return validYMD(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8));
    if (/^\d{7}$/.test(s)) return validYMD(+s.slice(0, 3) + 1911, +s.slice(3, 5), +s.slice(5, 7));
    m = s.match(/^(\d{1,4})\s*[-\/.]\s*(\d{1,2})\s*[-\/.]\s*(\d{1,2})$/);
    if (m) {
      var ys = m[1];
      if (ys.length === 4) y = +ys;
      else if (ys.length === 3 || (roc && ys.length <= 3)) y = +ys + 1911;
      else return null;
      return validYMD(y, +m[2], +m[3]);
    }
    m = s.match(/^(.+?)年\s*(.+?)月\s*(?:(.+?)[日號号])?$/);
    if (m) {
      y = cnToNumber(m[1]); mo = cnToNumber(m[2]); d = m[3] != null ? cnToNumber(m[3]) : 1;
      if (y == null || mo == null || d == null) return null;
      if (roc || y < 200) y += 1911;
      return validYMD(y, mo, d);
    }
    m = s.match(/^(\d{1,2})\s*[-\/.月]\s*(\d{1,2})[日號号]?$/);
    if (m && opts && opts.today) return validYMD(+String(opts.today).slice(0, 4), +m[1], +m[2]);
    return null;
  }

  function itemAmount(it) {
    var a = parseAmount(it && it.amount);
    if (a !== null) return a;
    var q = parseAmount(it && it.qty), u = parseAmount(it && it.unit_price);
    if (q !== null && u !== null) return Math.round(q * u * 100) / 100;
    return null;
  }

  // 品項加總 vs 總額
  function checkItemsTotal(items, total) {
    var cents = 0, missing = [];
    (items || []).forEach(function (it, i) {
      var a = itemAmount(it);
      if (a === null) missing.push(i); else cents += Math.round(a * 100);
    });
    var sum = cents / 100;
    var t = parseAmount(total);
    if (t === null) return { ok: false, reason: 'no_total', sum: sum, total: null, diff: null, missing: missing };
    var diff = Math.round(t * 100 - cents) / 100;
    var hasItems = items && items.length > 0;
    if (!hasItems) return { ok: true, reason: '', sum: 0, total: t, diff: 0, missing: [] };
    return { ok: diff === 0 && missing.length === 0, reason: diff !== 0 ? 'mismatch' : (missing.length ? 'missing_amount' : ''), sum: sum, total: t, diff: diff, missing: missing };
  }

  function itemsTotalConflict(draft) {
    var r = checkItemsTotal(draft.items, draft.total);
    if (r.ok || r.reason !== 'mismatch') return null;
    return { field: 'total', voice_value: String(r.total), receipt_value: String(r.sum), source: 'calc' };
  }

  // 正規化草稿欄位,回傳 {data, issues}
  function normalizeDraft(raw, today) {
    var data = JSON.parse(JSON.stringify(raw || {}));
    var issues = [];
    var nd = normalizeDate(data.date, { today: today });
    if (data.date && !nd) issues.push('date');
    data.date = nd || '';
    var t = parseAmount(data.total);
    if (data.total != null && data.total !== '' && t === null) issues.push('total');
    data.total = t;
    data.items = (Array.isArray(data.items) ? data.items : []).map(function (it) {
      return {
        name: it && it.name != null ? String(it.name) : '',
        qty: parseAmount(it && it.qty),
        unit_price: parseAmount(it && it.unit_price),
        amount: itemAmount(it)
      };
    });
    if (typeof data.shared === 'string') data.shared = /^(true|是|y|yes|1)$/i.test(data.shared);
    data.shared = !!data.shared;
    return { data: data, issues: issues };
  }

  // 數字運算(由程式算,模型不算);回 {value, expr} 或 null
  function calcNumbers(values, op) {
    var v = (values || []).filter(function (x) { return typeof x === 'number' && isFinite(x); });
    if (!v.length) return null;
    var R = function (x) { return Math.round(x * 1e6) / 1e6; };
    var sumScaled = function (arr) { var t = 0; arr.forEach(function (x) { t += Math.round(x * 1e6); }); return t / 1e6; };
    var val;
    switch (op) {
      case 'avg': val = R(sumScaled(v) / v.length); break;
      case 'diff': val = R(v[0] - sumScaled(v.slice(1))); break;
      case 'product': val = R(v.reduce(function (a, b) { return a * b; }, 1)); break;
      case 'min': val = Math.min.apply(null, v); break;
      case 'max': val = Math.max.apply(null, v); break;
      case 'count': val = v.length; break;
      default: val = sumScaled(v); op = 'sum';
    }
    var joiner = { sum: ' + ', avg: ' + ', diff: ' - ', product: ' × ', min: ', ', max: ', ', count: ', ' }[op];
    return { value: val, expr: op + '(' + v.join(joiner) + ')' };
  }

  return { calcNumbers: calcNumbers, cnToNumber: cnToNumber, parseAmount: parseAmount, normalizeDate: normalizeDate, itemAmount: itemAmount, checkItemsTotal: checkItemsTotal, itemsTotalConflict: itemsTotalConflict, normalizeDraft: normalizeDraft };
});
