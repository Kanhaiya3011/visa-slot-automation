/* Session reset trigger — after inactivity the portal says:
 *   "Unable to load appointment available days at this time. Please contact
 *    support with error code PSE0501 ..."  [OK]
 * as a native alert (caught by page-bridge.js) or possibly an HTML dialog
 * (watched for here). Either way, ask the service worker to clear the
 * portal's cookies and restart from the home page, where sign-in, security
 * questions and Schedule Appointment run again by themselves.
 */
(function () {
  if (globalThis.__vsgSessionResetLoaded || window.top !== window) return;
  globalThis.__vsgSessionResetLoaded = true;
  var VSG = (globalThis.VSG = globalThis.VSG || {});

  var SESSION_ERROR = /PSE0501|unable to load appointment available days/i;
  var DIALOG_SEL = '.modal, [role="dialog"], [role="alertdialog"], .ui-dialog, .swal2-popup, .bootbox, .alert';
  var fired = false;

  function trigger(source, msg) {
    if (fired) return;
    fired = true;
    try {
      chrome.runtime.sendMessage({ type: 'VSG_SESSION_RESET', source: source, msg: String(msg || '').slice(0, 300) }, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) { /* extension reloaded */ }
    if (VSG.panelSay) VSG.panelSay('Session expired (PSE0501): clearing cookies and signing in again...', 'err');
  }

  // 1. Native alert, reported by page-bridge.js (MAIN world).
  document.addEventListener('vsg-session-error', function (e) {
    var d = {};
    try { d = JSON.parse(e.detail); } catch (err) { /* ignore */ }
    trigger(d.kind || 'alert', d.msg);
  });
  var early = document.documentElement.getAttribute('data-vsg-session-error');
  if (early) {
    try { trigger('alert', JSON.parse(early).msg); } catch (err) { trigger('alert', early); }
  }

  // 2. HTML dialog with the same text: press its OK, then reset.
  function visible(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function scanDialogs() {
    if (fired) return;
    var els = document.querySelectorAll(DIALOG_SEL);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.closest('#vsg-panel-host') || !visible(el)) continue;
      var t = el.innerText || el.textContent || '';
      if (!SESSION_ERROR.test(t)) continue;
      var ok = Array.prototype.filter.call(el.querySelectorAll('button, input[type="button"], a'), function (b) {
        return /^\s*ok\s*$/i.test(b.innerText || b.value || b.textContent || '');
      })[0];
      if (ok) ok.click();
      trigger('dialog', t.trim());
      return;
    }
  }
  new MutationObserver(scanDialogs).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  scanDialogs();
})();
