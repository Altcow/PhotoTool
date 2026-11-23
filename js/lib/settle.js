/* 分帳記事本結算(純函式,全部整數元)。
   均分餘數規則(每筆固定):餘數每人 1 元,依名單順序分給前面的人。
   記錄 rec: {id,title,payer,amount,participants[],split:{mode,...},items[],fees[]} */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Settle = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function uniq(list) { var out = []; (list || []).forEach(function (x) { x = String(x == null ? '' : x).trim(); if (x && out.indexOf(x) < 0) out.push(x); }); return out; }
  function sum(list) { return list.reduce(function (a, b) { return a + b; }, 0); }

  // 均分:每人 floor,餘數每人 1 元依序給前面的人
  function divide(amount, names) {
    var n = names.length, base = Math.floor(amount / n), rem = amount - base * n, out = {};
    names.forEach(function (p, i) { out[p] = base + (i < rem ? 1 : 0); });
    return out;
  }
  // 依權重分:floor 後餘數每人 1 元依序給前面(權重 > 0 者)
  function divideWeighted(amount, names, weights) {
    var total = sum(weights), out = {}, used = 0;
    names.forEach(function (p, i) { out[p] = Math.floor(amount * weights[i] / total); used += out[p]; });
    var rem = amount - used;
    for (var i = 0; i < names.length && rem > 0; i++) { if (weights[i] > 0) { out[names[i]] += 1; rem--; } }
    return out;
  }

  // 權重(小孩計費)以 1/100 為單位轉整數:1→100、0.5→50、0→0
  function wInt(w) { var n = Number(w); return isFinite(n) && n >= 0 ? Math.round(n * 100) : 100; }
  // 依成員權重均分;權重全為 1 時與 divide 完全相同(餘數 1 元依序給前面、權重 0 的人不拿餘數)
  function divideByWeights(amount, names, weights, useW) {
    if (useW === false || !weights) return divide(amount, names);
    var ws = names.map(function (p) { return weights[p] === undefined ? 100 : wInt(weights[p]); });
    if (sum(ws) <= 0) return null;
    return divideWeighted(amount, names, ws);
  }

  // 活動成員:成員清單 + 記錄中出現但不在清單的人(保持順序)
  function allMembers(trip) {
    var ms = uniq(trip.members);
    (trip.records || []).forEach(function (r) {
      [r.payer].concat(r.participants || [], (r.items || []).reduce(function (a, it) { return a.concat(it.people || []); }, []),
        Object.keys((r.split && r.split.amounts) || {}), Object.keys((r.split && r.split.shares) || {})).forEach(function (p) {
        p = String(p == null ? '' : p).trim(); if (p && ms.indexOf(p) < 0) ms.push(p);
      });
    });
    return ms;
  }

  function fail(code, error, diff) { return { ok: false, code: code, error: error, diff: diff === undefined ? null : diff, shares: {} }; }

  // 單筆記錄的個人應分攤。members 為全部成員(預設名單)
  function allocate(rec, members, ctx) {
    var W = ctx && ctx.weights ? ctx.weights : null;
    var ms = uniq(members);
    if (!rec || !String(rec.payer || '').trim()) return fail('NO_PAYER', '沒有付款人');
    if (!isInt(rec.amount) || rec.amount <= 0) return fail('BAD_AMOUNT', '金額必須是大於 0 的整數');
    var split = rec.split || { mode: 'equal' }, mode = split.mode || 'equal', amount = rec.amount, shares = {};
    var parts = uniq(rec.participants);
    if (!parts.length) parts = ms.slice();
    var base = function (names) { names.forEach(function (p) { if (ms.indexOf(p) < 0) ms.push(p); }); };

    if (mode === 'equal') {
      if (!parts.length) return fail('NO_PARTICIPANTS', '沒有分攤的人');
      shares = divideByWeights(amount, parts, W, rec.useWeights);
      if (!shares) return fail('ZERO_WEIGHT', '分攤的人計費權重全是 0,無法分攤');
    } else if (mode === 'shares') {
      var names = uniq(Object.keys(split.shares || {})), ws = names.map(function (p) { return split.shares[p]; });
      if (!names.length || ws.some(function (w) { return !isInt(w) || w < 0; }) || sum(ws) <= 0) return fail('BAD_SHARES', '份數必須是非負整數且至少一人大於 0');
      if (isInt(rec.qty) && rec.qty > 0 && sum(ws) !== rec.qty) return fail('QTY_MISMATCH', '已分配 ' + sum(ws) + '/' + rec.qty, rec.qty - sum(ws));
      shares = divideWeighted(amount, names, ws);
    } else if (mode === 'amounts') {
      var an = uniq(Object.keys(split.amounts || {})), av = an.map(function (p) { return split.amounts[p]; });
      if (!an.length || av.some(function (v) { return !isInt(v) || v < 0; })) return fail('BAD_AMOUNTS', '自訂金額必須是非負整數');
      var d = amount - sum(av);
      if (d !== 0) return fail('AMOUNTS_MISMATCH', '各人金額加總與總額差 ' + d + ' 元', d);
      an.forEach(function (p, i) { shares[p] = av[i]; });
    } else if (mode === 'items') {
      var items = rec.items || [], fees = rec.fees || [];
      if (!items.length) return fail('NO_ITEMS', '明細帳沒有品項');
      if (rec.requireAssign) {
        var asg = items.filter(function (x) { return uniq(x.people).length > 0; }).length;
        if (asg < items.length) return fail('UNASSIGNED', '已指派 ' + asg + '/' + items.length + ' 杯', items.length - asg);
      }
      var itemsTotal = 0, order = [], sub = {};
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!isInt(it.amount) || it.amount < 0) return fail('BAD_ITEM', '品項「' + (it.name || (i + 1)) + '」金額必須是非負整數');
        var who = uniq(it.people); if (!who.length) who = parts.length ? parts.slice() : ms.slice();
        if (!who.length) return fail('NO_PARTICIPANTS', '品項沒有分攤的人');
        itemsTotal += it.amount;
        var dv = divideByWeights(it.amount, who, W, rec.useWeights);
        if (!dv) return fail('ZERO_WEIGHT', '品項「' + (it.name || (i + 1)) + '」分攤的人計費權重全是 0');
        who.forEach(function (p) { if (order.indexOf(p) < 0) order.push(p); sub[p] = (sub[p] || 0) + dv[p]; });
      }
      var feesTotal = 0;
      for (var f = 0; f < fees.length; f++) { if (!isInt(fees[f].amount) || fees[f].amount < 0) return fail('BAD_FEE', '服務費/稅必須是非負整數'); feesTotal += fees[f].amount; }
      var diff = amount - itemsTotal - feesTotal;
      if (diff !== 0) return fail('ITEMS_MISMATCH', '品項合計' + (feesTotal ? '加費用' : '') + '與總額差 ' + diff + ' 元', diff);
      order.sort(function (a, b) { return ms.indexOf(a) - ms.indexOf(b); });
      order.forEach(function (p) { shares[p] = sub[p]; });
      fees.forEach(function (fe) {
        if (!fe.amount) return;
        var w = order.map(function (p) { return sub[p]; });
        var d2 = sum(w) > 0 ? divideWeighted(fe.amount, order, w) : divide(fe.amount, order);
        order.forEach(function (p) { shares[p] += d2[p]; });
      });
    } else return fail('BAD_MODE', '未知的分攤方式 ' + mode);

    var total = 0; Object.keys(shares).forEach(function (p) { total += shares[p]; base([p]); });
    if (total !== amount) return fail('UNBALANCED', '內部錯誤:分攤加總 ' + total + ' ≠ 總額 ' + amount);
    return { ok: true, code: '', error: '', diff: 0, shares: shares };
  }

  // 最少轉帳(貪婪):最大債權人 ← 最大債務人;同額時依成員順序,結果可重現
  function minTransfers(rows) {
    var cr = [], db = [];
    rows.forEach(function (r, i) { if (r.net > 0) cr.push({ name: r.name, amt: r.net, i: i }); else if (r.net < 0) db.push({ name: r.name, amt: -r.net, i: i }); });
    var best = function (arr) { var b = null; arr.forEach(function (x) { if (x.amt > 0 && (!b || x.amt > b.amt || (x.amt === b.amt && x.i < b.i))) b = x; }); return b; };
    var out = [];
    for (;;) {
      var c = best(cr), d = best(db);
      if (!c || !d) break;
      var pay = Math.min(c.amt, d.amt);
      out.push({ from: d.name, to: c.name, amount: pay });
      c.amt -= pay; d.amt -= pay;
    }
    return out;
  }

  // 已完成才計入結算;沒有 status 欄位的舊記錄視為已完成
  function isDone(rec) { return rec.status !== 'todo'; }
  // 成員計費權重:小孩用自訂權重(預設 1),大人固定 1
  function weightsOf(trip) {
    var w = {}, info = trip.info || {};
    allMembers(trip).forEach(function (p) { var i = info[p]; w[p] = i && i.kind === 'child' && i.weight !== undefined && i.weight !== null ? Number(i.weight) : 1; });
    return w;
  }
  // 整個活動結算。opts: {recordIds:[...]=只結算勾選的記錄(省略=全部), groupBy:'person'|'family'}
  // 以家庭結算時,同家庭成員(trip.families[成員]=家庭名)的已付與應分攤先合併,家庭內部不互相轉帳
  function settleTrip(trip, opts) {
    opts = opts || {};
    var fam = trip.families || {}, byFamily = opts.groupBy === 'family';
    var unit = function (p) { return byFamily && fam[p] ? String(fam[p]).trim() || p : p; };
    var ms = allMembers(trip), errors = [], recs = [], paid = {}, share = {}, units = [];
    var addUnit = function (u) { if (units.indexOf(u) < 0) { units.push(u); paid[u] = 0; share[u] = 0; } };
    ms.forEach(function (p) { addUnit(unit(p)); });
    var sel = opts.recordIds ? opts.recordIds.map(String) : null;
    var chosen = (trip.records || []).filter(function (r) { return !sel || sel.indexOf(String(r.id)) >= 0; });
    var pending = chosen.filter(function (r) { return !isDone(r); });
    var list = chosen.filter(isDone), ctx = { weights: weightsOf(trip) };
    list.forEach(function (rec) {
      var a = allocate(rec, ms.slice(), ctx);
      if (!a.ok) { errors.push({ recordId: rec.id, title: rec.title, code: a.code, error: a.error, diff: a.diff }); recs.push({ id: rec.id, title: rec.title, payer: rec.payer, amount: rec.amount, ok: false, shares: {} }); return; }
      var payerU = unit(String(rec.payer).trim()); addUnit(payerU);
      var sh = {};
      Object.keys(a.shares).forEach(function (p) { var u = unit(p); addUnit(u); sh[u] = (sh[u] || 0) + a.shares[p]; });
      paid[payerU] += rec.amount;
      Object.keys(sh).forEach(function (u) { share[u] += sh[u]; });
      recs.push({ id: rec.id, title: rec.title, payer: payerU, amount: rec.amount, ok: true, shares: sh });
    });
    var rows = units.map(function (p) { return { name: p, paid: paid[p], share: share[p], net: paid[p] - share[p] }; });
    var sumNet = sum(rows.map(function (r) { return r.net; }));
    var spent = sum(recs.filter(function (r) { return r.ok; }).map(function (r) { return r.amount; }));
    return { members: units, rows: rows, records: recs, errors: errors, totalSpent: spent, sumNet: sumNet, balanced: sumNet === 0, transfers: minTransfers(rows), selectedCount: list.length, pendingCount: pending.length, pending: pending.map(function (r) { return { id: r.id, title: r.title }; }), groupBy: byFamily ? 'family' : 'person' };
  }

  // 「依每筆明細」:每筆記錄中,每個分攤者(付款人以外)欠付款人多少
  function detailTransfers(result) {
    var out = [];
    result.records.forEach(function (r) {
      if (!r.ok) return;
      Object.keys(r.shares).forEach(function (p) { if (p !== r.payer && r.shares[p] > 0) out.push({ from: p, to: r.payer, amount: r.shares[p], recordId: r.id, title: r.title }); });
    });
    return out;
  }

  // 個人/家庭對帳單:加項=他付出的(別人欠他)、減項=他要分攤給別人付的款、總計=淨額與轉帳對象
  // mode: 'min'(最少轉帳結果)| 'detail'(依每筆明細,同一對象逐筆合併後互抵)。兩種的淨額必相同
  function statement(result, name, mode) {
    var plus = [], minus = [], row = null;
    result.rows.forEach(function (r) { if (r.name === name) row = r; });
    result.records.forEach(function (r) {
      if (!r.ok) return;
      var mine = r.shares[name] || 0;
      if (r.payer === name) plus.push({ recordId: r.id, title: r.title, paid: r.amount, othersOwe: r.amount - mine });
      else if (mine > 0) minus.push({ recordId: r.id, title: r.title, share: mine, to: r.payer });
    });
    var byPayer = [];
    minus.forEach(function (m) { var g = null; byPayer.forEach(function (x) { if (x.to === m.to) g = x; }); if (!g) { g = { to: m.to, amount: 0 }; byPayer.push(g); } g.amount += m.share; });
    var plusOwed = sum(plus.map(function (p) { return p.othersOwe; })), minusTotal = sum(minus.map(function (m) { return m.share; }));
    var pay = [], receive = [];
    if (mode === 'detail') {
      var pair = {}, order = [];
      detailTransfers(result).forEach(function (t) {
        var other = t.from === name ? t.to : (t.to === name ? t.from : null);
        if (other === null) return;
        if (pair[other] === undefined) { pair[other] = 0; order.push(other); }
        pair[other] += t.from === name ? -t.amount : t.amount;   // 正=對方欠我
      });
      order.forEach(function (o) { if (pair[o] > 0) receive.push({ name: o, amount: pair[o] }); else if (pair[o] < 0) pay.push({ name: o, amount: -pair[o] }); });
    } else {
      result.transfers.forEach(function (t) { if (t.from === name) pay.push({ name: t.to, amount: t.amount }); else if (t.to === name) receive.push({ name: t.from, amount: t.amount }); });
    }
    var payTotal = sum(pay.map(function (x) { return x.amount; })), receiveTotal = sum(receive.map(function (x) { return x.amount; }));
    return { name: name, paidTotal: row ? row.paid : 0, shareTotal: row ? row.share : 0, plus: plus, plusOwed: plusOwed, minus: minus, minusByPayer: byPayer, minusTotal: minusTotal,
      net: plusOwed - minusTotal, pay: pay, receive: receive, payTotal: payTotal, receiveTotal: receiveTotal, finalNet: receiveTotal - payTotal };
  }

  function partyText(list) { return list.map(function (x) { return x.name + ' $' + x.amount; }).join('、'); }
  // 由已算好的對帳單物件(即時或快照)產生文字
  function formatStatement(st, name, tripName, dateStr, count, groupBy) {
    var lines = ['【' + name + ' 對帳單】', tripName + ' ' + dateStr + ' 已選 ' + count + ' 筆' + (groupBy === 'family' ? '(以家庭結算)' : '')];
    lines.push('加項(已付出,別人欠' + name + '):');
    if (!st.plus.length) lines.push(' (無)');
    st.plus.forEach(function (p) { lines.push(' ' + p.title + ' 總付出 ' + p.paid + '元(別人應分攤給' + name + ' ' + p.othersOwe + '元)'); });
    if (st.plus.length) lines.push(' 小計:別人欠' + name + ' ' + st.plusOwed + '元');
    lines.push('減項(需付給別人):');
    if (!st.minus.length) lines.push(' (無)');
    st.minus.forEach(function (m) { lines.push(' ' + m.title + ' 應分攤 ' + m.share + '元 → 付給 ' + m.to); });
    st.minusByPayer.forEach(function (g) { lines.push(' 小計:付給 ' + g.to + ' ' + g.amount + '元'); });
    if (!st.pay.length && !st.receive.length) lines.push('總計:' + name + '已打平,無須轉帳');
    else {
      var parts = [];
      if (st.pay.length) parts.push(name + '還要掏出 $' + st.payTotal + ',分別給:' + partyText(st.pay));
      if (st.receive.length) parts.push(name + '可收回 $' + st.receiveTotal + ',來自:' + partyText(st.receive));
      lines.push('總計:' + parts.join(';'));
    }
    return lines.join('\n');
  }
  function statementText(trip, result, name, dateStr, mode) {
    return formatStatement(statement(result, name, mode), name, trip.name, dateStr, result.selectedCount, result.groupBy);
  }
  function allStatementsText(trip, result, dateStr, mode) {
    var out = result.rows.map(function (r) { return statementText(trip, result, r.name, dateStr, mode); });
    if (result.balanced && !result.transfers.length) out.push('全部已平衡,無須轉帳');
    return out.join('\n\n');
  }

  // 某成員在每筆記錄的明細
  function memberBreakdown(result, name) {
    return result.records.filter(function (r) { return r.ok; }).map(function (r) { return { recordId: r.id, title: r.title, paid: r.payer === name ? r.amount : 0, share: r.shares[name] || 0 }; })
      .filter(function (b) { return b.paid || b.share; });
  }

  function summaryText(trip, result, dateStr, mode) {
    var lines = ['【' + trip.name + ' 分帳 ' + dateStr + '】', '總花費 $' + result.totalSpent + '(' + result.records.filter(function (r) { return r.ok; }).length + ' 筆)', '每人:'];
    result.rows.forEach(function (r) {
      var tail = r.net > 0 ? '應收 $' + r.net : r.net < 0 ? '應付 $' + (-r.net) : '已打平';
      lines.push(' ' + r.name + ':已付 $' + r.paid + ' / 分攤 $' + r.share + ' → ' + tail);
    });
    var list = mode === 'detail' ? detailTransfers(result) : result.transfers;
    if (result.pendingCount) lines.push('(尚有 ' + result.pendingCount + ' 筆待填,未納入)');
    lines.push('誰付給誰:');
    if (!list.length) lines.push(' (不需要轉帳)');
    list.forEach(function (t) { lines.push(' ' + t.from + ' → ' + t.to + '  $' + t.amount + (t.title ? '(' + t.title + ')' : '')); });
    return lines.join('\n');
  }

  // 純文字報表(貼 LINE 用)。which:'__summary' 總表、'__all' 全部對帳單、其他=單一家庭/個人的對帳單。每次都由目前資料重新計算,不存快照
  function reportText(trip, result, dateStr, mode, which) {
    if (!which || which === '__summary') return summaryText(trip, result, dateStr, mode);
    if (which === '__all') return allStatementsText(trip, result, dateStr, mode) + (result.pendingCount ? '\n\n(尚有 ' + result.pendingCount + ' 筆待填,未納入)' : '');
    return statementText(trip, result, which, dateStr, mode);
  }

  // 存入記帳本用:某成員每筆的應分攤
  function memberShares(result, name) {
    return result.records.filter(function (r) { return r.ok && (r.shares[name] || 0) > 0; }).map(function (r) { return { recordId: r.id, title: r.title, share: r.shares[name] }; });
  }

  // 平均分 → 明細帳:總額變成一個品項(人=原參與者,空=全員);總額不變
  function toItems(rec) {
    var c = JSON.parse(JSON.stringify(rec));
    c.split = { mode: 'items' };
    c.items = [{ name: c.title || '品項', qty: 1, amount: c.amount, people: uniq(c.participants) }];
    c.fees = c.fees || [];
    return c;
  }
  // 明細帳 → 平均分(會丟掉品項明細):參與者=所有品項出現過的人,沒有則全員
  function toEqual(rec) {
    var c = JSON.parse(JSON.stringify(rec));
    var who = []; (c.items || []).forEach(function (it) { uniq(it.people).forEach(function (p) { if (who.indexOf(p) < 0) who.push(p); }); });
    c.split = { mode: 'equal' }; c.participants = who; c.items = []; c.fees = [];
    return c;
  }
  function itemsTotal(rec) { return sum((rec.items || []).map(function (i) { return isInt(i.amount) ? i.amount : 0; })) + sum((rec.fees || []).map(function (f) { return isInt(f.amount) ? f.amount : 0; })); }

  return {
    isDone: isDone, weightsOf: weightsOf, divideByWeights: divideByWeights, reportText: reportText,
    divide: divide, divideWeighted: divideWeighted, allMembers: allMembers, allocate: allocate, minTransfers: minTransfers, settleTrip: settleTrip,
    detailTransfers: detailTransfers, statement: statement, formatStatement: formatStatement, statementText: statementText, allStatementsText: allStatementsText, memberBreakdown: memberBreakdown, memberShares: memberShares, summaryText: summaryText, toItems: toItems, toEqual: toEqual, itemsTotal: itemsTotal,
  };
});
