/* Storage layer — everything stays on this device (chrome.storage.local).
 * No analytics, no remote sync, no credential exfiltration. Ever.
 * Classic script: attaches to the shared VSG namespace.
 */
(function () {
  var VSG = (globalThis.VSG = globalThis.VSG || {});

  var DEFAULTS = {
    paused: false,
    consulate: '', // portal post id (option value from the portal's OFC Post dropdown)
    consulateName: '', // human label, e.g. 'MUMBAI VAC'
    dateFrom: '', // ISO yyyy-mm-dd — real default is computed fresh in getSettings() (today)
    dateTo: '', // ISO yyyy-mm-dd — real default is computed fresh in getSettings() (today + 21 months)
    intervalMin: 60, // 5..120
    soundAlert: true,
    desktopAlert: true,
    // autoSignIn: sign in as soon as the page loads. securityQA: [{ q, a }],
    // up to 3 saved security questions with answers.
    quickLogin: { autoSignIn: true, username: '', password: '', securityQA: [] },
    autoBook: { enabled: false }, // opt-in: auto-select slot + submit
    autoReopenTab: false, // opt-in: reopen portal tab if user closed it
    autoOpenSchedule: true, // on the portal home page, click "Schedule Appointment" after 2 s
    // ofc-schedule page: re-select the OFC Post dropdown every ofcIntervalSec
    // (5..600), rotating through ofcPosts (option values). Survives reloads.
    ofcPosts: [],
    // OFC posts read from the portal's dropdown: [{ value, name }]. Refreshed
    // whenever the ofc-schedule page is opened; they rarely change.
    ofcPostList: [],
    ofcPostListAt: 0,
    ofcIntervalSec: 60,
    // Burst windows: [{ from, to, sec }] minute-of-hour ranges (0..59,
    // inclusive; `to` < `from` wraps past the hour) where the interval
    // drops to `sec` instead of ofcIntervalSec — e.g. right around when
    // slots are known to be released each hour.
    ofcBurstWindows: [],
    ofcRunning: false,
    autoResetSession: true, // PSE0501 after inactivity: clear cookies, sign in again
    resetKeepCloudflare: true, // ...but keep Cloudflare's cookies (avoids a new human check)
    healthLog: [], // [{t, kind, msg}] newest last, capped
    lastCheckAt: 0,
    lastResult: null, // 'match' | 'no-match' | 'degraded' | null
    backoffUntil: 0,
    backoffLevel: 0,
    sessionState: 'UNKNOWN', // HEALTHY | DEGRADED | NEEDS_USER | PAUSED
    consecutiveUnknown: 0,
  };

  function hasChrome() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function toISODate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayISO() { return toISODate(new Date()); }
  function monthsFromTodayISO(months) {
    var d = new Date();
    d.setMonth(d.getMonth() + months);
    return toISODate(d);
  }

  // The default date range — today through 21 months out — computed fresh
  // on every call, not baked into the static DEFAULTS above, so it's always
  // "today" even if this script keeps running for a while. Once the user
  // saves any dateFrom/dateTo (even unchanged from this default), that
  // stored value wins from then on.
  function defaultsWithDates() {
    return Object.assign({}, DEFAULTS, { dateFrom: todayISO(), dateTo: monthsFromTodayISO(21) });
  }

  async function getSettings() {
    var defaults = defaultsWithDates();
    if (!hasChrome()) return defaults;
    var s = await chrome.storage.local.get(defaults);
    // deep-merge nested objects so new default keys appear after upgrades
    s.quickLogin = Object.assign({}, DEFAULTS.quickLogin, s.quickLogin);
    delete s.quickLogin.enabled; // pre-1.2 key, replaced by autoSignIn
    delete s.quickLogin.answers; // pre-1.3 keyword list, replaced by securityQA
    s.autoBook = Object.assign({}, DEFAULTS.autoBook, s.autoBook);
    return s;
  }

  async function updateSettings(patch) {
    if (!hasChrome()) return;
    await chrome.storage.local.set(patch);
  }

  var MAX_LOG = 60;
  async function logHealth(kind, msg) {
    var entry = { t: Date.now(), kind: kind, msg: String(msg).slice(0, 300) };
    if (!hasChrome()) return entry;
    var s = await chrome.storage.local.get({ healthLog: [] });
    var log = s.healthLog || [];
    log.push(entry);
    while (log.length > MAX_LOG) log.shift();
    await chrome.storage.local.set({ healthLog: log });
    return entry;
  }

  VSG.storage = {
    DEFAULTS: DEFAULTS,
    getSettings: getSettings,
    updateSettings: updateSettings,
    logHealth: logHealth,
    todayISO: todayISO,
    monthsFromTodayISO: monthsFromTodayISO,
  };
})();
