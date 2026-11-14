/* ==============================================================
   심사 종합 (/judge/score/) — 운영진 열람 토큰으로만
   --------------------------------------------------------------
   트랙별 순위표: 심사위원 평균 J (4문항을 다 채운 점수만) · 인기투표 P · 최종 S = 0.85 × J + P.
   동점이면 J → 구조적 이해 평균 순. 줄을 누르면 심사위원별 점수 · 문항 평균 · 코멘트가 펼쳐진다.
   심사위원이 많으면(7명 이상) 사람별 칸 대신 '평가 n명' 만 보이고, 사람별 점수는 펼쳐서 본다.
   토큰은 현황판과 같은 곳(sessionStorage)에 두므로 현황판에서 넘어오면 다시 넣지 않아도 된다.
   ============================================================== */
(function () {
  'use strict';
  var EP = window.EP, esc = EP.esc, $ = EP.$;
  var KEY = 'endpoint.view.key';
  var gate = $('gate'), app = $('app'), list = $('list');
  var WIDE = 6;                       // 이 수까지는 심사위원마다 칸을 둔다
  var st = { key: '', d: null, tab: '', open: {}, loadedAt: 0, busy: false };

  (function () {
    var m = /[#&]k=([A-Za-z0-9_\-]{24,128})/.exec(location.hash || '');
    if (m) {
      st.key = m[1];
      try { sessionStorage.setItem(KEY, st.key); } catch (e) {}
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e2) {}
    } else { try { st.key = sessionStorage.getItem(KEY) || ''; } catch (e3) {} }
    if (EP.demo) st.key = 'preview-preview-preview-preview';
  })();

  function showGate(html) { gate.innerHTML = html; gate.hidden = false; app.hidden = true; }
  function gateKey(why) {
    showGate('<div class="t"><span class="lab ' + (why ? 'red' : 'blue') + '">Staff</span>' +
      '<b>' + esc(why || '참여 토큰을 입력해 주세요') + '</b></div>' +
      '<form class="act rowy" id="key-form" autocomplete="off">' +
        '<input class="tin" id="key-in" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="참여 토큰" placeholder="참여 토큰" style="min-width:min(300px,70vw)">' +
        '<button class="btn btn-o" type="submit"><span>열기</span></button></form>');
    $('key-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('key-in').value.trim(), m = /k=([A-Za-z0-9_\-]{24,128})/.exec(v);
      v = m ? m[1] : v;
      if (!/^[A-Za-z0-9_\-]{24,128}$/.test(v)) { gateKey('토큰이 올바르지 않습니다'); return; }
      st.key = v;
      try { sessionStorage.setItem(KEY, v); } catch (e2) {}
      load();
    });
  }

  var seq = 0;
  function load(silent) {
    if (!st.key) { gateKey(); return Promise.resolve(); }
    var my = ++seq;
    if (!silent) showGate(EP.loading('심사 점수를 모으는 중'));
    return EP.api('score.summary', {}, { key: st.key, tries: 3 }).then(function (d) {
      if (my !== seq) return;
      if (d && d.ok) { st.d = d; st.loadedAt = Date.now(); render(); return; }
      if (d && d.error === 'KEY_INVALID') { forget(); gateKey(EP.say(d)); return; }
      if (d && d.error === 'NOT_STAFF') { gateKey('운영진 · 심사위원 참여 토큰으로만 볼 수 있습니다'); return; }
      if (!silent) showGate('<div class="t"><span class="lab red">Error</span><b>불러오지 못했습니다</b><span>' + esc(EP.say(d)) + '</span></div>');
    }, function (e) {
      if (my !== seq || silent) return;
      showGate('<div class="t"><span class="lab red">Error</span><b>불러오지 못했습니다</b><span>' + esc(EP.say(e)) + '</span></div>');
    });
  }
  function forget() { st.key = ''; st.d = null; try { sessionStorage.removeItem(KEY); } catch (e) {} $('top-auth').innerHTML = ''; }

  function n2(x) { return x === null || x === undefined || x === '' ? '—' : (Math.round(Number(x) * 100) / 100).toFixed(2); }

  function render() {
    var d = st.d;
    gate.hidden = true; app.hidden = false;
    $('top-auth').innerHTML = '<div class="who"><span class="nm" style="display:inline;max-width:24ch">' + esc(d.name || '') + ' · ' + esc(d.role || '') +
      '</span><button class="mini quiet" type="button" id="leave">나가기</button></div>';
    $('leave').addEventListener('click', function () { forget(); gateKey(); });

    var teams = 0, done = 0;
    d.tracks.forEach(function (tr) { tr.rows.forEach(function (r) { teams++; Object.keys(r.judges).forEach(function (id) { if (r.judges[id].complete) done++; }); }); });
    $('s-judges').textContent = d.judges.length + '명';
    $('s-prog').textContent = done + ' / ' + (d.judges.length * teams) + '건';
    var until = d.scoreUntil ? EP.fmtTime(d.scoreUntil).slice(6) : '';
    $('s-state').innerHTML = d.scoring === 'closed' ? '마감됨' + (until ? ' · ' + until : '')
      : '<span style="color:var(--blue)">받는 중</span>' + (until ? ' · ' + until + '까지' : '');
    $('lock').textContent = d.scoring === 'closed' ? '심사 다시 열기' : '심사 마감 · 결과 발표';
    var auto = $('lock-auto');
    if (d.scoreCustom && !auto) {
      auto = document.createElement('button');
      auto.id = 'lock-auto'; auto.type = 'button'; auto.className = 'chipbtn'; auto.textContent = '심사 시간표대로';
      $('lock').parentNode.insertBefore(auto, $('reload'));
      auto.addEventListener('click', function () { lockOp('auto'); });
    }
    if (auto) auto.hidden = !d.scoreCustom;
    paintRes(d.results);
    var boss = d.role === '운영진';                         // 교수님은 읽기만 (마감 · 결과 발표는 운영진)
    ['lock', 'res', 'lock-auto'].forEach(function (id) { var x = $(id); if (x && !boss) x.hidden = true; });
    if ($('lock')) $('lock').hidden = !boss;
    $('s-res').parentNode.hidden = !boss;

    if (!st.tab || !d.tracks.some(function (t) { return t.key === st.tab; })) st.tab = d.tracks[0] ? d.tracks[0].key : '';
    $('tabs').innerHTML = d.tracks.map(function (tr) {
      var n = tr.rows.filter(function (r) { return r.J !== null; }).length;
      return '<button class="tab" type="button" role="tab" data-tab="' + esc(tr.key) + '" aria-selected="' + (st.tab === tr.key) + '">' + esc(tr.name) +
        '<span class="cnt">' + n + '/' + tr.rows.length + '</span></button>';
    }).join('');
    $('when').textContent = EP.fmtTime(d.now).slice(6) + ' 기준';
    $('formula').innerHTML = '최종 <b>S = ' + d.weight + ' × J + P</b> · J = 4문항을 모두 채운 심사위원 점수의 평균 (100점) · P = 인기투표 참가자 점수 (' + (d.popMax || 15) + '점) · 동점이면 J → 구조적 이해 평균 순';
    paint();
  }

  function paint() {
    var d = st.d, tr = null;
    d.tracks.forEach(function (t) { if (t.key === st.tab) tr = t; });
    if (!tr) { list.innerHTML = ''; return; }
    var wide = d.judges.length <= WIDE;
    var head = '<tr><th class="rk">순위</th><th>팀</th>' +
      (wide ? d.judges.map(function (j) { return '<th class="r">' + esc(j.name) + '</th>'; }).join('') : '<th class="r">평가</th>') +
      '<th class="r agg">심사 평균 J</th><th class="r">인기투표</th><th class="r">투표 점수 P</th><th class="r">최종 S</th></tr>';   // 'J' 만 쓰면 심사위원이 한 명 더 있는 것처럼 보인다
    var body = tr.rows.map(function (r) {
      var open = !!st.open[tr.key + r.no];
      var cells = wide
        ? d.judges.map(function (j) {
            var x = r.judges[j.id];
            return '<td class="r num' + (x && !x.complete ? ' part' : '') + '">' + (x ? n2(x.total) + (x.complete ? '' : '*') : '—') + '</td>';
          }).join('')
        : '<td class="r num">' + r.scored + ' / ' + d.judges.length + '명</td>';
      var row = '<tr class="row' + (r.rank === 1 ? ' top' : '') + '" data-no="' + esc(r.no) + '" aria-expanded="' + open + '">' +
        '<td class="rk">' + (r.rank || '—') + '</td>' +
        '<td class="nm">' + esc(r.no) + '팀<small>' + esc(r.title || '이름 없음') + '</small></td>' + cells +
        '<td class="r num agg">' + n2(r.J) + '</td><td class="r num">' + r.votes + '표</td><td class="r num">' + n2(r.P) + '</td>' +
        '<td class="r num s">' + n2(r.S) + '</td></tr>';
      if (!open) return row;
      var colN = 6 + (wide ? d.judges.length : 1);
      var per = d.judges.map(function (j) {
        var x = r.judges[j.id];
        if (!x) return '';
        return '<tr><td>' + esc(j.name) + '</td>' + d.criteria.map(function (c) { return '<td class="r num">' + n2(x.s[c.key]) + '</td>'; }).join('') +
          '<td class="r num"><b>' + n2(x.total) + '</b>' + (x.complete ? '' : ' (작성 중)') + '</td></tr>';
      }).join('');
      var avg = '<tr><td><b>평균</b></td>' + d.criteria.map(function (c) { return '<td class="r num"><b>' + n2(r.avg[c.key]) + '</b></td>'; }).join('') + '<td class="r num"><b>' + n2(r.J) + '</b></td></tr>';
      var crit = '<tr><td></td>' + d.criteria.map(function (c) { return '<td class="r" style="color:var(--dim-2);font-size:11.5px">' + esc(c.name) + '</td>'; }).join('') + '<td class="r" style="color:var(--dim-2);font-size:11.5px">합계</td></tr>';
      var cm = r.comments.length ? r.comments.map(function (c) { return '<div class="cm"><b>' + esc(c.judge) + '</b>' + esc(c.text) + '</div>'; }).join('') : '<p class="sub" style="margin:0">코멘트가 없습니다.</p>';
      return row + '<tr class="more"><td colspan="' + colN + '"><div class="sdet">' +
        '<div><h4>심사위원별 점수</h4><table>' + crit + (per || '<tr><td colspan="9" style="color:var(--dim-2)">아직 평가가 없습니다.</td></tr>') + (per ? avg : '') + '</table></div>' +
        '<div><h4>코멘트</h4>' + cm + '</div></div></td></tr>';
    }).join('');
    list.innerHTML = '<div class="swrap"><table class="stable"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      (wide ? '<p class="sub" style="font-size:12.5px;margin-top:10px">* 표시는 아직 4문항을 다 채우지 않은 점수입니다 (평균에 넣지 않음). 줄을 누르면 문항별 점수와 코멘트가 펼쳐집니다.</p>'
            : '<p class="sub" style="font-size:12.5px;margin-top:10px">심사위원이 많아 사람별 점수는 줄을 눌러 펼쳐 봅니다.</p>');
  }

  function csv() {
    var d = st.d, lines = [];
    var q = function (v) { var s = String(v === null || v === undefined ? '' : v); s = /^[=+\-@]/.test(s) ? "'" + s : s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    lines.push(['트랙', '순위', '팀', '프로젝트'].concat(d.judges.map(function (j) { return j.name; }), ['심사위원 평균 J', '인기투표 표', 'P', '최종 S'],
      d.criteria.map(function (c) { return c.name + ' 평균'; })).map(q).join(','));
    d.tracks.forEach(function (tr) {
      tr.rows.forEach(function (r) {
        lines.push([tr.name, r.rank || '', r.no, r.title].concat(
          d.judges.map(function (j) { var x = r.judges[j.id]; return x ? (x.complete ? x.total : x.total + ' (작성 중)') : ''; }),
          [r.J === null ? '' : r.J, r.votes, r.P, r.S === null ? '' : r.S],
          d.criteria.map(function (c) { return r.avg[c.key] === null ? '' : r.avg[c.key]; })).map(q).join(','));
      });
    });
    EP.saveBlob(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), 'ENDPoinT-심사종합-' + EP.fmtTime(EP.now()).replace(/[ :.]/g, '') + '.csv');
  }

  list.addEventListener('click', function (e) {
    var tr = e.target.closest ? e.target.closest('tr.row') : null;
    if (!tr) return;
    var k = st.tab + tr.getAttribute('data-no');
    st.open[k] = !st.open[k];
    paint();
  });
  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-tab]') : null;
    if (!b) return;
    st.tab = b.getAttribute('data-tab');
    render();
  });
  $('reload').addEventListener('click', function () { if (st.d) load(true); });
  $('csv').addEventListener('click', function () { if (st.d) csv(); });
  // 마감 · 다시 열기(10분 뒤 저절로 마감) · 시간표대로. 서버는 SCORE_UNTIL 속성에 시각을 적는다
  function lockOp(op) {
    if (!st.d || st.busy) return;
    var ask = { close: '심사와 투표를 지금 마감하고 메인 페이지에 결과를 띄울까요?' + votesNote() + '\n심사는 다시 열 수 있습니다.',
                open: '심사를 다시 열까요?\n10분 뒤 저절로 마감됩니다.', auto: '심사 마감 시각을 시간표대로 되돌릴까요?' }[op];
    if (!window.confirm(ask)) return;
    st.busy = true;
    EP.api('score.state', { op: op }, { key: st.key, tries: 2 }).then(function (r) {
      st.busy = false;
      if (r && r.ok) { EP.toast({ close: '심사' + (r.votesClosed && r.votesClosed.length ? ' · 투표(' + r.votesClosed.join(' · ') + ')' : '') + '를 마감했습니다 · 메인에 결과를 띄웁니다', open: '심사를 다시 열었습니다 (결과는 메인에서 내려갑니다)', auto: '시간표대로 되돌렸습니다' }[op]); load(true); }
      else EP.toast(EP.say(r));
    }, function (e) { st.busy = false; EP.toast(EP.say(e)); });
  }
  $('lock').addEventListener('click', function () { if (st.d) lockOp(st.d.scoring !== 'closed' ? 'close' : 'open'); });

  /* 메인 페이지 결과 발표: '심사 마감' 을 누르면 메인에 결과가 뜬다(투표가 아직이면 투표 마감 때).
     이미 (14:25 에 저절로) 마감됐으면 '결과 발표' 로 띄운다. '결과 내리기' 는 메인에서 감춘다.
     시상 화면(/judge/award/)은 어디에도 링크를 두지 않는다 — 운영진이 주소로 직접 연다. */
  function paintRes(r) {
    var el = $('s-res'), btn = $('res'), closed = st.d && st.d.scoring === 'closed';
    if (!r) { el.textContent = '—'; btn.hidden = true; return; }      // 서버가 아직 예전 버전
    var on = r.at !== -1 && (r.state === 'open' || r.state === 'judging');                      // 띄우기로 한 상태 (투표 마감 대기 포함)
    el.innerHTML = !closed ? '심사 마감을 누르면 메인에'
      : r.state === 'open' ? '<span style="color:var(--blue)">메인에 공개 중</span>'
      : on ? '투표가 끝나는 대로 공개'
      : r.at > 0 && r.at > (st.d.now || 0) ? EP.fmtTime(r.at).slice(6) + ' 공개 예정' : '공개 전';
    btn.hidden = !closed;
    btn.disabled = false;
    btn.textContent = on ? '결과 내리기' : '결과 발표';
    btn.setAttribute('data-op', on ? 'hide' : 'now');
  }
  /** 확인 창에 덧붙일 투표 상태: 아직 닫히지 않은 투표는 이 단추로 함께 마감된다 (열리기 전이면 열리지 않고 끝난다) */
  function votesNote() {
    var open = [], ready = [];
    ((st.d && st.d.tracks) || []).forEach(function (tr) { if (tr.vote === 'open') open.push(tr.name); else if (tr.vote === 'ready') ready.push(tr.name); });
    var t = '';
    if (open.length) t += '\n지금 투표 중인 ' + open.join(' · ') + ' 투표도 함께 마감됩니다.';
    if (ready.length) t += '\n아직 열리지 않은 ' + ready.join(' · ') + ' 투표는 열리지 않고 끝납니다.';
    return t;
  }
  function resOp(op) {
    if (!st.d || st.busy) return;
    var ask = { now: '메인 페이지에 결과(해커톤 1 – 3등 · 구현과제 1 – 4등)를 띄울까요?' + votesNote(),
                hide: '메인 페이지에서 결과를 내릴까요?\n다시 띄울 때까지 보이지 않습니다.' }[op];
    if (!window.confirm(ask)) return;
    st.busy = true;
    EP.api('results.state', { op: op }, { key: st.key, tries: 2 }).then(function (r) {
      st.busy = false;
      if (r && r.ok) { EP.toast({ now: (r.votesClosed && r.votesClosed.length ? '투표(' + r.votesClosed.join(' · ') + ')를 마감하고 ' : '') + '메인에 결과를 띄웠습니다 (1분 안에 보입니다)', hide: '메인에서 결과를 내렸습니다' }[op]); load(true); }
      else EP.toast(EP.say(r));
    }, function (e) { st.busy = false; EP.toast(EP.say(e)); });
  }
  $('res').addEventListener('click', function () { if (st.d) resOp(this.getAttribute('data-op') || 'now'); });

  setInterval(function () { if (!document.hidden && st.d && Date.now() - st.loadedAt > 30000) load(true); }, 5000);

  if (EP.pending) { showGate('<div class="t"><span class="lab blue">Opening soon</span><b>심사 종합을 준비하고 있습니다</b></div>'); return; }
  $('demo-note').hidden = !EP.demo;
  EP.warm();
  load();
})();
