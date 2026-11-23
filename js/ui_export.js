// 共用匯出元件 exportSheet(spec):四顆大按鈕(圖片 PNG / PDF / Excel / 複製文字)+ 分享。
// 按下先進全螢幕預覽頁(檔案只在記憶體,不上傳、不存伺服器),確認後才下載/分享。與 app.js 循環匯入:只在函式內使用
import { el, pushScreen, popScreen } from './app.js';
import { copyText } from './ui_room.js';

const { Render, Pdf, Xlsx, Sheets } = window;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const bigBtn = (icon, text, onclick, cls, id) => el('button', { class: 'big-btn ' + (cls || ''), id, onclick }, el('span', { class: 'bi' }, icon), el('span', { class: 'bt' }, text));
const delay = ms => new Promise(r => setTimeout(r, ms));
const safeName = s => String(s || '報表').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').trim().slice(0, 60) || '報表';
const kb = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

// 由同一份 render 結果產生所有格式(預覽與下載來源相同)
export async function buildExport(spec) {
  const base = safeName(spec.filename || spec.title);
  const canvases = Render.renderPages(spec);
  const pngBlobs = await Promise.all(canvases.map(c => Render.canvasToBlob(c, 'image/png')));
  const jpgBlobs = await Promise.all(canvases.map(c => Render.canvasToBlob(c, 'image/jpeg', 0.9)));
  const pdfPages = [];
  for (let i = 0; i < canvases.length; i++) pdfPages.push({ jpeg: new Uint8Array(await jpgBlobs[i].arrayBuffer()), width: canvases[i].width, height: canvases[i].height });
  const pdfBytes = Pdf.build(pdfPages);
  const xlsxBytes = Xlsx.build((spec.sheets && spec.sheets.length ? spec.sheets : [{ name: '資料', columns: [], rows: [] }]).map(s => ({ name: s.name, columns: s.columns, rows: s.rows })));
  const n = pngBlobs.length;
  const files = {
    png: pngBlobs.map((b, i) => new File([b], base + (n > 1 ? '-' + (i + 1) : '') + '.png', { type: 'image/png' })),
    pdf: [new File([pdfBytes], base + '.pdf', { type: 'application/pdf' })],
    xlsx: [new File([xlsxBytes], base + '.xlsx', { type: XLSX_TYPE })],
    txt: [new File([spec.text || ''], base + '.txt', { type: 'text/plain' })],
  };
  return { spec, base, canvases, pngBlobs, jpgBlobs, pdfPages: pdfPages.length, files };
}

