# Visa Slot Guard

A resilient US visa appointment slot monitor (Chrome extension, Manifest V3) for `usvisascheduling.com`.

Most slot-checker extensions go quiet the moment the portal fights back — a Cloudflare check, a waiting room, a rate limit, an expired session — and leave you staring at a spinner wondering what happened. **Visa Slot Guard's whole design is the opposite: every portal condition maps to an explicit state, a concrete recovery action, and a plain-language message telling you exactly what happened and what (if anything) you need to do.**

Written from scratch. No code taken from any other slot-checker.

## Features

- On-page panel on usvisascheduling.com and its sign-in page (atlasauth.b2clogin.com)
- Saved login: one-click "Log in now" (stays visible for the whole B2C sign-in flow — username/password, then security questions — hidden only once genuinely back on the portal), or fully automatic sign-in, chained straight from login into security questions even when B2C swaps steps in place without a page reload, and detects security questions that render a moment late on a fresh page load rather than only checking once
- Security questions: save up to 3 answers; the 2 asked per sign-in are matched, typed after a 1–1.5 s pause, and Continue is clicked
- Manual "check now" + timed checks (interval 5–120 min)
- OFC schedule page: re-select one OFC Post, or rotate through several, every 5 s–10 min (posts are read from the portal, not hard-coded)
- Try counter per OFC post, shown in the panel and popup, resetting each time rotation is freshly started
- Burst windows: check far more often during specific minutes of every hour (e.g. 1–5 and 55–1, wrapping across the hour), reverting to the normal interval the rest of the time; reacts the moment the clock enters/leaves a window, not just on the next scheduled step
- When time slots appear: always pick the time with the most availability (within your date range) and Submit immediately — no toggle, nothing to watch for; if the page has no Submit button, call its submit function / recreate the button
- Sound + desktop alerts on a matching date
- Auto-book (auto-select slot + submit), opt-in

Everything is free; there are no tiers or billing.

## Install (developer mode)

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder.
2. Open `usvisascheduling.com` — the Visa Slot Guard panel appears bottom-right.
3. Save your username/password in the panel, then click **Log in now** (or tick auto-login).
4. Click the extension icon → check the date range (defaults to today through 21 months out — the selector won't let you pick outside that window) → Save.

## How monitoring works

1. A `chrome.alarms` timer fires (survives service-worker restarts; all state is in `chrome.storage.local`).
2. The content script snapshots the portal tab and classifies the page: `READY_CALENDAR`, `CHALLENGE`, `QUEUE`, `RATE_LIMITED`, `SESSION_EXPIRED`, `LOGGED_OUT`, `UNKNOWN`.
3. A session state machine (`HEALTHY` / `DEGRADED` / `NEEDS_USER`) decides: check, back off, re-login, or ask you for help — and logs every transition to the popup's Session health feed.
4. On a ready calendar, available dates are extracted (multiple strategies, confidence reported) and matched against your date range. Matches trigger sound + desktop alerts, and optionally auto-book.

## What it fixes — and what it honestly cannot

**Fixed (vs. typical slot checkers):**
- **Silent dropouts are gone.** Cloudflare challenge? You get "human-verification check — open the tab and click the checkbox, checks resume on their own." Rate limited? "Backing off automatically." Every condition has a message; the toolbar badge shows state at a glance (`ON` / `~` / `!` / `II`).
- **Per-failure backoff with jitter.** Rate limits escalate the delay exponentially instead of hammering; successes decay it back.
- **Auto-resume.** Solve the checkbox or log back in, and the extension notices the tab state change and resumes — no need to touch the popup.
- **Opt-in Quick Login.** With your explicit consent, credentials stored *only on this device* are used to refill the login form when the session expires. Security questions are only auto-answered if you stored them.

**Hard portal limits — cannot be fixed, and anyone claiming otherwise is lying:**
- **Human-verification checkboxes (Cloudflare "I'm human") cannot and should not be auto-solved.** Auto-book *stops* and asks you if one appears mid-flow.
- **Session expiry is the portal's decision.** Re-login needs your credentials and sometimes your security answers; without stored credentials it needs *you*.
- **Rate limits / waiting rooms are the portal defending itself.** Checking every 30 seconds will get you throttled — the extension backs off instead of fighting it.
- **No tool can guarantee you a slot.** Released slots are first-come-first-served and can vanish in under two minutes while hundreds of people compete.
- **An "Access limitation / Prohibited conduct" block is the portal's anti-abuse enforcement, not a bug.** It means the portal believes it detected automated use and is deliberately refusing access. The extension does not try to recover from this: it **stops every automatic action** (post rotation, auto-book, auto sign-in), badges `X`, sends a sticky notification, and will **not** clear cookies, reload, or retry — that would just be working around the block. Monitoring stays off until you deliberately untick "Pause monitoring" in the popup. If you believe the block is wrong, review the Terms and conditions page on ustraveldocs.com and contact the portal's support — the extension does not, and will not, auto-evade this.

## Privacy

- Everything (settings, credentials, health log) lives in `chrome.storage.local` **on your device**.
- No analytics. The only remote calls this extension ever makes are to the visa portal itself.
- Quick Login credentials never leave the browser. Anyone with access to your browser profile could read them: only use it on your own computer.

## Architecture

```
src/lib/          pure, unit-tested logic (no chrome.* except storage/notify)
  detector.js     page-state classifier over a DOM snapshot
  availability.js date extraction (data-attrs → embedded JSON → text scan)
  scheduler.js    exponential backoff + jitter
  questions.js    security-question matching (normalized + fuzzy)
  burst.js        burst-window / interval logic for OFC rotation (minute-of-hour + optional hour-of-day)
  session.js      HEALTHY/DEGRADED/NEEDS_USER state machine
  notify.js       sound + desktop alerts
src/content/portal.js   thin DOM adapter, answers worker messages
src/content/login.js    B2C login filler (verifies the click, loop-guarded)
src/content/panel.js    on-page panel (saved login, Log in now, Check slots)
src/content/access-block.js  detects Prohibited Conduct blocks -> stop everything
src/content/session-reset.js detects PSE0501 (plain session expiry) -> reset and re-login
src/background/service-worker.js  orchestration (alarms, tabs, badge)
src/popup/        settings UI, health log
tests/            node:test, 65 tests, no dependencies
```

## Roadmap

- Mobile push via optional companion (honest: needs a backend; not faked)
- Multi-profile monitoring
- Community slot-activity feed
- Firefox port

## License

MIT — see [LICENSE](LICENSE).
