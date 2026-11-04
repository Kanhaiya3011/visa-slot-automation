const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAll } = require('./helper');
loadAll();

const detect = VSG.detector.detectPageState;

test('detects Cloudflare challenge', () => {
  assert.equal(detect({ url: 'https://www.usvisascheduling.com/', title: 'Just a moment...', bodyText: 'Verifying you are human. This may take a few seconds.' }), 'CHALLENGE');
});

test('detects access blocked (Prohibited Conduct) and gives it priority', () => {
  var body = 'Access limitation. Your attempt to view the calendar section was blocked due to apparent ' +
    'violation of Prohibited conduct clause of the Terms and conditions of the use of this system.';
  assert.equal(detect({ url: 'https://www.usvisascheduling.com/', title: 'Access limitation', bodyText: body }), 'ACCESS_BLOCKED');
  // Even if the text would also match another pattern, the block wins.
  assert.equal(detect({ url: 'https://www.usvisascheduling.com/login', title: '', bodyText: body + ' Please verify you are a human.' }), 'ACCESS_BLOCKED');
});

test('a standalone "Prohibited conduct" mention is NOT the access block', () => {
  // e.g. a Terms and Conditions page that happens to have a clause by this
  // name, without the actual block screen's "Access limitation" heading.
  var terms = 'Terms and Conditions. Section 4: Prohibited conduct. Users may not attempt ' +
    'automated access, scraping, or apparent violation of these terms.';
  assert.notEqual(detect({ url: 'https://www.usvisascheduling.com/terms', title: 'Terms', bodyText: terms }), 'ACCESS_BLOCKED');
});

test('detects waiting room', () => {
  assert.equal(detect({ url: 'https://www.usvisascheduling.com/', title: 'Waiting', bodyText: 'You are in a waiting room. Estimated wait time: 5 minutes.' }), 'QUEUE');
});

test('detects rate limiting', () => {
  assert.equal(detect({ url: 'https://www.usvisascheduling.com/', title: 'Error', bodyText: 'Too many requests. Please slow down and try again in a few minutes.' }), 'RATE_LIMITED');
});

test('detects expired session', () => {
  assert.equal(detect({ url: 'https://www.usvisascheduling.com/schedule', title: 'Schedule', bodyText: 'Your session has expired. Please log in again.' }), 'SESSION_EXPIRED');
});

test('detects login page', () => {
  assert.equal(detect({ url: 'https://www.usvisascheduling.com/login', title: 'Sign in', bodyText: 'Sign in to your account. Username Password Forgot your password?' }), 'LOGGED_OUT');
});

test('detects ready calendar (text markers)', () => {
  assert.equal(detect({ url: 'https://www.usvisascheduling.com/schedule', title: 'Schedule Appointment', bodyText: 'Appointment calendar — select a date. Available dates are highlighted.' }), 'READY_CALENDAR');
});

test('detects ready calendar (data attributes)', () => {
  assert.equal(detect({ url: 'https://x/', title: '', bodyText: 'pick one', html: '<td data-available-date="2026-11-05">5</td>' }), 'READY_CALENDAR');
});

test('calendar wins over stray sign-in link', () => {
  assert.equal(detect({ url: 'https://www.usvisascheduling.com/schedule', title: 'Schedule', bodyText: 'Appointment calendar. Sign in link in footer.' }), 'READY_CALENDAR');
});

test('unknown page stays unknown', () => {
  assert.equal(detect({ url: 'https://www.usvisascheduling.com/', title: '', bodyText: 'welcome' }), 'UNKNOWN');
});
