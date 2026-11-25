/* 點餐的金額與彙整(純函式,整數運算)。menus 為菜單陣列(單店也是長度 1) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Order = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去除易混字元 0 O 1 I l
  var GROUP_ORDER = ['冰', '常溫', '溫', '熱', '其他'];

  function roomCode(rand) {
    rand = rand || Math.random;
    var s = '';
    for (var i = 0; i < 6; i++) s += CODE_CHARS.charAt(Math.floor(rand() * CODE_CHARS.length));
    return s;
  }
  function isRoomCode(c) { return /^[A-HJ-NP-Z2-9]{6}$/.test(String(c || '')); }

  function toInt(n) { n = Number(n); return isFinite(n) ? Math.round(n) : 0; }
  function has(v) { return v !== null && v !== undefined && v !== ''; }
  function cups(o) { return Math.max(1, toInt(o && o.qty)); }
  // 價格可以空白(菜單沒標價):沒價格的杯子金額待補,之後依店家總額分攤
  function hasPrice(o) { return o && o.unitPrice !== null && o.unitPrice !== undefined && o.unitPrice !== '' && isFinite(Number(o.unitPrice)); }
  function lineTotal(o) { return hasPrice(o) ? toInt(o.unitPrice) * cups(o) : 0; }

  function findMenu(menus, menuId) {
    menus = menus || [];
    for (var i = 0; i < menus.length; i++) if (menus[i].id === menuId) return menus[i];
    return menuId ? null : (menus[0] || null);
  }
  function findItem(menu, itemId) {
    if (!menu) return null;
    var cs = menu.categories || [];
    for (var i = 0; i < cs.length; i++) {
      var its = cs[i].items || [];
      for (var j = 0; j < its.length; j++) if (its[j].id === itemId) return its[j];
    }
    return null;
  }
  // 尺寸價優先,沒有就用通用價;選了不存在的尺寸且無通用價 → null
  function basePrice(item, size) {
    if (!item) return null;
    var p = item.prices || {};
    if (has(size) && has(p[size])) return toInt(p[size]);
    if (has(item.price)) return toInt(item.price);
    return null;
  }
  // 單杯價 = 尺寸價 + 加料;任何一項找不到 → null
  function unitPrice(menu, itemId, size, toppingNames) {
    var base = basePrice(findItem(menu, itemId), size);
    if (base === null) return null;
    var sum = base, tops = (menu && menu.toppings) || [];
    var names = toppingNames || [];
    for (var i = 0; i < names.length; i++) {
      var t = null;
      for (var k = 0; k < tops.length; k++) if (tops[k].name === names[i]) { t = tops[k]; break; }
      if (!t) return null;
      sum += toInt(t.price);
    }
    return sum;
  }

  function sortedOrders(orders) {
    return (orders || []).map(function (o, i) { return { o: o, i: i }; })
      .sort(function (a, b) { return (toInt(a.o.ts) - toInt(b.o.ts)) || String(a.o.id || '').localeCompare(String(b.o.id || '')) || (a.i - b.i); })
      .map(function (x) { return x.o; });
  }
  // 依帳號 uid(舊版開團房用 clientId)+名字分組;同名不同人自動區分「小唐」「小唐(2)」
  function people(orders) {
    var map = {}, list = [];
    sortedOrders(orders).forEach(function (o) {
      var key = (o.uid || o.clientId || '') + '\u0001' + (o.name || '');
      var p = map[key];
      if (!p) { p = map[key] = { key: key, uid: o.uid || '', clientId: o.clientId || '', name: o.name || '(未命名)', display: '', orders: [], cups: 0, total: 0 }; list.push(p); }
      p.orders.push(o); p.cups += cups(o); p.total += lineTotal(o); if (!hasPrice(o)) p.unpricedCups = (p.unpricedCups || 0) + cups(o);
    });
    var seen = {};
    list.forEach(function (p) {
      var n = (seen[p.name] = (seen[p.name] || 0) + 1);
      p.display = n === 1 ? p.name : p.name + '(' + n + ')';
    });
    return list;
  }
  function cupCount(orders) { return (orders || []).reduce(function (a, o) { return a + cups(o); }, 0); }
  function grandTotal(orders) { return (orders || []).reduce(function (a, o) { return a + lineTotal(o); }, 0); }

  function optionLabel(o) {
    var parts = [o.itemName, o.size, o.ice, o.sugar].filter(has);
    var tops = Array.isArray(o.toppings) ? o.toppings : [];
    if (tops.length) parts.push('+' + tops.join('+'));
    return parts.join(' ');
  }
  function shopTag(shop) { return String(shop || '').slice(0, 4); }

  function groupByMenu(orders, menus) {
    var out = [], idx = {};
    (menus || []).forEach(function (m) { idx[m.id] = out.length; out.push({ menuId: m.id, shop: m.shop || '', orders: [] }); });
    sortedOrders(orders).forEach(function (o) {
      var i = idx[o.menuId];
      if (i === undefined) {
        if (!o.menuId && out.length === 1) i = 0;
        else { idx[o.menuId] = out.length; i = out.length; out.push({ menuId: o.menuId || '', shop: '(已移除的菜單)', orders: [] }); }
      }
      out[i].orders.push(o);
    });
    return out;
  }

  // 模式 1:顧客清單。多份菜單時品項前標店名簡稱
  function customerText(title, dateStr, orders, menus) {
    var multi = (menus || []).length > 1;
    var shopOf = function (o) { var m = findMenu(menus, o.menuId); return m ? m.shop : ''; };
    var lines = ['【' + title + ' ' + dateStr + ' 團購】'];
    var ps = people(orders);
    if (!ps.length) lines.push('(目前沒有訂單)');
    ps.forEach(function (p) {
      lines.push(p.display + '(' + p.cups + '杯 ' + (p.unpricedCups ? '金額待補' : '共' + p.total + '元') + ')');
      p.orders.forEach(function (o, i) {
        lines.push(' ' + (i + 1) + '. ' + (multi ? '[' + shopTag(shopOf(o)) + '] ' : '') + optionLabel(o) + ' ×' + cups(o) + (hasPrice(o) ? ' $' + lineTotal(o) : ' 價格待補') + (o.note ? '(' + o.note + ')' : ''));
      });
    });
    lines.push('──────');
    var unp = (orders || []).filter(function (o) { return !hasPrice(o); }).length;
    lines.push('共 ' + cupCount(orders) + ' 杯,合計 $' + grandTotal(orders) + (unp ? '(另有價格待補的杯數)' : ''));
    return lines.join('\n');
  }

  // 冷熱分類:group 供分組,rank 供「冷熱」排序(熱→溫→常溫→去冰→…→正常冰)
  function tempOf(ice) {
    var s = String(ice || '');
    if (/熱/.test(s)) return { group: '熱', rank: 0 };
    if (/常溫/.test(s)) return { group: '常溫', rank: 2 };
    if (/溫/.test(s)) return { group: '溫', rank: 1 };
    if (/去冰|無冰/.test(s)) return { group: '冰', rank: 3 };
    if (/微冰/.test(s)) return { group: '冰', rank: 4 };
    if (/少冰/.test(s)) return { group: '冰', rank: 5 };
    if (/半冰/.test(s)) return { group: '冰', rank: 6 };
    if (/冰/.test(s)) return { group: '冰', rank: 7 };
    return { group: '其他', rank: 8 };
  }
  function mergeKey(o) {
    var tops = (Array.isArray(o.toppings) ? o.toppings : []).slice().sort();
    return [o.itemName || '', o.size || '', o.ice || '', o.sugar || '', tops.join('+')].join('\u0001');
  }
  var zh = function (a, b) { return String(a).localeCompare(String(b), 'zh-Hant'); };

  // 模式 2:店員清單。sort = 'name' | 'temp' | 'count'
  function clerkList(orders, sort) {
    var ps = people(orders);
    var map = {}, rows = [];
    ps.forEach(function (p) {
      p.orders.forEach(function (o) {
        var k = mergeKey(o), r = map[k];
        if (!r) {
          var t = tempOf(o.ice);
          r = map[k] = { key: k, itemName: o.itemName || '', size: o.size || '', ice: o.ice || '', sugar: o.sugar || '', toppings: (Array.isArray(o.toppings) ? o.toppings : []).slice().sort(), count: 0, group: t.group, rank: t.rank, who: [] };
          rows.push(r);
        }
        r.count += cups(o);
        var w = null;
        for (var i = 0; i < r.who.length; i++) if (r.who[i].key === p.key) w = r.who[i];
        if (!w) { w = { key: p.key, display: p.display, count: 0 }; r.who.push(w); }
        w.count += cups(o);
      });
    });
    rows.forEach(function (r) { r.label = optionLabel(r); });
    var cmpName = function (a, b) { return zh(a.itemName, b.itemName) || zh(a.label, b.label); };
    rows.sort(function (a, b) {
      if (sort === 'temp') return (a.rank - b.rank) || cmpName(a, b);
      if (sort === 'count') return (b.count - a.count) || cmpName(a, b);
      return cmpName(a, b);
    });
    return rows;
  }
  function clerkGroups(rows) {
    return GROUP_ORDER.map(function (g) {
      var rs = rows.filter(function (r) { return r.group === g; });
      return { group: g, count: rs.reduce(function (a, r) { return a + r.count; }, 0), rows: rs };
    }).filter(function (g) { return g.rows.length; });
  }
  // 店員文字:不含訂購人
  function clerkText(shop, orders, sort, byGroup) {
    var rows = clerkList(orders, sort);
    var lines = ['【' + shop + '】共 ' + cupCount(orders) + ' 杯'];
    if (byGroup === false) rows.forEach(function (r) { lines.push(' ' + r.label + ' ×' + r.count); });
    else clerkGroups(rows).forEach(function (g) {
      lines.push(g.group + ':');
      g.rows.forEach(function (r) { lines.push(' ' + r.label + ' ×' + r.count); });
    });
    return lines.join('\n');
  }
  // 多份菜單:一律按店分開,每家各自一份
  function clerkTexts(menus, orders, sort, byGroup) {
    return groupByMenu(orders, menus).filter(function (g) { return g.orders.length || (menus || []).length === 1; })
      .map(function (g) { return { menuId: g.menuId, shop: g.shop, orders: g.orders, count: cupCount(g.orders), text: clerkText(g.shop, g.orders, sort, byGroup) }; });
  }


  /* ---- 事後輸入店家報的總金額,分攤給每個人 ----
     有價格的杯照價;沒價格的杯子均分剩餘金額;全部沒價格 → 依杯數;全部有價格但總額不同 → 差額依各人品項金額比例分。
     餘數規則:每杯 1 元,依名單順序(最早點餐的人先)分給前面的杯子。杯數分攤不套用小孩權重(權重只用在旅遊團平均分)。 */
  function apportion(orders, total, opts) {
    opts = opts || {};
    var fee = toInt(opts.fee || 0), grand = toInt(total) + fee, ps = people(orders), cupsList = [];
    ps.forEach(function (p, pi) { p.orders.forEach(function (o) { for (var k = 0; k < cups(o); k++) cupsList.push({ pi: pi, priced: hasPrice(o), price: hasPrice(o) ? toInt(o.unitPrice) : 0, amt: 0 }); }); });
    var N = cupsList.length;
    if (!N) return { ok: false, code: 'NO_CUPS', error: '還沒有任何杯數' };
    if (grand <= 0) return { ok: false, code: 'BAD_TOTAL', error: '請輸入大於 0 的總金額' };
    var priced = cupsList.filter(function (c) { return c.priced; }), unpriced = cupsList.filter(function (c) { return !c.priced; });
    var P = priced.reduce(function (a, c) { return a + c.price; }, 0), mode, label, notes = [];
    var spread = function (list, amount) { var base = Math.floor(amount / list.length), rem = amount - base * list.length; list.forEach(function (c, i) { c.amt += base + (i < rem ? 1 : 0); }); return rem; };
    var rem = 0;
    if (unpriced.length === N) {
      mode = 'by-cups'; label = '依杯數分攤'; rem = spread(cupsList, grand);
    } else if (unpriced.length) {
      var remaining = grand - P;
      if (remaining < 0) return { ok: false, code: 'NEGATIVE_REMAINDER', error: '有價格的品項已經 $' + P + ',超過總金額 $' + grand, diff: remaining };
      mode = 'mixed'; label = '品項價格 + 剩餘依杯數均分';
      priced.forEach(function (c) { c.amt = c.price; });
      rem = spread(unpriced, remaining);
    } else {
      mode = 'by-price'; label = '依品項價格';
      priced.forEach(function (c) { c.amt = c.price; });
      var diff = grand - P;
      if (diff !== 0) {
        var sign = diff < 0 ? -1 : 1, ad = Math.abs(diff), used = 0;
        priced.forEach(function (c) { var x = P > 0 ? Math.floor(ad * c.price / P) : Math.floor(ad / N); c.extra = x; used += x; });
        rem = ad - used;
        priced.forEach(function (c, i) { c.amt += sign * (c.extra + (i < rem ? 1 : 0)); });
        notes.push('店家總額與品項價格合計差 ' + (diff > 0 ? '+' : '') + diff + ' 元,已依各人品項金額比例分攤');
      }
    }
    var per = ps.map(function (p, i) { return { key: p.key, display: p.display, cups: p.cups, amount: cupsList.filter(function (c) { return c.pi === i; }).reduce(function (a, c) { return a + c.amt; }, 0) }; });
    var sum = per.reduce(function (a, p) { return a + p.amount; }, 0);
    if (rem) notes.push('餘數 ' + rem + ' 元,依名單順序分給前面的人');
    if (fee) notes.push('含運費/服務費 $' + fee + '(併入總額一起分攤)');
    notes.push('杯數分攤不套用小孩計費權重');
    return { ok: sum === grand, mode: mode, label: label, total: grand, shopTotal: toInt(total), fee: fee, perPerson: per, sum: sum, notes: notes, cups: N, pricedCups: priced.length, unpricedCups: unpriced.length };
  }
  // 顧客清單(含分攤):每人一行「N 杯 $金額」,標示依杯數分攤或依品項價格
  function allocText(title, dateStr, orders, menus, alloc) {
    var lines = ['【' + title + ' ' + dateStr + ' 團購結算】', '(' + alloc.label + ',店家總額 $' + alloc.shopTotal + (alloc.fee ? ' + 運費/服務費 $' + alloc.fee : '') + ')'];
    alloc.perPerson.forEach(function (p) { lines.push(p.display + ':' + p.cups + ' 杯 $' + p.amount); });
    lines.push('──────'); lines.push('共 ' + alloc.cups + ' 杯,合計 $' + alloc.sum);
    alloc.notes.forEach(function (n) { lines.push('※ ' + n); });
    return lines.join('\n');
  }

  // 下單內容檢查(客戶端用)
  function validateOrder(o) {
    var errs = [];
    if (!String(o.name || '').trim()) errs.push('請輸入名字');
    if (!o.itemId || !o.itemName) errs.push('缺少品項');
    if (!(toInt(o.qty) >= 1 && toInt(o.qty) <= 20)) errs.push('杯數需為 1~20');
    return errs;
  }

  return {
    roomCode: roomCode, isRoomCode: isRoomCode, toInt: toInt, cups: cups, lineTotal: lineTotal,
    findMenu: findMenu, findItem: findItem, basePrice: basePrice, unitPrice: unitPrice,
    hasPrice: hasPrice, apportion: apportion, allocText: allocText, people: people, cupCount: cupCount, grandTotal: grandTotal, optionLabel: optionLabel, shopTag: shopTag,
    groupByMenu: groupByMenu, customerText: customerText, tempOf: tempOf, clerkList: clerkList, clerkGroups: clerkGroups,
    clerkText: clerkText, clerkTexts: clerkTexts, validateOrder: validateOrder, GROUP_ORDER: GROUP_ORDER,
  };
});
