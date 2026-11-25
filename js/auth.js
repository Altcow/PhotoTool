// 旅遊日誌的登入狀態:選後端(Firebase / 模擬 / 未設定)、保存登入(localStorage['tj_auth'])、自動登入、登出、Google 綁定。
// 依賴全域 AuthRest、Policy、RulesTj(js/lib)。連線資訊只來自 config.js。
import { NetError, validDbUrl } from './net.js';
import { createMockStore, createMockAuthFetch } from './net_mock.js';
import { createFirebaseStore } from './net_firebase.js';
import { FIREBASE_DB_URL, FIREBASE_API_KEY, GOOGLE_CLIENT_ID } from './config.js';

const AUTH_KEY = 'tj_auth';
const readSettings = () => { try { return JSON.parse(localStorage.getItem('pt_settings') || '{}'); } catch (_) { return {}; } };
const hash = s => { let h = 5381; s = String(s); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };

// 連線資訊只來自 config.js(由開發端綁好,使用者不需知道,也沒有設定畫面)
export const dbUrl = () => FIREBASE_DB_URL;
export const apiKey = () => FIREBASE_API_KEY;
export const googleClientId = () => GOOGLE_CLIENT_ID;
// 沒有 Google 用戶端 ID 時,畫面上不顯示任何 Google 登入/綁定按鈕(模擬模式例外,方便預覽)
export const googleAvailable = () => mode() === 'mock' || !!googleClientId();
export function mode() {
  if (readSettings().useMock) return 'mock';
  return validDbUrl(dbUrl()) && apiKey() ? 'firebase' : 'none';
}
// 目前後端的指紋:換專案/金鑰/模式後,舊登入不再沿用
const fingerprint = () => mode() + ':' + hash(dbUrl() + '|' + apiKey());

let cache = null;
const listeners = new Set();
export const onAuthChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(f => { try { f(currentSession()); } catch (e) { console.warn(e); } });

function readSession() {
  try {
    const s = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    return s && s.refreshToken && s.apiKeyHash === fingerprint() ? s : null;
  } catch (_) { return null; }
}
function writeSession(s) {
  try { if (s) localStorage.setItem(AUTH_KEY, JSON.stringify(Object.assign({}, s, { apiKeyHash: fingerprint() }))); else localStorage.removeItem(AUTH_KEY); } catch (_) { /* 無法保存時只在本次有效 */ }
}
export const currentSession = () => readSession();

export function getBackend() {
  const m = mode();
  if (cache && cache.mode === m && cache.fp === fingerprint()) return cache;
  if (m === 'none') { cache = { mode: 'none', fp: fingerprint() }; return cache; }
  const store = { get: readSession, set: s => { writeSession(s); } };
  let b;
  if (m === 'mock') {
    const authFetch = createMockAuthFetch({ storage: localStorage });
    const api = window.AuthRest.create({ apiKey: 'mock', fetch: authFetch });
    const mgr = api.manager(store);
    const rules = window.Policy.create(window.RulesTj.build());
    const chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pt-mock') : null;
    b = { mode: m, api, mgr, authFetch, dbStore: createMockStore({ storage: localStorage, channel: chan, rules, getToken: f => mgr.getToken(f) }) };
  } else {
    const api = window.AuthRest.create({ apiKey: apiKey(), requestUri: location.origin });
    const mgr = api.manager(store);
    b = { mode: m, api, mgr, dbStore: createFirebaseStore(dbUrl(), { getToken: f => mgr.getToken(f), tokenExp: () => { const s = readSession(); return s ? s.exp : 0; } }) };
  }
  b.fp = fingerprint();
  cache = b;
  return b;
}
export const resetBackend = () => { cache = null; };

function need() {
  const b = getBackend();
  if (b.mode === 'none') throw new NetError('NO_BACKEND', '服務暫時無法使用,請稍後再試');
  return b;
}
const keep = s => { writeSession(s); emit(); return s; };

export async function register(email, password) { return keep(await need().api.signUp(email.trim(), password)); }
export async function login(email, password) { return keep(await need().api.signIn(email.trim(), password)); }
export async function loginWithGoogle(googleIdToken) { return keep(await need().api.signInWithGoogle(googleIdToken)); }
export async function sendReset(email) { await need().api.sendReset(email.trim()); }
export function logout() { writeSession(null); emit(); }

// 開 App:有登入資料就先當作已登入(畫面用快取),背景換 token;失敗且無法續用 → {dead:true, email}
export async function autoLogin() {
  const s = readSession();
  if (!s) return { session: null };
  if (getBackend().mode === 'none') return { session: null };
  try { await getBackend().mgr.getToken(false); return { session: readSession() }; }
  catch (e) {
    if (e && e.dead) { writeSession(null); emit(); return { session: null, dead: true, email: s.email, message: e.message }; }
    return { session: s, offline: true };   // 沒網路:先用快取畫面
  }
}

// Google 綁定狀態與流程
export async function googleStatus() {
  const s = readSession();
  if (!s) return { google: false };
  try { const tok = await getBackend().mgr.getToken(false); return await getBackend().api.lookup(tok); } catch (e) { return { google: false, error: e.message }; }
}
export async function bindGoogle(googleIdToken) {
  const b = need(), tok = await b.mgr.getToken(false);
  const s = await b.api.signInWithGoogle(googleIdToken, tok);
  const cur = readSession() || {};
  keep(Object.assign({}, cur, { idToken: s.idToken, refreshToken: s.refreshToken, exp: s.exp }));
  return { photoUrl: s.photoUrl, displayName: s.displayName };
}

// 取得 Google id token:模擬模式用 prompt 輸入假 email;正式用 Google Identity Services(未在實機驗證)
let gsiLoading = null;
function loadGsi() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
  if (!gsiLoading) gsiLoading = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true;
    sc.onload = () => resolve(); sc.onerror = () => { gsiLoading = null; reject(new Error('沒有網路,無法開啟 Google 登入')); };
    document.head.append(sc);
  });
  return gsiLoading;
}
export async function getGoogleIdToken() {
  if (mode() === 'mock') {
    const e = window.prompt('(模擬模式)輸入假的 Google 帳號 email', 'demo@gmail.com');
    if (!e) throw new Error('已取消');
    return 'g:' + e.trim();
  }
  const cid = googleClientId();
  if (!cid) throw new Error('暫時無法使用 Google 登入');
  await loadGsi();
  return new Promise((resolve, reject) => {
    window.google.accounts.id.initialize({ client_id: cid, callback: r => (r && r.credential ? resolve(r.credential) : reject(new Error('Google 登入沒有成功,請再試一次'))), cancel_on_tap_outside: true });
    window.google.accounts.id.prompt(n => {
      if (n.isNotDisplayed && n.isNotDisplayed()) reject(new Error('Google 沒有跳出登入畫面,請稍後再試,或改用 email 登入'));
      else if (n.isSkippedMoment && n.isSkippedMoment()) reject(new Error('已取消'));
    });
  });
}
