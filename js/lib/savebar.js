/* 固定操作列的儲存狀態機(純函式):尚未儲存 / 已儲存 / 已自動儲存,以及離開確認。
   state = { dirty, savedAt, how:'manual'|'auto'|null } */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SaveBar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function create(opts) { return { dirty: false, savedAt: null, how: null, auto: !!(opts && opts.auto), everSaved: false }; }
  // 新建立、還沒有任何內容的畫面:視為尚未儲存(可選)
  function markDirty(s) { return Object.assign({}, s, { dirty: true }); }
  function markSaved(s, now) { return Object.assign({}, s, { dirty: false, savedAt: now, how: 'manual', everSaved: true }); }
  function markAuto(s, now) { return Object.assign({}, s, { dirty: false, savedAt: now, how: 'auto', everSaved: true }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clock(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  // 左側狀態字
  function statusText(s) {
    if (s.dirty) return s.everSaved ? '有變更,尚未儲存' : '尚未儲存';
    if (s.how === 'auto') return '✓ 已自動儲存 ' + clock(s.savedAt);
    if (s.how === 'manual') return '✓ 已儲存 ' + clock(s.savedAt);
    return s.auto ? '✓ 修改會自動儲存' : '尚未儲存';
  }
  // 有未儲存變更按返回 → 要二次確認(儲存 / 不儲存 / 繼續編輯)
  function needsLeaveConfirm(s) { return !!s.dirty; }
  var LEAVE_CHOICES = ['儲存', '不儲存', '繼續編輯'];
  // 寫入成功的小提示文字,要指出存在哪裡
  function toastText(where) { return '已存到 ' + where; }
  return { create: create, markDirty: markDirty, markSaved: markSaved, markAuto: markAuto, statusText: statusText, needsLeaveConfirm: needsLeaveConfirm, LEAVE_CHOICES: LEAVE_CHOICES, toastText: toastText, clock: clock };
});
