/* 홈의 결과 세 절 — '결과 발표'(#results) · '2026 우승 서비스 소개'(#winners) · '수상팀 발표자료'(#decks) 와 보기 창(#viewer).
   데이터는 assets/results-2026.js (window.EP2026) 하나. 서버에 묻지 않는다.
   보기 창은 심사위원 현황(/judge/)의 '발표 자료 보기' 창과 같은 틀이다. 발표자료는 Google Drive 의 공개 사본을
   열 때만 iframe(/preview)으로 불러온다. 그림은 같은 창에 크게. */
(function () {
  var D = window.EP2026;
  if (!D) return;
  function $(id) { return document.getElementById(id); }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function trackLab(key, name, extra) {
    return key === 'H' ? '<span class="lab red">Hackathon track' + (extra || '') + '</span>'
      : '<span class="lab blue">' + esc(name) + ' 트랙' + (extra || '') + '</span>';
  }
  var trackName = {}, placeOf = {};
  D.tracks.forEach(function (tr) {
    trackName[tr.key] = tr.name;
    tr.places.forEach(function (p) { p.teams.forEach(function (t) { placeOf[t.no] = { place: p.place, track: tr.key, title: t.title }; }); });
  });
  var EXT = '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" focusable="false"><path d="M3 9L9 3M4.5 3H9v4.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';

  /* ---------------- 결과 발표 — 등수만 (동점은 같은 등수에 여러 팀) ---------------- */
  function paintResults() {
    var sec = $('results'), grid = $('results-grid');
    if (!sec || !grid) return;
    grid.innerHTML = D.tracks.map(function (tr) {
      var rows = tr.places.filter(function (p) { return p.teams && p.teams.length; }).map(function (p) {
        return '<div class="pl p' + p.place + '"><b>' + p.place + '등</b><div class="tms">' + p.teams.map(function (t) {
          return '<div class="tm"><span class="no">' + esc(t.no) + '팀</span><span class="ti">' + esc(t.title || '—') + '</span></div>';
        }).join('') + '</div></div>';
      }).join('');
      return '<div class="res-trk" data-track="' + esc(tr.key) + '">' + trackLab(tr.key, tr.name) + rows + '</div>';
    }).join('');
    sec.hidden = false;
    sec.classList.add('show');
    // 맨 위 단추도 결과로 (모집 기간에는 '참가 신청' 자리)
    var a = document.querySelector('#v-home .hero-cta a.btn');
    if (a) { a.setAttribute('href', '#results'); a.classList.remove('gated'); a.removeAttribute('aria-disabled'); a.removeAttribute('data-gate'); a.removeAttribute('title'); a.innerHTML = '<span>결과 보기</span>'; }
  }

  /* ---------------- 우승 서비스 소개 — 두 팀을 같은 틀로 ---------------- */
  function deckBtn(no, cls) {
    var id = (D.decks || {})[no];
    return id ? '<button class="btn btn-sm ' + (cls || 'btn-o') + '" type="button" data-deck="' + esc(no) + '"><span>발표자료 보기</span></button>'
      : '';                                                         // ID 가 없으면 단추 없음
  }
  function paintWinners() {
    var sec = $('winners'), grid = $('win-grid');
    if (!sec || !grid || !D.winners || !D.winners.length) return;
    grid.innerHTML = D.winners.map(function (w) {
      var p = placeOf[w.no] || {}, v = w.video;
      return '<article class="win" data-no="' + esc(w.no) + '" aria-labelledby="win-' + esc(w.no) + '">' +
        '<div class="win-top">' + trackLab(w.track, trackName[w.track], ' · ' + (p.place || 1) + '등') + '<span class="no">' + esc(w.no) + '팀</span></div>' +
        '<h3 id="win-' + esc(w.no) + '">' + esc(w.name) + '</h3>' +
        '<p class="one">' + esc(w.line) + '</p>' +
        '<figure class="win-stage"><div class="frame">' +
          '<video controls playsinline preload="none" width="' + v.w + '" height="' + v.h + '" data-poster="' + esc(v.poster) + '" src="' + esc(v.src) + '" aria-label="' + esc(w.name) + ' 시연 영상"></video>' +
        '</div><figcaption>' + esc(v.caption) + '</figcaption></figure>' +
        '<div class="win-shots">' + w.shots.map(function (s) {
          return '<figure><button class="shot" type="button" data-img="' + esc(s.src) + '" data-cap="' + esc(s.caption) + '" data-team="' + esc(w.no) + '" aria-label="' + esc(s.alt) + ' 크게 보기">' +
            '<img src="' + esc(s.thumb || s.src) + '" width="' + s.w + '" height="' + s.h + '" loading="lazy" decoding="async" alt="' + esc(s.alt) + '"></button>' +
            '<figcaption>' + esc(s.caption) + '</figcaption></figure>';
        }).join('') + '</div>' +
        '<ul class="win-pts">' + w.points.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
        '<div class="win-links">' + w.links.map(function (l) {
          return '<a class="btn btn-sm btn-o" href="' + esc(l.href) + '" target="_blank" rel="noopener noreferrer"' + (l.note ? ' title="' + esc(l.note) + '"' : '') +
            ' aria-label="' + esc(w.name + ' ' + l.k) + ' (새 창)"><span>' + esc(l.k) + '</span>' + EXT + '</a>';
        }).join('') + deckBtn(w.no, 'btn-o') + '</div>' +
        (w.links.some(function (l) { return l.note; }) ? '<p class="win-note">' + w.links.filter(function (l) { return l.note; }).map(function (l) { return esc(l.k + ': ' + l.note); }).join(' · ') + '</p>' : '<p class="win-note" aria-hidden="true">&nbsp;</p>') +
      '</article>';
    }).join('');
    sec.hidden = false;
    // 포스터(첫 장면 그림)는 절이 가까워질 때 단다 — 첫 화면 로딩에 끼지 않게 (영상 자체는 누를 때만: preload="none")
    var vids = grid.querySelectorAll('video[data-poster]');
    function poster(x) { if (x.dataset.poster) { x.setAttribute('poster', x.dataset.poster); x.removeAttribute('data-poster'); } }
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { poster(e.target); io.unobserve(e.target); } });
      }, { rootMargin: '600px 0px' });
      vids.forEach(function (x) { io.observe(x); });
    } else vids.forEach(poster);
    // 한 번에 영상 하나만 — 하나를 틀면 다른 것은 멈춘다
    grid.addEventListener('play', function (e) {
      grid.querySelectorAll('video').forEach(function (x) { if (x !== e.target && !x.paused) x.pause(); });
    }, true);
  }

  /* ---------------- 수상팀 발표자료 ---------------- */
  function paintDecks() {
    var sec = $('decks'), grid = $('deck-grid');
    if (!sec || !grid || !D.decks) return;
    grid.innerHTML = D.tracks.map(function (tr) {
      var rows = [];
      tr.places.forEach(function (p) {
        p.teams.forEach(function (t) {
          rows.push('<li class="dk"><span class="pl">' + p.place + '등</span><span class="no">' + esc(t.no) + '팀</span>' +
            '<span class="ti">' + esc(t.title) + '</span>' + deckBtn(t.no, 'btn-o') + '</li>');
        });
      });
      return '<div class="dk-trk">' + trackLab(tr.key, tr.name) + '<ul>' + rows.join('') + '</ul></div>';
    }).join('');
    sec.hidden = false;
  }

  /* ---------------- 교수님 코멘트 — 20팀 모두, 팀 번호순 ----------------
     자료는 assets/comments-2026.js (window.EP2026_COMMENTS). 한 줄 = 팀 번호 + 프로젝트 이름 (수상팀만 등수). 기본은 모두 접힘,
     여러 팀을 함께 펼쳐 둘 수 있다. 수상팀 이름은 결과 칸과 같은 표기(results-2026.js), 나머지는 코멘트 자료의 이름 */
  function paintComments() {
    var C = window.EP2026_COMMENTS, sec = $('comments'), grid = $('cm-grid');
    if (!C || !C.tracks || !sec || !grid) return;
    grid.innerHTML = C.tracks.map(function (tr) {
      var rows = tr.teams.map(function (t) {
        var p = placeOf[t.no], id = 'cm-' + esc(t.no), items = [];
        (t.comments || []).forEach(function (c) { items = items.concat(c); });
        var txt = items.length > 1 ? '<ul>' + items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
          : '<p>' + esc(items[0] || '') + '</p>';
        return '<li class="cm" data-no="' + esc(t.no) + '">' +
          '<button class="cm-row" type="button" id="' + id + '-b" aria-expanded="false" aria-controls="' + id + '">' +
            '<span class="no">' + esc(t.no) + '팀</span>' +
            '<span class="ti">' + esc(p && p.title ? p.title : t.title) + (p ? '<span class="aw">' + p.place + '등</span>' : '') + '</span>' +
            '<span class="chev" aria-hidden="true"></span></button>' +
          '<div class="cm-body" id="' + id + '" role="region" aria-labelledby="' + id + '-b"><div class="cm-in"><div class="cm-txt">' + txt + '</div></div></div>' +
        '</li>';
      }).join('');
      return '<div class="cm-trk">' + trackLab(tr.key, trackName[tr.key] || tr.name) + '<ul class="cm-list">' + rows + '</ul></div>';
    }).join('');
    sec.hidden = false;
    var all = $('cm-all');
    function items() { return Array.prototype.slice.call(grid.querySelectorAll('.cm')); }
    function setOpen(li, on) {
      li.classList.toggle('open', on);
      li.querySelector('.cm-row').setAttribute('aria-expanded', String(on));
    }
    function sync() {
      var open = items().every(function (li) { return li.classList.contains('open'); });
      all.setAttribute('data-op', open ? 'close' : 'open');
      all.innerHTML = '<span>' + (open ? '모두 접기' : '모두 펼치기') + '</span>';
    }
    grid.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.cm-row') : null;
      if (!b) return;
      var li = b.parentNode;
      setOpen(li, !li.classList.contains('open'));
      sync();
    });
    if (all) all.addEventListener('click', function () {
      var on = all.getAttribute('data-op') !== 'close';
      items().forEach(function (li) { setOpen(li, on); });
      sync();
    });
    if (all) sync();
  }

  /* ---------------- 보기 창 ----------------
     열 때: 누른 단추 자리를 기준점으로 창이 0.9 배 · 투명에서 제자리로 커지고(0.45초), 바탕은 어두워지며 흐려진다.
     닫을 때: 같은 길을 거꾸로, 더 짧게(0.28초) — 닫기 단추 · Esc · 바탕 누르기 모두. 다 닫힌 뒤에 iframe 을 지우고 단추로 포커스를 돌린다.
     transform · opacity 만 움직이고 will-change 는 움직이는 동안만. 움직임 줄이기 설정이면 확대 없이 짧은 페이드만.
     상태: closed → opening → open → closing → closed. 열리는 중에 닫으면 그 자리에서 되돌아가고, 닫히는 중에는 창이 누르기를 통과시켜
     다른 단추를 바로 누를 수 있다 (그러면 남은 닫기를 바로 끝내고 새로 연다). */
  var EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
  var vw = { state: 'closed', back: null, anims: [], seq: 0 };
  function reduced() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function parts() { var v = $('viewer'); return { v: v, panel: v.querySelector('.viewer-panel'), scrim: v.querySelector('.viewer-scrim') }; }
  function move(el, frames, opts) {
    if (!el || !el.animate) return null;
    el.style.willChange = 'transform, opacity';
    var a = el.animate(frames, opts);
    vw.anims.push(a);
    return a;
  }
  function stopMoves() {
    vw.anims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
    vw.anims = [];
    var x = parts();
    [x.panel, x.scrim].forEach(function (el) { if (el) el.style.willChange = ''; });
  }
  function finishClose(restore) {
    var x = parts();
    x.v.hidden = true;                                             // 먼저 감추고 나서 움직임을 지운다 (제자리로 번쩍 돌아오지 않게)
    stopMoves();
    x.v.style.pointerEvents = '';
    if (x.panel) x.panel.style.transformOrigin = '';
    $('vw-body').innerHTML = '';                                  // iframe 을 지워 Drive 쪽 로딩도 멈춘다
    document.documentElement.style.overflow = '';
    vw.state = 'closed';
    if (restore && vw.back && vw.back.focus) try { vw.back.focus({ preventScroll: true }); } catch (e) {}
  }
  // after(body): 내용을 넣은 바로 뒤. ready(body): 다 열린 뒤 (Drive iframe 처럼 무거운 것은 여기서 — 움직이는 동안 끼어들지 않게)
  function openViewer(title, sub, html, newTab, from, after, ready) {
    var x = parts();
    if (vw.state === 'closing') finishClose(false);
    var swap = vw.state !== 'closed';                             // 이미 열려 있으면 내용만 바꾼다
    if (!swap) vw.back = from || document.activeElement;
    $('vw-title').textContent = title;
    $('vw-sub').textContent = sub;
    var o = $('vw-open');
    if (newTab) { o.href = newTab; o.hidden = false; } else { o.hidden = true; o.removeAttribute('href'); }
    $('vw-body').innerHTML = html;
    if (after) after($('vw-body'));
    var body = $('vw-body'), seq = ++vw.seq;
    function done() { if (ready && seq === vw.seq && vw.state !== 'closing' && vw.state !== 'closed') ready(body); }   // 그 사이 닫았거나 다른 것을 열었으면 안 붙인다
    if (swap) { done(); return; }
    document.querySelectorAll('#win-grid video').forEach(function (y) { if (!y.paused) y.pause(); });
    x.v.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    vw.state = 'opening';
    try { $('vw-close').focus({ preventScroll: true }); } catch (e) { $('vw-close').focus(); }
    var r = x.panel.getBoundingClientRect(), origin = '50% 50%';
    if (from && from.getBoundingClientRect) {
      var b = from.getBoundingClientRect();
      if (b.width) origin = Math.round(b.left + b.width / 2 - r.left) + 'px ' + Math.round(b.top + b.height / 2 - r.top) + 'px';
    }
    x.panel.style.transformOrigin = origin;
    var red = reduced();
    var a = move(x.panel, red ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: red ? 160 : 450, easing: red ? 'linear' : EASE });
    move(x.scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: red ? 160 : 400, easing: red ? 'linear' : EASE });
    if (!a) { vw.state = 'open'; done(); return; }
    a.onfinish = function () { if (vw.state === 'opening') { stopMoves(); vw.state = 'open'; done(); } };
  }
  function closeViewer() {
    var x = parts();
    if (!x.v || x.v.hidden || vw.state === 'closing' || vw.state === 'closed') return;
    var pc = getComputedStyle(x.panel), from = { opacity: pc.opacity, transform: pc.transform === 'none' ? 'scale(1)' : pc.transform },
      sFrom = getComputedStyle(x.scrim).opacity;                  // 열리는 중이면 지금 모습에서 되돌아간다
    stopMoves();
    vw.state = 'closing';
    x.v.style.pointerEvents = 'none';                             // 닫히는 동안 뒤의 단추를 바로 누를 수 있게
    var red = reduced(), opts = { duration: red ? 120 : 280, easing: red ? 'linear' : EASE, fill: 'forwards' };
    var a = move(x.panel, [from, { opacity: 0, transform: red ? from.transform : 'scale(0.9)' }], opts);
    move(x.scrim, [{ opacity: sFrom }, { opacity: 0 }], opts);
    if (!a) { finishClose(true); return; }
    a.onfinish = function () { if (vw.state === 'closing') finishClose(true); };
  }
  function reveal(el, l) {                                         // 다 불러오면 자리 표시를 걷고 내용을 보인다
    el.classList.add('in');
    if (l) { l.classList.add('out'); setTimeout(function () { if (l.parentNode) l.parentNode.removeChild(l); }, 300); }
  }
  function openDeck(no, from) {
    var id = (D.decks || {})[no], p = placeOf[no] || {};
    if (!id) return;
    var base = 'https://drive.google.com/file/d/' + encodeURIComponent(id);
    openViewer(no + '팀 · ' + (p.title || ''), (trackName[p.track] || '') + ' ' + (p.place ? p.place + '등' : '') + ' · 발표자료 (Google Drive)',
      '<div class="loading" role="status"><i aria-hidden="true"></i><span>발표자료를 불러오는 중입니다</span></div>',
      base + '/view', from, null, function (body) {
        var f = document.createElement('iframe'), l = body.querySelector('.loading');
        f.title = no + '팀 발표자료';
        f.setAttribute('allow', 'autoplay');
        f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        f.addEventListener('load', function () { reveal(f, l); });
        f.src = base + '/preview';
        body.appendChild(f);
      });
  }
  function openImg(src, cap, no, from) {
    var p = placeOf[no] || {};
    openViewer(no + '팀 · ' + (p.title || ''), cap, '<img src="' + esc(src) + '" alt="' + esc(cap) + '" decoding="async">', src, from, function (body) {
      var im = body.querySelector('img');
      if (!im) return;
      if (im.complete && im.naturalWidth) reveal(im);
      else { im.addEventListener('load', function () { reveal(im); }); im.addEventListener('error', function () { reveal(im); }); }
    });
  }

  function wire() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-deck],[data-img],#vw-close,.viewer-scrim') : null;
      if (!t) return;
      if (t.id === 'vw-close' || t.classList.contains('viewer-scrim')) { closeViewer(); return; }
      if (t.hasAttribute('data-deck')) openDeck(t.getAttribute('data-deck'), t);
      else openImg(t.getAttribute('data-img'), t.getAttribute('data-cap') || '', t.getAttribute('data-team') || '', t);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('viewer').hidden) closeViewer();
      if (e.key === 'Tab' && !$('viewer').hidden) {                // 창 안에서만 돈다
        var f = Array.prototype.filter.call($('viewer').querySelectorAll('a[href],button,iframe'), function (x) { return !x.hidden; });
        if (!f.length) return;
        var i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
  }

  function start() {
    paintResults();
    paintWinners();
    paintDecks();
    paintComments();
    if ($('viewer')) wire();
    // 주소에 #results · #winners · #decks · #comments 를 달고 들어왔으면 절이 채워진 뒤 거기로 (라우터는 절이 숨겨져 있을 때 지나갔다)
    var h = (location.hash || '').slice(1);
    if (/^(results|winners|decks|comments)$/.test(h) && $(h)) $(h).scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
