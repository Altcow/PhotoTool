// 旅遊日誌的資料存取(RTDB 前綴 tj/)。store 只需實作 get/put/patch/remove/listen(net_mock.js、net_firebase.js)。
// 依賴全域 Journal(js/lib/journal.js)。getMe() 回傳 {uid, name}。
import { NetError, sha256Hex } from './net.js';

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
    }, sp.poll ? { poll: true } : undefined));
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
        { name: 'dir', path: ROOT + '/dir', poll: true },
        { name: 'follows', path: ROOT + '/users/' + m.uid + '/follows', poll: true },
      ], v => cb({ idx: v.idx || {}, dir: v.dir || {}, follows: v.follows || {} }), onError);
    },

    // ---- 建立 / 加入 / 刪除 ----
    async createJournal(f, o) {
      const m = me();
      const err = J().validateJournalForm(f);
      if (err) throw new NetError('BAD_VALUE', err);
      const vis = f.vis === 'private' ? 'private' : 'public';
      if (vis === 'private') { const pe = J().validPw(f.pw); if (pe) throw new NetError('BAD_VALUE', pe); }
      let jid = o && o.jid || null;
      for (let i = 0; i < 8 && !jid; i++) { const c = J().genJid(); if (!(await store.get(ROOT + '/jmeta/' + c))) jid = c; }
      if (!jid) throw new NetError('CODE', '產生日誌代碼失敗,請重試');
      if (o) o.jid = jid;
      const title = f.title.trim();
      const meta = clean({ title, ownerUid: m.uid, ownerName: m.name, vis, start: f.start, end: f.end, tz: f.tz, createdAt: SV, updatedAt: SV, schema: 1, calendarRev: 1 });
      if (!(o && o.created)) { const ex = await store.get(ROOT + '/jmeta/' + jid); if (!(ex && ex.ownerUid === m.uid)) await store.put(ROOT + '/jmeta/' + jid, meta); }
      if (o) o.created = true;
      if (o && o.retry) { const done = await store.get(ROOT + '/users/' + m.uid + '/idx/' + jid); if (done) return { jid, inv: (await store.get(ROOT + '/jsec/' + jid + '/inv').catch(() => null)) || null }; }   // 上一次逾時其實已建好
      if (o) o.retry = true;
      const inv = { code: J().genInviteCode(), exp: clock() + J().INVITE_TTL };
      const w = {};
      w['jmem/' + jid + '/' + m.uid] = { name: m.name, role: 'owner', joinedAt: SV, via: 'create' };
      if (f.listed !== false) w['dir/' + jid] = clean({ title, ownerName: m.name, vis, start: f.start, end: f.end, updatedAt: SV });
      w['jsec/' + jid + '/inv'] = inv;
      if (vis === 'private') { w['jsec/' + jid + '/pw'] = f.pw; w['jkeys/' + jid + '/' + (await sha256Hex(J().pwHashInput(jid, f.pw)))] = { at: clock() }; }
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
    watchFollow(jid, cb, onError) { const m = me(); return store.listen(ROOT + '/users/' + m.uid + '/follows/' + jid, v => cb(!!v), onError, { poll: true }); },
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
      const about = { text: f.text || '', leader: f.leader || '', phone: f.phone || '', updatedAt: SV, updatedBy: m.uid };
      if (f.leaderUid) about.leaderUid = f.leaderUid;
      try { await store.put(jpath(jid, 'about'), about); return { degraded: false }; }
      catch (e) {
        // 舊規則(尚未貼新版)沒有 leaderUid 欄位 → 退回只存領隊名字,並讓畫面提示
        if (e && e.code === 'PERMISSION' && about.leaderUid) { delete about.leaderUid; await store.put(jpath(jid, 'about'), about); return { degraded: true }; }
        throw e;
      }
    },
    async addNotice(jid, f, o) {
      const m = me();
      const e = J().checkLen('標題', f.title, 60, true) || J().checkLen('內容', f.body, J().LIM.noticeBody);
      if (e) throw new NetError('BAD_VALUE', e);
      return createSlot('notice', 'notices', jid, o, sl => ({ title: f.title.trim(), body: f.body || '', pinned: !!f.pinned, order: sl.order, at: sl.at, by: m.uid }), '公告已達上限(' + J().slotMax('notice') + ' 則)');
    },
    async updateNotice(jid, id, f) {
      const e = J().checkLen('標題', f.title, 60, true) || J().checkLen('內容', f.body, J().LIM.noticeBody);
      if (e) throw new NetError('BAD_VALUE', e);
      await store.patch(jpath(jid, 'notices/' + id), { title: f.title.trim(), body: f.body || '', pinned: !!f.pinned, updatedAt: SV });
    },
    async deleteNotice(jid, id) { await store.remove(jpath(jid, 'notices/' + id)); },
    async addEvent(jid, f, o) {
      const m = me();
      const e = J().checkLen('事件標題', f.title, 60, true);
      if (e) throw new NetError('BAD_VALUE', e);
      if (f.date && !J().isDate(f.date)) throw new NetError('BAD_VALUE', '日期格式不對');
      return createSlot('event', 'events', jid, o, sl => clean({ title: f.title.trim(), date: f.date, order: sl.order, createdAt: sl.at, by: m.uid }), '事件已達上限(' + J().slotMax('event') + ' 個)');
    },
    async updateEvent(jid, id, f) {
      const e = J().checkLen('事件標題', f.title, 60, true);
      if (e) throw new NetError('BAD_VALUE', e);
      if (f.date && !J().isDate(f.date)) throw new NetError('BAD_VALUE', '日期格式不對');
      await store.patch(jpath(jid, 'events/' + id), { title: f.title.trim(), date: f.date || null, updatedAt: SV });
    },
    async deleteEvent(jid, id) { await store.patch(ROOT, { ['j/' + jid + '/events/' + id]: null, ['j/' + jid + '/blocks/' + id]: null }); },
    // 區塊:type 'text'(text)或 'nav'(title+url)
    async addBlock(jid, eid, f, o) {
      const m = me();
      const b = checkBlock(f);
      return createSlot('block', 'blocks/' + eid, jid, o, sl => Object.assign({}, b, { order: sl.order, updatedAt: SV, by: m.uid }), '這個事件的內容已達上限(' + J().slotMax('block') + ' 個)');
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
    // ---- 私密日誌:加入、密碼、成員管理(P2)----
    getMeta(jid) { return store.get(ROOT + '/jmeta/' + jid); },
    async amBanned(jid) { const m = me(); return !!(await store.get(ROOT + '/jban/' + jid + '/' + m.uid)); },
    async myTries(jid) { const m = me(); return store.get(ROOT + '/jtry/' + jid + '/' + m.uid); },
    // 先寫 jtry 登記嘗試(規則:每小時 5 次),再用雜湊寫成員;密碼不對 → code 'BAD_PW'(帶 left=還可以試幾次);滿 5 次 → 'TOO_MANY'
    async joinWithPassword(jid, meta, pw) {
      const m = me(), L = J();
      const pe = L.validPw(pw);
      if (pe) throw new NetError('BAD_VALUE', pe);
      const key = await sha256Hex(L.pwHashInput(jid, pw));
      const cur = await store.get(ROOT + '/jtry/' + jid + '/' + m.uid), now = clock();
      const tooMany = () => { const x = new NetError('TOO_MANY', '嘗試太多次,1 小時後再試,或請主編直接加你'); x.left = 0; return x; };
      if (L.triesLeft(cur, now) <= 0) throw tooMany();
      try { await store.put(ROOT + '/jtry/' + jid + '/' + m.uid, { n: L.nextTryN(cur, now), ts: SV, key }); }
      catch (e) { if (e && e.code === 'PERMISSION') throw tooMany(); throw e; }
      try { await store.put(ROOT + '/jmem/' + jid + '/' + m.uid, { name: m.name, role: 'member', joinedAt: SV, via: 'pw', jk: key }); }
      catch (e) {
        if (e && e.code === 'PERMISSION') {
          const left = L.triesLeft({ n: L.nextTryN(cur, now), ts: now }, now);
          const x = new NetError('BAD_PW', left > 0 ? '密碼不對(還可以試 ' + left + ' 次)' : '密碼不對。嘗試太多次,1 小時後再試,或請主編直接加你'); x.left = left; throw x;
        }
        throw e;
      }
      await store.put(ROOT + '/users/' + m.uid + '/idx/' + jid, clean({ role: 'member', title: meta.title, start: meta.start, at: clock() }));
    },
    // 身分與首頁索引不同步時補上(例如被主編加回、改成副編後),只寫自己的 idx
    async syncIdx(jid, meta, role) {
      const m = me();
      await store.put(ROOT + '/users/' + m.uid + '/idx/' + jid, clean({ role, title: meta.title, start: meta.start, at: clock() }));
    },
    getSecret(jid) { return store.get(ROOT + '/jsec/' + jid); },
    async changePassword(jid, pw) {
      const pe = J().validPw(pw);
      if (pe) throw new NetError('BAD_VALUE', pe);
      const key = await sha256Hex(J().pwHashInput(jid, pw));
      // 一次換掉全部 key(舊密碼立刻失效),現有成員不受影響
      await store.patch(ROOT, { ['jkeys/' + jid]: { [key]: { at: clock() } }, ['jsec/' + jid + '/pw']: pw });
    },
    // 公開 <-> 私密;改私密要給新密碼;改公開會清掉密碼與 keys
    async setVisibility(jid, vis, pw) {
      me();
      const w = { ['jmeta/' + jid + '/vis']: vis, ['jmeta/' + jid + '/updatedAt']: SV };
      if (vis === 'private') {
        const pe = J().validPw(pw);
        if (pe) throw new NetError('BAD_VALUE', pe);
        w['jkeys/' + jid] = { [await sha256Hex(J().pwHashInput(jid, pw))]: { at: clock() } };
        w['jsec/' + jid + '/pw'] = pw;
      } else { w['jkeys/' + jid] = null; w['jsec/' + jid + '/pw'] = null; }
      if (await store.get(ROOT + '/dir/' + jid)) { w['dir/' + jid + '/vis'] = vis; w['dir/' + jid + '/updatedAt'] = SV; }
      await store.patch(ROOT, w);
    },
    async setRole(jid, uid, role) {
      if (role !== 'member' && role !== 'editor') throw new NetError('BAD_VALUE', '角色不對');
      await store.patch(ROOT, { ['jmem/' + jid + '/' + uid + '/role']: role, ['jreq/' + jid + '/' + uid]: null });
    },
    // 移除=一律封鎖:被移除者不能憑(新)密碼或公開加入回來,主編要「加回」(D-01)
    async removeMember(jid, uid, name) {
      await store.patch(ROOT, { ['jmem/' + jid + '/' + uid]: null, ['jban/' + jid + '/' + uid]: { name: String(name || '成員').slice(0, 30), at: clock() }, ['jreq/' + jid + '/' + uid]: null });
    },
    async addBack(jid, uid, name) {
      await store.patch(ROOT, { ['jmem/' + jid + '/' + uid]: { name: String(name || '成員').slice(0, 30), role: 'member', joinedAt: SV, via: 'owner' }, ['jban/' + jid + '/' + uid]: null });
    },
    listBans(jid) { return store.get(ROOT + '/jban/' + jid); },
    listReqs(jid) { return store.get(ROOT + '/jreq/' + jid); },
    myReq(jid) { const m = me(); return store.get(ROOT + '/jreq/' + jid + '/' + m.uid); },
    async requestEditor(jid) {
      const m = me();
      await store.put(ROOT + '/jreq/' + jid + '/' + m.uid, { name: String(m.name || '成員').slice(0, 30), at: SV, kind: 'editor' });
    },
    async rejectReq(jid, uid) { await store.remove(ROOT + '/jreq/' + jid + '/' + uid); },
    // 上移/下移:path 例如 'notices'、'events'、'blocks/e001';map 是該層目前資料
    async moveItem(jid, path, map, id, dir) {
      const s = J().swapOrder(map, id, dir);
      if (!s) return false;
      await store.patch(ROOT, { ['j/' + jid + '/' + path + '/' + s.a.id + '/order']: s.a.order, ['j/' + jid + '/' + path + '/' + s.b.id + '/order']: s.b.order });
      return true;
    },
  };

  // 新增類動作:第一次就決定格子 id 與 order,存在 o 裡;逾時重試沿用同一個 id,不會重複新增
  async function plan(kind, path, jid, o, fullMsg) {
    o = o || {};
    if (!o.id) {
      const cur = o.cur || (await store.get(jpath(jid, path))) || {};
      const id = J().allocSlot(kind, keys(cur));
      if (!id) throw new NetError('FULL', fullMsg);
      o.id = id; o.order = J().nextOrder(cur); o.at = clock();
    }
    return o;
  }
  // 寫入新格子:只在「該格還沒有資料」時寫(If-Match);被別人先佔走就重新配下一格;
  // 若是自己上一次逾時其實已寫入(內容完全相同)就當成功,不會重複新增
  async function createSlot(kind, path, jid, o, build, fullMsg) {
    o = o || {};
    for (let i = 0; i < 6; i++) {
      const sl = await plan(kind, path, jid, o, fullMsg), target = jpath(jid, path + '/' + sl.id);
      const val = build(sl);
      try { await store.put(target, val, { ifNew: true }); return sl.id; }
      catch (e) {
        if (!e || e.code !== 'EXISTS') throw e;
        const there = await store.get(target);
        if (there && keys(val).every(k => (val[k] && val[k]['.sv']) || there[k] === val[k])) return sl.id;   // 內容完全相同 = 自己上一次逾時其實已寫入
        o.cur = (await store.get(jpath(jid, path))) || {}; o.id = null;
      }
    }
    throw new NetError('BUSY', '同時有很多人在編輯,請再按一次');
  }
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
