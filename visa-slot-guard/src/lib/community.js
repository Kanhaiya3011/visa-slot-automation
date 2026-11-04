/* Community signal parsing — PURE, no DOM, no chrome APIs, no network.
 * Fetching (background/service-worker.js) hands this raw text snippets
 * (post titles/bodies, forum messages); this file turns noisy, contradictory
 * free text into hour-of-day vote counts, then clusters those into
 * candidate burst windows (see burst.js for the hourFrom/hourTo window
 * shape this produces).
 *
 * This is deliberately a VOTE, not a single claim taken at face value: one
 * post saying "3am" proves nothing — a forum is unverified, and a single
 * mention could be a guess, a joke, or deliberately planted to mislead
 * other automated checkers into watching the wrong window. Only an hour
 * range with at least `minVotes` independent mentions becomes a window.
 */
(function () {
  var VSG = (globalThis.VSG = globalThis.VSG || {});

  function normHour24(h) {
    h = Math.round(Number(h));
    return ((h % 24) + 24) % 24;
  }

  function to24(h, meridiem) {
    h = h % 12;
    if (String(meridiem).toLowerCase() === 'pm') h += 12;
    return h;
  }

  // Scan `text` with a sequence of (regex, matchToMention) passes, most
  // specific first; a span already consumed by an earlier pass can't also
  // match a later, less specific one (e.g. "11pm to 1am" is one range
  // mention, not that plus two single-hour mentions).
  function extractHourMentions(text) {
    text = String(text || '').toLowerCase();
    var consumed = [];
    function overlaps(s, e) {
      return consumed.some(function (r) { return s < r[1] && e > r[0]; });
    }
    var mentions = [];
    function run(re, toMention) {
      re.lastIndex = 0;
      var m;
      while ((m = re.exec(text)) !== null) {
        var s = m.index;
        var e = m.index + m[0].length;
        if (overlaps(s, e)) continue;
        var mention = toMention(m);
        if (mention) {
          mentions.push(mention);
          consumed.push([s, e]);
        }
      }
    }

    // "11pm to 1am" / "11pm-1am" — each side carries its own meridiem.
    run(/\b(\d{1,2})\s*(?::\d{2})?\s*(am|pm)\s*(?:-|to|–|—)\s*(\d{1,2})\s*(?::\d{2})?\s*(am|pm)\b/gi, function (m) {
      return { hourFrom: to24(parseInt(m[1], 10), m[2]), hourTo: to24(parseInt(m[3], 10), m[4]) };
    });
    // "1-5am" / "12 to 6 am" — one trailing meridiem shared by both sides.
    run(/\b(\d{1,2})\s*(?::\d{2})?\s*(?:-|to|–|—)\s*(\d{1,2})\s*(?::\d{2})?\s*(am|pm)\b/gi, function (m) {
      return { hourFrom: to24(parseInt(m[1], 10), m[3]), hourTo: to24(parseInt(m[2], 10), m[3]) };
    });
    run(/\bmidnight\b/gi, function () { return { hourFrom: 0, hourTo: 0 }; });
    run(/\bnoon\b/gi, function () { return { hourFrom: 12, hourTo: 12 }; });
    // Single mention: "2am", "11:30 pm".
    run(/\b(\d{1,2})\s*(?::\d{2})?\s*(am|pm)\b/gi, function (m) {
      var h = to24(parseInt(m[1], 10), m[2]);
      return { hourFrom: h, hourTo: h };
    });

    return mentions;
  }

  // One vote per hour the mention covers (inclusive, wrapping past midnight).
  function voteHours(mentions) {
    var votes = new Array(24).fill(0);
    (mentions || []).forEach(function (m) {
      if (!m || m.hourFrom == null || m.hourTo == null) return;
      var from = normHour24(m.hourFrom);
      var to = normHour24(m.hourTo);
      var h = from;
      var guard = 0;
      for (;;) {
        votes[h]++;
        if (h === to || ++guard > 24) break;
        h = (h + 1) % 24;
      }
    });
    return votes;
  }

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

  // Convenience: raw text snippets in, candidate {hourFrom, hourTo, votes}
  // windows out. opts: { minVotes, maxWindows }.
  function windowsFromTexts(texts, opts) {
    opts = opts || {};
    var mentions = [];
    (texts || []).forEach(function (t) { mentions = mentions.concat(extractHourMentions(t)); });
    return clusterVotes(voteHours(mentions), opts.minVotes, opts.maxWindows);
  }

  VSG.community = {
    extractHourMentions: extractHourMentions,
    voteHours: voteHours,
    clusterVotes: clusterVotes,
    windowsFromTexts: windowsFromTexts,
  };
})();
