/* ==============================================================
   시상 화면 (/judge/award/) — 운영진 열람 토큰으로만. 발표 화면(프로젝터)에 띄워 놓고 넘긴다.
   --------------------------------------------------------------
   스페이스 · → · 클릭 = 다음, ← = 이전, F = 전체 화면, R = 점수 새로 읽기 (보던 자리 그대로).
   순서: 표지 → 구현과제 4 · 3 · 2 · 1등 → 해커톤 3 · 2 · 1등 → 축하합니다 (전체 수상 팀).
   한 등수에 여러 팀(해커톤 2등 2팀 · 3등 3팀)이면 최종 S 가 낮은 팀부터 한 장씩.
   등수 나누기는 서버(results.award — 메인 결과 발표와 같은 규칙)가 한다. 화면은 받은 그대로 보여 준다.
   ============================================================== */
(function () {
  'use strict';
  var EP = window.EP, esc = EP.esc, $ = EP.$;
  var KEY = 'endpoint.view.key';                       // 현황판 · 심사 종합과 같은 곳 (같은 토큰)
  var stage = $('stage'), gateWrap = $('gate-wrap'), gate = $('gate');
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ORDER = ['A', 'H'];                               // 구현과제 먼저, 해커톤이 마지막 (시상 순서)
  var LAB = { H: ['Hackathon track', 'red'], A: ['구현과제 트랙', 'blue'] };
  var st = { key: '', d: null, slides: [], i: 0, el: null, busy: false };

  (function () {
    var m = /[#&]k=([A-Za-z0-9_\-]{24,128})/.exec(location.hash || '');
    if (m) {
      st.key = m[1];
      try { sessionStorage.setItem(KEY, st.key); } catch (e) {}
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e2) {}   // 주소에 토큰을 남기지 않는다
    } else { try { st.key = sessionStorage.getItem(KEY) || ''; } catch (e3) {} }
    if (EP.demo) st.key = 'preview-preview-preview-preview';
  })();

  /* ------------------------------ 토큰 · 불러오기 ------------------------------ */
  function showGate(html) { gate.innerHTML = html; gateWrap.hidden = false; }
  function gateKey(why) {
    showGate('<div class="t"><span class="lab ' + (why ? 'red' : 'blue') + '">Awards</span>' +
      '<b>' + esc(why || '운영진 참여 토큰을 입력해 주세요') + '</b></div>' +
      '<form class="act rowy" id="key-form" autocomplete="off">' +
        '<input class="tin" id="key-in" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="참여 토큰" placeholder="운영진 참여 토큰" style="min-width:min(300px,70vw)">' +
        '<button class="btn btn-o" type="submit"><span>열기</span></button></form>');
    $('key-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('key-in').value.trim(), m = /k=([A-Za-z0-9_\-]{24,128})/.exec(v);
      v = m ? m[1] : v;
      if (!/^[A-Za-z0-9_\-]{24,128}$/.test(v)) { gateKey('토큰이 올바르지 않습니다'); return; }
      st.key = v;
      try { sessionStorage.setItem(KEY, v); } catch (e2) {}
      load(false);
    });
    setTimeout(function () { var x = $('key-in'); if (x) x.focus(); }, 0);
  }

  function load(keep) {
    if (!st.key) { gateKey(); return; }
    if (st.busy) return;
    st.busy = true;
    EP.api('results.award', {}, { key: st.key, tries: 3 }).then(function (d) {
      st.busy = false;
      if (d && d.ok) { gateWrap.hidden = true; st.d = d; build(); show(keep ? Math.min(st.i, st.slides.length - 1) : 0, true); return; }
      if (d && d.error === 'KEY_INVALID') { try { sessionStorage.removeItem(KEY); } catch (e) {} gateKey(EP.say(d)); return; }
      if (d && d.error === 'NOT_STAFF') { gateKey('운영진 참여 토큰으로만 열 수 있습니다'); return; }
      if (d && d.error === 'UNKNOWN_ACTION') { gateKey('서버가 아직 예전 버전입니다 — Submit.gs 를 새 버전으로 배포해 주세요'); return; }
      gateKey(EP.say(d));
    }, function (e) { st.busy = false; gateKey(EP.say(e)); });
  }

  /* ------------------------------ 장면 만들기 ------------------------------ */
  function track(key) { var hit = null; (st.d.tracks || []).forEach(function (t) { if (t.key === key) hit = t; }); return hit; }
  function build() {
    var s = [{ type: 'cover' }], any = false;
    ORDER.forEach(function (key) {
      var tr = track(key);
      if (!tr) return;
      var places = tr.places.filter(function (p) { return p.teams && p.teams.length; });
      if (!places.length) return;
      any = true;
      s.push({ type: 'sec', key: key, name: tr.name, from: places[places.length - 1].place, to: places[0].place });
      for (var p = places.length - 1; p >= 0; p--) {            // 낮은 등수부터
        var teams = places[p].teams.slice().sort(function (a, b) { return (num(a.s) - num(b.s)) || (a.no < b.no ? -1 : 1); });
        teams.forEach(function (t, k) { s.push({ type: 'team', key: key, place: places[p].place, team: t, k: k + 1, of: teams.length }); });
      }
    });
    s.push(any ? { type: 'end' } : { type: 'empty' });
    st.slides = s;
  }
  function num(x) { var n = Number(x); return isFinite(n) ? n : -1; }
  function s2(x) { return x === null || x === undefined || x === '' ? '—' : (Math.round(Number(x) * 100) / 100).toFixed(2); }

  function html(sl) {
    var d = st.d;
    if (sl.type === 'cover') {
      var note = d.scoring !== 'closed' ? '심사 진행 중 · 순위가 바뀔 수 있습니다'
        : d.results && d.results.state !== 'open' ? '리허설 · 메인에는 아직 공개 전' : '';
      return '<section class="aw-slide cover">' +
        '<span class="trk" data-a="1">2026 · Awards</span>' +
        '<div class="wm" data-a="2">ENDPoinT</div>' +
        '<div class="sub" data-a="3">시상 · 해커톤 · 구현과제</div>' +
        (note ? '<span class="aw-badge" data-a="4">' + esc(note) + '</span>' : '') +
        '<span class="hint">Space 를 눌러 시작</span></section>';
    }
    if (sl.type === 'sec') {
      var lab = LAB[sl.key] || [sl.name, 'blue'];
      return '<section class="aw-slide sec"><span class="trk ' + lab[1] + '" data-a="1">' + esc(lab[0]) + '</span>' +
        '<div class="big" data-a="2">' + esc(sl.name) + '</div>' +
        '<div class="sub" data-a="3">' + sl.from + '등부터 ' + sl.to + '등까지</div></section>';
    }
    if (sl.type === 'team') {
      var lb = LAB[sl.key] || ['', 'blue'], t = sl.team;
      return '<section class="aw-slide team' + (sl.place === 1 ? ' first' : '') + '">' +
        '<span class="trk ' + lb[1] + '" data-a="1">' + esc(lb[0]) + '</span>' +
        (sl.of > 1 ? '<span class="of" data-a="1">' + sl.place + '등 · ' + sl.k + ' / ' + sl.of + '</span>' : '') +
        '<div class="place" data-a="1">' + sl.place + '<small>등</small></div>' +
        '<div class="no" data-a="2">' + esc(t.no) + '팀</div>' +
        '<div class="title" data-a="3">' + esc(t.title || (t.no + '팀')) + '</div>' +
        '<div class="score" data-a="4"><span>최종 S</span><b data-s="' + esc(String(t.s == null ? '' : t.s)) + '">' + (REDUCE ? s2(t.s) : '0.00') + '</b></div>' +
        '</section>';
    }
    if (sl.type === 'end') {
      var cols = ORDER.slice().reverse().map(function (key) {      // 끝 장면은 해커톤 → 구현과제 (공지 순서)
        var tr = track(key), lab2 = LAB[key] || [key, 'blue'];
        if (!tr) return '';
        var rows = '';
        tr.places.forEach(function (p) {
          p.teams.forEach(function (t) {
            rows += '<div class="r p' + p.place + '"><b>' + p.place + '등</b><span class="n">' + esc(t.no) + '팀</span>' +
              '<span class="t">' + esc(t.title || '—') + '</span><span class="s">' + s2(t.s) + '</span></div>';
          });
        });
        return rows ? '<div class="col"><span class="trk ' + lab2[1] + '">' + esc(lab2[0]) + '</span>' + rows + '</div>' : '';
      }).join('');
      return '<section class="aw-slide end"><span class="trk" data-a="1">Congratulations</span>' +
        '<div class="big" data-a="2">축하합니다</div><div class="cols" data-a="3">' + cols + '</div></section>';
    }
    return '<section class="aw-slide empty"><span class="trk">Awards</span><div class="big">아직 순위가 없습니다 — 심사위원 점수가 모이면 다시 읽어 주세요 (R)</div></section>';
  }

  /* ------------------------------ 넘기기 ------------------------------ */
  function show(i, instant) {
    if (!st.slides.length) return;
    i = Math.max(0, Math.min(st.slides.length - 1, i));
    var old = st.el;
    st.i = i;
    var box = document.createElement('div');
    box.innerHTML = html(st.slides[i]);
    var el = box.firstChild;
    stage.appendChild(el);
    st.el = el;
    if (old) {
      old.classList.add('gone');
      setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, instant || REDUCE ? 0 : 520);
    }
    void el.offsetWidth;                                  // 바로 다음 그림에서 등장 효과가 시작되게
    el.classList.add('in');
    var b = el.querySelector('[data-s]');
    if (b && !REDUCE) countUp(b, Number(b.getAttribute('data-s')), 1050, 1100);
    $('prog').textContent = (i + 1) + ' / ' + st.slides.length;
    $('bar').style.width = (st.slides.length > 1 ? (i / (st.slides.length - 1)) * 100 : 100) + '%';
  }
  /** 최종 S 를 0 에서 그 값까지 (빠르게 시작해 부드럽게 멈춘다) */
  function countUp(el, to, delay, dur) {
    if (!isFinite(to)) { el.textContent = '—'; return; }
    var t0 = 0, mine = st.el;
    setTimeout(function () {
      function step(t) {
        if (st.el !== mine) return;                           // 그새 넘겼다
        if (!t0) t0 = t;
        var x = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - x, 4);
        el.textContent = (to * e).toFixed(2);
        if (x < 1) requestAnimationFrame(step); else el.textContent = s2(to);
      }
      requestAnimationFrame(step);
    }, delay);
  }
  function next() { if (st.i < st.slides.length - 1) show(st.i + 1); }
  function prev() { if (st.i > 0) show(st.i - 1); }
  function fullscreen() {
    var d = document, e = d.documentElement;
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else (e.requestFullscreen || e.webkitRequestFullscreen).call(e);
    } catch (x) {}
  }

  document.addEventListener('keydown', function (e) {
    if (!gateWrap.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key;
    if (k === ' ' || k === 'ArrowRight' || k === 'PageDown' || k === 'Enter' || k === 'ArrowDown') { e.preventDefault(); next(); }
    else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace' || k === 'ArrowUp') { e.preventDefault(); prev(); }
    else if (k === 'Home') { e.preventDefault(); show(0); }
    else if (k === 'End') { e.preventDefault(); show(st.slides.length - 1); }
    else if (k === 'f' || k === 'F') { e.preventDefault(); fullscreen(); }
    else if (k === 'r' || k === 'R') { e.preventDefault(); load(true); }
  });
  stage.addEventListener('click', function () { if (gateWrap.hidden) next(); });
  $('fs').addEventListener('click', function (e) { e.stopPropagation(); fullscreen(); });

  // 마우스를 가만히 두면 안내 · 커서를 감춘다 (발표 화면이 깔끔하게)
  var idle = 0;
  function wake() { document.body.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(function () { document.body.classList.add('idle'); }, 2500); }
  document.addEventListener('mousemove', wake);
  wake();

  if (EP.pending) { gateKey('시상 화면을 준비하고 있습니다'); return; }
  load(false);
})();
