/* Service worker — the orchestrator.
 * MV3 workers die constantly; ALL state lives in chrome.storage.local and
 * every alarm re-derives what to do. Nothing here assumes "I ran 5 min ago".
 */
importScripts(
  '/src/lib/storage.js',
  '/src/lib/detector.js',
  '/src/lib/availability.js',
  '/src/lib/scheduler.js',
  '/src/lib/session.js',
  '/src/lib/notify.js',
  '/src/lib/community.js'
);

var ALARM = 'vsg-check';
var COMMUNITY_ALARM = 'vsg-community-sync';
var PORTAL_RE = /^https:\/\/([^/]*\.usvisascheduling\.com|atlasauth\.b2clogin\.com)\//;
var PORTAL_URLS = ['https://*.usvisascheduling.com/*', 'https://atlasauth.b2clogin.com/*'];

function sendToTab(tabId, msg, timeoutMs) {
  return new Promise(function (resolve) {
    var done = false;
    var timer = setTimeout(function () {
      if (!done) { done = true; resolve({ ok: false, error: 'timeout' }); }
    }, timeoutMs || 20000);
    chrome.tabs.sendMessage(tabId, msg, function (resp) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(resp || { ok: false, error: 'empty-response' });
    });
  });
}

var CONTENT_FILES = [
  'src/lib/storage.js',
  'src/lib/detector.js',
  'src/lib/availability.js',
  'src/lib/notify.js',
  'src/lib/questions.js',
  'src/lib/scheduler.js',
  'src/content/login.js',
  'src/content/portal.js',
  'src/content/booking.js',
  'src/content/session-reset.js',
  'src/lib/burst.js',
  'src/content/panel.js',
  'src/content/access-block.js',
];

// Tabs opened before the extension was installed/reloaded have no content
// script. Inject it on demand instead of failing every probe.
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tabId }, files: CONTENT_FILES });
    return true;
  } catch (e) {
    return false;
  }
}

async function probe(tabId, timeoutMs) {
  var resp = await sendToTab(tabId, { type: 'VSG_PROBE' }, timeoutMs);
  if (!resp.ok && /receiving end|could not establish/i.test(resp.error || '')) {
    // Retry even if injection reported an error: portal.js may have loaded
    // before a later file (e.g. the panel) threw.
    await ensureContentScript(tabId);
    resp = await sendToTab(tabId, { type: 'VSG_PROBE' }, timeoutMs);
  }
  return resp;
}

// Keep exactly one pending check unless paused. Alarms can be lost (paused
// run returns early, browser restart), so every entry point calls this.
async function ensureAlarm() {
  var settings = await VSG.storage.getSettings();
  if (settings.paused) {
    await chrome.alarms.clear(ALARM);
    // Keep the BLOCKED badge (not the generic PAUSED one) until the user
    // explicitly unpauses — this pause was the portal's enforcement action,
    // not a routine one.
    await setBadge(settings.sessionState === 'BLOCKED' ? 'BLOCKED' : 'PAUSED');
    return;
  }
  var existing = await chrome.alarms.get(ALARM);
  if (!existing) await scheduleNext(settings.intervalMin, settings.backoffLevel);
}

async function findPortalTab() {
  var tabs = await chrome.tabs.query({ url: PORTAL_URLS });
  if (!tabs || !tabs.length) return null;
  // Prefer the portal itself over a sign-in tab.
  return tabs.filter(function (t) { return /usvisascheduling\.com/.test(t.url || ''); })[0] || tabs[0];
}

async function setBadge(state) {
  var text = { HEALTHY: 'ON', DEGRADED: '~', NEEDS_USER: '!', PAUSED: 'II', BLOCKED: 'X', UNKNOWN: '?' }[state] || '?';
  var color = { HEALTHY: '#2e7d32', DEGRADED: '#f9a825', NEEDS_USER: '#c62828', PAUSED: '#616161', BLOCKED: '#4a0000', UNKNOWN: '#616161' }[state] || '#616161';
  try {
    await chrome.action.setBadgeText({ text: text });
    await chrome.action.setBadgeBackgroundColor({ color: color });
  } catch (e) { /* ignore */ }
}

async function scheduleNext(baseMin, level) {
  var delayMs = VSG.scheduler.computeDelayMs(baseMin, level, 120);
  await chrome.alarms.create(ALARM, { when: Date.now() + delayMs });
}

