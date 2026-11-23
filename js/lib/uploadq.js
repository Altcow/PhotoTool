/* 上傳佇列狀態機(純資料):none → pending → uploading → done / failed。
   entry = { id, state, attempts, lastError, nextAt };媒體紀錄另有 storage / driveFileId / uploadState / attempts / lastError。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UploadQ = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var MAX_ATTEMPTS = 3;
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // 舊資料(沒有雲端欄位)一律視為本機
  function normalizeMedia(rec) {
    var r = Object.assign({}, rec);
    if (r.storage !== 'drive') r.storage = 'local';
    if (['none', 'pending', 'uploading', 'done', 'failed'].indexOf(r.uploadState) < 0) r.uploadState = r.driveFileId ? 'done' : 'none';
    r.driveFileId = r.driveFileId || ''; r.attempts = Number(r.attempts) || 0; r.lastError = r.lastError || '';
    return r;
  }
  // 設為雲端才加入佇列;切回本機不再加入新的
  function shouldEnqueue(mode, rec) { return mode === 'drive' && (!rec || rec.uploadState === 'none' || rec.uploadState === 'failed'); }

  function enqueue(entries, id, now) {
    if (entries.some(function (e) { return e.id === id; })) return entries;
    return entries.concat([{ id: id, state: 'pending', attempts: 0, lastError: '', nextAt: now || 0 }]);
  }
  // 現在能不能開始上傳:離線或 token 無效都暫停(不累計失敗)。回傳 {entry|null, paused:'offline'|'auth'|null}
  function pickNext(entries, ctx) {
    var has = entries.some(function (e) { return e.state === 'pending'; });
    if (!has) return { entry: null, paused: null };
    if (!ctx.online) return { entry: null, paused: 'offline' };
    if (!ctx.tokenValid) return { entry: null, paused: 'auth' };
    var now = ctx.now || 0;
    for (var i = 0; i < entries.length; i++) if (entries[i].state === 'pending' && (entries[i].nextAt || 0) <= now) return { entry: entries[i], paused: null };
    return { entry: null, paused: null };
  }
  function patch(entries, id, fn) { return entries.map(function (e) { return e.id === id ? fn(clone(e)) : e; }); }
  function start(entries, id) { return patch(entries, id, function (e) { e.state = 'uploading'; e.attempts += 1; return e; }); }
  // outcome: {ok:true} | {kind:'auth'|'offline'} | {kind:'retry'|'failed', error, exhausted}
  function finish(entries, id, outcome, now) {
    return patch(entries, id, function (e) {
      if (outcome.ok) { e.state = 'done'; e.lastError = ''; return e; }
      e.lastError = outcome.error || '';
      if (outcome.kind === 'auth' || outcome.kind === 'offline') { e.state = 'pending'; e.attempts = Math.max(0, e.attempts - 1); return e; }   // 暫停,不累計失敗
      if (outcome.kind === 'retry' && !outcome.exhausted && e.attempts < MAX_ATTEMPTS) { e.state = 'pending'; e.nextAt = (now || 0) + Math.pow(2, e.attempts) * 1000; return e; }
      e.state = 'failed'; return e;
    });
  }
  function retryFailed(entries) { return entries.map(function (e) { return e.state === 'failed' ? { id: e.id, state: 'pending', attempts: 0, lastError: '', nextAt: 0 } : e; }); }
  // App 在上傳中被關掉:uploading 回到 pending
  function recover(entries) { return entries.map(function (e) { return e.state === 'uploading' ? Object.assign({}, e, { state: 'pending' }) : e; }); }
  function remove(entries, id) { return entries.filter(function (e) { return e.id !== id; }); }
  function clearUnfinished(entries) { return entries.filter(function (e) { return e.state === 'done'; }); }
  function counts(entries) {
    var c = { pending: 0, uploading: 0, done: 0, failed: 0 };
    entries.forEach(function (e) { c[e.state] = (c[e.state] || 0) + 1; });
    c.waiting = c.pending + c.uploading;          // 首頁顯示「待上傳 N 張」
    return c;
  }
  // 把佇列狀態同步成媒體紀錄欄位
  function applyToMedia(rec, entry, driveFileId) {
    var r = normalizeMedia(rec);
    r.uploadState = entry.state === 'pending' ? 'pending' : entry.state; r.attempts = entry.attempts; r.lastError = entry.lastError || '';
    if (entry.state === 'done') { r.storage = 'drive'; r.driveFileId = driveFileId || r.driveFileId; }
    return r;
  }
  return { MAX_ATTEMPTS: MAX_ATTEMPTS, normalizeMedia: normalizeMedia, shouldEnqueue: shouldEnqueue, enqueue: enqueue, pickNext: pickNext, start: start, finish: finish, retryFailed: retryFailed, recover: recover, remove: remove, clearUnfinished: clearUnfinished, counts: counts, applyToMedia: applyToMedia };
});
