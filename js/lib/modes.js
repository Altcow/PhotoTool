/* 相機模式(拍照前先選):模式清單、記住上次、有無 AI 的流程決定、自動模式的分類對應。純函式。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Modes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var KEY = 'pt_mode';
  // chatMode:有 AI 時送給 openChat 的模式(對應 ai.js 的 MODE_HINTS);manual:沒有 AI 時的手動入口
  var MODES = [
    { id: 'menu', label: '菜單', icon: '🍹', needsAi: false, desc: '拍菜單 → 做成點餐菜單', chatMode: 'menu', manual: 'menu', noAi: '未啟用 AI:不會自動讀菜單。請貼上文字(每行「品名 價格」)或手動輸入。' },
    { id: 'expense', label: '記帳', icon: '🧾', needsAi: false, desc: '拍收據 → 記一筆帳', chatMode: 'expense', manual: 'expense', noAi: '未啟用 AI:不會自動讀金額,請手動填。照片會當附件。' },
    { id: 'split', label: '分帳', icon: '👥', needsAi: false, desc: '拍帳單 → 算出每人應付', chatMode: 'split', manual: 'split', noAi: '未啟用 AI:不會自動讀品項。請手動輸入品項與金額,由程式算。' },
    { id: 'table', label: '表格', icon: '📊', needsAi: false, desc: '拍表格 → 轉成可編輯的 Excel', chatMode: 'excel', manual: 'table', noAi: '未啟用 AI:不會自動讀表格。可用輸入框的「掃描文字」把字掃進來,再轉成表格。' },
    { id: 'calc', label: '計算', icon: '🧮', needsAi: false, desc: '拍數字 → 由程式加減乘除', chatMode: 'calc', manual: 'calc', noAi: '未啟用 AI:不會自動讀數字。請手動輸入數字,由程式算。' },
    { id: 'translate', label: '翻譯', icon: '🌐', needsAi: true, desc: '拍文字 → 翻成繁體中文', chatMode: 'translate', manual: null, noAi: '' },
    { id: 'lookup', label: '查資料', icon: '🔍', needsAi: true, desc: '拍物品/植物 → 辨識並給資料', chatMode: 'lookup', manual: null, noAi: '' },
    { id: 'auto', label: '自動', icon: '✨', needsAi: true, desc: '由 AI 判斷拍的是什麼,自動選功能', chatMode: null, manual: null, noAi: '' },
  ];
  var DEFAULT_ID = 'menu';   // 拍照主要用在菜單
  function byId(id) { for (var i = 0; i < MODES.length; i++) if (MODES[i].id === id) return MODES[i]; return null; }
  // 沒有 AI 時,需要 AI 的模式不能選
  function selectable(id, aiOn) { var m = byId(id); return !!m && (aiOn || !m.needsAi); }
  // 記住的模式若不存在或現在不能用,退回預設
  function resolveMode(saved, aiOn) { return selectable(saved, aiOn) ? saved : DEFAULT_ID; }
  function recall(storage, aiOn) { var v = null; try { v = storage.getItem(KEY); } catch (e) { v = null; } return resolveMode(v, aiOn); }
  function remember(storage, id) { try { storage.setItem(KEY, id); return true; } catch (e) { return false; } }

  // 拍完(或選完圖)之後的流程。不經分類:只有 auto 才會先分類。
  function flow(id, aiOn) {
    var m = byId(id);
    if (!m) return { kind: 'blocked', reason: '未知模式' };
    if (!selectable(id, aiOn)) return { kind: 'blocked', reason: '需要啟用 AI' };
    if (id === 'auto') return { kind: 'ai-auto', classify: true };
    if (aiOn) return { kind: id === 'menu' ? 'ai-menu' : 'ai-chat', chatMode: m.chatMode, classify: false };
    return { kind: 'manual-' + m.manual, classify: false };
  }
  // 相機上方的常駐提示(沒有 AI 才顯示)
  function aiBar(aiOn) { return aiOn ? null : { text: '未啟用 AI:無法自動讀取照片,仍可手動記錄', button: '啟用 AI' }; }
  var AI_NEEDED_TEXT = '這個功能要由 AI 讀照片。請先到設定填入金鑰並啟用 AI,之後就能使用。';
  // 自動模式:依 classify_photo 的結果決定要走哪個模式
  var KIND_TO_MODE = { receipt: 'expense', bill_list: 'split', table: 'table', form: 'table', text_doc: 'translate', menu: 'menu', plant: 'lookup', object: 'lookup', screenshot: 'translate', other: 'lookup' };
  var ACTION_TO_MODE = { record: 'expense', split: 'split', calc: 'calc', translate: 'translate', lookup: 'lookup', excel: 'table', menu: 'menu' };
  function modeFromClassify(r) {
    r = r || {};
    var acts = r.suggested_actions || [];
    for (var i = 0; i < acts.length; i++) if (ACTION_TO_MODE[acts[i]]) return ACTION_TO_MODE[acts[i]];
    return KIND_TO_MODE[r.kind] || 'lookup';
  }
  return { MODES: MODES, DEFAULT_ID: DEFAULT_ID, byId: byId, selectable: selectable, resolveMode: resolveMode, recall: recall, remember: remember, flow: flow, aiBar: aiBar, AI_NEEDED_TEXT: AI_NEEDED_TEXT, modeFromClassify: modeFromClassify };
});
