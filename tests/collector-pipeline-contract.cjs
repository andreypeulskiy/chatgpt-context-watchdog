'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {source,assertImport,reachableFrom,modules} = require('./support/source-graph.cjs');
const {bundlePath} = require('./support/current.cjs');

let total = 0;
const check = (name, fn) => { fn(); total++; console.log('PASS',name); };
const read = source;
(async () => {
  check('All production modules are reachable through actual ES imports', () => {
    const reachable = reachableFrom();
    assert.deepEqual([...modules.keys()].filter(id => !reachable.has(id)), []);
    assertImport('chatgpt/09-dom-collection.js', 'chatgpt/09-dom-message-identity.js');
    assertImport('chatgpt/09-dom-collection.js', 'chatgpt/09-dom-unit-identity.js');
    assertImport('app/11-message-scan.js', 'chatgpt/09-dom-collection.js');
    assertImport('app/11-message-scan.js', 'app/11-message-capture.js');
  });
  check('Capture pipeline isolates hydration, scan, completion, capture, commit and route',()=>{
    assertImport('app/11-message-capture.js', 'core/11-message-completion-context.js');
    assertImport('app/11-message-capture.js', 'app/11-message-ledger-commit.js');
    assertImport('app/11-message-scan.js', 'app/11-ledger-statistics.js');
    assert.match(read('app/11-message-scan.js'),/normalizeCollectedMessageEntries\(collected\)/);
    assert.match(read('app/11-message-capture.js'),/captureCompletionContext\(entries\)/);
    assert.match(read('app/11-message-capture.js'),/commitCapturedMessage\(state, id, role, measured, commit\)/);
    assert.doesNotMatch(read('app/11-message-capture.js'),/state\.messages\[id\] =/);
    assert.match(read('app/11-message-ledger-commit.js'),/state\.messages\[id\] =/);
    assert.doesNotMatch(read('app/11-message-ledger-commit.js'),/\b(?:saveState|loadState|render|fetch)\s*\(/);
  });
  const identities = await import(pathToFileURL(path.resolve(__dirname,'../src/chatgpt/09-dom-message-identity.js')).href);
  const {captureCompletionContext} = await import(pathToFileURL(path.resolve(__dirname,'../src/core/11-message-completion-context.js')).href);
  check('Normalization prefers event-local cached identities with preserved order',()=>{
    const nodes=[{},{}];
    const ids=new WeakMap([[nodes[0],{role:'user',id:'msg:A'}], [nodes[1],{role:'assistant',id:'msg:B'}]]);
    const result=identities.normalizeCollectedMessageEntries({nodes,identities:ids});
    assert.deepEqual(result.map(x=>[x.index,x.role,x.id]),[[0,'user','msg:A'],[1,'assistant','msg:B']]);
  });
  check('Fallback normalization uses trusted identity enumerator with no reads',()=>{
    const nodes=[{role:'assistant',id:'msg:C'}];
    // Fall back through the actual exported identity walk with a simple DOM stub.
    // The unit-role parser can recognize data-message-author-role on fallback wrappers.
    nodes[0].getAttribute=(key)=> key==='data-message-id' ? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' : key==='data-message-author-role' ? 'assistant' : null;
    nodes[0].closest=()=>null;
    const result=identities.normalizeCollectedMessageEntries({nodes});
    assert.equal(result.length,1);
    assert.equal(result[0].index,0);
    assert.equal(result[0].role,'assistant');
    assert.equal(result[0].id,'msg:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });
  check('Completion-context identifies the last assistant and later user correctly',()=>{
    const result=captureCompletionContext([{role:'assistant'},{role:'user'},{role:'assistant'},{role:'user'}]);
    assert.equal(result.lastAssistantIndex,2);
    assert.deepEqual(result.laterUser,[true,true,true,false]);
  });
  check('UI pin state preserves the accessible toggle contract',()=>{
    const markup=read('ui/13-panel-markup.js');
    assert.match(markup,/class="cw-tool-button cw-pin-panel" aria-label="Pin panel" aria-pressed="false"/);
    // Theme, color, background and icon transform are browser-tested, not locked in CSS.
  });
  check('Shipping script stays local-only with no transport hooks',()=>{
    const bundle=fs.readFileSync(bundlePath,'utf8');
    assert.match(bundle,/\/\/ @grant\s+none/);
    assert.doesNotMatch(bundle, /\b(?:XMLHttpRequest|WebSocket|EventSource)\s*\(/);
    const {inspectCacheOnlyCalls}=require('../tools/cache-only-policy.cjs');
    const cacheReview=inspectCacheOnlyCalls(bundle,'bundle');
    assert.equal(cacheReview.count,1);
    assert.deepEqual(cacheReview.problems,[]);
    assert.doesNotMatch(bundle,/\bsetInterval\s*\(/);
  });
  console.log(total,'collector/pipeline current ESM architecture checks passed');
})().catch(err=>{console.error(err);process.exitCode=1;});
