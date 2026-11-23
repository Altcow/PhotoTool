/* Firebase Realtime Database REST 串流(SSE)事件套用與讀回資料正規化(純函式) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rtdb = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function parts(p) { return String(p || '').split('/').filter(Boolean); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return v === undefined ? null : JSON.parse(JSON.stringify(v)); }
  function isEmpty(v) { return v === null || v === undefined || (typeof v === 'object' && Object.keys(v).length === 0); }
  function prune(v) {
    if (!isObj(v)) return v;
    Object.keys(v).forEach(function (k) { v[k] = prune(v[k]); if (isEmpty(v[k])) delete v[k]; });
    return v;
  }
  // put 事件:path 處的值整個換成 data(null = 刪除)
  function applyPut(tree, path, data) {
    var ps = parts(path);
    if (!ps.length) return isEmpty(data) ? null : prune(clone(data));
    var root = isObj(tree) ? clone(tree) : {}, cur = root;
    for (var i = 0; i < ps.length - 1; i++) {
      if (!isObj(cur[ps[i]])) cur[ps[i]] = {};
      cur = cur[ps[i]];
    }
    var last = ps[ps.length - 1];
    if (isEmpty(data)) delete cur[last]; else cur[last] = clone(data);
    prune(root);
    return isEmpty(root) ? null : root;
  }
  // patch 事件:data 的每個鍵各自覆蓋 path 底下對應子節點
  function applyPatch(tree, path, data) {
    var t = tree;
    Object.keys(data || {}).forEach(function (k) { t = applyPut(t, parts(path).concat([k]).join('/'), data[k]); });
    return t;
  }
  // Firebase 把「索引鍵夠密集」的物件讀回成陣列、陣列寫入時存成索引物件;統一轉回陣列
  function fromFirebase(v) {
    if (Array.isArray(v)) return v.filter(function (x) { return x !== null && x !== undefined; }).map(fromFirebase);
    if (!isObj(v)) return v;
    var keys = Object.keys(v);
    if (keys.length && keys.every(function (k) { return /^\d+$/.test(k); }) && Math.max.apply(null, keys.map(Number)) <= keys.length * 2) {
      return keys.sort(function (a, b) { return a - b; }).map(function (k) { return fromFirebase(v[k]); });
    }
    var out = {};
    keys.forEach(function (k) { out[k] = fromFirebase(v[k]); });
    return out;
  }
  // 解析一則 SSE 事件 → 新樹;未知事件回傳原樹
  function applyEvent(tree, type, payload) {
    if (type === 'put') return applyPut(tree, payload.path, payload.data);
    if (type === 'patch') return applyPatch(tree, payload.path, payload.data);
    return tree;
  }
  return { applyPut: applyPut, applyPatch: applyPatch, applyEvent: applyEvent, fromFirebase: fromFirebase, parts: parts };
});
