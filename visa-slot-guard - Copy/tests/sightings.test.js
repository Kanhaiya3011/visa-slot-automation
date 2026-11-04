const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAll } = require('./helper');
loadAll();

const { detectReleaseEvents, windowsFromEvents, windowsFromSnapshots, windowsByLocation } = VSG.sightings;

// A small synthetic history shaped like what an aggregator (e.g.
// checkvisaslots.com) publishes: periodic snapshots of the earliest
// reported appointment date per (location, visaType). Chennai and
// Hyderabad each get a genuine improvement on two separate days, both
// landing in the 2-3am IST hours; Mumbai gets one booked-later update
// (not an event) and one lone improvement elsewhere (too weak alone).
const snapshots = [
  { capturedAt: '2026-01-01T10:00:00Z', entries: [
    { location: 'CHENNAI VAC', visaType: 'H-1B (Regular)', earliestDate: '2026-03-10' },
    { location: 'HYDERABAD VAC', visaType: 'H-1B (Regular)', earliestDate: '2026-03-12' },
    { location: 'MUMBAI VAC', visaType: 'H-1B (Regular)', earliestDate: '2026-03-15' },
  ] },
  { capturedAt: '2026-01-01T20:30:00Z', entries: [ // 02:00 IST
    { location: 'CHENNAI VAC', visaType: 'H-1B (Regular)', earliestDate: '2026-03-05' },
  ] },
  { capturedAt: '2026-01-01T21:30:00Z', entries: [ // 03:00 IST
    { location: 'HYDERABAD VAC', visaType: 'H-1B (Regular)', earliestDate: '2026-03-04' },
  ] },
  { capturedAt: '2026-01-02T12:00:00Z', entries: [ // booked by someone else: date moves LATER
    { location: 'MUMBAI VAC', visaType: 'H-1B (Regular)', earliestDate: '2026-03-20' },
  ] },
  { capturedAt: '2026-01-02T20:30:00Z', entries: [ // 02:00 IST again, next day
    { location: 'CHENNAI VAC', visaType: 'H-1B (Regular)', earliestDate: '2026-03-01' },
  ] },
  { capturedAt: '2026-01-02T21:30:00Z', entries: [ // 03:00 IST again, next day
    { location: 'HYDERABAD VAC', visaType: 'H-1B (Regular)', earliestDate: '2026-03-02' },
  ] },
  { capturedAt: '2026-01-03T08:00:00Z', entries: [ // 13:30 IST — lone improvement, elsewhere
    { location: 'MUMBAI VAC', visaType: 'H-1B (Regular)', earliestDate: '2026-03-10' },
  ] },
];

test('detectReleaseEvents: first sighting sets a baseline, not an event', () => {
  const events = detectReleaseEvents([
    { capturedAt: '2026-01-01T10:00:00Z', entries: [{ location: 'CHENNAI VAC', visaType: 'H-1B (Regular)', earliestDate: '2026-03-10' }] },
  ]);
  assert.deepEqual(events, []);
});

test('detectReleaseEvents: earlier date is an event, later date (booked) is not', () => {
  const events = detectReleaseEvents(snapshots);
  assert.equal(events.length, 5); // chennai x2, hyderabad x2, mumbai x1 — the booked-later update is excluded
  assert.ok(!events.some((e) => e.location === 'MUMBAI VAC' && e.seenAt === '2026-01-02T12:00:00Z'));
});

test('detectReleaseEvents: out-of-order snapshots are sorted by capturedAt first', () => {
  const events = detectReleaseEvents(snapshots.slice().reverse());
  assert.equal(events.length, 5);
});

test('windowsFromEvents: hour-of-day uses Asia/Kolkata by default', () => {
  const events = detectReleaseEvents(snapshots);
  const runs = windowsFromEvents(events, { minVotes: 2, maxWindows: 4 });
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], { hourFrom: 2, hourTo: 3, votes: 4 });
});

test('windowsFromSnapshots: end-to-end, a lone improvement elsewhere never clears minVotes', () => {
  const runs = windowsFromSnapshots(snapshots, { minVotes: 2, maxWindows: 4 });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].hourFrom, 2);
  assert.equal(runs[0].hourTo, 3);
  assert.ok(!runs.some((r) => r.hourFrom <= 13 && r.hourTo >= 13));
});

test('windowsByLocation: Chennai and Hyderabad each get their own window', () => {
  const events = detectReleaseEvents(snapshots);
  const byLoc = windowsByLocation(events, { minVotes: 2, maxWindows: 4 });
  assert.deepEqual(byLoc['CHENNAI VAC'], [{ hourFrom: 2, hourTo: 2, votes: 2 }]);
  assert.deepEqual(byLoc['HYDERABAD VAC'], [{ hourFrom: 3, hourTo: 3, votes: 2 }]);
  assert.equal(byLoc['MUMBAI VAC'].length, 0); // one lone event, below minVotes
});

test('windowsFromEvents: decay halves an old event\'s weight per half-life', () => {
  const events = [
    { location: 'CHENNAI VAC', visaType: 'H-1B (Regular)', seenAt: '2026-01-01T20:30:00Z' }, // 10 days old
    { location: 'CHENNAI VAC', visaType: 'H-1B (Regular)', seenAt: '2026-01-10T20:30:00Z' }, // 1 day old
  ];
  const runs = windowsFromEvents(events, { minVotes: 0, maxWindows: 4, decayHalfLifeDays: 10, now: '2026-01-11T20:30:00Z' });
  // votes[2] = 0.5^(10/10) + 0.5^(1/10) ≈ 0.5 + 0.933
  assert.ok(Math.abs(runs[0].votes - 1.433) < 0.01);
});