// --- access blocked (Prohibited Conduct) — stop, never retry, never evade --
// The portal's own anti-abuse enforcement, not a transient error. The only
// safe response is to stop every automatic action and tell the user.
// Specifically does NOT: clear cookies, reload/navigate the tab, retry, or
// attempt re-login — any of those would be working around the block.
async function stopEverything(source, msg) {
  await chrome.alarms.clear(ALARM);
  await VSG.storage.updateSettings({
    paused: true,
    sessionState: 'BLOCKED',
    backoffUntil: 0,
    backoffLevel: 0,
    lastResult: 'blocked',
  });
  await setBadge('BLOCKED');
  await VSG.storage.logHealth('error', 'ACCESS BLOCKED (' + source + '): ' + String(msg || '').slice(0, 300) +
    ' — monitoring stopped. Not retrying or clearing cookies.');
  await VSG.notify.notifyBlocked(VSG.session.MSG.ACCESS_BLOCKED);
}

async function applyTransition(pageState, settings) {
  var t = VSG.session.transition(settings.sessionState, pageState, {
    unknownStreak: settings.consecutiveUnknown,
    quickLoginOn: settings.quickLogin.autoSignIn && !!(settings.quickLogin.username && settings.quickLogin.password),
  });
  var patch = {
    sessionState: t.state,
    consecutiveUnknown: pageState === 'UNKNOWN' ? settings.consecutiveUnknown + 1 : 0,
    lastCheckAt: Date.now(),
  };
  await VSG.storage.updateSettings(patch);
  await VSG.storage.logHealth(t.logKind, (pageState + ' -> ' + t.state) + (t.userMessage ? ' | ' + t.userMessage : ''));
  if (t.action === 'notify-user' && t.userMessage) {
    await VSG.notify.notifyHealth('Visa Slot Guard needs you', t.userMessage);
  }
  return t;
}

