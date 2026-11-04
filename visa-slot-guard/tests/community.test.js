const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAll } = require('./helper');
loadAll();

const { extractHourMentions, voteHours, clusterVotes, windowsFromTexts } = VSG.community;

test('extracts a single am/pm mention', () => {
  assert.deepEqual(extractHourMentions('check around 2am for slots'), [{ hourFrom: 2, hourTo: 2 }]);
  assert.deepEqual(extractHourMentions('11 PM is when they drop'), [{ hourFrom: 23, hourTo: 23 }]);
});

test('midnight and noon', () => {
  assert.deepEqual(extractHourMentions('right at midnight'), [{ hourFrom: 0, hourTo: 0 }]);
  assert.deepEqual(extractHourMentions('around noon sometimes'), [{ hourFrom: 12, hourTo: 12 }]);
});

test('shared-meridiem range: "1-5am"', () => {
  assert.deepEqual(extractHourMentions('slots open 1-5am IST'), [{ hourFrom: 1, hourTo: 5 }]);
});

test('split-meridiem range: "11pm to 1am"', () => {
  assert.deepEqual(extractHourMentions('watch 11pm to 1am'), [{ hourFrom: 23, hourTo: 1 }]);
});

test('a range is one mention, not also two singles (no double count)', () => {
  assert.equal(extractHourMentions('try 1-5am daily').length, 1);
});

test('no mentions in ordinary text', () => {
  assert.deepEqual(extractHourMentions('no idea when they release tbh'), []);
});

test('voteHours tallies inclusive, wrapping ranges', () => {
  const votes = voteHours([{ hourFrom: 23, hourTo: 1 }]);
  assert.equal(votes[23], 1);
  assert.equal(votes[0], 1);
  assert.equal(votes[1], 1);
  assert.equal(votes[12], 0);
});

test('clusterVotes groups contiguous hours above the threshold, strongest first', () => {
  const votes = new Array(24).fill(0);
  votes[1] = 3; votes[2] = 3; votes[3] = 2; // one run, 1..3
  votes[14] = 5; // isolated single hour, below default minVotes only if <2 — here it's 5
  const runs = clusterVotes(votes, 2, 4);
  assert.deepEqual(runs[0], { hourFrom: 1, hourTo: 3, votes: 8 });
  assert.deepEqual(runs[1], { hourFrom: 14, hourTo: 14, votes: 5 });
});

test('clusterVotes drops anything below minVotes', () => {
  const votes = new Array(24).fill(0);
  votes[5] = 1;
  assert.deepEqual(clusterVotes(votes, 2, 4), []);
});

test('clusterVotes caps at maxWindows', () => {
  const votes = new Array(24).fill(0);
  [0, 5, 10, 15, 20].forEach((h) => { votes[h] = 2; });
  assert.equal(clusterVotes(votes, 2, 3).length, 3);
});

test('windowsFromTexts: end-to-end, several posts agreeing beats a lone outlier', () => {
  const texts = [
    'I always get slots around 2am',
    'yeah 2am worked for me too',
    'try 2-3am honestly',
    'someone said 4pm once but idk',
  ];
  const runs = windowsFromTexts(texts, { minVotes: 2, maxWindows: 4 });
  assert.ok(runs.length >= 1);
  assert.equal(runs[0].hourFrom <= 2 && runs[0].hourTo >= 2, true);
  // the single unconfirmed "4pm" mention never clears minVotes=2
  assert.ok(!runs.some((r) => r.hourFrom === 16 || r.hourTo === 16));
});
