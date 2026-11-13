/* ==============================================================
   ENDPoinT — 화면 테마 (어두운 화면 · 밝은 화면)
   --------------------------------------------------------------
   기본은 어두운 화면. 머리 메뉴 끝의 해 · 달 단추로 바꾸고, 고른 것은 이 브라우저에 기억한다
   (localStorage 'ep-theme' = 'light' | 'dark'). 밝은 화면이면 <html data-theme="light">.
   첫 화면이 깜빡이지 않게 맞추는 일은 각 페이지 <head> 의 한 줄 스크립트가 먼저 한다 —
   여기서는 단추를 달고, 누르면 바꾸고, 'ep-theme' 이벤트로 알린다 (머리 색을 스크롤에 맞추는 스크립트가 듣는다).
   ============================================================== */
(function () {
  'use strict';
  var KEY = 'ep-theme', root = document.documentElement;
  var EN = /^en/i.test(root.getAttribute('lang') || '');
  var SUN = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">' +
    '<circle cx="8" cy="8" r="3"/><path d="M8 1.4v1.7M8 12.9v1.7M1.4 8h1.7M12.9 8h1.7M3.3 3.3l1.2 1.2M11.5 11.5l1.2 1.2M3.3 12.7l1.2-1.2M11.5 4.5l1.2-1.2"/></svg>';
  var MOON = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">' +
    '<path d="M13.4 9.7A5.7 5.7 0 0 1 6.3 2.6a5.7 5.7 0 1 0 7.1 7.1z"/></svg>';

  function cur() { return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  function label(t) {
    return t === 'light' ? (EN ? 'Switch to dark mode' : '어두운 화면으로') : (EN ? 'Switch to light mode' : '밝은 화면으로');
  }
  /** 휴대폰 브라우저 윗줄 색 */
  function meta(t) {
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'light' ? '#F7F7F6' : '#191919');
  }
  /** 단추에는 바꿀 쪽을 그린다: 어두운 화면이면 해, 밝은 화면이면 달 */
  function paint(b) {
    var t = cur();
    b.innerHTML = t === 'light' ? MOON : SUN;
    b.setAttribute('aria-label', label(t));
    b.title = label(t);
  }
  function set(t) {
    if (t === 'light') root.setAttribute('data-theme', 'light'); else root.removeAttribute('data-theme');
    try { localStorage.setItem(KEY, t); } catch (e) {}
    meta(t);
    Array.prototype.forEach.call(document.querySelectorAll('.theme-tg'), paint);
    try { window.dispatchEvent(new CustomEvent('ep-theme', { detail: t })); } catch (e2) {}
  }
  function mount() {
    var nav = document.querySelector('header.top nav, #top-bar nav');
    if (!nav || nav.querySelector('.theme-tg')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-tg';
    paint(b);
    b.addEventListener('click', function () { set(cur() === 'light' ? 'dark' : 'light'); });
    var lang = nav.querySelector('a.lang');                   // 메인 · 정책 문서: EN/KO 바로 옆
    if (lang && lang.nextSibling) nav.insertBefore(b, lang.nextSibling); else nav.appendChild(b);
  }

  meta(cur());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  // 다른 탭에서 바꾸면 이 탭도 따라간다
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    var t = e.newValue === 'light' ? 'light' : 'dark';
    if (t !== cur()) set(t);
  });
  window.EPTHEME = { get: cur, set: set };
})();
