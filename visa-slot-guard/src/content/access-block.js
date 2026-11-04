/* Access-block detector — the portal's own anti-abuse enforcement:
 *   "Access limitation. Your attempt to view the calendar section was
 *    blocked due to apparent violation of Prohibited conduct clause..."
 *
 * This is NOT a transient error like PSE0501 (session-reset.js). It means
 * the portal believes it detected automated use and is deliberately
 * refusing access. The only correct response is to stop every automatic
 * action here and tell the user — never clear cookies, never reload, never
 * retry. Doing any of those would be working around the block, not
 * recovering from a glitch.
 */
(function () {
  if (globalThis.__vsgAccessBlockLoaded || window.top !== window) return;
  globalThis.__vsgAccessBlockLoaded = true;
  var VSG = (globalThis.VSG = globalThis.VSG || {});

  var fired = false;

  // Same test as the background's probe (VSG.detector, already loaded by
  // this point) — one definition, so the two can never drift apart.
  function looksBlocked(bodyText) {
    return VSG.detector.detectPageState({ bodyText: bodyText }) === 'ACCESS_BLOCKED';
  }

  function trigger(source, msg) {
    if (fired) return;
    fired = true;
    globalThis.__vsgBlocked = true; // other content scripts can check this
    if (VSG.panelStopAll) VSG.panelStopAll(msg);
    try {
      chrome.runtime.sendMessage({ type: 'VSG_ACCESS_BLOCKED', source: source, msg: String(msg || '').slice(0, 400) }, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) { /* extension reloaded */ }
  }

  // 1. Ordinary page content (the expected case: a page shown in place of
  //    the calendar, not a dialog).
  function scanBody() {
    if (fired || !document.body) return;
    var t = document.body.innerText || document.body.textContent || '';
    if (looksBlocked(t)) trigger('page', t.slice(0, 500));
  }

  // 2. Native alert()/confirm(), reported by page-bridge.js (MAIN world) —
  //    in case the portal ever shows this as a dialog instead.
  document.addEventListener('vsg-access-blocked', function (e) {
    var d = {};
    try { d = JSON.parse(e.detail); } catch (err) { /* ignore */ }
    trigger(d.kind || 'alert', d.msg);
  });
  var early = document.documentElement.getAttribute('data-vsg-access-blocked');
  if (early) {
    try { trigger('alert', JSON.parse(early).msg); } catch (err) { trigger('alert', early); }
  }

  new MutationObserver(scanBody).observe(document.documentElement, { childList: true, subtree: true });
  scanBody();
})();
