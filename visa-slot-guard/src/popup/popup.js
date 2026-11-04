/* Popup logic — classic script. Talks to the service worker; never touches
 * chrome.storage directly for writes (the worker owns validation).
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };

  function send(msg) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(msg, function (resp) { resolve(resp || { ok: false }); });
    });
  }

  function fmtTime(t) {
    if (!t) return 'never';
    return new Date(t).toLocaleString();
  }

  var current = null;

  function renderQA(qa) {
    var ul = $('qaList');
    ul.innerHTML = '';
    if (!qa.length) {
      var none = document.createElement('li');
      none.className = 'muted';
      none.textContent = 'None saved yet.';
      ul.appendChild(none);
    }
    qa.forEach(function (e, idx) {
      var li = document.createElement('li');
      li.appendChild(document.createTextNode(e.q + ' '));
      var forget = document.createElement('button');
      forget.className = 'secondary';
      forget.textContent = 'Forget';
      forget.addEventListener('click', async function () {
        var ql = Object.assign({}, current.quickLogin);
        ql.securityQA = (ql.securityQA || []).filter(function (_, i) { return i !== idx; });
        await send({ type: 'VSG_SAVE', patch: { quickLogin: ql } });
        load();
      });
      li.appendChild(forget);
      ul.appendChild(li);
    });
  }

  // Posts come from the portal's OFC Post dropdown (saved by the on-page
  // panel), not a hard-coded list.
  function renderPosts(s) {
    var sel = $('consulate');
    var list = (s.ofcPostList || []).slice();
    if (s.consulate && !list.some(function (p) { return p.value === s.consulate; })) {
      list.push({ value: s.consulate, name: s.consulateName || s.consulate });
    }
    sel.innerHTML = '';
    sel.appendChild(new Option('', ''));
    list.forEach(function (p) { sel.appendChild(new Option(p.name, p.value)); });
    sel.value = s.consulate || '';
    $('postsNote').textContent = (s.ofcPostList || []).length
      ? 'Posts read from the portal on ' + new Date(s.ofcPostListAt).toLocaleDateString() + '.'
      : 'Open the portal\'s Schedule Appointment page once to load the posts.';
  }

  async function renderRotate(s) {
    var list = s.ofcPostList || [];
    $('rotateBox').classList.toggle('hidden', !list.length);
    var box = $('rotateList');
    box.innerHTML = '';
    // Per-post try counts for the current rotation session (reset each time
    // the panel's Start button begins a fresh run). Not part of VSG_GET_STATUS,
    // so read directly — same as the next-check countdown reads chrome.alarms.
    var tries = (await chrome.storage.local.get({ ofcTries: {} })).ofcTries || {};
    list.forEach(function (p) {
      var lab = document.createElement('label');
      lab.className = 'check';
      var c = document.createElement('input');
      c.type = 'checkbox';
      c.value = p.value;
      c.checked = (s.ofcPosts || []).indexOf(p.value) !== -1;
      c.addEventListener('change', function () {
        var posts = [];
        box.querySelectorAll('input[type=checkbox]').forEach(function (x) { if (x.checked) posts.push(x.value); });
        send({ type: 'VSG_SAVE', patch: { ofcPosts: posts } });
      });
      lab.appendChild(c);
      var n = tries[p.value] || 0;
      lab.appendChild(document.createTextNode(' ' + p.name + ' (' + n + (n === 1 ? ' try' : ' tries') + ' this session)'));
      box.appendChild(lab);
    });
  }

  function renderCommunity(s) {
    $('communitySyncEnabled').checked = !!s.communitySyncEnabled;
    var list = $('communityList');
    list.innerHTML = '';
    var sources = s.communitySources || [];
    if (!sources.length) {
      var none = document.createElement('li');
      none.className = 'muted';
      none.textContent = 'No sources added yet.';
      list.appendChild(none);
    }
    sources.forEach(function (src, idx) {
      var li = document.createElement('li');
      var lab = document.createElement('label');
      lab.className = 'check';
      lab.style.display = 'inline';
      var c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = src.enabled !== false;
      c.addEventListener('change', async function () {
        var next = sources.slice();
        next[idx] = Object.assign({}, src, { enabled: c.checked });
        await send({ type: 'VSG_SAVE', patch: { communitySources: next } });
        load();
      });
      lab.appendChild(c);
      lab.appendChild(document.createTextNode(' ' + src.type + ': ' + src.id + ' '));
      li.appendChild(lab);
      var remove = document.createElement('button');
      remove.className = 'secondary';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async function () {
        await send({ type: 'VSG_SAVE', patch: { communitySources: sources.filter(function (_, i) { return i !== idx; }) } });
        load();
      });
      li.appendChild(remove);
      list.appendChild(li);
    });
    var autoWindows = (s.ofcBurstWindows || []).filter(function (w) { return w && w.source === 'auto'; });
    var note = s.communityLastSyncNote || '';
    $('communityStatus').textContent = 'Last sync: ' + fmtTime(s.communityLastSyncAt) +
      (note ? ' — ' + note : '') +
      (autoWindows.length ? ' (' + autoWindows.length + ' active auto window' + (autoWindows.length > 1 ? 's' : '') + ')' : '');
  }

  function renderStatus(s) {
    $('stateBadge').textContent = s.sessionState;
    $('stateBadge').className = 'badge ' + s.sessionState;
    renderPosts(s);
    renderRotate(s);
    // Selectable range: today through 21 months out — matches what the
    // portal realistically offers, and the default dates themselves.
    var rangeMin = VSG.storage.todayISO();
    var rangeMax = VSG.storage.monthsFromTodayISO(21);
    $('dateFrom').min = rangeMin;
    $('dateFrom').max = rangeMax;
    $('dateTo').min = rangeMin;
    $('dateTo').max = rangeMax;
    $('dateFrom').value = s.dateFrom || rangeMin;
    $('dateTo').value = s.dateTo || rangeMax;
    $('intervalMin').value = s.intervalMin;
    $('soundAlert').checked = s.soundAlert;
    $('desktopAlert').checked = s.desktopAlert;
    $('autoReopenTab').checked = s.autoReopenTab;
    $('paused').checked = s.paused;
    $('blockedNote').classList.toggle('hidden', s.sessionState !== 'BLOCKED');
    $('autoResetSession').checked = s.autoResetSession !== false;
    $('resetKeepCloudflare').checked = s.resetKeepCloudflare !== false;
    $('qlEnabled').checked = s.quickLogin.autoSignIn;
    $('qlFields').classList.remove('hidden');
    $('qlUser').value = s.quickLogin.username || '';
    $('qlPass').value = s.quickLogin.password || '';
    current = s;
    renderQA(s.quickLogin.securityQA || []);
    renderCommunity(s);
    $('abEnabled').checked = s.autoBook.enabled;
    $('lastCheck').textContent = fmtTime(s.lastCheckAt);
    $('lastResult').textContent = s.lastResult || '—';
    var log = $('healthLog');
    log.innerHTML = '';
    (s.healthLog || []).slice().reverse().slice(0, 30).forEach(function (e) {
      var li = document.createElement('li');
      li.className = e.kind || 'info';
      var t = document.createElement('span');
      t.className = 't';
      t.textContent = new Date(e.t).toLocaleTimeString();
      li.appendChild(t);
      li.appendChild(document.createTextNode(e.msg));
      log.appendChild(li);
    });
  }

  async function load() {
    var resp = await send({ type: 'VSG_GET_STATUS' });
    if (resp.ok) renderStatus(resp.settings);
  }

  // Informational only — not sent anywhere, just shown to you (e.g. to
  // confirm a VPN/location switch actually took effect).
  async function loadMyIp() {
    try {
      var r = await fetch('https://api.ipify.org?format=json');
      var d = await r.json();
      $('myIp').textContent = 'Browser IP: ' + (d && d.ip ? d.ip : 'unavailable');
    } catch (e) {
      $('myIp').textContent = 'Browser IP: unavailable (offline or request failed)';
    }
  }
  loadMyIp();

  $('save').addEventListener('click', async function () {
    await send({
      type: 'VSG_SAVE',
      patch: {
        consulate: $('consulate').value,
        consulateName: $('consulate').value ? $('consulate').selectedOptions[0].textContent.trim() : '',
        dateFrom: $('dateFrom').value,
        dateTo: $('dateTo').value,
        intervalMin: Number($('intervalMin').value),
        soundAlert: $('soundAlert').checked,
        desktopAlert: $('desktopAlert').checked,
        autoReopenTab: $('autoReopenTab').checked,
        paused: $('paused').checked,
        autoResetSession: $('autoResetSession').checked,
        resetKeepCloudflare: $('resetKeepCloudflare').checked,
        quickLogin: {
          autoSignIn: $('qlEnabled').checked,
          username: $('qlUser').value.trim(),
          password: $('qlPass').value,
          securityQA: (current && current.quickLogin.securityQA) || [],
        },
        autoBook: { enabled: $('abEnabled').checked },
      },
    });
    $('savedMsg').classList.remove('hidden');
    setTimeout(function () { $('savedMsg').classList.add('hidden'); }, 1500);
    load();
  });

  $('checkNow').addEventListener('click', async function () { await send({ type: 'VSG_CHECK_NOW' }); load(); });
  $('testSound').addEventListener('click', function () { send({ type: 'VSG_TEST_SOUND' }); });

  $('communitySyncEnabled').addEventListener('change', async function () {
    await send({ type: 'VSG_SAVE', patch: { communitySyncEnabled: $('communitySyncEnabled').checked } });
    load();
  });
  $('communityAdd').addEventListener('click', async function () {
    var id = $('communityId').value.trim();
    if (!id) return;
    var sources = ((current && current.communitySources) || []).concat([{ type: $('communityType').value, id: id, enabled: true }]);
    await send({ type: 'VSG_SAVE', patch: { communitySources: sources } });
    $('communityId').value = '';
    load();
  });
  $('communitySyncNow').addEventListener('click', async function () {
    $('communitySyncNow').disabled = true;
    $('communityStatus').textContent = 'Syncing…';
    await send({ type: 'VSG_COMMUNITY_SYNC_NOW' });
    await load();
    $('communitySyncNow').disabled = false;
  });

  // Live countdown to the next scheduled slot check.
  function tickNextCheck() {
    if (!chrome.alarms) return;
    chrome.alarms.get('vsg-check', function (a) {
      var el = $('nextCheck');
      if (current && current.paused) { el.textContent = 'paused'; return; }
      if (!a) { el.textContent = '—'; return; }
      var s = Math.max(0, Math.round((a.scheduledTime - Date.now()) / 1000));
      el.textContent = s >= 3600 ? Math.floor(s / 3600) + ':' + ('0' + Math.floor((s % 3600) / 60)).slice(-2) + ':' + ('0' + (s % 60)).slice(-2)
        : Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
    });
  }
  tickNextCheck();
  setInterval(tickNextCheck, 1000);

  load();
})();
