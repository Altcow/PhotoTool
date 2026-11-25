const VERSION = 'v14';
const CACHE = 'phototool-' + VERSION;
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/v3.css',
  './css/tj.css',
  './css/tj_theme.css',
  './img/wall_login_p.webp',
  './img/wall_login_l.webp',
  './img/wall_p.webp',
  './img/wall_l.webp',
  './img/tex_wood.webp',
  './img/tex_cork.webp',
  './img/frame_red.webp',
  './img/disc_wood.webp',
  './js/app.js',
  './js/db.js',
  './js/ai.js',
  './js/config.js',
  './js/net.js',
  './js/net_mock.js',
  './js/net_firebase.js',
  './js/netctx.js',
  './js/ui_files.js',
  './js/ui_menu.js',
  './js/ui_room.js',
  './js/ui_ledger.js',
  './js/ui_export.js',
  './js/ui_cloud.js',
  './js/ui_paste.js',
  './js/cloud.js',
  './js/auth.js',
  './js/journalnet.js',
  './js/busy.js',
  './js/ui_form.js',
  './js/ui_event.js',
  './js/tjctx.js',
  './js/ui_login.js',
  './js/ui_jhome.js',
  './js/ui_journal.js',
  './js/ui_account.js',
  './js/media.js',
  './js/lib/split.js',
  './js/lib/aggregate.js',
  './js/lib/reconcile.js',
  './js/lib/xlsx.js',
  './js/lib/order.js',
  './js/lib/menu.js',
  './js/lib/rtdb.js',
  './js/lib/qr.js',
  './js/lib/settle.js',
  './js/lib/ledger.js',
  './js/lib/stats.js',
  './js/lib/render.js',
  './js/lib/pdf.js',
  './js/lib/sheets.js',
  './js/lib/drive.js',
  './js/lib/uploadq.js',
  './js/lib/cloudgate.js',
  './js/lib/modes.js',
  './js/lib/tabletext.js',
  './js/lib/receipt.js',
  './js/lib/savebar.js',
  './js/lib/guide.js',
  './js/lib/keepphoto.js',
  './js/lib/flags.js',
  './js/lib/journal.js',
  './js/lib/authrest.js',
  './js/lib/rules_tj.js',
  './js/lib/policy.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache:'reload' 繞過瀏覽器 HTTP 快取(GitHub Pages 會快取 10 分鐘),避免新版快取裡裝到舊檔
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('phototool-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API 等跨網域請求不攔截
  if (url.pathname.endsWith('/version.json')) return; // 版本檢查永遠走網路
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    })
  );
});
