'use strict';
// The in-memory reset cannot allow a pre-wipe ledger snapshot to recreate data.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {source} = require('./support/module-source.cjs');
const bytes = new Map();
const errors = [];
const ctx = {
  currentChatKey: 'chat:A', transientState: null,
  setTransientState(value) { ctx.transientState = value; },
  measuredStorageRead: key => bytes.get(key) ?? null,
  stateKey: key => 'watchdog:state:' + key,
  perfStart: () => null, perfEnd: () => {},
  emptyState: chatKey => ({chatKey, messages: {}, files: {}, domImages: {}, repairHistory: [], attachmentLedgerVersion: 2}),
  decodeLedger: (chatKey, raw) => raw ? JSON.parse(raw) : ctx.emptyState(chatKey),
  reportStorageFailure: (...args) => errors.push(args),
  reconcileLedger: () => { throw Error('Stale draft should fail before reconciliation'); },
  writeJson: (key, value, _chatKey, _error, _onFailure, onSuccess) => {
    const raw = JSON.stringify(value);
    bytes.set(key, raw);
    onSuccess?.(raw);
    return true;
  },
  Date
};
vm.createContext(ctx);
vm.runInContext(
  source('01-runtime-ledger-state') + '\n' +
  source('03-ledger-repository') + '\n' +
  source('03-ledger-commit'), ctx);

const stale = ctx.loadState('chat:A');
stale.messages['msg:old'] = {tokens: 10};
assert.equal(ctx.saveState(stale), true);
const oldBytes = bytes.get('watchdog:state:chat:A');
assert.ok(oldBytes);
// The action removed all Watchdog data and invalidated the old read snapshots.
bytes.clear();
ctx.invalidateLedgerJobs('chat:A');
ctx.invalidateLedgerReadSnapshots();
assert.equal(ctx.resetEpoch('chat:A'), 1);
assert.equal(ctx.saveState(stale), false, 'A pre-wipe draft must not restore deleted data');
assert.equal(bytes.size, 0);
assert.ok(errors.some(row => String(row[1]).includes('missing ledger baseline')));
const fresh = ctx.loadState('chat:A');
fresh.messages['msg:new'] = {tokens: 42};
assert.equal(ctx.saveState(fresh), true, 'Fresh post-wipe capture must remain writable');
assert.deepEqual(Object.keys(JSON.parse(bytes.get('watchdog:state:chat:A')).messages), ['msg:new']);
console.log('PASS pre-wipe stale draft cannot resurrect ledger; new drafts work');