async function runCheck(manual) {
  var settings = await VSG.storage.getSettings();
  if (settings.paused && !manual) { await setBadge('PAUSED'); return; }

  if (!manual && settings.backoffUntil > Date.now()) {
    await scheduleNext(settings.intervalMin, settings.backoffLevel);
    return;
  }

  var tab = await findPortalTab();
  if (!tab) {
    await VSG.storage.logHealth('warn', 'No portal tab open — open usvisascheduling.com and log in.');
    if (manual || settings.autoReopenTab) {
      // Gentle: only auto-open when the user opted in; otherwise just tell them.
      if (settings.autoReopenTab) {
        await chrome.tabs.create({ url: 'https://www.usvisascheduling.com/', active: false });
        await VSG.storage.logHealth('info', 'Reopened portal tab (autoReopenTab).');
      } else {
        await VSG.notify.notifyHealth('Visa Slot Guard', 'No visa portal tab is open. Open usvisascheduling.com to resume monitoring.');
      }
    }
    await VSG.storage.updateSettings({ sessionState: 'NEEDS_USER' });
    await setBadge('NEEDS_USER');
    await scheduleNext(settings.intervalMin, settings.backoffLevel);
    return;
  }

  var resp = await probe(tab.id);
  if (!resp.ok) {
    // Content script missing (page still loading?) — soft retry, no drama.
    await VSG.storage.logHealth('info', 'Probe failed (' + resp.error + ') — will retry next round.');
    var lvl = VSG.scheduler.nextLevel(settings.backoffLevel, 'UNKNOWN');
    await VSG.storage.updateSettings({ backoffLevel: lvl, backoffUntil: Date.now() + VSG.scheduler.computeDelayMs(settings.intervalMin, lvl, 120) });
    await scheduleNext(settings.intervalMin, lvl);
    return;
  }

  var pageState = resp.data.pageState;
  var t = await applyTransition(pageState, settings);
  settings = await VSG.storage.getSettings(); // refresh after patch

  if (t.action === 'stop') {
    await stopEverything('scheduled check', t.userMessage);
    return;
  }

  if (t.action === 'try-relogin') {
    var lr = await sendToTab(tab.id, {
      type: 'VSG_TRY_LOGIN',
      creds: {
        username: settings.quickLogin.username,
        password: settings.quickLogin.password,
        securityQA: settings.quickLogin.securityQA || [],
      },
    });
    var rt = VSG.session.reloginOutcome(lr.ok && lr.data && lr.data.ok);
    await VSG.storage.updateSettings({ sessionState: rt.state });
    await VSG.storage.logHealth(rt.logKind, 'auto-relogin: ' + ((lr.data && lr.data.reason) || lr.error || 'unknown'));
    if (rt.userMessage) await VSG.notify.notifyHealth('Visa Slot Guard', rt.userMessage);
    // Re-probe after login attempt.
    resp = await probe(tab.id);
    if (resp.ok) {
      pageState = resp.data.pageState;
      t = await applyTransition(pageState, settings);
      settings = await VSG.storage.getSettings();
    }
  }

  if (pageState === 'READY_CALENDAR') {
    var avail = resp.data.availability;
    var matched = VSG.availability.matchDates(avail.dates, settings.dateFrom, settings.dateTo);
    if (matched.length) {
      await VSG.storage.updateSettings({ lastResult: 'match', backoffLevel: 0, backoffUntil: 0 });
      await VSG.storage.logHealth('ok', 'MATCH: ' + matched.join(', ') + ' (via ' + avail.strategy + ')');
      await VSG.notify.notifyMatch(matched, settings);
      if (settings.autoBook.enabled) {
        var br = await sendToTab(tab.id, { type: 'VSG_AUTOBOOK', dates: matched }, 60000);
        var summary = br.ok && br.data ? JSON.stringify(br.data.log) : 'auto-book error: ' + (br.error || 'unknown');
        await VSG.storage.logHealth(br.ok && br.data && br.data.ok ? 'ok' : 'error', 'auto-book: ' + summary);
        await VSG.notify.notifyHealth('Visa Slot Guard — auto-book', summary.slice(0, 180));
      }
    } else {
      await VSG.storage.updateSettings({ lastResult: 'no-match' });
      await VSG.storage.logHealth('info', 'Checked: no dates in range (' + avail.dates.length + ' total, via ' + avail.strategy + '/' + avail.confidence + ').');
    }
    var okLevel = VSG.scheduler.nextLevel(settings.backoffLevel, 'OK');
    await VSG.storage.updateSettings({ backoffLevel: okLevel, backoffUntil: 0 });
    await scheduleNext(settings.intervalMin, okLevel);
  } else {
    // Degraded paths: back off per failure kind.
    var outcome = pageState === 'RATE_LIMITED' ? 'RATE_LIMITED' : pageState === 'QUEUE' ? 'QUEUE' : pageState === 'CHALLENGE' || pageState === 'SESSION_EXPIRED' || pageState === 'LOGGED_OUT' ? 'CHALLENGE' : 'UNKNOWN';
    var newLevel = VSG.scheduler.nextLevel(settings.backoffLevel, outcome);
    var waitMs = outcome === 'CHALLENGE' ? 15 * 60000 : VSG.scheduler.computeDelayMs(settings.intervalMin, newLevel, 120);
    await VSG.storage.updateSettings({ backoffLevel: newLevel, backoffUntil: Date.now() + waitMs, lastResult: 'degraded' });
    await chrome.alarms.create(ALARM, { when: Date.now() + waitMs });
  }
  await setBadge(settings.sessionState === 'HEALTHY' ? 'HEALTHY' : settings.sessionState);
}

// Watch for the user solving a challenge / logging back in: any portal tab
// update while NEEDS_USER re-probes once.
chrome.tabs.onUpdated.addListener(async function (tabId, info, tab) {
  if (info.status !== 'complete' || !tab.url || !PORTAL_RE.test(tab.url)) return;
  var settings = await VSG.storage.getSettings();
  if (settings.sessionState !== 'NEEDS_USER' || settings.paused) return;
  var resp = await probe(tabId, 10000);
  if (resp.ok && resp.data.pageState === 'READY_CALENDAR') {
    await applyTransition('READY_CALENDAR', settings);
    await setBadge('HEALTHY');
    await VSG.notify.notifyHealth('Visa Slot Guard', VSG.session.MSG.RESUMED);
  }
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === ALARM) {
    runCheck(false).catch(function (e) {
      VSG.storage.logHealth('error', 'check crashed: ' + String((e && e.message) || e));
    });
  } else if (alarm.name === COMMUNITY_ALARM) {
    syncCommunitySources(false).catch(function (e) {
      VSG.storage.logHealth('error', 'community sync crashed: ' + String((e && e.message) || e));
    });
  }
});

