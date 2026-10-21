'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const names = [
  '03-settings-store.js',
  '03-storage-io.js',
  '03-calibration-store.js',
  '03-ledger-foundation.js',
  '03-ledger-schema.js',
  '03-ledger-validation.js',
  '03-ledger-repository.js',
  '03-ledger-merge.js',
  '03-ledger-commit.js',
  '03-chat-transition.js'
];
const {source,reachableFrom,assertImport}=require('./support/source-graph.cjs');
const ids = names.map(name => ['03-ledger-schema.js', '03-ledger-validation.js', '03-ledger-merge.js'].includes(name)
  ? 'core/' + name : 'storage/' + name);
const files = ids.map(source);
let verified = 0;
function test(title, callback) { callback(); console.log('PASS', title); verified++; }
test('Storage and ledger modules are distinct, reachable ESM boundaries', () => {
  const reachable = reachableFrom();
  for (const id of ids) assert.ok(reachable.has(id), id);
  assert.equal(new Set(names).size, names.length);
  assertImport('storage/03-ledger-repository.js', 'core/03-ledger-validation.js');
  assertImport('storage/03-ledger-commit.js', 'core/03-ledger-merge.js');
  assertImport('storage/03-storage-io.js', 'storage/03-ledger-foundation.js');
});
const functions = [
  ['loadSettings', 0], ['writeJson', 1], ['saveSettings', 1],
  ['loadHistory', 2], ['saveHistory', 2], ['historyStatsFor', 2],
  ['historyStats', 2], ['calibratedBudgets', 2],
  ['getChatKey', 3], ['stateKey', 3], ['emptyState', 4],
  ['storageProblem', 3], ['reportStorageFailure', 3], ['decodeLedger', 5],
  ['loadState', 6], ['reconcileLedger', 7], ['saveState', 8], ['promoteTransientLedger', 9]
];
for (const [fn, owner] of functions) {
  test(`${fn} has exactly one owning source fragment`, () => {
    const regex = new RegExp(`^  function ${fn}\\(`, 'gm');
    assert.equal(files.reduce((sum, code) => sum + (code.match(regex) || []).length, 0), 1);
    assert.match(files[owner], regex);
  });
}
test('Chat route orchestration belongs to Application, not Storage', () => {
  assert.match(source('app/11-chat-transition.js'), /function changeChatKey\(/);
  assert.doesNotMatch(files[9], /clearAuditConfirmation|cancelAnimationFrame|setCurrentChatKey/);
});
test('Settings validation cannot commit to storage or mutate ledger', () => {
  assert.doesNotMatch(files[0], /\blocalStorage\.setItem\(|\bsaveState\(|\bwriteJson\(/);
});
test('Calibration reads an existing ledger but does not reconcile it directly', () => {
  assert.doesNotMatch(files[2], /function saveEndedChatSample\(/);
  const command = source('app/03-calibration-command.js');
  assert.match(command, /function saveEndedChatSample\(/);
  assert.doesNotMatch(files[2], /import .*\.\.\/ui\//);
  assert.doesNotMatch(files[2], /function (?:saveState|reconcileLedger|decodeLedger)\(/);
});
test('Decode is storage-write-free; merge only reconciles in memory', () => {
  assert.doesNotMatch(files[5], /\b(?:localStorage\.setItem|writeJson|saveState)\(/);
  assert.doesNotMatch(files[7], /\b(?:localStorage\.setItem|writeJson|saveState)\(/);
});
test('Persistent storage commit enforces a previously captured baseline', () => {
  assert.match(files[8], /if \(!ledgerReadSnapshots\.has\(state\)\)/);
  assert.match(files[8], /reconcileLedger\(baseRaw, liveRaw, state,/);
  assert.match(files[8], /writeJson\(stateKey\(state\.chatKey\), candidate/);
});
test('Neither merge nor repository implements network transport', () => {
  for (const code of files) {
    assert.doesNotMatch(code, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/);
  }
});
test('The public storage API remains complete after ES module migration', () => {
  const expected = ['loadSettings', 'writeJson', 'saveSettings',
    'loadState', 'reconcileLedger', 'saveState'];
  for (const name of expected) {
    const re = new RegExp('^  function ' + name + '\\(', 'm');
    assert.ok(files.some(code => re.test(code)), name);
  }
  // The real bundle is loaded by Chromium smoke tests, not lexical text parity.
});
console.log(`${verified} Ledger/Storage boundary and ES-module contracts passed`);
