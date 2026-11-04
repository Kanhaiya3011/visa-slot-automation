/* Session health state machine — PURE.
 *
 * The whole point of this extension: never leave the user guessing.
 * Every portal condition maps to an explicit state + a concrete action +
 * a human-readable message. States persist in storage so a killed service
 * worker resumes with full context.
 *
 * States: HEALTHY | DEGRADED | NEEDS_USER | PAUSED | BLOCKED
 * Page inputs: READY_CALENDAR | CHALLENGE | QUEUE | RATE_LIMITED |
 *              SESSION_EXPIRED | LOGGED_OUT | ACCESS_BLOCKED | UNKNOWN
 *
 * BLOCKED is unlike the others: the portal's own anti-abuse enforcement
 * flagged this as a Terms-of-use violation, so the only safe response is to
 * stop everything, never retry, and never clear cookies (that would be
 * evading the block). It only clears on an explicit user action.
 */
(function () {
  var VSG = (globalThis.VSG = globalThis.VSG || {});

  var MSG = {
    CHALLENGE:
      'The visa portal is showing a human-verification check. ' +
      'This cannot be solved automatically — open the portal tab and complete the checkbox, ' +
      'then checks resume on their own.',
    RATE_LIMITED:
      'The portal says we are checking too often. Backing off automatically — ' +
      'no action needed, but consider a longer interval in settings.',
    SESSION_EXPIRED:
      'Your portal session expired. Log in again in the portal tab to resume monitoring.',
    LOGGED_OUT:
      'You are logged out of the visa portal. Log in again in the portal tab to resume monitoring.',
    QUEUE:
      'The portal put us in a waiting room. Holding position with slow retries — no action needed.',
    UNKNOWN_REPEATED:
      'The portal page looks unfamiliar several times in a row — the site layout may have changed. ' +
      'Open the portal tab and check manually; an extension update may be needed.',
    ACCESS_BLOCKED:
      'The portal blocked access, saying this looks like a Prohibited Conduct violation of its ' +
      'Terms and conditions — it believes it detected automated use. This is different from a ' +
      'normal error: monitoring has been stopped and will NOT retry or clear cookies automatically, ' +
      'since that would just be working around the block. Review the Terms and conditions page ' +
      '(ustraveldocs.com) and contact the portal\'s support if you believe this is wrong. Untick ' +
      '"Pause monitoring" only once you are sure it is safe to continue.',
    RESUMED: 'Monitoring resumed — the portal is reachable again.',
    RELOGIN_OK: 'Re-login succeeded — monitoring resumed.',
    RELOGIN_FAIL:
      'Automatic re-login did not work (the portal may be asking security questions). ' +
      'Please log in manually in the portal tab.',
  };

  // transition(sessionState, pageState, ctx) -> { state, action, userMessage, logKind }
  // action: 'check' | 'backoff' | 'notify-user' | 'try-relogin' | 'heartbeat'
  function transition(sessionState, pageState, ctx) {
    ctx = ctx || {};
    var unknownStreak = ctx.unknownStreak || 0;
    var quickLoginOn = !!ctx.quickLoginOn;

    switch (pageState) {
      // Anti-abuse enforcement, not a transient error: stop, don't retry.
      case 'ACCESS_BLOCKED':
        return { state: 'BLOCKED', action: 'stop', userMessage: MSG.ACCESS_BLOCKED, logKind: 'error' };

      case 'READY_CALENDAR':
        if (sessionState === 'NEEDS_USER' || sessionState === 'DEGRADED') {
          return { state: 'HEALTHY', action: 'check', userMessage: MSG.RESUMED, logKind: 'ok' };
        }
        return { state: 'HEALTHY', action: 'check', userMessage: null, logKind: 'ok' };

      case 'CHALLENGE':
        return { state: 'NEEDS_USER', action: 'notify-user', userMessage: MSG.CHALLENGE, logKind: 'warn' };

      case 'RATE_LIMITED':
        return { state: 'DEGRADED', action: 'backoff', userMessage: MSG.RATE_LIMITED, logKind: 'warn' };

      case 'QUEUE':
        return { state: 'DEGRADED', action: 'backoff', userMessage: MSG.QUEUE, logKind: 'info' };

      case 'SESSION_EXPIRED':
      case 'LOGGED_OUT': {
        var msg = pageState === 'SESSION_EXPIRED' ? MSG.SESSION_EXPIRED : MSG.LOGGED_OUT;
        if (quickLoginOn) {
          return { state: 'DEGRADED', action: 'try-relogin', userMessage: null, logKind: 'info' };
        }
        return { state: 'NEEDS_USER', action: 'notify-user', userMessage: msg, logKind: 'warn' };
      }

      case 'UNKNOWN':
        if (unknownStreak >= 2) {
          return { state: 'NEEDS_USER', action: 'notify-user', userMessage: MSG.UNKNOWN_REPEATED, logKind: 'error' };
        }
        return { state: sessionState === 'HEALTHY' ? 'HEALTHY' : 'DEGRADED', action: 'backoff', userMessage: null, logKind: 'info' };

      default:
        return { state: sessionState, action: 'backoff', userMessage: null, logKind: 'info' };
    }
  }

  // Outcome of an automatic re-login attempt.
  function reloginOutcome(ok) {
    if (ok) return { state: 'HEALTHY', action: 'check', userMessage: MSG.RELOGIN_OK, logKind: 'ok' };
    return { state: 'NEEDS_USER', action: 'notify-user', userMessage: MSG.RELOGIN_FAIL, logKind: 'warn' };
  }

  VSG.session = { transition: transition, reloginOutcome: reloginOutcome, MSG: MSG };
})();