chrome.runtime.onInstalled.addListener(async function () {
  await VSG.storage.updateSettings({ sessionState: 'UNKNOWN' });
  await setBadge('UNKNOWN');
  var settings = await VSG.storage.getSettings();
  await ensureCommunityAlarm();
  if (settings.paused) return ensureAlarm();
  await scheduleNext(settings.intervalMin, 0);
});

chrome.runtime.onStartup.addListener(function () { ensureAlarm(); ensureCommunityAlarm(); });

// --- session reset (PSE0501 after inactivity) ------------------------------
// Clear the portal's cookies (and the B2C sign-in's, or it would sign
// straight back into the dead session), then reload the home page: sign-in,
// security questions and Schedule Appointment then run again by themselves.
var RESET_HOME = 'https://www.usvisascheduling.com/en-US/';
var RESET_DOMAINS = ['usvisascheduling.com', 'b2clogin.com'];
// Cloudflare's own cookies aren't part of the login session; clearing them
// means a fresh "verify you are human" check on every reset.
var CLOUDFLARE_COOKIE = /^(cf_clearance|__cf_bm|_cfuvid|__cflb|cf_chl_.*)$/;
var RESET_WINDOW_MS = 10 * 60 * 1000;
var RESET_MAX = 3;

async function clearPortalCookies(keepCloudflare) {
  var removed = 0;
  var kept = 0;
  for (var i = 0; i < RESET_DOMAINS.length; i++) {
    var cookies = await chrome.cookies.getAll({ domain: RESET_DOMAINS[i] });
    for (var j = 0; j < cookies.length; j++) {
      var c = cookies[j];
      if (keepCloudflare && CLOUDFLARE_COOKIE.test(c.name)) { kept++; continue; }
      var host = c.domain.replace(/^\./, '');
      var url = (c.secure ? 'https://' : 'http://') + host + c.path;
      try {
        await chrome.cookies.remove({ url: url, name: c.name, storeId: c.storeId });
        removed++;
      } catch (e) { /* already gone */ }
    }
  }
  return { removed: removed, kept: kept };
}

async function resetSession(tabId, reason) {
  var settings = await VSG.storage.getSettings();
  if (settings.autoResetSession === false) {
    await VSG.storage.logHealth('warn', 'Session expired (' + reason + '); automatic reset is off.');
    await VSG.notify.notifyHealth('Visa Slot Guard', 'Session expired (PSE0501). Sign in again.');
    return { ok: false, reason: 'disabled' };
  }
  var g = await chrome.storage.local.get({ vsgResets: [] });
  var recent = (g.vsgResets || []).filter(function (t) { return Date.now() - t < RESET_WINDOW_MS; });
  if (recent.length >= RESET_MAX) {
    await VSG.storage.logHealth('error', 'Session keeps expiring: ' + RESET_MAX + ' resets in 10 minutes, stopped resetting.');
    await VSG.notify.notifyHealth('Visa Slot Guard needs you', 'The portal keeps failing with PSE0501. Automatic reset paused for a few minutes.');
    return { ok: false, reason: 'too-many-resets' };
  }
  recent.push(Date.now());
  var c = await clearPortalCookies(settings.resetKeepCloudflare !== false);
  // A deliberate restart: lift the sign-in loop guards, and mark the login
  // as requested so the sign-in page submits straight away.
  await chrome.storage.local.set({
    vsgResets: recent,
    vsgLastSignInLinkAt: 0,
    vsgLastAutoLoginAt: 0,
    vsgLastAutoSecurityAt: 0,
    vsgScheduleClicks: [],
    vsgPendingLogin: Date.now(),
  });
  await VSG.storage.updateSettings({ sessionState: 'DEGRADED' });
  await VSG.storage.logHealth('warn', 'Session expired (' + reason + '): cleared ' + c.removed + ' cookies' +
    (c.kept ? ' (kept ' + c.kept + ' Cloudflare)' : '') + ', signing in again.');
  if (tabId != null) await chrome.tabs.update(tabId, { url: RESET_HOME });
  else await chrome.tabs.create({ url: RESET_HOME });
  return { ok: true, removed: c.removed, kept: c.kept };
}

