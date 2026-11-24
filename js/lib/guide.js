/* 導覽:功能選單、新手引導、各畫面的「?」說明、開團前的引導判斷。純函式(儲存層可注入)。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Guide = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // 功能選單(做什麼);相機模式列(拍什麼)是另一回事
  var FUNCS = [
    { id: 'voice-expense', icon: '🎤', title: '一句話記帳(不用拍照)', desc: '用鍵盤的麥克風說一句,自動記成帳', action: { type: 'voice', kind: 'expense' } },
    { id: 'voice-split', icon: '🎤', title: '一句話分帳', desc: '說出誰付了多少,放進旅遊/聚會分帳', action: { type: 'voice', kind: 'split' } },
    { id: 'camera-expense', icon: '📷', title: '拍照記帳', desc: '拍收據,記一筆帳', action: { type: 'camera', mode: 'expense' } },
    { id: 'trips', icon: '🧾', title: '旅遊/聚會分帳', desc: '多人一起花錢,算出誰付給誰', action: { type: 'screen', name: 'trips' } },
    { id: 'room', icon: '🍹', title: '菜單點餐開團', desc: '拍菜單、開團,大家用手機點餐', action: { type: 'screen', name: 'room' } },
    { id: 'stats', icon: '📊', title: '我的旅行統計', desc: '每趟旅行我家花了多少', action: { type: 'screen', name: 'stats' } },
    { id: 'ledger', icon: '📒', title: '記帳本', desc: '看過去的帳、報表', action: { type: 'screen', name: 'ledger' } },
    { id: 'files', icon: '📁', title: '我的檔案', desc: '存好的表格與照片', action: { type: 'screen', name: 'files' } },
    { id: 'camera-table', icon: '📝', title: '轉 Excel(拍表格)', desc: '拍表格,變成可編輯的 Excel', action: { type: 'camera', mode: 'table' } },
    { id: 'settings', icon: '⚙️', title: '設定', desc: 'AI、雲端、資料庫、名稱', action: { type: 'screen', name: 'settings' } },
  ];
  function funcById(id) { for (var i = 0; i < FUNCS.length; i++) if (FUNCS[i].id === id) return FUNCS[i]; return null; }

  // 第一次開 App 的 3 張引導卡
  var ONBOARD = [
    { icon: '📷', text: '拍照就能記帳:選好要拍什麼,拍下去,存好。' },
    { icon: '🧾', text: '旅遊或聚會的錢,先記下來,最後幫你算清楚誰付給誰。' },
    { icon: '🍹', text: '拍一張菜單,一鍵開團,朋友用手機點餐。' },
  ];
  var KEY = 'pt_onboarded';
  function shouldShowOnboarding(storage) { try { return storage.getItem(KEY) !== '1'; } catch (e) { return false; } }
  function markOnboarded(storage) { try { storage.setItem(KEY, '1'); return true; } catch (e) { return false; } }
  function resetOnboarding(storage) { try { storage.removeItem(KEY); return true; } catch (e) { return false; } }

  // 每個主要畫面右上「?」的兩三句說明
  var HELP = {
    menu: { title: '你想做什麼?', lines: ['這裡列出所有功能,點卡片就開始。', '想拍照記帳或拍表格,點上面的卡片會回到相機。', '「拍什麼」在相機底下的模式列選;這裡選的是「要做什麼」。'] },
    ledger: { title: '記帳本', lines: ['這裡是你存下來的每一筆帳。', '拍收據記帳,或按「記一筆」自己填。', '「報表」可以看每個分類花了多少。'] },
    files: { title: '我的檔案', lines: ['拍表格轉成 Excel 後按「儲存」,就會放在這裡。', '點進去可以再修改、下載或分享。'] },
    trips: { title: '旅遊/聚會分帳', lines: ['先建一個旅遊團並加入成員。', '花錢時記一筆(誰先付、誰要分攤)。', '最後按「結算費用」,看誰付給誰。'] },
    trip: { title: '旅遊團', lines: ['「新增項目」記一筆花費;「一次說完/貼上」可以一次記很多筆。', '修改會自動儲存。', '最後按「結算費用」看誰付給誰。'] },
    stats: { title: '我的旅行統計', lines: ['這裡統計每趟旅行「我家」花了多少、先付了多少。', '要先在旅遊團裡點選「我是誰」。'] },
    room: { title: '菜單點餐開團', lines: ['先有菜單範本,選好菜單就能開團。', '開團後分享連結或 QR,朋友用手機點餐。', '多人點餐需要先設定資料庫(一次就好)。'] },
    library: { title: '我的菜單', lines: ['這裡是存好的菜單範本。', '點「編輯」可以改價格、加品項。', '存好後可以直接開團。'] },
    settings: { title: '設定', lines: ['最上面是 AI 讀照片的狀態。', '改完按底下的「儲存」。', '可以在這裡重看新手引導。'] },
  };
  function helpFor(key) { return HELP[key] || null; }

  // 開團前提的引導判斷:先看資料庫、再看有沒有菜單範本
  function roomGate(opts) {
    if (!opts.hasBackend) return { kind: 'need-db', title: '多人點餐需要先設定資料庫(一次就好)', buttons: ['前往設定', '先用單機預覽'] };
    if (!opts.libraryCount) return { kind: 'empty-library', title: '還沒有菜單範本', buttons: ['📷 拍菜單建立', '✍️ 貼文字建立'] };
    return { kind: 'ok' };
  }
  // 菜單範本存好之後:新建立的要問「要馬上開團嗎?」
  function afterTemplateSave(isNew) { return isNew ? 'ask-open-room' : 'toast'; }
  var ASK_ROOM = { title: '要馬上開團嗎?', primary: '🍹 開團', secondary: '只存範本' };

  return { FUNCS: FUNCS, funcById: funcById, ONBOARD: ONBOARD, shouldShowOnboarding: shouldShowOnboarding, markOnboarded: markOnboarded, resetOnboarding: resetOnboarding, HELP: HELP, helpFor: helpFor, roomGate: roomGate, afterTemplateSave: afterTemplateSave, ASK_ROOM: ASK_ROOM };
});
