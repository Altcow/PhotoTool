// 檔案紀錄:轉 Excel 結果「儲存」、列表、再編輯、分享(LINE/雲端硬碟…)
// 與 app.js 循環匯入:只在函式內使用,不在模組頂層呼叫
import * as DB from './db.js';
import { exportSheet } from './ui_export.js';
import * as Media from './media.js';
import { el, uuid, today, pushScreen, popScreen, makeTable, tableToJson, tableCard, fileBase, anchorDownload, thumbImg, isPdf, toast, attachSaveBar, getSettings, goCamera } from './app.js';

const { KeepPhoto } = window;

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const sheetsForXlsx = sheets => sheets.map(s => ({ name: s.name, columns: s.columns, rows: s.rows }));
const delay = ms => new Promise(r => setTimeout(r, ms));

export function xlsxBlob(sheets) { return new Blob([window.Xlsx.build(sheetsForXlsx(sheets))], { type: XLSX_TYPE }); }

// 把表格結果存成檔案紀錄(同一個表格再按一次是更新同一筆)。照片預設不保留:it.keep 為 true 才寫入原圖(與媒體紀錄)
export async function saveTable(it, opts) {
  opts = opts || {};
  const keep = it.keep !== undefined ? !!it.keep : KeepPhoto.fromSettings(getSettings(), undefined);
  const all = it.photos || [], storedN = it.storedN || 0;
  const stored = all.slice(0, storedN), newOnes = all.slice(storedN);
  const rec = {
    id: it.fileId || uuid(), title: (it.title || '').trim() || ('表格 ' + today()),
    createdAt: it.fileCreated || Date.now(), updatedAt: Date.now(),
    sheets: tableToJson(it).sheets, photos: stored.slice(), location: it.location || null,
  };
  let ids = (it.mediaIds || []).slice(0, storedN);
  if (keep && newOnes.length) {                           // 開啟「保留照片」才走 saveMedia(本機 / 雲端硬碟)
    const nid = await KeepPhoto.persist(newOnes, true, b => Media.saveMedia(b, { kind: 'file', ownerId: rec.id }));
    rec.photos = stored.concat(newOnes); ids = ids.concat(nid); it.storedN = rec.photos.length;
  }
  rec.mediaIds = ids; it.mediaIds = ids;
  await DB.putFile(rec);
  it.fileId = rec.id; it.fileCreated = rec.createdAt;
  if (!it.title) it.title = rec.title;
  if (!opts.silent) toast(KeepPhoto.toast('檔案', keep, newOnes.length));
  if (it.onSaved) it.onSaved(rec);
  return rec;
}

function photoFiles(rec) {
  const base = fileBase({ title: rec.title });
  return (rec.photos || []).map((b, i) => new File([b], base + '-' + (i + 1) + (isPdf(b) ? '.pdf' : '.jpg'), { type: b.type || 'image/jpeg' }));
}
// 優先系統分享(xlsx + 原圖);不支援或不能分享檔案就逐一下載
export async function shareRecord(rec) {
  const base = fileBase({ title: rec.title });
  const xf = new File([xlsxBlob(rec.sheets)], base + '.xlsx', { type: XLSX_TYPE });
  const files = [xf].concat(photoFiles(rec));
  try {
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title: rec.title });
      return 'shared';
    }
  } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; /* 其他錯誤改用下載 */ }
  for (const f of files) { anchorDownload(f, f.name); await delay(400); }
  return 'downloaded';
}

export async function saveAndShare(it) {
  const rec = await saveTable(it);
  const r = await shareRecord(rec);
  if (r === 'downloaded') alert('此瀏覽器不支援系統分享,已改為下載檔案(' + (1 + (rec.photos || []).length) + ' 個)。');
}

