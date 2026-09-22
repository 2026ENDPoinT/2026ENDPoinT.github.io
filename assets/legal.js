/* ENDPoinT — 정책 문서 공통 스크립트
   없어도 문서는 그대로 읽힌다. 스크롤 진행 표시와 목차 강조만 더한다. */
(function () {
  // 한글이 들어간 라벨에는 .ko — 영문 대문자용 넓은 자간이 한글에선 흩어져 보인다
  var HAN = /[\u3131-\u318E\uAC00-\uD7A3]/;
  Array.prototype.forEach.call(document.querySelectorAll('.lab'), function (el) {
    if (HAN.test(el.textContent)) el.classList.add('ko');
  });

  var bar = document.getElementById('top-bar');
  var prog = document.getElementById('progress');
  var ticking = false;
  // 헤더 색을 배경 그라데이션의 현재 밝기에 맞춘다 (23 -> 36)
  var root = document.documentElement;
  var lastTint = -1;
  function tintHeader(t) {
    var v = Math.round(23 + (36 - 23) * t);
    if (v === lastTint) return;
    lastTint = v;
    root.style.setProperty('--hdr-rgb', v + ',' + v + ',' + v);
  }


  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY || 0;
      if (bar) bar.classList.toggle('scrolled', y > 8);
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var t = max > 0 ? Math.min(y / max, 1) : 0;
      if (prog) prog.style.transform = 'scaleX(' + t + ')';
      tintHeader(t);
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // 지금 읽고 있는 조항을 목차에 표시
  var links = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'));
  if (!links.length || !('IntersectionObserver' in window)) return;

  var byId = {};
  links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      links.forEach(function (a) { a.classList.remove('on'); });
      var a = byId[e.target.id];
      if (a) a.classList.add('on');
    });
  }, { rootMargin: '-18% 0px -72% 0px' });

  Object.keys(byId).forEach(function (id) {
    var el = document.getElementById(id);
    if (el) io.observe(el);
  });
})();
