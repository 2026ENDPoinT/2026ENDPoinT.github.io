/* ==============================================================
   ENDPoinT 제출 · 현황판 공통 스크립트  (window.EP)
   --------------------------------------------------------------
   - 구글 로그인: index.html 의 EPSession 과 같은 저장 열쇠를 써서, 같은 탭에서 이미 로그인했으면 그대로 이어진다.
   - 서버 호출: Apps Script 웹 앱에 text/plain POST (preflight 를 피하려는 것 — BACKEND.md 5절).
   - 파일 올리기: 서버가 발급한 Drive 이어 올리기 주소로 브라우저가 직접 보낸다. 직접 보내기가 막힌
     환경이면 조각을 서버에 넘겨 대신 올리게 한다 (느리지만 어디서나 된다).
   - 파일 받기: 서버가 조각으로 넘겨 주는 것을 이어 붙인다 (Drive 권한이 없어도 받을 수 있다).
   - 설정(EPSUBMIT.ENDPOINT)이 비어 있으면 아무것도 보내지 않는다. 로컬에서는 미리보기 모드(예시 자료)로,
     배포된 사이트에서는 '준비 중' 안내로 열린다.
   ============================================================== */
(function () {
  'use strict';

  var CFG = window.EPSUBMIT || {};
  var loc = window.location;
  var host = String(loc.hostname || '').toLowerCase();
  var LOCAL = loc.protocol === 'file:' || host === '' || host === 'localhost' || host === '127.0.0.1' ||
    host === '::1' || host === '[::1]' || /\.local$/.test(host) ||
    /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host);
  // 로컬에서는 ?demo=1 로 설정이 있어도 미리보기를 볼 수 있다. 배포된 사이트에서는 무시한다.
  var DEMO = !CFG.ENDPOINT || !CFG.CLIENT_ID || (LOCAL && /[?&]demo=1/.test(loc.search || ''));
  // 배포된 사이트인데 서버 주소가 아직 없다 — 예시 자료를 진짜처럼 보여 주지 않고 '준비 중' 이라고만 알린다.
  // (로컬에서는 ?pending=1 로 그 모습을 볼 수 있다)
  var PENDING = LOCAL ? /[?&]pending=1/.test(loc.search || '') : (!CFG.ENDPOINT || !CFG.CLIENT_ID);
  var MB = 1024 * 1024;

  /* ------------------------------ 작은 도구 ------------------------------ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(id) { return document.getElementById(id); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function nonce() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function mkErr(code, extra) {
    var e = new Error(code);
    e.code = code;
    if (extra) Object.keys(extra).forEach(function (k) { if (k !== 'ok') e[k] = extra[k]; });
    return e;
  }
  function apiErr(d) { return mkErr((d && d.error) || 'BAD_RESPONSE', d || {}); }
  function p2(n) { return (n < 10 ? '0' : '') + n; }

  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + 'B';
    if (n < MB) return Math.round(n / 1024) + 'KB';
    if (n < 1024 * MB) return (n / MB).toFixed(n < 10 * MB ? 1 : 0) + 'MB';
    return (n / (1024 * MB)).toFixed(2) + 'GB';
  }
  /** 서울 시각으로 쪼갠다 (보는 사람의 시간대와 무관하게) */
  function kst(ms) {
    var d = new Date(Number(ms) + 9 * 3600000);
    return { M: d.getUTCMonth() + 1, D: d.getUTCDate(), h: d.getUTCHours(), m: d.getUTCMinutes(), w: '일월화수목금토'.charAt(d.getUTCDay()) };
  }
  /** '11.14 09:41' */
  function fmtTime(ms) { if (!ms) return ''; var k = kst(ms); return p2(k.M) + '.' + p2(k.D) + ' ' + p2(k.h) + ':' + p2(k.m); }
  /** '11.14 (토) 10:00' */
  function fmtDay(ms) { if (!ms) return ''; var k = kst(ms); return p2(k.M) + '.' + p2(k.D) + ' (' + k.w + ') ' + p2(k.h) + ':' + p2(k.m); }
  /** 남은 시간 '3:12:45' · '2일 03:12:45' */
  function fmtLeft(ms) {
    if (!(ms > 0)) return '마감';
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400);
    s -= d * 86400;
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (d ? d + '일 ' + p2(h) : h) + ':' + p2(m) + ':' + p2(x);
  }
  function extOf(name) { var m = /\.([A-Za-z0-9]{1,10})$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; }
  function hostOf(url) { var m = /^https?:\/\/([^\/?#]+)/i.exec(String(url || '')); return m ? m[1] : ''; }

  var MSG = {
    AUTH_FAILED: '로그인이 만료됐습니다. 다시 로그인해 주세요.',
    NOT_MEMBER: '이 계정은 팀 명단에 없습니다.',
    CLOSED: '제출이 마감되어 더 고칠 수 없습니다.',
    LATE: '마감 시각이 지나 받지 못했습니다. 운영진에게 바로 알려 주세요.',
    NOT_OPEN_YET: '아직 제출을 받기 전입니다.',
    BAD_TYPE: '이 형식의 파일은 받지 않습니다.',
    BAD_KIND: '이 형식의 파일은 받지 않습니다.',
    TOO_LARGE: '파일이 너무 큽니다.',
    BAD_SIZE: '빈 파일은 올릴 수 없습니다.',
    EMPTY: '빈 파일은 올릴 수 없습니다.',
    TOO_MANY: '너무 자주 시도했습니다. 잠시 뒤에 다시 해 주세요.',
    BUSY: '지금 제출이 몰려 있습니다. 잠시 뒤에 다시 시도해 주세요.',
    INVALID: '입력한 값을 확인해 주세요.',
    NOT_UPLOADED: '파일이 끝까지 올라가지 않았습니다. 다시 올려 주세요.',
    SESSION_GONE: '올리던 연결이 끊겼습니다. 다시 올려 주세요.',
    SESSION_LOST: '올리던 연결이 끊겼습니다. 다시 올려 주세요.',
    BAD_STATE: '이미 처리된 파일입니다. 새로 고쳐 확인해 주세요.',
    DRIVE_ERROR: '저장소가 잠시 응답하지 않습니다. 조금 뒤에 다시 시도해 주세요.',
    DRIVE_API_OFF: '서버 설정이 아직 끝나지 않았습니다. 운영진에게 알려 주세요.',
    DRIVE_FULL: '저장소가 가득 차서 올릴 수 없습니다. 운영진에게 바로 알려 주세요.',
    TEAM_FULL: '이 팀이 올려 둘 수 있는 전체 용량을 넘었습니다. 운영진에게 알려 주세요.',
    AUTH_BUSY: '지금 로그인 확인이 몰려 있습니다. 잠시 뒤에 다시 시도해 주세요.',
    VOTE_NOT_OPEN: '아직 이 트랙의 투표가 열리지 않았습니다.',
    VOTE_CLOSED: '이 트랙의 투표가 마감되었습니다.',
    VOTE_TOO_MANY: '한 사람이 낼 수 있는 표보다 많이 골랐습니다.',
    VOTE_DUP: '같은 팀을 두 번 고를 수 없습니다.',
    VOTE_SELF: '우리 팀에는 투표할 수 없습니다.',
    VOTE_BAD_TEAM: '이 트랙의 팀만 고를 수 있습니다.',
    VOTE_EMPTY: '팀을 한 곳 이상 골라 주세요.',
    NOT_ADMIN: '운영진만 할 수 있습니다.',
    BAD_TRACK: '트랙을 다시 골라 주세요.',
    KEY_INVALID: '열람 링크가 만료됐거나 올바르지 않습니다.',
    NOT_FOUND: '파일을 찾지 못했습니다. 새로 고쳐 확인해 주세요.',
    FILE_GONE: '파일이 저장소에 없습니다. 운영진에게 알려 주세요.',
    NETWORK: '네트워크가 불안정합니다. 연결을 확인하고 다시 시도해 주세요.',
    BAD_RESPONSE: '서버가 잠시 응답하지 못했습니다. 다시 시도해 주세요.',
    SERVER_ERROR: '서버에서 오류가 났습니다. 잠시 뒤에 다시 시도해 주세요.',
    CANCELLED: '올리기를 취소했습니다.'
  };
  /** 오류를 사람이 읽을 문장으로 */
  function say(e) {
    var code = (e && (e.code || e.error)) || (e && e.name === 'AbortError' ? 'NETWORK' : '') || (e && e.message) || '';
    if (MSG[code]) return MSG[code];
    if (/^HTTP_|Failed to fetch|NetworkError|Load failed/i.test(code)) return MSG.NETWORK;
    return '문제가 생겼습니다. 다시 시도해 주세요. (' + String(code).slice(0, 60) + ')';
  }

  function spin(cls) {
    return '<svg class="spin ' + (cls || '') + '" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12"></circle></svg>';
  }
  function loading(text) {
    return '<div class="loading" role="status">' + spin('') + '<span>' + esc(text == null ? '불러오는 중' : text) + '</span></div>';
  }
  var toastTimer = 0;
  function toast(text) {
    var el = $('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 3200);
  }

  /* ------------------------------ 시계 ------------------------------ */
  // 마감 판정은 서버가 한다. 화면의 남은 시간도 서버 시각에 맞춰 보여 준다 (컴퓨터 시계가 틀려도 같게).
  var skew = 0;
  function now() { return Date.now() + skew; }
  function sync(serverNow) { if (serverNow > 0) skew = serverNow - Date.now(); }

  /* ------------------------------ 로그인 ------------------------------ */
  // 구글 로그인 토큰은 한 시간이면 끝난다. 서버가 그 토큰을 한 번 확인하면 세션 값(sid)을 돌려주고,
  // 그 뒤로는 세션 값으로 이어 간다 — 밤새 열어 둔 화면이 끊기거나, 큰 파일을 올리는 도중에 끊기지 않게.
  var Session = (function () {
    var KEY = 'endpoint.session.v1';     // index.html 의 EPSession 과 같은 열쇠 (구글 로그인 토큰)
    var SID = 'endpoint.submit.sid';     // 제출 서버가 준 세션 값
    var user = null, subs = [], waiters = [], inited = false, initWait = [], keptAt = 0;

    function decodeJWT(t) {
      try {
        var b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(decodeURIComponent(atob(b).split('').map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join('')));
      } catch (e) { return null; }
    }
    function tokenOk(u) { return !!(u && u.token && (!u.exp || u.exp * 1000 > Date.now() + 30000)); }
    function sidOk(u) { return !!(u && u.sid && u.until > Date.now() + 15000); }
    function fresh(u) { return !!u && (DEMO ? !!u.demo : (!u.demo && (sidOk(u) || tokenOk(u)))); }
    function read(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } }
    function persist() {
      if (DEMO) return;                  // 미리보기 로그인은 저장하지 않는다 (진짜 로그인과 섞이지 않게)
      try {
        if (tokenOk(user)) {
          sessionStorage.setItem(KEY, JSON.stringify({ token: user.token, email: user.email, name: user.name, sub: user.sub, pic: user.pic, exp: user.exp }));
        } else sessionStorage.removeItem(KEY);
        if (user && user.sid) {
          sessionStorage.setItem(SID, JSON.stringify({ sid: user.sid, until: user.until, email: user.email, name: user.name, sub: user.sub, pic: user.pic }));
        } else sessionStorage.removeItem(SID);
      } catch (e) {}
    }
    function get() { return fresh(user) ? user : null; }
    /** why: 'login' 새로 로그인 · 'logout' 스스로 로그아웃 · 'expired' 시간이 지났거나 서버가 받아 주지 않음 */
    function emit(why) {
      var u = get();
      subs.forEach(function (f) { try { f(u, why || ''); } catch (e) {} });
      if (u || why === 'logout') { var w = waiters; waiters = []; w.forEach(function (f) { try { f(u); } catch (e) {} }); }
    }

    if (!DEMO) {
      var g = read(KEY), k = read(SID);
      if (!tokenOk(g)) g = null;
      if (k && !(k.sid && k.sub && k.email)) k = null;
      if (g && k && g.sub !== k.sub) k = null;            // 그 사이에 다른 계정으로 로그인했다
      if (g) user = { token: g.token, email: g.email, name: g.name || g.email, sub: g.sub, pic: g.pic || '', exp: g.exp };
      if (k) {
        if (!user) user = { token: '', email: k.email, name: k.name || k.email, sub: k.sub, pic: k.pic || '', exp: 0 };
        user.sid = k.sid; user.until = Number(k.until) || 0;
      }
      if (!fresh(user)) user = null;
      persist();
    }

    function onCredential(res) {
      var p = decodeJWT(res && res.credential);
      if (!p || !p.email) return;
      user = { token: res.credential, email: p.email, name: p.name || p.email, sub: p.sub, pic: p.picture || '', exp: p.exp };
      persist(); emit('login');
    }
    function waitGIS(cb) {
      var n = 0;
      (function tick() {
        if (window.google && window.google.accounts && window.google.accounts.id) return cb(true);
        if (++n > 80) return cb(false);
        setTimeout(tick, 100);
      })();
    }
    function init(cb) {
      if (inited === true) return cb(true);
      if (inited === 'fail') return cb(false);
      initWait.push(cb);
      if (inited === 'pending') return;
      inited = 'pending';
      waitGIS(function (ok) {
        if (ok) {
          window.google.accounts.id.initialize({
            client_id: CFG.CLIENT_ID, callback: onCredential, auto_select: false, cancel_on_tap_outside: true
          });
        }
        inited = ok ? true : 'fail';
        var w = initWait; initWait = [];
        w.forEach(function (f) { f(ok); });
      });
    }

    /** 시간이 지난 로그인을 걷어 낸다 */
    function sweep() { if (user && !fresh(user)) { user = null; persist(); emit('expired'); } }
    /** 화면을 열어 둔 동안에는 세션을 이어 간다 (남은 시간이 4시간 아래일 때, 10분에 한 번까지) */
    function keep() {
      if (DEMO || !sidOk(user)) return;
      if (user.until - Date.now() > 4 * 3600000 || Date.now() - keptAt < 600000) return;
      keptAt = Date.now();
      var sid = user.sid;
      send(JSON.stringify({ action: 'session.keep', sid: sid }), 15000).then(function (d) {
        if (d && d.ok && user && user.sid === sid && d.sidLeft > 0) { user.until = Date.now() + d.sidLeft * 1000; persist(); }
      })['catch'](function () {});
    }
    setInterval(function () { sweep(); keep(); }, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { sweep(); keep(); } });

    return {
      get: get,
      sweep: sweep,
      /** f(user, why) — 등록하자마자 지금 상태로 한 번 부른다 */
      onChange: function (f) { subs.push(f); f(get(), ''); },
      /** 다음에 누가 로그인하면 그 사용자를, 스스로 로그아웃하면 null 을 돌려준다 */
      next: function () { return new Promise(function (resolve) { waiters.push(resolve); }); },
      /** 서버가 준 세션 값을 받아 둔다. left 는 남은 시간(초) — 서버와 시계가 달라도 되게 내 시계로 다시 잰다 */
      adopt: function (sub, sid, left) {
        if (DEMO || !user || user.sub !== sub || !sid || !(left > 0)) return;
        user.sid = String(sid); user.until = Date.now() + left * 1000;
        persist();
      },
      /** 이 세션 값은 서버에서 사라졌다 */
      dropSid: function (sid) { if (user && user.sid === sid) { user.sid = ''; user.until = 0; persist(); } },
      /** 서버가 이 로그인을 받아 주지 않는다 — 다시 로그인하게 한다 */
      expire: function (sub) { if (user && (!sub || user.sub === sub)) { user = null; persist(); emit('expired'); } },
      /** 지금 보낼 수 있는 것: { sid } 또는 { idToken } */
      creds: function () {
        var u = get();
        if (!u) return { idToken: '' };
        return sidOk(u) ? { sid: u.sid } : { idToken: u.token || '' };
      },
      /** 로그인 버튼을 el 안에 그린다 */
      mountButton: function (el, opts) {
        if (!el) return;
        opts = opts || {};
        if (DEMO) {
          el.innerHTML = '<button class="btn" type="button"><span>미리보기로 열기</span></button>';
          el.querySelector('button').addEventListener('click', function () {
            user = { demo: true, token: '', email: 'member@demo', name: '이서연', sub: 'demo-member', pic: '', exp: 0 };
            emit('login');
          });
          return;
        }
        el.innerHTML = '<div class="ep-gbtn"></div>';
        init(function (ok) {
          if (!ok) {
            el.innerHTML = '<p class="err">구글 로그인을 불러오지 못했습니다. 광고 차단 확장을 끄거나 새로 고쳐 주세요.</p>';
            return;
          }
          window.google.accounts.id.renderButton(el.querySelector('.ep-gbtn'), {
            theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'rectangular', locale: 'ko', width: opts.width || 260
          });
        });
      },
      signOut: function () {
        try { if (window.google && window.google.accounts) window.google.accounts.id.disableAutoSelect(); } catch (e) {}
        var sid = user && user.sid;
        user = null; persist(); emit('logout');
        if (sid && !DEMO) { try { send(JSON.stringify({ action: 'signout', sid: sid }), 8000)['catch'](function () {}); } catch (e2) {} }
      }
    };
  })();

  /* ------------------------------ 서버 호출 ------------------------------ */
  function send(text, ms) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 30000) : 0;
    var done = function () { if (timer) clearTimeout(timer); };
    return fetch(CFG.ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // 이 줄을 바꾸면 CORS 에 막힌다 (BACKEND.md 5절)
      body: text,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
        done();
        if (!r.ok) throw mkErr('HTTP_' + r.status);
        try { return JSON.parse(t); } catch (e) { throw mkErr('BAD_RESPONSE'); }   // Apps Script 가 잠깐 막히면 HTML 을 준다
      });
    }, function (err) { done(); throw mkErr('NETWORK', { cause: String(err && err.name) }); });
  }

  /**
   * 서버 호출. opts: { key 열람 토큰(있으면 로그인 대신), nonce, tries, timeout }
   * 쓰기 요청은 nonce 를 붙여 다시 보내도 한 번만 처리되게 한다.
   * 로그인이 끝났다는 답(AUTH_FAILED)을 받으면 로그인 화면으로 돌려보낸다 — 부른 쪽은 결과만 보면 된다.
   */
  function api(action, extra, opts) {
    var o = opts || {};
    var body = { action: action };
    Object.keys(extra || {}).forEach(function (k) { if (extra[k] !== undefined) body[k] = extra[k]; });
    var sub = '';
    if (o.key) body.key = o.key;
    else {
      Session.sweep();
      var u = Session.get(), c = Session.creds();
      sub = u ? u.sub : '';
      if (c.sid) body.sid = c.sid; else body.idToken = c.idToken;
    }
    if (o.nonce) body.nonce = o.nonce;
    if (DEMO) return Demo.call(body).then(function (d) { if (d && d.now) sync(d.now); return d; });

    var tries = o.tries || 2;
    function attempt(text, n, busy) {
      return send(text, o.timeout).then(function (d) {
        if (d && d.now) sync(d.now);
        // 다른 팀의 쓰기를 기다리다 차례가 안 온 경우 — 조금 쉬었다 다시
        if (d && d.error === 'BUSY' && busy < 3) return wait(700 * (busy + 1)).then(function () { return attempt(text, n, busy + 1); });
        return d;
      }, function (err) {
        if (n >= tries) throw err;
        return wait(700 * n).then(function () { return attempt(text, n + 1, busy); });
      });
    }
    function after(d) {
      if (o.key || !d) return d;
      if (d.ok && d.sid) Session.adopt(sub, d.sid, d.sidLeft);
      if (d.error === 'AUTH_FAILED' && sub) Session.expire(sub);
      return d;
    }
    return attempt(JSON.stringify(body), 1, 0).then(function (d) {
      // 세션 값이 서버에서 사라졌는데 구글 토큰이 아직 살아 있으면, 그것으로 한 번 더 보낸다
      if (d && d.error === 'AUTH_FAILED' && body.sid) {
        Session.dropSid(body.sid);
        var now = Session.get();
        if (now && now.sub === sub && now.token) {
          delete body.sid;
          body.idToken = now.token;
          return attempt(JSON.stringify(body), 1, 0).then(after);
        }
      }
      return after(d);
    });
  }

  /** 서버를 미리 깨워 두고 시계를 맞춘다 (Apps Script 는 첫 요청이 1~2초 더 걸린다) */
  function warm() {
    if (DEMO) return Promise.resolve(null);
    return fetch(CFG.ENDPOINT).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.now) sync(d.now);
      return d;
    })['catch'](function () { return null; });
  }

  /* ------------------------------ 올리기 ------------------------------ */
  function checkFile(file, K) {
    if (!file) return '파일을 골라 주세요.';
    var ext = extOf(file.name);
    if (!ext || K.exts.indexOf(ext) === -1) return '이 형식(.' + (ext || '?') + ')은 받지 않습니다. ' + K.exts.join(' · ') + ' 파일을 올려 주세요.';
    if (!(file.size > 0)) return '빈 파일은 올릴 수 없습니다.';
    if (file.size > K.max) return '파일이 너무 큽니다 (' + fmtSize(file.size) + '). ' + fmtSize(K.max) + ' 까지 올릴 수 있습니다.';
    return '';
  }
  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
      r.onerror = function () { reject(mkErr('NETWORK')); };
      r.readAsDataURL(blob);
    });
  }
  var STALL_MS = 75000;      // 이만큼 아무것도 오가지 않으면 연결이 죽은 것으로 보고 끊는다 (그 뒤 이어 올린다)
  function xhrPut(url, blob, start, total, ctl, onProg) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest(), last = Date.now(), stalled = false;
      var dog = setInterval(function () {
        if (Date.now() - last < STALL_MS) return;
        stalled = true;
        try { x.abort(); } catch (e) {}
      }, 5000);
      var end = function (f, v) { clearInterval(dog); if (ctl.xhr === x) ctl.xhr = null; f(v); };
      ctl.xhr = x;
      x.open('PUT', url, true);
      x.setRequestHeader('Content-Range', 'bytes ' + start + '-' + (start + blob.size - 1) + '/' + total);
      x.upload.onprogress = function (e) { last = Date.now(); if (e.lengthComputable) onProg(e.loaded); };
      x.onload = function () {
        var next = null;
        try { var m = /bytes=0-(\d+)/.exec(x.getResponseHeader('Range') || ''); if (m) next = Number(m[1]) + 1; } catch (e) {}
        end(resolve, { status: x.status, next: next });
      };
      x.onerror = function () { end(reject, mkErr('NETWORK')); };
      x.ontimeout = function () { end(reject, mkErr('NETWORK')); };
      x.onabort = function () { end(reject, mkErr(stalled ? 'NETWORK' : 'CANCELLED')); };
      x.send(blob);
    });
  }

  var RELAY_KEY = 'endpoint.submit.relay';
  /**
   * 파일 하나를 올린다. 돌려주는 것: { promise(→ 팀 상태), cancel() }
   * o: { as 운영진 대리 팀, onProgress(sent, total, mode), onWait(bool) }   mode: 'direct' | 'relay'
   * 올리는 도중에 로그인이 끝나면 버리지 않고, 같은 계정으로 다시 로그인할 때까지 기다렸다가 이어 간다 (onWait).
   */
  function upload(file, kind, o) {
    o = o || {};
    var ctl = { cancelled: false, xhr: null, id: 0 };
    var total = file.size;
    var prog = function (sent, mode) { if (o.onProgress) o.onProgress(Math.min(sent, total), total, mode); };

    if (DEMO) {
      ctl.promise = new Promise(function (resolve, reject) {
        var sent = 0, step = Math.max(total / 24, 1);
        (function tick() {
          if (ctl.cancelled) return reject(mkErr('CANCELLED'));
          sent += step * (0.6 + Math.random() * 0.8);
          prog(sent, 'direct');
          if (sent >= total) return wait(350).then(function () { resolve(Demo.finish(kind, file)); });
          setTimeout(tick, 110);
        })();
      });
      ctl.cancel = function () { ctl.cancelled = true; };
      return ctl;
    }

    var me = Session.get(), mySub = me ? me.sub : '';
    /** api 와 같되, 로그인이 끝났다는 답을 받으면 같은 계정으로 다시 로그인할 때까지 기다렸다가 한 번 더 보낸다 */
    function call(action, extra, opts) {
      return api(action, extra, opts).then(function (d) {
        if (!d || d.error !== 'AUTH_FAILED' || ctl.cancelled) return d;
        if (o.onWait) o.onWait(true);
        return Session.next().then(function (u) {
          if (o.onWait) o.onWait(false);
          if (ctl.cancelled) throw mkErr('CANCELLED');
          if (!u || u.sub !== mySub) throw mkErr('AUTH_FAILED');
          return api(action, extra, opts);
        });
      });
    }

    ctl.promise = call('upload.start', { kind: kind, name: file.name, size: total, origin: loc.origin, as: o.as }, { nonce: nonce() })
      .then(function (s) {
        if (!s || !s.ok) throw apiErr(s);
        ctl.id = s.id;
        var offset = 0, strikes = 0, fails = 0, directOk = false, finishTries = 0;
        var direct = !!s.url && s.direct !== false;
        try { if (sessionStorage.getItem(RELAY_KEY) === '1') direct = false; } catch (e) {}
        var chunk = s.chunk || 8 * MB, relay = s.relayChunk || 4 * MB;

        function putDirect() {
          var blob = file.slice(offset, Math.min(total, offset + chunk)), base = offset;
          return xhrPut(s.url, blob, base, total, ctl, function (loaded) { prog(base + loaded, 'direct'); }).then(function (res) {
            if (res.status === 200 || res.status === 201) { offset = total; }
            else if (res.status === 308) { offset = res.next !== null ? res.next : base + blob.size; }
            else if (res.status === 404 || res.status === 410) throw mkErr('SESSION_GONE');
            else throw mkErr('HTTP_' + res.status);
            strikes = 0; fails = 0; directOk = true;
          })['catch'](function (e) {
            if (e.code === 'CANCELLED' || e.code === 'SESSION_GONE') throw e;
            // 네트워크가 끊겼거나, 올라갔는데 응답만 못 읽었을 수 있다 → 서버에 어디까지 갔는지 묻는다
            if (++fails > 8) throw mkErr('NETWORK');
            return wait(400 + 600 * strikes).then(function () {
              return call('upload.status', { id: s.id, as: o.as }, { tries: 3 });
            }).then(function (st) {
              if (!st || !st.ok) throw apiErr(st);
              var moved = st.done || st.next > base;
              offset = st.done ? total : st.next;
              if (moved) { strikes = 0; return; }
              strikes++;
              // 한 번도 직접 올라간 적이 없는데 두 번 내리 실패하면 이 환경에서는 직접 올리기가 막힌 것 — 중계로 바꾼다
              if (strikes >= (directOk ? 3 : 2)) {
                direct = false; strikes = 0;
                if (!directOk) { try { sessionStorage.setItem(RELAY_KEY, '1'); } catch (e2) {} }
              }
            });
          });
        }
        function putRelay() {
          var blob = file.slice(offset, Math.min(total, offset + relay));
          return blobToBase64(blob).then(function (b64) {
            if (ctl.cancelled) throw mkErr('CANCELLED');
            return call('upload.put', { id: s.id, offset: offset, data: b64, as: o.as }, { timeout: 180000, tries: 3 });
          }).then(function (r) {
            if (!r || !r.ok) throw apiErr(r);
            offset = r.done ? total : r.next;
            prog(offset, 'relay');
          });
        }
        function loop() {
          if (ctl.cancelled) throw mkErr('CANCELLED');
          if (offset >= total) return finish();
          return (direct ? putDirect() : putRelay()).then(loop);
        }
        function finish() {
          return call('upload.finish', { id: s.id, as: o.as }, { tries: 3, timeout: 60000 }).then(function (f) {
            if (f && f.ok) return f.state;
            // 다 보냈다고 생각했는데 Drive 에는 덜 올라온 경우: 어디까지 갔는지 확인하고 이어서 보낸다
            if (f && f.error === 'NOT_UPLOADED' && finishTries++ < 2) {
              return call('upload.status', { id: s.id, as: o.as }).then(function (st) {
                if (!st || !st.ok) throw apiErr(st);
                offset = st.done ? total : st.next;
                return st.done ? wait(1200).then(finish) : loop();
              });
            }
            throw apiErr(f);
          });
        }
        prog(0, direct ? 'direct' : 'relay');
        return loop();
      });

    ctl.cancel = function () {
      ctl.cancelled = true;
      try { if (ctl.xhr) ctl.xhr.abort(); } catch (e) {}
      if (ctl.id) api('upload.cancel', { id: ctl.id, as: o.as })['catch'](function () {});
    };
    return ctl;
  }

  /* ------------------------------ 받기 ------------------------------ */
  function b64ToBytes(b64) {
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  /**
   * 파일을 조각으로 받아 이어 붙인다. → { blob, name, size, md5 }
   * o: { key 열람 토큰, as, onProgress(got, total) }
   */
  function download(id, o) {
    o = o || {};
    var CH = 4 * MB;
    var get = function (offset) {
      return api('file.get', { id: id, offset: offset, length: CH, as: o.as }, { key: o.key, timeout: 120000, tries: 3 }).then(function (r) {
        if (!r || !r.ok) throw apiErr(r);
        return r;
      });
    };
    return get(0).then(function (first) {
      var parts = [b64ToBytes(first.data)], size = first.size, got = first.length, offsets = [], next = 0;
      for (var off = first.length; off < size; off += CH) offsets.push(off);
      if (o.onProgress) o.onProgress(got, size);
      // 두 줄로 나란히 받는다. 더 늘리면 서버의 동시 실행 한도를 다른 사람과 나눠 쓰게 된다.
      function worker() {
        if (next >= offsets.length) return Promise.resolve();
        var i = next++;
        return get(offsets[i]).then(function (r) {
          parts[i + 1] = b64ToBytes(r.data);
          got += r.length;
          if (o.onProgress) o.onProgress(got, size);
          return worker();
        });
      }
      return Promise.all([worker(), worker()]).then(function () {
        return { blob: new Blob(parts, { type: first.mime || 'application/octet-stream' }), name: first.name, size: size, md5: first.md5 };
      });
    });
  }
  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  /* ------------------------------ 공통 화면 조각 ------------------------------ */
  /** 헤더 오른쪽: 로그인한 계정과 로그아웃 */
  function mountAuth(el) {
    if (!el) return;
    Session.onChange(function (u) {
      if (!u) { el.innerHTML = ''; return; }
      el.innerHTML = '<div class="who" title="' + esc(u.email) + '">' +
        (u.pic ? '<img src="' + esc(u.pic) + '" alt="" referrerpolicy="no-referrer">' : '') +
        '<span class="nm">' + esc(u.name) + '</span>' +
        '<button class="mini" type="button">로그아웃</button></div>';
      el.querySelector('button').addEventListener('click', function () { Session.signOut(); });
    });
  }
  /** 카카오톡 등 앱 안 브라우저에서는 구글 로그인이 거부된다 — 미리 안내한다 */
  function initInApp() {
    var ua = navigator.userAgent || '';
    var bar = $('inapp');
    if (!bar || !/KAKAOTALK|Instagram|FBAN|FBAV|NAVER\(inapp|Line\/|everytimeApp|DaumApps|; wv\)/i.test(ua)) return;
    bar.hidden = false;
    var open = $('inapp-open'), here = loc.href;
    if (/KAKAOTALK/i.test(ua)) open.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(here);
    else if (/Android/i.test(ua)) open.href = 'intent://' + here.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end';
    else open.addEventListener('click', function (e) {
      e.preventDefault();
      try { navigator.clipboard.writeText(here); } catch (err) {}
      open.querySelector('span').textContent = '주소 복사됨 · Safari에 붙여넣기';
    });
    $('inapp-x').addEventListener('click', function () { bar.hidden = true; });
  }

  /* ------------------------------ 미리보기(데모) ------------------------------ */
  var Demo = (function () {
    var LIM = {
      deck: { label: '발표', exts: ['pdf', 'pptx', 'ppt', 'key', 'odp', 'mp4', 'mov', 'webm', 'zip'], max: 300 * MB },
      program: { label: '프로그램', exts: ['zip', '7z', 'tar', 'gz', 'tgz', 'rar', 'apk', 'aab', 'exe', 'msi', 'dmg', 'pkg', 'jar', 'appimage', 'deb'], max: 1024 * MB }
    };
    var MIME = { pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', zip: 'application/zip' };
    var t0 = Date.now();
    // 설정의 마감이 아직 남았으면 그 시각을, 지났으면 3시간 남짓 뒤를 마감으로 보여 준다
    var real = Date.parse(CFG.DEADLINE || '');
    var deadline = real > t0 ? real : t0 + (3 * 3600 + 12 * 60 + 40) * 1000;
    var seq = 100;
    function hex(n) { var s = ''; while (s.length < n) s += Math.floor(Math.random() * 16).toString(16); return s; }
    function stamp(ms) { var k = kst(ms); return p2(k.M) + p2(k.D) + '-' + p2(k.h) + p2(k.m); }
    function mkFile(no, kind, v, ext, size, at, by) {
      return { id: ++seq, kind: kind, v: v, name: 'team' + no + '_' + LIM[kind].label + '_v' + v + '_' + stamp(at) + '.' + ext,
               size: size, md5: hex(32), mime: MIME[ext] || 'application/octet-stream', at: at, by: by || '', orig: '' };
    }
    function complete(s) { return !!(s.title && s.deck && (s.url || s.program)); }
    function blank(no, track) {
      return { no: no, track: track, title: '', desc: '', url: '', video: '', deck: null, program: null, history: [], at: 0, by: '',
               complete: false, order: 0, repo: 'https://github.com/2026ENDPoinT/team' + no };
    }

    // 현황판에 보일 예시 20팀 (03팀은 제출 페이지에서 고치는 팀과 같은 것)
    var SAMPLE = [
      ['분실물 찾기 지도', '캠퍼스에서 잃어버린 물건을 지도에 올리고, 주운 사람과 바로 연결해 줍니다.', 'web'],
      ['스터디룸 빈자리 알림', '도서관 스터디룸이 비면 알려 주고 한 번에 예약합니다.', 'web'],
      ['', '', ''],
      ['학식 메뉴 추천', '오늘 식단과 지난 평점을 보고 갈 식당을 골라 줍니다.', 'web'],
      ['과제 마감 달력', 'e-Class 과제를 모아 마감이 가까운 순으로 보여 줍니다.', 'part'],
      ['강의실 길찾기', '건물 안 강의실까지 가는 길을 층별로 안내합니다.', 'app'],
      ['', '', ''],
      ['동아리 장부', '회비와 지출을 영수증 사진으로 정리합니다.', 'web'],
      ['공강 시간 맞추기', '팀원들의 시간표를 겹쳐 같이 빈 시간을 찾습니다.', 'web'],
      ['실습실 좌석 현황', '실습실 PC 사용 여부를 실시간으로 보여 줍니다.', 'none'],
      ['회의록 요약기', '녹음한 회의를 글로 옮기고 할 일을 뽑아 줍니다.', 'web'],
      ['코드 리뷰 도우미', 'PR 을 읽고 놓치기 쉬운 부분을 짚어 줍니다.', 'app'],
      ['중고 교재 장터', '수업별로 교재를 사고팝니다. 학교 메일로만 가입합니다.', 'web'],
      ['발표 연습 코치', '발표 영상을 보고 말 빠르기와 시선을 알려 줍니다.', 'video'],
      ['', '', ''],
      ['기숙사 세탁기 알림', '세탁이 끝나면 알려 주고 다음 사람에게 차례를 넘깁니다.', 'web'],
      ['길고양이 급식 지도', '급식소 위치와 사료 상태를 함께 관리합니다.', 'part'],
      ['운동 메이트 찾기', '시간과 종목이 맞는 사람을 이어 줍니다.', 'web'],
      ['논문 한 줄 요약', '논문 PDF 를 올리면 핵심 문장을 뽑아 줍니다.', 'web'],
      ['', '', '']
    ];
    var teams = {};
    SAMPLE.forEach(function (x, i) {
      var no = p2(i + 1), s = blank(no, i < 10 ? '구현과제' : '해커톤'), at = t0 - (20 + i * 7) * 60000;
      teams[no] = s;
      if (!x[0]) return;
      s.title = x[0]; s.desc = x[1]; s.at = at;
      if (x[2] === 'none') return;
      if (x[2] !== 'part') s.deck = mkFile(no, 'deck', 2, x[2] === 'video' ? 'mp4' : (i % 4 === 3 ? 'pptx' : 'pdf'), (3 + i) * 1.3 * MB, at);
      if (x[2] === 'app') s.program = mkFile(no, 'program', 1, 'zip', (40 + i * 9) * MB, at - 600000);
      else s.url = 'https://team' + no + '-demo.example.app';
      if (s.deck) s.history = [mkFile(no, 'deck', 1, 'pdf', (2 + i) * MB, at - 3600000)];
      if (i % 3 === 0) s.video = 'https://youtu.be/demo' + no;
      s.complete = complete(s);
    });
    var mine = teams['03'];

    // ---- 투표 (미리보기). 로컬에서 ?admin=1 을 붙이면 운영진 화면도 보인다 ----
    var VS = { A: 'open', H: 'ready' }, VM = { A: [], H: [] }, VC = { A: {}, H: {} };
    var vadmin = LOCAL && /[?&]admin=1/.test(loc.search || '');
    function tk(no) { return Number(no) <= 10 ? 'A' : 'H'; }
    function trackTeams(key) { return Object.keys(teams).filter(function (no) { return tk(no) === key; }).sort(); }
    var others = (function () {                // 다른 참가자 41명이 이미 낸 표 (볼 때마다 같은 모양이 되게)
      var n = {}, seed = 7;
      function rnd(k) { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; }
      ['A', 'H'].forEach(function (key) {
        for (var p = 0; p < 41; p++) {
          var pool = trackTeams(key).filter(function (no) { return no !== (key === 'A' ? '0' + (1 + p % 10) : String(11 + p % 10)); });
          for (var k = 0; k < 3; k++) { var no = pool.splice(rnd(pool.length), 1)[0]; n[no] = (n[no] || 0) + 1; }
        }
      });
      return n;
    })();
    function vtally() {
      return [['A', '구현과제'], ['H', '해커톤']].map(function (x) {
        var key = x[0], nos = trackTeams(key), cnt = {}, V = 0;
        if (VS[key] !== 'ready') nos.forEach(function (no) { cnt[no] = others[no] || 0; });
        VM[key].forEach(function (no) { cnt[no] = (cnt[no] || 0) + 1; });
        nos.forEach(function (no) { V += cnt[no] || 0; });
        var mean = V / nos.length;
        return {
          key: key, name: x[1], state: VS[key], votes: V, teams: nos.length, mean: Math.round(mean * 100) / 100, full: Math.round(2 * mean * 100) / 100,
          voters: (VS[key] !== 'ready' ? 41 : 0) + (VM[key].length ? 1 : 0), eligible: 66, bad: 0,
          rows: nos.map(function (no) {
            var v = cnt[no] || 0;
            return { no: no, title: teams[no].title, votes: v, p: mean > 0 ? Math.round(15 * Math.sqrt(Math.min(1, v / (2 * mean))) * 100) / 100 : 0 };
          })
        };
      });
    }

    function out(s, aud) {
      var o = JSON.parse(JSON.stringify(s));
      o.complete = complete(s);
      if (aud === 'member') { delete o.order; [o.deck, o.program].concat(o.history).forEach(function (f) { if (f && !f.by) f.by = '이서연'; }); }
      else { [o.deck, o.program].concat(o.history).forEach(function (f) { if (f) { delete f.by; delete f.orig; } }); delete o.by; }
      return o;
    }
    function url(v) {
      var s = String(v == null ? '' : v).trim();
      if (!s) return '';
      if (!/^[a-z][a-z0-9+.\-]*:/i.test(s)) s = 'https://' + s;
      return /^https?:\/\/[a-z0-9.\-]+(:\d+)?([\/?#].*)?$/i.test(s) && !/\s/.test(s) ? s : null;
    }
    function pdf(line) {
      var objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', '',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
      var text = 'BT /F1 40 Tf 70 330 Td (ENDPoinT) Tj /F1 18 Tf 0 -44 Td (' + line + ') Tj 0 -28 Td (preview only - not a real submission) Tj ET';
      objs[3] = '<< /Length ' + text.length + ' >>\nstream\n' + text + '\nendstream';
      var s = '%PDF-1.4\n', offs = [];
      objs.forEach(function (o, i) { offs.push(s.length); s += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
      var x = s.length;
      return s + 'xref\n0 6\n0000000000 65535 f \n' + offs.map(function (n) { return ('0000000000' + n).slice(-10) + ' 00000 n \n'; }).join('') +
        'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF';
    }
    function findFile(id) {
      var hit = null;
      Object.keys(teams).forEach(function (no) {
        var s = teams[no];
        [s.deck, s.program].concat(s.history).forEach(function (f) { if (f && f.id === id) hit = { f: f, no: no }; });
      });
      return hit;
    }
    function base() { return { ok: true, now: Date.now(), openAt: 0, deadline: deadline, graceMin: 5, phase: Date.now() <= deadline ? 'open' : 'closed' }; }

    function handle(b) {
      var r = base();
      switch (b.action) {
        case 'me':
          r.email = 'member@demo'; r.admin = false; r.limits = LIM;
          r.team = { no: '03', track: '구현과제', name: '이서연', proxy: false };
          r.state = out(mine, 'member');
          return r;
        case 'info.save': {
          var d = b.data || {}, bad = [];
          var u = d.url !== undefined ? url(d.url) : undefined, w = d.video !== undefined ? url(d.video) : undefined;
          if (u === null) bad.push('url');
          if (w === null) bad.push('video');
          if (bad.length) return { ok: false, error: 'INVALID', fields: bad };
          if (d.title !== undefined) mine.title = String(d.title).replace(/\s+/g, ' ').trim().slice(0, 60);
          if (d.desc !== undefined) mine.desc = String(d.desc).trim().slice(0, 300);
          if (u !== undefined) mine.url = u;
          if (w !== undefined) mine.video = w;
          mine.at = Date.now(); mine.by = '이서연';
          r.state = out(mine, 'member');
          return r;
        }
        case 'file.withdraw':
          if (mine[b.kind]) { mine.history.unshift(mine[b.kind]); mine[b.kind] = null; }
          r.state = out(mine, 'member');
          return r;
        case 'file.get': {
          var hit = findFile(Number(b.id));
          if (!hit) return { ok: false, error: 'NOT_FOUND' };
          var isPdf = /\.pdf$/.test(hit.f.name);
          var body = isPdf ? pdf('team ' + hit.no + ' / ' + (hit.f.kind === 'deck' ? 'presentation' : 'program') + ' v' + hit.f.v)
                           : 'ENDPoinT preview file (' + hit.f.name.replace(/[^\x20-\x7E]/g, '_') + ')\n';
          r.id = hit.f.id; r.name = hit.f.name; r.size = body.length; r.mime = isPdf ? 'application/pdf' : 'application/octet-stream';
          r.md5 = hit.f.md5; r.offset = 0; r.length = body.length; r.data = btoa(body);
          return r;
        }
        case 'view.list': {
          var tracks = [{ name: '구현과제', teams: [] }, { name: '해커톤', teams: [] }];
          var sum = { teams: 0, complete: 0, deck: 0, product: 0, title: 0 };
          Object.keys(teams).sort().forEach(function (no) {
            var s = teams[no];
            sum.teams++;
            if (s.title) sum.title++;
            if (s.deck) sum.deck++;
            if (s.url || s.program) sum.product++;
            if (complete(s)) sum.complete++;
            tracks[s.track === '해커톤' ? 1 : 0].teams.push(out(s, 'judge'));
          });
          r.role = '심사위원'; r.name = '미리보기'; r.summary = sum; r.tracks = tracks;
          return r;
        }
        case 'vote.me':
          r.email = 'member@demo'; r.admin = vadmin; r.max = 3; r.self = false;
          r.me = { team: '03', track: '구현과제', trackKey: 'A', name: '이서연' };
          r.tracks = [['A', '구현과제'], ['H', '해커톤']].map(function (x) {
            return {
              key: x[0], name: x[1], state: VS[x[0]], mine: VM[x[0]].slice(), codes: JSON.parse(JSON.stringify(VC[x[0]])),
              teams: trackTeams(x[0]).map(function (no) { var s = teams[no]; return { no: no, title: s.title, desc: s.desc, url: s.url }; })
            };
          });
          if (vadmin) r.tally = vtally();
          return r;
        case 'vote.submit': {
          var key = b.track, pick = (b.teams || []).map(String);
          if (!VS[key]) return { ok: false, error: 'BAD_TRACK' };
          if (VS[key] !== 'open') return { ok: false, error: VS[key] === 'closed' ? 'VOTE_CLOSED' : 'VOTE_NOT_OPEN' };
          if (!pick.length) return { ok: false, error: 'VOTE_EMPTY' };
          if (pick.length > 3) return { ok: false, error: 'VOTE_TOO_MANY' };
          if (pick.indexOf('03') !== -1) return { ok: false, error: 'VOTE_SELF' };
          VM[key] = pick.slice().sort(); VC[key] = {};
          VM[key].forEach(function (no) { VC[key][no] = hex(6).toUpperCase(); });
          r.track = key; r.mine = VM[key].slice(); r.codes = JSON.parse(JSON.stringify(VC[key]));
          return r;
        }
        case 'vote.admin':
          if (!vadmin) return { ok: false, error: 'NOT_ADMIN' };
          if (!VS[b.track]) return { ok: false, error: 'BAD_TRACK' };
          VS[b.track] = b.op === 'open' ? 'open' : 'closed';
          r.track = b.track; r.state = VS[b.track]; r.tally = vtally();
          return r;
        default:
          return { ok: false, error: 'UNKNOWN_ACTION' };
      }
    }

    return {
      call: function (b) { return wait(220 + Math.random() * 380).then(function () { return handle(b); }); },
      /** 올리기가 끝난 것으로 치고 상태를 바꾼다 */
      finish: function (kind, file) {
        var prev = mine[kind];
        var v = prev ? prev.v + 1 : mine.history.filter(function (f) { return f.kind === kind; }).length + 1;
        if (prev) mine.history.unshift(prev);
        mine[kind] = mkFile('03', kind, v, extOf(file.name), file.size, Date.now(), '이서연');
        mine.at = Date.now(); mine.by = '이서연';
        return out(mine, 'member');
      }
    };
  })();

  window.EP = {
    demo: DEMO, pending: PENDING, local: LOCAL, cfg: CFG,
    esc: esc, $: $, wait: wait, nonce: nonce,
    fmtSize: fmtSize, fmtTime: fmtTime, fmtDay: fmtDay, fmtLeft: fmtLeft, extOf: extOf, hostOf: hostOf,
    say: say, spin: spin, loading: loading, toast: toast,
    now: now, sync: sync, warm: warm,
    session: Session, api: api, upload: upload, download: download, saveBlob: saveBlob, checkFile: checkFile,
    mountAuth: mountAuth, initInApp: initInApp
  };
})();