export function openFiles() {
  pushScreen('檔案', (body, entry) => {
    const draw = async () => {
      const all = (await DB.allFiles()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      body.replaceChildren();
      if (!all.length) { body.append(el('div', { class: 'empty', id: 'filesEmpty' }, '還沒有檔案。拍表格轉成 Excel,按「儲存」就會放在這裡。'), el('button', { class: 'big-btn primary', id: 'filesEmptyGo', onclick: () => goCamera('table') }, el('span', { class: 'bi' }, '📝'), el('span', { class: 'bt' }, '去拍表格'))); return; }
      const list = el('div', { id: 'fileList' });
      all.forEach(r => {
        const img = (r.photos || []).find(b => !isPdf(b));
        const d = new Date(r.updatedAt || r.createdAt || 0);
        list.append(el('button', { class: 'rec file-row', 'data-id': r.id, onclick: () => openFileDetail(r.id) },
          el('div', { class: 'file-th' }, img ? thumbImg(img, '縮圖') : el('span', {}, '📊')),
          el('div', { class: 'meta' }, el('b', {}, r.title), el('span', { class: 'muted small' }, d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' · ' + (r.sheets || []).length + ' 個工作表 · ' + (r.photos || []).length + ' 張原圖'))));
      });
      body.append(list);
    };
    entry.refresh = draw;
    draw();
  });
}

function openFileDetail(id) {
  pushScreen('檔案內容', async (body, entry) => {
    const rec = await DB.getFile(id);
    if (!rec) { body.append(el('div', { class: 'empty' }, '找不到這個檔案')); return; }
    const it = makeTable({ title: rec.title, sheets: rec.sheets });
    it.fileId = rec.id; it.fileCreated = rec.createdAt; it.photos = rec.photos || []; it.mediaIds = rec.mediaIds || []; it.location = rec.location; it.storedN = it.photos.length; it.hideSave = true;
    const box = el('div');
    const urls = [];
    const draw = () => box.replaceChildren(tableCard(it, draw, true));
    draw();
    const photos = el('div');
    (rec.photos || []).forEach(b => { if (isPdf(b)) { photos.append(el('div', { class: 'muted small' }, '(PDF 原檔 ' + Math.round(b.size / 1024) + ' KB)')); return; } const u = URL.createObjectURL(b); urls.push(u); photos.append(el('img', { class: 'photo-view', src: u, alt: '原圖' })); });
    entry.onClose = () => urls.forEach(u => URL.revokeObjectURL(u));
    const sbF = attachSaveBar(entry, { id: 'btnSaveFile', onSave: async () => { await saveTable(it, { silent: true }); return { toast: KeepPhoto.toast('檔案', false, 0) }; } });
    sbF.trackInputs(body); body.addEventListener('click', e => { if (e.target.closest && e.target.closest('#tableCard button')) sbF.markDirty(); });
    it.onSaved = () => sbF.markSaved({ where: '檔案' });
    const nPh = (rec.photos || []).length;
    body.append(el('div', { class: 'row', style: 'margin:8px 0', id: 'filePhotoInfo' }, el('span', { class: 'muted grow' }, KeepPhoto.detailText(nPh)), nPh ? el('button', { class: 'btn sm danger', id: 'btnDelFilePhotos', onclick: async () => { if (!confirm('刪除這個檔案的 ' + nPh + ' 張原圖?(只刪照片,表格保留)')) return; for (const mid of (rec.mediaIds || [])) { if (mid) await Media.deleteMedia(mid); } rec.photos = []; rec.mediaIds = []; await DB.putFile(rec); toast('已刪除照片,釋放空間'); popScreen(); openFileDetail(id); } }, '🗑 刪除照片') : null));
    body.append(box, el('h3', {}, '匯出'), exportSheet(() => window.Sheets.table(it.title || '表格', it.sheets.map(s => ({ name: s.name, columns: s.columns, rows: s.rows })))), el('label', { class: 'f' }, '原圖'), photos,
      el('button', { class: 'btn danger block', id: 'fileDelete', style: 'margin-top:14px', onclick: async () => { if (confirm('確定刪除這個檔案(含原圖)?')) { await DB.deleteFile(id); popScreen(); } } }, '刪除檔案'));
  });
}
