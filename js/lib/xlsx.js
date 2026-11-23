/* 最小 xlsx 產生器:ZIP store(無壓縮)+ CRC32,字串用 inlineStr,首列粗體,欄寬自動估算。無外部相依 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Xlsx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var enc = new TextEncoder();

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // files: [{name, data(Uint8Array)}] → Uint8Array(ZIP,store)
  function zip(files) {
    var parts = [], central = [], offset = 0;
    var dosTime = (0 << 11) | (0 << 5) | 0;           // 00:00:00
    var dosDate = ((2024 - 1980) << 9) | (1 << 5) | 1; // 2024-01-01
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = f.data, crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = 0;
    central.forEach(function (c) { cdSize += c.length; });
    var eo = new DataView(new ArrayBuffer(22));
    eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, files.length, true); eo.setUint16(10, files.length, true);
    eo.setUint32(12, cdSize, true); eo.setUint32(16, offset, true);
    var all = parts.concat(central, [new Uint8Array(eo.buffer)]);
    var total = 0;
    all.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total), pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  // 移除 XML 1.0 不允許的控制字元,再跳脫
  function xmlText(s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 儲存格值:number 或「純數字字串」→ 數字;前導 0(如 007、電話)保留文字;其餘文字
  function coerce(v) {
    if (v == null) return { t: 'e' };
    if (typeof v === 'number') return isFinite(v) ? { t: 'n', v: v } : { t: 's', v: String(v) };
    if (typeof v === 'boolean') return { t: 's', v: v ? 'TRUE' : 'FALSE' };
    var s = String(v), tr = s.trim();
    if (tr === '') return s === '' ? { t: 'e' } : { t: 's', v: s };
    var plain = /^-?(0|[1-9]\d*)(\.\d+)?$/.test(tr);
    var grouped = /^-?[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(tr);
    if (plain || grouped) {
      var n = Number(tr.replace(/,/g, ''));
      var digits = tr.replace(/[^0-9]/g, '').length;
      if (isFinite(n) && digits <= 15) return { t: 'n', v: n };
    }
    return { t: 's', v: s };
  }

  function colLetter(i) { // 0 → A
    var s = '';
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  }

  function dispWidth(s) {
    var w = 0, str = String(s);
    for (var i = 0; i < str.length; i++) w += str.charCodeAt(i) > 0x2E7F ? 2 : 1;
    return w;
  }

  function cleanSheetName(name, used, idx) {
    var n = String(name == null ? '' : name).replace(/[\[\]:*?\/\\]/g, ' ').replace(/^'+|'+$/g, '').trim();
    if (!n) n = 'Sheet' + (idx + 1);
    n = n.slice(0, 31);
    var base = n, k = 2;
    while (used.indexOf(n.toLowerCase()) >= 0) { var suf = ' (' + k++ + ')'; n = base.slice(0, 31 - suf.length) + suf; }
    used.push(n.toLowerCase());
    return n;
  }

  function sheetXml(sheet) {
    var grid = [];
    if (sheet.columns && sheet.columns.length) grid.push(sheet.columns);
    var hasHeader = grid.length === 1;
    (sheet.rows || []).forEach(function (r) { grid.push(r); });
    var ncol = 0, widths = [];
    grid.forEach(function (r) {
      ncol = Math.max(ncol, r.length);
      r.forEach(function (v, c) { widths[c] = Math.max(widths[c] || 0, Math.min(dispWidth(v == null ? '' : v), 60)); });
    });
    var out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'];
    if (ncol) {
      out.push('<cols>');
      for (var c = 0; c < ncol; c++) out.push('<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + Math.max(8, Math.min(60, (widths[c] || 0) + 2)) + '" customWidth="1"/>');
      out.push('</cols>');
    }
    out.push('<sheetData>');
    grid.forEach(function (r, ri) {
      var cells = [];
      r.forEach(function (v, ci) {
        var isHead = hasHeader && ri === 0;
        var cv = isHead ? ((v == null || String(v) === '') ? { t: 'e' } : { t: 's', v: String(v) }) : coerce(v);
        if (cv.t === 'e') return;
        var ref = colLetter(ci) + (ri + 1), st = isHead ? ' s="1"' : '';
        if (cv.t === 'n') cells.push('<c r="' + ref + '"' + st + '><v>' + String(cv.v) + '</v></c>');
        else cells.push('<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + xmlText(cv.v) + '</t></is></c>');
      });
      out.push('<row r="' + (ri + 1) + '">' + cells.join('') + '</row>');
    });
    out.push('</sheetData></worksheet>');
    return out.join('');
  }

  // sheets: [{name, columns:[], rows:[[]]}] → Uint8Array(.xlsx)
  function build(sheets) {
    if (!sheets || !sheets.length) sheets = [{ name: 'Sheet1', columns: [], rows: [] }];
    var used = [], names = sheets.map(function (s, i) { return cleanSheetName(s.name, used, i); });
    var files = [];
    var ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'];
    sheets.forEach(function (s, i) { ct.push('<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'); });
    ct.push('</Types>');
    files.push({ name: '[Content_Types].xml', data: enc.encode(ct.join('')) });
    files.push({ name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') });
    var wb = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'];
    names.forEach(function (n, i) { wb.push('<sheet name="' + xmlText(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'); });
    wb.push('</sheets></workbook>');
    files.push({ name: 'xl/workbook.xml', data: enc.encode(wb.join('')) });
    var rel = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'];
    sheets.forEach(function (s, i) { rel.push('<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'); });
    rel.push('<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: enc.encode(rel.join('')) });
    files.push({ name: 'xl/styles.xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>') });
    sheets.forEach(function (s, i) { files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: enc.encode(sheetXml(s)) }); });
    return zip(files);
  }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // 多個工作表時以空白列與工作表名稱分隔;開頭加 UTF-8 BOM(字串形式 ﻿)
  function toCSV(sheets) {
    var lines = [];
    sheets.forEach(function (s, i) {
      if (sheets.length > 1) { if (i) lines.push(''); lines.push(csvCell(s.name || ('Sheet' + (i + 1)))); }
      if (s.columns && s.columns.length) lines.push(s.columns.map(csvCell).join(','));
      (s.rows || []).forEach(function (r) { lines.push(r.map(csvCell).join(',')); });
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  return { build: build, zip: zip, crc32: crc32, coerce: coerce, toCSV: toCSV, cleanSheetName: cleanSheetName, colLetter: colLetter };
});
