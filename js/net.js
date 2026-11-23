// 點餐房間的連線邏輯。底層 store 只需實作 get/put/remove/listen(見 net_mock.js、net_firebase.js)
// 路徑:pt/rooms/<code>/{meta, menus/<menuId>, orders/<sNNN>}
export const ROOM_TTL = 24 * 3600 * 1000;
export const MAX_ORDERS = 200;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class NetError extends Error {
  constructor(code, msg) { super(msg || code); this.code = code; }
}

export const isRoomCode = c => /^[A-HJ-NP-Z2-9]{6}$/.test(String(c || ''));
export function genCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}
export function genToken() {
  const a = new Uint8Array(16);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256Hex(s) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) throw new NetError('NO_CRYPTO', '此環境不支援加密功能(需要 https 或 localhost)');
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}
// 資料庫網址:只接受 Firebase 網域或本機模擬器,避免連結把訂單送去陌生主機
export function validDbUrl(u) {
  try {
    const x = new URL(String(u || '').trim());
    if (x.protocol === 'https:' && /(\.firebaseio\.com|\.firebasedatabase\.app)$/.test(x.hostname)) return true;
    return x.protocol === 'http:' && (x.hostname === 'localhost' || x.hostname === '127.0.0.1');
  } catch (_) { return false; }
}
// 'open' | 'closed' | 'expired' | 'deadline' | 'missing'
export function roomStatus(meta, now = Date.now()) {
  if (!meta) return 'missing';
  if (meta.status === 'closed') return 'closed';
  if (now > Number(meta.createdAt || 0) + ROOM_TTL) return 'expired';
  if (meta.deadline && now > Number(meta.deadline)) return 'deadline';
  return 'open';
}
export const STATUS_TEXT = { open: '開放點餐', closed: '已結單', expired: '此團已過期', deadline: '已過截止時間', missing: '找不到這個團' };
// 訂單 id 用固定 200 個格子(s001~s200),讓資料庫規則能限制單房筆數
export function allocId(usedIds, rand = Math.random) {
  const used = new Set(usedIds);
  const free = [];
  for (let i = 1; i <= MAX_ORDERS; i++) { const id = 's' + String(i).padStart(3, '0'); if (!used.has(id)) free.push(id); }
  if (!free.length) throw new NetError('FULL', '這個團的訂單已達上限(' + MAX_ORDERS + ' 筆)');
  return free[Math.floor(rand() * free.length)];
}

const rp = code => 'pt/rooms/' + code;
const vals = o => (o && typeof o === 'object' ? Object.keys(o).map(k => o[k]) : []);

export function makeNet(store, clock = () => Date.now()) {
  async function getMeta(code) {
    if (!isRoomCode(code)) throw new NetError('BAD_CODE', '房號格式不正確');
    const meta = await store.get(rp(code) + '/meta');
    if (!meta) throw new NetError('NOT_FOUND', '找不到這個團');
    return meta;
  }
  async function assertHost(code, token) {
    const meta = await getMeta(code);
    if (!token || (await sha256Hex(token)) !== meta.hostHash) throw new NetError('FORBIDDEN', '只有發起人可以這樣做');
    return meta;
  }
  async function assertOpen(code) {
    const meta = await getMeta(code);
    const st = roomStatus(meta, clock());
    if (st !== 'open') throw new NetError(st.toUpperCase(), STATUS_TEXT[st]);
    return meta;
  }
  const mapState = v => {
    if (!v || !v.meta) return { exists: false, meta: null, menus: [], orders: [], status: 'missing' };
    const orders = Object.keys(v.orders || {}).map(k => Object.assign({}, v.orders[k], { id: k })).sort((a, b) => (a.ts - b.ts) || (a.id < b.id ? -1 : 1));
    return { exists: true, meta: v.meta, menus: vals(v.menus), orders, status: roomStatus(v.meta, clock()) };
  };
  return {
    // fields: {title, plannedAt, location, hostName, deadline, mergeMode};menus: 已快照的菜單陣列
    async createRoom(fields, menus, hostToken) {
      const hostHash = await sha256Hex(hostToken);
      let code = null;
      for (let i = 0; i < 8 && !code; i++) { const c = genCode(); if (!(await store.get(rp(c) + '/meta'))) code = c; }
      if (!code) throw new NetError('CODE', '產生房號失敗,請重試');
      const meta = Object.assign({}, fields, { createdAt: clock(), status: 'open', hostHash });
      Object.keys(meta).forEach(k => { if (meta[k] === '' || meta[k] === undefined || meta[k] === null) delete meta[k]; });
      await store.put(rp(code) + '/meta', meta);
      for (const m of menus) await store.put(rp(code) + '/menus/' + m.id, m);
      return { code, meta };
    },
    async joinRoom(code) {
      const meta = await getMeta(code);
      const menus = vals(await store.get(rp(code) + '/menus'));
      return { code, meta, menus, status: roomStatus(meta, clock()) };
    },
    subscribe(code, cb, onError) { return store.listen(rp(code), v => cb(mapState(v)), onError || (() => {})); },
    // 新杯(無 id)會配一個空格;改既有杯需同 clientId
    async putOrder(code, order) {
      await assertOpen(code);
      const o = Object.assign({}, order);
      if (!o.id) {
        const have = Object.keys((await store.get(rp(code) + '/orders')) || {});
        o.id = allocId(have);
      } else {
        const cur = await store.get(rp(code) + '/orders/' + o.id);
        if (cur && cur.clientId !== o.clientId) throw new NetError('FORBIDDEN', '不能修改別人的訂單');
      }
      o.ts = o.ts || clock();
      await store.put(rp(code) + '/orders/' + o.id, o);
      return o;
    },
    async deleteOrder(code, orderId, who) {
      await assertOpen(code);
      const cur = await store.get(rp(code) + '/orders/' + orderId);
      if (!cur) return;
      if (!who || cur.clientId !== who.clientId) await assertHost(code, who && who.hostToken);
      await store.remove(rp(code) + '/orders/' + orderId);
    },
    async closeRoom(code, hostToken) { await assertHost(code, hostToken); await store.put(rp(code) + '/meta/status', 'closed'); },
    // 發起人補品項/改菜單(整份覆蓋該菜單)
    async putMenu(code, menu, hostToken) { await assertHost(code, hostToken); await assertOpen(code); await store.put(rp(code) + '/menus/' + menu.id, menu); },
    // 發起人改團名/地點/計畫時間/截止時間;值為空就刪除該欄位(團名不可空)。結單後不可改
    async updateMeta(code, fields, hostToken) {
      await assertHost(code, hostToken); await assertOpen(code);
      const allowed = ['title', 'location', 'plannedAt', 'deadline'];
      for (const k of Object.keys(fields)) {
        if (!allowed.includes(k)) throw new NetError('BAD_FIELD', '不能修改 ' + k);
        const v = fields[k];
        if (k === 'title' && !String(v || '').trim()) throw new NetError('BAD_VALUE', '團名不可空白');
        if (v === '' || v === null || v === undefined) await store.remove(rp(code) + '/meta/' + k);
        else await store.put(rp(code) + '/meta/' + k, v);
      }
    },
    async deleteRoom(code) { await store.remove(rp(code)); },
    roomStatus: meta => roomStatus(meta, clock()),
  };
}
