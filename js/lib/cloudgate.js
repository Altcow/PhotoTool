/* 雲端連線閘門(純函式):沒有用戶端 ID 不可連線、沒看過「登入前說明」不可登入;登入前說明的文字。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CloudGate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  // state = { clientId, explainerAcked }
  function checkConnect(state) {
    if (!String((state && state.clientId) || '').trim()) return { ok: false, code: 'NO_CLIENT_ID', reason: '需要先設定 Google 用戶端 ID' };
    if (!(state && state.explainerAcked)) return { ok: false, code: 'NO_EXPLAINER', reason: '請先閱讀「登入前說明」' };
    return { ok: true, code: 'OK', reason: '' };
  }
  function acknowledge(state) { return Object.assign({}, state, { explainerAcked: true }); }
  // 中斷連線後,下次連線要重看說明
  function onDisconnect(state) { return Object.assign({}, state, { explainerAcked: false }); }
  function isStandalone(win) {
    try { return !!((win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) || (win.navigator && win.navigator.standalone)); } catch (e) { return false; }
  }
  // 登入前說明(白話繁中)。standalone=true 時多一段主畫面模式提醒
  function explainerLines(standalone) {
    var lines = [
      '接下來會開啟 Google 自己的登入頁面,我們看不到你的密碼。',
      '請確認網址列是 accounts.google.com。',
      '我們只會存取本 App 自己建立的「PhotoTool」資料夾,看不到你雲端硬碟的其他檔案。',
      '不想用了,隨時可到 Google 帳號的「第三方存取權」收回授權。',
    ];
    if (standalone) lines.push('主畫面模式看不到網址列。建議改用 Safari 開啟本網址再登入。');
    return lines;
  }
  return { SCOPE: SCOPE, checkConnect: checkConnect, acknowledge: acknowledge, onDisconnect: onDisconnect, isStandalone: isStandalone, explainerLines: explainerLines };
});
