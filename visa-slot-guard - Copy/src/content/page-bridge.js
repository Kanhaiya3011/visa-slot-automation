/* Page bridge — runs in the page's own JavaScript world (manifest
 * "world": "MAIN") so it can call the portal's functions, which the
 * extension's isolated content scripts cannot see.
 *
 * Only one request (CustomEvent 'vsg-bridge'): { vsgBridge: 'submit', id, fn, marker }
 *   1. fn is the name of the function the Submit button's onclick calls
 *      (learned by booking.js). If it exists, call it — no delay, no button.
 *   2. Otherwise run the marked button's own handlers directly: its onclick,
 *      then any jQuery click handlers, else a plain click().
 * Replies (CustomEvent 'vsg-bridge-reply') with { id, result: { ok, how } }.
 */
(function () {
  if (window.__vsgBridge) return;
  window.__vsgBridge = true;

  // The portal reports an expired session with a native alert() ("Unable to
  // load appointment available days ... error code PSE0501"). Extensions
  // can't see or dismiss native dialogs, and they freeze the page, so wrap
  // alert/confirm (this file runs before the portal's scripts): swallow that
  // one message and tell the extension instead. Others show as usual.
  var SESSION_ERROR = /PSE0501|unable to load appointment available days/i;
  // Anti-abuse enforcement ("Access limitation ... Prohibited conduct ...").
  // Unlike SESSION_ERROR this is NOT something to recover from: it is only
  // reported, never auto-confirmed as "proceed". Same AND-requirement as
  // detector.js (kept in sync by hand — this file runs in the page's own JS
  // world and can't import that module): "access limitation" must appear
  // together with one of the other two, not either phrase alone, so a
  // dialog that merely mentions "prohibited conduct" in some other context
  // can't be mistaken for the block screen.
  function isAccessBlocked(s) {
    s = s.toLowerCase();
    return s.indexOf('access limitation') !== -1 && (s.indexOf('prohibited conduct') !== -1 || s.indexOf('apparent violation') !== -1);
  }
  function report(attr, event, kind, msg) {
    var detail = JSON.stringify({ kind: kind, msg: String(msg).slice(0, 500) });
    // Attribute too, in case the extension's scripts haven't loaded yet.
    document.documentElement.setAttribute(attr, detail);
    document.dispatchEvent(new CustomEvent(event, { detail: detail }));
  }
  var nativeAlert = window.alert;
  var nativeConfirm = window.confirm;
  window.alert = function (msg) {
    var s = String(msg);
    if (isAccessBlocked(s)) return report('data-vsg-access-blocked', 'vsg-access-blocked', 'alert', msg);
    if (SESSION_ERROR.test(s)) return report('data-vsg-session-error', 'vsg-session-error', 'alert', msg);
    return nativeAlert.apply(this, arguments);
  };
  window.confirm = function (msg) {
    var s = String(msg);
    if (isAccessBlocked(s)) { report('data-vsg-access-blocked', 'vsg-access-blocked', 'confirm', msg); return false; }
    if (SESSION_ERROR.test(s)) { report('data-vsg-session-error', 'vsg-session-error', 'confirm', msg); return true; }
    return nativeConfirm.apply(this, arguments);
  };

  function resolve(path) {
    var obj = window;
    var parts = String(path || '').split('.');
    for (var i = 0; i < parts.length; i++) {
      if (obj == null) return null;
      obj = obj[parts[i]];
    }
    return typeof obj === 'function' ? obj : null;
  }

  function run(req) {
    var el = req.marker ? document.querySelector(req.marker) : null;
    var f = req.fn ? resolve(req.fn) : null;
    if (f) {
      f.call(el || window);
      return { ok: true, how: 'function:' + req.fn };
    }
    if (!el) return { ok: false, how: 'no-button' };
    if (typeof el.onclick === 'function') {
      el.onclick.call(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
      return { ok: true, how: 'onclick' };
    }
    var jq = window.jQuery || window.$;
    if (jq && jq._data) {
      var ev = jq._data(el, 'events');
      if (ev && ev.click && ev.click.length) {
        jq(el).trigger('click');
        return { ok: true, how: 'jquery' };
      }
    }
    el.click();
    return { ok: true, how: 'click' };
  }

  // DOM events are dispatched synchronously across worlds: the request runs
  // and the reply arrives before the caller's dispatchEvent() returns — no
  // timers, no 0 ms task hop. Details travel as JSON strings (objects don't
  // cross worlds).
  document.addEventListener('vsg-bridge', function (e) {
    var req;
    try { req = JSON.parse(e.detail); } catch (err) { return; }
    if (!req || req.vsgBridge !== 'submit') return;
    var result;
    try {
      result = run(req);
    } catch (err) {
      result = { ok: false, how: 'error: ' + String((err && err.message) || err) };
    }
    document.dispatchEvent(new CustomEvent('vsg-bridge-reply', { detail: JSON.stringify({ id: req.id, result: result }) }));
  });
})();
