/* 規則影子:用「和 firebase_rules.json 同一份」規則字串(js/lib/rules_tj.js)在本機評估讀寫權限。
   給 net_mock 擋寫入、給 tools/test_policy.js 跑 C6 案例。這是模擬,不等於真實 Firebase 的行為(見規則 _說明「需實測」)。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Policy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Firebase 規則字串方法;只在不存在時補上(不可列舉)
  [['matches', function (re) { return re.test(String(this)); }],
   ['beginsWith', function (s) { return String(this).indexOf(s) === 0; }],
   ['contains', function (s) { return String(this).indexOf(s) >= 0; }]].forEach(function (p) {
    if (!String.prototype[p[0]]) Object.defineProperty(String.prototype, p[0], { value: p[1], enumerable: false, configurable: true });
  });

  function isObj(v) { return v !== null && typeof v === 'object'; }
  function parts(p) { return String(p || '').split('/').filter(Boolean); }
  function at(db, ps) {
    var cur = db;
    for (var i = 0; i < ps.length; i++) { if (!isObj(cur)) return null; cur = cur[ps[i]]; }
    return cur === undefined ? null : cur;
  }
  function Snap(v) { this.v = v === undefined ? null : v; }
  Snap.prototype.exists = function () { return this.v !== null; };
  Snap.prototype.val = function () { return this.v; };
  Snap.prototype.child = function (p) { return new Snap(at(this.v, parts(p))); };
  Snap.prototype.isString = function () { return typeof this.v === 'string'; };
  Snap.prototype.isNumber = function () { return typeof this.v === 'number'; };
  Snap.prototype.isBoolean = function () { return typeof this.v === 'boolean'; };
  Snap.prototype.hasChild = function (c) { return isObj(this.v) && this.v[c] !== undefined && this.v[c] !== null; };
  Snap.prototype.hasChildren = function (list) {
    if (!isObj(this.v)) return false;
    if (!list) return Object.keys(this.v).length > 0;
    for (var i = 0; i < list.length; i++) if (!this.hasChild(list[i])) return false;
    return true;
  };

  var fnCache = {};
  function compile(expr, names) {
    var key = names.join(',') + '|' + expr;
    if (!fnCache[key]) fnCache[key] = Function.apply(null, ['auth', 'root', 'data', 'newData', 'now'].concat(names, ['return (' + expr + ');']));
    return fnCache[key];
  }

  function create(rulesObj) {
    var tree = rulesObj.rules || rulesObj;

    function evalExpr(expr, ctx, vars) {
      if (typeof expr === 'boolean') return expr;
      if (typeof expr !== 'string') return false;
      var names = Object.keys(vars);
      try {
        var f = compile(expr, names);
        return !!f.apply(null, [ctx.auth, new Snap(ctx.pre), new Snap(at(ctx.pre, ctx.ps)), new Snap(at(ctx.post, ctx.ps)), ctx.now].concat(names.map(function (n) { return vars[n]; })));
      } catch (e) { return false; }   // 規則求值錯誤 = 拒絕(與 Firebase 相同)
    }
    function child(node, seg, vars) {
      if (Object.prototype.hasOwnProperty.call(node, seg) && seg.charAt(0) !== '.' && seg.charAt(0) !== '$' && isObj(node[seg])) return node[seg];
      var ks = Object.keys(node);
      for (var i = 0; i < ks.length; i++) {
        if (ks[i].charAt(0) === '$' && isObj(node[ks[i]])) { vars[ks[i]] = seg; return node[ks[i]]; }
      }
      return null;
    }
    function mkctx(pre, post, uid, now, ps) {
      return { pre: pre, post: post, auth: uid ? { uid: uid } : null, now: now, ps: ps };
    }

    // 讀:路徑上任一節點的 .read 成立即可
    function canRead(pre, uid, path, now) {
      var ps = parts(path), node = tree, vars = {};
      for (var i = 0; ; i++) {
        if (evalExpr(node['.read'], mkctx(pre, pre, uid, now, ps.slice(0, i)), vars)) return true;
        if (i >= ps.length) return false;
        node = child(node, ps[i], vars);
        if (!node) return false;
      }
    }

    function validateDown(node, ps, vars, ctx) {
      var nd = at(ctx.post, ps);
      if (nd === null) return true;
      var c = Object.assign({}, ctx, { ps: ps });
      if (node['.validate'] !== undefined && !evalExpr(node['.validate'], c, vars)) return false;
      if (isObj(nd)) {
        var keys = Object.keys(nd);
        for (var i = 0; i < keys.length; i++) {
          var v2 = Object.assign({}, vars), n2 = child(node, keys[i], v2);
          if (n2 && !validateDown(n2, ps.concat([keys[i]]), v2, ctx)) return false;
        }
      }
      return true;
    }

    // 寫入一個路徑:granted(祖先或自己的 .write)+ validate(祖先、自己與底下)
    function checkOne(pre, post, uid, now, path) {
      var ps = parts(path), node = tree, vars = {}, granted = false, nodes = [{ node: node, vars: {} }];
      for (var i = 0; ; i++) {
        var ctx = mkctx(pre, post, uid, now, ps.slice(0, i));
        if (!granted && evalExpr(node['.write'], ctx, vars)) granted = true;
        if (i >= ps.length) break;
        var next = child(node, ps[i], vars);
        if (!next) { node = null; break; }
        node = next; nodes.push({ node: node, vars: Object.assign({}, vars) });
      }
      if (!granted) return { ok: false, reason: 'PERMISSION: 沒有寫入權限 ' + path };
      // 祖先 validate(用寫入後資料)
      for (var k = 0; k < nodes.length - (node ? 1 : 0); k++) {
        var ap = ps.slice(0, k), ac = mkctx(pre, post, uid, now, ap);
        if (at(post, ap) !== null && nodes[k].node['.validate'] !== undefined && !evalExpr(nodes[k].node['.validate'], ac, nodes[k].vars)) return { ok: false, reason: 'VALIDATE: ' + ap.join('/') };
      }
      if (node && !validateDown(node, ps, vars, mkctx(pre, post, uid, now, ps))) return { ok: false, reason: 'VALIDATE: ' + path };
      return { ok: true };
    }

    // paths:這次寫入涉及的所有路徑(多路徑 PATCH 就是每個鍵)。pre=寫入前整棵資料,post=寫入後
    function checkWrite(pre, post, uid, paths, now) {
      for (var i = 0; i < paths.length; i++) {
        var r = checkOne(pre, post, uid, now, paths[i]);
        if (!r.ok) return r;
      }
      return { ok: true };
    }
    return { canRead: canRead, checkWrite: checkWrite };
  }

  // ---- UI 用:角色與可做的事(灰按鈕)----
  function roleOf(uid, meta, members) {
    if (!uid || !meta) return null;
    if (meta.ownerUid === uid) return 'owner';
    var m = members && members[uid];
    return m ? m.role : null;
  }
  var CAN = {
    owner: { edit: true, delete: true, invite: true, manage: true },
    editor: { edit: true, delete: false, invite: true, manage: false },
    member: { edit: false, delete: false, invite: false, manage: false },
  };
  function can(role, action) { return !!(role && CAN[role] && CAN[role][action]); }
  function canJoin(role, meta, banned) { return !role && !banned && !!meta && meta.vis === 'public'; }

  return { create: create, roleOf: roleOf, can: can, canJoin: canJoin, Snap: Snap };
});
