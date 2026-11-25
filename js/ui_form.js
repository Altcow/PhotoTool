// 共用:全螢幕編輯表單 openForm 與「遮罩+逾時+可重試」的動作 act(日誌頁、事件頁、點餐單共用)。
import { el, pushScreen, popScreen } from './app.js';
import * as busy from './busy.js';

const T = v => window.Journal.txt(v);

// 一個動作 = 遮罩 + 失敗可重試;回傳 {ok, value, error}
export const act = (fn, text, okToast, extra) => busy.run(fn, Object.assign({ text, okToast }, extra || {}));

/* ---------- 共用:表單頁 ---------- */
// fields: [{key,label,type:'text'|'textarea'|'date'|'checkbox'|'select',value,max,hint,required,options,inputmode,showIf:{key,value}}]
// guard: {cur:()=>number(目前已知的 updatedAt), base:number}(儲存前比對,有人剛改過就問是否覆蓋;用已訂閱的資料,不多一次網路往返)
// onSave(values, slot):slot 是這個表單專用的物件,新增類動作用它保存「第一次配到的格子 id」,逾時重試沿用同一個
export function openForm({ title, fields, banner, guard, okText, onSave, savingText }) {
  pushScreen(title, body => {
    const inputs = {}, rows = {};
    const slot = {};
    const err = el('div', { class: 'banner warn', id: 'frmErr', style: 'display:none' });
    body.append(err);
    if (banner) body.append(el('div', { class: 'banner', id: 'frmBanner' }, banner));
    const enterBlur = e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } };   // iPhone 鍵盤「前往/完成」只收鍵盤,不送出
    fields.forEach(f => {
      let inp;
      const val = T(f.value);
      if (f.type === 'textarea') { inp = el('textarea', { id: 'f_' + f.key, rows: f.rows || 6, maxlength: f.max || null }); inp.value = val; }
      else if (f.type === 'checkbox') inp = el('input', { type: 'checkbox', id: 'f_' + f.key, checked: !!f.value, style: 'width:22px;height:22px' });
      else if (f.type === 'select') {
        inp = el('select', { id: 'f_' + f.key, class: 'tj-sel' }, f.options.map(o => el('option', { value: o.value }, o.label)));
        inp.value = val;
        if (inp.value !== val && f.options.length) inp.value = f.options[0].value;
      } else { inp = el('input', { type: f.type || 'text', id: 'f_' + f.key, maxlength: f.max || null, placeholder: f.placeholder || '', inputmode: f.inputmode || null, autocomplete: 'off', onkeydown: enterBlur }); inp.value = val; }
      inputs[f.key] = inp;
      const row = f.type === 'checkbox'
        ? el('label', { class: 'row', style: 'margin:12px 0' }, inp, f.label)
        : el('div', {}, el('label', { class: 'f', for: 'f_' + f.key }, f.label + (f.required ? '(必填)' : '')), inp, f.hint ? el('div', { class: 'muted small' }, f.hint) : null);
      rows[f.key] = row; body.append(row);
    });
    const syncShow = () => fields.forEach(f => { if (f.showIf) rows[f.key].style.display = inputs[f.showIf.key].value === f.showIf.value ? '' : 'none'; });
    fields.forEach(f => { if (f.type === 'select') inputs[f.key].onchange = syncShow; });
    syncShow();
    const ok = el('button', { class: 'big-btn primary', id: 'frmOk', style: 'margin-top:16px' }, okText || '儲存');
    ok.onclick = async () => {
      if (ok.disabled) return;
      const v = {};
      fields.forEach(f => { v[f.key] = f.type === 'checkbox' ? inputs[f.key].checked : inputs[f.key].value; });
      err.style.display = 'none';
      const missing = fields.find(f => f.required && !(f.showIf && inputs[f.showIf.key].value !== f.showIf.value) && !String(v[f.key]).trim());
      if (missing) { err.textContent = missing.label + '不能空白'; err.style.display = ''; return; }
      if (guard && guard.cur() !== guard.base && !confirm('有人剛改過這份內容,要用你的版本覆蓋嗎?')) return;
      ok.disabled = true;
      const r = await act(() => onSave(v, slot), savingText || '儲存中…', '已儲存');
      if (r.ok) { popScreen(); return; }
      err.textContent = (r.error && r.error.message) || '儲存失敗'; err.style.display = ''; ok.disabled = false;   // 表單不關、輸入不遺失
    };
    body.append(ok);
  });
}

