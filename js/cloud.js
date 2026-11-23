// Google 登入(GIS Token Client)。access token 只存記憶體,不寫 localStorage / IndexedDB。
// 只有使用者按下連線時才即時載入 https://accounts.google.com/gsi/client;未連結雲端時完全不載入任何外部腳本。
import { GOOGLE_CLIENT_ID } from './config.js';

const { CloudGate, Drive } = window;
const GIS_URL = 'https://accounts.google.com/gsi/client';
let token = '', expiresAt = 0, account = '', everConnected = false;
const listeners = new Set();
const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* 不影響功能 */ } };
const emit = () => listeners.forEach(f => { try { f(); } catch (e) { console.warn('cloud listener', e); } });
const readSettings = () => { try { return JSON.parse(lsGet('pt_settings') || '{}'); } catch (_) { return {}; } };

export class CloudError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

export const clientId = () => String(readSettings().googleClientId || '').trim() || GOOGLE_CLIENT_ID;
export const onChange = f => { listeners.add(f); return () => listeners.delete(f); };
export function tokenInfo() { return { token, valid: !!token && Date.now() < expiresAt - 30000 }; }
// 'connected' 已連線 | 'expired' 這次連過但已過期 / 重新開 App 後尚未重新連線 | 'off' 從沒連過
export function status() {
  const v = tokenInfo().valid;
  const wantsDrive = readSettings().mediaStore === 'drive';
  return { state: v ? 'connected' : ((everConnected || wantsDrive) ? 'expired' : 'off'), account, clientId: clientId() };
}
// 「登入前說明」是否已看過(只是旗標,不是密碼;中斷連線時清掉)
export const explainerAcked = () => lsGet('pt_cloud_ack') === '1';
export function acknowledgeExplainer() { lsSet('pt_cloud_ack', '1'); emit(); }
export const gate = () => CloudGate.checkConnect({ clientId: clientId(), explainerAcked: explainerAcked() });

// 即時載入 GIS;已經有(例如測試用的假物件)就直接用;失敗要優雅處理
export function loadGis(timeoutMs) {
  const ready = () => window.google && window.google.accounts && window.google.accounts.oauth2;
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let done = false;
    const fail = msg => { if (done) return; done = true; reject(new CloudError('GIS_LOAD', msg)); };
    const s = document.createElement('script');
    s.src = GIS_URL; s.async = true; s.defer = true;
    s.onload = () => { if (done) return; if (ready()) { done = true; resolve(); } else fail('Google 登入元件載入後無法使用'); };
    s.onerror = () => fail('無法載入 Google 登入元件,請檢查網路後再試');
    setTimeout(() => fail('載入 Google 登入元件逾時,請檢查網路後再試'), timeoutMs || 10000);
    document.head.append(s);
  });
}

async function fetchAccount() {
  account = '';
  try {
    const req = Drive.aboutRequest(token);
    const res = await fetch(req.url, req.init);
    if (res.ok) { const j = await res.json(); const u = j && j.user; account = (u && (u.emailAddress || u.displayName)) || ''; }
  } catch (_) { /* drive.file 取不到就只顯示「已連線」 */ }
}

// 由使用者按鈕觸發。會檢查閘門:沒有用戶端 ID、沒看過登入前說明都不能連線
export async function connect() {
  const g = gate();
  if (!g.ok) throw new CloudError(g.code, g.reason);
  await loadGis();
  await new Promise((resolve, reject) => {
    let client;
    try {
      client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId(), scope: CloudGate.SCOPE,
        callback: resp => {
          if (!resp || resp.error) { reject(new CloudError('AUTH', (resp && (resp.error_description || resp.error)) || '登入失敗')); return; }
          token = resp.access_token; expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000; everConnected = true;
          resolve();
        },
        error_callback: e => reject(new CloudError('AUTH', e && e.type === 'popup_closed' ? '已取消登入' : ((e && (e.message || e.type)) || '登入視窗無法開啟'))),
      });
      client.requestAccessToken({ prompt: '' });
    } catch (e) { reject(new CloudError('AUTH', e.message || '登入失敗')); }
  });
  await fetchAccount();
  emit();
}

// 中斷連線:呼叫 revoke、清記憶體 token、清 UI 狀態;revoke 失敗也要在本機中斷
export async function disconnect() {
  const t = token;
  token = ''; expiresAt = 0; account = ''; everConnected = false;
  lsSet('pt_cloud_ack', null);
  try {
    const oauth2 = window.google && window.google.accounts && window.google.accounts.oauth2;
    if (t && oauth2 && oauth2.revoke) await new Promise(res => { try { oauth2.revoke(t, () => res()); } catch (_) { res(); } setTimeout(res, 3000); });
  } catch (e) { console.warn('revoke 失敗,已在本機中斷', e); }
  emit();
}
