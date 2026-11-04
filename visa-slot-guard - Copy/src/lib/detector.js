/* Page-state detector — PURE functions over a lightweight snapshot.
 * The content script builds the snapshot from the live DOM; every heuristic
 * lives here so it is unit-testable without a browser.
 *
 * Snapshot: { url, title, bodyText, html }
 * Returns one of:
 *   READY_CALENDAR | CHALLENGE | QUEUE | RATE_LIMITED |
 *   SESSION_EXPIRED | LOGGED_OUT | ACCESS_BLOCKED | UNKNOWN
 *
 * NOTE: usvisascheduling.com changes markup without notice. If the site
 * restyles, READY_CALENDAR detection is the first thing to break — the
 * background worker counts consecutive UNKNOWNs and tells the user to check.
 */
(function () {
  var VSG = (globalThis.VSG = globalThis.VSG || {});

  function norm(s) {
    return (s || '').toLowerCase();
  }
  function hasAny(text, needles) {
    for (var i = 0; i < needles.length; i++) {
      if (text.indexOf(needles[i]) !== -1) return true;
    }
    return false;
  }

  // Markers that strongly suggest the appointment calendar rendered.
  var CALENDAR_MARKERS = [
    'appointment calendar',
    'available dates',
    'select a date',
    'select date and time',
    'calendar',
    'reschedule appointment',
    'schedule appointment',
  ];

  function looksLikeCalendar(snap, body, html) {
    if (hasAny(body, CALENDAR_MARKERS)) return true;
    // data-attribute hooks many date pickers leave behind
    if (html && /data-(available|slot)[-_]date\s*=\s*["'][0-9]{4}-[0-9]{2}-[0-9]{2}["']/i.test(html)) return true;
    return false;
  }

  function detectPageState(snap) {
    snap = snap || {};
    var url = norm(snap.url);
    var title = norm(snap.title);
    var body = norm(snap.bodyText);
    var html = norm(snap.html || '');

    // 0. Access blocked as a suspected Terms-of-use (Prohibited Conduct)
    //    violation — the portal's own anti-abuse enforcement, not a simple
    //    error. Checked first: this is never something to retry or route
    //    around, so it must win over every other classification.
    //
    //    Requires "access limitation" together with one of the other two
    //    phrases, not any single one alone — "prohibited conduct" by itself
    //    could be a clause heading on an ordinary Terms page, not the block
    //    screen. The real block message always leads with "Access
    //    limitation", so pairing it keeps the match specific to that screen.
    if (
      body.indexOf('access limitation') !== -1 &&
      hasAny(body, ['prohibited conduct', 'apparent violation'])
    ) {
      return 'ACCESS_BLOCKED';
    }

    // 1. Bot / human-verification challenge (Cloudflare etc.)
    if (
      title.indexOf('just a moment') !== -1 ||
      hasAny(body, [
        'verifying you are human',
        'verify you are human',
        'cf-challenge',
        'complete the security check',
        'please verify you are a human',
        'attention required',
        'checking your browser before you access',
      ])
    ) {
      return 'CHALLENGE';
    }

    // 2. Waiting room / queue
    if (hasAny(body, ['waiting room', 'you are in a queue', 'your turn is coming', 'estimated wait time'])) {
      return 'QUEUE';
    }

    // 3. Rate limiting
    if (
      hasAny(body, [
        'too many requests',
        'rate limit',
        'ratelimit',
        'please slow down',
        'you have been temporarily blocked',
        'whoa there',
        'try again in a few minutes',
      ]) ||
      title.indexOf('429') !== -1
    ) {
      return 'RATE_LIMITED';
    }

    // 4. Session expired (was logged in, got kicked out)
    if (
      hasAny(body, [
        'session has expired',
        'session timed out',
        'your session is no longer valid',
        'session expired',
        'please log in again',
      ])
    ) {
      return 'SESSION_EXPIRED';
    }

    // 5. Calendar ready — check before LOGGED_OUT so a stray "sign in"
    //    link in the header can't misclassify a live calendar page.
    if (looksLikeCalendar(snap, body, html)) return 'READY_CALENDAR';

    // 6. Logged out (sitting on a login page)
    if (
      url.indexOf('/login') !== -1 ||
      url.indexOf('signin') !== -1 ||
      hasAny(body, ['sign in to your account', 'enter your password to sign in', 'forgot your password']) ||
      (hasAny(body, ['username', 'password']) && hasAny(body, ['sign in', 'log in']) && !looksLikeCalendar(snap, body, html))
    ) {
      return 'LOGGED_OUT';
    }

    return 'UNKNOWN';
  }

  VSG.detector = { detectPageState: detectPageState };
})();