// --- community data sources (opt-in, off by default) -----------------------
// Unverified third-party text (Reddit/Telegram), voted into hour-of-day
// burst windows (VSG.community) and applied automatically to
// ofcBurstWindows. The safety bounds below exist specifically BECAUSE this
// is unverified: a lone post can't create a window (minVotes), at most a
// few windows exist at once (maxWindows), and the interval those windows
// run at is a fixed, modest, non-settable floor. Manually-added windows (no
// source:'auto' tag) are never touched by this.
var COMMUNITY_MIN_VOTES = 2;
var COMMUNITY_MAX_WINDOWS = 4;
var COMMUNITY_AUTO_SEC = 20;
var COMMUNITY_FETCH_TIMEOUT_MS = 15000;
var COMMUNITY_SYNC_PERIOD_MIN = 240; // 4 hours — courteous to reddit.com/t.me too

function fetchWithTimeout(url, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs || COMMUNITY_FETCH_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal, credentials: 'omit' }).finally(function () { clearTimeout(timer); });
}

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
}

// Accept whatever conventional form a person actually types — "r/name",
// "/r/name", or just "name" — and reduce it to the bare name the URL
// builders below add their own prefix to. Typing it the "natural" way
// otherwise builds an invalid URL (e.g. reddit.com/r/r%2Fname/...) that
// fails outright rather than 404ing on a merely-wrong name.
function stripPrefix(id, prefixRe) {
  return String(id || '').trim().replace(prefixRe, '');
}

