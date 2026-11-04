const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAll } = require('./helper');
loadAll();

const { transition, reloginOutcome } = VSG.session;

test('healthy calendar check stays healthy', () => {
  const t = transition('HEALTHY', 'READY_CALENDAR', {});
  assert.equal(t.state, 'HEALTHY');
  assert.equal(t.action, 'check');
});

test('challenge needs the user, with clear message', () => {
  const t = transition('HEALTHY', 'CHALLENGE', {});
  assert.equal(t.state, 'NEEDS_USER');
  assert.equal(t.action, 'notify-user');
  assert.match(t.userMessage, /human-verification/i);
});

test('recovery from challenge notifies resume', () => {
  const t = transition('NEEDS_USER', 'READY_CALENDAR', {});
  assert.equal(t.state, 'HEALTHY');
  assert.match(t.userMessage, /resumed/i);
});

test('rate limit degrades with backoff', () => {
  const t = transition('HEALTHY', 'RATE_LIMITED', {});
  assert.equal(t.state, 'DEGRADED');
  assert.equal(t.action, 'backoff');
});

test('expired session tries quick login when enabled', () => {
  const t = transition('HEALTHY', 'SESSION_EXPIRED', { quickLoginOn: true });
  assert.equal(t.action, 'try-relogin');
  assert.equal(t.state, 'DEGRADED');
});

test('expired session needs user without quick login', () => {
  const t = transition('HEALTHY', 'SESSION_EXPIRED', { quickLoginOn: false });
  assert.equal(t.state, 'NEEDS_USER');
  assert.equal(t.action, 'notify-user');
});

test('repeated unknown escalates to user', () => {
  const t = transition('HEALTHY', 'UNKNOWN', { unknownStreak: 2 });
  assert.equal(t.state, 'NEEDS_USER');
  assert.match(t.userMessage, /layout may have changed/i);
});

test('single unknown just backs off', () => {
  const t = transition('HEALTHY', 'UNKNOWN', { unknownStreak: 0 });
  assert.equal(t.action, 'backoff');
});

test('relogin outcome mapping', () => {
  assert.equal(reloginOutcome(true).state, 'HEALTHY');
  assert.equal(reloginOutcome(false).state, 'NEEDS_USER');
});

test('access blocked (prohibited conduct) stops, never retries or evades', () => {
  const t = transition('HEALTHY', 'ACCESS_BLOCKED', {});
  assert.equal(t.state, 'BLOCKED');
  assert.equal(t.action, 'stop');
  assert.match(t.userMessage, /prohibited conduct/i);
  assert.match(t.userMessage, /will NOT retry or clear cookies/i);
});

test('access blocked overrides an already-healthy session', () => {
  const t = transition('BLOCKED', 'ACCESS_BLOCKED', {});
  assert.equal(t.state, 'BLOCKED');
  assert.equal(t.action, 'stop');
});
