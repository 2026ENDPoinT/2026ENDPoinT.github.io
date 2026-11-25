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

  /* ---------------- 보기 창 ---------------- */
  var back = null;
  function openViewer(title, sub, html, newTab) {
    var v = $('viewer');
    back = document.activeElement;
    $('vw-title').textContent = title;
    $('vw-sub').textContent = sub;
    var o = $('vw-open');
    if (newTab) { o.href = newTab; o.hidden = false; } else { o.hidden = true; o.removeAttribute('href'); }
    $('vw-body').innerHTML = html;
    document.querySelectorAll('#win-grid video').forEach(function (x) { if (!x.paused) x.pause(); });
    v.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    $('vw-close').focus();
  }
  function closeViewer() {
    var v = $('viewer');
    if (!v || v.hidden) return;
    v.hidden = true;
    $('vw-body').innerHTML = '';                                  // iframe 을 지워 Drive 쪽 로딩도 멈춘다
    document.documentElement.style.overflow = '';
    if (back && back.focus) try { back.focus(); } catch (e) {}
  }
  function openDeck(no) {
    var id = (D.decks || {})[no], p = placeOf[no] || {};
    if (!id) return;
    var base = 'https://drive.google.com/file/d/' + encodeURIComponent(id);
    openViewer(no + '팀 · ' + (p.title || ''), (trackName[p.track] || '') + ' ' + (p.place ? p.place + '등' : '') + ' · 발표자료 (Google Drive)',
      '<div class="loading" role="status"><span>발표자료를 불러오는 중입니다</span></div>' +
      '<iframe src="' + base + '/preview" title="' + esc(no + '팀 발표자료') + '" allow="autoplay" referrerpolicy="strict-origin-when-cross-origin"></iframe>',
      base + '/view');
    var f = $('vw-body').querySelector('iframe'), l = $('vw-body').querySelector('.loading');
    if (f && l) f.addEventListener('load', function () { l.remove(); });
  }
  function openImg(src, cap, no) {
    var p = placeOf[no] || {};
    openViewer(no + '팀 · ' + (p.title || ''), cap, '<img src="' + esc(src) + '" alt="' + esc(cap) + '">', src);
  }

  function wire() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-deck],[data-img],#vw-close') : null;
      if (!t) return;
      if (t.id === 'vw-close') { closeViewer(); return; }
      if (t.hasAttribute('data-deck')) openDeck(t.getAttribute('data-deck'));
      else openImg(t.getAttribute('data-img'), t.getAttribute('data-cap') || '', t.getAttribute('data-team') || '');
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
    if ($('viewer')) wire();
    // 주소에 #results · #winners · #decks 를 달고 들어왔으면 절이 채워진 뒤 거기로 (라우터는 절이 숨겨져 있을 때 지나갔다)
    var h = (location.hash || '').slice(1);
    if (/^(results|winners|decks)$/.test(h) && $(h)) $(h).scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
