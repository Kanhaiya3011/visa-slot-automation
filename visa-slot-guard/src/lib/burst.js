/* Burst windows — PURE, no DOM, no chrome APIs.
 * Lets the rotation check far more often during specific minutes of every
 * hour (e.g. when slots are known to be released), and fall back to the
 * normal interval the rest of the time.
 *
 * A window is { from, to, sec, hourFrom, hourTo }:
 *   - from/to: minute-of-hour range (0..59, inclusive), applied every hour.
 *     `to` may be smaller than `from` to wrap past the hour boundary, e.g.
 *     { from: 55, to: 1 } covers minute 55 through minute 1 of the next hour.
 *   - hourFrom/hourTo: OPTIONAL hour-of-day range (0..23, inclusive, local
 *     time), e.g. for "slots tend to drop between midnight and 6am" — a
 *     claim about which HOURS, not which minutes of every hour. Omitted
 *     (null/undefined) on either end means no hour restriction — the
 *     window applies every hour of every day, exactly as before this field
 *     existed. Existing manually-added windows are unaffected.
 */
(function () {
  var VSG = (globalThis.VSG = globalThis.VSG || {});

  function normMinute(m) {
    m = Math.round(Number(m));
    return ((m % 60) + 60) % 60;
  }

  function inWindow(minute, from, to) {
    minute = normMinute(minute);
    from = normMinute(from);
    to = normMinute(to);
    if (from <= to) return minute >= from && minute <= to;
    return minute >= from || minute <= to; // wraps past :59 -> :00
  }

  function normHour(h) {
    h = Math.round(Number(h));
    return ((h % 24) + 24) % 24;
  }

  // hourFrom/hourTo omitted (null/undefined) on either end = no restriction.
  function inHour(hour, hourFrom, hourTo) {
    if (hourFrom == null || hourTo == null) return true;
    hour = normHour(hour);
    hourFrom = normHour(hourFrom);
    hourTo = normHour(hourTo);
    if (hourFrom <= hourTo) return hour >= hourFrom && hour <= hourTo;
    return hour >= hourFrom || hour <= hourTo; // wraps past midnight
  }

  function windowActiveNow(w, minute, hour) {
    return !!w && w.sec > 0 && inHour(hour, w.hourFrom, w.hourTo) && inWindow(minute, w.from, w.to);
  }

  // The interval (seconds) that should apply right now: the smallest
  // (most aggressive) of every currently-active window's interval, or
  // baseSec if none apply. `now` defaults to the current time.
  function activeIntervalSec(windows, baseSec, now) {
    now = now || new Date();
    var minute = now.getMinutes();
    var hour = now.getHours();
    var best = baseSec;
    (windows || []).forEach(function (w) {
      if (windowActiveNow(w, minute, hour) && w.sec < best) best = w.sec;
    });
    return best;
  }

  // Which window (if any) is driving the current interval — for display.
  function activeWindow(windows, now) {
    now = now || new Date();
    var minute = now.getMinutes();
    var hour = now.getHours();
    var best = null;
    (windows || []).forEach(function (w) {
      if (!windowActiveNow(w, minute, hour)) return;
      if (!best || w.sec < best.sec) best = w;
    });
    return best;
  }

  VSG.burst = { inWindow: inWindow, inHour: inHour, activeIntervalSec: activeIntervalSec, activeWindow: activeWindow };
})();
