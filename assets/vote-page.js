/* ==============================================================
   참가자 투표 (/judge/vote/)
   --------------------------------------------------------------
   로그인 → 서버가 명단(신청서로 만든 `팀원` 탭)에서 참가자인지 확인한다. 아니면 들어오지 못한다.
   트랙마다 시간표의 투표 시간에만 낼 수 있다 (서버 시각 기준으로 저절로 열리고 닫힌다).
   1인 max 표 · 한 팀에 1표 · 우리 팀은 안 됨 — 판정은 전부 서버가 한다.
   다시 내면 마지막에 낸 투표지만 센다. 표마다 확인 코드를 받는다.
   운영진 계정이면 위쪽에 지금 열기 · 마감 · 5분 연장 · 5분 늦추기 버튼과 결과가 보인다
   (결과는 눌러야 펼쳐진다 — 화면을 띄워 둔 채 실수로 보이지 않게).
   ============================================================== */
(function () {
  'use strict';
  var EP = window.EP, S = EP.session, esc = EP.esc, $ = EP.$;
  var gate = $('gate'), app = $('app');
  var STATE_TXT = { ready: '열기 전', open: '투표 중', closed: '마감' };

  var st = {
    d: null,            // 서버의 vote.me 응답
    tab: '',            // 보고 있는 트랙
    sel: {},            // 트랙별로 지금 고른 팀
    editing: {},        // 트랙별로 고르는 중인가 (이미 냈는데 다시 고르는 경우 포함)
    prev: {},           // 트랙별 직전 상태 (열리고 닫힘 알림용)
    showRes: {},        // 운영진: 트랙별 결과 펼침
    busy: false, loadedAt: 0,
    edge: 0,            // 다음에 열리거나 닫히는 시각 (서버 시각). 그때 한 번 새로 읽는다
    jit: Math.floor(Math.random() * 8000)   // 사람마다 0 – 8초 어긋나게 (12:12 에 66명이 한꺼번에 몰리지 않게 — 서버는 동시 60여 개부터 거절)
  };

  function hm(ms) { return ms ? EP.fmtTime(ms).slice(6) : ''; }
  /** 머리 · 탭에 쓰는 짧은 상태: '12:12 시작' · '투표 중 · 12:27까지' · '마감' */
  function stateTxt(tr) {
    if (tr.state === 'open') return '투표 중' + (tr.until ? ' · ' + hm(tr.until) + '까지' : '');
    if (tr.state === 'ready') return tr.from ? hm(tr.from) + ' 시작' : STATE_TXT.ready;
    return STATE_TXT.closed;
  }

  /* ------------------------------ 안내 패널 ------------------------------ */
  function showGate(html) { gate.innerHTML = html; gate.hidden = false; app.hidden = true; }
  function gateLogin(expired) {
    showGate('<div class="t"><span class="lab ' + (expired ? 'red' : 'blue') + '">' + (expired ? 'Signed out' : 'Sign in') + '</span>' +
      '<b>' + (expired ? '로그인 시간이 지났습니다. 다시 로그인해 주세요' : '참가 신청에 쓴 구글 계정으로 로그인해 주세요') + '</b>' +
      '</div>' +
      '<div class="act" id="gate-btn"></div>');
    S.mountButton($('gate-btn'));
  }
  function gateNotMember(email) {
    showGate('<div class="t"><span class="lab red">Not on the list</span><b>이 계정은 참가자 명단에 없습니다</b>' +
      '<p>지금 로그인한 계정은 <code>' + esc(email) + '</code> 입니다. 참가 신청에 쓴 구글 계정으로 다시 로그인해 주세요. ' +
      '신청한 계정인데도 들어오지 못하면 운영진에게 위 주소를 알려 주세요.</p></div>' +
      '<div class="act rowy"><button class="btn btn-o" type="button" id="gate-out"><span>다른 계정으로 로그인</span></button>' +
      '<button class="mini quiet" type="button" id="gate-again">다시 확인</button></div>');
    $('gate-out').addEventListener('click', function () { S.signOut(); });
    $('gate-again').addEventListener('click', function () { load(); });
  }
  function gateError(text) {
    showGate('<div class="t"><span class="lab red">Error</span><b>불러오지 못했습니다</b><span>' + esc(text) + '</span></div>' +
      '<div class="act"><button class="btn btn-o" type="button" id="gate-retry"><span>다시 시도</span></button></div>');
    $('gate-retry').addEventListener('click', function () { load(); });
  }

  /* ------------------------------ 불러오기 ------------------------------ */
  var loadSeq = 0;
  function load(silent) {
    var u = S.get();
    if (!u) return Promise.resolve();
    var seq = ++loadSeq;
    if (!silent) showGate(EP.loading('투표 정보를 불러오는 중'));
    return EP.api('vote.me', {}, { tries: 3 }).then(function (d) {
      if (seq !== loadSeq) return;
      if (d && d.ok) { apply(d); return; }
      if (d && d.error === 'AUTH_FAILED') return;            // 로그인 화면으로 돌아가 있다
      if (silent) return;
      if (d && d.error === 'NOT_MEMBER') { $('h-team').textContent = '명단에 없는 계정'; gateNotMember(d.email || u.email); return; }
      gateError(EP.say(d));
    }, function (e) {
      if (seq !== loadSeq || silent) return;
      gateError(EP.say(e));
    });
  }

  function trackOf(key) {
    var hit = null;
    (st.d ? st.d.tracks : []).forEach(function (t) { if (t.key === key) hit = t; });
    return hit;
  }
  function selecting() {
    return Object.keys(st.editing).some(function (k) { return st.editing[k] && (st.sel[k] || []).length; });
  }

  function apply(d) {
    var had = !!st.d;
    d.tracks.forEach(function (tr) {
      var was = st.prev[tr.key];
      if (had && was && was !== tr.state) {
        if (tr.state === 'open') { EP.toast(tr.name + ' 투표가 열렸습니다'); if (!selecting()) st.tab = tr.key; }
        else if (tr.state === 'closed') EP.toast(tr.name + ' 투표가 마감되었습니다');
      }
      st.prev[tr.key] = tr.state;
      if (tr.state !== 'open') st.editing[tr.key] = false;
      if (!st.editing[tr.key]) st.sel[tr.key] = tr.mine.slice();
    });
    st.d = d;
    st.loadedAt = Date.now();
    st.edge = 0;
    d.tracks.forEach(function (tr) {
      var e = tr.state === 'ready' ? tr.from : tr.state === 'open' ? tr.until : 0;
      if (e && e > d.now && (!st.edge || e < st.edge)) st.edge = e;
    });
    if (!st.tab || !trackOf(st.tab)) {
      var open = d.tracks.filter(function (t) { return t.state === 'open'; })[0];
      st.tab = (open || d.tracks[0]).key;
    }
    gate.hidden = true; app.hidden = false;
    paint();
  }

  /* ------------------------------ 그리기 ------------------------------ */
  function paintHead() {
    var d = st.d;
    $('h-team').textContent = d.me ? (d.me.name ? d.me.name + ' · ' : '') + d.me.team + '팀' : (d.admin ? '운영진 계정' : '—');
    d.tracks.forEach(function (tr) {
      var el = $('h-' + tr.key);
      if (el) el.textContent = stateTxt(tr) + (d.me && tr.mine.length ? ' · ' + tr.mine.length + '표 투표함' : '');
    });
  }

  function paint() {
    var d = st.d;
    paintHead();
    paintAdmin();
    $('tabs').innerHTML = d.tracks.map(function (tr) {
      return '<button class="tab" type="button" role="tab" data-tab="' + esc(tr.key) + '" aria-selected="' + (st.tab === tr.key) + '">' +
        esc(tr.name) + '<span class="cnt' + (tr.state === 'open' ? ' live' : '') + '">' + esc(stateTxt(tr)) + '</span></button>';
    }).join('');
    $('when').textContent = EP.fmtTime(d.now).slice(6) + ' 기준';
    paintBallot();
  }

  function note(html) { return '<div class="vnote">' + html + '</div>'; }

  function paintBallot() {
    var d = st.d, tr = trackOf(st.tab), el = $('ballot');
    if (!tr) { el.innerHTML = ''; return; }
    var member = !!d.me, myTeam = member ? d.me.team : '', open = tr.state === 'open';
    var voted = tr.mine.length > 0;
    var editing = open && member && (!voted || !!st.editing[tr.key]);
    var sel = st.sel[tr.key] || [];

    var head, who = '';
    if (member) {
      var u = S.get() || {};
      // 한 창(팀 노트북)에서 앞사람이 로그인한 채로 다른 사람이 투표하면 앞사람 표를 덮어쓴다 — 누구 계정인지 늘 크게 보여 준다
      who = '<div class="vwho"><span>투표하는 사람</span><b>' + esc(d.me.name || u.name || '') + '</b><small>' + esc(u.email || '') + '</small>' +
        '<em>본인이 아니면 → </em><button class="mini" type="button" data-act="logout">로그아웃하고 본인 계정으로</button></div>';
    }
    if (!member) head = note('<b>운영진 계정은 투표하지 않습니다.</b> 위에서 트랙별로 투표를 열고 닫을 수 있습니다.');
    else if (tr.state === 'ready') head = note(tr.from ? '<b>' + esc(tr.name) + ' 투표는 ' + hm(tr.from) + '에 열립니다.</b>' + (tr.until ? ' ' + hm(tr.until) + ' 마감' : '')
                                                       : '<b>' + esc(tr.name) + ' 트랙 발표가 끝나면 투표가 열립니다.</b>');
    else if (tr.state === 'closed') head = note(voted ? '<b>투표가 마감되었습니다.</b> 아래가 이 트랙에 낸 표입니다.' : '<b>투표가 마감되었습니다.</b> 이 트랙에는 투표하지 않았습니다.');
    else if (!editing) head = note('<b>투표했습니다.</b> ' + (tr.until ? hm(tr.until) + ' 마감 전까지' : '마감 전까지') + ' 다시 고를 수 있습니다.');
    else head = note('<b>좋았던 팀을 ' + d.max + '곳까지 골라 주세요.</b> 한 팀에 1표' + (d.self ? '' : ', 우리 팀(' + esc(myTeam) + ')은 고를 수 없습니다') + '.' +
                     (tr.until ? ' <b>' + hm(tr.until) + ' 마감</b>' : ''));

    head = who + head;
    var cards = tr.teams.map(function (t) {
      var self = !d.self && t.no === myTeam;
      var on = editing ? sel.indexOf(t.no) !== -1 : tr.mine.indexOf(t.no) !== -1;
      var can = editing && !self && (on || sel.length < d.max);
      var code = tr.codes && tr.codes[t.no];
      var url = /^https?:\/\//i.test(String(t.url || '')) ? t.url : '';
      return '<article class="vcard' + (on ? ' on' : '') + (self ? ' self' : '') + (can ? ' live' : '') + '" data-no="' + esc(t.no) + '">' +
        '<div class="hd"><span class="no">' + esc(t.no) + '</span>' +
          (self ? '<span class="badge gray">우리 팀</span>' : on ? '<span class="badge solid">' + (editing ? '고름' : '투표함') + '</span>' : '') + '</div>' +
        (t.title ? '<h3>' + esc(t.title) + '</h3>' : '<h3 class="empty">이름을 아직 적지 않았습니다</h3>') +
        '<p class="txt">' + esc(t.desc || '') + '</p>' +
        '<div class="ft">' +
          (url ? '<a class="lnk" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">서비스 열기 ↗</a>' : '<span></span>') +
          (editing && !self
            ? '<button class="pick" type="button" data-act="pick" data-no="' + esc(t.no) + '" aria-pressed="' + on + '"' + (can ? '' : ' disabled') + '>' + (on ? '✓ 골랐음' : '고르기') + '</button>'
            : (on && code ? '<span class="code" title="내 표가 들어갔는지 운영진에게 확인할 때 쓰는 코드">확인 코드 <b>' + esc(code) + '</b></span>' : '')) +
        '</div></article>';
    }).join('');

    var bar = '';
    if (member && open) {
      bar = editing
        ? '<div class="vbar"><div class="wrapx"><div class="t"><b class="num">' + sel.length + ' / ' + d.max + '</b> 골랐습니다' +
            (sel.length ? '<span>' + sel.map(function (n) { return esc(n) + '팀'; }).join(' · ') + '</span>' : '') + '</div>' +
          '<div class="acts">' + (voted ? '<button class="mini quiet" type="button" data-act="keep">그대로 두기</button>' : '') +
          '<button class="btn btn-sm" type="button" data-act="submit"' + (sel.length && !st.busy ? '' : ' disabled') + '><span>' +
            (st.busy ? EP.spin('sm ink') + '내는 중' : voted ? '다시 내기' : '투표하기') + '</span></button></div></div></div>'
        : '<div class="vbar"><div class="wrapx"><div class="t"><b>투표함</b><span>' + tr.mine.map(function (n) { return esc(n) + '팀'; }).join(' · ') + '</span></div>' +
          '<div class="acts"><button class="btn btn-o btn-sm" type="button" data-act="edit"><span>다시 고르기</span></button></div></div></div>';
    }
    el.innerHTML = head + '<div class="ballot">' + cards + '</div>' + bar;
  }

  function paintAdmin() {
    var d = st.d, box = $('admin');
    box.hidden = !(d.admin && d.tally);
    if (box.hidden) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="sechd" style="margin-top:0">운영진</div>' +
      d.tally.map(function (x) {
        var show = !!st.showRes[x.key];
        var rows = x.rows.slice().sort(function (p, q) { return q.votes - p.votes || (p.no < q.no ? -1 : 1); });
        var top = rows.length ? rows[0].votes : 0;
        var timed = x.from !== undefined;                       // 투표 시간이 있는 서버인가 (예전 서버면 열기 · 마감만)
        var btn = function (op, label, cls) {
          return '<button class="' + (cls || 'btn btn-sm') + '" type="button" data-act="admin" data-op="' + op + '" data-track="' + esc(x.key) + '"><span>' + label + '</span></button>';
        };
        var acts = x.state === 'open'
          ? btn('close', '마감하기', 'btn btn-o btn-sm') + (timed && x.until ? btn('extend', '5분 연장', 'btn btn-o btn-sm') : '')
          : x.state === 'closed' ? btn('open', '다시 열기')
          : btn('open', timed ? '지금 열기' : '투표 열기') + (timed && x.from ? btn('delay', '5분 늦추기', 'btn btn-o btn-sm') : '');
        if (timed && x.custom) acts += btn('auto', '시간표대로', 'mini quiet');
        var win = timed ? (x.from || x.until ? (hm(x.from) || '…') + ' – ' + (hm(x.until) || '…') : '시각 없음 (버튼으로)') + (x.custom ? ' · 바꿈' : '') : '';
        return '<div class="vadm">' +
          '<div class="vadm-hd"><div class="t"><b>' + esc(x.name) + '</b><span class="vst ' + x.state + '">' + STATE_TXT[x.state] + '</span>' +
            (win ? '<span class="m num">' + esc(win) + '</span>' : '') +
            '<span class="m num">투표한 사람 ' + x.voters + ' / ' + x.eligible + '명 · ' + x.votes + '표 · 팀당 평균 ' + x.mean + '표' +
            (x.bad ? ' · <em>검증 실패 ' + x.bad + '장 (세지 않음)</em>' : '') + '</span></div>' +
          '<div class="acts">' + acts +
            '<button class="mini quiet" type="button" data-act="res" data-track="' + esc(x.key) + '" aria-expanded="' + show + '">' + (show ? '결과 접기' : '결과 보기') + '</button>' +
          '</div></div>' +
          (show ? '<div class="vres"><table><thead><tr><th>팀</th><th>프로젝트</th><th class="r">표</th><th class="r">참가자 점수</th></tr></thead><tbody>' +
            rows.map(function (r) {
              var w = top ? Math.round(r.votes / top * 100) : 0;
              return '<tr><td class="num">' + esc(r.no) + '</td><td>' + esc(r.title || '—') + '</td>' +
                '<td class="r num"><span class="vbarline" style="--w:' + w + '%"></span>' + r.votes + '</td><td class="r num">' + r.p.toFixed(2) + '</td></tr>';
            }).join('') + '</tbody></table>' +
            '<p class="m">참가자 점수 P = ' + (x.popMax || 15) + ' × √min(1, 득표 ÷ (' + (x.popFull || 2) + ' × 팀당 평균)) · 평균의 ' + (x.popFull || 2) + '배(' + x.full + '표) 이상이면 만점</p></div>' : '') +
        '</div>';
      }).join('');
  }

  /* ------------------------------ 고르기 · 내기 ------------------------------ */
  function toggle(no) {
    var d = st.d, tr = trackOf(st.tab);
    if (!tr || tr.state !== 'open' || !d.me || st.busy) return;
    if (!d.self && no === d.me.team) return;
    if (tr.mine.length && !st.editing[tr.key]) return;
    var sel = (st.sel[tr.key] || []).slice(), i = sel.indexOf(no);
    if (i !== -1) sel.splice(i, 1);
    else {
      if (sel.length >= d.max) { EP.toast(d.max + '팀까지 고를 수 있습니다'); return; }
      sel.push(no);
    }
    sel.sort();
    st.sel[tr.key] = sel;
    st.editing[tr.key] = true;
    paintBallot();
  }

  function submit() {
    var d = st.d, tr = trackOf(st.tab);
    if (!tr || st.busy) return;
    var sel = (st.sel[tr.key] || []).slice();
    if (!sel.length) return;
    var u = S.get() || {}, nm = (d.me && d.me.name) || u.name || '';
    var ask = nm + ' 님' + (u.email ? ' (' + u.email + ')' : '') + ' 계정으로 ' + tr.name + ' 투표를 냅니다.\n본인이 아니면 [취소] 를 누르고, 로그아웃한 뒤 본인 계정으로 로그인해 주세요.' +
      (sel.length < d.max ? '\n\n' + sel.length + '팀만 골랐습니다 (' + d.max + '팀까지 고를 수 있습니다).' : '');
    if (!window.confirm(ask)) return;
    st.busy = true;
    paintBallot();
    EP.api('vote.submit', { track: tr.key, teams: sel }, { nonce: EP.nonce(), tries: 3 }).then(function (r) {
      st.busy = false;
      if (r && r.ok) {
        tr.mine = r.mine; tr.codes = r.codes;
        st.editing[tr.key] = false; st.sel[tr.key] = r.mine.slice();
        paint();
        EP.toast('투표했습니다');
        return;
      }
      if (r && r.error === 'AUTH_FAILED') return;
      EP.toast(EP.say(r));
      if (r && (r.error === 'VOTE_CLOSED' || r.error === 'VOTE_NOT_OPEN')) { st.editing[tr.key] = false; load(true); }
      else paintBallot();
    }, function (e) { st.busy = false; EP.toast(EP.say(e)); paintBallot(); });
  }

  var ADMIN_ASK = {
    open: ['투표를 지금 열까요?\n참가자 화면에 바로 열립니다.', '투표를 열었습니다'],
    close: ['투표를 지금 마감할까요?\n마감한 뒤에는 표를 받지 않습니다 (다시 열 수는 있습니다).', '투표를 마감했습니다'],
    extend: ['투표 마감을 5분 늦출까요?', '투표 마감을 5분 늦췄습니다'],
    delay: ['투표 시작과 마감을 5분씩 늦출까요?\n발표가 밀릴 때 씁니다.', '투표 시간을 5분 늦췄습니다'],
    auto: ['투표 시간을 시간표대로 되돌릴까요?', '시간표대로 되돌렸습니다']
  };
  function adminOp(track, op) {
    var x = trackOf(track), ask = ADMIN_ASK[op];
    if (!x || !ask) return;
    if (!window.confirm(x.name + ' ' + ask[0])) return;
    EP.api('vote.admin', { track: track, op: op }, { nonce: EP.nonce(), tries: 2 }).then(function (r) {
      if (r && r.ok) { EP.toast(x.name + ' ' + ask[1]); load(true); }
      else if (r && r.error !== 'AUTH_FAILED') { EP.toast(EP.say(r)); load(true); }
    }, function (e) { EP.toast(EP.say(e)); });
  }

  /* ------------------------------ 이벤트 ------------------------------ */
  app.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest && t.closest('a')) return;                   // 서비스 링크는 그대로 연다
    var b = t.closest ? t.closest('[data-act]') : null;
    if (b && app.contains(b)) {
      var act = b.getAttribute('data-act');
      if (act === 'pick') toggle(b.getAttribute('data-no'));
      else if (act === 'submit') submit();
      else if (act === 'logout') { S.signOut(); }
      else if (act === 'edit') { var tr = trackOf(st.tab); if (tr) { st.editing[tr.key] = true; st.sel[tr.key] = tr.mine.slice(); paintBallot(); } }
      else if (act === 'keep') { var tk = trackOf(st.tab); if (tk) { st.editing[tk.key] = false; st.sel[tk.key] = tk.mine.slice(); paintBallot(); } }
      else if (act === 'admin') adminOp(b.getAttribute('data-track'), b.getAttribute('data-op'));
      else if (act === 'res') { var k = b.getAttribute('data-track'); st.showRes[k] = !st.showRes[k]; paintAdmin(); }
      return;
    }
    var card = t.closest ? t.closest('.vcard.live') : null;       // 카드 아무 곳이나 눌러도 고른다
    if (card) toggle(card.getAttribute('data-no'));
  });
  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-tab]') : null;
    if (!b) return;
    st.tab = b.getAttribute('data-tab');
    paint();
  });

  /* ------------------------------ 시작 ------------------------------ */
  if (EP.pending) {
    showGate('<div class="t"><span class="lab blue">Opening soon</span><b>투표 페이지를 준비하고 있습니다</b>' +
      '<span>발표가 끝나면 이 주소에서 투표합니다. 열리면 공지로 알려 드리겠습니다.</span></div>');
    return;
  }
  $('demo-note').hidden = !EP.demo;
  EP.initInApp();
  EP.mountAuth($('top-auth'));
  EP.warm();

  var lastSub = '';
  S.onChange(function (u, why) {
    if (why === 'logout' || (u && lastSub && u.sub !== lastSub)) { st.sel = {}; st.editing = {}; st.prev = {}; st.d = null; st.tab = ''; }
    if (!u) { $('h-team').textContent = '로그인을 해주세요'; gateLogin(why === 'expired'); return; }
    lastSub = u.sub;
    load();
  });

  // 열려 있는 동안 가끔 새로 읽는다 — 운영진이 투표를 열고 닫는 것이 화면에 보이게. 사람마다 조금씩 어긋난 간격으로.
  var every = 15000 + Math.floor(Math.random() * 10000);
  setInterval(function () {
    if (document.hidden || !st.d || st.busy) return;
    if (st.edge && EP.now() >= st.edge + 800 + st.jit) { st.edge = 0; load(true); return; }   // 열리거나 닫히는 시각
    var gap = st.d.admin ? 8000 : every;
    if (Date.now() - st.loadedAt > gap) load(true);
  }, 1000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && st.d && Date.now() - st.loadedAt > 5000) load(true);
  });
})();
