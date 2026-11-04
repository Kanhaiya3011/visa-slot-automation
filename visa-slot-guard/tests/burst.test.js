const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAll } = require('./helper');
loadAll();

const { inWindow, inHour, activeIntervalSec, activeWindow } = VSG.burst;

test('plain window (from <= to)', () => {
  assert.equal(inWindow(1, 1, 5), true);
  assert.equal(inWindow(5, 1, 5), true);
  assert.equal(inWindow(3, 1, 5), true);
  assert.equal(inWindow(0, 1, 5), false);
  assert.equal(inWindow(6, 1, 5), false);
});

test('wrap-around window (from > to), e.g. 55..1', () => {
  assert.equal(inWindow(55, 55, 1), true);
  assert.equal(inWindow(59, 55, 1), true);
  assert.equal(inWindow(0, 55, 1), true);
  assert.equal(inWindow(1, 55, 1), true);
  assert.equal(inWindow(2, 55, 1), false);
  assert.equal(inWindow(54, 55, 1), false);
});

test('activeIntervalSec falls back to the base interval outside any window', () => {
  const windows = [{ from: 1, to: 5, sec: 8 }, { from: 55, to: 1, sec: 8 }];
  assert.equal(activeIntervalSec(windows, 600, new Date(2026, 0, 1, 10, 30)), 600);
});

test('activeIntervalSec uses the window interval inside it, including a wrap window', () => {
  const windows = [{ from: 1, to: 5, sec: 8 }, { from: 55, to: 1, sec: 8 }];
  assert.equal(activeIntervalSec(windows, 600, new Date(2026, 0, 1, 10, 3)), 8);
  assert.equal(activeIntervalSec(windows, 600, new Date(2026, 0, 1, 10, 57)), 8);
  assert.equal(activeIntervalSec(windows, 600, new Date(2026, 0, 1, 11, 0)), 8); // the wrap's :00 end
});

test('overlapping windows: the most aggressive (smallest) interval wins', () => {
  const windows = [{ from: 0, to: 10, sec: 30 }, { from: 5, to: 8, sec: 5 }];
  assert.equal(activeIntervalSec(windows, 600, new Date(2026, 0, 1, 10, 6)), 5);
  assert.equal(activeIntervalSec(windows, 600, new Date(2026, 0, 1, 10, 2)), 30);
});

test('malformed or zero-interval windows are ignored, not treated as always-on', () => {
  const windows = [null, { from: 1, to: 5 }, { from: 1, to: 5, sec: 0 }, { from: 1, to: 5, sec: -3 }];
  assert.equal(activeIntervalSec(windows, 600, new Date(2026, 0, 1, 10, 3)), 600);
});

test('activeWindow reports which window is driving the interval', () => {
  const windows = [{ from: 1, to: 5, sec: 8 }];
  assert.equal(activeWindow(windows, new Date(2026, 0, 1, 10, 3)), windows[0]);
  assert.equal(activeWindow(windows, new Date(2026, 0, 1, 10, 30)), null);
});

test('inHour: no restriction when either end is omitted', () => {
  assert.equal(inHour(14, null, null), true);
  assert.equal(inHour(14, undefined, undefined), true);
});

test('inHour: plain range and wrap past midnight', () => {
  assert.equal(inHour(2, 0, 6), true);
  assert.equal(inHour(7, 0, 6), false);
  assert.equal(inHour(23, 22, 2), true);
  assert.equal(inHour(1, 22, 2), true);
  assert.equal(inHour(10, 22, 2), false);
});

test('activeIntervalSec respects an hour-of-day restricted window', () => {
  const windows = [{ from: 0, to: 59, sec: 10, hourFrom: 0, hourTo: 5 }];
  assert.equal(activeIntervalSec(windows, 600, new Date(2026, 0, 1, 3, 30)), 10);
  assert.equal(activeIntervalSec(windows, 600, new Date(2026, 0, 1, 14, 30)), 600);
});

test('windows without hourFrom/hourTo still apply every hour (backward compatible)', () => {
  const windows = [{ from: 1, to: 5, sec: 8 }];
  assert.equal(activeIntervalSec(windows, 600, new Date(2026, 0, 1, 3, 3)), 8);
  assert.equal(activeIntervalSec(windows, 600, new Date(2026, 0, 1, 23, 3)), 8);
});
