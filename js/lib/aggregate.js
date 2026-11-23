/* 期間分桶與分類統計。週一起算;所有日期為 YYYY-MM-DD 字串,用 UTC 運算避免時區問題 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Aggregate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var PERIODS = ['day', 'week', 'month', 'quarter', 'half', 'year'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parse(s) { var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return null; return { y: +m[1], m: +m[2], d: +m[3] }; }
  function toStr(dt) { return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate()); }
  function utc(y, m, d) { return new Date(Date.UTC(y, m - 1, d)); }
  function addDays(s, n) { var p = parse(s); var dt = utc(p.y, p.m, p.d); dt.setUTCDate(dt.getUTCDate() + n); return toStr(dt); }
  function weekStart(s) { var p = parse(s); var dow = utc(p.y, p.m, p.d).getUTCDay(); return addDays(s, -((dow + 6) % 7)); }
  function monthEnd(y, m) { return toStr(utc(y, m + 1, 0)); }

  function bucketRange(s, period) {
    var p = parse(s); if (!p) return null;
    var start, end, key, label;
    if (period === 'day') { start = end = key = toStr(utc(p.y, p.m, p.d)); label = key; }
    else if (period === 'week') { start = weekStart(s); end = addDays(start, 6); key = start; label = start + ' ~ ' + end; }
    else if (period === 'month') { start = p.y + '-' + pad(p.m) + '-01'; end = monthEnd(p.y, p.m); key = p.y + '-' + pad(p.m); label = p.y + ' 年 ' + p.m + ' 月'; }
    else if (period === 'quarter') { var q = Math.floor((p.m - 1) / 3); start = p.y + '-' + pad(q * 3 + 1) + '-01'; end = monthEnd(p.y, q * 3 + 3); key = p.y + '-Q' + (q + 1); label = p.y + ' 年第 ' + (q + 1) + ' 季'; }
    else if (period === 'half') { var h = p.m <= 6 ? 0 : 1; start = p.y + '-' + pad(h * 6 + 1) + '-01'; end = monthEnd(p.y, h * 6 + 6); key = p.y + '-H' + (h + 1); label = p.y + ' 年' + (h ? '下' : '上') + '半年'; }
    else if (period === 'year') { start = p.y + '-01-01'; end = p.y + '-12-31'; key = String(p.y); label = p.y + ' 年'; }
    else return null;
    return { key: key, start: start, end: end, label: label };
  }
  function bucketKey(s, period) { var r = bucketRange(s, period); return r ? r.key : null; }

  function shiftAnchor(s, period, n) {
    var p = parse(s);
    if (period === 'day') return addDays(s, n);
    if (period === 'week') return addDays(s, 7 * n);
    var months = period === 'month' ? n : period === 'quarter' ? 3 * n : period === 'half' ? 6 * n : 12 * n;
    var total = p.y * 12 + (p.m - 1) + months;
    var y = Math.floor(total / 12), m = total % 12 + 1;
    var d = Math.min(p.d, +monthEnd(y, m).slice(8));
    return y + '-' + pad(m) + '-' + pad(d);
  }

  // filter: {mode:'all'|'me'|'family', me:'名稱'}
  function payerOk(r, f) {
    if (!f || f.mode === 'all') return true;
    if (f.mode === 'me') return r.payer === f.me;
    return r.payer !== f.me;
  }

  function summarize(records, opts) {
    var range = bucketRange(opts.anchor, opts.period);
    var cents = 0, count = 0, map = {};
    (records || []).forEach(function (r) {
      if (!r.date || r.date < range.start || r.date > range.end) return;
      if (!payerOk(r, opts.payerFilter)) return;
      var c = Math.round(Number(r.total || 0) * 100);
      var cat = r.category || '其他';
      map[cat] = (map[cat] || 0) + c; cents += c; count++;
    });
    var cats = Object.keys(map).map(function (k) {
      return { category: k, amount: map[k] / 100, pct: cents ? Math.round(map[k] * 1000 / cents) / 10 : 0 };
    }).sort(function (a, b) { return b.amount - a.amount; });
    return { range: range, total: cents / 100, count: count, categories: cats };
  }

  function groupByBucket(records, period, filter) {
    var map = {};
    (records || []).forEach(function (r) {
      if (!r.date || !payerOk(r, filter)) return;
      var k = bucketKey(r.date, period); if (!k) return;
      var b = map[k] || (map[k] = { cents: 0, count: 0 });
      b.cents += Math.round(Number(r.total || 0) * 100); b.count++;
    });
    return Object.keys(map).sort().map(function (k) { return { key: k, total: map[k].cents / 100, count: map[k].count }; });
  }

  // 位置分群:座標四捨五入到小數 3 位(約 100 公尺)
  function locationKey(loc) {
    if (!loc || !isFinite(loc.lat) || !isFinite(loc.lng)) return '';
    return (Math.round(loc.lat * 1000) / 1000).toFixed(3) + ',' + (Math.round(loc.lng * 1000) / 1000).toFixed(3);
  }
  function groupByLocation(records) {
    var map = {};
    (records || []).forEach(function (r) {
      var k = locationKey(r.location); if (!k) return;
      map[k] = (map[k] || 0) + 1;
    });
    return Object.keys(map).sort().map(function (k) { return { key: k, count: map[k] }; });
  }

  return { locationKey: locationKey, groupByLocation: groupByLocation, PERIODS: PERIODS, bucketRange: bucketRange, bucketKey: bucketKey, weekStart: weekStart, shiftAnchor: shiftAnchor, summarize: summarize, groupByBucket: groupByBucket };
});
