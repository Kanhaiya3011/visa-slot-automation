const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAll } = require('./helper');
loadAll();

const { extractAvailability, matchDates } = VSG.availability;

test('extracts from data attributes', () => {
  const r = extractAvailability({ html: '<td data-available-date="2026-11-05">5</td><td data-available-date="2026-11-06">6</td>', bodyText: '' });
  assert.deepEqual(r.dates, ['2026-11-05', '2026-11-06']);
  assert.equal(r.strategy, 'data-attributes');
  assert.equal(r.confidence, 'high');
});

test('extracts from embedded JSON', () => {
  const r = extractAvailability({ html: '', bodyText: 'x "availableDates":["2026-12-01","2026-11-05"] y' });
  assert.deepEqual(r.dates, ['2026-11-05', '2026-12-01']);
  assert.equal(r.strategy, 'embedded-json');
});

test('extracts from jQuery UI datepicker grid (greenday/redday), ignoring closed days', () => {
  const html = `
    <td class=" ui-datepicker-unselectable ui-state-disabled redday" title="No Available Appointments"><span class="ui-state-default">26</span></td>
    <td class=" greenday ui-datepicker-current-day" data-handler="selectDay" data-event="click" data-month="10" data-year="2026">
      <a class="ui-state-default ui-state-active" href="#" aria-current="true" data-date="27">27</a>
    </td>
    <td class=" ui-datepicker-unselectable ui-state-disabled redday" title="No Available Appointments"><span class="ui-state-default">28</span></td>
  `;
  const r = extractAvailability({ html, bodyText: '' });
  assert.deepEqual(r.dates, ['2026-11-27']);
  assert.equal(r.strategy, 'datepicker-grid');
  assert.equal(r.confidence, 'high');
});

test('dedupes and sorts', () => {
  const r = extractAvailability({ html: '<td data-available-date="2026-11-06">6</td><td data-available-date="2026-11-06">6</td>', bodyText: '' });
  assert.deepEqual(r.dates, ['2026-11-06']);
});

test('empty when nothing found', () => {
  const r = extractAvailability({ html: '<div>no dates</div>', bodyText: 'no dates here' });
  assert.deepEqual(r.dates, []);
});

test('matchDates filters range', () => {
  assert.deepEqual(matchDates(['2026-11-05', '2026-12-01', '2027-01-10'], '2026-11-01', '2026-12-31'), ['2026-11-05', '2026-12-01']);
});

test('matchDates open range returns all', () => {
  assert.deepEqual(matchDates(['2026-11-05'], '', ''), ['2026-11-05']);
});
