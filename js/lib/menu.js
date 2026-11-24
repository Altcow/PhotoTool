/* 菜單:正規化、文字貼上解析、預設冰糖度、驗證、開團前提、多菜單排列、匯出入(純函式) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Menu = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DEFAULT_ICE = ['正常冰', '少冰', '微冰', '去冰', '常溫', '熱'];
  var DEFAULT_SUGAR = ['全糖', '少糖', '半糖', '微糖', '無糖'];
  var EXPORT_FORMAT = 'phototool-menu';

  function rid(prefix) { return prefix + Math.random().toString(36).slice(2, 8); }
  function cleanKey(s) { return String(s == null ? '' : s).replace(/[.$#\[\]\/]/g, '').trim(); }
  function str(v, n) { return String(v == null ? '' : v).trim().slice(0, n || 80); }
  // Firebase 讀回的陣列可能是以索引為鍵的物件
  function arr(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') return Object.keys(v).sort(function (a, b) { return Number(a) - Number(b) || (a < b ? -1 : 1); }).map(function (k) { return v[k]; });
    return [];
  }
  function priceNum(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(String(v).replace(/[,$元]/g, ''));
    return isFinite(n) && n >= 0 ? Math.round(n) : null;
  }
  function uniq(list) { var seen = {}; return list.filter(function (x) { if (!x || seen[x]) return false; seen[x] = 1; return true; }); }
  function strList(v, clean) { return uniq(arr(v).map(function (x) { return clean ? cleanKey(x) : str(x, 20); })); }

  function normItem(i, used) {
    i = i || {};
    var id = str(i.id, 24);
    if (!id || used[id]) { do { id = rid('i'); } while (used[id]); }
    used[id] = 1;
    var prices = {}, src = i.prices && typeof i.prices === 'object' ? i.prices : {};
    Object.keys(src).forEach(function (k) { var kk = cleanKey(k), p = priceNum(src[k]); if (kk && p !== null) prices[kk] = p; });
    var it = { id: id, name: str(i.name, 60), price: priceNum(i.price), prices: prices, note: str(i.note, 100), temp: (i.temp === 'hot' || i.temp === 'cold') ? i.temp : 'any' };
    if (i.own) it.own = true;
    return it;
  }
  // 任意來源(AI、Firebase、匯入、編輯器)→ 標準菜單。不套預設冰糖度(要的話呼叫 applyDefaults)
  function normalize(raw) {
    raw = raw || {};
    var used = {};
    var m = {
      id: str(raw.id, 24) || rid('m'), shop: str(raw.shop, 60), updatedAt: Number(raw.updatedAt) || 0,
      sizes: strList(raw.sizes, true), ice: strList(raw.ice), sugar: strList(raw.sugar),
      toppings: arr(raw.toppings).map(function (t) { t = t || {}; return { name: str(t.name, 30), price: priceNum(t.price) || 0 }; }).filter(function (t) { return t.name; }),
      notes: str(raw.notes, 300), categories: [],
    };
    m.categories = arr(raw.categories).map(function (c) {
      c = c || {};
      return { name: str(c.name, 40) || '飲品', items: arr(c.items).map(function (i) { return normItem(i, used); }).filter(function (i) { return i.name; }) };
    });
    return m;
  }
  function applyDefaults(menu) {
    var f = { ice: false, sugar: false };
    if (!menu.ice.length) { menu.ice = DEFAULT_ICE.slice(); f.ice = true; }
    if (!menu.sugar.length) { menu.sugar = DEFAULT_SUGAR.slice(); f.sugar = true; }
    return f;
  }
  function emptyMenu(shop) { var m = normalize({ shop: shop || '' }); applyDefaults(m); return m; }
  function countItems(menu) { return (menu.categories || []).reduce(function (a, c) { return a + (c.items || []).length; }, 0); }
  function clone(menu) { return JSON.parse(JSON.stringify(menu)); }

  // extract_menu 工具輸出 → 菜單
  function fromExtract(inp) {
    inp = inp || {};
    var sizes = strList(inp.size_names, true);
    var cats = arr(inp.categories).map(function (c) {
      c = c || {};
      return {
        name: c.name, items: arr(c.items).map(function (it) {
          it = it || {};
          var prices = {};
          if (it.prices && typeof it.prices === 'object') Object.keys(it.prices).forEach(function (k) { prices[k] = it.prices[k]; if (cleanKey(k) && sizes.indexOf(cleanKey(k)) < 0) sizes.push(cleanKey(k)); });
          var temps = arr(it.available_temps).join(''), temp = 'any';
          if (temps) {
            var cold = /冰|涼|冷/.test(temps), hot = /熱|溫/.test(temps);
            temp = hot && !cold ? 'hot' : (cold && !hot ? 'cold' : 'any');
          }
          return { name: it.name, price: it.price, prices: prices, note: it.note, temp: temp };
        }),
      };
    });
    var menu = normalize({ shop: inp.shop_name, sizes: sizes, ice: inp.ice_levels, sugar: inp.sugar_levels, toppings: inp.toppings, notes: inp.notes, categories: cats });
    var defaulted = applyDefaults(menu);
    return { menu: menu, defaulted: defaulted, unreadable: arr(inp.unreadable) };
  }

  /* ---- 文字貼上解析 ---- */
  var SZ = '(?:XXL|XL|XS|S|M|L|大杯|中杯|小杯|特大|超大|大|中|小|熱|冰)';
  var SIZE_RE = new RegExp('^' + SZ + '$', 'i');
  var SIZEPRICE_RE = new RegExp('^(' + SZ + ')[:：]?\\$?(\\d{1,5})(?:元|塊|圓)?$', 'i');
  var PRICE_RE = /^\$?(\d{1,5})(?:元|塊|圓)?$/;
  var HEADER_NAME_RE = /^(品名|品項|名稱|飲品|項目|name)$/i;
  function normSize(s) { return /^[a-z]+$/i.test(s) ? s.toUpperCase() : s; }

  function parseText(text) {
    var cats = [], cur = null, sizes = [], header = null, skipped = [], warnings = [];
    var addSize = function (s) { if (s && sizes.indexOf(s) < 0) sizes.push(s); };
    var addItem = function (name, found, lineNo) {
      if (!cur) { cur = { name: '飲品', items: [] }; cats.push(cur); }
      found.forEach(function (f) { if (!f.size && f.pos !== undefined && header && header[f.pos]) f.size = header[f.pos]; });
      var unsized = found.filter(function (f) { return !f.size; });
      var sized = found.filter(function (f) { return f.size; });
      if (!sized.length && unsized.length > 1) {
        unsized.forEach(function (f, k) {
          if (header && header[f.pos !== undefined ? f.pos : k]) f.size = header[f.pos !== undefined ? f.pos : k];
          else f.size = '尺寸' + (k + 1);
        });
        if (!header) warnings.push('第 ' + lineNo + ' 行「' + name + '」有多個價格但沒有尺寸名稱,暫稱「尺寸1、尺寸2…」,請在編輯器改名');
        sized = unsized; unsized = [];
      }
      var it = { name: name, price: unsized.length ? unsized[unsized.length - 1].price : null, prices: {}, note: '', temp: 'any' };
      sized.forEach(function (f) { it.prices[f.size] = f.price; addSize(f.size); });
      cur.items.push(it);
    };
    var cleanCat = function (s) { return s.replace(/^[【\[\(（「#=\-—*★☆■□●\s]+|[】\]\)）」=\-—*★☆:：\s]+$/g, '').trim(); };
    var lines = String(text || '').replace(/\r/g, '').split('\n');
    lines.forEach(function (raw, li) {
      raw = raw.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/[＄￥]/g, '$');
      var no = li + 1;
      if (!raw.trim()) return;
      var name, found = [];
      if (raw.indexOf('\t') >= 0) {
        var cells = raw.split('\t').map(function (c) { return c.trim(); });
        name = cells[0].replace(/^[-•*・●○◆◇▪]+\s*/, '');
        var rest = cells.slice(1);
        if (rest.some(Boolean) && rest.every(function (c) { return !/\d/.test(c); })) {
          header = rest.map(function (c) { return normSize(cleanKey(c)); });
          header.forEach(addSize);
          return;
        }
        rest.forEach(function (c, idx) {
          if (!c) return;
          var m = c.match(SIZEPRICE_RE), p;
          if (m) found.push({ size: normSize(m[1]), price: Number(m[2]), pos: idx });
          else if ((p = c.match(PRICE_RE))) found.push({ size: null, price: Number(p[1]), pos: idx });
        });
        if (!name) { skipped.push(raw.trim()); return; }
      } else {
        var line = raw.trim().replace(/^[-•*・●○◆◇▪]+\s*/, '').replace(/^\d{1,2}[.、)]\s+/, '');
        var tokens = line.replace(/[\/／|｜,，、;；]+/g, ' ').split(/\s+/).filter(Boolean);
        if (!tokens.length) return;
        if (tokens.length >= 2 && tokens.slice(1).every(function (t) { return SIZE_RE.test(t); })) {
          header = tokens.slice(1).map(normSize); header.forEach(addSize); return;
        }
        var i = tokens.length - 1;
        while (i >= 1) {
          var t = tokens[i], m = t.match(SIZEPRICE_RE);
          if (m) { found.unshift({ size: normSize(m[1]), price: Number(m[2]) }); i--; continue; }
          m = t.match(PRICE_RE);
          if (m) {
            if (i >= 2 && SIZE_RE.test(tokens[i - 1])) { found.unshift({ size: normSize(tokens[i - 1]), price: Number(m[1]) }); i -= 2; continue; }
            found.unshift({ size: null, price: Number(m[1]) }); i--; continue;
          }
          break;
        }
        name = tokens.slice(0, i + 1).join(' ').replace(/[.…·:：\-—]+$/, '').trim();
        if (!found.length && tokens.length === 1) {
          var fm = tokens[0].match(/^(.+?)[.…·:：]*\$?(\d{2,5})(?:元)?$/);
          if (fm && !/^\d+$/.test(fm[1])) { name = fm[1]; found.push({ size: null, price: Number(fm[2]) }); }
        }
      }
      if (!found.length) {
        var c = cleanCat(name);
        if (c && c.length <= 24) { cur = { name: c, items: [] }; cats.push(cur); } else skipped.push(raw.trim());
        return;
      }
      if (!name) { skipped.push(raw.trim()); return; }
      addItem(name, found, no);
    });
    cats = cats.filter(function (c) { return c.items.length; });
    return { categories: cats, sizes: sizes, skipped: skipped, warnings: warnings };
  }
  function fromParsed(parsed, shop) {
    var m = normalize({ shop: shop, sizes: parsed.sizes, categories: parsed.categories });
    applyDefaults(m);
    return m;
  }

  /* ---- 驗證與選項 ---- */
  function validate(menu) {
    var errs = [];
    if (!String(menu.shop || '').trim()) errs.push('請填店名');
    if (countItems(menu) === 0) errs.push('菜單沒有任何品項');
    (menu.categories || []).forEach(function (c) {
      c.items.forEach(function (i) {
        // 價格可以空白(菜單沒標價):不擋儲存與開團,顯示「價格待補」
      });
    });
    return errs;
  }
  function sizeChoices(menu, item) {
    var keys = Object.keys(item.prices || {});
    var order = (menu.sizes || []).filter(function (s) { return keys.indexOf(s) >= 0; });
    keys.forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });
    return order;
  }
  function isHotOpt(s) { return /熱/.test(s) || (/溫/.test(s) && !/常溫/.test(s)); }
  function iceChoices(menu, item) {
    var ice = menu.ice || [];
    if (item.temp === 'hot') { var h = ice.filter(isHotOpt); return h.length ? h : ['熱']; }
    if (item.temp === 'cold') { var c = ice.filter(function (s) { return !isHotOpt(s); }); return c.length ? c : ice; }
    return ice;
  }

  /* ---- 開團前提 ---- */
  // 順序:菜單庫空 → 未選 → 零品項 → 未設資料庫
  function canOpenRoom(library, selectedIds, hasDb) {
    library = library || []; selectedIds = selectedIds || [];
    if (!library.length) return { ok: false, code: 'EMPTY_LIBRARY', reason: '找不到菜單,請先拍照建立菜單範本' };
    var sel = library.filter(function (m) { return selectedIds.indexOf(m.id) >= 0; });
    if (!sel.length) return { ok: false, code: 'NONE_SELECTED', reason: '請至少選一份菜單' };
    var zero = sel.filter(function (m) { return countItems(m) === 0; });
    if (zero.length) return { ok: false, code: 'ZERO_ITEMS', reason: '「' + (zero[0].shop || '未命名') + '」沒有任何品項,請先編輯或換一份菜單' };
    if (!hasDb) return { ok: false, code: 'NO_DB', reason: '需設定資料庫網址才能開團(設定頁)' };
    return { ok: true, code: 'OK', reason: '' };
  }

  // 多份菜單的排列:separate = 每份一個區段;merged = 依分類名稱合併成一個清單(品項帶 menuId/shop,同名不合併)
  function sections(menus, mode) {
    var tag = function (m, it) { var c = clone(it); c.menuId = m.id; c.shop = m.shop; return c; };
    if (mode !== 'merged' || menus.length < 2) {
      return menus.map(function (m) {
        return { key: m.id, title: m.shop, menuId: m.id, categories: m.categories.map(function (c) { return { name: c.name, items: c.items.map(function (it) { return tag(m, it); }) }; }) };
      });
    }
    var cats = [], idx = {};
    menus.forEach(function (m) {
      m.categories.forEach(function (c) {
        if (!(c.name in idx)) { idx[c.name] = cats.length; cats.push({ name: c.name, items: [] }); }
        c.items.forEach(function (it) { cats[idx[c.name]].items.push(tag(m, it)); });
      });
    });
    return [{ key: 'merged', title: '全部', menuId: null, categories: cats }];
  }

  /* ---- 範本匯出入(.menu.json) ---- */
  function toExport(menus) { return JSON.stringify({ format: EXPORT_FORMAT, version: 1, menus: menus.map(clone) }); }
  // 匯入一律給新 id(避免覆蓋既有範本);回傳 { menus, error }
  function fromImport(text) {
    var j;
    try { j = JSON.parse(text); } catch (e) { return { menus: [], error: '不是有效的 JSON' }; }
    if (!j || j.format !== EXPORT_FORMAT || !Array.isArray(j.menus)) return { menus: [], error: '格式不符(不是菜單檔)' };
    var out = j.menus.map(function (m) { var n = normalize(Object.assign({}, m, { id: '' })); return n; }).filter(function (m) { return countItems(m) > 0; });
    if (!out.length) return { menus: [], error: '檔案裡沒有可用的菜單' };
    return { menus: out, error: '' };
  }

  return {
    DEFAULT_ICE: DEFAULT_ICE, DEFAULT_SUGAR: DEFAULT_SUGAR, rid: rid, normalize: normalize, applyDefaults: applyDefaults, emptyMenu: emptyMenu,
    countItems: countItems, clone: clone, fromExtract: fromExtract, parseText: parseText, fromParsed: fromParsed, validate: validate,
    sizeChoices: sizeChoices, iceChoices: iceChoices, canOpenRoom: canOpenRoom, sections: sections, toExport: toExport, fromImport: fromImport,
    arr: arr, priceNum: priceNum,
  };
});
