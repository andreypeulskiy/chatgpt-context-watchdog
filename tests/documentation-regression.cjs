'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {root} = require('./support/current.cjs');
const { source, reachableFrom } = require('./support/source-graph.cjs');
const signature = [
  ['core/03-ledger-schema.js', 'function emptyState(chatKey)', 'WatchdogLedgerV2'],
  ['core/03-ledger-validation.js', 'function decodeLedger(chatKey, raw, parse = JSON.parse)', 'WatchdogLedgerV2'],
  ['storage/03-ledger-repository.js', 'function loadState(chatKey = currentChatKey)', 'WatchdogLedgerV2'],
  ['core/03-ledger-merge.js', 'function reconcileLedger(baseRaw, liveRaw, draft, parse = JSON.parse)', 'WatchdogLedgerV2'],
  ['storage/03-ledger-commit.js', 'function saveState(state)', 'WatchdogLedgerV2'],
  ['chatgpt/09-dom-collection.js', 'function collectMessageNodes()', 'WatchdogCollectedMessages'],
  ['app/11-ledger-statistics.js', 'function stats(state = loadState())', 'WatchdogLedgerV2'],
  ['app/11-route-navigation.js', 'function snapshotRouteDom()', 'WeakMap'],
  ['app/11-route-navigation.js', 'function routeDomHasChanged(collected = null)', 'WatchdogCollectedMessages']
];
const reachable = reachableFrom();
for (const [module, fn, type] of signature) {
  assert.ok(reachable.has(module), `Interface is not reachable from main.js: ${module}`);
  const text = source(module);
  const i = text.indexOf('  ' + fn);
  assert.ok(i >= 0, `Missing ${fn} in ${module}`);
  const before = text.slice(Math.max(0, i - 500), i);
  assert.ok(before.includes('WATCHDOG_CONTRACT') && before.includes(type),
    `Contract missing or detached: ${fn} in ${module}`);
}
assert.ok(source('runtime/01-runtime-configuration.js').includes('  /** WATCHDOG_CONTRACT: persisted ledger fields'));
console.log('PASS persisted ledger declaration and 9 documented interfaces in reachable ES modules');

const buildSource=fs.readFileSync(path.join(root,'tools/build.cjs'),'utf8');
assert.doesNotMatch(buildSource,/legacy-manifest|classicSource|classic-test-projection|test-projection\.cjs/,
  'The product build must not use test-only VM compatibility code');
assert.ok(!fs.existsSync(path.join(root,'tests/support/legacy-manifest.json')),
  'No historical test ordering should be required');
assert.ok(!fs.existsSync(path.join(root,'tools/lib/test-projection.cjs')),
  'VM-fragment adapter belongs to tests, not build tooling');
// A developer may still have an ignored output from a previous build in
// tests/.generated/. Do not require its absence: the new build merely must not
// generate or depend on that artifact.
const currentHelper=fs.readFileSync(path.join(root,'tests/support/current.cjs'),'utf8');
const snippetReader=fs.readFileSync(path.join(root,'tests/support/module-source.cjs'),'utf8');
assert.doesNotMatch(currentHelper,/classicRelative|classicPath/);
assert.doesNotMatch(snippetReader,/oldManifest|legacy-manifest/);
console.log('PASS no classic test-only bundle or historical test manifest');
