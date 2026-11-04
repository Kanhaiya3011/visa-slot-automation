const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAll } = require('./helper');
loadAll();

const { todayISO, monthsFromTodayISO, getSettings } = VSG.storage;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

test('todayISO matches the local calendar date', () => {
  var today = todayISO();
  assert.match(today, ISO_RE);
  var d = new Date();
  var expected = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  assert.equal(today, expected);
});

test('monthsFromTodayISO(21) lands 21 months out, past today', () => {
  var from = new Date(todayISO() + 'T00:00:00');
  var to = new Date(monthsFromTodayISO(21) + 'T00:00:00');
  assert.ok(to > from);
  var monthDiff = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  assert.ok(monthDiff === 21 || monthDiff === 20); // 20 only for a day-overflow rollback near month-end
});

test('a fresh install defaults the date range to today..21 months out', async () => {
  var s = await getSettings();
  assert.equal(s.dateFrom, todayISO());
  assert.equal(s.dateTo, monthsFromTodayISO(21));
  assert.ok(s.dateFrom < s.dateTo); // ISO yyyy-mm-dd sorts chronologically
});
