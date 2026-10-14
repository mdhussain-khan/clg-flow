(function () {
  var KEY = '', DAY = 864e5;

  // Optional: URL of your own backend that calls an AI model.
  // Leave empty to use the built-in library suggestions only.
  // Topics request:  { kind:'topics', subject, unit, have:[...] }  -> { topics:[...] }
  // Units request:   { kind:'units',  subject }                    -> { units:[{ unit, topics:[...] }] }
  var AI_ENDPOINT = '';

  var STOP = ['module', 'unit', 'chapter', 'part', 'topic', 'topics', 'with', 'and', 'their', 'using'];

  function iso(off) {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + off);
    return d.toISOString().slice(0, 10);
  }

  // New accounts start empty: the student adds their own subjects
  function seed() {
    return { subjects: [], tasks: [], syl: {}, feedback: [], sessions: 0, nid: 10 };
  }

  var S = seed();
  var openU = {};     // which units are expanded
  var sugCache = {};  // topic suggestions waiting to be added

  function save() {
    if (!KEY) return;
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  }

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function daysLeft(s) {
    var d = new Date(s + 'T00:00:00'), t = new Date();
    t.setHours(0, 0, 0, 0);
    return Math.round((d - t) / DAY);
  }

  function sub(id) {
    return S.subjects.filter(function (x) { return x.id == id; })[0];
  }

  function pending(id) {
    return S.tasks.filter(function (t) { return t.sub == id && !t.done; }).length;
  }

  function units(sid) {
    return S.syl[sid] || (S.syl[sid] = []);
  }

  // "sid-ui-ti" -> parts
  function P(k) {
    var a = k.split('-');
    return { sid: a[0], ui: +a[1], ti: +a[2] };
  }

  // ---------- Library and suggestions ----------
  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  function libFor(name) {
    var n = norm(name);
    if (n.length < 5 || typeof LIBRARY === 'undefined') return null;
    for (var k in LIBRARY) {
      var kn = norm(k);
      if (kn === n || kn.indexOf(n) > -1 || n.indexOf(kn) > -1) return LIBRARY[k];
    }
    return null;
  }

  function cloneLib(list) {
    return list.map(function (u) {
      return { unit: u.unit, topics: u.topics.map(function (t) { return { t: t, d: false }; }) };
    });
  }

  function words(s) {
    return String(s).toLowerCase().split(/[^a-z0-9]+/).filter(function (w) {
      return w.length > 3 && STOP.indexOf(w) < 0;
    });
  }

  function offlineTopics(subName, unitName, have) {
    var lowHave = have.map(function (h) { return h.toLowerCase(); });
    function fresh(t) { return lowHave.indexOf(t.toLowerCase()) < 0; }
    var uw = words(unitName), lib = libFor(subName), best = null, bs = 0;
    if (lib) {
      lib.forEach(function (u) {
        var ow = words(u.unit), sc = 0;
        uw.forEach(function (w) { if (ow.indexOf(w) > -1) sc++; });
        if (sc > bs) { bs = sc; best = u; }
      });
      if (best) return best.topics.filter(fresh).slice(0, 10);
    }
    var out = [];
    if (uw.length && typeof LIBRARY !== 'undefined') {
      for (var k in LIBRARY) {
        LIBRARY[k].forEach(function (u) {
          u.topics.forEach(function (t) {
            var tw = words(t + ' ' + u.unit);
            var hit = uw.some(function (w) { return tw.indexOf(w) > -1; });
            if (hit && fresh(t) && out.indexOf(t) < 0) out.push(t);
          });
        });
      }
    }
    return out.slice(0, 10);
  }

  function askAI(payload) {
    return fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  function getTopics(subName, unitName, have) {
    if (!AI_ENDPOINT) return Promise.resolve(offlineTopics(subName, unitName, have));
    var low = have.map(function (h) { return h.toLowerCase(); });
    return askAI({ kind: 'topics', subject: subName, unit: unitName, have: have })
      .then(function (j) {
        return (j.topics || []).filter(function (t) {
          return typeof t === 'string' && t.trim() && low.indexOf(t.trim().toLowerCase()) < 0;
        }).slice(0, 12);
      })
      .catch(function () { return offlineTopics(subName, unitName, have); });
  }

  function getUnits(subName) {
    var lib = libFor(subName);
    function offline() { return lib ? cloneLib(lib) : []; }
    if (!AI_ENDPOINT) return Promise.resolve(offline());
    return askAI({ kind: 'units', subject: subName })
      .then(function (j) {
        return (j.units || []).filter(function (u) { return u && u.unit; }).map(function (u) {
          return {
            unit: String(u.unit),
            topics: (u.topics || []).map(function (t) { return { t: String(t), d: false }; })
          };
        });
      })
      .catch(offline);
  }

  // ---------- Old data conversion ----------
  function migrate() {
    if (S.syl) return;
    S.syl = {};
    S.subjects.forEach(function (s) {
      var lib = libFor(s.name) || [];
      S.syl[s.id] = lib.map(function (u, ui) {
        return {
          unit: u.unit,
          topics: u.topics.map(function (t, ti) {
            return { t: t, d: !!(S.topics && S.topics[s.id + '-' + ui + '-' + ti]) };
          })
        };
      });
    });
    delete S.topics;
  }

  // ---------- Syllabus card ----------
  function renderSyllabus() {
    var sel = $('synSub'), cur = sel.value, has = S.subjects.length > 0;

    $('libNames').innerHTML = (typeof LIBRARY === 'undefined' ? [] : Object.keys(LIBRARY)).map(function (k) {
      return '<option value="' + esc(k) + '">';
    }).join('');

    sel.innerHTML = S.subjects.map(function (s) {
      return '<option value="' + s.id + '">' + esc(s.name) + '</option>';
    }).join('');
    if (cur && sub(cur)) sel.value = cur;
    $('sylTools').hidden = !has;

    if (!has) {
      $('synList').innerHTML = '<div class="empty">No subjects yet. Add your first subject above.</div>';
      return;
    }

    var sid = sel.value, list = units(sid);
    if (!list.length) {
      $('synList').innerHTML = '<div class="empty">No units yet. Add a unit above, or tap Suggest units.</div>';
      return;
    }

    $('synList').innerHTML = list.map(function (u, ui) {
      var uk = sid + '-' + ui;
      var n = u.topics.filter(function (t) { return t.d; }).length;
      var pct = u.topics.length ? Math.round(n / u.topics.length * 100) : 0;

      var sg = sugCache[uk], chips = '';
      if (sg && sg.state === 'loading') chips = '<div class="empty">Finding topics...</div>';
      else if (sg && sg.msg) chips = '<div class="empty">' + esc(sg.msg) + '</div>';
      else if (sg && sg.list && sg.list.length) {
        chips = '<div class="chips">' + sg.list.map(function (t, i) {
          return '<button type="button" class="chip" data-chip="' + uk + '-' + i + '">+ ' + esc(t) + '</button>';
        }).join('') + '<button type="button" class="link" data-chipall="' + uk + '">Add all</button></div>';
      }

      return '<details data-u="' + uk + '"' + (openU[uk] ? ' open' : '') + '>' +
        '<summary><span>' + esc(u.unit) + '</span><b>' + n + '/' + u.topics.length + '</b></summary>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        (u.topics.length ? '' : '<div class="empty">No topics yet. Add one below or tap Suggest topics.</div>') +
        u.topics.map(function (t, ti) {
          var k = uk + '-' + ti;
          return '<div class="topic-row"><label class="topic"><input type="checkbox" data-topic="' + k + '"' +
            (t.d ? ' checked' : '') + '><span>' + esc(t.t) + '</span></label>' +
            '<button class="x" data-dtopic="' + k + '" aria-label="Delete topic">&times;</button></div>';
        }).join('') +
        '<form class="add mini" data-addtopic="' + uk + '">' +
        '<input type="text" placeholder="Add a topic" aria-label="New topic" maxlength="120">' +
        '<button class="btn sm" type="submit">Add</button>' +
        '<button class="btn ghost sm" type="button" data-aitopics="' + uk + '">Suggest topics</button></form>' +
        chips +
        '<div class="unit-foot"><button class="btn ghost sm" type="button" data-dunit="' + uk + '">Delete unit</button></div>' +
        '</details>';
    }).join('');
  }

  function renderFeedback() {
    var el = $('fbList');
    el.innerHTML = S.feedback.length
      ? '<h4>Your previous messages</h4>' + S.feedback.slice(0, 5).map(function (f) {
          return '<div class="fb-item"><b>' + esc(f.type) + '</b><span>' + esc(f.date) + '</span><p>' + esc(f.text) + '</p></div>';
        }).join('')
      : '';
  }

  // ---------- What to study next (popup) ----------
  function ranked() {
    return S.subjects.filter(function (s) { return daysLeft(s.exam) >= 0; }).map(function (s) {
      var d = daysLeft(s.exam);
      return { s: s, score: (100 - s.prep) / (1 + d / 7) + pending(s.id) * 4 };
    }).sort(function (a, b) { return b.score - a.score; });
  }

  function nextTopics(sid, max) {
    var out = [];
    units(sid).forEach(function (u, ui) {
      u.topics.forEach(function (t, ti) {
        if (!t.d && out.length < max) out.push({ k: sid + '-' + ui + '-' + ti, t: t.t, u: u.unit });
      });
    });
    return out;
  }

  function topicAt(k) {
    var p = P(k);
    return units(p.sid)[p.ui].topics[p.ti];
  }

  function renderSuggest() {
    var r = ranked(), el = $('sugBody');
    if (!r.length) {
      el.innerHTML = '<p class="empty">No upcoming exams. Add a subject with an exam date to get suggestions.</p>';
      return;
    }
    var pick = r[0], picks = [];
    for (var i = 0; i < r.length; i++) {
      var tp = nextTopics(r[i].s.id, 5);
      if (tp.length) { pick = r[i]; picks = tp; break; }
    }
    var s = pick.s, d = daysLeft(s.exam);
    var html = '<p>Start with <b>' + esc(s.name) + '</b>. Exam ' +
      (d === 0 ? 'is today' : d === 1 ? 'is tomorrow' : 'in ' + d + ' days') +
      ', preparation at ' + s.prep + '%.</p>';
    html += picks.length ? picks.map(function (x) {
      return '<div class="sug-item"><div class="grow"><b>' + esc(x.t) + '</b><span>' + esc(x.u) + '</span></div>' +
        '<div class="sug-actions"><button class="btn sm" data-sdone="' + x.k + '">Done</button>' +
        '<button class="btn sm ghost" data-stask="' + x.k + '">Add as task</button></div></div>';
    }).join('') : '<p class="empty">No topics to suggest. Add units and topics to this subject, or use the time to revise.</p>';
    var others = r.filter(function (x) { return x.s.id !== s.id; }).slice(0, 2);
    if (others.length) html += '<p class="sug-next">After that: ' + others.map(function (x) { return esc(x.s.name); }).join(', ') + '</p>';
    if (AI_ENDPOINT) html += '<button class="btn ghost" id="aiBtn">Ask AI for a study plan</button><div class="empty" id="aiOut"></div>';
    el.innerHTML = html;
    el._ctx = { subject: s.name, daysLeft: d, prep: s.prep, topics: picks.map(function (x) { return x.t; }) };
  }

  function openSuggest() {
    renderSuggest();
    var dlg = $('sugDlg');
    if (dlg.showModal && !dlg.open) dlg.showModal();
  }

  // ---------- Draw the dashboard ----------
  function render() {
    $('today').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

    var upcoming = S.subjects.filter(function (s) { return daysLeft(s.exam) >= 0; });
    var best = null, bs = -1;
    upcoming.forEach(function (s) {
      var d = daysLeft(s.exam);
      var sc = (100 - s.prep) / (1 + d / 7) + pending(s.id) * 4;
      if (sc > bs) { bs = sc; best = s; }
    });

    var f = $('focus');
    if (!S.subjects.length) {
      f.innerHTML = '<small>Welcome to College Flow</small><h3>Add your first subject</h3><p>Start with your subjects and exam dates, then add units and topics. <a href="#syllabus">Go to My subjects</a></p>';
    } else if (best) {
      var d = daysLeft(best.exam), p = pending(best.id);
      f.innerHTML = '<small>Focus on this next</small><h3>' + esc(best.name) + '</h3><p>Exam ' +
        (d === 0 ? 'is today' : d === 1 ? 'is tomorrow' : 'in ' + d + ' days') +
        ', preparation at ' + best.prep + '%, ' + p + ' pending task' + (p === 1 ? '' : 's') +
        '. It has the biggest gap between time left and work remaining.</p>';
    } else {
      f.innerHTML = '<small>Focus on this next</small><h3>No upcoming exams</h3><p>Set an exam date to get a recommendation.</p>';
    }

    var done = S.tasks.filter(function (t) { return t.done; }).length, tot = S.tasks.length;
    var avg = S.subjects.length ? Math.round(S.subjects.reduce(function (a, s) { return a + s.prep; }, 0) / S.subjects.length) : 0;
    var at = S.subjects.reduce(function (a, s) { return a + s.att; }, 0);
    var tt = S.subjects.reduce(function (a, s) { return a + s.tot; }, 0);
    var nxt = upcoming.slice().sort(function (a, b) { return daysLeft(a.exam) - daysLeft(b.exam); })[0];

    $('stats').innerHTML = [
      [nxt ? daysLeft(nxt.exam) + ' days' : 'None', 'Until next exam'],
      [tot - done, 'Pending tasks'],
      [tot ? Math.round(done / tot * 100) + '%' : '0%', 'Tasks completed'],
      [avg + '%', 'Overall preparation'],
      [(tt ? Math.round(at / tt * 100) : 0) + '%', 'Overall attendance']
    ].map(function (x) {
      return '<div class="stat"><b>' + x[0] + '</b><span>' + x[1] + '</span></div>';
    }).join('');

    $('examList').innerHTML = S.subjects.length ? S.subjects.slice().sort(function (a, b) { return a.exam < b.exam ? -1 : 1; }).map(function (s) {
      var d = daysLeft(s.exam);
      return '<div class="exam"><div class="days ' + (d < 0 ? 'past' : d <= 7 ? 'soon' : '') + '"><b>' +
        (d < 0 ? '—' : d) + '</b><small>' + (d < 0 ? 'done' : d === 1 ? 'day' : 'days') +
        '</small></div><div class="grow"><b>' + esc(s.name) + '</b><span>Prep ' + s.prep +
        '%</span></div><input type="date" value="' + s.exam + '" data-exam="' + s.id +
        '" aria-label="Exam date for ' + esc(s.name) + '"></div>';
    }).join('') : '<div class="empty">Your exams will appear here once you add a subject.</div>';

    var cur = $('taskSub').value;
    $('taskSub').innerHTML = S.subjects.length ? S.subjects.map(function (s) {
      return '<option value="' + s.id + '">' + esc(s.name) + '</option>';
    }).join('') : '<option value="">Add a subject first</option>';
    if (cur && sub(cur)) $('taskSub').value = cur;

    $('taskList').innerHTML = S.tasks.length ? S.tasks.map(function (t) {
      var s = sub(t.sub);
      return '<div class="task' + (t.done ? ' done' : '') + '"><input type="checkbox" data-done="' + t.id + '"' +
        (t.done ? ' checked' : '') + ' aria-label="Mark done"><div class="t">' + esc(t.text) +
        '<br><em>' + esc(s ? s.name : 'General') + '</em></div><button class="x" data-del="' + t.id +
        '" aria-label="Delete task">&times;</button></div>';
    }).join('') : '<div class="empty">No tasks yet. Add your first study task above.</div>';

    $('prepList').innerHTML = S.subjects.length ? S.subjects.map(function (s) {
      return '<div class="sub"><div class="row"><span>' + esc(s.name) + '</span><b>' + s.prep +
        '%</b></div><div class="bar"><i style="width:' + s.prep + '%"></i></div>' +
        '<input type="range" min="0" max="100" step="5" value="' + s.prep + '" data-prep="' + s.id +
        '" aria-label="Preparation for ' + esc(s.name) + '"></div>';
    }).join('') : '<div class="empty">Add a subject to track your preparation.</div>';

    $('attList').innerHTML = S.subjects.length ? S.subjects.map(function (s) {
      var p = s.tot ? Math.round(s.att / s.tot * 100) : 0, low = s.tot > 0 && p < 75;
      return '<div class="att"><div class="grow"><b>' + esc(s.name) + '</b><span>' + s.att + ' of ' + s.tot +
        ' classes</span>' +
        (low ? '<div class="warn">Below 75%. Attend the next ' + Math.max(0, Math.ceil((0.75 * s.tot - s.att) / 0.25)) + ' classes to recover.</div>' : '') +
        '</div><span class="pct ' + (low ? 'low' : 'ok') + '">' + p + '%</span>' +
        '<button class="btn sm" data-att="' + s.id + ':1">Present</button>' +
        '<button class="btn sm ghost" data-att="' + s.id + ':0">Absent</button></div>';
    }).join('') : '<div class="empty">Add a subject to record attendance.</div>';

    $('sessions').textContent = S.sessions
      ? S.sessions + ' focus session' + (S.sessions === 1 ? '' : 's') + ' completed'
      : 'Complete a session to start your count.';

    renderSyllabus();
    renderFeedback();
  }

  // ---------- Clicks ----------
  document.addEventListener('click', function (e) {
    var t = e.target, v;
    if (!t.getAttribute) return;

    if (v = t.getAttribute('data-del')) {
      S.tasks = S.tasks.filter(function (x) { return x.id != v; });
      save(); render();
    }
    if (v = t.getAttribute('data-att')) {
      var ap = v.split(':'), as = sub(ap[0]);
      as.tot++;
      if (ap[1] === '1') as.att++;
      save(); render();
    }

    // Syllabus editing
    if (v = t.getAttribute('data-dtopic')) {
      var dp = P(v);
      units(dp.sid)[dp.ui].topics.splice(dp.ti, 1);
      openU[dp.sid + '-' + dp.ui] = 1;
      save(); render();
    }
    if (v = t.getAttribute('data-dunit')) {
      var up = v.split('-');
      if (confirm('Delete this unit and all its topics?')) {
        units(up[0]).splice(+up[1], 1);
        openU = {}; sugCache = {};
        save(); render();
      }
    }
    if (v = t.getAttribute('data-aitopics')) {
      var ap2 = v.split('-'), subj = sub(ap2[0]), un = units(ap2[0])[+ap2[1]];
      var have = un.topics.map(function (x) { return x.t; });
      openU[v] = 1;
      sugCache[v] = { state: 'loading' };
      render();
      getTopics(subj.name, un.unit, have).then(function (list) {
        sugCache[v] = list.length ? { list: list } : {
          msg: 'No suggestions found for this unit. Type your own topics, or connect an AI service (AI_ENDPOINT in script.js) for any subject.'
        };
        render();
      });
    }
    if (v = t.getAttribute('data-chip')) {
      var cp = P(v), cuk = cp.sid + '-' + cp.ui, c = sugCache[cuk];
      if (c && c.list) {
        units(cp.sid)[cp.ui].topics.push({ t: c.list[cp.ti], d: false });
        c.list.splice(cp.ti, 1);
        if (!c.list.length) delete sugCache[cuk];
        openU[cuk] = 1;
        save(); render();
      }
    }
    if (v = t.getAttribute('data-chipall')) {
      var q = v.split('-'), c2 = sugCache[v];
      if (c2 && c2.list) {
        c2.list.forEach(function (x) { units(q[0])[+q[1]].topics.push({ t: x, d: false }); });
        delete sugCache[v];
        openU[v] = 1;
        save(); render();
      }
    }

    // What-to-study popup actions
    if (v = t.getAttribute('data-sdone')) {
      topicAt(v).d = true;
      save(); render(); renderSuggest();
    }
    if (v = t.getAttribute('data-stask')) {
      var sp = P(v);
      S.tasks.unshift({ id: S.nid++, text: 'Study: ' + topicAt(v).t, sub: +sp.sid, done: false });
      save(); render(); renderSuggest();
    }
    if (t.id === 'aiBtn') {
      var out = $('aiOut'); out.textContent = 'Thinking...';
      askAI($('sugBody')._ctx)
        .then(function (j) { out.textContent = j.text || 'No answer returned.'; })
        .catch(function () { out.textContent = 'Could not reach the AI service. Check AI_ENDPOINT.'; });
    }
  });

  // ---------- Changes ----------
  document.addEventListener('change', function (e) {
    var t = e.target, v;
    if (!t.getAttribute) return;
    if (v = t.getAttribute('data-done')) {
      S.tasks.forEach(function (x) { if (x.id == v) x.done = t.checked; });
      save(); render();
    }
    if (v = t.getAttribute('data-exam')) {
      if (t.value) { sub(v).exam = t.value; save(); render(); }
    }
    if (t.getAttribute('data-prep') !== null) render();
    if (t.id === 'synSub') { openU = {}; renderSyllabus(); }
    if (v = t.getAttribute('data-topic')) {
      topicAt(v).d = t.checked;
      var tp = P(v);
      openU[tp.sid + '-' + tp.ui] = 1;
      save(); render();
    }
  });

  document.addEventListener('input', function (e) {
    var t = e.target, v;
    if (!t.getAttribute) return;
    if (v = t.getAttribute('data-prep')) {
      sub(v).prep = +t.value;
      save();
      var row = t.parentNode;
      row.querySelector('b').textContent = t.value + '%';
      row.querySelector('.bar i').style.width = t.value + '%';
    }
  });

  document.addEventListener('toggle', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-u');
    if (k) { if (e.target.open) openU[k] = 1; else delete openU[k]; }
  }, true);

  // ---------- Forms ----------
  // Add a topic to a unit
  document.addEventListener('submit', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-addtopic');
    if (!k) return;
    e.preventDefault();
    var input = e.target.querySelector('input'), val = input.value.trim();
    if (!val) return;
    var p = k.split('-');
    units(p[0])[+p[1]].topics.push({ t: val, d: false });
    openU[k] = 1;
    save(); render();
  });

  // Add a subject
  $('subForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('subName').value.trim(), note = $('subNote');
    if (!name) return;
    if (S.subjects.some(function (s) { return s.name.toLowerCase() === name.toLowerCase(); })) {
      note.textContent = 'You already added this subject.';
      return;
    }
    var id = S.nid++;
    S.subjects.push({ id: id, name: name, exam: $('subDate').value || iso(30), prep: 0, att: 0, tot: 0 });
    var lib = libFor(name);
    S.syl[id] = lib ? cloneLib(lib) : [];
    note.textContent = lib
      ? 'Added with units and topics from the built-in library. Edit or delete anything you do not need.'
      : 'Subject added. Add your units below, or tap Suggest units.';
    $('subName').value = '';
    $('subDate').value = '';
    openU = {};
    save(); render();
    $('synSub').value = id;
    renderSyllabus();
  });

  // Add a unit
  $('unitForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('unitName').value.trim(), sid = $('synSub').value;
    if (!name || !sid) return;
    var list = units(sid);
    list.push({ unit: name, topics: [] });
    openU[sid + '-' + (list.length - 1)] = 1;
    $('unitName').value = '';
    save(); render();
  });

  // Suggest units for the selected subject
  $('aiUnits').onclick = function () {
    var s = sub($('synSub').value), note = $('subNote');
    if (!s) return;
    note.textContent = 'Finding units...';
    getUnits(s.name).then(function (list) {
      var have = units(s.id).map(function (u) { return u.unit.toLowerCase(); });
      var add = list.filter(function (u) { return have.indexOf(u.unit.toLowerCase()) < 0; });
      if (!add.length) {
        note.textContent = 'No new units found. Add your own, or connect an AI service (AI_ENDPOINT in script.js) for any subject.';
        return;
      }
      add.forEach(function (u) { units(s.id).push(u); });
      note.textContent = 'Added ' + add.length + ' unit' + (add.length === 1 ? '' : 's') + '. Edit or delete anything you do not need.';
      save(); render();
    });
  };

  // Delete the selected subject
  $('delSub').onclick = function () {
    var s = sub($('synSub').value);
    if (!s) return;
    if (!confirm('Delete ' + s.name + ' with all its units, topics and tasks?')) return;
    S.subjects = S.subjects.filter(function (x) { return x.id != s.id; });
    delete S.syl[s.id];
    S.tasks = S.tasks.filter(function (t) { return t.sub != s.id; });
    openU = {}; sugCache = {};
    $('subNote').textContent = '';
    save(); render();
  };

  // Add a study task
  $('taskForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('taskText').value.trim();
    if (!v || !$('taskSub').value) return;
    S.tasks.unshift({ id: S.nid++, text: v, sub: +$('taskSub').value, done: false });
    $('taskText').value = '';
    save(); render();
  });

  // Feedback: saved to your account and opened in your email app
  $('fbForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var type = $('fbType').value, text = $('fbText').value.trim();
    if (!text) return;
    S.feedback.unshift({ type: type, text: text, date: iso(0) });
    save(); renderFeedback();
    $('fbText').value = '';
    $('fbNote').textContent = 'Saved. Your email app should open so you can send it. If it did not, email mdhussainkhan341@gmail.com directly.';
    window.location.href = 'mailto:mdhussainkhan341@gmail.com?subject=' +
      encodeURIComponent('College Flow ' + type) + '&body=' + encodeURIComponent(text);
  });

  // ---------- Focus timer ----------
  var len = 25 * 60, left = len, iv = null;

  function clock() {
    var m = Math.floor(left / 60), s = left % 60;
    $('clock').textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    document.title = iv ? $('clock').textContent + ' · College Flow' : 'College Flow';
  }

  function stop() {
    clearInterval(iv);
    iv = null;
    $('tStart').textContent = 'Start';
  }

  $('tStart').onclick = function () {
    if (iv) { stop(); clock(); return; }
    if (left <= 0) left = len;
    $('tStart').textContent = 'Pause';
    iv = setInterval(function () {
      left--;
      if (left <= 0) { left = 0; stop(); S.sessions++; save(); render(); }
      clock();
    }, 1000);
    clock();
  };

  $('tReset').onclick = function () { stop(); left = len; clock(); };

  document.querySelectorAll('[data-min]').forEach(function (b) {
    b.onclick = function () {
      stop();
      len = +b.getAttribute('data-min') * 60;
      left = len;
      clock();
    };
  });

  // ---------- Popup buttons ----------
  $('suggestBtn').onclick = openSuggest;
  $('sugClose').onclick = function () { $('sugDlg').close(); };
  $('sugDlg').addEventListener('click', function (e) { if (e.target === this) this.close(); });

  // ---------- AI assistants (ChatGPT, Claude) ----------
  // These sites cannot be embedded inside another page, so they open in a
  // small side window. College Flow stays open behind it.
  document.querySelectorAll('[data-ai]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var w = window.open(a.href, 'cf-ai-' + a.getAttribute('data-ai'),
        'popup=yes,width=480,height=760,left=' + Math.max(0, screen.width - 520) + ',top=40');
      if (w) { e.preventDefault(); w.focus(); }
      // If the browser blocks the window, the normal link opens a new tab instead
    });
  });

  // ---------- Live clock (India time) ----------
  function updateLiveClock() {
    var now = new Date();
    $('current-time').textContent = now.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: true
    });
    $('current-date').textContent = now.toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }
  updateLiveClock();
  setInterval(updateLiveClock, 1000);

  // ---------- Start (called by auth.js after login or sign up) ----------
  window.startApp = function (email, first) {
    KEY = 'examflow-data-' + email;
    openU = {}; sugCache = {};
    try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
    if (!S || !S.subjects) {
      var old = null;
      // The first account on this browser keeps progress saved before accounts existed
      if (first) { try { old = JSON.parse(localStorage.getItem('examflow-v2')); } catch (e) {} }
      S = (old && old.subjects) ? old : seed();
    }
    migrate();
    if (!S.feedback) S.feedback = [];
    save(); render(); clock();

    if (!S.subjects.length) {
      var el = $('syllabus');
      if (el && el.scrollIntoView) el.scrollIntoView();
    } else if (S.lastPop !== iso(0)) {
      S.lastPop = iso(0); save(); openSuggest();
    }
  };
})();