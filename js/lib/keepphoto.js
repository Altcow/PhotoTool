/* 「是否保留照片」:照片只是掃描文字的材料,預設不保留(不寫入 IndexedDB、不進上傳佇列、不上傳、匯出不含)。純函式。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KeepPhoto = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // 單筆的開關(override)優先;沒設定就用全域預設(settings.keepPhotos,預設關)
  function resolve(globalKeep, override) { return override === undefined || override === null ? !!globalKeep : !!override; }
  function fromSettings(settings, override) { return resolve(settings && settings.keepPhotos, override); }
  // 只有保留時才呼叫 saveFn(blob) 寫入;關閉時一個 Blob 都不寫,回傳 []
  async function persist(blobs, keep, saveFn) {
    var ids = [];
    if (!keep) return ids;
    for (var i = 0; i < (blobs || []).length; i++) ids.push(await saveFn(blobs[i], i));
    return ids;
  }
  // 儲存成功 toast 後綴 / 詳情頁文字
  function suffix(keep, count) { if (!count) return ''; return keep ? '已保留 ' + count + ' 張照片' : '未保留照片'; }
  function toast(where, keep, count) { var s = suffix(keep, count); return '已存到 ' + where + (s ? '(' + s + ')' : ''); }
  function detailText(storedCount) { return storedCount > 0 ? '📎 已保留 ' + storedCount + ' 張照片' : '未保留照片'; }
  // 記錄要存的照片 = 已存的(原樣不動)+ 本次新增且保留的
  function mergeStored(stored, added, keep) { return (stored || []).concat(keep ? (added || []) : []); }
  return { resolve: resolve, fromSettings: fromSettings, persist: persist, suffix: suffix, toast: toast, detailText: detailText, mergeStored: mergeStored };
});
