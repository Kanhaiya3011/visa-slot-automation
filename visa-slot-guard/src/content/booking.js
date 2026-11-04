/* OFC booking — on usvisascheduling.com/en-US/ofc-schedule/ once a date's
 * time slots show:
 *   Date (MM/DD/YYYY) | Time | Availability      (one radio per row)
 * pick the slot with the most availability (within the user's date range)
 * and submit at once.
 *
 * The Submit button runs a page JavaScript function. Content scripts can't
 * call page functions, so page-bridge.js (MAIN world) does it on request.
 * Whenever the real button is on the page we remember what it looks like and
 * which function its onclick calls, so a page that renders the times
 * without a Submit button can still be submitted: by calling that function
 * directly, or by recreating the button and clicking it.
 */
(function () {
  if (globalThis.__vsgBookingLoaded) return;
  globalThis.__vsgBookingLoaded = true;
  var VSG = (globalThis.VSG = globalThis.VSG || {});

  var TEMPLATE_KEY = 'vsgOfcSubmitTemplate';

  function text(el) { return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(); }

  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function mine(el) { return !!el.closest('#vsg-panel-host'); }

  // MM/DD/YYYY → YYYY-MM-DD
  function isoDate(s) {
    var m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || '');
    if (!m) return null;
    return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  }

  // Column positions from the header row ("Date", "Time", "Availability").
  function columns(table) {
    var cols = { date: -1, time: -1, avail: -1 };
    var head = table.querySelector('thead tr') || table.querySelector('tr');
    if (!head) return cols;
    Array.prototype.forEach.call(head.children, function (cell, i) {
      var t = text(cell).toLowerCase();
      if (cols.avail < 0 && /availab/.test(t)) cols.avail = i;
      else if (cols.time < 0 && /^time/.test(t)) cols.time = i;
      else if (cols.date < 0 && /date/.test(t)) cols.date = i;
    });
    return cols;
  }

  // [{ radio, row, date (ISO), dateText, time, avail }]
  function findSlots() {
    var out = [];
    document.querySelectorAll('input[type="radio"]').forEach(function (radio) {
      if (mine(radio) || radio.disabled) return;
      var row = radio.closest('tr');
      var table = row && row.closest('table');
      if (!row || !table) return;
      var cols = columns(table);
      var cells = row.children;
      var cell = function (i) { return i >= 0 && cells[i] ? text(cells[i]) : ''; };
      var rowText = text(row);
      var dateText = cell(cols.date) || (/(\d{1,2}\/\d{1,2}\/\d{4})/.exec(rowText) || [])[1] || '';
      var time = cell(cols.time) || (/\b(\d{1,2}:\d{2})\b/.exec(rowText) || [])[1] || '';
      // The radio itself carries the portal's own count (data-slots="1"),
      // set the instant the element exists — read that first, since it
      // needs no column-header guessing and isn't tied to a text node
      // being populated separately. Falls back to the Availability column.
      var slotsAttr = radio.getAttribute('data-slots');
      var availText = slotsAttr != null ? slotsAttr : (cols.avail >= 0 ? cell(cols.avail) : (rowText.match(/\d+/g) || []).pop());
      var avail = parseInt(availText, 10);
      out.push({ radio: radio, row: row, date: isoDate(dateText), dateText: dateText, time: time, avail: isNaN(avail) ? 0 : avail });
    });
    return out;
  }

  // Most availability wins; ties go to the earliest row. Respects the date range.
  function pickBest(slots, fromISO, toISO) {
    var best = null;
    (slots || []).forEach(function (s) {
      if (s.avail <= 0) return;
      if (s.date && fromISO && s.date < fromISO) return;
      if (s.date && toISO && s.date > toISO) return;
      if (!best || s.avail > best.avail) best = s;
    });
    return best;
  }

  function choose(slot) {
    slot.radio.checked = true;
    slot.radio.click(); // fires the page's own click/change handlers
    slot.radio.dispatchEvent(new Event('change', { bubbles: true }));
  }

  var SUBMIT_TEXT = /^submit$/i;

  function findSubmitButton() {
    var els = document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (mine(el) || el.disabled) continue;
      if (SUBMIT_TEXT.test(text(el) || el.value || '') && visible(el)) return el;
    }
    return null;
  }

  // Same, but also returns a disabled one — the real button on the OFC page
  // starts disabled (style="opacity: 0.5") until a time slot is chosen; we
  // always choose the slot first, so if this finds one it just needs enabling.
  function findDisabledSubmitButton() {
    var els = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (mine(el) || !el.disabled || !visible(el)) continue;
      if (SUBMIT_TEXT.test(text(el) || el.value || '')) return el;
    }
    return null;
  }

  function enableButton(btn) {
    btn.disabled = false;
    btn.removeAttribute('disabled');
    if (btn.style.opacity) btn.style.opacity = '';
    btn.classList.remove('disabled');
  }

  // The first function name an onclick / href calls: "return submitAppt(1)" → "submitAppt"
  function functionName(code) {
    var m = /(?:^|[;\s:(])(?!return\b|javascript\b|void\b)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/.exec(' ' + (code || ''));
    return m ? m[1] : '';
  }

  // Known-good fallback: the OFC page's real Submit control, from
  //   <input type="submit" id="submitbtn" class="btn-atlas btn-atlas-submit
  //    pull-right" value="Submit" onclick="onClickSubmit();" disabled>
  // inside <div class="col-sm-12 mt-3">. Used only when nothing has ever
  // been learned from a real button on this page (see rememberButton) — a
  // real button, when present, always wins and updates the learned one.
  // The Manage Dependents link in that block is deliberately NOT recreated:
  // it navigates away from the booking flow, which would do more harm than
  // a missing button.
  var DEFAULT_TEMPLATE = {
    tag: 'input',
    id: 'submitbtn',
    className: 'btn-atlas btn-atlas-submit pull-right',
    type: 'submit',
    form: '',
    name: '',
    onclick: 'onClickSubmit();',
    href: '',
    fn: 'onClickSubmit',
    parentId: '',
    containerClass: 'col-sm-12 mt-3',
  };

  var cachedTemplate = null; // loaded ahead of time, so submit() never waits on storage

  function describeButton(btn) {
    var onclick = btn.getAttribute('onclick') || '';
    var href = btn.getAttribute('href') || '';
    return {
      tag: btn.tagName.toLowerCase(),
      id: btn.id || '',
      className: btn.className || '',
      type: btn.getAttribute('type') || '',
      form: btn.getAttribute('form') || '',
      name: btn.getAttribute('name') || '',
      onclick: onclick,
      href: /^javascript:/i.test(href) ? href : '',
      fn: functionName(onclick) || functionName(href.replace(/^javascript:/i, '')),
      parentId: (btn.parentElement && btn.parentElement.id) || '',
    };
  }

  // Remember the real button (attributes + handler function) for later pages.
  async function rememberButton(btn) {
    var tpl = describeButton(btn);
    if (JSON.stringify(cachedTemplate) !== JSON.stringify(tpl)) {
      cachedTemplate = tpl;
      var o = {};
      o[TEMPLATE_KEY] = tpl;
      await chrome.storage.local.set(o);
    }
    return tpl;
  }

  // Load the remembered button before any slot shows up.
  async function preload() {
    var s = await chrome.storage.local.get({ vsgOfcSubmitTemplate: null });
    if (!cachedTemplate) cachedTemplate = s[TEMPLATE_KEY];
    return cachedTemplate;
  }

  // Recreate the Submit button (same id/class/onclick as the real one, so the
  // page's own handlers — inline or delegated — treat it as theirs). Never
  // disabled: we only ever inject after a slot has already been chosen, so
  // there is nothing left to wait for.
  function injectButton(tpl, slot) {
    tpl = tpl || DEFAULT_TEMPLATE;
    var btn = document.createElement(tpl.tag === 'input' || tpl.tag === 'a' ? tpl.tag : 'button');
    if (tpl.id) btn.id = tpl.id;
    btn.className = tpl.className || 'btn btn-primary';
    if (btn.tagName === 'INPUT') { btn.type = tpl.type || 'button'; btn.value = 'Submit'; } else btn.textContent = 'Submit';
    if (btn.tagName === 'BUTTON') btn.type = tpl.type || 'button';
    if (tpl.form) btn.setAttribute('form', tpl.form);
    if (tpl.name) btn.setAttribute('name', tpl.name);
    if (tpl.onclick) btn.setAttribute('onclick', tpl.onclick);
    if (tpl.href) btn.setAttribute('href', tpl.href);
    btn.setAttribute('data-vsg-injected', '1');

    var existingParent = tpl.parentId && document.getElementById(tpl.parentId);
    if (existingParent) {
      existingParent.appendChild(btn);
      return btn;
    }
    // No known real container to drop it in: wrap it the way the real
    // markup does (e.g. <div class="col-sm-12 mt-3">), for correct spacing,
    // and place that after the times table.
    var node = btn;
    if (tpl.containerClass) {
      var wrap = document.createElement('div');
      wrap.className = tpl.containerClass;
      wrap.appendChild(btn);
      node = wrap;
    }
    var table = slot && slot.row.closest('table');
    var anchor = table || document.body;
    anchor.parentNode.insertBefore(node, anchor.nextSibling);
    return btn;
  }

  // Ask page-bridge.js (MAIN world) to run the submit handler right now.
  // Synchronous: dispatchEvent runs the bridge and its reply before it
  // returns, so there is no wait at all. No reply → bridge isn't loaded.
  var seq = 0;
  function callInPage(fn, marker) {
    var id = 'vsg-' + Date.now() + '-' + (++seq);
    var result = null;
    function onReply(e) {
      try {
        var r = JSON.parse(e.detail);
        if (r && r.id === id) result = r.result;
      } catch (err) { /* not ours */ }
    }
    document.addEventListener('vsg-bridge-reply', onReply);
    document.dispatchEvent(new CustomEvent('vsg-bridge', {
      detail: JSON.stringify({ vsgBridge: 'submit', id: id, fn: fn || '', marker: marker || '' }),
    }));
    document.removeEventListener('vsg-bridge-reply', onReply);
    return result || { ok: false, how: 'no-bridge' };
  }

  // Submit with no delay. Order:
  //   1. real button, already enabled
  //   2. real button, still disabled (normal case: it waits for a slot pick
  //      — we always pick the slot first, so just enable it)
  //   3. no button on the page at all (the glitch): recreate one, from what
  //      was last learned from a real button here, or the known-good
  //      fallback markup if nothing has ever been learned.
  // Then: call the page function directly → the button's own handlers → a
  // plain click. Fully synchronous: nothing is awaited between choosing the
  // slot and running the page's submit code.
  function submit(slot) {
    var real = findSubmitButton() || findDisabledSubmitButton();
    var wasDisabled = false;
    if (real && real.disabled) { enableButton(real); wasDisabled = true; }
    var tpl = real ? describeButton(real) : (cachedTemplate || DEFAULT_TEMPLATE);
    var usedFallback = !real && !cachedTemplate;
    var btn = real;
    var injected = false;
    if (!btn) {
      btn = injectButton(tpl, slot);
      injected = true;
    }
    btn.setAttribute('data-vsg-submit', '1');
    var r = callInPage(tpl && tpl.fn, '[data-vsg-submit="1"]');
    if (!r.ok) {
      btn.click(); // bridge unavailable: a click runs the same page handlers
      r = { ok: true, how: 'click' };
    }
    r.injected = injected;
    r.enabled = wasDisabled;
    r.usedFallback = injected && usedFallback;
    r.fn = (tpl && tpl.fn) || '';
    if (real) rememberButton(real); // save for pages without the button (after submitting)
    return r;
  }

  VSG.booking = {
    findSlots: findSlots,
    pickBest: pickBest,
    choose: choose,
    submit: submit,
    findSubmitButton: findSubmitButton,
    findDisabledSubmitButton: findDisabledSubmitButton,
    rememberButton: rememberButton,
    preload: preload,
    DEFAULT_TEMPLATE: DEFAULT_TEMPLATE,
    functionName: functionName,
    isoDate: isoDate,
  };
})();
