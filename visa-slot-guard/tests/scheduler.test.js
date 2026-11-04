const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAll } = require('./helper');
loadAll();

const { computeDelayMs, computeDelaySec, nextLevel } = VSG.scheduler;

test('delay grows exponentially with level', () => {
  const d0 = computeDelayMs(10, 0);
  const d3 = computeDelayMs(10, 3);
  assert.ok(d0 >= 8 * 60000 && d0 <= 12 * 60000, 'base ~10min, got ' + d0);
  assert.ok(d3 >= 64 * 60000 && d3 <= 96 * 60000, 'level3 ~80min, got ' + d3);
});

test('delay capped at maxMin', () => {
  const d = computeDelayMs(60, 8, 120);
  assert.ok(d <= 120 * 60000 * 1.2, 'capped, got ' + d);
});

test('success decays level', () => {
  assert.equal(nextLevel(3, 'OK'), 2);
  assert.equal(nextLevel(0, 'OK'), 0);
});

test('rate limit escalates faster', () => {
  assert.equal(nextLevel(1, 'RATE_LIMITED'), 3);
  assert.equal(nextLevel(1, 'QUEUE'), 2);
});

test('level capped at 8', () => {
  assert.equal(nextLevel(8, 'RATE_LIMITED'), 8);
});

test('computeDelaySec grows exponentially with level, seconds in/out', () => {
  const d0 = computeDelaySec(5, 0);
  const d3 = computeDelaySec(5, 3);
  assert.ok(d0 >= 4 && d0 <= 6, 'base ~5s, got ' + d0);
  assert.ok(d3 >= 32 && d3 <= 48, 'level3 ~40s, got ' + d3);
});

test('computeDelaySec capped at maxSec', () => {
  const d = computeDelaySec(60, 8, 600);
  assert.ok(d <= 600 * 1.2, 'capped, got ' + d);
});
