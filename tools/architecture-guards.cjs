'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {inspectCacheOnlyCalls}=require('./cache-only-policy.cjs');
const {root,bundlePath}=require('../tests/support/current.cjs');
const js=fs.readFileSync(bundlePath,'utf8');
const src=relative=>fs.readFileSync(path.join(root,'src',relative),'utf8');
const rules=[
 ['runtime/01-runtime-configuration.js','const STATE_PREFIX = `${APP}:state:v2:`;'],
 ['runtime/01-runtime-ledger-state.js','let ledgerReadSnapshots = new WeakMap();'],
 ['runtime/01-runtime-ledger-state.js','function invalidateLedgerReadSnapshots()'],
 ['storage/03-ledger-commit.js','if (!ledgerReadSnapshots.has(state))'],
 ['app/11-route-navigation.js',"if (setSessionPhase(runtime.route.gate?.visible ? 'switching' : 'awaiting-uuid'))"],
 ['app/17-spa-observer-startup.js','observer.observe(document.body || document.documentElement,'],
 ['attachments/05-react-metadata.js',"function reactAttachmentMetadata(element, turn, expectedName = '')"]
];
for(const [file,anchor]of rules) assert.ok(src(file).includes(anchor),`Missing invariant: ${file}: ${anchor}`);
for(const anchor of ['// @grant        none','// @noframes','// @run-at       document-idle'])assert.ok(js.includes(anchor));
assert.doesNotMatch(js,/^\/\/ @require\s/m);
assert.doesNotMatch(js,/\bsetInterval\s*\(/);
assert.equal((js.match(/^\/\/ ==UserScript==$/gm)||[]).length,1);
assert.doesNotMatch(js,/\b(?:XMLHttpRequest|WebSocket|EventSource)\s*\(/);
const cacheReview=inspectCacheOnlyCalls(js,'bundle');
assert.equal(cacheReview.count,1);
assert.deepEqual(cacheReview.problems,[]);
assert.doesNotMatch(js,/\b(?:readZipEntries|inflateRawBytes|estimateOfficeFileTokens)\s*\(/);
console.log(`PASS ${rules.length} cross-layer invariants, local-only Tampermonkey bundle`);
