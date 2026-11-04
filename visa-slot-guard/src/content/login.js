/* Login filler — runs on usvisascheduling.com and its Azure AD B2C sign-in
 * page (atlasauth.b2clogin.com, "SelfAsserted" page):
 *   <form id="attributeVerification">
 *     <input id="signInName"> <input id="password">
 *     <button id="continue" form="attributeVerification">Sign In</button>
 * Fills only what the user saved on this device.
 */
(function () {
  if (globalThis.__vsgLoginLoaded) return;
  globalThis.__vsgLoginLoaded = true;
  var VSG = (globalThis.VSG = globalThis.VSG || {});

  var USER_SEL = ['#signInName', '#email', 'input[name="signInName"]', 'input[name="username"]', '#username', 'input[type="email"]'];
  var PASS_SEL = ['#password', 'input[name="password"]', 'input[type="password"]'];
  var SUBMIT_SEL = ['button#continue', '#next', 'button[form="attributeVerification"]:not(#cancel)',
    'button[type="submit"]:not(#cancel)', 'input[type="submit"]'];
  // B2C error boxes (hidden with display:none until B2C shows them).
  var ERROR_SEL = ['#claimVerificationServerError', '#requiredFieldMissing', '#fieldIncorrect', '.error.pageLevel',
    '.error.itemLevel.show', '.error.itemLevel[aria-hidden="false"]', '.validation-summary-errors', '.alert-danger'];
  var AUTO_GUARD_MS = 90 * 1000; // one automatic attempt per 90s — stops login loops

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function find(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      try {
        var els = document.querySelectorAll(selectors[i]);
        for (var j = 0; j < els.length; j++) if (visible(els[j]) && !els[j].closest('#vsg-panel-host')) return els[j];
      } catch (e) { /* bad selector */ }
    }
    return null;
  }

  function text(el) { return (el.innerText || el.textContent || '').trim(); }

  // Set a value the way typing would: focus, native setter (so frameworks
  // see it), key/input/change events, then a real blur — B2C validates each
  // field on blur and only enables submission once fields pass.
  function setValue(el, value) {
    el.focus();
    el.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    el.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  function findSubmit() {
    var btn = find(SUBMIT_SEL);
    if (btn) return btn;
    var els = document.querySelectorAll('button, input[type="submit"]');
    for (var i = 0; i < els.length; i++) {
      var label = (text(els[i]) || els[i].value || '') + ' ' + (els[i].getAttribute('aria-label') || '');
      if (/\b(sign in|log in|continue)\b/i.test(label) && visible(els[i]) && !els[i].closest('#vsg-panel-host')) return els[i];
    }
    return null;
  }

  // Click like a real mouse: some pages listen for pointer/mouse events.
  async function clickSubmit(btn) {
    for (var i = 0; i < 20 && (btn.disabled || btn.getAttribute('aria-disabled') === 'true'); i++) await wait(150);
    btn.scrollIntoView({ block: 'center' });
    btn.focus();
    var o = { bubbles: true, cancelable: true, view: window, button: 0 };
    if (typeof PointerEvent === 'function') btn.dispatchEvent(new PointerEvent('pointerdown', o));
    btn.dispatchEvent(new MouseEvent('mousedown', o));
    if (typeof PointerEvent === 'function') btn.dispatchEvent(new PointerEvent('pointerup', o));
    btn.dispatchEvent(new MouseEvent('mouseup', o));
    btn.click();
  }

  function pageError() {
    for (var i = 0; i < ERROR_SEL.length; i++) {
      var els = document.querySelectorAll(ERROR_SEL[i]);
      for (var j = 0; j < els.length; j++) {
        if (visible(els[j]) && text(els[j])) return text(els[j]);
      }
    }
    return null;
  }

  // After clicking: did the page move on, show an error, or ignore us?
  // B2C shows a "verifying" overlay, then navigates away on success.
  async function watchOutcome(startUrl, ms, stillHere) {
    var end = Date.now() + ms;
    var hardEnd = Date.now() + 15000;
    while (Date.now() < end && Date.now() < hardEnd) {
      await wait(250);
      if (location.href !== startUrl || !stillHere()) return 'navigated';
      var err = pageError();
      if (err) return 'error:' + err;
      var verifying = document.querySelector('.verifying-modal');
      if (verifying && visible(verifying)) end = Math.max(end, Date.now() + 1500); // still working
    }
    return stillHere() ? 'no-response' : 'navigated';
  }

  function isLoginPage() { return !!(find(PASS_SEL) && find(USER_SEL)) && !isSecurityPage(); }

  // B2C may build its form with JS after load — wait for it.
  function waitForLoginForm(timeoutMs) {
    return new Promise(function (resolve) {
      if (isLoginPage()) return resolve(true);
      var obs = new MutationObserver(function () {
        if (isLoginPage()) { obs.disconnect(); clearTimeout(timer); resolve(true); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      var timer = setTimeout(function () { obs.disconnect(); resolve(isLoginPage()); }, timeoutMs || 10000);
    });
  }

  function findSignInLink() {
    var els = document.querySelectorAll('a, button');
    for (var i = 0; i < els.length; i++) {
      if (/^(sign in|log in|login|sign-in)$/i.test(text(els[i])) && visible(els[i]) && !els[i].closest('#vsg-panel-host')) return els[i];
    }
    return null;
  }

  // --- Security questions (B2C page after sign-in) --------------------------
  // Each question is a read-only paragraph followed by its answer box:
  //   <p class="textInParagraph" id="kbq1ReadOnly" aria-label="What is ...?">
  //   <input id="kba1_response" type="password">
  // The portal shows 2 of the user's 3 questions per sign-in.
  var QUESTION_SEL = 'p.textInParagraph, [id^="kbq"][id$="ReadOnly"]';
  var HUMAN_DELAY_MS = [1000, 1500]; // short pause before answering, like a person reading

  function rand(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

  function answerBoxFor(qEl) {
    var m = /^kbq(\d+)/i.exec(qEl.id || '');
    var byId = m && document.getElementById('kba' + m[1] + '_response');
    if (byId && visible(byId)) return byId;
    // Otherwise: the first editable input after the question in page order.
    var inputs = document.querySelectorAll('input[type="password"], input[type="text"], input:not([type])');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (el.disabled || el.readOnly || !visible(el) || el.closest('#vsg-panel-host')) continue;
      if (qEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) return el;
    }
    return null;
  }

  // [{ question, input }] for every security question visible on the page.
  function findSecurityQuestions() {
    var out = [];
    var seen = [];
    document.querySelectorAll(QUESTION_SEL).forEach(function (qEl) {
      if (!visible(qEl) || qEl.closest('#vsg-panel-host')) return;
      var q = (qEl.getAttribute('aria-label') || text(qEl)).trim();
      if (!q || /^security question/i.test(q)) return;
      var input = answerBoxFor(qEl);
      if (!input || seen.indexOf(input) !== -1) return;
      seen.push(input);
      out.push({ question: q, input: input });
    });
    return out;
  }

  function isSecurityPage() { return findSecurityQuestions().length > 0; }

  // Resolve once at least `min` questions (default 2) have loaded, or with
  // whatever is there when the timeout ends.
  function waitForSecurityQuestions(timeoutMs, min) {
    min = min || 2;
    return new Promise(function (resolve) {
      var done = function () { return findSecurityQuestions().length >= min; };
      if (done()) return resolve(findSecurityQuestions());
      var obs = new MutationObserver(function () {
        if (done()) { obs.disconnect(); clearTimeout(timer); resolve(findSecurityQuestions()); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      var timer = setTimeout(function () { obs.disconnect(); resolve(findSecurityQuestions()); }, timeoutMs || 10000);
    });
  }

  // Type like a person: one character at a time, uneven gaps.
  async function typeHuman(el, value) {
    el.focus();
    el.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '');
    for (var i = 0; i < value.length; i++) {
      var ch = value[i];
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ch }));
      setter.call(el, value.slice(0, i + 1));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch }));
      await wait(rand(25, 60));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    el.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  // Match the shown questions against saved answers; if all match, wait
  // 1-1.5 s, type the answers, and click Continue.
  async function answerSecurityQuestions(saved, opts) {
    opts = opts || {};
    var qs = findSecurityQuestions();
    if (!qs.length) return { ok: false, reason: 'no-security-questions' };
    var missing = [];
    var plan = qs.map(function (item) {
      var hit = VSG.questions.findAnswer(saved, item.question);
      if (!hit) missing.push(item.question);
      return { input: item.input, answer: hit ? hit.a : null };
    });
    if (missing.length) return { ok: false, reason: 'security-questions-need-you', missing: missing };
    if (opts.auto && !(await autoAllowed('vsgLastAutoSecurityAt'))) return { ok: false, reason: 'auto-login-guard' };
    if (opts.auto) await markAuto('vsgLastAutoSecurityAt');

    var delay = opts.delayMs != null ? opts.delayMs : rand(HUMAN_DELAY_MS[0], HUMAN_DELAY_MS[1]);
    if (opts.onWaiting) opts.onWaiting(delay);
    await wait(delay);
    for (var i = 0; i < plan.length; i++) {
      if (!document.contains(plan[i].input)) return { ok: false, reason: 'page-changed' };
      await typeHuman(plan[i].input, plan[i].answer);
      await wait(rand(150, 300));
    }
    if (!opts.submit) return { ok: true, reason: 'security-answers-filled' };
    var btn = findSubmit();
    if (!btn) return { ok: false, reason: 'submit-not-found' };
    var r = await submitAndVerify(btn, isSecurityPage);
    if (r.ok) r.reason = 'security-answers-submitted';
    return r;
  }

  // How long until the next automatic attempt is allowed (0 = now).
  async function autoWaitMs(key) {
    key = key || 'vsgLastAutoLoginAt';
    var q = {};
    q[key] = 0;
    var s = await chrome.storage.local.get(q);
    return Math.max(0, s[key] + AUTO_GUARD_MS - Date.now());
  }

  async function autoAllowed(key) {
    key = key || 'vsgLastAutoLoginAt';
    var q = {};
    q[key] = 0;
    var s = await chrome.storage.local.get(q);
    return Date.now() - s[key] > AUTO_GUARD_MS;
  }

  async function markAuto(key) {
    var o = {};
    o[key || 'vsgLastAutoLoginAt'] = Date.now();
    await chrome.storage.local.set(o);
  }

  // Click the button and confirm it took. If the page ignores the click,
  // submit the form directly as a fallback. stillHere() says whether we are
  // still on the same step (login form / security questions).
  async function submitAndVerify(btn, stillHere) {
    stillHere = stillHere || isLoginPage;
    var startUrl = location.href;
    await clickSubmit(btn);
    var outcome = await watchOutcome(startUrl, 4000, stillHere);
    if (outcome === 'no-response') {
      var form = btn.form || document.getElementById(btn.getAttribute('form') || '') || btn.closest('form');
      if (form && typeof form.requestSubmit === 'function') {
        form.requestSubmit(btn.type === 'submit' ? btn : undefined);
        outcome = await watchOutcome(startUrl, 4000, stillHere);
      }
    }
    if (outcome === 'navigated') return { ok: true, reason: 'submitted' };
    if (outcome.indexOf('error:') === 0) return { ok: false, reason: 'portal-said: ' + outcome.slice(6, 200) };
    return { ok: false, reason: 'clicked-no-response' };
  }

  // opts: { submit: bool, auto: bool }. auto=true respects the loop guard.
  async function fill(creds, opts) {
    opts = opts || {};
    creds = creds || {};

    var err = pageError();
    if (opts.auto && err) return { ok: false, reason: 'portal-said: ' + err.slice(0, 200) };

    if (isSecurityPage()) return answerSecurityQuestions(creds.securityQA || [], opts);

    if (!creds.username || !creds.password) return { ok: false, reason: 'no-saved-credentials' };
    if (!(await waitForLoginForm(opts.waitMs || 8000))) return { ok: false, reason: 'login-form-not-found' };
    if (opts.auto && !(await autoAllowed())) return { ok: false, reason: 'auto-login-guard' };

    setValue(find(USER_SEL), creds.username);
    setValue(find(PASS_SEL), creds.password);
    if (!opts.submit) return { ok: true, reason: 'filled' };

    var btn = findSubmit();
    if (!btn) return { ok: false, reason: 'submit-not-found' };
    if (opts.auto) await markAuto();
    await wait(400); // let B2C finish its per-field validation
    return submitAndVerify(btn);
  }

  // When the user signs in by hand, hand the typed username/password to
  // onCapture so they can be saved for next time. Capture phase, so we see
  // the values before the page's own handlers navigate away.
  function watchTypedCredentials(onCapture) {
    function grab(e) {
      if (e.type === 'keydown' && e.key !== 'Enter') return;
      if (e.type === 'click' && !(e.target.closest && e.target.closest(SUBMIT_SEL.join(',')))) return;
      var u = find(USER_SEL);
      var p = find(PASS_SEL);
      if (u && p && u.value.trim() && p.value) onCapture(u.value.trim(), p.value);
    }
    document.addEventListener('click', grab, true);
    document.addEventListener('submit', grab, true);
    document.addEventListener('keydown', grab, true);
  }

  // When the user answers the security questions by hand, hand the
  // [{ q, a }] they typed to onCapture when Continue is clicked / Enter hit.
  function watchTypedAnswers(onCapture) {
    function grab(e) {
      if (e.type === 'keydown' && e.key !== 'Enter') return;
      if (e.type === 'click' && !(e.target.closest && e.target.closest(SUBMIT_SEL.join(',')))) return;
      var typed = findSecurityQuestions()
        .filter(function (x) { return x.input.value; })
        .map(function (x) { return { q: x.question, a: x.input.value }; });
      if (typed.length) onCapture(typed);
    }
    document.addEventListener('click', grab, true);
    document.addEventListener('submit', grab, true);
    document.addEventListener('keydown', grab, true);
  }

  VSG.login = {
    fill: fill,
    autoWaitMs: autoWaitMs,
    watchTypedCredentials: watchTypedCredentials,
    isLoginPage: isLoginPage,
    waitForLoginForm: waitForLoginForm,
    findSignInLink: findSignInLink,
    pageError: pageError,
    findSecurityQuestions: findSecurityQuestions,
    waitForSecurityQuestions: waitForSecurityQuestions,
    isSecurityPage: isSecurityPage,
    answerSecurityQuestions: answerSecurityQuestions,
    watchTypedAnswers: watchTypedAnswers,
  };
})();
