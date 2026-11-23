/* 我的旅行統計:依團/日期/月彙整、我家應分攤與付出、淨額、跨團合計(純函式,整數元) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./settle.js'), require('./ledger.js'));
  else root.Stats = factory(root.Settle, root.Ledger);
})(typeof self !== 'undefined' ? self : this, function (Settle, Ledger) {
  function sum(list) { return list.reduce(function (a, b) { return a + b; }, 0); }

  // 這個團裡「我」是誰:meId 在名單內就用;否則用設定的「我的名稱」完全相符;都不是 → ''
  function resolveMe(trip, myName) {
    if (trip.meId && (trip.members || []).indexOf(trip.meId) >= 0) return trip.meId;
    if (myName) { var m = Ledger.matchName(myName, trip.members || []); if (m.status === 'exact') return m.member; }
    return '';
  }
  // 我家 = 與我同家庭的成員(沒設家庭就只有我)
  function familyOf(trip, me) {
    if (!me) return [];
    var f = (trip.families || {})[me];
    return f ? Ledger.familyMembers(trip, f) : [me];
  }
  function inRange(date, range) {
    if (!range) return true;
    if (range.from && date < range.from) return false;
    if (range.to && date > range.to) return false;
    return true;
  }
  // 期間輔助:'2026' 年、'2026-11' 月 → {from,to}
  function periodRange(year, month) {
    if (!year) return null;
    var y = String(year);
    if (month) { var m = ('0' + month).slice(-2); return { from: y + '-' + m + '-01', to: y + '-' + m + '-31' }; }
    return { from: y + '-01-01', to: y + '-12-31' };
  }

  // 單一團統計。opts: {myName, range:{from,to}}
  function tripStats(trip, opts) {
    opts = opts || {};
    var me = resolveMe(trip, opts.myName), fam = familyOf(trip, me), ctx = { weights: Settle.weightsOf(trip) }, ms = Settle.allMembers(trip);
    var days = {}, order = [], pending = 0, errors = [], dates = [];
    var totals = { totalSpent: 0, familyShare: 0, myPaid: 0, familyPaid: 0 };
    (trip.records || []).forEach(function (rec) {
      if (!inRange(rec.date, opts.range)) return;
      if (!Settle.isDone(rec)) { pending++; return; }
      var a = Settle.allocate(rec, ms.slice(), ctx);
      if (!a.ok) { errors.push({ recordId: rec.id, title: rec.title, error: a.error }); return; }
      var fs = sum(fam.map(function (p) { return a.shares[p] || 0; })), mine = rec.payer === me ? rec.amount : 0, famPaid = fam.indexOf(rec.payer) >= 0 ? rec.amount : 0;
      var d = days[rec.date];
      if (!d) { d = days[rec.date] = { date: rec.date, total: 0, familyShare: 0, myPaid: 0, familyPaid: 0, records: [] }; order.push(rec.date); }
      d.total += rec.amount; d.familyShare += fs; d.myPaid += mine; d.familyPaid += famPaid;
      d.records.push({ id: rec.id, title: rec.title, amount: rec.amount, payer: rec.payer, familyShare: fs, myPaid: mine });
      totals.totalSpent += rec.amount; totals.familyShare += fs; totals.myPaid += mine; totals.familyPaid += famPaid; dates.push(rec.date);
    });
    order.sort();
    return {
      tripId: trip.id, name: trip.name, me: me, family: fam, familyName: me ? ((trip.families || {})[me] || '') : '',
      range: dates.length ? { min: dates.slice().sort()[0], max: dates.slice().sort()[dates.length - 1] } : null,
      totalSpent: totals.totalSpent, familyShare: totals.familyShare, myPaid: totals.myPaid, familyPaid: totals.familyPaid, familyNet: totals.familyPaid - totals.familyShare,
      pending: pending, errors: errors, byDate: order.map(function (k) { return days[k]; }),
    };
  }
  // 跨團總覽(各團只計期間內、已完成的記錄)
  function overview(statsList) {
    return {
      trips: statsList.length, totalSpent: sum(statsList.map(function (s) { return s.totalSpent; })), familyShare: sum(statsList.map(function (s) { return s.familyShare; })),
      myPaid: sum(statsList.map(function (s) { return s.myPaid; })), familyPaid: sum(statsList.map(function (s) { return s.familyPaid; })),
      familyNet: sum(statsList.map(function (s) { return s.familyNet; })), pending: sum(statsList.map(function (s) { return s.pending; })),
    };
  }
  function allStats(trips, opts) {
    return trips.map(function (t) { return tripStats(t, opts); }).filter(function (s) { return !(opts && opts.range) || s.byDate.length > 0 || s.pending > 0; });
  }
  // 可選的年份與月份(依所有團的記錄日期)
  function availablePeriods(trips) {
    var set = {};
    trips.forEach(function (t) { (t.records || []).forEach(function (r) { if (r.date) set[r.date.slice(0, 7)] = 1; }); });
    var months = Object.keys(set).sort(), years = [];
    months.forEach(function (m) { var y = m.slice(0, 4); if (years.indexOf(y) < 0) years.push(y); });
    return { months: months, years: years };
  }
  // 存入記帳本用:我家每筆應分攤(可帶期間)。id 用 trip+record 防重複
  function familyShareRows(trip, opts) {
    opts = opts || {};
    var me = resolveMe(trip, opts.myName), fam = familyOf(trip, me), ctx = { weights: Settle.weightsOf(trip) }, ms = Settle.allMembers(trip), out = [];
    (trip.records || []).forEach(function (rec) {
      if (!Settle.isDone(rec) || !inRange(rec.date, opts.range)) return;
      var a = Settle.allocate(rec, ms.slice(), ctx);
      if (!a.ok) return;
      var fs = sum(fam.map(function (p) { return a.shares[p] || 0; }));
      if (fs > 0) out.push({ recordId: rec.id, title: rec.title, date: rec.date, share: fs });
    });
    return out;
  }
  return { resolveMe: resolveMe, familyOf: familyOf, periodRange: periodRange, tripStats: tripStats, overview: overview, allStats: allStats, availablePeriods: availablePeriods, familyShareRows: familyShareRows };
});
