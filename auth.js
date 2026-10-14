(function () {
  var USERS = 'examflow-users', SESSION = 'examflow-session', mode = 'signup';

  function $(id) { return document.getElementById(id); }

  function getUsers() {
    try { return JSON.parse(localStorage.getItem(USERS)) || {}; } catch (e) { return {}; }
  }

  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }

  // Salted PBKDF2 hash, so the real password is never stored
  function hashPw(pw, saltHex) {
    var salt = new Uint8Array(saltHex.match(/../g).map(function (h) { return parseInt(h, 16); }));
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
      .then(function (key) {
        return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
      })
      .then(hex);
  }

  function enter(email, first) {
    try { localStorage.setItem(SESSION, email); } catch (e) {}
    var u = getUsers()[email];
    var display = (u && u.name) || email;
    $('userName').textContent = display;
    $('welcome-message').textContent = 'Welcome, ' + display + '!';
    $('authScreen').hidden = true;
    $('appShell').hidden = false;
    window.startApp(email, first);
  }

  function setMode(m) {
    mode = m;
    var signup = m === 'signup';
    $('auTitle').textContent = signup ? 'Create your account' : 'Log in';
    $('auSubmit').textContent = signup ? 'Sign up' : 'Log in';
    $('auNameRow').hidden = !signup;
    $('auSwitchText').textContent = signup ? 'Already have an account?' : 'New here?';
    $('auSwitch').textContent = signup ? 'Log in' : 'Sign up';
    $('auPass').autocomplete = signup ? 'new-password' : 'current-password';
    $('auErr').textContent = '';
  }

  $('auSwitch').onclick = function () { setMode(mode === 'signup' ? 'login' : 'signup'); };

  $('authForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('auName').value.trim();
    var email = $('auEmail').value.trim().toLowerCase();
    var pw = $('auPass').value;
    var err = $('auErr');
    err.textContent = '';

    if (!window.crypto || !crypto.subtle) {
      err.textContent = 'Open this page with Live Server (localhost) or https so passwords can be protected.';
      return;
    }

    var users = getUsers();

    if (mode === 'signup') {
      if (pw.length < 6) { err.textContent = 'Use at least 6 characters in your password.'; return; }
      if (users[email]) { err.textContent = 'This email already has an account. Log in instead.'; return; }
      var salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      hashPw(pw, salt).then(function (h) {
        var first = Object.keys(users).length === 0;
        users[email] = { name: name || email.split('@')[0], salt: salt, hash: h };
        try { localStorage.setItem(USERS, JSON.stringify(users)); } catch (x) {
          err.textContent = 'Could not save your account. Check that browser storage is allowed.';
          return;
        }
        enter(email, first);
      });
    } else {
      var u = users[email];
      if (!u) { err.textContent = 'No account found for this email. Sign up first.'; return; }
      hashPw(pw, u.salt).then(function (h) {
        if (h !== u.hash) { err.textContent = 'Wrong password. Try again.'; return; }
        enter(email, false);
      });
    }
  });

  $('logoutBtn').onclick = function () {
    try { localStorage.removeItem(SESSION); } catch (e) {}
    location.reload();
  };

  // Stay logged in on this browser
  var s = null;
  try { s = localStorage.getItem(SESSION); } catch (e) {}
  if (s && getUsers()[s]) enter(s, false);
  else setMode('signup');
})();