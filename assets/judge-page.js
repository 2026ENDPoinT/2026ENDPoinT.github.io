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
  var IOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // 화면 안에서 PDF 를 넘겨 볼 수 없는 기기: iOS(첫 쪽만 보인다) · 안드로이드 크롬처럼 PDF 보기가 없는 브라우저
  var NO_INLINE_PDF = IOS || navigator.pdfViewerEnabled === false;

  var st = {
    mine: {}, jdirty: {},      // 심사위원: 내 점수 · 고치는 중인 팀
    key: '', data: null, tab: '', only: false, loadedAt: 0, shape: '', sig: {}, open: {},
    blobs: {}, order: [], pending: {}, viewSeq: 0, viewUrl: ''
  };

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
  if (EP.demo) st.key = 'preview-preview-preview-preview';
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
        '<b>' + (why ? esc(why) : '심사위원 · 운영진은 받으신 열람 링크로 들어와 주세요') + '</b>' +
        (why ? '<span>링크가 만료됐다면 운영진에게 새 링크를 요청해 주세요.</span>' : '') + '</div>' +
        '<form class="act rowy" id="key-form" autocomplete="off">' +
          '<input class="tin" id="key-in" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="열람 코드" placeholder="열람 코드" style="min-width:min(260px,70vw)">' +
          '<button class="btn btn-o" type="submit"><span>열기</span></button></form></div>' +
      '</div>');
    $('key-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('key-in').value.trim(), m = /k=([A-Za-z0-9_\-]{24,128})/.exec(v);   // 링크를 통째로 붙여 넣어도 된다
      v = m ? m[1] : v;
      if (!/^[A-Za-z0-9_\-]{24,128}$/.test(v)) { gateKey('열람 코드가 올바르지 않습니다'); return; }
      st.key = v;
      try { sessionStorage.setItem(KEY, v); } catch (e2) {}
      load();
    });
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
    $('top-auth').innerHTML = '<div class="who"><span class="nm" style="display:inline;max-width:24ch">' + esc(d.name || '') +
      (d.name ? ' · ' : '') + esc(d.role || '') + '</span><button class="mini quiet" type="button" id="leave">나가기</button></div>';
    $('leave').addEventListener('click', function () { forget(); gateKey(); });

    var sum = d.summary || { teams: 0, complete: 0, deck: 0, product: 0 };
    $('s-done').textContent = sum.complete + ' / ' + sum.teams + '팀';
    if (judgeMode()) paintProgress();
    else $('s-parts').textContent = '발표 ' + sum.deck + ' · 결과물 ' + sum.product;
    if (staff() && !$('to-score')) {
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
    var shape = st.tab + '|' + st.only + '|' + (staff() ? 's' : 'j') + '|' + tracks.map(function (tr) {
      return tr.name + ':' + tr.teams.map(function (t) { return t.no; }).join(',');
    }).join(';');

    if (shape !== st.shape) {
      // 보이는 팀의 구성이 달라졌다 — 통째로 다시 그린다
      st.shape = shape; st.sig = {};
      var html = tracks.map(function (tr, i) {
        return '<section class="trk"><div class="trk-hd"><h2>' + esc(tr.name) + ' 트랙</h2><small id="trk-n-' + i + '"></small></div>' +
          (tr.teams.length ? '<div class="posts">' + tr.teams.map(function (t) { st.sig[t.no] = JSON.stringify(t); return card(t); }).join('') + '</div>'
                           : '<div class="empty-all">아직 낸 팀이 없습니다.</div>') + '</section>';
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
    Object.keys(st.pending).forEach(function (id) { setProg(Number(id), st.pending[id].pct); });
  }

  function fileBtn(t, f, primary) {
    var ext = EP.extOf(f.name), type = f.kind === 'deck' ? VIEW[ext] : '';
    var label = f.kind === 'program' ? '프로그램 받기' : type === 'video' ? '발표 영상 보기' : type ? '발표 자료 보기' : '발표 자료 받기';
    return '<button class="btn ' + (primary ? 'btn-k' : 'btn-w') + ' btn-sm" type="button" data-act="' + (type ? 'view' : 'get') + '" data-id="' + f.id +
      '" data-no="' + esc(t.no) + '" data-type="' + (type || '') + '" data-label="' + label + '" title="' + esc(f.name) + ' · ' + EP.fmtSize(f.size) + '"><span>' + label + '</span></button>';
  }
  function ext(href, label, primary) {
    if (!/^https?:\/\//i.test(String(href || ''))) return '';       // http · https 가 아닌 주소는 링크로 만들지 않는다
    return '<a class="btn ' + (primary ? 'btn-k' : 'btn-w') + ' btn-sm" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer"><span>' + label + ' ↗</span></a>';
  }

  function card(t) {
    var any = has(t), cls = t.complete ? 'done' : any ? 'part' : 'none';
    if (!any) {
      return '<article class="post none" id="card-' + esc(t.no) + '"><div class="hd"><span class="no">' + esc(t.no) + '</span>' +
        '<span class="badge">제출 전</span></div><h3>아직 낸 것이 없습니다</h3></article>';
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

    return '<article class="post ' + cls + '" id="card-' + esc(t.no) + '">' +
      '<div class="hd"><span class="no">' + esc(t.no) + '</span>' +
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
  function refreshForm(form) {
    var d = st.data, no = form.getAttribute('data-no'), sum = 0, filled = 0;
    d.criteria.forEach(function (c) {
      var raw = String(form.elements[c.key].value).trim();
      if (raw === '') return;
      var n = Number(raw);
      if (isFinite(n)) { sum += n; filled++; }
    });
    form.querySelector('[data-sum]').textContent = filled ? fmt2(sum) : '—';
    var m = st.mine[no];
    if (d.scoreError) setState(form, '심사 시트가 아직 연결되지 않았습니다. 운영진에게 알려 주세요.', 'err');
    else if (d.scoring === 'closed') setState(form, '심사가 마감되었습니다', '');
    else if (st.jdirty[no]) setState(form, '저장하지 않은 내용이 있습니다', 'dirty');
    else if (m && m.complete) setState(form, '저장됨 · ' + EP.fmtTime(m.at).slice(6), 'ok');
    else if (m) setState(form, '작성 중 · ' + m.filled + ' / ' + d.criteria.length + '문항 · ' + EP.fmtTime(m.at).slice(6), '');
    else setState(form, '아직 평가하지 않았습니다', '');
  }
  /** 서버 값으로 칸을 채운다 (고치는 중인 칸 · 커서가 있는 칸은 건드리지 않는다) */
  function fillForm(no, force) {
    var form = list.querySelector('form.jscore[data-no="' + no + '"]');
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
    var shape = 'J|' + st.tab + '|' + st.only + '|' + d.scoring + '|' + (d.scoreError || '') + '|' + tracks.map(function (tr) {
      return tr.name + ':' + tr.teams.map(function (t) { return t.no; }).join(',');
    }).join(';');
    if (shape !== st.shape) {
      st.shape = shape; st.sig = {};
      list.innerHTML = tracks.map(function (tr, i) {
        return '<section class="trk"><div class="trk-hd"><h2>' + esc(tr.name) + ' 트랙</h2><small id="trk-n-' + i + '"></small></div>' +
          (tr.teams.length ? '<div class="jlist">' + tr.teams.map(function (t) { st.sig[t.no] = JSON.stringify(t); return jrow(t); }).join('') + '</div>'
                           : '<div class="empty-all">아직 낸 팀이 없습니다.</div>') + '</section>';
      }).join('') || '<div class="empty-all">보여 줄 팀이 없습니다.</div>';
      Array.prototype.forEach.call(list.querySelectorAll('form.jscore'), refreshForm);
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
    Object.keys(st.pending).forEach(function (id) { setProg(Number(id), st.pending[id].pct); });
  }

  function saveScore(form) {
    var d = st.data, no = form.getAttribute('data-no'), scores = {}, bad = null, badName = '', badMax = 0;
    d.criteria.forEach(function (c) {
      var el = form.elements[c.key], raw = String(el.value).trim();
      el.classList.remove('bad');
      if (raw === '') { scores[c.key] = ''; return; }
      var n = Number(raw);
      if (!isFinite(n) || n < 0 || n > c.max) { if (!bad) { bad = el; badName = c.name; badMax = c.max; } el.classList.add('bad'); return; }
      scores[c.key] = Math.round(n * 100) / 100;
    });
    if (bad) { setState(form, badName + ' 은(는) 0 – ' + badMax + ' 사이로 적어 주세요', 'err'); bad.focus(); return; }
    var btn = form.querySelector('button[type="submit"]');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    setState(form, '저장하는 중…', '');
    EP.api('score.save', { team: no, scores: scores, comment: form.elements.comment.value }, { key: st.key, nonce: EP.nonce(), tries: 3 }).then(function (r) {
      btn.disabled = false;
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
    }, function (e) { btn.disabled = false; setState(form, EP.say(e), 'err'); });
  }
  function tracksCount() {
    var d = st.data, i = 0;
    d.tracks.filter(function (tr) { return !st.tab || tr.name === st.tab; }).forEach(function (tr) {
      var el = $('trk-n-' + (i++));
      if (el) el.textContent = '내 평가 ' + tr.teams.filter(function (t) { return st.mine[t.no] && st.mine[t.no].complete; }).length + ' / ' + tr.teams.length + '팀';
    });
  }
  list.addEventListener('input', function (e) {
    var form = e.target.closest ? e.target.closest('form.jscore') : null;
    if (!form) return;
    st.jdirty[form.getAttribute('data-no')] = true;
    e.target.classList.remove('bad');
    refreshForm(form);
  });
  list.addEventListener('submit', function (e) {
    var form = e.target.closest ? e.target.closest('form.jscore') : null;
    if (!form) return;
    e.preventDefault();
    saveScore(form);
  });
  list.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    var form = e.target.closest ? e.target.closest('form.jscore') : null;
    if (form) { e.preventDefault(); saveScore(form); }
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
  /** 같은 파일은 한 번만 받는다. 받은 것은 탭이 열려 있는 동안 몇 개까지 기억해 다시 열 때 바로 뜬다. */
  function fetchBlob(id, onProg) {
    if (st.blobs[id]) return Promise.resolve(st.blobs[id]);
    var p = st.pending[id];
    if (p) { if (onProg) p.subs.push(onProg); return p.promise; }
    p = st.pending[id] = { subs: onProg ? [onProg] : [], pct: 0, promise: null };
    setProg(id, 0);
    p.promise = EP.download(id, { key: st.key, onProgress: function (got, total) {
      p.pct = Math.floor(got / total * 100);
      setProg(id, p.pct);
      p.subs.forEach(function (f) { f(got, total); });
    } }).then(function (r) {
      delete st.pending[id];
      setProg(id, null);
      if (r.size <= 120 * 1024 * 1024) {
        st.blobs[id] = r; st.order.push(id);
        while (st.order.length > 8) delete st.blobs[st.order.shift()];
      }
      return r;
    }, function (e) {
      delete st.pending[id];
      setProg(id, null);
      if (e && e.code === 'KEY_INVALID') { forget(); gateKey(EP.say(e)); }
      throw e;
    });
    return p.promise;
  }
  function getFile(id) {
    fetchBlob(id).then(function (r) { EP.saveBlob(r.blob, r.name); }, function (e) { EP.toast(EP.say(e)); });
  }

  function viewFile(id, no, type) {
    var t = team(no), f = t && fileOf(t, id);
    if (!f) return;
    var v = $('viewer'), body = $('vw-body'), seq = ++st.viewSeq;
    $('vw-title').textContent = no + '팀 · ' + (t.title || '이름 없음');
    $('vw-sub').textContent = f.name + ' · ' + EP.fmtSize(f.size);
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
    }).then(function (r) {
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
    if (act === 'view') viewFile(id, no, b.getAttribute('data-type'));
    else if (act === 'get') getFile(id);
    else if (act === 'hist') {
      st.open[no] = !st.open[no];
      var t = team(no), el = judgeMode() ? list.querySelector('#card-' + no + ' .post') : $('card-' + no);
      if (t && el) { el.outerHTML = judgeMode() ? infoCard(t) : card(t); Object.keys(st.pending).forEach(function (k) { setProg(Number(k), st.pending[k].pct); }); }
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

  /* ------------------------------ 시각 · 새로 고침 ------------------------------ */
  function tick() {
    var dl = st.data ? st.data.deadline : (Date.parse(EP.cfg.DEADLINE) || 0), el = $('s-deadline');
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
