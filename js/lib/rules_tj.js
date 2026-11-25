/* 旅遊日誌的 Firebase 安全規則定義(巨集展開)。tools/rules_src.js 用它產生 tools/firebase_rules.json;
   js/lib/policy.js 用同一份規則字串在本機模擬(規則影子),所以兩邊不會各寫一套。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RulesTj = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // ---- 巨集(C2)----
  var A = 'auth != null';
  var MEM = "root.child('tj/jmem/'+$jid+'/'+auth.uid).exists()";
  var OWN = "root.child('tj/jmeta/'+$jid+'/ownerUid').val() === auth.uid";
  var EDIT = "(" + OWN + " || root.child('tj/jmem/'+$jid+'/'+auth.uid+'/role').val() === 'editor')";
  var PUB = "root.child('tj/jmeta/'+$jid+'/vis').val() === 'public'";
  var BAN = "root.child('tj/jban/'+$jid+'/'+auth.uid).exists()";
  var MKEY = "'tj/jm/'+$jid+'/'+$k+'/meta/";
  var MOPEN = "(root.child(" + MKEY + "status').val() === 'open' && (!root.child(" + MKEY + "deadline').exists() || root.child(" + MKEY + "deadline').val() >= now))";
  var MGR = "root.child(" + MKEY + "managerUid').val() === auth.uid";
  function HTTPS(v) { return v + ".isString() && " + v + ".val().beginsWith('https://') && " + v + ".val().length <= 2000"; }

  // ---- 欄位型別小工具 ----
  function str(min, max) { return { '.validate': 'newData.isString() && newData.val().length >= ' + min + ' && newData.val().length <= ' + max }; }
  var num = { '.validate': 'newData.isNumber()' };
  var bool = { '.validate': 'newData.isBoolean()' };
  var https = { '.validate': HTTPS('newData') };
  function oneOf(list) { return { '.validate': 'newData.isString() && (' + list.map(function (x) { return "newData.val() === '" + x + "'"; }).join(' || ') + ')' }; }
  function matches(re) { return { '.validate': 'newData.isString() && newData.val().matches(' + re + ')' }; }
  var DATE = matches('/^\\d{4}-\\d{2}-\\d{2}$/');
  var TIME = matches('/^\\d{2}:\\d{2}$/');
  var HEX64 = '/^[0-9a-f]{64}$/';
  // 建立時必須是伺服器時間,之後不可改
  var createdNow = { '.validate': 'newData.isNumber() && (data.exists() ? newData.val() === data.val() : newData.val() === now)' };
  var updNow = { '.validate': 'newData.isNumber() && newData.val() === now' };
  var revUp = { '.validate': 'newData.isNumber() && (!data.exists() || newData.val() >= data.val())' };
  var OTHER = { '.validate': 'false' };
  function obj(children, required, extra) {
    var o = Object.assign({}, extra || {}, children);
    if (required && required.length) o['.validate'] = "newData.hasChildren(['" + required.join("','") + "'])";
    o.$other = OTHER;
    return o;
  }
  var JID_LEN = 10;   // 與 js/lib/journal.js 的預設 jid 長度一致(config.js JOURNAL_RULES.jidLen 改了這裡也要改)
  var IDX_RE = '/^[A-HJ-NP-Z2-9]{' + JID_LEN + '}$/';
  var SLOT = {
    n: '/^n(0[1-9]|[1-4][0-9]|50)$/', l: '/^l(0[1-9]|[12][0-9]|30)$/', e: '/^e(00[1-9]|0[1-9][0-9])$/',
    b: '/^b(0[1-9]|[1-5][0-9]|60)$/', p: '/^p(0[1-9]|[1-7][0-9]|80)$/', s: '/^s(00[1-9]|0[1-9][0-9]|1[0-9][0-9]|200)$/', k: '/^e\\d{3}_b\\d{2}$/',
  };
  function slotKey(re, v) { return v + '.matches(' + re + ')'; }

  function build() {
    var jmemWrite = A + ' && ('
      // 1. 建立者入列
      + '(auth.uid === $uid && !data.exists() && ' + OWN + " && newData.child('role').val() === 'owner')"
      // 2. 加入公開
      + ' || (auth.uid === $uid && !data.exists() && ' + PUB + ' && !' + BAN + " && newData.child('role').val() === 'member' && newData.child('via').val() === 'public')"
      // 3. 密碼加入私密(先寫 jtry 登記,再寫成員)
      + ' || (auth.uid === $uid && !data.exists() && !' + BAN + " && newData.child('role').val() === 'member' && newData.child('via').val() === 'pw'"
      + " && root.child('tj/jkeys/'+$jid+'/'+newData.child('jk').val()).exists() && root.child('tj/jtry/'+$jid+'/'+$uid+'/key').val() === newData.child('jk').val())"
      // 4. 本人改名(role/joinedAt 不變)或退出(非主編)
      + " || (auth.uid === $uid && data.exists() && ((newData.exists() && newData.child('role').val() === data.child('role').val() && newData.child('joinedAt').val() === data.child('joinedAt').val())"
      + " || (!newData.exists() && data.child('role').val() !== 'owner')))"
      // 5. 主編管理別人(改 role、移除、直接加回)
      + ' || (' + OWN + ' && $uid !== auth.uid && (!newData.exists() || ((newData.child(\'role\').val() === \'member\' || newData.child(\'role\').val() === \'editor\')'
      + " && (data.exists() ? newData.child('joinedAt').val() === data.child('joinedAt').val() : newData.child('via').val() === 'owner'))))"
      + ')';

    var orderWrite = A + ' && ' + "root.child('tj/jmem/'+$jid+'/'+auth.uid).exists()" + ' && ' + MOPEN + ' && ('
      + "newData.exists() ? (newData.child('uid').val() === auth.uid && (!data.exists() || data.child('uid').val() === auth.uid)) : (data.child('uid').val() === auth.uid || " + MGR + ' || ' + EDIT + '))';

    var jBlockFields = obj({
      type: oneOf(['text', 'photo', 'file', 'nav', 'menu']), order: num, title: str(0, 60), text: str(0, 4000), url: https,
      mime: str(0, 20), updatedAt: num, by: str(1, 128), driveId: str(0, 100), size: num,
    }, ['type', 'order']);

    var jmetaNode = obj({
      '.read': 'true',
      '.write': A + " && ((!data.exists() && newData.child('ownerUid').val() === auth.uid) || data.child('ownerUid').val() === auth.uid)",
      title: str(1, 60), ownerUid: { '.validate': 'newData.isString() && (!data.exists() || newData.val() === data.val())' },
      ownerName: str(1, 30), vis: oneOf(['public', 'private']), start: DATE, end: DATE, tz: str(0, 40),
      createdAt: createdNow, updatedAt: updNow, schema: { '.validate': 'newData.val() === 1' }, calendarRev: revUp,
      prevRange: obj({ start: DATE, end: DATE }),
    }, ['title', 'ownerUid', 'ownerName', 'vis', 'createdAt', 'updatedAt', 'schema']);
    jmetaNode['.validate'] = '$jid.matches(' + IDX_RE + ") && newData.hasChildren(['title','ownerUid','ownerName','vis','createdAt','updatedAt','schema'])";

    var rules = {
      '.read': false, '.write': false,
      tj: {
        users: {
          $uid: {
            '.read': A + ' && auth.uid === $uid', '.write': A + ' && auth.uid === $uid',
            profile: obj({
              '.read': A,
              name: str(1, 30), createdAt: { '.validate': 'newData.isNumber() && (!data.exists() || newData.val() === data.val())' },
              avatar: obj({ t: oneOf(['initial', 'emoji', 'photo', 'google']), v: str(0, 16000), c: matches('/^#[0-9a-fA-F]{6}$/') }, ['t']),
            }, ['name', 'createdAt']),
            idx: { $jid: obj({ role: oneOf(['owner', 'editor', 'member']), title: str(1, 60), start: str(0, 10), at: num }, ['role', 'title', 'at']) },
            follows: { $jid: obj({ title: str(1, 60), start: str(0, 10), at: num }, ['title', 'at']) },
            $other: OTHER,
          },
        },
        dir: {
          '.read': A,
          $jid: obj({ title: str(1, 60), ownerName: str(0, 30), vis: oneOf(['public', 'private']), start: str(0, 10), end: str(0, 10), updatedAt: updNow }, ['title', 'vis', 'updatedAt'],
            { '.write': A + ' && ' + OWN }),
        },
        jmeta: { $jid: jmetaNode },
        jsec: {
          $jid: obj({
            '.read': A + ' && ' + EDIT, '.write': A + ' && ' + OWN,
            pw: str(4, 12),
            inv: obj({ code: matches('/^[0-9a-f]{32}$/'), exp: num }, ['code', 'exp']),
          }),
        },
        jkeys: { $jid: { '.write': A + ' && ' + OWN, $h: { '.validate': '$h.matches(' + HEX64 + ') && newData.hasChildren([\'at\'])', at: num, $other: OTHER } } },
        jtry: {
          $jid: {
            '.read': A + ' && ' + OWN, '.write': A + ' && ' + OWN + ' && !newData.exists()',
            $uid: {
              '.read': A + ' && auth.uid === $uid',
              '.write': A + ' && ((auth.uid === $uid && newData.exists() && newData.child(\'n\').val() >= 1 && newData.child(\'n\').val() <= 5 && ((newData.child(\'n\').val() === 1 && (!data.exists() || data.child(\'ts\').val() + 3600000 < now)) || (data.exists() && newData.child(\'n\').val() === data.child(\'n\').val() + 1))) || (' + OWN + ' && !newData.exists()))',
              '.validate': "newData.hasChildren(['n','ts','key'])",
              n: num, ts: { '.validate': 'newData.isNumber() && newData.val() === now' }, key: { '.validate': 'newData.isString() && newData.val().matches(' + HEX64 + ')' }, $other: OTHER,
            },
          },
        },
        jmem: {
          $jid: {
            '.read': A + ' && ' + MEM, '.write': A + ' && ' + OWN + ' && !newData.exists()',
            $uid: obj({
              '.write': jmemWrite,
              name: str(1, 30),
              role: { '.validate': "newData.isString() && (newData.val() === 'member' || newData.val() === 'editor' || (newData.val() === 'owner' && $uid === root.child('tj/jmeta/'+$jid+'/ownerUid').val()))" },
              joinedAt: num, via: oneOf(['create', 'public', 'pw', 'owner']), jk: { '.validate': 'newData.isString() && newData.val().matches(' + HEX64 + ')' },
            }, ['name', 'role', 'joinedAt']),
          },
        },
        jban: { $jid: { '.read': A + ' && ' + MEM, '.write': A + ' && ' + OWN, $uid: { '.read': A + ' && auth.uid === $uid', '.validate': "newData.hasChildren(['name','at'])", name: str(0, 30), at: num, $other: OTHER } } },
        jreq: {
          $jid: {
            '.read': A + ' && ' + OWN, '.write': A + ' && ' + OWN + ' && !newData.exists()',
            $uid: {
              '.read': A + ' && auth.uid === $uid',
              '.write': A + ' && ((auth.uid === $uid && (!newData.exists() || (' + MEM + ' && (!data.exists() || data.child(\'at\').val() + 86400000 < now)))) || (' + OWN + ' && !newData.exists()))',
              '.validate': "newData.hasChildren(['name','at','kind'])",
              name: str(1, 30), at: { '.validate': 'newData.isNumber() && newData.val() === now' }, kind: { '.validate': "newData.val() === 'editor'" }, $other: OTHER,
            },
          },
        },
        j: {
          $jid: {
            '.read': PUB + ' || (' + A + ' && ' + MEM + ')',
            '.write': A + ' && ' + OWN + ' && !newData.exists()',
            about: obj({ '.write': A + ' && ' + EDIT, text: str(0, 2000), leader: str(0, 30), leaderUid: str(0, 128), phone: str(0, 30), updatedAt: num, updatedBy: str(1, 128) }, ['text']),
            notices: { $n: obj({ '.write': A + ' && ' + EDIT, '.validate': slotKey(SLOT.n, '$n') + " && newData.hasChildren(['title','body','order','at','by'])", title: str(1, 60), body: str(0, 2000), pinned: bool, order: num, at: num, by: str(1, 128), updatedAt: num }) },
            links: { $l: obj({ '.write': A + ' && ' + EDIT, '.validate': slotKey(SLOT.l, '$l') + " && newData.hasChildren(['title','url','order'])", title: str(1, 60), url: https, order: num }) },
            events: {
              $e: obj({
                '.write': A + ' && ' + EDIT, '.validate': slotKey(SLOT.e, '$e') + " && newData.hasChildren(['title','order','createdAt','by'])",
                title: str(1, 60), date: DATE, order: num, createdAt: num, by: str(1, 128), updatedAt: num,
                time: TIME, endTime: TIME, tz: str(0, 40), location: str(0, 120), mapUrl: https, desc: str(0, 1000), rev: revUp,
                prev: obj({ date: str(0, 10), time: str(0, 5), endTime: str(0, 5), location: str(0, 120), title: str(0, 60) }), changedAt: num,
              }),
            },
            phrases: { $p: obj({ '.write': A + ' && ' + EDIT, '.validate': slotKey(SLOT.p, '$p') + " && newData.hasChildren(['zh','tl'])", zh: str(1, 200), tl: str(1, 400), lang: str(0, 10), roma: str(0, 400), cat: str(0, 20), order: num }) },
            blocks: { $e: { '.write': A + ' && ' + EDIT + ' && !newData.exists()', $b: Object.assign({}, jBlockFields, { '.write': A + ' && ' + EDIT, '.validate': slotKey(SLOT.e, '$e') + ' && ' + slotKey(SLOT.b, '$b') + " && newData.hasChildren(['type','order'])" }) } },
          },
        },
        jm: {
          $jid: {
            '.read': A + ' && ' + MEM, '.write': A + ' && ' + OWN + ' && !newData.exists()',
            $k: {
              '.validate': slotKey(SLOT.k, '$k'),
              meta: obj({
                '.write': A + ' && (' + EDIT + ' || ' + MGR + ')',
                title: str(1, 60), status: oneOf(['open', 'closed']), managerUid: { '.validate': "newData.isString() && root.child('tj/jmem/'+$jid+'/'+newData.val()).exists()" },
                closeSeq: num, closedAt: num, closedBy: str(0, 128), deadline: num, mergeMode: oneOf(['separate', 'merged']), shopTotal: num, fee: num, createdAt: num,
              }, ['title', 'status', 'managerUid']),
              menus: { $m: { '.write': A + ' && (' + EDIT + ' || ' + MGR + ') && ' + MOPEN, '.validate': "newData.hasChildren(['id'])" } },
              orders: {
                $o: obj({
                  '.write': orderWrite, '.validate': slotKey(SLOT.s, '$o') + " && newData.hasChildren(['uid','name','itemName','qty','ts'])",
                  uid: str(1, 128), name: str(1, 30), menuId: str(0, 64), itemId: str(0, 64), itemName: str(1, 80), size: str(0, 20), ice: str(0, 20), sugar: str(0, 20),
                  toppings: { $i: str(1, 30) }, qty: { '.validate': 'newData.isNumber() && newData.val() >= 1 && newData.val() <= 99' },
                  unitPrice: { '.validate': 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 100000' }, note: str(0, 200), ts: num,
                }),
              },
            },
          },
        },
      },
    };
    return { rules: rules };
  }

  var NOTE = [
    '貼進「你自己的」Firebase 專案 → Realtime Database → 規則。不要用別人的專案。本檔由 tools/rules_src.js 產生(來源 js/lib/rules_tj.js),請改來源再重新產生,不要手改。',
    '【狀態】v11:宗旨(j/<jid>/about)新增 leaderUid 欄位(領隊=成員代號);其餘與 v10 相同,v10 規則已在真實 Firebase 驗證過。貼上後請跑 node tools/test_rules_rest.js <資料庫網址> <API金鑰>(資料庫網址與 API 金鑰在 js/config.js),全過才發版。',
    '【不含 pt/rooms】舊的 v3 開團房規則已移除(H-11)。要回復需把舊規則段貼回。',
    '【只靠客戶端、規則做不到】私密密碼每帳號每小時 5 次但可多註冊帳號猜;每人建立日誌數與成員人數上限;兩位編輯同時改同一區塊後寫覆蓋;整本刪除多路徑中途失敗會留殘留(重按刪除即可)。',
    '【白話提醒】開放註冊:任何拿到網址的人都能註冊並看到「所有日誌」的標題;公開日誌連結外流時,不用註冊就能看宗旨、公告、行程。不想這樣就設私密。',
    '【需實測】多路徑 PATCH 時 root 是否為寫入前狀態;.validate 是否於祖先節點評估;server timestamp 與 === now;401 錯誤內容可否分辨過期與 Permission denied。',
  ];
  return { build: build, NOTE: NOTE, JID_LEN: JID_LEN, macros: { A: A, MEM: MEM, OWN: OWN, EDIT: EDIT, PUB: PUB, BAN: BAN, MOPEN: MOPEN, MGR: MGR, HTTPS: HTTPS } };
});
