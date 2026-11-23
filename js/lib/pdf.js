/* 最小 PDF 產生器(純 JS):每頁嵌入一張 JPEG(DCTDecode),不嵌字型 → 內容是圖片、不可搜尋。
   pages: [{ jpeg: Uint8Array, width, height }](像素);頁面寬固定 595pt(A4 寬),高依圖比例。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Pdf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var enc = new TextEncoder();
  var PAGE_W = 595;

  function build(pages) {
    if (!pages || !pages.length) throw new Error('沒有頁面');
    var parts = [], off = 0, offsets = {};
    var push = function (b) { if (typeof b === 'string') b = enc.encode(b); parts.push(b); off += b.length; };
    var n = pages.length;
    var pageId = function (i) { return 3 + 3 * i; }, contentId = function (i) { return 4 + 3 * i; }, imageId = function (i) { return 5 + 3 * i; };
    var begin = function (id) { offsets[id] = off; push(id + ' 0 obj\n'); };
    push('%PDF-1.4\n'); push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
    begin(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    var kids = []; for (var i = 0; i < n; i++) kids.push(pageId(i) + ' 0 R');
    begin(2); push('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>\nendobj\n');
    pages.forEach(function (p, i) {
      var h = Math.round(PAGE_W * p.height / p.width * 100) / 100;
      begin(pageId(i)); push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + h + '] /Resources << /XObject << /Im0 ' + imageId(i) + ' 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ' + contentId(i) + ' 0 R >>\nendobj\n');
      var content = 'q ' + PAGE_W + ' 0 0 ' + h + ' 0 0 cm /Im0 Do Q';
      begin(contentId(i)); push('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n');
      begin(imageId(i)); push('<< /Type /XObject /Subtype /Image /Width ' + p.width + ' /Height ' + p.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpeg.length + ' >>\nstream\n');
      push(p.jpeg); push('\nendstream\nendobj\n');
    });
    var total = 3 * n + 2, xref = off, pad = function (v) { return ('0000000000' + v).slice(-10); };
    var x = 'xref\n0 ' + (total + 1) + '\n0000000000 65535 f \n';
    for (var id = 1; id <= total; id++) x += pad(offsets[id]) + ' 00000 n \n';
    push(x + 'trailer\n<< /Size ' + (total + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    var out = new Uint8Array(off), pos = 0;
    parts.forEach(function (b) { out.set(b, pos); pos += b.length; });
    return out;
  }
  // 結構自檢(測試用):檔頭、xref 偏移指到 "N 0 obj"、startxref、頁數
  function inspect(bytes) {
    var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    var res = { header: s.slice(0, 5) === '%PDF-', eof: /%%EOF\s*$/.test(s), pages: (s.match(/\/Type \/Page /g) || []).length, xrefOk: false, objects: 0 };
    var sx = s.match(/startxref\n(\d+)\n/); if (!sx) return res;
    var xpos = Number(sx[1]); if (s.slice(xpos, xpos + 4) !== 'xref') return res;
    var m = s.slice(xpos).match(/xref\n0 (\d+)\n/); if (!m) return res;
    var count = Number(m[1]), lines = s.slice(xpos + m[0].length).split('\n'), ok = true;
    for (var k = 1; k < count; k++) { var off = Number(lines[k].slice(0, 10)); if (s.slice(off, off + String(k).length + 6) !== k + ' 0 obj') ok = false; }
    res.xrefOk = ok; res.objects = count - 1;
    return res;
  }
  return { build: build, inspect: inspect, PAGE_W: PAGE_W };
});