async function deliver(files, title) {     // 優先系統分享,不行就逐一下載;回傳 'shared' | 'downloaded' | 'cancelled'
  try { if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files, title }); return 'shared'; } } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  for (const f of files) { const a = el('a', { href: URL.createObjectURL(f), download: f.name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 20000); await delay(400); }
  return 'downloaded';
}
async function download(files) {
  for (const f of files) { const a = el('a', { href: URL.createObjectURL(f), download: f.name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 20000); await delay(400); }
}

/* ---------- 離開確認 ---------- */
function leaveModal(onStay, onLeave) {
  const m = el('div', { class: 'modal', id: 'leaveModal', role: 'dialog' }, el('div', { class: 'modal-box' },
    el('p', {}, '尚未下載,離開後需重新產生。要離開嗎?'),
    el('div', { class: 'row' }, el('button', { class: 'big-btn sm primary', id: 'leaveStay', onclick: () => { m.remove(); onStay(); } }, '繼續留下'), el('button', { class: 'big-btn sm danger', id: 'leaveGo', onclick: () => { m.remove(); onLeave(); } }, '離開'))));
  document.body.append(m);
}

/* ---------- 預覽頁 ---------- */
export function openExportPreview(specOrFn, first) {
  const spec = typeof specOrFn === 'function' ? specOrFn() : specOrFn;     // 每次都由當下資料重新計算
  const state = { delivered: false, selected: { png: true, pdf: true, xlsx: true, txt: true }, tab: first || 'png', urls: [], built: null };
  pushScreen('匯出預覽', (body, entry) => {
    body.classList.add('export-body');
    const hint = el('div', { class: 'banner', id: 'exportHint' }, '檔案不會被保存,離開此頁後需重新產生。內容只在這支手機的記憶體裡,不會上傳。');
    const tabs = el('div', { class: 'chips', id: 'exportTabs' }), view = el('div', { id: 'exportView', class: 'export-view' }), sel = el('div', { class: 'chips', id: 'exportSel' });
    const status = el('div', { class: 'muted', id: 'exportStatus' }, '產生中…');
    const bar = el('div', { class: 'sticky-act' });
    entry.beforeClose = () => {
      if (!Sheets.leaveNeedsConfirm(state)) return true;
      if (!document.getElementById('leaveModal')) leaveModal(() => {}, () => { state.delivered = true; popScreen(); });
      return false;
    };
    entry.s.dataset.export = '1';
    body.append(hint, status, tabs, view, sel, bar);
    entry.onCloseExtra = null;
    const revokeAll = () => { state.urls.forEach(u => URL.revokeObjectURL(u)); state.urls = []; };
    entry.cleanup = revokeAll;
    const url = blob => { const u = URL.createObjectURL(blob); state.urls.push(u); return u; };

    function openViewer(src, label) {
      let zoom = 1;
      const img = el('img', { src, alt: label, class: 'viewer-img' });
      const apply = () => { img.style.width = (zoom * 100) + '%'; };
      const ov = el('div', { class: 'viewer', id: 'viewer' }, el('div', { class: 'viewer-bar' },
        el('button', { class: 'btn sm', onclick: () => { zoom = Math.max(1, zoom - 0.5); apply(); } }, '－'), el('span', {}, label), el('button', { class: 'btn sm', onclick: () => { zoom = Math.min(4, zoom + 0.5); apply(); } }, '＋'), el('button', { class: 'btn sm primary', id: 'viewerClose', onclick: () => ov.remove() }, '關閉')),
        el('div', { class: 'viewer-scroll' }, img));
      apply(); document.body.append(ov);
    }
    function drawView() {
      const b = state.built; view.replaceChildren();
      if (!b) return;
      if (state.tab === 'png') {
        view.append(el('div', { class: 'muted', id: 'pngInfo' }, '共 ' + b.pngBlobs.length + ' 張圖片(點圖可全螢幕、放大)'));
        b.pngBlobs.forEach((blob, i) => { const u = state.pngUrls[i]; view.append(el('img', { class: 'pv-img', src: u, alt: '第 ' + (i + 1) + ' 張', 'data-page': i, onclick: () => openViewer(u, '第 ' + (i + 1) + '/' + b.pngBlobs.length + ' 張') })); });
      } else if (state.tab === 'pdf') {
        view.append(el('div', { class: 'muted', id: 'pdfInfo' }, 'PDF 共 ' + b.pdfPages + ' 頁 · ' + kb(b.files.pdf[0].size) + '。內容是圖片,不可搜尋、不能複製文字。'));
        b.jpgBlobs.forEach((blob, i) => { const u = state.jpgUrls[i]; view.append(el('img', { class: 'pv-img', src: u, alt: '第 ' + (i + 1) + ' 頁', onclick: () => openViewer(u, '第 ' + (i + 1) + '/' + b.jpgBlobs.length + ' 頁') })); });
      } else if (state.tab === 'xlsx') {
        let cur = 0; const sheets = b.spec.sheets || [];
        const st = el('div', { class: 'chips nowrap' }), tb = el('div', { class: 'tbl-wrap' });
        const drawSheet = () => {
          st.replaceChildren(...sheets.map((s, i) => el('button', { class: 'chip' + (i === cur ? ' on' : ''), onclick: () => { cur = i; drawSheet(); } }, s.name)));
          const s = sheets[cur] || { columns: [], rows: [] }, rows = (s.rows || []).slice(0, 50);
          tb.replaceChildren(el('table', { class: 'tbl ro', id: 'xlsxPreview' }, s.columns && s.columns.length ? el('tr', {}, s.columns.map(c => el('th', {}, String(c)))) : null, rows.map(r => el('tr', {}, r.map(v => el('td', { class: typeof v === 'number' ? 'n' : '' }, v == null ? '' : String(v)))))),
            (s.rows || []).length > 50 ? el('div', { class: 'muted small' }, '只顯示前 50 列,共 ' + s.rows.length + ' 列(下載的檔案是完整的)') : null);
        };
        view.append(el('div', { class: 'muted' }, 'Excel 共 ' + sheets.length + ' 個工作表(唯讀預覽)· ' + kb(b.files.xlsx[0].size)), st, tb); drawSheet();
      } else {
        view.append(el('pre', { class: 'stmt-text', id: 'textPreview' }, b.spec.text || '(沒有文字)'));
      }
    }
    const NAMES = { png: '圖片 PNG', pdf: 'PDF', xlsx: 'Excel', txt: '文字' };
    function drawTabs() {
      tabs.replaceChildren(...Object.keys(NAMES).map(k => el('button', { class: 'chip' + (state.tab === k ? ' on' : ''), 'data-tab': k, onclick: () => { state.tab = k; drawTabs(); drawView(); } }, '看 ' + NAMES[k])));
      sel.replaceChildren(el('span', { class: 'muted small' }, '輸出:'), ...Object.keys(NAMES).map(k => el('label', { class: 'sel-chk' }, el('input', { type: 'checkbox', 'data-sel': k, checked: state.selected[k], style: 'width:22px;height:22px', onchange: e => { state.selected[k] = e.target.checked; } }), NAMES[k])));
    }
    const chosen = () => { const b = state.built; let out = []; ['png', 'pdf', 'xlsx', 'txt'].forEach(k => { if (state.selected[k]) out = out.concat(b.files[k]); }); return out; };
    bar.append(
      bigBtn('⬇', '下載', async () => { const f = chosen(); if (!f.length) { alert('請至少勾選一種輸出格式'); return; } await download(f); state.delivered = true; status.textContent = '已下載 ' + f.length + ' 個檔案'; }, 'primary', 'exportDownload'),
      bigBtn('📤', '分享(LINE/雲端硬碟…)', async () => { const f = chosen(); if (!f.length) { alert('請至少勾選一種輸出格式'); return; } const r = await deliver(f, spec.title); if (r !== 'cancelled') { state.delivered = true; status.textContent = r === 'shared' ? '已開啟分享' : '此瀏覽器不支援分享檔案,已改為下載'; } }, '', 'exportShare'),
      bigBtn('↩️', '返回修改', () => popScreen(), '', 'exportBack'));
    bar.querySelectorAll('button').forEach(b => { b.disabled = true; });
    drawTabs();
    buildExport(spec).then(b => {
      state.built = b; state.pngUrls = b.pngBlobs.map(url); state.jpgUrls = b.jpgBlobs.map(url);
      status.textContent = '共 ' + b.pngBlobs.length + ' 張圖片 · PDF ' + b.pdfPages + ' 頁 · Excel ' + (spec.sheets || []).length + ' 個工作表' + (b.pngBlobs.length > 1 ? '。內容較多,已自動分成 ' + b.pngBlobs.length + ' 張' : '');
      bar.querySelectorAll('button').forEach(x => { x.disabled = false; });
      view.__state = state; document.getElementById('exportView').__state = state;
      drawView();
    }).catch(e => { status.textContent = '產生失敗:' + (e && e.message ? e.message : e); });
    view.__state = state;
  }, () => { state.urls.forEach(u => URL.revokeObjectURL(u)); state.urls = []; });
}

// 共用匯出元件:specOrFn 可以是函式(每次按下都重新計算)
export function exportSheet(specOrFn) {
  return el('div', { class: 'export-panel', id: 'exportPanel' },
    el('div', { class: 'export-grid' },
      bigBtn('🖼', '存成圖片 PNG', () => openExportPreview(specOrFn, 'png'), 'primary', 'expPng'),
      bigBtn('📄', '存成 PDF', () => openExportPreview(specOrFn, 'pdf'), '', 'expPdf'),
      bigBtn('📊', '存成 Excel', () => openExportPreview(specOrFn, 'xlsx'), '', 'expXlsx'),
      bigBtn('📝', '複製文字', () => { const s = typeof specOrFn === 'function' ? specOrFn() : specOrFn; copyText(s.text || ''); }, '', 'expText')),
    bigBtn('📤', '分享(LINE/雲端硬碟…)', () => openExportPreview(specOrFn, 'png'), '', 'expShare'),
    el('div', { class: 'muted small' }, '要放進 Google 雲端硬碟:按分享,在 iPhone 分享選單選「Google 雲端硬碟」或「儲存到檔案」。檔案會先給你預覽,不會被保存在 App。'));
}
