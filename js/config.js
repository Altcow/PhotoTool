// 連線資訊只放這個檔案(使用者畫面上沒有任何設定欄位)。
export const FIREBASE_DB_URL = 'https://my-travel-journal-b22b3-default-rtdb.asia-southeast1.firebasedatabase.app';

// Google 用戶端 ID(公開識別碼,不是密碼)。留空時畫面不顯示 Google 登入與綁定;填入後自動出現。
export const GOOGLE_CLIENT_ID = '';

// 網頁 API 金鑰(AIza…,官方說明不是秘密)。未填時登入頁顯示「服務暫時無法使用」。
export const FIREBASE_API_KEY = 'AIzaSyBDpANM0gcGtxzd6lzLQPfjfBbtqMzjTIc';

// 功能旗標預設值(旅遊日誌 v10)。覆寫:網址 ?flags=+camera,-ai 或 localStorage['pt_flags']
export const FEATURES = {
  journal: true, camera: false, ai: false, excel: false, calc: false,
  ledger: false, stats: false, files: false, trips: false, room: false, cloud: false, drivePreview: true,
  export: false, lineShare: false, calendar: false, sketch: false, phrases: false, settle: false, driveUpload: false,
};

// 日誌容量與長度上限(與 tools/rules 一致)
export const JOURNAL_LIMITS = {
  title: 60, name: 30, about: 2000, leader: 30, phone: 30, noticeBody: 2000, notices: 50, links: 30, events: 99, blocks: 60,
  blockText: 4000, blockTitle: 60, url: 2000, pwMin: 4, pwMax: 12, perUser: 20,
};

// 私密日誌與房號規則(可日後調整)。pwMin/pwMax 需落在 4~12(Firebase 規則 jsec.pw 的長度);
// jidLen 要和 js/lib/rules_tj.js 的 JID_LEN 一致(改了兩邊都要改並重貼規則)。
export const JOURNAL_RULES = { pwMin: 4, pwMax: 4, pwDigits: true, jidLen: 10 };
