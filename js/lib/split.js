/* 分帳計算:整數運算(預設單位=元;有小數時自動改用分)。餘數規則:歸第一位 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Split = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function uniq(arr) { var out = []; (arr || []).forEach(function (a) { a = String(a).trim(); if (a && out.indexOf(a) < 0) out.push(a); }); return out; }
  function hasDec(x) { return x != null && x !== '' && num(x) % 1 !== 0; }

  // 均分:每人 floor,餘數整筆給第一位
  function divideEqual(amount, n) {
    var base = Math.floor(amount / n);
    var rem = amount - base * n;
    var shares = [];
    for (var i = 0; i < n; i++) shares.push(base);
    shares[0] += rem;
    return { shares: shares, rem: rem };
  }

  function calculate(input) {
    var people = uniq(input.people);
    var items = input.items || [];
    var fees = input.extra_fees || [];
    var notes = [];
    var assigns = {};
    (input.assignments || []).forEach(function (a) { assigns[a.item_index] = a; });
    Object.keys(assigns).forEach(function (k) {
      uniq(assigns[k].people).forEach(function (p) {
        if (people.indexOf(p) < 0) { people.push(p); notes.push('人名「' + p + '」不在名單內,已自動加入'); }
      });
    });
    if (!people.length) throw new Error('沒有人名');

    var scale = 1;
    items.forEach(function (it) { if (hasDec(it.amount)) scale = 100; });
    fees.forEach(function (f) { if (hasDec(f.amount)) scale = 100; });
    if (hasDec(input.receipt_total)) scale = 100;
    var U = function (x) { return Math.round(num(x) * scale); };
    var A = function (u) { return u / scale; };

    var per = {};
    people.forEach(function (p) { per[p] = { name: p, items: [], subU: 0, fees: [], feeU: 0 }; });

    var itemsU = 0;
    items.forEach(function (it, idx) {
      var amt = U(it.amount);
      itemsU += amt;
      var a = assigns[idx];
      var list = a ? uniq(a.people).filter(function (p) { return per[p]; }) : [];
      var mode = a && a.mode === 'individual' && list.length === 1 ? 'individual' : 'equal';
      if (!list.length) { list = people.slice(); notes.push('「' + it.name + '」未指定歸屬,平均分給全部人'); }
      var d = divideEqual(amt, list.length);
      list.forEach(function (p, i) {
        per[p].items.push({ index: idx, name: it.name, share: A(d.shares[i]), shared_with: list.length, mode: mode });
        per[p].subU += d.shares[i];
      });
      if (d.rem !== 0 && list.length > 1) notes.push('「' + it.name + '」' + A(amt) + ' 元由 ' + list.length + ' 人均分,餘 ' + A(d.rem) + ' 元由 ' + list[0] + ' 多付');
    });

    var feesU = 0;
    fees.forEach(function (f) {
      var amt = f.amount != null && f.amount !== '' ? U(f.amount) : (f.percent != null ? Math.round(itemsU * num(f.percent) / 100) : 0);
      feesU += amt;
      var shares = [], rem = 0, i;
      var mode = f.allocate === 'equal' ? 'equal' : 'proportional';
      if (mode === 'proportional' && itemsU > 0) {
        var sum = 0;
        for (i = 0; i < people.length; i++) { var sh = Math.floor(amt * per[people[i]].subU / itemsU); shares.push(sh); sum += sh; }
        rem = amt - sum; shares[0] += rem;
      } else {
        var d = divideEqual(amt, people.length); shares = d.shares; rem = d.rem;
        mode = 'equal';
      }
      people.forEach(function (p, j) { per[p].fees.push({ name: f.name, amount: A(shares[j]) }); per[p].feeU += shares[j]; });
      if (rem !== 0) notes.push('「' + f.name + '」' + A(amt) + ' 元按' + (mode === 'equal' ? '人數均分' : '比例') + '分攤,餘 ' + A(rem) + ' 元由 ' + people[0] + ' 負擔');
    });

    var out = people.map(function (p) {
      var o = per[p];
      return { name: p, items: o.items, subtotal: A(o.subU), fees: o.fees, feeTotal: A(o.feeU), total: A(o.subU + o.feeU) };
    });
    var grandU = itemsU + feesU;
    var sumU = 0; people.forEach(function (p) { sumU += per[p].subU + per[p].feeU; });
    var res = { people: out, itemsTotal: A(itemsU), feesTotal: A(feesU), grandTotal: A(grandU), balanced: sumU === grandU, notes: notes, scale: scale };
    if (input.receipt_total != null && input.receipt_total !== '') {
      res.receiptTotal = A(U(input.receipt_total));
      res.matchesReceipt = U(input.receipt_total) === grandU;
      res.receiptDiff = A(U(input.receipt_total) - grandU);
    }
    return res;
  }

  return { calculate: calculate, divideEqual: divideEqual };
});
