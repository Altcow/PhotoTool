// 取得目前要用的連線後端:測試模式(假後端)或使用者自己的 Firebase 網址
import { makeNet, validDbUrl, NetError } from './net.js';
import { createMockStore } from './net_mock.js';
import { createFirebaseStore } from './net_firebase.js';
import { FIREBASE_DB_URL } from './config.js';

let mockStore = null;
const readSettings = () => { try { return JSON.parse(localStorage.getItem('pt_settings') || '{}'); } catch (_) { return {}; } };
export const configuredDbUrl = () => (readSettings().dbUrl || '').trim() || FIREBASE_DB_URL;
export const mockOn = forced => !!forced || !!readSettings().useMock;
// 開團前提用:有可用的後端(測試模式或合法的資料庫網址)
export const hasBackend = () => mockOn() || validDbUrl(configuredDbUrl());

export function getNet(opts) {
  opts = opts || {};
  if (mockOn(opts.mock)) {
    if (!mockStore) mockStore = createMockStore({ storage: localStorage, channel: typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pt-mock') : null });
    return { net: makeNet(mockStore), mode: 'mock', dbUrl: '' };
  }
  const url = (opts.db || configuredDbUrl() || '').trim();
  if (!url || !validDbUrl(url)) throw new NetError('NO_DB', '需設定資料庫網址(設定頁)');
  return { net: makeNet(createFirebaseStore(url)), mode: 'firebase', dbUrl: url };
}

// 分享連結:資料庫網址只放主機名稱(省長度,QR 較好掃);測試模式帶 mock=1
export function roomUrl(code, ctx) {
  const base = location.origin + location.pathname;
  let u = base + '?room=' + code;
  if (ctx.mode === 'mock') u += '&mock=1';
  else if (ctx.dbUrl) u += '&db=' + encodeURIComponent(ctx.dbUrl.replace(/^https:\/\//, '').replace(/\/+$/, ''));
  return u;
}
export function parseRoomParams(search) {
  const p = new URLSearchParams(search);
  const code = (p.get('room') || '').trim().toUpperCase();
  if (!code) return null;
  let db = (p.get('db') || '').trim();
  if (db && !/^https?:\/\//.test(db)) db = 'https://' + db;
  return { code, db, mock: p.get('mock') === '1' };
}
