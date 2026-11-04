/* On-page panel — appears on usvisascheduling.com and its sign-in page.
 * Lets the user save credentials, log in with one click (or automatically),
 * and see monitor status without opening the toolbar popup.
 * Lives in a shadow root so the portal's CSS can't break it (and vice versa).
 */
(function () {
  if (globalThis.__vsgPanelLoaded || window.top !== window) return;
  globalThis.__vsgPanelLoaded = true;
  var VSG = globalThis.VSG || {};

  var PENDING_MS = 3 * 60 * 1000; // "Log in now" clicked on the home page → finish on the sign-in page

  var REASONS = {
    'submitted': 'Signed in — submitted your username and password.',
    'filled': 'Filled your username and password.',
    'clicked-no-response': 'Clicked Sign In, but the page did not respond. Try clicking Sign In yourself and tell the developer what happens.',
    'security-questions-need-you': 'Enter the answer for each question below, then click Save & continue.',
    'no-security-questions': 'No security questions on this page.',
    'page-changed': 'The page changed while answering, so I stopped.',
    'security-answers-submitted': 'Answered the security questions and clicked Continue.',
    'security-answers-filled': 'Security answers filled.',
    'no-saved-credentials': 'Save your username and password below first.',
    'login-form-not-found': 'No login form on this page.',
    'submit-not-found': 'Filled in, but no Sign in button found — click it yourself.',
    'auto-login-guard': 'Auto-login paused for a minute (avoiding a login loop). Use "Log in now".',
  };

  var host = document.createElement('div');
  host.id = 'vsg-panel-host';
  host.style.cssText = 'all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '.p{font:13px/1.4 system-ui,sans-serif;color:#222;background:#fff;border:1px solid #cfd8dc;border-radius:10px;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.18);width:320px;overflow:hidden}' +
    '.h{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#1565c0;color:#fff;cursor:pointer;user-select:none}' +
    '.h b{flex:1;font-size:13px}.st{font-size:11px;padding:1px 7px;border-radius:9px;background:rgba(255,255,255,.25);font-variant-numeric:tabular-nums;white-space:nowrap}' +
    '.b{padding:10px;display:flex;flex-direction:column;gap:8px}.hidden{display:none!important}' +
    'input[type=text],input[type=password],input[type=number],select{width:100%;box-sizing:border-box;padding:6px;border:1px solid #ccc;border-radius:6px;font:inherit}' +
    'button{font:inherit;padding:7px 10px;border-radius:6px;border:1px solid #1565c0;background:#1565c0;color:#fff;cursor:pointer}' +
    'button.s{background:#fff;color:#1565c0}button:disabled{opacity:.5;cursor:default}' +
    '.row{display:flex;gap:6px}.row>*{flex:1}.m{color:#666;font-size:9.5px}.msg{font-size:14px;padding:6px;border-radius:6px;background:#e3f2fd}' +
    '.msg.err{background:#ffebee}.msg.ok{background:#e8f5e9}label.c{display:flex;gap:6px;align-items:center;font-size:12px}' +
    'a{color:#1565c0;cursor:pointer;text-decoration:underline}' +
    '.cd{font-size:12px;padding:6px 8px;border-radius:6px;background:#fff8e1;font-variant-numeric:tabular-nums}' +
    '.cd .bar{height:4px;background:#ffe0b2;border-radius:2px;margin-top:5px;overflow:hidden}' +
    '.cd #cdBar{height:100%;width:0;background:#f9a825}' +
    '.q{margin-top:6px;font-size:12px}.q .t{font-weight:600}.q .ok{color:#2e7d32}' +
    '.brow{display:flex;justify-content:space-between;align-items:center;font-size:10px;padding:3px 0}' +
    '.brow a{font-size:9px}' +
    '.qa{border:1px solid #e0e0e0;border-radius:8px;padding:8px}.qa .n{font-size:11px;color:#666;margin-top:6px}' +
    '.qa input{margin-top:3px}' +
    '</style>' +
    '<div class="p">' +
    '  <div class="h" id="hdr"><b>Visa Slot Guard</b><span class="st" id="st">…</span><span id="tog">▾</span></div>' +
    '  <div class="b" id="body">' +
    '    <div class="msg hidden" id="msg"></div>' +
    '    <div class="cd hidden" id="cd"><div class="row" style="align-items:center"><span id="cdText" style="flex:1"></span>' +
    '      <a id="cdNow" style="flex:0 0 auto">go now</a></div><div class="bar"><div id="cdBar"></div></div></div>' +
    '    <div id="credView" class="hidden"><span class="m">Saved login: <b id="who"></b></span> · <a id="edit">edit</a></div>' +
    '    <div id="credForm" class="hidden">' +
    '      <input type="text" id="u" placeholder="Username / email" autocomplete="off">' +
    '      <input type="password" id="pw" placeholder="Password" autocomplete="off" style="margin-top:6px">' +
    '      <div class="row" style="margin-top:6px"><button id="saveCreds">Save login</button><button class="s hidden" id="cancel">Cancel</button></div>' +
    '      <div class="m" style="margin-top:4px">Stored only in this browser (chrome.storage.local).</div>' +
    '    </div>' +
    '    <div id="secBox" class="hidden"><b>Security questions</b>' +
    '      <div id="secList"></div>' +
    '      <div class="row" style="margin-top:6px"><button id="secSave">Save &amp; continue</button></div>' +
    '      <div class="m" style="margin-top:4px">Answers are stored only in this browser (chrome.storage.local).</div>' +
    '    </div>' +
    '    <div class="m" id="qaView"><span id="qaCount"></span> · <a id="qaEdit">set up</a></div>' +
    '    <div class="qa hidden" id="qaForm"><b>Your 3 security questions</b>' +
    '      <div class="m">One-time setup. Type each question exactly as the portal shows it.</div>' +
    '      <div class="n">Question 1</div><input type="text" id="qq0" placeholder="e.g. What is your mother\'s maiden name?" autocomplete="off">' +
    '      <input type="password" id="qa0" placeholder="Answer" autocomplete="off">' +
    '      <div class="n">Question 2</div><input type="text" id="qq1" placeholder="Question" autocomplete="off">' +
    '      <input type="password" id="qa1" placeholder="Answer" autocomplete="off">' +
    '      <div class="n">Question 3</div><input type="text" id="qq2" placeholder="Question" autocomplete="off">' +
    '      <input type="password" id="qa2" placeholder="Answer" autocomplete="off">' +
    '      <label class="c" style="margin-top:6px"><input type="checkbox" id="qaShow"> Show answers</label>' +
    '      <div class="row" style="margin-top:6px"><button id="qaSave">Save questions</button><button class="s" id="qaCancel">Cancel</button></div>' +
    '    </div>' +
    '    <div class="qa hidden" id="ofcBox"><b>OFC Post auto-select</b>' +
    '      <div class="m">Tick the posts to rotate through (one = re-select it). Changes apply right away.</div>' +
    '      <div id="ofcPosts"></div>' +
    '      <div class="row" style="margin-top:6px;align-items:center"><span style="flex:0 0 auto">Every</span>' +
    '        <input type="number" id="ofcEvery" min="1" max="600" step="1">' +
    '        <select id="ofcUnit"><option value="1">seconds</option><option value="60">minutes</option></select></div>' +
    '      <div class="m">Between 5 seconds and 10 minutes.</div>' +
    '      <div class="m" style="margin-top:8px"><b>Burst windows</b> — check faster during specific minutes of every hour (e.g. when slots are usually released).</div>' +
    '      <div id="burstList"></div>' +
    '      <div class="row" style="margin-top:4px;align-items:center">' +
    '        <span style="flex:0 0 auto;font-size:12px">Minute</span><input type="number" id="burstFrom" min="0" max="59" step="1" style="width:3.5em">' +
    '        <span style="flex:0 0 auto;font-size:12px">to</span><input type="number" id="burstTo" min="0" max="59" step="1" style="width:3.5em">' +
    '        <input type="number" id="burstSec" min="5" max="600" step="1" style="width:3.0em" value="8">' +
    '        <span style="flex:0 0 auto;font-size:12px">s</span><button class="s" id="burstAdd">Add</button></div>' +
    '      <div class="m">E.g. 1 to 5, and 55 to 1 (wraps into the next hour). Floor is 5 s, same as the main interval.</div>' +
    '      <div class="row" style="margin-top:6px"><button id="ofcStart">Start</button></div>' +
    '      <div class="m" id="ofcStatus"></div>' +
    '      <div class="m">When time slots show, the best one is selected and Submit happens at once — automatic, always on.</div>' +
    '      <div class="m" id="bookStatus"></div>' +
    '    </div>' +
    '    <label class="c"><input type="checkbox" id="auto"> Sign in automatically when the page loads</label>' +
    '    <label class="c"><input type="checkbox" id="autoSched"> Open Schedule Appointment from the home page</label>' +
    '    <div class="row"><button id="login">Log in now</button><button class="s" id="check">Check slots</button></div>' +
    '    <div class="m" id="last"></div>' +
    '  </div>' +
    '</div>';
  (document.body || document.documentElement).appendChild(host);

  var $ = function (id) { return root.getElementById(id); };
  var settings = null;
  var myIp = ''; // informational only, shown next to "Monitor: ..." — fetched via the background (has the host permission), not sent anywhere else

  async function loadMyIp() {
    var r = await send({ type: 'VSG_GET_IP' });
    myIp = (r.ok && r.data && r.data.ip) || '';
    if (myIp) render();
  }

  function send(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (r) { void chrome.runtime.lastError; resolve(r || { ok: false }); });
      } catch (e) { resolve({ ok: false, error: 'extension-reloaded' }); }
    });
  }

  function say(text, kind) {
    var m = $('msg');
    m.textContent = text;
    m.className = 'msg ' + (kind || '');
  }

  VSG.panelSay = say;

  // --- access block: portal flagged this as automated use -------------------
  // Different from a session expiry: this is an anti-abuse enforcement
  // message, so the only correct response is to STOP — never clear cookies
  // or retry, which would just be evading the block. Resuming afterwards is
  // a deliberate, manual action (untick "Pause monitoring"), never automatic.
  var blocked = false;
  var slotsObserver = null;

  function panelStopAll(msg) {
    blocked = true;
    endCountdown('cancelled');
    if (typeof ofc !== 'undefined' && ofc.running) ofcStop();
    if (slotsObserver) { slotsObserver.disconnect(); slotsObserver = null; } // this alone stops auto-submit
    $('auto').disabled = true;
    $('autoSched').disabled = true;
    say('STOPPED — the portal blocked access as a possible Prohibited Conduct violation ' +
      '(automated use detected). All automatic actions here are off. Review the Terms and ' +
      'conditions, then untick "Pause monitoring" in the toolbar popup to resume manually.', 'err');
    VSG.storage.logHealth('error', 'Access blocked by the portal: ' + String(msg || '').slice(0, 300));
  }
  VSG.panelStopAll = panelStopAll;

  // --- countdown: shown whenever we're waiting before doing something -------
  // countdown(label, ms, { skippable }) → Promise<'done' | 'skipped' | 'cancelled'>
  // label contains {t}, replaced by the time left. "go now" ends it early.
  var cd = { timer: null, resolve: null };

  function fmtLeft(ms) {
    var s = ms / 1000;
    if (s < 10) return s.toFixed(1) + ' s';
    s = Math.ceil(s);
    if (s < 60) return s + ' s';
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2) + ' min';
  }

  function endCountdown(how) {
    if (cd.timer) clearInterval(cd.timer);
    cd.timer = null;
    $('cd').classList.add('hidden');
    var r = cd.resolve;
    cd.resolve = null;
    if (r) r(how);
  }

  function countdown(label, ms, opts) {
    endCountdown('cancelled'); // only one at a time
    opts = opts || {};
    return new Promise(function (resolve) {
      if (!(ms > 0)) return resolve('done');
      var end = Date.now() + ms;
      cd.resolve = resolve;
      $('cdNow').classList.toggle('hidden', !opts.skippable);
      $('cd').classList.remove('hidden');
      function update() {
        var left = end - Date.now();
        if (left <= 0) return endCountdown('done');
        $('cdText').textContent = label.replace('{t}', fmtLeft(left));
        $('cdBar').style.width = (100 * (1 - left / ms)).toFixed(1) + '%';
      }
      update();
      cd.timer = setInterval(update, 100);
    });
  }

  $('cdNow').addEventListener('click', function () { endCountdown('skipped'); });

  function hasCreds(s) { return !!(s && s.quickLogin.username && s.quickLogin.password); }

  function render() {
    if (settings && typeof ofc !== 'undefined' && ofc.lastPosts !== undefined) ofcSyncTicks();
    var s = settings;
    if (!s) return;
    $('st').title = 'Monitor: ' + (s.paused ? 'PAUSED' : s.sessionState);
    var creds = hasCreds(s);
    $('credView').classList.toggle('hidden', !creds);
    $('credForm').classList.toggle('hidden', creds);
    $('cancel').classList.toggle('hidden', !creds);
    $('who').textContent = s.quickLogin.username;
    $('auto').checked = s.quickLogin.autoSignIn !== false;
    $('autoSched').checked = s.autoOpenSchedule !== false;
    // Only useful on a page that actually needs it: the sign-in page, the
    // security-questions page, or a portal page still showing "Sign In".
    // Once login is actually done, there's nothing left for it to do.
    // Not done until we're genuinely back on the portal: while on the B2C
    // sign-in domain at all — the login form, the security questions, or
    // the moment of transition between them — login isn't complete yet,
    // whichever single step the page happens to be showing right now.
    var needsLogin = /(^|\.)b2clogin\.com$/.test(location.hostname) || !!VSG.login.findSignInLink();
    $('login').classList.toggle('hidden', !needsLogin);
    $('login').disabled = !creds && !VSG.login.isSecurityPage();
    var nQA = (s.quickLogin.securityQA || []).length;
    $('qaCount').textContent = 'Security questions: ' + nQA + ' of 3 saved';
    $('qaEdit').textContent = nQA ? 'edit' : 'set up';
    renderSecurity();
    var onPortal = /usvisascheduling\.com$/.test(location.hostname);
    $('check').classList.toggle('hidden', !onPortal);
    var lastEl = $('last');
    lastEl.textContent = 'Monitor: ' + (s.paused ? 'PAUSED' : s.sessionState) + ' · ' + (s.lastCheckAt
      ? 'last check ' + new Date(s.lastCheckAt).toLocaleTimeString() + ' (' + (s.lastResult || '—') + ')'
      : 'no slot checks yet');
    if (myIp) {
      var ipSpan = document.createElement('span');
      ipSpan.style.fontSize = '8px';
      ipSpan.style.color = '#999';
      ipSpan.textContent = ' · IP: ' + myIp;
      lastEl.appendChild(ipSpan);
    }
  }

  async function refresh() {
    try { settings = await VSG.storage.getSettings(); } catch (e) { return; }
    render();
  }

  async function saveQuickLogin(patch) {
    var ql = Object.assign({}, settings.quickLogin, patch);
    await send({ type: 'VSG_SAVE', patch: { quickLogin: ql } });
    await refresh();
  }

  function creds() {
    return { username: settings.quickLogin.username, password: settings.quickLogin.password, securityQA: settings.quickLogin.securityQA || [] };
  }

  async function doLogin(auto) {
    if (blocked) return { ok: false, reason: 'blocked' };
    if (VSG.login.isSecurityPage()) return answerQuestions(auto);
    if (VSG.login.isLoginPage()) {
      var r = await VSG.login.fill(creds(), { submit: true, auto: auto });
      if (r.reason === 'auto-login-guard') {
        var res = await countdown('Auto-login is pausing between attempts (avoids a login loop). Signing in in {t}',
          await VSG.login.autoWaitMs(), { skippable: true });
        if (res === 'cancelled') return r;
        return doLogin(res === 'done'); // "go now" = a manual attempt
      }
      await chrome.storage.local.set({ vsgPendingLogin: 0 });
      say(REASONS[r.reason] || r.reason.replace(/^portal-said: /, 'The sign-in page says: '), r.ok ? 'ok' : 'err');
      VSG.storage.logHealth(r.ok ? 'ok' : 'warn', 'login (' + (auto ? 'auto' : 'manual') + '): ' + r.reason);
      render(); // re-check right away: no navigation means it stays on screen otherwise
      // B2C often swaps straight to security questions in the same document
      // (no real page load), so nothing else would ever notice and continue
      // on its own — this script only gets to run its one-time setup once.
      // Chain straight into it rather than leaving it sitting there answered
      // by nobody.
      if (r.ok && !VSG.login.isSecurityPage()) await VSG.login.waitForSecurityQuestions(4000, 1);
      if (r.ok && VSG.login.isSecurityPage()) return doLogin(auto);
      return r;
    }
    var link = VSG.login.findSignInLink();
    if (link) {
      await chrome.storage.local.set({ vsgPendingLogin: Date.now() });
      say('Opening the sign-in page…');
      link.click();
      return { ok: true, reason: 'navigating' };
    }
    // Form may still be rendering.
    if (await VSG.login.waitForLoginForm(4000)) return doLogin(auto);
    if (!auto) say('No sign-in form or link on this page. If you are already logged in, you are all set.', '');
    return { ok: false, reason: 'login-form-not-found' };
  }

  // --- security questions ------------------------------------------------
  var answering = false;

  function savedQA() { return (settings && settings.quickLogin.securityQA) || []; }

  // List the questions on this page: saved ones get a tick, the rest an
  // answer box so the user can save them.
  function renderSecurity() {
    var qs = VSG.login.isSecurityPage() ? VSG.login.findSecurityQuestions() : [];
    $('secBox').classList.toggle('hidden', !qs.length);
    if (!qs.length) return;
    var list = $('secList');
    var typed = {};
    list.querySelectorAll('input').forEach(function (i) { typed[i.dataset.q] = i.value; });
    list.innerHTML = '';
    var missing = 0;
    qs.forEach(function (item) {
      var div = document.createElement('div');
      div.className = 'q';
      var t = document.createElement('div');
      t.className = 't';
      t.textContent = item.question;
      div.appendChild(t);
      if (VSG.questions.findAnswer(savedQA(), item.question)) {
        var ok = document.createElement('div');
        ok.className = 'ok';
        ok.textContent = '\u2713 answer saved';
        div.appendChild(ok);
      } else {
        missing++;
        var inp = document.createElement('input');
        inp.type = 'password';
        inp.placeholder = 'Answer';
        inp.autocomplete = 'off';
        inp.dataset.q = item.question;
        inp.value = typed[item.question] || '';
        div.appendChild(inp);
      }
      list.appendChild(div);
    });
    $('secSave').textContent = missing ? 'Save & continue' : 'Answer now';
  }

  async function saveAnswers(pairs) {
    var qa = savedQA();
    pairs.forEach(function (p) { qa = VSG.questions.upsert(qa, p.q, p.a); });
    await saveQuickLogin({ securityQA: qa });
  }

  async function answerQuestions(auto) {
    if (answering) return { ok: false, reason: 'busy' };
    answering = true;
    try {
      var r = await VSG.login.answerSecurityQuestions(savedQA(), {
        submit: true,
        auto: auto,
        onWaiting: function (ms) {
          say('Matched your saved answers.', 'ok');
          countdown('Filling in your answers in {t}', ms);
        },
      });
      if (r.reason !== 'auto-login-guard') {
        say(REASONS[r.reason] || r.reason.replace(/^portal-said: /, 'The page says: '), r.ok ? 'ok' : 'err');
        VSG.storage.logHealth(r.ok ? 'ok' : 'warn', 'security questions (' + (auto ? 'auto' : 'manual') + '): ' + r.reason);
      }
      render(); // re-check right away: no navigation means it stays on screen otherwise
    } finally {
      answering = false;
    }
    if (r.reason === 'auto-login-guard') {
      var res = await countdown('Pausing between automatic attempts. Answering the questions in {t}',
        await VSG.login.autoWaitMs('vsgLastAutoSecurityAt'), { skippable: true });
      if (res !== 'cancelled') return answerQuestions(res === 'done');
    }
    return r;
  }

  // --- live clock in the header -------------------------------------------
  function tick() {
    $('st').textContent = new Date().toLocaleString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }
  tick();
  setInterval(tick, 1000);

  // --- one-time setup of all three security questions ---------------------
  function openQAForm() {
    var qa = savedQA();
    // Prefill with what's saved; fill empty rows with questions on this page.
    var shown = VSG.login.isSecurityPage() ? VSG.login.findSecurityQuestions().map(function (x) { return x.question; }) : [];
    var extra = shown.filter(function (q) { return !VSG.questions.findAnswer(qa, q); });
    for (var i = 0; i < 3; i++) {
      $('qq' + i).value = qa[i] ? qa[i].q : (extra.shift() || '');
      $('qa' + i).value = qa[i] ? qa[i].a : '';
    }
    $('qaShow').checked = false;
    showAnswers(false);
    $('qaForm').classList.remove('hidden');
    $('qaView').classList.add('hidden');
  }

  function closeQAForm() {
    $('qaForm').classList.add('hidden');
    $('qaView').classList.remove('hidden');
  }

  function showAnswers(on) {
    for (var i = 0; i < 3; i++) $('qa' + i).type = on ? 'text' : 'password';
  }

  $('qaEdit').addEventListener('click', openQAForm);
  $('qaCancel').addEventListener('click', closeQAForm);
  $('qaShow').addEventListener('change', function () { showAnswers($('qaShow').checked); });
  $('qaSave').addEventListener('click', async function () {
    var list = [];
    for (var i = 0; i < 3; i++) {
      var q = $('qq' + i).value.trim();
      var a = $('qa' + i).value.trim();
      if (!q && !a) continue;
      if (!q || !a) return say('Question ' + (i + 1) + ' needs both the question and its answer.', 'err');
      list = VSG.questions.upsert(list, q, a);
    }
    if (!list.length) return say('Enter at least one question and answer.', 'err');
    await saveQuickLogin({ securityQA: list });
    closeQAForm();
    say('Saved ' + list.length + ' security question' + (list.length > 1 ? 's' : '') + ' in this browser.', 'ok');
    // On the questions page right now? Answer them with the new set.
    if (VSG.login.isSecurityPage() && !answering) {
      var all = VSG.login.findSecurityQuestions().every(function (x) { return VSG.questions.findAnswer(list, x.question); });
      if (all) await answerQuestions(false);
    }
  });

  // --- wiring -------------------------------------------------------------
  var collapsed = false;
  function setCollapsed(c) {
    collapsed = c;
    $('body').classList.toggle('hidden', c);
    $('tog').textContent = c ? '▴' : '▾';
    chrome.storage.local.set({ vsgPanelCollapsed: c });
  }
  $('hdr').addEventListener('click', function () { setCollapsed(!collapsed); });

  $('saveCreds').addEventListener('click', async function () {
    var u = $('u').value.trim();
    var p = $('pw').value;
    if (!u || !p) return say('Enter both username and password.', 'err');
    await saveQuickLogin({ username: u, password: p });
    $('pw').value = '';
    say('Login saved on this device.', 'ok');
  });
  $('edit').addEventListener('click', function () {
    $('u').value = settings.quickLogin.username || '';
    $('pw').value = settings.quickLogin.password || '';
    $('credView').classList.add('hidden');
    $('credForm').classList.remove('hidden');
    $('cancel').classList.remove('hidden');
  });
  $('cancel').addEventListener('click', render);
  $('secSave').addEventListener('click', async function () {
    var pairs = [];
    var empty = false;
    $('secList').querySelectorAll('input').forEach(function (i) {
      if (i.value.trim()) pairs.push({ q: i.dataset.q, a: i.value.trim() });
      else empty = true;
    });
    if (empty) return say('Enter an answer for every question shown.', 'err');
    if (pairs.length) await saveAnswers(pairs);
    $('secList').innerHTML = '';
    renderSecurity();
    await answerQuestions(false);
  });
  $('auto').addEventListener('change', function () { saveQuickLogin({ autoSignIn: $('auto').checked }); });
  $('autoSched').addEventListener('change', async function () {
    await send({ type: 'VSG_SAVE', patch: { autoOpenSchedule: $('autoSched').checked } });
    await refresh();
  });
  $('login').addEventListener('click', function () { endCountdown('cancelled'); doLogin(false); });
  $('check').addEventListener('click', async function () {
    $('check').disabled = true;
    say('Checking…');
    await send({ type: 'VSG_CHECK_NOW' });
    await refresh();
    $('check').disabled = false;
    var log = settings.healthLog || [];
    var lastEntry = log[log.length - 1];
    say(lastEntry ? lastEntry.msg : 'Done.', lastEntry && lastEntry.kind === 'ok' ? 'ok' : '');
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && !changes.vsgLastAutoLoginAt && !changes.vsgPendingLogin) refresh();
  });

  // Signing in by hand saves what was typed (extension storage only).
  VSG.login.watchTypedCredentials(function (u, p) {
    if (!settings || (settings.quickLogin.username === u && settings.quickLogin.password === p)) return;
    var ql = Object.assign({}, settings.quickLogin, { username: u, password: p });
    settings.quickLogin = ql;
    VSG.storage.updateSettings({ quickLogin: ql });
    VSG.storage.logHealth('info', 'Saved the login you typed for "' + u + '".');
  });

  // Answering the security questions by hand saves them too.
  VSG.login.watchTypedAnswers(function (pairs) {
    if (answering || !settings) return;
    var fresh = pairs.filter(function (p) {
      var hit = VSG.questions.findAnswer(savedQA(), p.q);
      return !hit || hit.a !== p.a;
    });
    if (!fresh.length) return;
    var qa = savedQA();
    fresh.forEach(function (p) { qa = VSG.questions.upsert(qa, p.q, p.a); });
    settings.quickLogin = Object.assign({}, settings.quickLogin, { securityQA: qa });
    VSG.storage.updateSettings({ quickLogin: settings.quickLogin });
    VSG.storage.logHealth('info', 'Saved ' + fresh.length + ' security answer(s) you typed.');
  });

  // --- startup: runs as soon as the DOM is ready (run_at document_end) ------
  var SIGNIN_LINK_GUARD_MS = 90 * 1000;
  // --- portal home page: open "Schedule Appointment" ----------------------
  // Only on the home page itself (/en-US/): the same menu appears on other
  // portal pages, and clicking it there could loop. Every visit to the home
  // page clicks it, unless the portal keeps bouncing back here (3 clicks in
  // a minute) — then we stop so it can't loop forever.
  var SCHEDULE_DELAY_MS = 2000;
  var SCHEDULE_LOOP_WINDOW_MS = 60 * 1000;
  var SCHEDULE_LOOP_MAX = 3;

  function isPortalHome() {
    return /usvisascheduling\.com$/.test(location.hostname) && /^\/[a-z]{2}-[a-z]{2}\/?$/i.test(location.pathname);
  }

  function findScheduleLink() {
    var els = document.querySelectorAll('a, button, [role="button"], [role="menuitem"], li');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.closest('#vsg-panel-host')) continue;
      if (!/^schedule appointment$/i.test((el.innerText || el.textContent || '').trim())) continue;
      var r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el.closest('a, button') || el.querySelector('a, button') || el;
    }
    return null;
  }

  function waitFor(fn, timeoutMs) {
    return new Promise(function (resolve) {
      var found = fn();
      if (found) return resolve(found);
      var obs = new MutationObserver(function () {
        var f = fn();
        if (f) { obs.disconnect(); clearTimeout(timer); resolve(f); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      var timer = setTimeout(function () { obs.disconnect(); resolve(fn()); }, timeoutMs);
    });
  }

  async function maybeOpenSchedule(force) {
    if (blocked || !isPortalHome() || settings.autoOpenSchedule === false) return false;
    // Logged out → the home page shows Sign In instead; leave that to sign-in.
    var link = await waitFor(function () {
      return findScheduleLink() || (VSG.login.findSignInLink() ? 'signed-out' : null);
    }, 8000);
    if (!link || link === 'signed-out') return false;
    var g = await chrome.storage.local.get({ vsgScheduleClicks: [] });
    var recent = (g.vsgScheduleClicks || []).filter(function (t) { return Date.now() - t < SCHEDULE_LOOP_WINDOW_MS; });
    if (!force && recent.length >= SCHEDULE_LOOP_MAX) {
      say('The portal keeps returning to the home page, so I am pausing Schedule Appointment.', 'err');
      var pause = await countdown('Opening Schedule Appointment again in {t}',
        recent[0] + SCHEDULE_LOOP_WINDOW_MS - Date.now(), { skippable: true });
      if (pause === 'cancelled') return false;
      return maybeOpenSchedule(pause === 'skipped');
    }
    // force = "go now" on the loop pause: click straight away.
    var res = force ? 'skipped' : await countdown('Opening Schedule Appointment in {t}', SCHEDULE_DELAY_MS, { skippable: true });
    if (res === 'cancelled' || !document.contains(link) || !isPortalHome()) return false;
    recent.push(Date.now());
    await chrome.storage.local.set({ vsgScheduleClicks: recent });
    VSG.storage.logHealth('info', 'Clicked Schedule Appointment on the home page.');
    link.click();
    return true;
  }

  // --- ofc-schedule page: select the OFC Post on an interval ---------------
  var OFC_MIN_SEC = 5;
  var OFC_MAX_SEC = 600;
  var ofc = { running: false, remaining: 0, idx: 0, timer: null, last: '', lastStepAt: 0, level: 0, pausedFor: '', lastReloginAttemptAt: 0, jitter: 1 };
  var ofcRelogging = false;
  var OFC_RELOGIN_COOLDOWN_MS = 60 * 1000; // same spirit as login.js's own auto-login-guard: don't hammer the form

  // Rate-limit feedback for the rotation loop. This is the fastest, most
  // repetitive automated action in the extension (reselecting a dropdown
  // every 5s-10min, faster still inside a burst window) and — unlike the
  // background probe cycle (service-worker.js, via VSG.scheduler +
  // VSG.session) — it never once looked at how the portal was responding.
  // Same exponential-backoff-with-jitter algorithm as the background probe
  // (VSG.scheduler): -1 level per healthy step, +1/+2 per QUEUE/RATE_LIMITED,
  // capped at 8. Level 0 never changes the user's chosen cadence — the floor
  // only grows once the portal has actually pushed back, and decays back to
  // full speed the moment it's calm again.
  var OFC_BACKOFF_KEY = 'ofcBackoffLevel';
  // This page (and the dropdown's own change event, on at least some posts)
  // can navigate/reload mid-countdown — see the burst-draft comment below for
  // another symptom of the same thing. Persisting the last real step lets a
  // resume after such a reload pick the countdown back up instead of
  // stepping again immediately, which would otherwise hammer the dropdown
  // far faster than the configured interval and make "next in" look like it
  // keeps jumping back to the top instead of counting down.
  var OFC_LAST_STEP_KEY = 'ofcLastStepAt';

  function currentPageState() {
    var bodyText = '';
    try { bodyText = document.body ? document.body.innerText : ''; } catch (e) { /* ignore */ }
    return VSG.detector.detectPageState({ url: location.href, title: document.title, bodyText: bodyText });
  }

  // The floor this backoff level imposes, never below the user's own
  // burst/base cadence — backoff only ever slows the rotation down, it
  // never speeds it up past what was asked for.
  // Jitter is rolled once per step (see ofcStep) and reused here, not
  // re-rolled on every call — ofcTick() re-evaluates this every second so
  // burst/backoff changes land immediately, and re-rolling the jitter too
  // would make the countdown jump around instead of ticking down steadily.
  function ofcRollJitter() { ofc.jitter = 0.9 + Math.random() * 0.2; }

  function ofcTargetSec() {
    var base = VSG.burst.activeIntervalSec(burstWindows(), settings.ofcIntervalSec);
    var target = base;
    if (ofc.level > 0) target = Math.min(OFC_MAX_SEC, Math.max(base, VSG.scheduler.computeDelaySec(base, ofc.level, OFC_MAX_SEC)));
    // Small jitter even while healthy (±10%, average unchanged): a
    // perfectly periodic request cadence is itself a bot signature. The
    // background probe's own computeDelayMs already does this at every
    // level, including 0 — this brings the OFC loop up to the same bar.
    var jittered = Math.round(target * ofc.jitter);
    return Math.max(OFC_MIN_SEC, Math.min(OFC_MAX_SEC, jittered));
  }

  function ofcSetLevel(level) {
    level = Math.max(0, Math.min(8, level));
    if (level === ofc.level) return;
    var was = ofc.level;
    ofc.level = level;
    var o = {};
    o[OFC_BACKOFF_KEY] = level;
    chrome.storage.local.set(o); // survives a reload of this page — the portal still remembers us
    if (level > was) VSG.storage.logHealth('warn', 'OFC rotation backing off (level ' + level + ') — the portal pushed back.');
    else if (level === 0) VSG.storage.logHealth('ok', 'OFC rotation back to full speed — portal is calm again.');
  }

  async function ofcLoadLevel() {
    var g = {};
    g[OFC_BACKOFF_KEY] = 0;
    var s = await chrome.storage.local.get(g);
    ofc.level = s[OFC_BACKOFF_KEY] || 0;
  }

  function isOfcPage() { return /usvisascheduling\.com$/.test(location.hostname) && /\/ofc-schedule\/?$/i.test(location.pathname); }
  function ofcSelectEl() { return document.getElementById('post_select'); }

  function ofcOptions() {
    var sel = ofcSelectEl();
    return sel ? Array.prototype.filter.call(sel.options, function (o) { return o.value; }) : [];
  }

  function fmtInterval(sec) {
    return sec >= 60 && sec % 60 === 0 ? sec / 60 + ' min' : sec + ' s';
  }

  // mm:ss, used for the live countdown (ofcStatus) rather than the raw
  // second count — easier to read at a glance once it's several minutes out.
  function fmtCountdown(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function fmtMinute(m) { return (m < 10 ? '0' : '') + m; }
  function burstWindows() { return settings.ofcBurstWindows || []; }

  function fmtHourRange(h) { return (h < 10 ? '0' : '') + h + ':00'; }

  function fmtBurstRange(w) {
    var minutePart = 'Minute ' + fmtMinute(w.from) + ' to ' + fmtMinute(w.to) + (w.from > w.to ? ' (wraps into the next hour)' : '');
    if (w.hourFrom == null || w.hourTo == null) return minutePart;
    var hourPart = fmtHourRange(w.hourFrom) + '–' + fmtHourRange(w.hourTo) + (w.hourFrom > w.hourTo ? ' (wraps past midnight)' : '');
    // Auto windows cover every minute of their hour range (from:0,to:59) —
    // showing the minute part too would just read as noise.
    return (w.from === 0 && w.to === 59 ? hourPart : hourPart + ', ' + minutePart);
  }

  function burstRender() {
    var list = $('burstList');
    list.innerHTML = '';
    var windows = burstWindows();
    if (!windows.length) {
      var none = document.createElement('div');
      none.className = 'm';
      none.textContent = 'No burst windows added yet.';
      list.appendChild(none);
      return;
    }
    windows.forEach(function (w, idx) {
      var row = document.createElement('div');
      row.className = 'brow';
      var label = document.createElement('span');
      label.textContent = fmtBurstRange(w) + ' → every ' + fmtInterval(w.sec) + (w.source === 'auto' ? ' (auto, ' + (w.votes || 0) + ' votes — set up sources in the toolbar popup)' : '');
      row.appendChild(label);
      var remove = document.createElement('a');
      remove.textContent = 'remove';
      remove.addEventListener('click', function () { burstRemove(idx); });
      row.appendChild(remove);
      list.appendChild(row);
    });
  }

  async function burstSave(windows) {
    await send({ type: 'VSG_SAVE', patch: { ofcBurstWindows: windows } });
    await refresh();
    burstRender();
    ofcStatus(); // an already-running rotation picks this up on its next tick
  }

  function burstRemove(idx) {
    var windows = burstWindows().slice();
    windows.splice(idx, 1);
    burstSave(windows);
  }

  // The "Minute X to Y every Z s" row is only a draft for the next Add, not
  // itself one of the saved burst windows — nothing else restores it, so a
  // page reload (navigating the OFC page) before clicking Add silently loses
  // whatever was typed. Persist and restore it the same way as vsgPanelCollapsed.
  var BURST_DRAFT_KEY = 'vsgBurstDraft';
  function burstDraftSave() {
    var draft = { from: $('burstFrom').value, to: $('burstTo').value, sec: $('burstSec').value };
    var o = {};
    o[BURST_DRAFT_KEY] = draft;
    chrome.storage.local.set(o);
  }
  async function burstDraftLoad() {
    var o = {};
    o[BURST_DRAFT_KEY] = null;
    var g = await chrome.storage.local.get(o);
    var draft = g[BURST_DRAFT_KEY];
    if (!draft) return;
    if (draft.from !== '' && draft.from != null) $('burstFrom').value = draft.from;
    if (draft.to !== '' && draft.to != null) $('burstTo').value = draft.to;
    if (draft.sec !== '' && draft.sec != null) $('burstSec').value = draft.sec;
  }
  ['burstFrom', 'burstTo', 'burstSec'].forEach(function (id) {
    $(id).addEventListener('input', burstDraftSave);
  });

  $('burstAdd').addEventListener('click', function () {
    var from = Math.round(Number($('burstFrom').value));
    var to = Math.round(Number($('burstTo').value));
    var sec = Math.round(Number($('burstSec').value));
    if (!(from >= 0 && from <= 59) || !(to >= 0 && to <= 59)) return say('Minute must be 0 to 59.', 'err');
    if (!(sec >= OFC_MIN_SEC && sec <= OFC_MAX_SEC)) return say('Interval must be between 5 and 600 seconds.', 'err');
    var windows = burstWindows().concat([{ from: from, to: to, sec: sec }]);
    burstSave(windows);
    say('Added: every ' + fmtInterval(sec) + ' during minute ' + fmtMinute(from) + ' to ' + fmtMinute(to) + ' of every hour.', 'ok');
  });

  // Choose an option the way a user would. Re-choosing the current value
  // fires no change, so step through the blank option first.
  function ofcSelect(value) {
    var sel = ofcSelectEl();
    if (!sel) return false;
    if (sel.value === value) {
      sel.value = '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    sel.focus();
    sel.value = value;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    sel.blur();
    return sel.value === value;
  }

  function ofcChosen() {
    var have = ofcOptions().map(function (o) { return o.value; });
    return (settings.ofcPosts || []).filter(function (v) { return have.indexOf(v) !== -1; });
  }

  function ofcStatus() {
    $('ofcStart').textContent = ofc.running ? 'Stop' : 'Start';
    var tries = ofcTriesTotal();
    var triesNote = tries ? ' · ' + tries + (tries === 1 ? ' try' : ' tries') + ' this session' : '';
    var active = VSG.burst.activeWindow(burstWindows());
    var burstNote = active ? ' (burst: minute ' + fmtMinute(active.from) + '–' + fmtMinute(active.to) + ')' : '';
    var curInterval = ofcTargetSec();
    var backoffNote = ofc.level > 0 ? ' (backing off, level ' + ofc.level + ')' : '';
    // Post names already show next to each checkbox above; no need to list
    // them again here too — just the running state and the countdown.
    var runningNote;
    if (ofc.pausedFor === 'challenge') runningNote = 'PAUSED — human-verification check on screen, resumes once you solve it';
    else if (ofc.pausedFor === 'session') runningNote = 'PAUSED — session expired' + (ofcRelogging ? ', signing in…' : ', waiting to retry sign-in');
    else runningNote = 'Checking every ' + fmtInterval(curInterval) + burstNote + backoffNote +
      ' · next in ' + fmtCountdown(ofc.remaining) + (ofc.last ? ' · last: ' + ofc.last : '');
    $('ofcStatus').textContent = (ofc.running ? runningNote : (ofc.last ? 'Stopped · last: ' + ofc.last : 'Stopped')) + triesNote;
  }

  // Per-post try counts for the current rotation session: how many times
  // each OFC post has been checked. Kept outside the settings bundle (its
  // own storage key, written directly) so a tick every few seconds doesn't
  // spam the health log with "Settings updated." entries.
  var ofcTries = {};
  function ofcTriesTotal() {
    return Object.keys(ofcTries).reduce(function (sum, k) { return sum + ofcTries[k]; }, 0);
  }
  function ofcRenderTries() {
    $('ofcPosts').querySelectorAll('[data-tries-for]').forEach(function (span) {
      var n = ofcTries[span.dataset.triesFor] || 0;
      span.textContent = ' (' + n + (n === 1 ? ' try' : ' tries') + ')';
    });
  }

  function ofcStep() {
    var posts = ofcChosen();
    if (!posts.length) { ofcStop('None of the ticked posts are on this page.'); return; }
    var value = posts[ofc.idx % posts.length];
    ofc.idx++;
    var opt = ofcOptions().filter(function (o) { return o.value === value; })[0];
    var name = opt ? opt.textContent.trim() : value;
    var ok = ofcSelect(value);
    ofc.last = name + ' at ' + new Date().toLocaleTimeString();
    if (!ok) VSG.storage.logHealth('warn', 'OFC Post: could not select ' + name + '.');
    ofcTries[value] = (ofcTries[value] || 0) + 1;
    chrome.storage.local.set({ ofcTries: ofcTries }); // fire-and-forget; last write wins
    ofcRenderTries();
    ofc.lastStepAt = Date.now();
    var lsKey = {};
    lsKey[OFC_LAST_STEP_KEY] = ofc.lastStepAt;
    chrome.storage.local.set(lsKey); // fire-and-forget; lets a reload mid-countdown resume instead of re-stepping
    ofcRollJitter();
    ofc.remaining = ofcTargetSec();
    ofcStatus();
  }

  // Re-evaluated every second rather than just counting a fixed number down,
  // so stepping into (or out of) a burst window — or a backoff level change
  // below — takes effect immediately, not only once whatever interval was
  // already in progress finishes.
  function ofcTick() {
    var ps = currentPageState();

    // Two states where clicking the dropdown again is pointless — it would
    // just be more automated requests against a page that isn't going to
    // respond normally, which helps nothing and only adds to rate-limit
    // risk. Pause instead of stepping, and recover automatically once the
    // condition clears, same as the rest of this extension already does.
    if (ps === 'CHALLENGE') {
      if (ofc.pausedFor !== 'challenge') {
        ofc.pausedFor = 'challenge';
        VSG.storage.logHealth('warn', 'OFC rotation paused — human-verification check on screen. ' +
          'This cannot be solved automatically; resumes on its own once you clear it.');
      }
      ofcStatus();
      return;
    }
    if (ps === 'SESSION_EXPIRED' || ps === 'LOGGED_OUT') {
      if (ofc.pausedFor !== 'session') {
        ofc.pausedFor = 'session';
        var canAuto = hasCreds(settings) && settings.quickLogin.autoSignIn !== false;
        VSG.storage.logHealth('warn', 'OFC rotation paused — session expired. ' +
          (canAuto ? 'Attempting automatic sign-in.' : 'No saved auto-login — sign in manually to resume.'));
      }
      ofcMaybeRelogin();
      ofcStatus();
      return;
    }
    if (ofc.pausedFor) {
      VSG.storage.logHealth('ok', 'OFC rotation resumed.');
      ofc.pausedFor = '';
    }

    if (ps === 'RATE_LIMITED' || ps === 'QUEUE') ofcSetLevel(VSG.scheduler.nextLevel(ofc.level, ps));
    else if (ps === 'READY_CALENDAR') ofcSetLevel(VSG.scheduler.nextLevel(ofc.level, 'OK'));
    var targetSec = ofcTargetSec();
    var elapsed = (Date.now() - ofc.lastStepAt) / 1000;
    if (elapsed >= targetSec) { ofcStep(); return; }
    ofc.remaining = Math.max(0, Math.ceil(targetSec - elapsed));
    ofcStatus();
  }

  // Bounded retry, not a tight loop: doLogin() already guards itself
  // against rapid repeats, this just keeps the OFC loop from even trying
  // more than once a minute while paused.
  function ofcMaybeRelogin() {
    if (ofcRelogging || blocked) return;
    if (Date.now() - ofc.lastReloginAttemptAt < OFC_RELOGIN_COOLDOWN_MS) return;
    if (!hasCreds(settings) || settings.quickLogin.autoSignIn === false) return; // no creds: a human has to do this
    ofc.lastReloginAttemptAt = Date.now();
    ofcRelogging = true;
    doLogin(true)
      .then(function (r) {
        VSG.storage.logHealth(r && r.ok ? 'ok' : 'warn', 'OFC rotation auto re-login: ' + ((r && r.reason) || (r && r.ok ? 'ok' : 'no response')));
      })
      .catch(function () {})
      .finally(function () { ofcRelogging = false; });
  }

  // resumeLastStepAt: pass the persisted OFC_LAST_STEP_KEY when resuming
  // after a (re)load, so a step that's still within its interval picks the
  // countdown back up instead of firing again right away. Omitted (a plain
  // manual Start) always steps immediately, as before.
  function ofcRun(resumeLastStepAt) {
    if (ofc.timer) clearInterval(ofc.timer);
    ofc.running = true;
    ofcRollJitter();
    var targetSec = ofcTargetSec();
    var sinceLastStep = resumeLastStepAt ? (Date.now() - resumeLastStepAt) / 1000 : null;
    if (sinceLastStep != null && sinceLastStep < targetSec) {
      ofc.lastStepAt = resumeLastStepAt;
      ofc.remaining = Math.max(0, Math.ceil(targetSec - sinceLastStep));
      ofcStatus();
    } else {
      ofcStep(); // select straight away, then on the (possibly bursty) interval
    }
    ofc.timer = setInterval(ofcTick, 1000);
  }

  async function ofcStop(msg) {
    if (ofc.timer) clearInterval(ofc.timer);
    ofc.timer = null;
    ofc.running = false;
    await send({ type: 'VSG_SAVE', patch: { ofcRunning: false } });
    ofcStatus();
    if (msg) say(msg, 'err');
  }

  // Read the panel's form; returns a settings patch or an error string.
  function ofcReadForm() {
    var posts = [];
    $('ofcPosts').querySelectorAll('input[type=checkbox]').forEach(function (c) { if (c.checked) posts.push(c.value); });
    if (!posts.length) return 'Tick at least one OFC Post.';
    var sec = Math.round(Number($('ofcEvery').value) * Number($('ofcUnit').value));
    if (!(sec >= OFC_MIN_SEC && sec <= OFC_MAX_SEC)) return 'Pick an interval between 5 seconds and 10 minutes.';
    return { ofcPosts: posts, ofcIntervalSec: sec };
  }

  function ofcTicked() {
    var posts = [];
    $('ofcPosts').querySelectorAll('input[type=checkbox]').forEach(function (c) { if (c.checked) posts.push(c.value); });
    return posts;
  }

  function ofcNames(values) {
    var opts = ofcOptions();
    return values.map(function (v) {
      var o = opts.filter(function (x) { return x.value === v; })[0];
      return o ? o.textContent.trim() : v;
    });
  }

  // A checkbox changed: save the rotation straight away. A running rotation
  // picks it up on its next step; unticking everything stops it.
  async function ofcTicksChanged() {
    var posts = ofcTicked();
    ofc.lastPosts = JSON.stringify(posts);
    await send({ type: 'VSG_SAVE', patch: { ofcPosts: posts } });
    await refresh();
    if (!posts.length) {
      if (ofc.running) await ofcStop('No posts ticked, so the rotation stopped.');
      return;
    }
    say('Rotating: ' + ofcNames(posts).join(', ') + '.', 'ok');
    ofcStatus();
  }

  // Ticks changed elsewhere (the toolbar popup) → reflect them here.
  function ofcSyncTicks() {
    if ($('ofcBox').classList.contains('hidden')) return;
    var now = JSON.stringify(settings.ofcPosts || []);
    if (now === ofc.lastPosts) return;
    ofc.lastPosts = now;
    $('ofcPosts').querySelectorAll('input[type=checkbox]').forEach(function (c) {
      c.checked = (settings.ofcPosts || []).indexOf(c.value) !== -1;
    });
    ofcStatus();
  }

  function ofcBuildForm() {
    ofc.lastPosts = JSON.stringify(settings.ofcPosts || []);
    var chosen = settings.ofcPosts && settings.ofcPosts.length ? settings.ofcPosts : (settings.consulate ? [settings.consulate] : []);
    var box = $('ofcPosts');
    box.innerHTML = '';
    ofcOptions().forEach(function (o) {
      var lab = document.createElement('label');
      lab.className = 'c';
      var c = document.createElement('input');
      c.type = 'checkbox';
      c.value = o.value;
      c.checked = chosen.indexOf(o.value) !== -1;
      c.addEventListener('change', ofcTicksChanged);
      lab.appendChild(c);
      lab.appendChild(document.createTextNode(' ' + o.textContent.trim()));
      var tries = document.createElement('span');
      tries.className = 'm';
      tries.dataset.triesFor = o.value;
      lab.appendChild(tries);
      box.appendChild(lab);
    });
    ofcRenderTries();
    burstRender();
    var sec = settings.ofcIntervalSec || 60;
    var useMin = sec >= 60 && sec % 60 === 0;
    $('ofcEvery').value = useMin ? sec / 60 : sec;
    $('ofcUnit').value = useMin ? '60' : '1';
  }

  $('ofcStart').addEventListener('click', async function () {
    if (ofc.running) { await ofcStop(); say('Stopped selecting the OFC Post.'); return; }
    var patch = ofcReadForm();
    if (typeof patch === 'string') return say(patch, 'err');
    patch.ofcRunning = true;
    await send({ type: 'VSG_SAVE', patch: patch });
    await refresh();
    say('Selecting the OFC Post every ' + fmtInterval(patch.ofcIntervalSec) + '.', 'ok');
    ofc.idx = 0;
    ofc.pausedFor = '';
    ofc.lastReloginAttemptAt = 0;
    // A fresh Start begins a new try-count session (resuming after a page
    // reload, below, does not — that's the same session continuing).
    ofcTries = {};
    chrome.storage.local.set({ ofcTries: ofcTries });
    ofcRenderTries();
    ofcRun();
  });

  async function ofcSavePostList() {
    var list = ofcOptions().map(function (o) { return { value: o.value, name: o.textContent.trim() }; });
    if (!list.length || JSON.stringify(list) === JSON.stringify(settings.ofcPostList || [])) return;
    await send({ type: 'VSG_SAVE', patch: { ofcPostList: list, ofcPostListAt: Date.now() } });
    await refresh();
    VSG.storage.logHealth('info', 'Saved ' + list.length + ' OFC posts from the portal.');
  }

  // --- slot found → choose the best time and Submit, no delay --------------
  // Everything from spotting the slots to running the page's submit code is
  // synchronous (no awaits, no timers); saving and alerts happen after.
  var BOOK_GUARD_MS = 20 * 1000; // one submit per 20 s, so a re-render can't double-book
  var lastSubmitAt = 0; // preloaded from storage, so the guard needs no await
  var lastSlotSig = '';

  function onSlotsMaybe() {
    if (blocked) return;
    var t0 = performance.now(); // how long OUR code takes, detect → submit call returning
    var slots = VSG.booking.findSlots();
    if (!slots.length) return;
    // Handle each set of slots once (our own clicks re-render the page too).
    var sig = slots.map(function (x) { return x.dateText + ' ' + x.time + ' ' + x.avail; }).join('|');
    if (sig === lastSlotSig) return;
    lastSlotSig = sig;

    // Stop rotating first: changing the post now would lose the slot.
    // (ofcStop clears the timer synchronously; its save finishes later.)
    if (ofc.running) ofcStop();
    var best = VSG.booking.pickBest(slots, settings.dateFrom, settings.dateTo);
    var opt = ofcSelectEl() && ofcSelectEl().selectedOptions[0];
    var post = (opt && opt.value && opt.textContent.trim()) || '';
    if (!best) {
      $('bookStatus').textContent = slots.length + ' time slot(s) shown, none with availability inside your date range.';
      return;
    }
    var summary = (post ? post + ' ' : '') + best.dateText + ' ' + best.time + ' (' + best.avail + ' available)';

    // Always submit the best slot at once — no toggle, no one has to be
    // watching for this to happen. "Pause monitoring" in the popup is the
    // one switch that stops everything, including this.
    if (Date.now() - lastSubmitAt < BOOK_GUARD_MS) {
      $('bookStatus').textContent = 'Already submitted a few seconds ago, not submitting again.';
      countdown('Just submitted. Another submit is possible in {t}', lastSubmitAt + BOOK_GUARD_MS - Date.now());
      return;
    }
    lastSubmitAt = Date.now();
    VSG.booking.choose(best);
    var r = VSG.booking.submit(best);
    // Our own elapsed time (MutationObserver callback entry → submit() returning).
    // Does NOT include the server round trip the submit triggers — that part
    // happens after this and is the portal's, not the extension's, to speed up.
    var ms = (performance.now() - t0).toFixed(1);

    // After the submit: record, report, alert.
    chrome.storage.local.set({ vsgOfcSubmitAt: lastSubmitAt });
    var how = r.how + (r.injected ? ' (Submit button was missing, added it' + (r.usedFallback ? ' from the known layout' : '') + ')' : r.enabled ? ' (button was disabled, enabled it)' : '');
    $('bookStatus').textContent = (r.ok ? 'Submitted ' : 'Could not submit ') + summary + ' via ' + how + ' — ' + ms + ' ms detect→submit.';
    say((r.ok ? 'Submitted: ' : 'Submit failed: ') + summary, r.ok ? 'ok' : 'err');
    VSG.storage.logHealth(r.ok ? 'ok' : 'error', 'OFC submit ' + summary + ' via ' + how + ' (' + ms + ' ms detect→submit)');
    send({ type: 'VSG_SLOT_FOUND', dates: [best.date || best.dateText], post: post, summary: summary });
  }

  async function watchForSlots() {
    if (blocked) return;
    // Load the remembered Submit button and the double-submit guard first,
    // so the moment slots render nothing has to wait.
    await VSG.booking.preload();
    var g = await chrome.storage.local.get({ vsgOfcSubmitAt: 0 });
    lastSubmitAt = g.vsgOfcSubmitAt;
    // Learn the real Submit button whenever it's on the page.
    var real = VSG.booking.findSubmitButton();
    if (real) VSG.booking.rememberButton(real);
    // React the moment the times table renders (no polling delay).
    // childList alone only catches a slot row being newly INSERTED. This
    // portal already reveals things in-place elsewhere (the Submit button
    // starts disabled and is just re-enabled; calendar days flip
    // redday→greenday by changing a class) — if a time-slot row renders the
    // same way (present but disabled/zero, then just toggled), childList
    // would never fire again and we'd sit there having silently missed it.
    // Watch attribute and text changes too so a reveal can't slip past.
    slotsObserver = new MutationObserver(onSlotsMaybe);
    slotsObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'class', 'data-slots', 'value'],
      characterData: true,
    });
    onSlotsMaybe();
  }

  async function setupOfc() {
    if (blocked || !isOfcPage()) return;
    if (!(await waitFor(function () { return ofcOptions().length ? ofcSelectEl() : null; }, 10000))) return;
    $('ofcBox').classList.remove('hidden');
    setCollapsed(false);
    await ofcSavePostList();
    var g = await chrome.storage.local.get({ ofcTries: {} });
    ofcTries = g.ofcTries || {};
    ofcBuildForm();
    await burstDraftLoad();
    await ofcLoadLevel();
    ofcStatus();
    await watchForSlots();
    if (settings.ofcRunning && ofcChosen().length) {
      say('Resuming OFC Post auto-select every ' + fmtInterval(settings.ofcIntervalSec) + '.', 'ok');
      var lsKeyReq = {};
      lsKeyReq[OFC_LAST_STEP_KEY] = 0;
      var lastStep = (await chrome.storage.local.get(lsKeyReq))[OFC_LAST_STEP_KEY];
      ofcRun(lastStep || null);
    }
  }

  (async function init() {
    await refresh();
    loadMyIp(); // fire-and-forget; re-renders once it resolves
    var ui = await chrome.storage.local.get({ vsgPanelCollapsed: false, vsgPendingLogin: 0, vsgLastSignInLinkAt: 0 });
    setCollapsed(ui.vsgPanelCollapsed);
    // A previous reset left us BLOCKED (persists across page loads/reloads):
    // stay stopped until the user explicitly unpauses in the toolbar popup.
    if (settings.sessionState === 'BLOCKED') { panelStopAll('(still blocked from an earlier check)'); return; }
    setupOfc();
    if (await maybeOpenSchedule()) return;
    // B2C builds both the login form and the security questions with its own
    // JS after the page loads — a one-shot synchronous check here can run
    // before either exists yet. Wait once for whichever actually shows up,
    // rather than two separate timeouts stacked one after another (which
    // would needlessly slow down every plain login page waiting out a
    // security-questions timeout it was never going to hit).
    var onB2CHost = /(^|\.)b2clogin\.com$/.test(location.hostname);
    if (onB2CHost && !VSG.login.isLoginPage() && !VSG.login.isSecurityPage()) {
      await waitFor(function () { return VSG.login.isLoginPage() || VSG.login.isSecurityPage(); }, 8000);
    }
    var qs = VSG.login.isSecurityPage() ? VSG.login.findSecurityQuestions() : [];
    if (!savedQA().length && !qs.length) openQAForm();
    // Security questions page: wait until (at least) two questions load.
    if (qs.length) {
      if (qs.length < 2) await VSG.login.waitForSecurityQuestions(3000, 2);
      setCollapsed(false);
      renderSecurity();
      var all = VSG.login.findSecurityQuestions().every(function (x) { return VSG.questions.findAnswer(savedQA(), x.question); });
      if (!all) return say(REASONS['security-questions-need-you']);
      if (settings.quickLogin.autoSignIn !== false) await answerQuestions(true);
      else say('Saved answers match. Click Answer now.');
      return;
    }
    if (!hasCreds(settings)) {
      setCollapsed(false);
      say('Save your login below — or just sign in once on the portal and it is saved for you.');
      return;
    }
    var pending = Date.now() - ui.vsgPendingLogin < PENDING_MS;
    var auto = settings.quickLogin.autoSignIn !== false;
    if (!auto && !pending) return;
    // Sign-in form (or security questions) on this page → fill + submit.
    // A visible Sign In link means this isn't the sign-in page — don't wait long for a form.
    var formWaitMs = VSG.login.findSignInLink() ? 1000 : 8000;
    if (await VSG.login.waitForLoginForm(formWaitMs)) {
      setCollapsed(false);
      await doLogin(!pending); // pending = user just clicked "Log in now": skip the loop guard
      return;
    }
    // Portal page with a Sign In link → open the sign-in page (at most once per 90s).
    if (auto && VSG.login.findSignInLink()) {
      setCollapsed(false);
      var wait = ui.vsgLastSignInLinkAt + SIGNIN_LINK_GUARD_MS - Date.now();
      if (wait > 0) {
        var res = await countdown('Pausing between sign-in attempts. Opening the sign-in page in {t}', wait, { skippable: true });
        if (res === 'cancelled' || !VSG.login.findSignInLink()) return;
      }
      await chrome.storage.local.set({ vsgLastSignInLinkAt: Date.now() });
      await doLogin(false);
    }
  })();
})();
