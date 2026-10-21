'use strict';
// Stage 1: the ledger schema, decoder and optimistic merge are importable
// without any application, storage, DOM or profiling initialization.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
for (const name of ['03-ledger-schema.js','03-ledger-validation.js','03-ledger-merge.js']) {
  const source = fs.readFileSync(path.join(src,'core',name),'utf8');
  assert.doesNotMatch(source,/^import\s+.*(?:\.\.\/|storage|runtime|ui|chatgpt|app)\//m,
    `${name} must not import infrastructure`);
  assert.doesNotMatch(source,/\b(?:localStorage|window|document|performance|perfStart|perfEnd|showToast)\b/,
    `${name} must not touch infrastructure globals`);
}
const native = String.raw`
  import assert from 'node:assert/strict';
  for (const name of ['localStorage','window','document','performance','MutationObserver']) {
    Object.defineProperty(globalThis, name, {configurable: true,
      get(){throw new Error('Core unexpectedly accessed ' + name);}});
  }
  const {emptyState} = await import('./src/core/03-ledger-schema.js');
  const {decodeLedger} = await import('./src/core/03-ledger-validation.js');
  const {reconcileLedger} = await import('./src/core/03-ledger-merge.js');
  const chat='chat:test';
  const empty=emptyState(chat);
  assert.deepEqual(Object.keys(empty),[
    'chatKey','messages','repairHistory','attachmentLedgerVersion','files','domImages','updatedAt']);
  assert.equal(empty.attachmentLedgerVersion,2);
  assert.deepEqual(decodeLedger(chat,null),empty);
  const record={role:'assistant',tokens:10,chars:20,fingerprint:'v3:old'};
  const base=JSON.stringify({...empty,messages:{one:record}});
  assert.deepEqual(decodeLedger(chat,base).messages.one,record);
  const draft=decodeLedger(chat,base);
  draft.messages.two={role:'user',tokens:40};
  const fresh=JSON.stringify({...empty,messages:{one:record,three:{role:'assistant',tokens:60}}});
  const merged=reconcileLedger(base,fresh,draft);
  assert.deepEqual(Object.keys(merged.messages).sort(),['one','three','two']);
  assert.throws(()=>decodeLedger(chat,'{bad'),SyntaxError);
  assert.throws(()=>decodeLedger(chat,JSON.stringify({messages:{bad:{tokens:-1}}})),
    /Corrupt state:v2 nested ledger record/);
  let parsed=0;
  assert.deepEqual(decodeLedger(chat,base,raw=>{parsed++;return JSON.parse(raw);}).messages.one,record);
  assert.equal(parsed,1);
  assert.equal(decodeLedger(chat,null,()=>{throw Error('should not parse');}).chatKey,chat);
  console.log('PASS native independent ES import, pure schema/decoder/merge and unchanged ledger validation');
`;
const nativeRun=spawnSync(process.execPath,['--input-type=module','-e',native],{
  cwd:root,encoding:'utf8',timeout:10000
});
assert.equal(nativeRun.status,0,nativeRun.stderr||nativeRun.stdout||String(nativeRun.error));
process.stdout.write(nativeRun.stdout);

// Exercise the genuine ESM Storage boundary, independent of the release bundler.
// A separate browser smoke tests the installed bundle end to end.
const nativeStorage = String.raw`
  import assert from 'node:assert/strict';
  const bytes = new Map(); let clock = 0;
  globalThis.localStorage = {
    getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => bytes.set(key, String(value)),
    removeItem: key => bytes.delete(key)
  };
  globalThis.performance = {now: () => ++clock};
  globalThis.window = {addEventListener() {}};
  globalThis.document = {readyState: 'loading', addEventListener() {}, body:{},documentElement:{}};
  globalThis.location = {pathname:'/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};
  const {perf} = await import('./src/runtime/01-runtime-capture-state.js');
  const {loadState} = await import('./src/storage/03-ledger-repository.js');
  const {saveState} = await import('./src/storage/03-ledger-commit.js');
  perf.enabled = true;
  const key='chat:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const source=loadState(key);
  source.messages.ONE={role:'user',tokens:11,chars:20};
  assert.equal(saveState(source),true);
  const draft=loadState(key);
  assert.equal(perf.timings.ledgerParse?.count,1);
  const remote=loadState(key);
  draft.messages.TWO={role:'user',tokens:22};
  assert.equal(saveState(draft),true);
  remote.messages.THREE={role:'user',tokens:33};
  assert.equal(saveState(remote),true);
  assert.equal(perf.timings.ledgerParse?.count,4,
    '2 load parses + 2 optimistic-merge parses must be measured');
  const before=perf.timings.ledgerParse.count;
  const ledgerKey='cgpt-context-watchdog:state:v2:'+encodeURIComponent(key);
  bytes.set(ledgerKey,'{malformed');
  loadState(key);
  assert.equal(perf.timings.ledgerParse.count,before+1,
    'Failed JSON.parse is also measured');
  console.log('PASS native ESM Storage times reads/merges/errors, independent of bundle compiler');
`;
const storageRun=spawnSync(process.execPath,['--input-type=module','-e',nativeStorage],{
  cwd:root,encoding:'utf8',timeout:10000
});
assert.equal(storageRun.status,0,storageRun.stderr||storageRun.stdout||String(storageRun.error));
process.stdout.write(storageRun.stdout);
