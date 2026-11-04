/* Security question matching — PURE, no DOM, no chrome APIs.
 * The portal asks 2 of the user's 3 security questions per sign-in. Saved
 * answers are a list of { q, a } (question text as shown, answer). Matching
 * is on normalized text, with a token-overlap fallback so small wording or
 * punctuation changes ("mother's" vs "mothers") still match.
 */
(function () {
  var VSG = (globalThis.VSG = globalThis.VSG || {});

  var MAX_SAVED = 3;
  var FUZZY_MIN = 0.8; // token Jaccard similarity needed for a fuzzy match

  function normalize(q) {
    return String(q || '')
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // Filler words carry no meaning for matching; comparing only content
  // words keeps "first pet" and "first school" apart despite shared wording.
  var STOP = {};
  ('a an the is was were are what which who whom where when how did do does in on of for to at ' +
    'you your yours that this name named called').split(' ').forEach(function (w) { STOP[w] = true; });

  function tokens(q) {
    return normalize(q).split(' ').filter(function (t) { return t && !STOP[t]; });
  }

  function similarity(a, b) {
    var ta = tokens(a);
    var tb = tokens(b);
    if (!ta.length || !tb.length) return 0;
    var setB = {};
    tb.forEach(function (t) { setB[t] = true; });
    var union = {};
    ta.concat(tb).forEach(function (t) { union[t] = true; });
    var inter = ta.filter(function (t, i) { return setB[t] && ta.indexOf(t) === i; }).length;
    return inter / Object.keys(union).length;
  }

  // Best saved entry for a question shown on the page, or null.
  function findAnswer(saved, question) {
    var nq = normalize(question);
    if (!nq) return null;
    var list = saved || [];
    for (var i = 0; i < list.length; i++) {
      if (normalize(list[i].q) === nq && list[i].a) return list[i];
    }
    var best = null;
    var bestScore = 0;
    list.forEach(function (e) {
      if (!e.a) return;
      var s = similarity(e.q, question);
      if (s > bestScore) { bestScore = s; best = e; }
    });
    return bestScore >= FUZZY_MIN ? best : null;
  }

  // Add or replace the answer for a question. Keeps at most MAX_SAVED
  // (the portal uses 3), dropping the oldest if a 4th distinct one appears.
  function upsert(saved, question, answer) {
    var list = (saved || []).slice();
    var nq = normalize(question);
    if (!nq || !answer) return list;
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (normalize(list[i].q) === nq) { idx = i; break; }
    }
    var entry = { q: String(question).trim(), a: answer };
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    while (list.length > MAX_SAVED) list.shift();
    return list;
  }

  function remove(saved, question) {
    var nq = normalize(question);
    return (saved || []).filter(function (e) { return normalize(e.q) !== nq; });
  }

  VSG.questions = {
    MAX_SAVED: MAX_SAVED,
    normalize: normalize,
    similarity: similarity,
    findAnswer: findAnswer,
    upsert: upsert,
    remove: remove,
  };
})();
