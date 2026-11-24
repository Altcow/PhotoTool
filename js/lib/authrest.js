/* Firebase Auth REST(email+密碼、Google 綁定)的請求建構、錯誤碼對照、token 到期判斷、共用刷新(純邏輯,fetch 可注入) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AuthRest = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var IDT = 'https://identitytoolkit.googleapis.com/v1/accounts:';
  var STS = 'https://securetoken.googleapis.com/v1/token';
  var MARGIN = 3 * 60 * 1000;   // 距到期 < 3 分鐘就換新 token

  var ERR_TEXT = {
    EMAIL_EXISTS: '這個 email 已註冊,請直接登入或按忘記密碼',
    INVALID_EMAIL: 'email 格式不對',
    WEAK_PASSWORD: '密碼至少 6 個字',
    MISSING_PASSWORD: '請輸入密碼',
    INVALID_LOGIN_CREDENTIALS: 'email 或密碼不對',
    EMAIL_NOT_FOUND: 'email 或密碼不對',
    INVALID_PASSWORD: 'email 或密碼不對',
    USER_DISABLED: '這個帳號已被停用',
    TOO_MANY_ATTEMPTS_TRY_LATER: '嘗試太多次,請稍後再試',
    OPERATION_NOT_ALLOWED: '管理者尚未啟用 email 登入',
    TOKEN_EXPIRED: '登入已過期,請重新登入',
    USER_NOT_FOUND: '登入已失效,請重新登入',
    INVALID_REFRESH_TOKEN: '登入已失效,請重新登入',
    INVALID_IDP_RESPONSE: 'Google 登入沒有成功,請再試一次',
    CREDENTIAL_ALREADY_IN_USE: '這個 Google 帳號已綁定在別的帳號',
    FEDERATED_USER_ID_ALREADY_LINKED: '這個 Google 帳號已綁定在別的帳號',
    API_KEY_INVALID: 'API 金鑰不對,請到設定頁檢查',
    NETWORK: '沒有網路',
  };
  // 這些錯誤代表登入已無法續用(要回登入頁)
  var DEAD = { TOKEN_EXPIRED: 1, USER_NOT_FOUND: 1, USER_DISABLED: 1, INVALID_REFRESH_TOKEN: 1, INVALID_ID_TOKEN: 1 };

  function AuthError(code, message) {
    var e = new Error(message || ERR_TEXT[code] || code);
    e.name = 'AuthError'; e.code = code; e.dead = !!DEAD[code];
    return e;
  }
  // Firebase 的 error.message 形如 "WEAK_PASSWORD : Password should be at least 6 characters"
  function errorCode(msg) {
    var s = String(msg || '').split(' : ')[0].trim();
    if (/^API key not valid/i.test(s)) return 'API_KEY_INVALID';
    return s || 'UNKNOWN';
  }
  function errorText(code) { return ERR_TEXT[code] || '登入發生問題(' + code + ')'; }

  function isExpiring(exp, now, margin) { return !exp || Number(exp) - now < (margin == null ? MARGIN : margin); }

  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim()); }
  function validPassword(p) { return String(p || '').length >= 6; }

  function create(opts) {
    opts = opts || {};
    var key = opts.apiKey || '', now = opts.now || function () { return Date.now(); };
    var doFetch = opts.fetch || function (u, i) { return globalThis.fetch(u, i); };
    var refreshing = null;

    async function post(url, body, form) {
      var res;
      try {
        res = await doFetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 'key=' + encodeURIComponent(key), {
          method: 'POST',
          headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
          body: form ? body : JSON.stringify(body),
        });
      } catch (e) { throw AuthError('NETWORK'); }
      var data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok) {
        var code = errorCode(data && data.error && data.error.message);
        throw AuthError(code, errorText(code));
      }
      return data || {};
    }
    function session(d, email) {
      return {
        uid: d.localId || d.user_id, email: d.email || email || '',
        refreshToken: d.refreshToken || d.refresh_token, idToken: d.idToken || d.id_token,
        exp: now() + Number(d.expiresIn || d.expires_in || 3600) * 1000,
      };
    }
    var api = {
      signUp: async function (email, password) { return session(await post(IDT + 'signUp', { email: email, password: password, returnSecureToken: true }), email); },
      signIn: async function (email, password) { return session(await post(IDT + 'signInWithPassword', { email: email, password: password, returnSecureToken: true }), email); },
      sendReset: async function (email) { await post(IDT + 'sendOobCode', { requestType: 'PASSWORD_RESET', email: email }); },
      refresh: async function (refreshToken) {
        var d = await post(STS, 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken), true);
        return session(d, '');
      },
      // Google:googleIdToken 由 GIS 取得;帶 idToken = 綁定(link),不帶 = 以 Google 登入/註冊
      signInWithGoogle: async function (googleIdToken, firebaseIdToken) {
        var body = { postBody: 'id_token=' + encodeURIComponent(googleIdToken) + '&providerId=google.com', requestUri: opts.requestUri || 'http://localhost', returnIdpCredential: true, returnSecureToken: true };
        if (firebaseIdToken) body.idToken = firebaseIdToken;
        var d = await post(IDT + 'signInWithIdp', body);
        var s = session(d, '');
        s.photoUrl = d.photoUrl || ''; s.displayName = d.displayName || ''; s.google = true;
        return s;
      },
      lookup: async function (idToken) {
        var d = await post(IDT + 'lookup', { idToken: idToken });
        var u = (d.users && d.users[0]) || {};
        var prov = (u.providerUserInfo || []).map(function (p) { return p.providerId; });
        return { uid: u.localId, email: u.email || '', providers: prov, google: prov.indexOf('google.com') >= 0, photoUrl: ((u.providerUserInfo || []).filter(function (p) { return p.providerId === 'google.com'; })[0] || {}).photoUrl || '' };
      },
    };

    // 取得有效 idToken:快到期就換;同時多個呼叫共用同一個換 token 請求
    // store = {get():session|null, set(session|null)}
    api.manager = function (store) {
      async function doRefresh(force) {
        var cur = store.get();
        if (!cur || !cur.refreshToken) return null;
        if (!force && !isExpiring(cur.exp, now())) return cur;
        if (!refreshing) {
          refreshing = api.refresh(cur.refreshToken).then(function (s) {
            var next = Object.assign({}, cur, { idToken: s.idToken, refreshToken: s.refreshToken || cur.refreshToken, exp: s.exp });
            store.set(next);
            return next;
          }).then(function (v) { refreshing = null; return v; }, function (e) { refreshing = null; throw e; });
        }
        return refreshing;
      }
      return {
        // 回傳 idToken 或 null(未登入);換 token 失敗且已無法續用 → 清除登入並丟出錯誤
        getToken: async function (force) {
          try { var s = await doRefresh(force); return s ? s.idToken : null; }
          catch (e) { if (e.dead) store.set(null); throw e; }
        },
        current: function () { return store.get(); },
      };
    };
    return api;
  }

  return { create: create, errorCode: errorCode, errorText: errorText, AuthError: AuthError, isExpiring: isExpiring, validEmail: validEmail, validPassword: validPassword, MARGIN: MARGIN, ERR_TEXT: ERR_TEXT };
});
