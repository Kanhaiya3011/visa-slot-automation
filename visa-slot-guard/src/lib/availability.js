/* Availability extraction + date matching — PURE, no DOM, no chrome APIs.
 * Multiple strategies with a reported confidence level, so callers can tell
 * "no slots found" apart from "the page layout changed and I can't read it".
 */
(function () {
  var VSG = (globalThis.VSG = globalThis.VSG || {});

  var ISO_RE = /\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])\b/g;

  function uniqSorted(dates) {
    var seen = {};
    var out = [];
    dates.forEach(function (d) {
      if (!seen[d]) {
        seen[d] = true;
        out.push(d);
      }
    });
    out.sort();
    return out;
  }

  function fromDataAttributes(html) {
    var out = [];
    var re = /data-(?:available|slot)[-_]date\s*=\s*["'](20\d{2}-[01]\d-[0-3]\d)["']/gi;
    var m;
    while ((m = re.exec(html)) !== null) out.push(m[1]);
    return out;
  }

  // usvisascheduling.com's OFC datepicker is a jQuery UI datepicker: each
  // open day is a <td class="... greenday ..." data-handler="selectDay"
  // data-month="10" data-year="2026"> (month is 0-indexed) wrapping an
  // <a data-date="27">27</a>. Closed days are "redday" and carry no date
  // attributes at all, so matching on "greenday" alone already excludes them.
  function fromDatepickerGrid(html) {
    var out = [];
    var tdRe = /<td\b([^>]*\bclass\s*=\s*["'][^"']*\bgreenday\b[^"']*["'][^>]*)>([\s\S]*?)<\/td>/gi;
    var td;
    while ((td = tdRe.exec(html)) !== null) {
      var attrs = td[1];
      var inner = td[2];
      var month = /\bdata-month\s*=\s*["'](\d{1,2})["']/i.exec(attrs);
      var year = /\bdata-year\s*=\s*["'](\d{4})["']/i.exec(attrs);
      var day = /\bdata-date\s*=\s*["'](\d{1,2})["']/i.exec(inner);
      if (!month || !year || !day) continue;
      var mm = ('0' + (parseInt(month[1], 10) + 1)).slice(-2);
      var dd = ('0' + day[1]).slice(-2);
      out.push(year[1] + '-' + mm + '-' + dd);
    }
    return out;
  }

  function fromEmbeddedJson(text) {
    var out = [];
    // e.g. "availableDates":["2026-11-05",...]  (any key mentioning dates/slots)
    var re = /"(?:availableDates|available_dates|slots|openDates)"\s*:\s*\[([^\]]*)\]/gi;
    var m;
    while ((m = re.exec(text)) !== null) {
      var inner = m[1].match(ISO_RE);
      if (inner) out = out.concat(inner);
    }
    return out;
  }

  function fromLooseIso(text) {
    var m = text.match(ISO_RE);
    return m || [];
  }

  var MONTHS = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
  };

  function fromMonthDay(text) {
    // "November 5, 2026" / "Nov 5 2026"
    var out = [];
    var re = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+([1-9]|[12][0-9]|3[01])(?:st|nd|rd|th)?,?\s+(20\d{2})\b/gi;
    var m;
    while ((m = re.exec(text)) !== null) {
      var day = m[2].length === 1 ? '0' + m[2] : m[2];
      out.push(m[3] + '-' + MONTHS[m[1].toLowerCase()] + '-' + day);
    }
    return out;
  }

  function extractAvailability(snap) {
    snap = snap || {};
    var html = snap.html || '';
    var body = snap.bodyText || '';
    var combined = html + '\n' + body;

    var dates = fromDataAttributes(html);
    var strategy = 'data-attributes';
    var confidence = 'high';
    if (!dates.length) {
      dates = fromDatepickerGrid(html);
      strategy = 'datepicker-grid';
    }
    if (!dates.length) {
      dates = fromEmbeddedJson(combined);
      strategy = 'embedded-json';
    }
    if (!dates.length) {
      // Loose ISO scan is low confidence: page chrome may contain stray dates.
      dates = fromLooseIso(body);
      strategy = 'loose-iso-scan';
      confidence = 'low';
    }
    if (!dates.length) {
      dates = fromMonthDay(body);
      strategy = 'month-day-text';
      confidence = 'low';
    }
    return { dates: uniqSorted(dates), strategy: strategy, confidence: confidence };
  }

  function matchDates(dates, fromISO, toISO) {
    if (!fromISO && !toISO) return (dates || []).slice();
    return (dates || []).filter(function (d) {
      if (fromISO && d < fromISO) return false;
      if (toISO && d > toISO) return false;
      return true;
    });
  }

  VSG.availability = { extractAvailability: extractAvailability, matchDates: matchDates };
})();
