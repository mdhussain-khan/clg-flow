(function () {
  var intro = document.getElementById('intro');
  var cord = document.getElementById('cord');
  var shell = document.getElementById('appShell');
  var NEED = 60, MAX = 90, startY = 0, dy = 0, drag = false, pulled = false;

  function loggedIn() {
    try {
      var s = localStorage.getItem('examflow-session');
      var u = JSON.parse(localStorage.getItem('examflow-users')) || {};
      return !!(s && u[s]);
    } catch (e) { return false; }
  }

  function setPull(v) { intro.style.setProperty('--pull', v); }

  cord.addEventListener('pointerdown', function (e) {
    if (pulled) return;
    drag = true; startY = e.clientY; dy = 0;
    intro.classList.add('drag');
    cord.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  cord.addEventListener('pointermove', function (e) {
    if (!drag) return;
    dy = Math.max(0, Math.min(MAX, e.clientY - startY));
    setPull(dy);
  });

  function release() {
    if (!drag) return;
    drag = false;
    intro.classList.remove('drag');
    setPull(0);
    if (dy >= NEED) openPage();   // a plain tap has dy = 0, so it does nothing
    dy = 0;
  }
  cord.addEventListener('pointerup', release);
  cord.addEventListener('pointercancel', release);

  function openPage() {
    pulled = true;
    intro.classList.add('lit');
    setTimeout(function () {
      document.body.classList.remove('locked');
      if (loggedIn()) {
        intro.classList.add('gone');          // go straight to the dashboard
      } else {
        intro.classList.add('split');         // table slides left, form shows on the right
        document.body.classList.add('split');
      }
    }, 500);
  }

  // After a successful sign up / log in, remove the table scene
  new MutationObserver(function () {
    if (pulled && !shell.hidden) intro.classList.add('gone');
  }).observe(shell, { attributes: true, attributeFilter: ['hidden'] });
})();