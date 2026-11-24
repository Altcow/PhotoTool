/* 規則式解析「即時文字」掃出來的收據/發票文字(不使用 AI):店名、日期、總額候選、統編/發票號碼、品項、所有數字。
   全部是猜測,畫面上都要標「請確認」。純函式。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Receipt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function validYMD(y, m, d) { if (m < 1 || m > 12 || d < 1 || d > 31) return false; var dt = new Date(y, m - 1, d); return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d; }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function lines(text) { return String(text == null ? '' : text).normalize('NFKC').replace(/\r/g, '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean); }

  /* ---- 日期 ---- */
  // 2026/11/23、2026-11-23、民國 115/11/23、115年11月23日、11月23日(用今年)
  function findDate(text, todayStr) {
    var t = String(text == null ? '' : text).normalize('NFKC');
    var thisYear = Number((todayStr || '').slice(0, 4)) || new Date().getFullYear();
    var m, y, mo, d;
    var re = /(?:民國\s*)?(\d{2,4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})(?!\d)(?!\s*月)\s*日?/g;
    while ((m = re.exec(t))) {
      y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]);
      var roc = /民國/.test(m[0]) || (y >= 80 && y <= 200 && String(m[1]).length <= 3);
      if (roc) y += 1911;
      if (y >= 1990 && y <= 2100 && validYMD(y, mo, d)) return { date: ymd(y, mo, d), raw: m[0].trim(), roc: roc };
    }
    re = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日號号]/g;
    while ((m = re.exec(t))) { mo = Number(m[1]); d = Number(m[2]); if (validYMD(thisYear, mo, d)) return { date: ymd(thisYear, mo, d), raw: m[0].trim(), roc: false }; }
    return null;
  }

  /* ---- 統編 / 發票號碼 ---- */
  function findTaxId(text) { var m = String(text).normalize('NFKC').match(/(?:統一?編號|統編|買方|賣方)\s*[:：]?\s*(\d{8})(?!\d)/); return m ? m[1] : ''; }
  function findInvoiceNo(text) { var m = String(text).normalize('NFKC').match(/(?:^|[^A-Za-z])([A-Z]{2})\s*-?\s*(\d{8})(?!\d)/m); return m ? m[1] + '-' + m[2] : ''; }

  /* ---- 金額 ---- */
  var STRONG = /合計|總計|總額|應付|實收|應收|Total|TOTAL|金額合計|總金額|付款金額/;
  var WEAK = /小計|現金|刷卡|信用卡|悠遊卡|付款|Sub/i;
  var NEG = /找零|找錢|折扣|優惠|統編|統一編號|電話|TEL|Tel|發票|隨機碼|序號|NO\.|No\.|卡號|條碼|點數|會員|載具/;
  var AMT = /\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
  function amountsIn(line, from) {
    var out = [], m, l = line.normalize('NFKC');
    var blank = function (x) { return x.replace(/[^\s]/g, ' '); };                         // 日期、時間先遮掉(保留長度,位置不變)
    l = l.replace(/\d{2,4}\s*[\/\-.年]\s*\d{1,2}\s*[\/\-.月]\s*\d{1,2}\s*日?/g, blank).replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日號号]/g, blank).replace(/\d{1,2}:\d{2}(?::\d{2})?/g, blank);
    AMT.lastIndex = 0;
    while ((m = AMT.exec(l))) {
      var raw = m[1].replace(/,/g, ''), v = Number(raw);
      if (!isFinite(v) || raw.length >= 8) continue;            // 電話、統編、發票號碼、條碼
      var before = l.slice(Math.max(0, m.index - 1), m.index), after = l.slice(m.index + m[0].length, m.index + m[0].length + 1);
      if (/[:\/\-]/.test(before) && /[:\/\-]/.test(after)) continue;   // 日期/時間的一部分
      if (/^[:\/]/.test(after) && /\d/.test(l[m.index + m[0].length + 1] || '')) continue;
      if (from === undefined || m.index >= from) out.push(v);
    }
    return out;
  }
  // 總額候選:有關鍵字的優先,否則取最大金額;回傳 {total:{value,source}, candidates:[{value,label,score}]}
  function totalCandidates(text) {
    var cands = {}, ls = lines(text);
    ls.forEach(function (l, i) {
      if (NEG.test(l) && !STRONG.test(l)) return;
      var kw = l.match(STRONG), vals = amountsIn(l, kw ? kw.index + kw[0].length : undefined);
      if (kw && vals.length) vals = [vals[0]];                       // 「隨機碼 4821 總計 135」:只取關鍵字後面的第一個金額
      if (!vals.length) return;
      var score = STRONG.test(l) ? 100 : (/小計|Sub/i.test(l) ? 50 : (WEAK.test(l) ? 40 : 10)), label = STRONG.test(l) ? '合計類' : (WEAK.test(l) ? '小計/付款' : '一般金額');
      if (/找零|找錢/.test(l)) return;
      vals.forEach(function (v) {
        if (v <= 0) return;
        var key = String(v), sc = score + (STRONG.test(l) ? 0 : Math.min(v, 100000) / 100000);       // 同分時金額大的在前
        if (!cands[key] || cands[key].score < sc) cands[key] = { value: v, label: label, score: sc, line: l };
      });
    });
    var list = Object.keys(cands).map(function (k) { return cands[k]; }).sort(function (a, b) { return b.score - a.score || b.value - a.value; });
    var top = list[0];
    if (!top) return { total: null, candidates: [] };
    var source = top.score >= 100 ? 'keyword' : 'max';
    if (source === 'max') { var mx = list.reduce(function (a, b) { return b.value > a.value ? b : a; }, list[0]); top = mx; list = [mx].concat(list.filter(function (c) { return c !== mx; })); }
    return { total: { value: top.value, source: source }, candidates: list.slice(0, 6).map(function (c) { return { value: c.value, label: c.label }; }) };
  }

  /* ---- 店名 ---- */
  var STORE_HINT = /店|行|館|商店|公司|超商|超市|咖啡|茶|餐|飲|麵|屋|坊|藥局|百貨|7-?ELEVEN|全家|萊爾富|OK|Mart|MART|CAFE|Cafe|GO/;
  var STORE_SKIP = /發票|統編|統一編號|電話|TEL|Tel|地址|路|街|巷|弄|樓|收據|明細|交易|序號|日期|時間|機|櫃|人員|謝謝|歡迎|www|http|@|\d{4}[\/\-]|:\d{2}/;
  function guessStore(text) {
    var ls = lines(text).slice(0, 8), best = '', bs = -1;
    ls.forEach(function (l, i) {
      if (l.length < 2 || l.length > 24 || STORE_SKIP.test(l) || /^[\d\s\-.,:$]+$/.test(l)) return;
      var s = 10 - i + (STORE_HINT.test(l) ? 8 : 0) - (l.length > 14 ? 2 : 0);
      if (s > bs) { bs = s; best = l; }
    });
    return best;
  }

  /* ---- 品項:「品名 數量 金額」各行 ---- */
  var SKIP_ITEM = /單號|序號|桌號|號碼|合計|總計|總額|應付|實收|應收|小計|找零|現金|刷卡|折扣|統編|電話|發票|隨機碼|日期|時間|卡號|Total|TOTAL|稅|服務費/;
  function parseItems(text) {
    var out = [];
    lines(text).forEach(function (l) {
      if (SKIP_ITEM.test(l) || findDate(l)) return;
      var m = l.match(/^(.*?[^\d\s$,.x×*])\s+\$?(\d[\d,]*)\s*[x×*]\s*(\d{1,3})\s+\$?(\d[\d,]*)$/);                 // 品名 單價 x 數量 金額
      if (m) { out.push({ name: m[1].trim(), qty: Number(m[3]), amount: Number(m[4].replace(/,/g, '')) }); return; }
      m = l.match(/^(.*?[^\d\s$,.x×*])\s*[x×*]\s*(\d{1,3})\s+\$?(\d[\d,]*)$/);                                         // 品名 x2 金額
      if (m) { out.push({ name: m[1].trim(), qty: Number(m[2]), amount: Number(m[3].replace(/,/g, '')) }); return; }
      m = l.match(/^(.*?[^\d\s$,.])\s+(\d{1,3})\s+\$?(\d[\d,]*)$/);                                                      // 品名 數量 金額
      if (m && Number(m[2]) < 100) { out.push({ name: m[1].trim(), qty: Number(m[2]), amount: Number(m[3].replace(/,/g, '')) }); return; }
      m = l.match(/^(.*?[^\d\s$,.])\s+\$?(\d[\d,]*)$/);                                                                  // 品名 金額
      if (m && m[1].trim().length >= 1 && Number(m[2].replace(/,/g, '')) < 1000000 && !/^[\d\s]+$/.test(m[1])) out.push({ name: m[1].trim(), qty: 1, amount: Number(m[2].replace(/,/g, '')) });
    });
    return out;
  }

  // 全部欄位。today = 'YYYY-MM-DD'(解析「11月23日」用今年)
  function parse(text, opts) {
    opts = opts || {};
    var d = findDate(text, opts.today), t = totalCandidates(text);
    return { store: guessStore(text), date: d ? d.date : '', dateRaw: d ? d.raw : '', dateRoc: d ? d.roc : false, taxId: findTaxId(text), invoiceNo: findInvoiceNo(text), total: t.total, candidates: t.candidates, items: parseItems(text) };
  }
  // 計算模式:抽出所有數字(帶前面的文字當標籤),讓使用者勾選
  function numbers(text) {
    var out = [];
    lines(text).forEach(function (l) {
      var re = /(-?\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\$?\d+(?:\.\d+)?)/g, m, last = 0;
      while ((m = re.exec(l))) {
        var raw = m[1].replace(/[$,]/g, ''), v = Number(raw);
        if (!isFinite(v)) continue;
        out.push({ value: v, label: l.slice(last, m.index).replace(/[:：\s]+$/, '').trim().slice(-14), line: l });
        last = m.index + m[0].length;
      }
    });
    return out;
  }
  return { parse: parse, findDate: findDate, findTaxId: findTaxId, findInvoiceNo: findInvoiceNo, totalCandidates: totalCandidates, guessStore: guessStore, parseItems: parseItems, numbers: numbers, lines: lines };
});
