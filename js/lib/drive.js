/* Google Drive API(drive.file 範圍)請求建構與上傳/下載流程。純函式 + 可注入 fetch,node 可用假 fetch 測試。
   只碰 App 自己建立的「PhotoTool」資料夾與檔案。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Drive = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var API = 'https://www.googleapis.com/drive/v3';
  var UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  var FOLDER_MIME = 'application/vnd.google-apps.folder';
  var FOLDER_NAME = 'PhotoTool';
  var MAX_BYTES = 20 * 1024 * 1024;
  var MAX_RETRIES = 3;

  function DriveError(kind, status, message) {
    var e = new Error(message || kind); e.name = 'DriveError'; e.kind = kind; e.status = status || 0; return e;
  }
  // Drive 查詢字串:單引號與反斜線要跳脫
  function escapeQ(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  function folderQuery(name) { return "name='" + escapeQ(name || FOLDER_NAME) + "' and mimeType='" + FOLDER_MIME + "' and trashed=false"; }
  function auth(token, extra) { var h = { Authorization: 'Bearer ' + token }; if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; }); return h; }

  function findFolderRequest(token, name) {
    return { url: API + '/files?q=' + encodeURIComponent(folderQuery(name)) + '&fields=' + encodeURIComponent('files(id,name)') + '&spaces=drive&pageSize=10', init: { method: 'GET', headers: auth(token) } };
  }
  function createFolderRequest(token, name) {
    return { url: API + '/files?fields=id', init: { method: 'POST', headers: auth(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ name: name || FOLDER_NAME, mimeType: FOLDER_MIME }) } };
  }
  function downloadRequest(token, fileId) { return { url: API + '/files/' + encodeURIComponent(fileId) + '?alt=media', init: { method: 'GET', headers: auth(token) } }; }
  function aboutRequest(token) { return { url: API + '/about?fields=' + encodeURIComponent('user(displayName,emailAddress)'), init: { method: 'GET', headers: auth(token) } }; }

  var EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/gif': 'gif', 'application/pdf': 'pdf' };
  function extFor(mime) { return EXT[mime] || 'bin'; }
  function pad(n, w) { return ('0000' + n).slice(-(w || 2)); }
  // 檔名:yyyyMMdd-HHmmss-<短id>.<副檔名>(用本地時間)
  function fileName(date, id, mime) {
    var d = date instanceof Date ? date : new Date(date);
    var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    var short = String(id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 6) || '000000';
    return stamp + '-' + short + '.' + extFor(mime);
  }

  var enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  // multipart/related:第一段 JSON metadata,第二段檔案內容。bytes: Uint8Array
  function multipart(meta, bytes, mime, boundary) {
    boundary = boundary || ('pt' + Math.random().toString(36).slice(2) + Date.now().toString(36));
    var head = enc.encode('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: ' + (mime || 'application/octet-stream') + '\r\n\r\n');
    var tail = enc.encode('\r\n--' + boundary + '--');
    var body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
    return { boundary: boundary, contentType: 'multipart/related; boundary=' + boundary, body: body };
  }
  function uploadRequest(token, folderId, name, bytes, mime, boundary) {
    var mp = multipart({ name: name, parents: [folderId] }, bytes, mime, boundary);
    return { url: UPLOAD + '/files?uploadType=multipart&fields=id', init: { method: 'POST', headers: auth(token, { 'Content-Type': mp.contentType }), body: mp.body }, boundary: mp.boundary };
  }

  // 失敗分類:auth=401(登入過期)、offline=沒網路、retry=429/5xx(退避重試)、failed=其他(403 等,需手動處理)
  function classify(status, networkError) {
    if (networkError) return 'offline';
    if (status === 401) return 'auth';
    if (status === 429 || (status >= 500 && status <= 599)) return 'retry';
    return 'failed';
  }
  function backoffMs(attempt) { return 1000 * Math.pow(2, attempt); }   // 第 0 次重試等 1s,再 2s、4s

  // 送一次請求;非 2xx 或網路錯誤丟 DriveError(kind: auth/offline/retry/failed)
  function call(fetchFn, req) {
    return Promise.resolve().then(function () { return fetchFn(req.url, req.init); }).then(function (res) {
      if (res.ok) return res;
      throw DriveError(classify(res.status, false), res.status, 'Drive 回應 ' + res.status);
    }, function () { throw DriveError('offline', 0, '網路錯誤'); });
  }
  // 429/5xx 以指數退避最多重試 MAX_RETRIES 次;其他類別直接丟出
  function withRetry(fn, opts) {
    opts = opts || {}; var sleep = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); }, max = opts.maxRetries === undefined ? MAX_RETRIES : opts.maxRetries;
    var attempt = 0;
    function run() {
      return fn().catch(function (e) {
        if (e && e.kind === 'retry' && attempt < max) { var wait = backoffMs(attempt); attempt++; return sleep(wait).then(run); }
        if (e && e.kind === 'retry') e.exhausted = true;
        throw e;
      });
    }
    return run();
  }

  // 找(或建立)PhotoTool 資料夾:已存在就不重複建立。cache = {id} 可重用
  function ensureFolder(fetchFn, token, opts) {
    opts = opts || {}; if (opts.cache && opts.cache.id) return Promise.resolve(opts.cache.id);
    return withRetry(function () { return call(fetchFn, findFolderRequest(token, opts.name)).then(function (r) { return r.json(); }); }, opts).then(function (j) {
      var hit = j && j.files && j.files[0];
      if (hit && hit.id) return hit.id;
      return withRetry(function () { return call(fetchFn, createFolderRequest(token, opts.name)).then(function (r) { return r.json(); }); }, opts).then(function (c) {
        if (!c || !c.id) throw DriveError('failed', 0, '建立資料夾沒有回傳 id'); return c.id;
      });
    }).then(function (id) { if (opts.cache) opts.cache.id = id; return id; });
  }
  // 上傳一個檔案 → { id }
  function uploadFile(fetchFn, token, folderId, file, opts) {
    if (file.bytes.length > MAX_BYTES) return Promise.reject(DriveError('failed', 0, '檔案超過 20MB'));
    var req = uploadRequest(token, folderId, file.name, file.bytes, file.mime, (opts || {}).boundary);
    return withRetry(function () { return call(fetchFn, req).then(function (r) { return r.json(); }); }, opts).then(function (j) {
      if (!j || !j.id) throw DriveError('failed', 0, '上傳沒有回傳 id'); return { id: j.id };
    });
  }
  function downloadFile(fetchFn, token, fileId, opts) {
    return withRetry(function () { return call(fetchFn, downloadRequest(token, fileId)).then(function (r) { return r.blob ? r.blob() : r.arrayBuffer(); }); }, opts);
  }
  return {
    FOLDER_NAME: FOLDER_NAME, MAX_BYTES: MAX_BYTES, MAX_RETRIES: MAX_RETRIES, escapeQ: escapeQ, folderQuery: folderQuery, findFolderRequest: findFolderRequest, createFolderRequest: createFolderRequest,
    downloadRequest: downloadRequest, aboutRequest: aboutRequest, fileName: fileName, extFor: extFor, multipart: multipart, uploadRequest: uploadRequest, classify: classify, backoffMs: backoffMs,
    withRetry: withRetry, ensureFolder: ensureFolder, uploadFile: uploadFile, downloadFile: downloadFile, DriveError: DriveError,
  };
});
