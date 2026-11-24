// 資料庫網址不內建(不得使用他人專案)。要預設某個網址時填這裡;一般由「設定」頁輸入並存在本機。
export const FIREBASE_DB_URL = 'https://my-travel-journal-b22b3-default-rtdb.asia-southeast1.firebasedatabase.app';

// Google OAuth 用戶端 ID(公開識別碼,不是密碼)。不內建、不使用他人的專案;一般由「設定」頁輸入並存在本機。
export const GOOGLE_CLIENT_ID = '';

// Firebase 網頁 API 金鑰(AIza…,官方說明不是秘密)。不內建、不使用他人專案;未填時登入頁會顯示設定提示。設定頁可覆寫。
export const FIREBASE_API_KEY = 'AIzaSyBDpANM0gcGtxzd6lzLQPfjfBbtqMzjTIc';

// 功能旗標預設值(旅遊日誌 v10)。覆寫:網址 ?flags=+camera,-ai 或 localStorage['pt_flags']
export const FEATURES = {
  journal: true, camera: false, ai: false, excel: false, calc: false,
  ledger: false, stats: false, files: false, trips: false, room: false, cloud: false, drivePreview: true,
  lineShare: false, calendar: false, sketch: false, phrases: false, settle: false, driveUpload: false,
};

// 日誌容量與長度上限(與 tools/rules 一致)
export const JOURNAL_LIMITS = {
  title: 60, name: 30, about: 2000, leader: 30, phone: 30, noticeBody: 2000, notices: 50, links: 30, events: 99, blocks: 60,
  blockText: 4000, blockTitle: 60, url: 2000, pwMin: 4, pwMax: 12, perUser: 20,
};
