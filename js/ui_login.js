// 登入頁:登入 / 註冊 / 忘記密碼;服務無法使用時只顯示白話提示。
import { el, getSettings, saveSettings } from './app.js';
import * as Auth from './auth.js';
import * as busyUi from './busy.js';

const LAST_EMAIL = 'tj_last_email';
const lastEmail = () => { try { return localStorage.getItem(LAST_EMAIL) || ''; } catch (_) { return ''; } };

// onDone({session, name}):登入或註冊成功後呼叫(name 只有註冊時有值)
export function showLogin(root, opts) {
  opts = opts || {};
  let view = 'login', msg = opts.notice || '', busy = false, showPw = false;
  const vals = { name: '', email: opts.email || lastEmail(), pw: '' };

  const draw = () => {
    const A = window.AuthRest, mode = Auth.mode();
    const emailI = el('input', { type: 'email', id: 'tjEmail', autocomplete: 'username', inputmode: 'email', placeholder: 'email', value: vals.email, oninput: e => { vals.email = e.target.value; } });
    const pwI = el('input', { type: showPw ? 'text' : 'password', id: 'tjPw', autocomplete: view === 'register' ? 'new-password' : 'current-password', placeholder: '密碼(至少 6 個字,建議 8 個字以上)', value: vals.pw, oninput: e => { vals.pw = e.target.value; } });
    const nameI = el('input', { type: 'text', id: 'tjName', autocomplete: 'nickname', maxlength: 30, placeholder: '你的暱稱(顯示給大家看)', value: vals.name, oninput: e => { vals.name = e.target.value; } });
    const msgBox = el('div', { class: 'banner' + (msg && /^!/.test(msg) ? ' warn' : ''), id: 'tjMsg', role: 'status', style: msg ? '' : 'display:none' }, msg.replace(/^!/, ''));
    const setBusy = (b, t) => { busy = b; main.disabled = b; main.textContent = b ? '請稍候…' : t; };
    const fail = e => { msg = '!' + (e && e.message ? e.message : '發生問題,請再試一次'); busy = false; draw(); };
    const main = el('button', { class: 'big-btn primary', id: 'tjSubmit', disabled: mode === 'none' }, view === 'login' ? '登入' : view === 'register' ? '註冊並登入' : '寄重設信');
    const label = main.textContent;
    main.onclick = async () => {
      if (busy) return;
      const email = vals.email.trim();
      if (!A.validEmail(email)) { msg = '!請輸入正確的 email'; draw(); return; }
      if (view !== 'forgot' && !A.validPassword(vals.pw)) { msg = '!密碼至少 6 個字'; draw(); return; }
      if (view === 'register') {
        const v = window.Journal.validName(vals.name);
        if (!v.ok) { msg = '!' + v.msg; draw(); return; }
        const r = await busyUi.run(() => Auth.register(email, vals.pw), { text: '註冊中…' });
        if (!r.ok) return fail(r.error);
        try { localStorage.setItem(LAST_EMAIL, email); } catch (_) { /* 略過 */ }
        opts.onDone({ session: r.value, name: v.value });
      } else if (view === 'login') {
        const r = await busyUi.run(() => Auth.login(email, vals.pw), { text: '登入中…' });
        if (!r.ok) return fail(r.error);
        try { localStorage.setItem(LAST_EMAIL, email); } catch (_) { /* 略過 */ }
        opts.onDone({ session: r.value });
      } else {
        const r = await busyUi.run(() => Auth.sendReset(email), { text: '寄送中…' });
        if (!r.ok) return fail(r.error);
        msg = '若這個 email 有註冊,重設信已寄出,請看信箱(含垃圾郵件)'; busy = false; draw();
      }
    };
    const googleBtn = Auth.googleAvailable() && view === 'login'
      ? el('button', { class: 'big-btn', id: 'tjGoogle', onclick: async () => {
        if (busy) return;
        try { busy = true; const g = await Auth.getGoogleIdToken(); const session = await Auth.loginWithGoogle(g); opts.onDone({ session, google: true }); }
        catch (e) { if (e && e.message === '已取消') { busy = false; return; } fail(e); }
      } }, 'Google 登入(已綁定的帳號)') : null;

    const setup = mode === 'none' ? el('div', { class: 'banner warn', id: 'tjSetup' }, '服務暫時無法使用,請稍後再試。') : null;
    const mockNote = mode === 'mock' ? el('div', { class: 'banner warn', id: 'tjMockNote' }, '目前是模擬模式(資料只存在這支手機,不會上傳)。',
      el('button', { class: 'btn sm', id: 'tjMockOff', style: 'margin-left:8px', onclick: () => { saveSettings(Object.assign({}, getSettings(), { useMock: false })); Auth.resetBackend(); draw(); } }, '關閉')) : null;

    const links = el('div', { class: 'tj-links' },
      view !== 'login' ? el('button', { class: 'link-btn', id: 'tjToLogin', onclick: () => { view = 'login'; msg = ''; draw(); } }, '回到登入') : null,
      view !== 'register' ? el('button', { class: 'link-btn', id: 'tjToRegister', onclick: () => { view = 'register'; msg = ''; draw(); } }, '還沒有帳號?註冊') : null,
      view === 'login' ? el('button', { class: 'link-btn', id: 'tjToForgot', onclick: () => { view = 'forgot'; msg = ''; draw(); } }, '忘記密碼') : null);

    root.replaceChildren(el('div', { class: 'tj-login' }, el('div', { class: 'tj-login-in' },
      el('h1', { class: 'tj-title' }, '旅遊日誌'),
      el('p', { class: 'muted' }, view === 'register' ? '建立帳號' : view === 'forgot' ? '輸入註冊的 email' : '登入後看行程、公告,和大家一起點餐'),
      setup, mockNote, msgBox,
      view === 'register' ? [el('label', { class: 'f', for: 'tjName' }, '暱稱'), nameI] : null,
      el('label', { class: 'f', for: 'tjEmail' }, 'Email'), emailI,
      view !== 'forgot' ? [el('label', { class: 'f', for: 'tjPw' }, '密碼'), el('div', { class: 'row' }, el('div', { class: 'grow' }, pwI), el('button', { class: 'btn', id: 'tjShowPw', type: 'button', onclick: () => { showPw = !showPw; draw(); } }, showPw ? '隱藏' : '顯示')), view === 'register' ? el('div', { class: 'muted small', id: 'tjPwHint' }, '請勿使用重要帳號的密碼') : null] : null,
      el('div', { style: 'margin-top:14px' }, main), googleBtn ? el('div', { style: 'margin-top:10px' }, googleBtn) : null,
      links)));
  };
  draw();
}
