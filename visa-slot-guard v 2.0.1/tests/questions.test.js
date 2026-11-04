const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAll } = require('./helper');
loadAll();

const { findAnswer, upsert, remove, normalize } = VSG.questions;

const saved = [
  { q: "What is your mother's maiden name?", a: 'smith' },
  { q: 'What was the first company that you worked for?', a: 'acme' },
  { q: 'What is the name of your first pet?', a: 'rex' },
];

test('exact question text matches', () => {
  assert.equal(findAnswer(saved, 'What was the first company that you worked for?').a, 'acme');
});

test('punctuation, case and apostrophes are ignored', () => {
  assert.equal(findAnswer(saved, '  what is your MOTHERS maiden name ').a, 'smith');
  assert.equal(findAnswer(saved, 'What is your mother’s maiden name?').a, 'smith');
});

test('small wording change still matches (fuzzy)', () => {
  assert.equal(findAnswer(saved, 'What was the name of your first pet?').a, 'rex');
});

test('similar-template but different question does not match', () => {
  assert.equal(findAnswer(saved, 'What is the name of your first school?'), null);
  assert.equal(findAnswer(saved, 'What was the second company that you worked for?'), null);
});

test('unrelated question does not match', () => {
  assert.equal(findAnswer(saved, 'In what city were you born?'), null);
  assert.equal(findAnswer(saved, ''), null);
  assert.equal(findAnswer([], 'What is your mother\'s maiden name?'), null);
});

test('upsert replaces an existing answer instead of duplicating', () => {
  const out = upsert(saved, 'what is your mothers maiden name', 'jones');
  assert.equal(out.length, 3);
  assert.equal(findAnswer(out, "What is your mother's maiden name?").a, 'jones');
});

test('upsert keeps at most 3, dropping the oldest', () => {
  const out = upsert(saved, 'In what city were you born?', 'pune');
  assert.equal(out.length, 3);
  assert.equal(findAnswer(out, "What is your mother's maiden name?"), null);
  assert.equal(findAnswer(out, 'In what city were you born?').a, 'pune');
});

test('upsert ignores empty answers; remove deletes by question', () => {
  assert.equal(upsert([], 'Q?', '').length, 0);
  assert.equal(remove(saved, 'what is the name of your first pet').length, 2);
  assert.equal(normalize("Mother's  Name?"), 'mothers name');
});
