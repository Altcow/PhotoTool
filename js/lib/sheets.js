/* 報表規格 spec 產生器(純函式):結算、顧客清單、店員清單、我的旅行統計、檔案表格。
   spec 同時供 圖片(render.js)、PDF(pdf.js)、Excel(xlsx.js)、文字 使用。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./settle.js'), require('./order.js'));
  else root.Sheets = factory(root.Settle, root.Order);
})(typeof self !== 'undefined' ? self : this, function (Settle, Order) {
  function money(n) { return '$' + n; }
  function netText(net) { return net > 0 ? '可收 ' + money(net) : net < 0 ? '要付 ' + money(-net) : '打平'; }
  function tone(net) { return net > 0 ? 'recv' : net < 0 ? 'pay' : 'even'; }

  // 結算結果。res = Settle.settleTrip(...) 的結果
  function settle(trip, res, dateStr, mode) {
    var transfers = mode === 'detail' ? Settle.detailTransfers(res) : res.transfers;
    var unit = res.groupBy === 'family' ? '每個家庭' : '每個人';
    var sub = dateStr + ' · 已選 ' + res.selectedCount + ' 筆 · 總花費 ' + money(res.totalSpent) + (res.pendingCount ? ' · 尚有 ' + res.pendingCount + ' 筆待填,未納入' : '');
    var recDate = {}; (trip.records || []).forEach(function (r) { recDate[r.id] = r.date || ''; });
    var stmts = res.rows.map(function (r) { return Settle.statement(res, r.name, mode); });

    var sheetSummary = { name: '總表', columns: ['名稱', '已付', '應分攤', '淨額', '狀況'], rows: res.rows.map(function (r) { return [r.name, r.paid, r.share, r.net, netText(r.net)]; }) };
    var sheetXfer = { name: '轉帳清單', columns: ['付款人', '收款人', '金額', '記錄'], rows: transfers.map(function (x) { return [x.from, x.to, x.amount, x.title || '']; }) };
    var stmtRows = [];
    stmts.forEach(function (st, i) {
      var nm = res.rows[i].name;
      st.plus.forEach(function (p) { stmtRows.push([nm, '加項(已付出)', p.title, p.paid, '別人應分攤給他 ' + p.othersOwe]); });
      st.minus.forEach(function (m) { stmtRows.push([nm, '減項(應付)', m.title, m.share, '付給 ' + m.to]); });
      st.pay.forEach(function (x) { stmtRows.push([nm, '總計:還要付', '', x.amount, '給 ' + x.name]); });
      st.receive.forEach(function (x) { stmtRows.push([nm, '總計:可收回', '', x.amount, '來自 ' + x.name]); });
      if (!st.pay.length && !st.receive.length) stmtRows.push([nm, '總計', '', 0, '已打平,無須轉帳']);
    });
    var sheetStmt = { name: '各人對帳單', columns: ['名稱', '類別', '記錄', '金額', '對象/說明'], rows: stmtRows };
    var sheetRec = { name: '全部記錄明細', columns: ['日期', '記錄', '付款人', '總額'].concat(res.rows.map(function (r) { return r.name + ' 分攤'; })).concat(['狀態']),
      rows: res.records.map(function (r) { return [recDate[r.id] || '', r.title, r.payer, r.amount].concat(res.rows.map(function (x) { return r.shares[x.name] || 0; })).concat([r.ok ? '已納入' : '未納入']); }) };

    return {
      title: (trip.name || '分帳') + ' 結算', subtitle: sub, filename: (trip.name || '分帳') + ' 結算',
      sections: [
        { kind: 'totals', heading: unit + ' 要付 / 可收', items: res.rows.map(function (r) { return { name: r.name, value: netText(r.net), tone: tone(r.net) }; }) },
        { kind: 'list', heading: '誰付給誰', empty: '無須轉帳', rows: transfers.map(function (x) { return { left: x.from + ' → ' + x.to, right: money(x.amount), sub: x.title || '' }; }) },
        { kind: 'table', heading: '總花費 ' + money(res.totalSpent) + ' · 已付與應分攤', pageBreakBefore: true, columns: ['名稱', '已付', '應分攤', '淨額'], num: [1, 2, 3],
          rows: res.rows.map(function (r) { return [r.name, String(r.paid), String(r.share), (r.net > 0 ? '+' : '') + r.net]; }) },
        { kind: 'table', heading: '各筆記錄', columns: ['日期', '記錄', '付款人', '總額'], num: [3],
          rows: res.records.map(function (r) { return [recDate[r.id] || '', r.title, r.payer, String(r.amount)]; }) },
      ],
      text: Settle.reportText(trip, res, dateStr, mode, '__summary'),
      sheets: [sheetSummary, sheetXfer, sheetStmt, sheetRec],
    };
  }

  // 顧客清單(點餐)
  function customer(title, dateStr, orders, menus, alloc) {
    var multi = (menus || []).length > 1, ps = Order.people(orders);
    var shopOf = function (o) { var m = Order.findMenu(menus, o.menuId); return m ? m.shop : ''; };
    var rows = [];
    ps.forEach(function (p) { p.orders.forEach(function (o) { rows.push([p.display, (multi ? '[' + Order.shopTag(shopOf(o)) + '] ' : '') + Order.optionLabel(o) + (o.note ? '(' + o.note + ')' : ''), Order.cups(o), Order.hasPrice(o) ? Order.lineTotal(o) : '價格待補']); }); });
    var hasAlloc = alloc && alloc.ok;
    var amountRows = hasAlloc ? alloc.perPerson.map(function (p) { return [p.display, p.cups, p.amount]; }) : null;
    return {
      title: title + (hasAlloc ? ' 團購結算' : ' 顧客清單'), subtitle: hasAlloc ? dateStr + ' · ' + alloc.label + ' · 總額 ' + money(alloc.total) : dateStr + ' · 共 ' + Order.cupCount(orders) + ' 杯 · 合計 ' + money(Order.grandTotal(orders)), filename: title + (hasAlloc ? ' 團購結算' : ' 顧客清單'),
      sections: [
        { kind: 'list', heading: hasAlloc ? '每個人要付(' + alloc.label + ')' : '每個人', empty: '還沒有人點餐', rows: hasAlloc ? alloc.perPerson.map(function (p) { return { left: p.display, right: money(p.amount), sub: p.cups + ' 杯' }; }) : ps.map(function (p) { return { left: p.display, right: p.unpricedCups ? '金額待補' : money(p.total), sub: p.cups + ' 杯' }; }) },
        { kind: 'table', heading: '明細', pageBreakBefore: true, columns: ['姓名', '品項', '杯數', '金額'], num: [2, 3], rows: rows.map(function (r) { return [r[0], r[1], String(r[2]), String(r[3])]; }) },
      ],
      text: hasAlloc ? Order.allocText(title, dateStr, orders, menus, alloc) : Order.customerText(title, dateStr, orders, menus),
      sheets: [{ name: '顧客清單', columns: ['姓名', '品項', '杯數', '金額'], rows: rows }].concat(hasAlloc ? [{ name: '結算(' + alloc.label + ')', columns: ['姓名', '杯數', '應付'], rows: amountRows }] : []),
    };
  }
  // 店員清單:一律按店分開(不含訂購人)
  function clerk(menus, orders, sort, byGroup, title) {
    var parts = Order.clerkTexts(menus, orders, sort, byGroup), sections = [], sheets = [], texts = [];
    parts.forEach(function (pt) {
      var rows = Order.clerkList(pt.orders, sort);
      sections.push({ kind: 'list', heading: pt.shop + ' 共 ' + pt.count + ' 杯', empty: '沒有訂單', rows: rows.map(function (r) { return { left: r.label, right: r.count + ' 杯', sub: byGroup === false ? '' : r.group }; }) });
      sheets.push({ name: pt.shop || '店員清單', columns: ['品項', '杯數', '冷熱'], rows: rows.map(function (r) { return [r.label, r.count, r.group]; }) });
      texts.push(pt.text);
    });
    if (!sections.length) sections.push({ kind: 'list', heading: '店員清單', empty: '還沒有訂單', rows: [] });
    return { title: (title || '點餐') + ' 店員清單', subtitle: '共 ' + Order.cupCount(orders) + ' 杯', filename: (title || '點餐') + ' 店員清單', sections: sections, text: texts.join('\n\n'), sheets: sheets.length ? sheets : [{ name: '店員清單', columns: ['品項', '杯數', '冷熱'], rows: [] }] };
  }

  // 我的旅行統計。statsList 來自 Stats.allStats,ov 來自 Stats.overview
  function stats(ov, statsList, label, meLabel) {
    var rng = function (s) { return s.range ? (s.range.min === s.range.max ? s.range.min : s.range.min + ' ~ ' + s.range.max) : '—'; };
    var table = { columns: ['旅遊團', '期間', '全團總花費', '我家應分攤', '我實際付出', '我家淨額'], num: [2, 3, 4, 5],
      rows: statsList.map(function (s) { return [s.name, rng(s), String(s.totalSpent), String(s.familyShare), String(s.myPaid), (s.familyNet > 0 ? '+' : '') + s.familyNet]; }) };
    var sheets = [{ name: '總覽', columns: table.columns, rows: statsList.map(function (s) { return [s.name, rng(s), s.totalSpent, s.familyShare, s.myPaid, s.familyNet]; }).concat([['合計', '', ov.totalSpent, ov.familyShare, ov.myPaid, ov.familyNet]]) }];
    statsList.forEach(function (s) { sheets.push({ name: s.name, columns: ['日期', '全團花費', '我家應分攤', '我先付'], rows: s.byDate.map(function (d) { return [d.date, d.total, d.familyShare, d.myPaid]; }) }); });
    var lines = ['【我的旅行 ' + label + '】' + (meLabel ? '(' + meLabel + ')' : ''), '全團總花費 $' + ov.totalSpent + ' / 我家應分攤 $' + ov.familyShare + ' / 我實際付出 $' + ov.myPaid + ' / 我家淨額 ' + (ov.familyNet > 0 ? '+' : '') + ov.familyNet];
    statsList.forEach(function (s) { lines.push(' ' + s.name + '(' + rng(s) + '):全團 $' + s.totalSpent + ',我家 $' + s.familyShare + ',我付 $' + s.myPaid + ',淨額 ' + (s.familyNet > 0 ? '+' : '') + s.familyNet); });
    if (ov.pending) lines.push('(尚有 ' + ov.pending + ' 筆待填,未納入)');
    return {
      title: '我的旅行統計', subtitle: label + ' · ' + ov.trips + ' 個團' + (ov.pending ? ' · 尚有 ' + ov.pending + ' 筆待填,未納入' : ''), filename: '我的旅行統計 ' + label,
      sections: [
        { kind: 'totals', heading: '總覽', items: [{ name: '全團總花費', value: money(ov.totalSpent), tone: 'even' }, { name: '我家應分攤', value: money(ov.familyShare), tone: 'even' }, { name: '我實際付出', value: money(ov.myPaid), tone: 'even' }, { name: '我家淨額', value: (ov.familyNet > 0 ? '+' : '') + ov.familyNet, tone: tone(ov.familyNet) }] },
        { kind: 'table', heading: '每個旅遊團', columns: table.columns, num: table.num, rows: table.rows },
      ],
      text: lines.join('\n'), sheets: sheets,
    };
  }

  // 檔案紀錄的表格(sheets: [{name, columns, rows}])
  function table(title, sheets) {
    return { title: title, subtitle: '', filename: title, sections: sheets.map(function (s) { return { kind: 'table', heading: s.name, columns: s.columns || [], rows: (s.rows || []).map(function (r) { return r.map(function (v) { return v == null ? '' : String(v); }); }) }; }),
      text: sheets.map(function (s) { return [s.name].concat([(s.columns || []).join('\t')]).concat((s.rows || []).map(function (r) { return r.join('\t'); })).join('\n'); }).join('\n\n'),
      sheets: sheets.map(function (s) { return { name: s.name, columns: s.columns || [], rows: s.rows || [] }; }) };
  }
  // 匯出預覽離開前:還沒下載/分享過就要二次確認
  function leaveNeedsConfirm(state) { return !(state && state.delivered); }
  return { leaveNeedsConfirm: leaveNeedsConfirm, settle: settle, customer: customer, clerk: clerk, stats: stats, table: table };
});
