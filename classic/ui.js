// Page UI that works with or without WebGL: nav dots, progress, reveal, counters, loader fallback.
(function () {
  var sections = Array.prototype.slice.call(document.querySelectorAll('.section'));
  var dotsNav = document.querySelector('.dots');
  var bar = document.querySelector('.progress i');
  var params = new URLSearchParams(location.search);
  var shot = params.has('shot') ? Math.max(0, Math.min(sections.length - 1, Number(params.get('shot')) || 0)) : null;

  if (shot !== null) document.body.classList.add('shot');

  // nav dots
  var dots = sections.map(function (s) {
    var a = document.createElement('a');
    a.href = '#' + s.id;
    a.setAttribute('data-label', s.getAttribute('data-label'));
    a.setAttribute('aria-label', s.getAttribute('data-label'));
    dotsNav.appendChild(a);
    return a;
  });

  function onScroll() {
    var max = document.documentElement.scrollHeight - innerHeight;
    bar.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + '%';
    var mid = scrollY + innerHeight * 0.5, active = 0;
    sections.forEach(function (s, i) { if (s.offsetTop <= mid) active = i; });
    dots.forEach(function (d, i) { d.classList.toggle('active', i === active); });
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();

  // counters
  function runCounter(el) {
    var target = Number(el.getAttribute('data-count'));
    var pre = el.getAttribute('data-prefix') || '', suf = el.getAttribute('data-suffix') || '';
    if (shot !== null || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = pre + target + suf; return; }
    var t0 = performance.now(), dur = 1600;
    (function step(now) {
      var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = pre + Math.round(target * e) + suf;
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  // reveal on scroll
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      en.target.querySelectorAll('[data-count]').forEach(runCounter);
      io.unobserve(en.target);
    });
  }, { threshold: 0.2 });
  function startReveal() { document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); }); }

  // loader: main.js calls window.__hideLoader when the scene is ready.
  // If the 3D scene never starts (no WebGL, CDN blocked), fall back to the plain page.
  var loader = document.getElementById('loader');
  var started = performance.now();
  window.__hideLoader = function () {
    var wait = shot !== null ? 0 : Math.max(0, 1900 - (performance.now() - started));
    setTimeout(function () { loader.classList.add('done'); startReveal(); }, wait);
  };
  setTimeout(function () {
    if (!window.__sceneReady) { document.body.classList.add('no-webgl'); window.__hideLoader(); }
  }, 8000);

  if (shot !== null) {
    addEventListener('load', function () { scrollTo(0, sections[shot].offsetTop); onScroll(); });
  }
})();
