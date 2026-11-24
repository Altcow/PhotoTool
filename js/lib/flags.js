/* 功能旗標(純函式):預設值 + 覆寫(localStorage['pt_flags'] / 網址 ?flags=+camera,-ai) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Flags = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var KEY = 'pt_flags';
  function isOn(name, defaults, overrides) {
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, name)) return !!overrides[name];
    return !!(defaults && defaults[name]);
  }
  // '+camera,-ai'(網址的 + 會被解成空白,所以只有 '-' 開頭算關)
  function parseSpec(spec) {
    var out = {};
    String(spec || '').split(',').forEach(function (tok) {
      tok = tok.trim();
      if (!tok) return;
      var off = tok.charAt(0) === '-';
      var name = tok.replace(/^[+-]/, '').trim();
      if (/^[A-Za-z][A-Za-z0-9]*$/.test(name)) out[name] = !off;
    });
    return out;
  }
  function readStored(storage) {
    try { var o = JSON.parse(storage.getItem(KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
  }
  // 處理網址參數並寫入儲存;回傳 {overrides, changed, clean}(clean=拿掉 flags 參數後的 search)
  function applyQuery(search, storage) {
    var p = new URLSearchParams(search || ''), raw = p.get('flags');
    var overrides = readStored(storage);
    if (raw === null) return { overrides: overrides, changed: false, clean: search || '' };
    if (raw.trim() === 'reset') overrides = {};
    else overrides = Object.assign({}, overrides, parseSpec(raw));
    try {
      if (Object.keys(overrides).length) storage.setItem(KEY, JSON.stringify(overrides)); else storage.removeItem(KEY);
    } catch (e) { /* 無法保存時只在本次有效 */ }
    p.delete('flags');
    var s = p.toString();
    return { overrides: overrides, changed: true, clean: s ? '?' + s : '' };
  }
  function make(defaults, overrides) {
    return function (name) { return isOn(name, defaults, overrides); };
  }
  return { KEY: KEY, isOn: isOn, parseSpec: parseSpec, readStored: readStored, applyQuery: applyQuery, make: make };
});
