// Cursor, magnetic buttons and the no-WebGL switch. Independent of Three.js.
(function () {
  var fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // If the particle module never loaded (CDN blocked), show the plain page.
  // A module that loads but fails adds the class itself; a slow start is left alone.
  setTimeout(function () {
    if (!window.__fieldLoading) document.body.classList.add('no-webgl');
  }, 8000);

  // ?shot=N jumps straight to section N (used for previews)
  var shot = new URLSearchParams(location.search).get('shot');
  if (shot !== null) {
    addEventListener('load', function () {
      var p = document.querySelectorAll('.panel')[Number(shot) || 0];
      if (p) { document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, p.offsetTop); }
    });
  }

  if (!fine) return;

  var cursor = document.querySelector('.cursor');
  var x = innerWidth / 2, y = innerHeight / 2, cx = x, cy = y;
  addEventListener('pointermove', function (e) { x = e.clientX; y = e.clientY; }, { passive: true });
  document.addEventListener('pointerover', function (e) {
    cursor.classList.toggle('on-link', !!e.target.closest('a, button'));
  });
  (function loop() {
    cx += (x - cx) * (reduced ? 1 : 0.2);
    cy += (y - cy) * (reduced ? 1 : 0.2);
    cursor.style.transform = 'translate(' + cx + 'px,' + cy + 'px)';
    requestAnimationFrame(loop);
  })();

  if (reduced) return;
  document.querySelectorAll('.magnetic').forEach(function (el) {
    el.addEventListener('pointermove', function (e) {
      var r = el.getBoundingClientRect();
      var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      el.style.transform = 'translate(' + dx * 0.22 + 'px,' + dy * 0.3 + 'px)';
    });
    el.addEventListener('pointerleave', function () {
      el.style.transition = 'transform 0.5s cubic-bezier(.2,.8,.2,1)';
      el.style.transform = '';
      setTimeout(function () { el.style.transition = ''; }, 500);
    });
  });
})();