// Reddit's public .json endpoints need no auth; newest posts, not a search —
// broader coverage, and the vote threshold downstream is what filters noise.
async function fetchRedditTexts(subreddit) {
  var name = stripPrefix(subreddit, /^\/?r\//i);
  var url = 'https://www.reddit.com/r/' + encodeURIComponent(name) + '/new.json?limit=50';
  var resp = await fetchWithTimeout(url);
  if (!resp.ok) throw new Error('reddit ' + resp.status);
  var data = await resp.json();
  var posts = (data && data.data && data.data.children) || [];
  return posts.map(function (p) {
    var d = p.data || {};
    return (d.title || '') + ' ' + (d.selftext || '');
  });
}

// t.me/s/<channel> is Telegram's public, unauthenticated preview page for a
// public channel — server-rendered HTML, no bot token needed.
async function fetchTelegramTexts(channel) {
  var name = stripPrefix(channel, /^@/);
  var url = 'https://t.me/s/' + encodeURIComponent(name);
  var resp = await fetchWithTimeout(url);
  if (!resp.ok) throw new Error('telegram ' + resp.status);
  var html = await resp.text();
  var out = [];
  var re = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  var m;
  while ((m = re.exec(html)) !== null) out.push(decodeHtmlEntities(m[1].replace(/<[^>]+>/g, ' ')));
  return out;
}

async function syncCommunitySources(manual) {
  var settings = await VSG.storage.getSettings();
  if (!manual && !settings.communitySyncEnabled) return { ok: false, reason: 'disabled' };
  var sources = (settings.communitySources || []).filter(function (s) { return s && s.enabled && s.id; });
  if (!sources.length) {
    await VSG.storage.updateSettings({ communityLastSyncAt: Date.now(), communityLastSyncNote: 'No sources configured.' });
    return { ok: true, windows: 0 };
  }

  var texts = [];
  var errors = [];
  for (var i = 0; i < sources.length; i++) {
    var src = sources[i];
    try {
      var got = src.type === 'telegram' ? await fetchTelegramTexts(src.id) : await fetchRedditTexts(src.id);
      texts = texts.concat(got);
    } catch (e) {
      errors.push(src.type + ':' + src.id + ' (' + String((e && e.message) || e) + ')');
    }
  }

  var runs = VSG.community.windowsFromTexts(texts, { minVotes: COMMUNITY_MIN_VOTES, maxWindows: COMMUNITY_MAX_WINDOWS });
  var autoWindows = runs.map(function (r) {
    return { from: 0, to: 59, hourFrom: r.hourFrom, hourTo: r.hourTo, sec: COMMUNITY_AUTO_SEC, source: 'auto', votes: r.votes };
  });
  // Replace only the auto-tagged windows from the last sync — anything the
  // user added by hand (no source:'auto') is never touched by this.
  var kept = (settings.ofcBurstWindows || []).filter(function (w) { return !w || w.source !== 'auto'; });
  var merged = kept.concat(autoWindows);

  var note = texts.length + ' snippet(s) from ' + sources.length + ' source(s)' +
    (errors.length ? '; failed: ' + errors.join(', ') : '') +
    ' → ' + autoWindows.length + ' auto window(s)' +
    (autoWindows.length ? ': ' + autoWindows.map(function (w) { return w.hourFrom + '-' + w.hourTo + 'h (' + w.votes + ' votes)'; }).join(', ') : '.');
  await VSG.storage.updateSettings({ ofcBurstWindows: merged, communityLastSyncAt: Date.now(), communityLastSyncNote: note });
  await VSG.storage.logHealth(errors.length && !texts.length ? 'warn' : 'info', 'Community sync: ' + note);
  return { ok: true, windows: autoWindows.length, note: note };
}

async function ensureCommunityAlarm() {
  var existing = await chrome.alarms.get(COMMUNITY_ALARM);
  if (!existing) await chrome.alarms.create(COMMUNITY_ALARM, { delayInMinutes: 2, periodInMinutes: COMMUNITY_SYNC_PERIOD_MIN });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  (async function () {
    var settings = await VSG.storage.getSettings();
    if (msg.type === 'VSG_GET_STATUS') {
      sendResponse({ ok: true, settings: settings });
    } else if (msg.type === 'VSG_SAVE') {
      var patch = msg.patch || {};
      if (patch.intervalMin != null) {
        patch.intervalMin = Math.max(5, Math.min(120, Number(patch.intervalMin) || 60));
      }
      await VSG.storage.updateSettings(patch);
      await VSG.storage.logHealth('info', 'Settings updated.');
      if (patch.paused === false && settings.paused) {
        await VSG.storage.updateSettings({ sessionState: 'UNKNOWN' });
        await setBadge('UNKNOWN');
      }
      // Interval change or unpause: reschedule from now.
      if (patch.intervalMin != null && patch.intervalMin !== settings.intervalMin) await chrome.alarms.clear(ALARM);
      await ensureAlarm();
      // Newly enabled: don't make the user wait up to 4h for the first sync.
      if (patch.communitySyncEnabled === true && !settings.communitySyncEnabled) {
        syncCommunitySources(true).catch(function (e) {
          VSG.storage.logHealth('error', 'community sync crashed: ' + String((e && e.message) || e));
        });
      }
      sendResponse({ ok: true });
    } else if (msg.type === 'VSG_GET_IP') {
      // Informational only (shown next to "Monitor: ..." in the on-page
      // panel) — not sent anywhere else. Reuses the api.ipify.org
      // permission already granted for the popup's own IP display.
      try {
        var ipResp = await fetchWithTimeout('https://api.ipify.org?format=json', 8000);
        var ipData = await ipResp.json();
        sendResponse({ ok: true, data: { ip: (ipData && ipData.ip) || '' } });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    } else if (msg.type === 'VSG_COMMUNITY_SYNC_NOW') {
      try {
        sendResponse({ ok: true, data: await syncCommunitySources(true) });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    } else if (msg.type === 'VSG_CHECK_NOW') {
      try {
        await runCheck(true);
      } catch (e) {
        await VSG.storage.logHealth('error', 'check crashed: ' + String((e && e.message) || e));
      }
      sendResponse({ ok: true });
    } else if (msg.type === 'VSG_SESSION_RESET') {
      sendResponse(await resetSession(sender.tab && sender.tab.id, msg.source + ': ' + (msg.msg || '').slice(0, 80)));
    } else if (msg.type === 'VSG_ACCESS_BLOCKED') {
      // Reported immediately by the content script — don't wait for the
      // next scheduled check.
      await stopEverything(msg.source || 'page', msg.msg || '');
      sendResponse({ ok: true });
    } else if (msg.type === 'VSG_SLOT_FOUND') {
      await VSG.storage.logHealth('ok', 'SLOT: ' + (msg.summary || ''));
      await VSG.notify.notifyMatch(msg.dates || [], Object.assign({}, settings, { consulateName: msg.post || settings.consulateName }));
      sendResponse({ ok: true });
    } else if (msg.type === 'VSG_TEST_SOUND') {
      VSG.notify.playSound();
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: 'unknown' });
    }
  })();
  return true;
});
