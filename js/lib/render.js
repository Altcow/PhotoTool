/* 把「報表規格 spec」排版成圖片頁(純 canvas,不用外部程式庫)。
   spec = { title, subtitle, sections:[ {kind:'totals', heading, items:[{name,value,tone}]},
                                        {kind:'list', heading, rows:[{left,right,sub}]},
                                        {kind:'table', heading, columns:[], rows:[[]], num:[colIndex...]},
                                        {kind:'text', heading, lines:[]} ], 每個 section 可加 pageBreakBefore:true }
   layout() 是純函式(量字寬由 measure 注入,node 可測);draw()/renderPages() 才碰 canvas。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Render = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var W = 1080, M = 48, MAX_H = 2600, FOOT = 56;
  var FONT = '"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
  var C = { bg: '#ffffff', fg: '#111827', muted: '#6b7280', line: '#d1d5db', head: '#1d4ed8', recv: '#15803d', pay: '#b45309', card: '#f3f4f6', headBg: '#e5e7eb', accent: '#b45309' };

  // node 測試用的近似字寬:中日韓字 = 字級,其餘約 0.56
  function approxMeasure(text, size, bold) {
    var w = 0; String(text).split('').forEach(function (ch) { w += ch.charCodeAt(0) >= 0x2E80 ? size : size * 0.56; });
    return w * (bold ? 1.05 : 1);
  }
  function ellipsize(text, maxW, size, bold, measure) {
    text = String(text);
    if (measure(text, size, bold) <= maxW) return text;
    while (text.length > 1 && measure(text + '…', size, bold) > maxW) text = text.slice(0, -1);
    return text + '…';
  }
  function wrap(text, maxW, size, measure) {
    var lines = [], cur = '';
    String(text).split('').forEach(function (ch) { if (measure(cur + ch, size, false) > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch; });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  function layout(spec, measure) {
    measure = measure || approxMeasure;
    var pages = [], cur = null, y = 0;
    var newPage = function (first) {
      if (cur) cur.endY = y;
      cur = { ops: [], height: 0 }; pages.push(cur); y = M;
      if (first) {
        cur.ops.push({ t: 'text', x: M, y: y, text: spec.title || '', size: 56, bold: true, color: C.fg });
        y += 76;
        if (spec.subtitle) { cur.ops.push({ t: 'text', x: M, y: y, text: spec.subtitle, size: 30, color: C.muted }); y += 50; }
        y += 8;
      } else {
        cur.ops.push({ t: 'text', x: M, y: y, text: (spec.title || '') + '(續)', size: 34, bold: true, color: C.muted }); y += 62;
      }
    };
    var ensure = function (h) { if (y + h > MAX_H - FOOT - M) newPage(false); };
    newPage(true);
    (spec.sections || []).forEach(function (sec) {
      if (sec.pageBreakBefore && y > M + 140) newPage(false);
      if (sec.heading) {
        ensure(40 + 20 + 60);
        cur.ops.push({ t: 'rect', x: M, y: y + 4, w: 10, h: 40, fill: C.head });
        cur.ops.push({ t: 'text', x: M + 26, y: y, text: sec.heading, size: 40, bold: true, color: C.head });
        y += 62;
      }
      if (sec.kind === 'totals') {
        var gap = 24, cw = (W - 2 * M - gap) / 2, ch = 132;
        (sec.items || []).forEach(function (it, i) {
          if (i % 2 === 0) ensure(ch + gap);
          var col = i % 2, x = M + col * (cw + gap), top = y;
          cur.ops.push({ t: 'rect', x: x, y: top, w: cw, h: ch, fill: C.card, stroke: it.tone === 'recv' ? C.recv : it.tone === 'pay' ? C.pay : C.line });
          cur.ops.push({ t: 'text', x: x + 22, y: top + 14, text: ellipsize(it.name, cw - 44, 32, false, measure), size: 32, color: C.muted });
          cur.ops.push({ t: 'text', x: x + 22, y: top + 60, text: ellipsize(it.value, cw - 44, 50, true, measure), size: 50, bold: true, color: it.tone === 'recv' ? C.recv : it.tone === 'pay' ? C.pay : C.fg });
          if (col === 1 || i === sec.items.length - 1) y += ch + gap;
        });
        if (!(sec.items || []).length) { cur.ops.push({ t: 'text', x: M, y: y, text: '(沒有資料)', size: 30, color: C.muted }); y += 50; }
      } else if (sec.kind === 'list') {
        (sec.rows || []).forEach(function (r) {
          var h = r.sub ? 112 : 78;
          ensure(h);
          cur.ops.push({ t: 'text', x: M, y: y + 8, text: ellipsize(r.left, W - 2 * M - 250, 38, true, measure), size: 38, bold: true, color: C.fg });
          cur.ops.push({ t: 'text', x: W - M, y: y + 6, text: r.right, size: 42, bold: true, color: C.accent, align: 'right' });
          if (r.sub) cur.ops.push({ t: 'text', x: M, y: y + 62, text: ellipsize(r.sub, W - 2 * M, 28, false, measure), size: 28, color: C.muted });
          cur.ops.push({ t: 'line', x1: M, y1: y + h - 6, x2: W - M, y2: y + h - 6, color: C.line });
          y += h;
        });
        if (!(sec.rows || []).length) { cur.ops.push({ t: 'text', x: M, y: y, text: sec.empty || '(沒有資料)', size: 32, color: C.muted }); y += 56; }
      } else if (sec.kind === 'table') {
        var cols = sec.columns || [], rows = sec.rows || [], avail = W - 2 * M, size = 30, num = sec.num || [];
        var widths = cols.map(function (c, ci) { var w = measure(c, size, true); rows.forEach(function (r) { w = Math.max(w, measure(r[ci] == null ? '' : r[ci], size, false)); }); return w + 28; });
        var total = widths.reduce(function (a, b) { return a + b; }, 0);
        if (total > avail) { size = 28; widths = widths.map(function (w) { return w * avail / total; }); } else { var extra = (avail - total) / Math.max(1, cols.length); widths = widths.map(function (w) { return w + extra; }); }
        var drawRow = function (cells, head) {
          var rh = 58; ensure(rh);
          if (head) cur.ops.push({ t: 'rect', x: M, y: y, w: avail, h: rh, fill: C.headBg });
          var x = M;
          cells.forEach(function (cv, ci) {
            var txt = ellipsize(cv == null ? '' : cv, widths[ci] - 20, size, head, measure), right = num.indexOf(ci) >= 0;
            cur.ops.push({ t: 'text', x: right ? x + widths[ci] - 12 : x + 12, y: y + 12, text: txt, size: size, bold: !!head, color: C.fg, align: right ? 'right' : 'left' });
            x += widths[ci];
          });
          cur.ops.push({ t: 'line', x1: M, y1: y + rh, x2: W - M, y2: y + rh, color: C.line });
          y += rh;
        };
        ensure(58 * 2);
        if (cols.length) drawRow(cols, true);
        rows.forEach(function (r) { if (y + 58 > MAX_H - FOOT - M) { newPage(false); if (cols.length) drawRow(cols, true); } drawRow(r, false); });
        y += 10;
      } else if (sec.kind === 'text') {
        (sec.lines || []).forEach(function (ln) { wrap(ln, W - 2 * M, 28, measure).forEach(function (w) { ensure(42); cur.ops.push({ t: 'text', x: M, y: y, text: w, size: 28, color: C.fg }); y += 42; }); });
      }
      y += 22;
    });
    var n = pages.length;
    cur.endY = y;
    pages.forEach(function (p, i) {
      p.height = Math.min(MAX_H, Math.max(500, p.endY + M * 0.5 + FOOT));
      p.height = Math.round(p.height);
      p.ops.push({ t: 'text', x: W / 2, y: p.height - FOOT + 6, text: n > 1 ? '第 ' + (i + 1) + '/' + n + ' 張' : '', size: 26, color: C.muted, align: 'center' });
    });
    return { width: W, pages: pages, count: n };
  }

  // 以 2D context 畫一頁(scale = 輸出倍率)
  function draw(ctx, page, scale) {
    ctx.save(); ctx.scale(scale, scale);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, page.height);
    page.ops.forEach(function (o) {
      if (o.t === 'rect') { ctx.fillStyle = o.fill; ctx.fillRect(o.x, o.y, o.w, o.h); if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = 3; ctx.strokeRect(o.x, o.y, o.w, o.h); } }
      else if (o.t === 'line') { ctx.strokeStyle = o.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke(); }
      else if (o.t === 'text') { ctx.font = (o.bold ? 'bold ' : '') + o.size + 'px ' + FONT; ctx.fillStyle = o.color; ctx.textAlign = o.align || 'left'; ctx.textBaseline = 'top'; ctx.fillText(o.text, o.x, o.y); }
    });
    ctx.restore();
  }
  function browserMeasure() {
    var c = document.createElement('canvas').getContext('2d');
    return function (text, size, bold) { c.font = (bold ? 'bold ' : '') + size + 'px ' + FONT; return c.measureText(String(text)).width; };
  }
  // 在瀏覽器產生每一頁的 canvas
  function renderPages(spec, opts) {
    opts = opts || {};
    var scale = opts.scale || Math.min(2, Math.max(1, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)));
    var lay = layout(spec, browserMeasure());
    return lay.pages.map(function (p) {
      var cv = document.createElement('canvas'); cv.width = Math.round(W * scale); cv.height = Math.round(p.height * scale);
      draw(cv.getContext('2d'), p, scale);
      return cv;
    });
  }
  function canvasToBlob(cv, type, q) { return new Promise(function (res) { cv.toBlob(res, type, q); }); }

  return { layout: layout, draw: draw, renderPages: renderPages, canvasToBlob: canvasToBlob, approxMeasure: approxMeasure, W: W, MAX_H: MAX_H };
});
