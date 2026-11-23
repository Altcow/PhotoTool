// 媒體存放:saveMedia(blob, meta) / getMedia(id) 抽象。一律先存本機;設為雲端硬碟時排入佇列再上傳。
// UI 不直接碰 Drive。createMedia(deps) 可注入儲存層與 fetch(node 測試用);app.js 啟動時呼叫 initMedia(deps) 接上真實的。
export class MediaError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

export function createMedia(deps) {
  const { store, drive: Dv, uq: U } = deps;
  const sleep = deps.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const listeners = new Set();
  const folderCache = {};
  let running = null;
  const notify = () => listeners.forEach(f => { try { f(); } catch (e) { console.warn('media listener', e); } });
  const loadQ = () => store.allUploads();

  async function setEntry(entry, rec, driveFileId) {
    await store.putUpload(entry);
    if (rec) await store.putRec(U.applyToMedia(rec, entry, driveFileId));
  }

  async function saveMedia(blob, meta) {
    meta = meta || {};
    const id = meta.id || deps.uuid();
    const settings = deps.settings();
    let rec = U.normalizeMedia({ id, blob, location: meta.location || null, kind: meta.kind || '', ownerId: meta.ownerId || '', createdAt: deps.now(), size: blob.size || 0, mime: blob.type || '' });
    const queue = U.shouldEnqueue(settings.mediaStore, rec) && (blob.size || 0) <= Dv.MAX_BYTES;
    if (queue) { rec.uploadState = 'pending'; await store.putUpload(U.enqueue([], id, 0)[0]); }
    await store.putRec(rec);                    // 先存本機,再談雲端:不丟原圖
    notify();
    if (queue) kick();
    return id;
  }
  function kick() {
    const tk = deps.tokenInfo();
    if (deps.online() && tk && tk.valid) processQueue().catch(e => console.warn('上傳失敗', e));
  }

  async function getMedia(id) {
    const rec = await store.getRec(id);
    if (!rec) return null;
    if (rec.blob) return rec.blob;
    if (!rec.driveFileId) return null;
    const tk = deps.tokenInfo();
    if (!tk || !tk.valid || !deps.online()) throw new MediaError('NEED_CLOUD', '需連線雲端才能看這張照片');
    let blob;
    try { blob = await Dv.downloadFile(deps.fetch, tk.token, rec.driveFileId, { sleep }); } catch (e) {
      if (e.kind === 'auth') throw new MediaError('NEED_CLOUD', '登入已過期,請重新連線');
      throw new MediaError('NEED_CLOUD', '需連線雲端才能看這張照片');
    }
    if (!deps.settings().deleteLocalAfterUpload) await store.putRec(Object.assign({}, rec, { blob }));   // 可快取到本機
    return blob;
  }
  async function deleteMedia(id) { await store.delRec(id); await store.delUpload(id); notify(); }

  async function processQueue() {
    if (running) return running;
    running = (async () => {
      const out = { done: 0, failed: 0, paused: null };
      try {
        for (;;) {
          const tk = deps.tokenInfo() || {};
          const q = await loadQ();
          const pick = U.pickNext(q, { online: deps.online(), tokenValid: !!tk.valid, now: deps.now() });
          if (!pick.entry) { out.paused = pick.paused; break; }
          const id = pick.entry.id, rec = await store.getRec(id);
          if (!rec || !rec.blob) {                       // 本機沒有原檔(已被刪)→ 沒東西可傳
            if (rec && rec.driveFileId) await setEntry(Object.assign({}, pick.entry, { state: 'done' }), rec, rec.driveFileId); else await store.delUpload(id);
            continue;
          }
          const started = U.start(q, id).find(e => e.id === id);
          await setEntry(started, rec);
          notify();
          try {
            const folder = await Dv.ensureFolder(deps.fetch, tk.token, { cache: folderCache, sleep });
            const bytes = new Uint8Array(await rec.blob.arrayBuffer()), mime = rec.blob.type || 'image/jpeg';
            const name = Dv.fileName(rec.createdAt || deps.now(), id, mime);
            const res = await Dv.uploadFile(deps.fetch, tk.token, folder, { bytes, mime, name }, { sleep });
            const done = U.finish([started], id, { ok: true }, deps.now())[0];
            const fresh = await store.getRec(id) || rec;
            await store.putUpload(done);
            const upd = U.applyToMedia(fresh, done, res.id);
            if (deps.settings().deleteLocalAfterUpload) upd.blob = null;       // 上傳成功後釋放本機副本(預設關閉)
            await store.putRec(upd);
            out.done++;
          } catch (e) {
            const kind = e && e.kind ? e.kind : 'failed';
            const entry = U.finish([started], id, { kind, error: (e && e.message) || String(e), exhausted: !!(e && e.exhausted) }, deps.now())[0];
            await setEntry(entry, await store.getRec(id));
            if (kind === 'auth') { out.paused = 'auth'; break; }
            if (kind === 'offline') { out.paused = 'offline'; break; }
            if (entry.state === 'failed') out.failed++;
          }
        }
      } finally { running = null; notify(); }
      return out;
    })();
    return running;
  }

  async function counts() { return U.counts(await loadQ()); }
  async function retryFailed() { const q = U.retryFailed(await loadQ()); for (const e of q) await store.putUpload(e); notify(); }
  async function clearUnfinished() {
    const q = await loadQ();
    for (const e of q) if (e.state !== 'done') { await store.delUpload(e.id); const r = await store.getRec(e.id); if (r && r.uploadState !== 'done') await store.putRec(Object.assign({}, r, { uploadState: 'none' })); }
    notify();
  }
  // 啟動時:上傳到一半被關掉的回到 pending
  async function recover() { const q = U.recover(await loadQ()); for (const e of q) await store.putUpload(e); }
  // 已經在本機、還沒上傳的媒體(「把現有照片全部上傳」要顯示張數與大小)
  async function localPending() {
    const recs = (await store.allRecs()).map(U.normalizeMedia).filter(r => r.blob && r.storage === 'local' && (r.uploadState === 'none' || r.uploadState === 'failed') && (r.size || r.blob.size || 0) <= Dv.MAX_BYTES);
    return { ids: recs.map(r => r.id), count: recs.length, bytes: recs.reduce((a, r) => a + (r.size || r.blob.size || 0), 0) };
  }
  async function enqueueExisting(ids) {
    let n = 0;
    for (const id of ids) {
      const rec = await store.getRec(id); if (!rec || !rec.blob) continue;
      await store.putUpload(U.enqueue([], id, 0)[0]); await store.putRec(Object.assign(U.normalizeMedia(rec), { uploadState: 'pending' })); n++;
    }
    notify(); kick(); return n;
  }
  return { saveMedia, getMedia, deleteMedia, processQueue, counts, retryFailed, clearUnfinished, recover, localPending, enqueueExisting, onChange: f => { listeners.add(f); return () => listeners.delete(f); }, notify };
}

let inst = null;
export function initMedia(deps) { inst = createMedia(deps); return inst; }
const need = () => { if (!inst) throw new Error('媒體模組尚未初始化'); return inst; };
export const saveMedia = (b, m) => need().saveMedia(b, m);
export const getMedia = id => need().getMedia(id);
export const deleteMedia = id => need().deleteMedia(id);
export const mediaApi = () => need();
