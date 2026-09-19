/* ENDPoinT — 정책 문서 공통 스크립트
   없어도 문서는 그대로 읽힌다. 스크롤 진행 표시와 목차 강조만 더한다. */
(function () {
  var bar = document.getElementById('top-bar');
  var prog = document.getElementById('progress');
  var ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY || 0;
      if (bar) bar.classList.toggle('scrolled', y > 8);
      var max = document.documentElement.scrollHeight - window.innerHeight;
      if (prog) prog.style.transform = 'scaleX(' + (max > 0 ? Math.min(y / max, 1) : 0) + ')';
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
