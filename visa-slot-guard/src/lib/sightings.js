/* Structured-sighting analysis — PURE, no DOM, no chrome APIs, no network.
 *
 * Turns STRUCTURED snapshots — e.g. a periodically-captured table of
 * { location, visaType, earliestDate } like the ones aggregator sites
 * (checkvisaslots.com and similar) publish — into hour-of-day burst-window
 * votes. Nothing here fetches those sites; it only analyzes snapshots
 * handed to it, in whatever way they were captured.
 *
 * The key insight: a raw "we checked and saw X" sighting proves nothing
 * about WHEN a slot opened — sightings happen every couple of minutes
 * regardless of portal activity, so their timestamps mostly just reflect
 * the aggregator's own poll cadence. The real signal is a CHANGE: the
 * earliest reported appointment date for a given (location, visaType)
 * moving EARLIER than it was last known to be. That only happens when a
 * new, better slot actually appears. Those change-moments — not every
 * sighting — are what gets bucketed by hour-of-day and voted on.
 */
(function () {
  var VSG = (globalThis.VSG = globalThis.VSG || {});

  // Contiguous hours (wrapping past midnight) that all meet minVotes become
  // one window; windows are returned strongest (most total votes) first,
  // capped at maxWindows so a long tail of weak signal can't pile up.
  function clusterVotes(votes, minVotes, maxWindows) {
    minVotes = minVotes == null ? 2 : minVotes;
    maxWindows = maxWindows || 4;
    var n = votes.length;
    var visited = new Array(n).fill(false);
    var runs = [];
    for (var start = 0; start < n; start++) {
      if (visited[start] || votes[start] < minVotes) continue;
      var end = start;
      var guard = 0;
      while (!visited[(end + 1) % n] && votes[(end + 1) % n] >= minVotes && (end + 1) % n !== start && guard++ < n) {
        end = (end + 1) % n;
      }
      var h = start;
      var total = 0;
      guard = 0;
      for (;;) {
        visited[h] = true;
        total += votes[h];
        if (h === end || ++guard > n) break;
        h = (h + 1) % n;
      }
      runs.push({ hourFrom: start, hourTo: end, votes: total });
    }
    runs.sort(function (a, b) { return b.votes - a.votes; });
    return runs.slice(0, maxWindows);
  }

  function toDayNumber(dateStr) {
    var d = new Date(dateStr + 'T00:00:00Z');
    return Math.floor(d.getTime() / 86400000);
  }

  // ICU's hour12:false can report midnight as "24" rather than "0" on some
  // platforms — normalize either way.
  function hourInTimeZone(date, timeZone) {
    var fmt = new Intl.DateTimeFormat('en-US', { timeZone: timeZone, hour: 'numeric', hour12: false });
    var part = fmt.formatToParts(date).filter(function (p) { return p.type === 'hour'; })[0];
    return parseInt(part.value, 10) % 24;
  }

  // snapshots: chronological-ish array of { capturedAt, entries: [{ location, visaType, earliestDate }] }.
  // Sorted by capturedAt internally, so callers don't have to pre-sort.
  // Returns one event per (location, visaType) per moment its earliestDate
  // moved earlier than previously known. A pair's first-ever sighting only
  // sets the baseline — with nothing earlier to compare against, it isn't
  // an event. A date moving LATER (someone booked the slot) also just
  // updates the baseline, not an event — this algorithm only cares about
  // appointments getting closer, not farther away.
  function detectReleaseEvents(snapshots) {
    var baseline = {};
    var events = [];
    (snapshots || [])
      .slice()
      .sort(function (a, b) { return new Date(a.capturedAt) - new Date(b.capturedAt); })
      .forEach(function (snap) {
        (snap.entries || []).forEach(function (entry) {
          if (!entry || !entry.location || !entry.visaType || !entry.earliestDate) return;
          var key = entry.visaType + '@' + entry.location;
          var day = toDayNumber(entry.earliestDate);
          var prev = baseline[key];
          if (prev == null) { baseline[key] = day; return; }
          if (day < prev) {
            events.push({ location: entry.location, visaType: entry.visaType, seenAt: snap.capturedAt, improvedByDays: prev - day });
          }
          baseline[key] = day;
        });
      });
    return events;
  }

  // Events in, hour-of-day votes out — one vote per event by default, or
  // exponentially decayed by age (opts.decayHalfLifeDays) so a long-running
  // history adapts if the consulate's release schedule shifts rather than
  // being dominated forever by its earliest data. opts.timeZone defaults to
  // Asia/Kolkata since that's where the VACs in question run.
  function windowsFromEvents(events, opts) {
    opts = opts || {};
    var tz = opts.timeZone || 'Asia/Kolkata';
    var halfLife = opts.decayHalfLifeDays;
    var now = opts.now ? new Date(opts.now) : new Date();
    var votes = new Array(24).fill(0);
    (events || []).forEach(function (e) {
      var seenAt = new Date(e.seenAt);
      if (isNaN(seenAt.getTime())) return;
      var weight = 1;
      if (halfLife) {
        var ageDays = Math.max(0, (now - seenAt) / 86400000);
        weight = Math.pow(0.5, ageDays / halfLife);
      }
      votes[hourInTimeZone(seenAt, tz)] += weight;
    });
    return clusterVotes(votes, opts.minVotes, opts.maxWindows);
  }

  // Convenience: raw snapshots in, candidate {hourFrom, hourTo, votes}
  // windows out.
  function windowsFromSnapshots(snapshots, opts) {
    return windowsFromEvents(detectReleaseEvents(snapshots), opts);
  }

  // Same events, split per location first — release timing plausibly
  // differs by VAC/processing center, so a pooled window can hide that.
  function windowsByLocation(events, opts) {
    var byLoc = {};
    (events || []).forEach(function (e) { (byLoc[e.location] = byLoc[e.location] || []).push(e); });
    var out = {};
    Object.keys(byLoc).forEach(function (loc) { out[loc] = windowsFromEvents(byLoc[loc], opts); });
    return out;
  }

  VSG.sightings = {
    detectReleaseEvents: detectReleaseEvents,
    windowsFromEvents: windowsFromEvents,
    windowsFromSnapshots: windowsFromSnapshots,
    windowsByLocation: windowsByLocation,
  };
})();
