// 旅遊日誌的資料存取(RTDB 前綴 tj/)。store 只需實作 get/put/patch/remove/listen(net_mock.js、net_firebase.js)。
// 依賴全域 Journal(js/lib/journal.js)。getMe() 回傳 {uid, name}。
import { NetError } from './net.js';

const SV = { '.sv': 'timestamp' };
const ROOT = 'tj';

export function makeJournalNet(store, getMe, clock = () => Date.now()) {
  const J = () => globalThis.Journal;
  const me = () => { const m = getMe(); if (!m || !m.uid) throw new NetError('NO_LOGIN', '請先登入'); return m; };
  const keys = o => Object.keys(o || {});
  const clean = o => { const r = {}; keys(o).forEach(k => { if (o[k] !== undefined && o[k] !== null && o[k] !== '') r[k] = o[k]; }); return r; };
  const jpath = (jid, rest) => ROOT + '/j/' + jid + (rest ? '/' + rest : '');

  // 多個監聽合併:任一變動就回傳 {name: value}(全部都回來過一次才開始回報)
  function combine(specs, cb, onError) {
    const state = {}, got = {};
    const offs = specs.map(sp => store.listen(sp.path, v => {
      state[sp.name] = v; got[sp.name] = true;
      if (specs.every(s => got[s.name] || s.optionalFail && got[s.name] === false)) cb(Object.assign({}, state));
    }, e => {
      if (sp.soft && e && e.code === 'PERMISSION') { state[sp.name] = null; got[sp.name] = true; state[sp.name + 'Denied'] = true; if (specs.every(s => got[s.name])) cb(Object.assign({}, state)); return; }
      if (onError) onError(e, sp.name);
    }));
    return () => offs.forEach(o => o && o());
  }

  const api = {
    // ---- 個人檔案 ----
    async getProfile(uid) { return store.get(ROOT + '/users/' + uid + '/profile'); },
    async ensureProfile(fallbackName) {
      const m = me(), p = await store.get(ROOT + '/users/' + m.uid + '/profile');
      if (p && p.name) return p;
      const v = J().validName(fallbackName || '旅人');
      const name = v.ok ? v.value : '旅人';
      await store.put(ROOT + '/users/' + m.uid + '/profile', { name, createdAt: SV });
      return { name };
    },
    async saveProfile(fields) {
      const m = me(), p = ROOT + '/users/' + m.uid + '/profile', upd = {};
      if (fields.name !== undefined) {
        const v = J().validName(fields.name);
        if (!v.ok) throw new NetError('BAD_VALUE', v.msg);
        upd.name = v.value;
      }
      if (fields.avatar !== undefined) {
        const v = J().validAvatar(fields.avatar);
        if (!v.ok) throw new NetError('BAD_VALUE', v.msg);
        upd.avatar = fields.avatar;
      }
      await store.patch(p, upd);
      if (upd.name) {
        // 同步我在各日誌的成員名稱(訂單不改);失敗不影響改名
        const idx = (await store.get(ROOT + '/users/' + m.uid + '/idx')) || {};
        const w = {};
        keys(idx).forEach(jid => { w['jmem/' + jid + '/' + m.uid + '/name'] = upd.name; });
        if (keys(w).length) { try { await store.patch(ROOT, w); } catch (_) { /* 例如已被移出 */ } }
      }
      return upd;
    },

    // ---- 首頁清單 ----
    subscribeHome(cb, onError) {
      const m = me();
      return combine([
        { name: 'idx', path: ROOT + '/users/' + m.uid + '/idx' },
        { name: 'dir', path: ROOT + '/dir' },
        { name: 'follows', path: ROOT + '/users/' + m.uid + '/follows' },
      ], v => cb({ idx: v.idx || {}, dir: v.dir || {}, follows: v.follows || {} }), onError);
    },

    // ---- 建立 / 加入 / 刪除 ----
    async createJournal(f) {
      const m = me();
      const err = J().validateJournalForm(f);
      if (err) throw new NetError('BAD_VALUE', err);
      const vis = f.vis === 'private' ? 'private' : 'public';
      let jid = null;
      for (let i = 0; i < 8 && !jid; i++) { const c = J().genJid(); if (!(await store.get(ROOT + '/jmeta/' + c))) jid = c; }
      if (!jid) throw new NetError('CODE', '產生日誌代碼失敗,請重試');
      const title = f.title.trim();
      const meta = clean({ title, ownerUid: m.uid, ownerName: m.name, vis, start: f.start, end: f.end, tz: f.tz, createdAt: SV, updatedAt: SV, schema: 1, calendarRev: 1 });
      await store.put(ROOT + '/jmeta/' + jid, meta);
      const inv = { code: J().genInviteCode(), exp: clock() + J().INVITE_TTL };
      const w = {};
      w['jmem/' + jid + '/' + m.uid] = { name: m.name, role: 'owner', joinedAt: SV, via: 'create' };
      if (f.listed !== false) w['dir/' + jid] = clean({ title, ownerName: m.name, vis, start: f.start, end: f.end, updatedAt: SV });
      w['jsec/' + jid + '/inv'] = inv;
      w['users/' + m.uid + '/idx/' + jid] = clean({ role: 'owner', title, start: f.start, at: clock() });
      await store.patch(ROOT, w);
      return { jid, inv };
    },
    async joinPublic(jid, meta) {
      const m = me();
      await store.put(ROOT + '/jmem/' + jid + '/' + m.uid, { name: m.name, role: 'member', joinedAt: SV, via: 'public' });
      await store.put(ROOT + '/users/' + m.uid + '/idx/' + jid, clean({ role: 'member', title: meta.title, start: meta.start, at: clock() }));
    },
    async leave(jid) {
      const m = me();
      await store.remove(ROOT + '/jmem/' + jid + '/' + m.uid);
      await store.remove(ROOT + '/users/' + m.uid + '/idx/' + jid);
    },
    async removeFromList(jid) { const m = me(); await store.patch(ROOT, { ['users/' + m.uid + '/idx/' + jid]: null, ['users/' + m.uid + '/follows/' + jid]: null }); },
    // ---- 追蹤 ----
    watchFollow(jid, cb, onError) { const m = me(); return store.listen(ROOT + '/users/' + m.uid + '/follows/' + jid, v => cb(!!v), onError); },
    async follow(jid, meta) { const m = me(); await store.put(ROOT + '/users/' + m.uid + '/follows/' + jid, clean({ title: meta.title, start: meta.start, at: clock() })); },
    async unfollow(jid) { const m = me(); await store.remove(ROOT + '/users/' + m.uid + '/follows/' + jid); },
    async deleteJournal(jid) {
      const m = me(), w = {};
      ['j', 'jm', 'jmem', 'jban', 'jreq', 'jtry', 'jkeys', 'jsec', 'dir', 'jmeta'].forEach(k => { w[k + '/' + jid] = null; });
      w['users/' + m.uid + '/idx/' + jid] = null; w['users/' + m.uid + '/follows/' + jid] = null;
      await store.patch(ROOT, w);
    },
    // 開團日期/標題(設定頁):變動時 calendarRev+1、舊區間存 prevRange
    async updateJournalMeta(jid, cur, f) {
      const m = me();
      const err = J().validateJournalForm(f);
      if (err) throw new NetError('BAD_VALUE', err);
      const title = f.title.trim(), start = f.start || '', end = f.end || '';
      const w = { ['jmeta/' + jid + '/title']: title, ['jmeta/' + jid + '/start']: start || null, ['jmeta/' + jid + '/end']: end || null, ['jmeta/' + jid + '/updatedAt']: SV };
      if (title !== cur.title || start !== (cur.start || '') || end !== (cur.end || '')) {
        w['jmeta/' + jid + '/calendarRev'] = (Number(cur.calendarRev) || 1) + 1;
        if (cur.start && cur.end) w['jmeta/' + jid + '/prevRange'] = { start: cur.start, end: cur.end };
      }
      w['dir/' + jid + '/title'] = title; w['dir/' + jid + '/start'] = start || null; w['dir/' + jid + '/end'] = end || null; w['dir/' + jid + '/updatedAt'] = SV;
      w['users/' + m.uid + '/idx/' + jid + '/title'] = title; w['users/' + m.uid + '/idx/' + jid + '/start'] = start || null;
      const inDir = await store.get(ROOT + '/dir/' + jid);
      if (!inDir) { ['title', 'start', 'end', 'updatedAt'].forEach(k => { delete w['dir/' + jid + '/' + k]; }); }
      await store.patch(ROOT, w);
    },

    // ---- 邀請連結(P1:公開日誌;代碼存在 jsec/<jid>/inv,主編重新產生=舊連結失效)----
    async getInvite(jid) { return store.get(ROOT + '/jsec/' + jid + '/inv'); },
    async regenInvite(jid) {
      const inv = { code: J().genInviteCode(), exp: clock() + J().INVITE_TTL };
      await store.put(ROOT + '/jsec/' + jid + '/inv', inv);
      return inv;
    },

    // ---- 單本日誌訂閱 ----
    // 回傳 {meta, j, members, membersDenied}。j 被拒(私密非成員)→ onError(PERMISSION)
    subscribeJournal(jid, cb, onError) {
      return combine([
        { name: 'meta', path: ROOT + '/jmeta/' + jid },
        { name: 'j', path: ROOT + '/j/' + jid },
        { name: 'members', path: ROOT + '/jmem/' + jid, soft: true },
      ], v => cb({ meta: v.meta, j: v.j || {}, members: v.members || null, membersDenied: !!v.membersDenied }), onError);
    },

    // ---- 內容 CRUD(編輯權限由規則擋;這裡只管資料格式)----
    async readUpdatedAt(rest) { const v = await store.get(ROOT + '/' + rest + '/updatedAt'); return v == null ? 0 : v; },
    async saveAbout(jid, f) {
      const m = me();
      const e = J().checkLen('宗旨', f.text, J().LIM.about) || J().checkLen('領隊', f.leader, J().LIM.leader) || J().checkLen('電話', f.phone, J().LIM.phone);
      if (e) throw new NetError('BAD_VALUE', e);
      await store.put(jpath(jid, 'about'), { text: f.text || '', leader: f.leader || '', phone: f.phone || '', updatedAt: SV, updatedBy: m.uid });
    },
    async addNotice(jid, f) {
      const m = me();
      const e = J().checkLen('標題', f.title, 60, true) || J().checkLen('內容', f.body, J().LIM.noticeBody);
      if (e) throw new NetError('BAD_VALUE', e);
      const cur = (await store.get(jpath(jid, 'notices'))) || {};
      const id = J().allocSlot('notice', keys(cur));
      if (!id) throw new NetError('FULL', '公告已達上限(' + J().slotMax('notice') + ' 則)');
      await store.put(jpath(jid, 'notices/' + id), { title: f.title.trim(), body: f.body || '', pinned: !!f.pinned, order: J().nextOrder(cur), at: clock(), by: m.uid });
      return id;
    },
    async updateNotice(jid, id, f) {
      const e = J().checkLen('標題', f.title, 60, true) || J().checkLen('內容', f.body, J().LIM.noticeBody);
      if (e) throw new NetError('BAD_VALUE', e);
      await store.patch(jpath(jid, 'notices/' + id), { title: f.title.trim(), body: f.body || '', pinned: !!f.pinned, updatedAt: SV });
    },
    async deleteNotice(jid, id) { await store.remove(jpath(jid, 'notices/' + id)); },
    async addEvent(jid, f) {
      const m = me();
      const e = J().checkLen('事件標題', f.title, 60, true);
      if (e) throw new NetError('BAD_VALUE', e);
      if (f.date && !J().isDate(f.date)) throw new NetError('BAD_VALUE', '日期格式不對');
      const cur = (await store.get(jpath(jid, 'events'))) || {};
      const id = J().allocSlot('event', keys(cur));
      if (!id) throw new NetError('FULL', '事件已達上限(' + J().slotMax('event') + ' 個)');
      await store.put(jpath(jid, 'events/' + id), clean({ title: f.title.trim(), date: f.date, order: J().nextOrder(cur), createdAt: clock(), by: m.uid }));
      return id;
    },
    async updateEvent(jid, id, f) {
      const e = J().checkLen('事件標題', f.title, 60, true);
      if (e) throw new NetError('BAD_VALUE', e);
      if (f.date && !J().isDate(f.date)) throw new NetError('BAD_VALUE', '日期格式不對');
      await store.patch(jpath(jid, 'events/' + id), { title: f.title.trim(), date: f.date || null, updatedAt: SV });
    },
    async deleteEvent(jid, id) { await store.patch(ROOT, { ['j/' + jid + '/events/' + id]: null, ['j/' + jid + '/blocks/' + id]: null }); },
    // 區塊:type 'text'(text)或 'nav'(title+url)
    async addBlock(jid, eid, f) {
      const m = me();
      const b = checkBlock(f);
      const cur = (await store.get(jpath(jid, 'blocks/' + eid))) || {};
      const id = J().allocSlot('block', keys(cur));
      if (!id) throw new NetError('FULL', '這個事件的內容已達上限(' + J().slotMax('block') + ' 個)');
      await store.put(jpath(jid, 'blocks/' + eid + '/' + id), Object.assign(b, { order: J().nextOrder(cur), updatedAt: SV, by: m.uid }));
      return id;
    },
    async updateBlock(jid, eid, bid, f) {
      const b = checkBlock(f);
      const p = 'blocks/' + eid + '/' + bid;
      const w = {};
      ['text', 'title', 'url'].forEach(k => { w[k] = b[k] === undefined ? null : b[k]; });
      w.updatedAt = SV;
      await store.patch(jpath(jid, p), w);
    },
    async deleteBlock(jid, eid, bid) { await store.remove(jpath(jid, 'blocks/' + eid + '/' + bid)); },
    // 上移/下移:path 例如 'notices'、'events'、'blocks/e001';map 是該層目前資料
    async moveItem(jid, path, map, id, dir) {
      const s = J().swapOrder(map, id, dir);
      if (!s) return false;
      await store.patch(ROOT, { ['j/' + jid + '/' + path + '/' + s.a.id + '/order']: s.a.order, ['j/' + jid + '/' + path + '/' + s.b.id + '/order']: s.b.order });
      return true;
    },
  };

  function checkBlock(f) {
    const L = J().LIM;
    if (f.type === 'nav') {
      const e = J().checkLen('標題', f.title, L.blockTitle, true);
      if (e) throw new NetError('BAD_VALUE', e);
      if (!J().isHttpsUrl(String(f.url || '').trim())) throw new NetError('BAD_VALUE', '請貼上完整的網址(https:// 開頭)');
      return { type: 'nav', title: f.title.trim(), url: f.url.trim() };
    }
    const e = J().checkLen('文字', f.text, L.blockText, true);
    if (e) throw new NetError('BAD_VALUE', e);
    return { type: 'text', text: f.text };
  }
  return api;
}
