/* ==============================================================
   제출 현황판 (/judge/) — 심사위원 · 운영진
   --------------------------------------------------------------
   열람 링크(…/judge/#k=토큰)로 들어온다. 토큰은 탭 안(sessionStorage)에만 두고 주소창에서는 바로 지운다.
   서버는 토큰이 맞을 때만 전체 팀의 제출 상태를 준다. 파일은 Drive 권한 없이도 볼 수 있게
   서버가 조각으로 넘겨 주는 것을 받아 이 화면 안에서 연다.
   ============================================================== */
(function () {
  'use strict';
  var EP = window.EP, esc = EP.esc, $ = EP.$;
  var KEY = 'endpoint.view.key';
  var gate = $('gate'), app = $('app'), list = $('list');
  // 화면 안에서 바로 열 수 있는 형식
  var VIEW = { pdf: 'pdf', mp4: 'video', webm: 'video', mov: 'video' };
  // 서버가 보기용 PDF 로 바꿔 두는 발표 형식 (PowerPoint 계열 · odp)
  var CONV = /\.(pptx|ppt|pptm|ppsx|pps|potx|pot|odp)$/i;
  var MB = 1024 * 1024, KEEP_BYTES = 320 * MB;   // 받아 둔 자료를 이 탭에 기억하는 양 (넘으면 오래된 것부터 잊는다)
  var IOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // 화면 안에서 PDF 를 넘겨 볼 수 없는 기기: iOS(첫 쪽만 보인다) · 안드로이드 크롬처럼 PDF 보기가 없는 브라우저
  var NO_INLINE_PDF = IOS || navigator.pdfViewerEnabled === false;

  var st = {
    mine: {}, jdirty: {},      // 심사위원: 내 점수 · 고치는 중인 팀
    key: '', data: null, tab: '', only: false, loadedAt: 0, shape: '', sig: {}, open: {}, jit: 1000 + Math.floor(Math.random() * 4000), cutSeen: 0,
    blobs: {}, order: [], pending: {}, viewSeq: 0, viewUrl: '', kept: 0
  };
  // 심사위원: 발표 자료와 평가를 나란히 보는 창 (아래 '나란히 보기')
  var rv = { no: '', form: null, seq: 0, url: '', busy: false };
  var REDUCE = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var EASE = 'cubic-bezier(.32,.72,0,1)';            // 빠르게 나가 부드럽게 멈춘다

  /* ------------------------------ 열람 토큰 ------------------------------ */
  /** 주소의 # 뒤에 토큰이 있으면 받아 두고 주소에서는 지운다 */
  function takeHash() {
    var m = /[#&]k=([A-Za-z0-9_\-]{24,128})/.exec(location.hash || '');
    if (!m) return false;
    st.key = m[1];
    try { sessionStorage.setItem(KEY, st.key); } catch (e) {}
    // 주소창과 방문 기록에 토큰이 남지 않게 한다
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e2) {}
    return true;
  }
  if (!takeHash()) { try { st.key = sessionStorage.getItem(KEY) || ''; } catch (e3) {} }
  if (EP.demo && !/[?&]hub=1/.test(location.search)) st.key = 'preview-preview-preview-preview';   // ?hub=1: 열람 링크 없이 온 화면(공개 현황)
  // 이 화면을 열어 둔 창에서 링크를 다시 열면 주소의 # 뒤만 바뀌고 화면은 새로 열리지 않는다 — 그때도 받아들인다
  window.addEventListener('hashchange', function () {
    if (EP.demo || !takeHash()) return;
    st.data = null; st.shape = '';
    load();
  });
  function forget() {
    st.key = ''; st.data = null; st.shape = '';
    try { sessionStorage.removeItem(KEY); } catch (e) {}
    $('top-auth').innerHTML = '';
  }

  /* ------------------------------ 안내 패널 ------------------------------ */
  function showGate(html) { gate.innerHTML = html; gate.hidden = false; app.hidden = true; }
  /** 열람 링크 없이 들어온 사람 (메인 메뉴 '제출·투표 현황'): 참가자는 제출 · 투표로, 심사위원 · 운영진은 열람 코드로 */
  function gateKey(why) {
    showGate('<div class="hub">' +
      '<div class="row"><div class="t"><span class="lab blue">Participants</span><b>결과물 제출 · 참가자 투표</b></div>' +
        '<div class="act rowy"><a class="btn" href="../submit/"><span>결과물 제출</span></a>' +
        '<a class="btn btn-o" href="./vote/"><span>참가자 투표</span></a></div></div>' +
      '<div class="row"><div class="t"><span class="lab' + (why ? ' red' : '') + '">Judges</span>' +
        '<b>' + (why ? esc(why) : '참여 토큰을 입력해 주세요') + '</b>' +
        (why ? '<span>토큰이 만료됐다면 운영진에게 새 토큰을 요청해 주세요.</span>' : '') + '</div>' +
        '<form class="act rowy" id="key-form" autocomplete="off">' +
          '<input class="tin" id="key-in" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="참여 토큰" placeholder="참여 토큰" style="min-width:min(260px,70vw)">' +
          '<button class="btn btn-o" type="submit"><span>열기</span></button></form></div>' +
      '</div>');
    pubShow(true);
    $('key-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('key-in').value.trim(), m = /k=([A-Za-z0-9_\-]{24,128})/.exec(v);   // 링크를 통째로 붙여 넣어도 된다
      v = m ? m[1] : v;
      if (!/^[A-Za-z0-9_\-]{24,128}$/.test(v)) { gateKey('참여 토큰이 올바르지 않습니다'); return; }
      st.key = v;
      try { sessionStorage.setItem(KEY, v); } catch (e2) {}
      load();
    });
  }
  /* ------------------------------ 공개 현황 (열람 링크 없이) ------------------------------
     팀 번호 · 낸 것의 유무 · 투표한 사람 수만 보인다. 서버가 제출 현황은 5분, 투표한 사람 수는 1분마다 새로 센다 —
     화면은 그 갱신 시각이 지나면(사람마다 몇 초씩 어긋나게) 다시 읽는다. */
  var pub = { d: null, on: false, seq: 0, nextAt: 0, jit: 1500 + Math.floor(Math.random() * 6000) };
  function pubShow(on) {
    pub.on = on;
    var el = $('pub');
    if (!el) return;
    if (!on) { el.hidden = true; return; }
    if (pub.d) pubPaint();
    pubLoad();
  }
  function pubLoad() {
    if (!pub.on || EP.pending) return;
    var seq = ++pub.seq;
    pub.nextAt = EP.now() + 60000;                               // 실패해도 1분 뒤 다시
    EP.api('status.public', {}, { anon: true, tries: 2 }).then(function (d) {
      if (seq !== pub.seq || !pub.on) return;
      if (d && d.ok && d.submit && d.vote) {
        pub.d = d;
        pub.nextAt = Math.min(d.submit.next, d.vote.next) + pub.jit;
        pubPaint();
      } else if (d && d.error === 'UNKNOWN_ACTION') { pub.nextAt = EP.now() + 5 * 60000; }   // 서버가 아직 예전 버전
    }, function () {});
  }
  function hm(ms) { return ms ? EP.fmtTime(ms).slice(6) : ''; }
  function hms(ms) {                                              // 서울 시각 HH:MM:SS (같은 분 안의 앞뒤도 보이게)
    var x = new Date(ms + 9 * 3600000);
    return [x.getUTCHours(), x.getUTCMinutes(), x.getUTCSeconds()].map(function (n) { return (n < 10 ? '0' : '') + n; }).join(':');
  }
  /** 발표 순서 — 마감(10:00)이 지나면 서버가 준다. 트랙마다 마지막 제출이 늦은 팀부터 */
  function orderHtml(d) {
    var o = d.submit.order;
    if (!o || !o.tracks) return '';
    var name = {};
    d.vote.tracks.forEach(function (x) { name[x.key] = x.name; });
    var until = d.deadline ? hm(d.deadline + (d.graceMin || 0) * 60000) : '';
    return '<section class="pubsec" id="pub-order"><div class="pubhd"><b>발표 순서</b><span class="when">마지막 제출이 늦은 팀부터 · ' +
      (o.final ? '확정' : (until ? until + ' 확정 (올리던 파일 마무리 중)' : '확정 전')) + '</span></div>' +
      o.tracks.map(function (tr) {
        return '<div class="pubgrp"><span class="lab ko">' + esc(name[tr.key] || tr.key) + '</span><ol class="porder">' + tr.teams.map(function (t) {
          return '<li' + (t.at ? '' : ' class="none"') + ' data-no="' + esc(t.no) + '"><b>' + t.rank + '</b><span class="t">' + esc(t.no) + '팀</span>' +
            '<small>' + (t.at ? hms(t.at) : '제출 없음') + '</small></li>';
        }).join('') + '</ol></div>';
      }).join('') + '</section>';
  }
  function every(sec) { return sec % 60 === 0 ? (sec / 60) + '분' : sec + '초'; }
  function voteTxt(tr) {
    if (tr.state === 'open') return '투표 중' + (tr.until ? ' · ' + hm(tr.until) + '까지' : '');
    if (tr.state === 'ready') return tr.from ? hm(tr.from) + ' 시작' : '열기 전';
    return '마감';
  }
  function pubPaint() {
    var d = pub.d, el = $('pub');
    if (!d || !el || !pub.on) return;
    var sum = d.submit.sum;
    $('s-done').textContent = sum.complete + ' / ' + sum.teams + '팀';
    $('s-parts').textContent = '발표 ' + sum.deck + ' · 결과물 ' + sum.product;
    var vote = '<section class="pubsec" id="pub-vote"><div class="pubhd"><b>투표 현황</b>' +
      '<span class="when">' + hm(d.vote.at) + ' 기준 · ' + every(d.vote.every) + '마다 갱신</span></div>' +
      d.vote.tracks.map(function (tr) {
        var pct = d.vote.eligible ? Math.min(100, Math.round(tr.voters / d.vote.eligible * 100)) : 0;
        return '<div class="pubrow" data-track="' + esc(tr.key) + '"><div class="nm"><b>' + esc(tr.name) + '</b>' +
          '<span class="vst ' + esc(tr.state) + '">' + esc(voteTxt(tr)) + '</span></div>' +
          '<div class="meter" aria-hidden="true"><span style="width:' + pct + '%"></span></div>' +
          '<div class="n">투표한 사람 ' + tr.voters + ' / ' + d.vote.eligible + '명</div></div>';
      }).join('') + '</section>';
    var groups = d.vote.tracks.map(function (tr) {                // 발표 순서 (서버가 준 트랙 순서)
      var ts = d.submit.teams.filter(function (t) { return t.track === tr.key; });
      return '<div class="pubgrp"><span class="lab ko">' + esc(tr.name) + '</span><div class="chips">' + ts.map(function (t) {
        var cls = t.done ? 'done' : (t.deck || t.product) ? 'part' : 'none';
        var tip = t.done ? '제출 완료' : t.deck && t.product ? '발표 자료 · 결과물' : t.deck ? '발표 자료만' : t.product ? '결과물만' : '아직';
        return '<span class="tchip ' + cls + '" data-no="' + esc(t.no) + '" title="' + esc(t.no + '팀 · ' + tip) + '">' + esc(t.no) + '</span>';
      }).join('') + '</div></div>';
    }).join('');
    var submit = '<section class="pubsec" id="pub-submit"><div class="pubhd"><b>제출 현황</b>' +
      '<span class="when">' + hm(d.submit.at) + ' 기준 · ' + every(d.submit.every) + '마다 갱신</span></div>' + groups +
      '<div class="legend"><span class="tchip done">완료</span><span class="tchip part">일부</span><span class="tchip none">아직</span></div></section>';
    el.innerHTML = orderHtml(d) + (d.phase === 'closed' ? vote + submit : submit + vote);   // 제출이 끝나면 발표 순서 · 투표를 위로
    el.hidden = false;
  }

  function gateError(text) {
    showGate('<div class="t"><span class="lab red">Error</span><b>불러오지 못했습니다</b><span>' + esc(text) + '</span></div>' +
      '<div class="act"><button class="btn btn-o" type="button" id="gate-retry"><span>다시 시도</span></button></div>');
    $('gate-retry').addEventListener('click', function () { load(); });
  }

  /* ------------------------------ 불러오기 ------------------------------ */
  var loadSeq = 0;
  function load(silent) {
    if (!st.key) { gateKey(); return Promise.resolve(); }
    pubShow(false);
    var seq = ++loadSeq;
    if (!silent) showGate(EP.loading('제출 현황을 불러오는 중'));
    else $('reload').textContent = '불러오는 중…';
    return EP.api('view.list', {}, { key: st.key, tries: 3 }).then(function (d) {
      if (seq !== loadSeq) return;
      $('reload').textContent = '새로 고침';
      if (d && d.ok) {
        var mine = d.mine || {};
        Object.keys(mine).forEach(function (no) { if (!st.mine[no] || !(st.mine[no].at > mine[no].at)) st.mine[no] = mine[no]; });
        st.data = d; st.loadedAt = Date.now(); render(); return;
      }
      if (d && d.error === 'KEY_INVALID') { forget(); gateKey(EP.say(d)); return; }
      if (!silent) gateError(EP.say(d));
    }, function (e) {
      if (seq !== loadSeq) return;
      $('reload').textContent = '새로 고침';
      if (!silent) gateError(EP.say(e));
    });
  }

  /* ------------------------------ 그리기 ------------------------------ */
  function has(t) { return !!(t.title || t.url || t.deck || t.program); }
  function staff() { return st.data && st.data.role === '운영진'; }
  function clock(ms) { var s = EP.fmtTime(ms); return s.slice(6); }

  function render() {
    var d = st.data;
    gate.hidden = true; app.hidden = false;
    pubShow(false);
    $('top-auth').innerHTML = '<div class="who"><span class="nm" style="display:inline;max-width:24ch">' + esc(d.name || '') +
      (d.name ? ' · ' : '') + esc(d.role || '') + '</span><button class="mini quiet" type="button" id="leave">나가기</button></div>';
    $('leave').addEventListener('click', function () { forget(); gateKey(); });

    var sum = d.summary || { teams: 0, complete: 0, deck: 0, product: 0 };
    $('s-done').textContent = sum.complete + ' / ' + sum.teams + '팀';
    if (judgeMode()) paintProgress();
    else $('s-parts').textContent = '발표 ' + sum.deck + ' · 결과물 ' + sum.product;
    if ((staff() || d.role === '심사위원') && !$('to-score')) {        // 교수님도 종합을 본다 (읽기만)
      var a = document.createElement('a');
      a.id = 'to-score'; a.className = 'chipbtn'; a.href = './score/'; a.textContent = '심사 종합 →';
      a.style.cssText = 'display:inline-flex;align-items:center;text-decoration:none';
      $('reload').parentNode.insertBefore(a, $('reload'));
    }
    tick();

    // 트랙 탭
    var names = d.tracks.map(function (tr) { return tr.name; });
    if (st.tab && names.indexOf(st.tab) === -1) st.tab = '';
    var count = function (teams) { return teams.filter(function (t) { return t.complete; }).length + '/' + teams.length; };
    var all = d.tracks.reduce(function (a, tr) { return a.concat(tr.teams); }, []);
    $('tabs').innerHTML = [{ name: '', label: '전체', teams: all }].concat(d.tracks.map(function (tr) {
      return { name: tr.name, label: tr.name, teams: tr.teams };
    })).map(function (x) {
      return '<button class="tab" type="button" role="tab" data-tab="' + esc(x.name) + '" aria-selected="' + (st.tab === x.name) + '">' +
        esc(x.label) + '<span class="cnt">' + count(x.teams) + '</span></button>';
    }).join('');
    $('when').textContent = clock(d.now) + ' 기준';
    paintList();
  }

  function paintList() {
    if (judgeMode()) return paintJudge();
    var d = st.data;
    var tracks = d.tracks.filter(function (tr) { return !st.tab || tr.name === st.tab; }).map(function (tr) {
      return { name: tr.name, all: tr.teams, teams: tr.teams.filter(function (t) { return !st.only || has(t); }) };
    });
    var shape = st.tab + '|' + st.only + '|' + (staff() ? 's' : 'j') + '|' + (d.orderFinal ? 'F' : '') + '|' + tracks.map(function (tr) {
      return tr.name + ':' + tr.teams.map(function (t) { return t.no; }).join(',');
    }).join(';');

    if (shape !== st.shape) {
      // 보이는 팀의 구성이 달라졌다 — 통째로 다시 그린다
      st.shape = shape; st.sig = {};
      var html = tracks.map(function (tr, i) {
        return '<section class="trk"><div class="trk-hd"><h2>' + esc(tr.name) + ' 트랙</h2><small id="trk-n-' + i + '"></small>' + ordNote(tr) + '</div>' +
          (tr.teams.length ? '<div class="posts">' + tr.teams.map(function (t) { st.sig[t.no] = JSON.stringify(t); return card(t); }).join('') + '</div>'
                           : '<div class="empty-all">아직 제출한 팀이 없습니다.</div>') + '</section>';
      }).join('');
      list.innerHTML = html || '<div class="empty-all">보여 줄 팀이 없습니다.</div>';
    } else {
      // 바뀐 팀의 카드만 갈아 끼운다 (보던 자리와 받는 중인 표시가 흐트러지지 않게)
      tracks.forEach(function (tr) {
        tr.teams.forEach(function (t) {
          var sig = JSON.stringify(t);
          if (st.sig[t.no] === sig) return;
          st.sig[t.no] = sig;
          var el = $('card-' + t.no);
          if (el) el.outerHTML = card(t);
        });
      });
    }
    tracks.forEach(function (tr, i) {
      var el = $('trk-n-' + i);
      if (el) el.textContent = '제출 완료 ' + tr.all.filter(function (t) { return t.complete; }).length + ' / ' + tr.all.length + '팀';
    });
    Object.keys(st.pending).forEach(function (id) { setProg(parseInt(id, 10), st.pending[id].pct); });
  }

  /** 화면에서 볼 수 있는 파일이면 { id, type 'pdf'|'video', variant 'pdf'(보기용 PDF)|'', size, f } */
  function viewOf(f) {
    if (!f || f.kind !== 'deck') return null;
    var ext = EP.extOf(f.name);
    if (VIEW[ext]) return { id: f.id, type: VIEW[ext], variant: '', size: f.size, f: f };
    if (CONV.test(f.name)) return { id: f.id, type: 'pdf', variant: 'pdf', size: f.pdf || 0, f: f };
    return null;
  }
  function fileBtn(t, f, primary) {
    var v = viewOf(f), type = v ? v.type : '';
    var label = f.kind === 'program' ? '프로그램 받기' : type === 'video' ? '발표 영상 보기' : type ? '발표 자료 보기' : '발표 자료 받기';
    return '<button class="btn ' + (primary ? 'btn-k' : 'btn-w') + ' btn-sm" type="button" data-act="' + (type ? 'view' : 'get') + '" data-id="' + f.id +
      '" data-no="' + esc(t.no) + '" data-type="' + (type || '') + '" data-variant="' + (v ? v.variant : '') + '" data-label="' + label + '" title="' + esc(f.name) + ' · ' + EP.fmtSize(f.size) +
      (v && v.variant ? (f.pdf ? ' · 보기용 PDF' : ' · 보기용 PDF 를 만들어 엽니다') : '') + '"><span>' + label + '</span></button>';
  }
  function ext(href, label, primary) {
    if (!/^https?:\/\//i.test(String(href || ''))) return '';       // http · https 가 아닌 주소는 링크로 만들지 않는다
    return '<a class="btn ' + (primary ? 'btn-k' : 'btn-w') + ' btn-sm" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer"><span>' + label + ' ↗</span></a>';
  }

  function card(t) {
    var any = has(t), cls = t.complete ? 'done' : any ? 'part' : 'none';
    if (!any) {
      return '<article class="post none" id="card-' + esc(t.no) + '"><div class="hd"><span class="no">' + esc(t.no) + '</span>' +
        '<span class="badge">제출 전</span></div><h3>제출하지 않았습니다</h3></article>';
    }
    var miss = [];
    if (!t.title) miss.push('이름');
    if (!(t.url || t.program)) miss.push('결과물');
    if (!t.deck) miss.push('발표 자료');
    var links = '';
    if (t.url) links += ext(t.url, '서비스 열기', true);
    if (t.deck) links += fileBtn(t, t.deck, true);
    if (t.program) links += fileBtn(t, t.program, !t.url);
    if (t.video) links += ext(t.video, '데모 영상', false);
    if (t.repo) links += ext(t.repo, '코드', false);

    var meta = [];
    if (t.at) meta.push(EP.fmtTime(t.at) + ' 제출');
    if (t.deck) meta.push('발표 v' + t.deck.v + ' · ' + EP.extOf(t.deck.name) + ' ' + EP.fmtSize(t.deck.size));
    if (t.program) meta.push('프로그램 v' + t.program.v + ' · ' + EP.extOf(t.program.name) + ' ' + EP.fmtSize(t.program.size));
    var old = t.history || [], open = !!st.open[t.no];
    var drive = '', vline = '';
    if (staff() && st.data.votes) {
      st.data.votes.forEach(function (x) {
        x.rows.forEach(function (r) {
          if (r.no === t.no && x.state !== 'ready') vline = '<div class="vline">인기투표 ' + r.votes + '표 · 참가자 점수 ' + r.p.toFixed(2) + (x.state === 'open' ? ' (투표 중)' : '') + '</div>';
        });
      });
    }
    if (staff()) {
      if (t.deck && t.deck.driveUrl) drive += '<a class="lnk" href="' + esc(t.deck.driveUrl) + '" target="_blank" rel="noopener noreferrer">발표 Drive ↗</a> ';
      if (t.program && t.program.driveUrl) drive += '<a class="lnk" href="' + esc(t.program.driveUrl) + '" target="_blank" rel="noopener noreferrer">프로그램 Drive ↗</a> ';
      if (t.folderUrl) drive += '<a class="lnk" href="' + esc(t.folderUrl) + '" target="_blank" rel="noopener noreferrer">폴더 ↗</a>';
    }

    var rk = t.rank ? '<span class="pord" title="발표 순서 — 마지막 제출이 늦은 팀부터">발표 ' + t.rank + '</span>' : '';
    return '<article class="post ' + cls + '" id="card-' + esc(t.no) + '">' +
      '<div class="hd"><span class="nog"><span class="no">' + esc(t.no) + '</span>' + rk + '</span>' +
        (t.complete ? '<span class="badge solid">제출 완료</span>' : '<span class="badge gray">' + miss.join(' · ') + ' 없음</span>') + '</div>' +
      (t.title ? '<h3>' + esc(t.title) + '</h3>' : '<h3 class="empty">이름을 아직 적지 않았습니다</h3>') +
      (t.desc ? '<p class="txt">' + esc(t.desc) + '</p>' : '<p class="txt"></p>') +
      (links ? '<div class="links">' + links + '</div>' : '') +
      (t.url ? '<div class="where">' + esc(EP.hostOf(t.url) || t.url) + '</div>' : '') +
      '<div class="ft"><small>' + meta.join(' · ') + '</small>' +
        (old.length ? '<button class="lnk" type="button" data-act="hist" data-no="' + esc(t.no) + '" aria-expanded="' + open + '">이전 자료 ' + old.length + '개 ' + (open ? '접기' : '보기') + '</button>' : '') +
      '</div>' +
      vline +
      (drive ? '<div class="where" style="margin-top:0">' + drive + '</div>' : '') +
      (old.length && open ? '<div class="old">' + old.map(function (f) {
        return '<div class="r"><span>' + esc(f.name) + '<br><span class="dl">' + EP.fmtSize(f.size) + ' · ' + EP.fmtTime(f.at) + '</span></span>' +
          '<button class="btn btn-w btn-sm" type="button" data-act="get" data-id="' + f.id + '" data-no="' + esc(t.no) + '" data-label="받기"><span>받기</span></button></div>';
      }).join('') + '</div>' : '') +
      '</article>';
  }

  function team(no) {
    var hit = null;
    st.data.tracks.forEach(function (tr) { tr.teams.forEach(function (t) { if (t.no === no) hit = t; }); });
    return hit;
  }
  function fileOf(t, id) {
    var hit = null;
    [t.deck, t.program].concat(t.history || []).forEach(function (f) { if (f && f.id === id) hit = f; });
    return hit;
  }

  /* ------------------------------ 심사위원: 팀마다 한 줄 · 점수 · 코멘트 ------------------------------ */
  function judgeMode() { var d = st.data; return !!(d && d.role === '심사위원' && d.criteria && d.criteria.length); }
  function infoCard(t) { return card(t).replace(/ id="card-[^"]*"/, ''); }
  /** 목록을 통째로 다시 그리기 전에 저장하지 않은 점수 · 코멘트와 커서를 챙긴다 (나란히 보기로 옮겨 간 칸은 putFormBack 이 지킨다) */
  function keepDrafts() {
    var out = { forms: {}, focus: null };
    Array.prototype.forEach.call(list.querySelectorAll('form.jscore'), function (f) {
      var no = f.getAttribute('data-no');
      if (!st.jdirty[no]) return;
      var vals = {};
      Array.prototype.forEach.call(f.elements, function (el) { if (el.name) vals[el.name] = el.value; });
      out.forms[no] = vals;
    });
    var ae = document.activeElement;
    if (ae && ae.form && ae.name && list.contains(ae)) {
      out.focus = { no: ae.form.getAttribute('data-no'), name: ae.name, sel: null };
      try { if (typeof ae.selectionStart === 'number') out.focus.sel = [ae.selectionStart, ae.selectionEnd]; } catch (e) {}
    }
    return out;
  }
  function putDrafts(k) {
    Object.keys(k.forms).forEach(function (no) {
      var f = list.querySelector('form.jscore[data-no="' + no + '"]');
      if (!f) return;
      Object.keys(k.forms[no]).forEach(function (name) { var el = f.elements[name]; if (el && !el.disabled) el.value = k.forms[no][name]; });
      refreshForm(f);
    });
    if (!k.focus) return;
    var f2 = list.querySelector('form.jscore[data-no="' + k.focus.no + '"]'), el = f2 && f2.elements[k.focus.name];
    if (el) { try { el.focus({ preventScroll: true }); if (k.focus.sel) el.setSelectionRange(k.focus.sel[0], k.focus.sel[1]); } catch (e) {} }
  }
  /** 발표 순서만 바뀌었을 때: 카드(점수 칸 포함)를 그대로 두고 자리만 옮긴다. 입력 중이던 칸의 커서도 되돌린다 */
  function reorderJudge(tracks) {
    var ae = document.activeElement, sel = null;
    try { if (ae && typeof ae.selectionStart === 'number') sel = [ae.selectionStart, ae.selectionEnd]; } catch (e) {}
    var secs = list.querySelectorAll('.trk');
    tracks.forEach(function (tr, i) {
      var box = secs[i] && secs[i].querySelector('.jlist');
      if (!box) return;
      tr.teams.forEach(function (t) { var el = $('card-' + t.no); if (el && el.parentNode === box) box.appendChild(el); });
    });
    if (ae && ae !== document.activeElement && document.body.contains(ae)) {
      try { ae.focus({ preventScroll: true }); if (sel) ae.setSelectionRange(sel[0], sel[1]); } catch (e2) {}
    }
  }
  /** 트랙 머리의 발표 순서 안내 (서버가 순서를 준 트랙만) */
  function ordNote(tr) {
    if (!tr.all.some(function (t) { return t.rank; })) return '';
    return '<small class="ordnote">발표 순서대로 · 마지막 제출이 늦은 팀부터' + (st.data.orderFinal ? ' · 확정' : ' · 마감 때 확정') + '</small>';
  }
  function maxTotal() { return st.data.criteria.reduce(function (a, c) { return a + c.max; }, 0); }
  function fmt2(n) { return (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, ''); }

  function paintProgress() {
    var d = st.data, nos = [];
    d.tracks.forEach(function (tr) { tr.teams.forEach(function (t) { nos.push(t.no); }); });
    var done = nos.filter(function (no) { return st.mine[no] && st.mine[no].complete; }).length;
    var lab = $('s-parts').previousElementSibling;
    if (lab) lab.textContent = '내 평가';
    $('s-parts').textContent = done + ' / ' + nos.length + '팀';
  }

  function jform(no) {
    var d = st.data, m = st.mine[no] || null, closed = d.scoring === 'closed' || !!d.scoreError, dis = closed ? ' disabled' : '';
    return '<div class="jgrid">' + d.criteria.map(function (c) {
        var v = m && m.s && m.s[c.key] !== '' && m.s[c.key] !== undefined && m.s[c.key] !== null ? m.s[c.key] : '';
        return '<label class="jq"><span class="lab ko">' + esc(c.name) + ' <small>/ ' + c.max + '</small></span>' +
          '<input class="tin num" type="number" inputmode="decimal" step="0.01" min="0" max="' + c.max + '" name="' + esc(c.key) + '" value="' + esc(String(v)) + '"' + dis + '></label>';
      }).join('') + '</div>' +
      '<label class="jq"><span class="lab ko">코멘트</span><textarea class="tar" name="comment" maxlength="2000" rows="3"' + dis + '>' + esc(m ? m.comment : '') + '</textarea></label>' +
      '<div class="jact"><div class="jsum"><span class="lab ko">합계</span><b class="num" data-sum></b><small>/ ' + maxTotal() + '</small></div>' +
        '<span class="jstate" data-state></span>' +
        (closed ? '' : '<button class="btn btn-sm" type="submit"><span>저장</span></button>') + '</div>';
  }
  function jrow(t) {
    return '<article class="jrow" id="card-' + esc(t.no) + '" data-no="' + esc(t.no) + '">' + infoCard(t) +
      '<form class="jscore" data-no="' + esc(t.no) + '" novalidate autocomplete="off">' + jform(t.no) + '</form></article>';
  }
  function setState(form, text, kind) {
    var el = form.querySelector('[data-state]');
    if (!el) return;
    el.textContent = text;
    el.className = 'jstate' + (kind ? ' ' + kind : '');
  }
  /** 입력 칸의 합계와 상태 줄 */
  /** 문항마다 0 – 만점(25)인지. 첫 번째 틀린 칸 { el, c } 또는 null — 틀린 칸은 빨갛게 */
  function badField(form) {
    var bad = null;
    st.data.criteria.forEach(function (c) {
      var el = form.elements[c.key], raw = String(el.value).trim(), n = Number(raw);
      var wrong = raw !== '' && (!isFinite(n) || n < 0 || n > c.max || (el.validity && el.validity.badInput));
      el.classList.toggle('bad', !!wrong);
      if (wrong && !bad) bad = { el: el, c: c };
    });
    return bad;
  }
  function refreshForm(form) {
    var d = st.data, no = form.getAttribute('data-no'), sum = 0, filled = 0;
    d.criteria.forEach(function (c) {
      var raw = String(form.elements[c.key].value).trim();
      if (raw === '') return;
      var n = Number(raw);
      if (isFinite(n)) { sum += n; filled++; }
    });
    form.querySelector('[data-sum]').textContent = filled ? fmt2(sum) : '—';
    var m = st.mine[no], bad = badField(form), btn = form.querySelector('button[type="submit"]');
    if (btn && !btn.classList.contains('saving')) btn.disabled = !!bad;
    if (bad) setState(form, bad.c.name + ' 은(는) 0 – ' + bad.c.max + ' 사이로 적어 주세요 · 저장할 수 없습니다', 'err');
    else if (d.scoreError) setState(form, '심사 시트가 아직 연결되지 않았습니다. 운영진에게 알려 주세요.', 'err');
    else if (d.scoring === 'closed') setState(form, '심사가 마감되었습니다', '');
    else if (st.jdirty[no]) setState(form, '저장하지 않은 내용이 있습니다', 'dirty');
    else if (m && m.complete) setState(form, '저장됨 · ' + EP.fmtTime(m.at).slice(6), 'ok');
    else if (m) setState(form, '작성 중 · ' + m.filled + ' / ' + d.criteria.length + '문항 · ' + EP.fmtTime(m.at).slice(6), '');
    else setState(form, '아직 평가하지 않았습니다', '');
  }
  /** 서버 값으로 칸을 채운다 (고치는 중인 칸 · 커서가 있는 칸은 건드리지 않는다) */
  function formOf(no) { return rv.form && rv.no === no ? rv.form : list.querySelector('form.jscore[data-no="' + no + '"]'); }
  function fillForm(no, force) {
    var form = formOf(no);
    if (!form) return;
    var m = st.mine[no], d = st.data;
    if (force || !st.jdirty[no]) {
      d.criteria.forEach(function (c) {
        var el = form.elements[c.key];
        if (!force && document.activeElement === el) return;
        el.classList.remove('bad');
        el.value = m && m.s && m.s[c.key] !== '' && m.s[c.key] !== null && m.s[c.key] !== undefined ? m.s[c.key] : '';
      });
      var ta = form.elements.comment;
      if (force || document.activeElement !== ta) ta.value = m ? m.comment : '';
    }
    refreshForm(form);
  }

  function paintJudge() {
    var d = st.data;
    var tracks = d.tracks.filter(function (tr) { return !st.tab || tr.name === st.tab; }).map(function (tr) {
      return { name: tr.name, all: tr.teams, teams: tr.teams.filter(function (t) { return !st.only || has(t); }) };
    });
    // 보이는 팀의 '구성' (순서는 빼고). 구성이 같고 발표 순서만 바뀌었으면 다시 그리지 않고 카드 자리만 옮긴다 —
    // 다시 그리면 저장하지 않은 점수 · 코멘트가 사라진다 (마감 전에는 다른 팀이 낼 때마다 순서가 바뀐다)
    var shape = 'J|' + st.tab + '|' + st.only + '|' + d.scoring + '|' + (d.scoreError || '') + '|' + tracks.map(function (tr) {
      return tr.name + ':' + tr.teams.map(function (t) { return t.no; }).sort().join(',');
    }).join(';');
    var order = tracks.map(function (tr) { return tr.teams.map(function (t) { return t.no; }).join(','); }).join(';');
    if (shape === st.shape && order !== st.jorder) {
      st.jorder = order;
      reorderJudge(tracks);
    }
    Array.prototype.forEach.call(list.querySelectorAll('.trk'), function (sec, i) {   // 트랙 머리의 '확정' 표시
      var n = sec.querySelector('.ordnote'), tr = tracks[i];
      if (n && tr) n.outerHTML = ordNote(tr);
    });
    if (shape !== st.shape) {
      var drafts = keepDrafts();                                     // 팀이 다른 트랙으로 옮겨지는 등 통째로 다시 그려도 저장 전 입력은 남게
      st.shape = shape; st.sig = {}; st.jorder = order;
      list.innerHTML = tracks.map(function (tr, i) {
        return '<section class="trk"><div class="trk-hd"><h2>' + esc(tr.name) + ' 트랙</h2><small id="trk-n-' + i + '"></small>' + ordNote(tr) + '</div>' +
          (tr.teams.length ? '<div class="jlist">' + tr.teams.map(function (t) { st.sig[t.no] = JSON.stringify(t); return jrow(t); }).join('') + '</div>'
                           : '<div class="empty-all">아직 제출한 팀이 없습니다.</div>') + '</section>';
      }).join('') || '<div class="empty-all">보여 줄 팀이 없습니다.</div>';
      Array.prototype.forEach.call(list.querySelectorAll('form.jscore'), refreshForm);
      putDrafts(drafts);
    } else {
      tracks.forEach(function (tr) {
        tr.teams.forEach(function (t) {
          var sig = JSON.stringify(t);
          if (st.sig[t.no] !== sig) {
            st.sig[t.no] = sig;
            var p = list.querySelector('#card-' + t.no + ' .post');
            if (p) p.outerHTML = infoCard(t);
          }
          fillForm(t.no, false);
        });
      });
    }
    tracks.forEach(function (tr, i) {
      var el = $('trk-n-' + i);
      if (el) el.textContent = '내 평가 ' + tr.all.filter(function (t) { return st.mine[t.no] && st.mine[t.no].complete; }).length + ' / ' + tr.all.length + '팀';
    });
    paintProgress();
    Object.keys(st.pending).forEach(function (id) { setProg(parseInt(id, 10), st.pending[id].pct); });
    if (rv.form) fillForm(rv.no, false);
    prefetchDecks();
  }

  function saveScore(form) {
    var d = st.data, no = form.getAttribute('data-no'), scores = {};
    var bad = badField(form);
    if (bad) { setState(form, bad.c.name + ' 은(는) 0 – ' + bad.c.max + ' 사이로 적어 주세요 · 저장할 수 없습니다', 'err'); bad.el.focus(); return; }
    d.criteria.forEach(function (c) {
      var raw = String(form.elements[c.key].value).trim();
      scores[c.key] = raw === '' ? '' : Math.round(Number(raw) * 100) / 100;
    });
    var btn = form.querySelector('button[type="submit"]');
    if (!btn || btn.disabled) return;
    btn.disabled = true; btn.classList.add('saving');
    setState(form, '저장하는 중…', '');
    EP.api('score.save', { team: no, scores: scores, comment: form.elements.comment.value }, { key: st.key, nonce: EP.nonce(), tries: 3 }).then(function (r) {
      btn.disabled = false; btn.classList.remove('saving');
      if (r && r.ok) {
        st.mine[no] = r.saved; st.jdirty[no] = false;
        fillForm(no, true);
        paintProgress();
        tracksCount();
        EP.toast(no + '팀 점수를 저장했습니다');
        return;
      }
      if (r && r.error === 'KEY_INVALID') { forget(); gateKey(EP.say(r)); return; }
      if (r && r.error === 'BAD_SCORE' && form.elements[r.item]) { form.elements[r.item].classList.add('bad'); form.elements[r.item].focus(); }
      if (r && r.error === 'SCORE_CLOSED') { load(true); }
      setState(form, EP.say(r), 'err');
    }, function (e) { btn.disabled = false; btn.classList.remove('saving'); setState(form, EP.say(e), 'err'); });
  }
  function tracksCount() {
    var d = st.data, i = 0;
    d.tracks.filter(function (tr) { return !st.tab || tr.name === st.tab; }).forEach(function (tr) {
      var el = $('trk-n-' + (i++));
      if (el) el.textContent = '내 평가 ' + tr.teams.filter(function (t) { return st.mine[t.no] && st.mine[t.no].complete; }).length + ' / ' + tr.teams.length + '팀';
    });
  }
  function onJInput(e) {
    var form = e.target.closest ? e.target.closest('form.jscore') : null;
    if (!form) return;
    st.jdirty[form.getAttribute('data-no')] = true;
    refreshForm(form);
  }
  function onJSubmit(e) {
    var form = e.target.closest ? e.target.closest('form.jscore') : null;
    if (!form) return;
    e.preventDefault();
    saveScore(form);
  }
  function onJKey(e) {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    var form = e.target.closest ? e.target.closest('form.jscore') : null;
    if (form) { e.preventDefault(); saveScore(form); }
  }
  [list, $('rv-side')].forEach(function (el) {
    if (!el) return;
    el.addEventListener('input', onJInput);
    el.addEventListener('submit', onJSubmit);
    el.addEventListener('keydown', onJKey);
  });
  window.addEventListener('beforeunload', function (e) {
    if (Object.keys(st.jdirty).some(function (k) { return st.jdirty[k]; })) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ------------------------------ 파일 받기 · 보기 ------------------------------ */
  function setProg(id, pct) {
    var btns = list.querySelectorAll('[data-id="' + id + '"]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i], on = pct !== null && pct !== undefined;
      b.querySelector('span').textContent = on ? '받는 중 ' + pct + '%' : b.getAttribute('data-label');
      b.classList.toggle('wait', on);
    }
  }
  /**
   * 같은 파일은 한 번만 받는다. 받은 것은 탭이 열려 있는 동안 KEEP_BYTES 까지 기억해 다시 열 때 바로 뜬다.
   * variant 'pdf' 는 보기용 PDF (PPT 를 바꾼 것) — 아직 없으면 서버에 만들어 달라고 한 뒤 받는다.
   */
  function fetchBlob(id, onProg, variant, size) {
    var k = id + (variant ? ':' + variant : '');
    if (st.blobs[k]) { st.order.splice(st.order.indexOf(k), 1); st.order.push(k); return Promise.resolve(st.blobs[k]); }
    var p = st.pending[k];
    if (p) { if (onProg) p.subs.push(onProg); return p.promise; }
    p = st.pending[k] = { subs: onProg ? [onProg] : [], pct: 0, promise: null };
    setProg(id, 0);
    var ready = variant === 'pdf' && !(size > 0)
      ? EP.api('deck.pdf', { id: id }, { key: st.key, timeout: 330000, tries: 1 }).then(function (r) {
          if (!r || !r.ok) { var e = new Error((r && r.error) || 'PDF_FAILED'); e.code = (r && r.error) || 'PDF_FAILED'; throw e; }
          var f = fileById(id);
          if (f) f.pdf = r.pdf;
          return r.pdf;
        })
      : Promise.resolve(size);
    p.promise = ready.then(function (sz) {
      return EP.download(id, { key: st.key, variant: variant || undefined, size: sz, onProgress: function (got, total) {
        p.pct = Math.floor(got / total * 100);
        setProg(id, p.pct);
        p.subs.forEach(function (f) { f(got, total); });
      } });
    }).then(function (r) {
      delete st.pending[k];
      setProg(id, null);
      if (r.size <= 120 * MB) {
        st.blobs[k] = r; st.order.push(k); st.kept += r.size;
        while (st.kept > KEEP_BYTES && st.order.length > 1) { var old = st.order.shift(); st.kept -= (st.blobs[old] || {}).size || 0; delete st.blobs[old]; }
      }
      return r;
    }, function (e) {
      delete st.pending[k];
      setProg(id, null);
      if (e && e.code === 'KEY_INVALID') { forget(); gateKey(EP.say(e)); }
      throw e;
    });
    return p.promise;
  }
  function getFile(id) {
    fetchBlob(id).then(function (r) { EP.saveBlob(r.blob, r.name); }, function (e) { EP.toast(EP.say(e)); });
  }
  function fileById(id) {
    var hit = null;
    if (st.data) st.data.tracks.forEach(function (tr) { tr.teams.forEach(function (t) { var f = fileOf(t, id); if (f) hit = f; }); });
    return hit;
  }

  function viewFile(id, no, type, variant) {
    var t = team(no), f = t && fileOf(t, id);
    if (!f) return;
    if (judgeMode()) { openReview(no, document.querySelector('.jrow[data-no="' + no + '"] .post')); return; }
    var v = $('viewer'), body = $('vw-body'), seq = ++st.viewSeq;
    $('vw-title').textContent = no + '팀 · ' + (t.title || '이름 없음');
    $('vw-sub').textContent = f.name + ' · ' + EP.fmtSize(f.size) + (variant === 'pdf' ? ' · 보기용 PDF' : '');
    $('vw-save').hidden = true;
    body.innerHTML = '<div class="loading" role="status">' + EP.spin('') + '<span>자료를 받는 중입니다</span>' +
      '<div class="prog"><span class="t"><span class="f" id="vw-f"></span></span><span class="n" id="vw-n">0%</span></div></div>';
    v.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    $('vw-close').focus();
    fetchBlob(id, function (got, total) {
      if (seq !== st.viewSeq || !$('vw-f')) return;
      var pct = Math.floor(got / total * 100);
      $('vw-f').style.width = pct + '%';
      $('vw-n').textContent = pct + '%';
    }, variant, variant === 'pdf' ? f.pdf : f.size).then(function (r) {
      if (seq !== st.viewSeq) return;
      var url = URL.createObjectURL(r.blob);
      st.viewUrl = url;
      $('vw-save').hidden = false;
      $('vw-save').onclick = function () { EP.saveBlob(r.blob, r.name); };
      if (type === 'video') body.innerHTML = '<video controls playsinline src="' + url + '"></video>';
      else if (NO_INLINE_PDF) {
        body.innerHTML = '<div class="loading"><span>이 기기에서는 화면 안에서 PDF 를 넘겨 볼 수 없습니다. 새 탭에서 열거나 위의 내려받기를 눌러 주세요.</span>' +
          '<a class="btn" href="' + url + '" target="_blank" rel="noopener"><span>새 탭에서 열기</span></a></div>';
      } else body.innerHTML = '<iframe src="' + url + '#view=FitH" title="' + esc(f.name) + '"></iframe>';
    }, function (e) {
      if (seq !== st.viewSeq) return;
      body.innerHTML = '<div class="loading"><span>' + esc(EP.say(e)) + '</span></div>';
    });
  }
  function closeView() {
    st.viewSeq++;
    $('viewer').hidden = true;
    $('vw-body').innerHTML = '';
    document.documentElement.style.overflow = '';
    if (st.viewUrl) { var u = st.viewUrl; st.viewUrl = ''; setTimeout(function () { URL.revokeObjectURL(u); }, 1000); }
  }

  /* ------------------------------ 이벤트 ------------------------------ */
  list.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b || b.classList.contains('wait')) return;
    var act = b.getAttribute('data-act'), id = Number(b.getAttribute('data-id')), no = b.getAttribute('data-no');
    if (act === 'view') viewFile(id, no, b.getAttribute('data-type'), b.getAttribute('data-variant') || '');
    else if (act === 'get') getFile(id);
    else if (act === 'hist') {
      st.open[no] = !st.open[no];
      var t = team(no), el = judgeMode() ? list.querySelector('#card-' + no + ' .post') : $('card-' + no);
      if (t && el) { el.outerHTML = judgeMode() ? infoCard(t) : card(t); Object.keys(st.pending).forEach(function (k) { setProg(parseInt(k, 10), st.pending[k].pct); }); }
    }
  });
  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-tab]') : null;
    if (!b) return;
    st.tab = b.getAttribute('data-tab');
    render();
  });
  $('only').addEventListener('click', function () {
    st.only = !st.only;
    this.setAttribute('aria-pressed', String(st.only));
    paintList();
  });
  $('reload').addEventListener('click', function () { if (st.data) load(true); });
  $('vw-close').addEventListener('click', closeView);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('viewer').hidden) closeView(); });

  /* ------------------------------ 심사위원: 발표 자료와 평가를 나란히 ------------------------------
     '발표 자료 보기' → 왼쪽에 발표 자료(PDF · 영상), 오른쪽에 그 팀의 점수 · 코멘트.
     누른 카드 자리에서 왼쪽 창이 커지며 열리고(FLIP), 평가 칸은 오른쪽에서 미끄러져 들어온다. 닫으면 그 자리로 돌아간다.
     평가 칸은 목록에 있던 그 팀 폼을 그대로 옮겨 온 것이다 — 적던 것 · 저장 상태가 그대로이고, 닫으면 제자리로 돌려놓는다.
     ← → (또는 키보드 ← →) 로 발표 순서대로 다른 팀. 다음 팀 자료는 미리 받아 두어 바로 뜬다. */
  function teamOrder() {
    var out = [];
    st.data.tracks.forEach(function (tr) { tr.teams.forEach(function (t) { if (t.no !== '00') out.push(t.no); }); });
    return out;
  }
  function putFormBack() {
    if (!rv.form) return;
    var row = list.querySelector('.jrow[data-no="' + rv.no + '"]');
    if (row) {
      var fresh = row.querySelector('form.jscore'), ph = row.querySelector('.jghost');
      if (fresh && fresh !== rv.form) row.replaceChild(rv.form, fresh);        // 그 사이에 목록을 새로 그렸다
      else if (ph) row.replaceChild(rv.form, ph);
      else row.appendChild(rv.form);
    }
    var no = rv.no;
    rv.form = null;
    if (row) fillForm(no, false);
  }
  function sideHtml(t) {
    var links = '', web = function (u) { return /^https?:\/\//i.test(String(u || '')); };     // http · https 만 링크로
    if (web(t.url)) links += '<a class="mini" href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer">서비스 열기 ↗</a>';
    if (web(t.video)) links += '<a class="mini quiet" href="' + esc(t.video) + '" target="_blank" rel="noopener noreferrer">데모 영상 ↗</a>';
    if (web(t.repo)) links += '<a class="mini quiet" href="' + esc(t.repo) + '" target="_blank" rel="noopener noreferrer">코드 ↗</a>';
    if (t.program) links += '<button class="mini quiet" type="button" data-rv="get" data-id="' + t.program.id + '">프로그램 받기</button>';
    return '<div class="rv-team"><span class="no">' + esc(t.no) + '</span><div class="t"><small>' + esc(t.track || '') + '</small>' +
      '<b>' + esc(t.title || '이름을 아직 적지 않았습니다') + '</b></div></div>' +
      (t.desc ? '<p class="rv-desc">' + esc(t.desc) + '</p>' : '') +
      (links ? '<div class="rv-links">' + links + '</div>' : '') + '<div class="rv-slot"></div>';
  }
  function openReview(no, fromEl) {
    var t = team(no);
    if (!t) return;
    var R = $('review'), side = $('rv-side'), opening = R.hidden;
    var from = opening && fromEl ? fromEl.getBoundingClientRect() : null;
    putFormBack();
    rv.no = no;
    side.innerHTML = sideHtml(t);
    var form = list.querySelector('form.jscore[data-no="' + no + '"]');
    if (form) {
      var ph = document.createElement('div');
      ph.className = 'jghost'; ph.textContent = '오른쪽 창에서 평가하는 중입니다';
      form.parentNode.replaceChild(ph, form);
      side.querySelector('.rv-slot').appendChild(form);
      rv.form = form;
      refreshForm(form);
    }
    var ord = teamOrder(), i = ord.indexOf(no);
    $('rv-prev').disabled = i <= 0; $('rv-next').disabled = i < 0 || i >= ord.length - 1;
    $('rv-title').textContent = no + '팀 · ' + (t.title || '이름 없음');
    showDoc(t);
    if (opening) {
      R.hidden = false;
      document.documentElement.style.overflow = 'hidden';
      animIn(from);
      setTimeout(function () { var x = rv.form && rv.form.querySelector('input:not([disabled])'); (x || $('rv-close')).focus({ preventScroll: true }); }, REDUCE ? 0 : 420);
    } else if (!REDUCE) {
      $('rv-doc').animate([{ opacity: .4, transform: 'translateX(14px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EASE });
      side.animate([{ opacity: 0, transform: 'translateX(18px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: EASE });
    }
    var nx = team(ord[i + 1]);                                     // 다음 팀 자료를 미리
    if (nx) { var nv = viewOf(nx.deck); if (nv && nv.type === 'pdf') fetchBlob(nv.id, null, nv.variant, nv.size).catch(function () {}); }
  }
  function showDoc(t) {
    var body = $('rv-body'), seq = ++rv.seq, v = viewOf(t.deck);
    if (rv.url) { var u0 = rv.url; rv.url = ''; setTimeout(function () { URL.revokeObjectURL(u0); }, 1500); }
    $('rv-save').hidden = true;
    $('rv-sub').textContent = t.deck ? t.deck.name + ' · ' + EP.fmtSize(t.deck.size) + (v && v.variant ? ' · 보기용 PDF' : '') : '';
    if (!v) {
      body.innerHTML = '<div class="rv-empty"><span>' + (t.deck ? '이 형식은 화면에서 볼 수 없습니다. 내려받아 열어 주세요.' : '발표 자료를 아직 제출하지 않았습니다.') + '</span>' +
        (t.deck ? '<button class="btn btn-o btn-sm" type="button" data-rv="get" data-id="' + t.deck.id + '"><span>발표 자료 받기</span></button>' : '') + '</div>';
      return;
    }
    var conv = v.variant === 'pdf' && !(v.size > 0);
    body.innerHTML = '<div class="rv-empty" role="status">' + EP.spin('') + '<span>' + (conv ? '보기용 PDF 를 만드는 중입니다 (처음 한 번, 1분까지)' : '자료를 여는 중입니다') + '</span>' +
      '<div class="prog"><span class="t"><span class="f" id="rv-f"></span></span><span class="n" id="rv-n"></span></div></div>';
    fetchBlob(v.id, function (got, total) {
      if (seq !== rv.seq || !$('rv-f')) return;
      var pct = Math.floor(got / total * 100);
      $('rv-f').style.width = pct + '%'; $('rv-n').textContent = pct + '%';
    }, v.variant, v.size).then(function (r) {
      if (seq !== rv.seq) return;
      var url = URL.createObjectURL(r.blob);
      rv.url = url;
      $('rv-save').hidden = false;
      $('rv-save').onclick = function () { EP.saveBlob(r.blob, r.name); };
      if (v.type === 'video') body.innerHTML = '<video controls playsinline src="' + url + '"></video>';
      else if (NO_INLINE_PDF) body.innerHTML = '<div class="rv-empty"><span>이 기기에서는 화면 안에서 PDF 를 넘겨 볼 수 없습니다.</span>' +
        '<a class="btn btn-o btn-sm" href="' + url + '" target="_blank" rel="noopener"><span>새 탭에서 열기</span></a></div>';
      else body.innerHTML = '<iframe src="' + url + '#view=FitH" title="' + esc(t.no + '팀 발표 자료') + '"></iframe>';
      var el = body.firstChild;
      if (el && !REDUCE && el.animate) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
    }, function (e) {
      if (seq !== rv.seq) return;
      body.innerHTML = '<div class="rv-empty"><span>' + esc(EP.say(e)) + '</span>' +
        '<button class="btn btn-o btn-sm" type="button" data-rv="get" data-id="' + t.deck.id + '"><span>원본 받기</span></button></div>';
    });
  }
  function animIn(from) {
    var R = $('review'), doc = $('rv-doc'), side = $('rv-side'), scrim = R.querySelector('.rv-scrim');
    if (REDUCE || !doc.animate) return;
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
    var to = doc.getBoundingClientRect();
    if (from && from.width && to.width) {
      var sx = from.width / to.width, sy = from.height / to.height;
      doc.animate([{ transform: 'translate(' + (from.left - to.left) + 'px,' + (from.top - to.top) + 'px) scale(' + sx + ',' + sy + ')', opacity: .55 },
                   { transform: 'none', opacity: 1 }], { duration: 620, easing: EASE });
    } else {
      doc.animate([{ transform: 'scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 520, easing: EASE });
    }
    side.animate([{ transform: 'translateX(40px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 640, delay: 120, easing: EASE, fill: 'backwards' });
  }
  function closeReview() {
    var R = $('review');
    if (R.hidden || rv.busy) return;
    var doc = $('rv-doc'), side = $('rv-side'), scrim = R.querySelector('.rv-scrim');
    var card = list.querySelector('.jrow[data-no="' + rv.no + '"] .post');
    var done = function () {
      rv.busy = false;
      R.hidden = true;
      [doc, side, scrim].forEach(function (x) { if (x.getAnimations) x.getAnimations().forEach(function (a) { a.cancel(); }); });
      rv.seq++;
      $('rv-body').innerHTML = '';
      if (rv.url) { var u = rv.url; rv.url = ''; setTimeout(function () { URL.revokeObjectURL(u); }, 1500); }
      putFormBack();
      document.documentElement.style.overflow = '';
      if (card) { var b = card.querySelector('[data-act="view"]'); if (b) b.focus({ preventScroll: true }); }
    };
    if (REDUCE || !doc.animate) return done();
    rv.busy = true;
    var to = card ? card.getBoundingClientRect() : null, at = doc.getBoundingClientRect();
    var onScreen = to && to.bottom > 0 && to.top < innerHeight && to.width;
    side.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(32px)', opacity: 0 }], { duration: 260, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    doc.animate([{ transform: 'none', opacity: 1 },
                 onScreen ? { transform: 'translate(' + (to.left - at.left) + 'px,' + (to.top - at.top) + 'px) scale(' + (to.width / at.width) + ',' + (to.height / at.height) + ')', opacity: .35 }
                          : { transform: 'scale(.96)', opacity: 0 }], { duration: 420, easing: EASE, fill: 'forwards' });
    scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: 'ease-in', fill: 'forwards' }).onfinish = done;
  }
  function stepReview(dir) {
    var ord = teamOrder(), i = ord.indexOf(rv.no) + dir;
    if (i >= 0 && i < ord.length) openReview(ord[i]);
  }
  (function () {
    var R = $('review');
    if (!R) return;
    $('rv-close').addEventListener('click', closeReview);
    $('rv-prev').addEventListener('click', function () { stepReview(-1); });
    $('rv-next').addEventListener('click', function () { stepReview(1); });
    R.querySelector('.rv-scrim').addEventListener('click', closeReview);
    R.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-rv="get"]') : null;
      if (b) getFile(Number(b.getAttribute('data-id')));
    });
    document.addEventListener('keydown', function (e) {
      if (R.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); closeReview(); return; }
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '');
      if (!typing && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); stepReview(e.key === 'ArrowRight' ? 1 : -1); }
    });
  })();

  /* 심사위원: 발표 순서대로 볼 수 있는 발표 자료(PDF · 보기용 PDF)를 하나씩 미리 받아 둔다 — 누르면 바로 뜨게.
     한 번에 하나씩, KEEP_BYTES 안에서, 60MB 넘는 것과 영상은 빼고. 새 제출이 오면 그것만 더 받는다. */
  var pre = { busy: false, q: [] };
  function prefetchDecks() {
    if (!judgeMode()) return;
    pre.q = teamOrder().map(team).map(function (t) { return t && viewOf(t.deck); }).filter(function (v) {
      return v && v.type === 'pdf' && v.size > 0 && v.size < 60 * MB && !st.blobs[v.id + (v.variant ? ':' + v.variant : '')];
    });
    if (!pre.busy) setTimeout(pumpPrefetch, 2000);
  }
  function pumpPrefetch() {
    if (pre.busy || document.hidden) return;
    var v = pre.q.shift();
    if (!v || st.kept + v.size > KEEP_BYTES) return;
    pre.busy = true;
    var next = function () { pre.busy = false; setTimeout(pumpPrefetch, 400); };
    fetchBlob(v.id, null, v.variant, v.size).then(next, next);
  }

  /* ------------------------------ 시각 · 새로 고침 ------------------------------ */
  function tick() {
    var d = st.data, dl = d ? d.deadline : (Date.parse(EP.cfg.DEADLINE) || 0), el = $('s-deadline');
    // 심사위원 화면: 제출이 마감된 뒤에는 그 자리에 심사 마감(점수를 고칠 수 있는 마지막 시각)을 보인다
    var cut = d && judgeMode() && d.scoreUntil && (!dl || EP.now() > dl) ? d.scoreUntil : 0;
    if (el.previousElementSibling) el.previousElementSibling.textContent = cut ? '심사 마감' : '제출 마감';
    if (cut) {
      var rest = cut - EP.now();
      el.textContent = rest > 0 && d.scoring !== 'closed' ? EP.fmtDay(cut) + ' · ' + EP.fmtLeft(rest) + ' 남음' : EP.fmtDay(cut) + ' · 마감됨';
      // 마감 시각이 지나면 한 번 새로 읽어 입력 칸을 닫는다 (사람마다 몇 초씩 어긋나게)
      if (rest < -st.jit && d.scoring !== 'closed' && st.cutSeen !== cut) { st.cutSeen = cut; load(true); }
      return;
    }
    if (!dl) { el.textContent = '—'; return; }
    var left = dl - EP.now();
    el.textContent = left > 0 ? EP.fmtDay(dl) + ' · ' + EP.fmtLeft(left) + ' 남음' : EP.fmtDay(dl) + ' · 마감됨';
  }
  setInterval(tick, 1000);
  tick();

  // 사람마다 조금씩 어긋난 간격으로 새로 읽는다 (서버가 한꺼번에 몰리지 않게)
  var period = 50000 + Math.floor(Math.random() * 20000);
  setInterval(function () {
    if (!document.hidden && st.key && st.data && Date.now() - st.loadedAt > period) load(true);
    if (!document.hidden && !st.key && pub.on && pub.nextAt && EP.now() >= pub.nextAt) pubLoad();   // 공개 현황
  }, 5000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && st.key && st.data && Date.now() - st.loadedAt > 20000) load(true);
  });

  if (EP.pending) {
    // 사이트는 올라갔는데 제출 서버가 아직 연결되지 않았다
    showGate('<div class="t"><span class="lab blue">Opening soon</span><b>제출 현황판을 준비하고 있습니다</b>' +
      '<span>제출이 열리면 받으신 링크로 들어오실 수 있습니다.</span></div>');
    return;
  }
  $('demo-note').hidden = !EP.demo;
  EP.warm();
  load();
})();
