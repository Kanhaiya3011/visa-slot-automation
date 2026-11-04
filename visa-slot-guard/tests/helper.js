// Shared helper: load classic-script lib files into globalThis.VSG.
const fs = require('fs');
const path = require('path');

function loadLib(rel) {
  const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  eval(src);
}

function loadAll() {
  [
    'src/lib/storage.js',
    'src/lib/detector.js',
    'src/lib/availability.js',
    'src/lib/scheduler.js',
    'src/lib/session.js',
    'src/lib/questions.js',
    'src/lib/burst.js',
    'src/lib/notify.js',
    'src/lib/sightings.js',
  ].forEach(loadLib);
}

module.exports = { loadLib, loadAll };
