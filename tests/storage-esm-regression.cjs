'use strict';
// Storage safety exercised through real linked ES modules and distinct tab realms.
const assert=require('node:assert/strict');
// Every simulated browser tab gets a *separate linked ESM graph*, but both
// tabs access the same shared localStorage object and use real commit logic.
const {isolatedModules,silentPanelRendering}=require('./support/isolated-esm.cjs');
const prefix = 'cgpt-context-watchdog:state:v2:';
const key = chat => prefix + encodeURIComponent(chat);
const storageMap = new Map();
const storage = {
  getItem(k) { return storageMap.has(k) ? storageMap.get(k) : null; },
  setItem(k,v) { storageMap.set(k, String(v)); },
  removeItem(k) { storageMap.delete(k); }
};
let jobs=[];
const deferredFile=()=>({name:'some.txt',size:42,lastModified:2,type:'text/plain',
  text:()=>new Promise((resolve,reject)=>jobs.push({resolve,reject}))});
const textForTokens = n => 'a'.repeat(Math.floor(n * 3.45));
const singleFile=state=>{const values=Object.values(state.files);assert.equal(values.length,1);return values[0];};
const singleFileKey=state=>{const keys=Object.keys(state.files);assert.equal(keys.length,1);return keys[0];};
async function tab(name) {
  const warnings=[];
  const realm=await isolatedModules({localStorage:storage,
    location:{pathname:'/c/abc'}}, {'ui/16-panel-rendering.js':silentPanelRendering()});
  const capture=realm.module('runtime/01-runtime-capture-state.js');
  capture.initializeCaptureState(realm.module('runtime/01-runtime-configuration.js').DEFAULTS,'chat:A');
  realm.module('runtime/01-runtime-pause-state.js').setChatAvailable(true);
  const ledger=realm.module('runtime/01-runtime-ledger-state.js');
  ledger.setStorageFailureNotifier(message=>warnings.push(message));
  const ctx={...realm.module('storage/03-ledger-foundation.js'),
    ...realm.module('core/03-ledger-schema.js'),
    ...realm.module('core/03-ledger-validation.js'),
    ...realm.module('storage/03-ledger-repository.js'),
    ...realm.module('storage/03-ledger-commit.js'),
    ...realm.module('core/03-ledger-merge.js'),
    ...realm.module('storage/03-storage-io.js'),
    ...ledger,
    ...realm.module('attachments/06-attachment-reading.js'),
    ...realm.module('attachments/05-attachment-helpers.js'),
    ...realm.module('chatgpt/04-text-estimators.js')};
  return {ctx,warnings,realm};
}
let passed = 0;
async function test(label, action) {
  storageMap.clear(); jobs = [];
  await action();
  console.log('PASS', label);
  passed++;
}
const msg = n => ({role:'user',chars:12,tokens:n,fingerprint:'v3:'+n});
const read = chat => JSON.parse(storage.getItem(key(chat)));
(async () => {
  await test('new ledger maintains state:v2 schema', async () => {
    const {ctx} = await tab('a');
    const state = ctx.loadState('chat:A');
    state.messages['msg:A'] = msg(1);
    assert.equal(ctx.saveState(state), true);
    assert.equal(read('chat:A').messages['msg:A'].tokens,1);
    assert.equal(read('chat:A').attachmentLedgerVersion, 2);
    assert.equal(ctx.saveState(state), true); // snapshot advances
  });
  await test('different tabs adding distinct UUIDs preserve both', async () => {
    const a = (await tab('a')).ctx, b = (await tab('b')).ctx;
    const x = a.loadState(), y = b.loadState();
    x.messages['msg:A'] = msg(1);
    y.messages['msg:B'] = msg(2);
    assert.equal(a.saveState(x),true);
    assert.equal(b.saveState(y),true);
    assert.deepEqual(Object.keys(read('chat:A').messages).sort(), ['msg:A','msg:B']);
    assert.deepEqual(Object.keys(y.messages).sort(),['msg:A','msg:B']);
  });
  await test('competing write to same UUID fails closed', async () => {
    const a = await tab('a'), b = await tab('b');
    const x = a.ctx.loadState(), y = b.ctx.loadState();
    x.messages['msg:A'] = msg(10);
    y.messages['msg:A'] = msg(99);
    assert.equal(a.ctx.saveState(x),true);
    assert.equal(b.ctx.saveState(y),false);
    assert.equal(read('chat:A').messages['msg:A'].tokens,10);
    assert.ok(b.warnings.some(w=>w.includes('STORAGE CONFLICT')));
  });
  await test('independent file updates survive a concurrent message write', async () => {
    const a = (await tab('a')).ctx, b = (await tab('b')).ctx;
    const x=a.loadState(), y=b.loadState();
    x.messages['msg:1']=msg(1);
    y.files['file:1']={status:'ready',tokens:13};
    assert.equal(a.saveState(x),true);
    assert.equal(b.saveState(y),true);
    assert.equal(read('chat:A').messages['msg:1'].tokens,1);
    assert.equal(read('chat:A').files['file:1'].tokens,13);
  });
  await test('concurrent conflicting file updates reject overwrite', async () => {
    const a=(await tab('a')).ctx;
    const initial=a.loadState(); initial.files.F={status:'reading'};
    assert.equal(a.saveState(initial),true);
    const b=await tab('b');
    const x=a.loadState(), y=b.ctx.loadState();
    x.files.F={status:'ready',tokens:12};
    y.files.F={status:'error'};
    assert.equal(a.saveState(x),true);
    assert.equal(b.ctx.saveState(y),false);
    assert.equal(read('chat:A').files.F.tokens,12);
  });
  await test('Audit repair conflicts are not silently merged', async () => {
    const a=(await tab('a')).ctx, b=await tab('b');
    const x=a.loadState(), y=b.ctx.loadState();
    x.repairHistory.push({id:'1',before:msg(10),after:msg(11)});
    y.repairHistory.push({id:'2',before:msg(10),after:msg(12)});
    assert.equal(a.saveState(x),true);
    assert.equal(b.ctx.saveState(y),false);
    assert.equal(read('chat:A').repairHistory[0].id,'1');
  });
  await test('deleted ledger is not recreated by a stale snapshot', async () => {
    const a=(await tab('a')).ctx;
    let state=a.loadState(); state.messages.A=msg(1);
    a.saveState(state);
    state=a.loadState(); state.messages.B=msg(2);
    storage.removeItem(key('chat:A'));
    assert.equal(a.saveState(state),false);
    assert.equal(storage.getItem(key('chat:A')),null);
  });
  await test('reset followed by a fresh chat ledger never imports stale old data', async () => {
    const a=(await tab('a')).ctx, b=(await tab('b')).ctx;
    const original=a.loadState(); original.messages.OLD=msg(1);
    assert.equal(a.saveState(original),true);
    const stale=a.loadState(); stale.messages.STALE=msg(99);
    storage.removeItem(key('chat:A'));
    const fresh=b.loadState(); fresh.messages.NEW=msg(5);
    assert.equal(b.saveState(fresh),true);
    assert.equal(a.saveState(stale),false);
    assert.deepEqual(Object.keys(read('chat:A').messages),['NEW']);
  });
  await test('malformed remote ledger is preserved unchanged', async () => {
    const a=(await tab('a')).ctx, x=a.loadState();
    x.messages.A=msg(1);
    storage.setItem(key('chat:A'),'{garbled');
    assert.equal(a.saveState(x),false);
    assert.equal(storage.getItem(key('chat:A')),'{garbled');
  });
  await test('draft without recorded load baseline refuses write', async () => {
    const a=await tab('a'); const draft=a.ctx.emptyState('chat:A');
    draft.messages.A=msg(1);
    assert.equal(a.ctx.saveState(draft), false);
    assert.equal(storage.getItem(key('chat:A')),null);
  });
  await test('stale post-reset async file completion does not recreate ledger', async () => {
    const a=(await tab('a')).ctx;
    const file=deferredFile();
    const working=a.rememberSentFile(file,'file-input','chat:A','msg:UUID');
    assert.equal(jobs.length,1);
    assert.equal(singleFile(read('chat:A')).status,'reading');
    storage.removeItem(key('chat:A'));
    a.invalidateLedgerJobs('chat:A');
    jobs.shift().resolve(textForTokens(100));
    await working;
    assert.equal(storage.getItem(key('chat:A')),null);
  });
  await test('remote deletion cancels async file via missing reading record', async () => {
    const a=(await tab('a')).ctx;
    const file=deferredFile();
    const working=a.rememberSentFile(file,'file-input','chat:A','msg:UUID');
    assert.equal(jobs.length,1);
    storage.removeItem(key('chat:A'));
    jobs.shift().resolve(textForTokens(100));
    await working;
    assert.equal(storage.getItem(key('chat:A')),null);
  });
  await test('normal async file finish coexists with another tab new message', async () => {
    const a=(await tab('a')).ctx, b=(await tab('b')).ctx;
    const file=deferredFile();
    const working=a.rememberSentFile(file,'file-input','chat:A','msg:UUID');
    const other=b.loadState(); other.messages['msg:B']=msg(77);
    assert.equal(b.saveState(other),true);
    jobs.shift().resolve(textForTokens(42));
    await working;
    assert.equal(read('chat:A').messages['msg:B'].tokens,77);
    assert.equal(singleFile(read('chat:A')).tokens,a.estimateProseTokens(textForTokens(42)));
  });
  await test('RC-3: failed ready write retains calculated tokens until exact retry succeeds', async () => {
    const a=(await tab('a')).ctx;
    const file=deferredFile();
    const reading=a.rememberSentFile(file,'file-input','chat:A','msg:UUID');
    assert.equal(jobs.length,1);
    const normalSetItem=storage.setItem;
    let rejectOnce=true;
    storage.setItem=(key,value)=>{
      if(rejectOnce){rejectOnce=false;throw Error('one-time storage failure');}
      return normalSetItem(key,value);
    };
    jobs.shift().resolve(textForTokens(80));
    await reading;
    assert.equal(singleFile(read('chat:A')).status,'reading');
    assert.equal(a.pendingFileResults.size,1);
    // An unrelated successful write must not discard the pending file result.
    const unrelated=a.loadState();unrelated.messages['msg:other']=msg(3);
    assert.equal(a.saveState(unrelated),true);
    assert.equal(a.pendingFileResults.size,1);
    a.retryPendingFileResults('chat:A');
    assert.equal(a.pendingFileResults.size,0);
    assert.equal(singleFile(read('chat:A')).status,'ready');
    assert.equal(singleFile(read('chat:A')).tokens,a.estimateProseTokens(textForTokens(80)));
    assert.equal(singleFile(read('chat:A')).method,'text');
    assert.equal(Object.keys(read('chat:A').files).length,1);
    storage.setItem=normalSetItem;
  });
  await test('RC-3: reset invalidates queued successful file read', async () => {
    const a=(await tab('a')).ctx;
    const file=deferredFile();
    const reading=a.rememberSentFile(file,'file-input','chat:A','msg:UUID');
    const normalSetItem=storage.setItem;
    storage.setItem=()=>{storage.setItem=normalSetItem;throw Error('once');};
    jobs.shift().resolve(textForTokens(85));
    await reading;
    assert.equal(a.pendingFileResults.size,1);
    storage.removeItem(key('chat:A'));
    a.invalidateLedgerJobs('chat:A');
    a.retryPendingFileResults('chat:A');
    assert.equal(a.pendingFileResults.size,0);
    assert.equal(storage.getItem(key('chat:A')),null);
  });
  await test('late file failure never downgrades a ready record', async () => {
    const a=(await tab('a')).ctx, b=(await tab('b')).ctx;
    const file=deferredFile();
    const working=a.rememberSentFile(file,'file-input','chat:A','msg:UUID');
    const remote=b.loadState(); remote.files[singleFileKey(remote)].status='ready';
    remote.files[singleFileKey(remote)].tokens=123;
    assert.equal(b.saveState(remote),true);
    jobs.shift().reject(new Error('late failure'));
    await working;
    assert.equal(singleFile(read('chat:A')).status,'ready');
    assert.equal(singleFile(read('chat:A')).tokens,123);
  });
  // Execute the actual observer, calibration, collector and forecast modules.
  async function reviewRealm(overrides = {}) {
    const bytes = new Map(), events = {};
    const ls = { getItem: k => bytes.get(k) ?? null,
      setItem: (k, v) => bytes.set(k, String(v)), removeItem: k => bytes.delete(k) };
    const dom = { readyState: 'loading', hidden: true, addEventListener() {} };
    const graph = await isolatedModules({ localStorage: ls,
      location: { pathname: '/c/11111111-1111-4111-8111-111111111111' },
      document: dom, window: { addEventListener: (name, fn) => { events[name] = fn; } },
      console: { ...console, warn() {} }, ...overrides
    }, { 'ui/16-panel-rendering.js': silentPanelRendering() });
    const chat = 'chat:11111111-1111-4111-8111-111111111111';
    graph.module('runtime/01-runtime-capture-state.js').initializeCaptureState(
      { ...graph.module('runtime/01-runtime-configuration.js').DEFAULTS }, chat);
    graph.module('runtime/01-runtime-pause-state.js').setChatAvailable(true);
    return { graph, bytes, events, ls, chat };
  }
  await test('verified remote deletion unblocks a corrupt ledger, but not stale drafts', async () => {
    const { graph, bytes, events, chat } = await reviewRealm();
    const store = graph.module('storage/03-ledger-repository.js');
    const commit = graph.module('storage/03-ledger-commit.js');
    const state = graph.module('runtime/01-runtime-ledger-state.js');
    const k = graph.module('storage/03-ledger-foundation.js').stateKey(chat);
    const oldDraft = store.loadState(); // baseline null, invalidated by the reset
    bytes.set(k, '{broken');
    store.loadState();
    assert.equal(state.corruptLedgerKeys.has(chat), true);
    graph.module('app/17-spa-observer-startup.js').start();
    bytes.delete(k);
    events.storage({ key: k, newValue: null, oldValue: '{broken' });
    assert.equal(state.corruptLedgerKeys.has(chat), false);
    assert.equal(state.storageFailures.has(chat), false);
    assert.equal(commit.saveState(oldDraft), false);
    const fresh = store.loadState();
    fresh.messages.NEW = { role: 'user', chars: 12, tokens: 4 };
    assert.equal(commit.saveState(fresh), true);
    assert.equal(JSON.parse(bytes.get(k)).messages.NEW.tokens, 4);
  });
  await test('P2: fast remote reset and immediate valid rewrite unblocks corrupt tab, fences old drafts', async () => {
    const { graph, bytes, events, chat } = await reviewRealm();
    const store = graph.module('storage/03-ledger-repository.js');
    const commit = graph.module('storage/03-ledger-commit.js');
    const gates = graph.module('runtime/01-runtime-ledger-state.js');
    const key = graph.module('storage/03-ledger-foundation.js').stateKey(chat);
    const stale = store.loadState();
    stale.messages.OLD = {role:'assistant', tokens:900, chars:99};
    bytes.set(key, '{broken');
    store.loadState();
    assert.equal(gates.corruptLedgerKeys.has(chat), true);
    graph.module('app/17-spa-observer-startup.js').start();
    // B resets the corrupt ledger and writes before A can process the removal.
    bytes.delete(key);
    const freshRemote = JSON.stringify({messages:{NEW:{role:'user',tokens:3,chars:9}},
      files:{},domImages:{},attachmentLedgerVersion:2,repairHistory:[]});
    bytes.set(key, freshRemote);
    events.storage({key,newValue:null,oldValue:'{broken'});
    assert.equal(gates.corruptLedgerKeys.has(chat),false);
    assert.equal(gates.storageFailures.has(chat),false);
    assert.equal(gates.resetEpoch(chat),1);
    assert.equal(commit.saveState(stale),false,'old null-baseline draft may not resurrect data');
    const latest=store.loadState();
    assert.deepEqual(Object.keys(latest.messages),['NEW']);
    latest.messages.AFTER={role:'assistant',tokens:4,chars:12};
    assert.equal(commit.saveState(latest),true);
    assert.deepEqual(Object.keys(JSON.parse(bytes.get(key)).messages),['NEW','AFTER']);
    // A later normal write event must not bump epochs or invalidate fresh work.
    events.storage({key,newValue:bytes.get(key),oldValue:freshRemote});
    assert.equal(gates.resetEpoch(chat),1);
  });
  await test('P2: repaired valid overwrite without observed removal also reopens corrupt tab', async () => {
    const { graph, bytes, events, chat } = await reviewRealm();
    const store = graph.module('storage/03-ledger-repository.js');
    const commit = graph.module('storage/03-ledger-commit.js');
    const gates = graph.module('runtime/01-runtime-ledger-state.js');
    const key = graph.module('storage/03-ledger-foundation.js').stateKey(chat);
    const stale=store.loadState();
    bytes.set(key,'{bad');store.loadState();
    graph.module('app/17-spa-observer-startup.js').start();
    const repaired=JSON.stringify({messages:{RECOVERED:{role:'user',tokens:1}}});
    bytes.set(key,repaired);
    events.storage({key,oldValue:'{bad',newValue:repaired});
    assert.equal(gates.corruptLedgerKeys.has(chat),false);
    assert.equal(gates.resetEpoch(chat),1);
    assert.equal(commit.saveState(stale),false);
    const fresh=store.loadState();fresh.messages.SECOND={role:'assistant',tokens:2};
    assert.equal(commit.saveState(fresh),true);
  });
  await test('P2: remote chat B reset preserves chat A retry baseline and pending draft', async () => {
    const { graph, bytes, events, chat } = await reviewRealm();
    const store = graph.module('storage/03-ledger-repository.js');
    const commit = graph.module('storage/03-ledger-commit.js');
    const gates = graph.module('runtime/01-runtime-ledger-state.js');
    const capture = graph.module('runtime/01-runtime-capture-state.js');
    const key = graph.module('storage/03-ledger-foundation.js').stateKey;
    const other='chat:22222222-2222-4222-8222-222222222222';
    const pending=store.loadState(chat);
    pending.messages.RETRY={role:'assistant',tokens:35};
    capture.setFailedScanDraft({chatKey:chat,epoch:gates.resetEpoch(chat),state:pending,
      revisions:[],fileJobs:[],commit:{added:1,changed:0}});
    graph.module('app/17-spa-observer-startup.js').start();
    bytes.set(key(other), JSON.stringify({messages:{REMOVED:{tokens:8}}}));
    bytes.delete(key(other));
    events.storage({key:key(other),newValue:null,oldValue:'{previous valid ledger}'});
    assert.equal(gates.resetEpoch(chat),0);
    assert.equal(gates.resetEpoch(other),1);
    assert.equal(capture.failedScanDraft?.state,pending,
      'resetting B cannot discard pending write for A');
    assert.equal(commit.saveState(capture.failedScanDraft.state),true,
      'retry on A must keep its read snapshot');
    assert.equal(JSON.parse(bytes.get(key(chat))).messages.RETRY.tokens,35);
  });
  await test('P2: single-chat epoch invalidation rejects only that chat old null baselines', async () => {
    const { graph, bytes, chat } = await reviewRealm();
    const store = graph.module('storage/03-ledger-repository.js');
    const commit = graph.module('storage/03-ledger-commit.js');
    const gates = graph.module('runtime/01-runtime-ledger-state.js');
    const other='chat:33333333-3333-4333-8333-333333333333';
    const oldA=store.loadState(chat), oldB=store.loadState(other);
    oldA.messages.A={tokens:1};oldB.messages.OLD_B={tokens:1};
    gates.invalidateLedgerJobs(other); // local Reset's per-chat boundary
    assert.equal(commit.saveState(oldB),false);
    assert.equal(commit.saveState(oldA),true);
    const freshB=store.loadState(other);freshB.messages.NEW_B={tokens:2};
    assert.equal(commit.saveState(freshB),true);
    const key=graph.module('storage/03-ledger-foundation.js').stateKey;
    assert.deepEqual(Object.keys(JSON.parse(bytes.get(key(other))).messages),['NEW_B']);
  });
  await test('remote clear resets corrupt gates and invalidates stale drafts', async () => {
    const { graph, bytes, events, chat } = await reviewRealm();
    const store = graph.module('storage/03-ledger-repository.js');
    const commit = graph.module('storage/03-ledger-commit.js');
    const gates = graph.module('runtime/01-runtime-ledger-state.js');
    const k = graph.module('storage/03-ledger-foundation.js').stateKey(chat);
    const stale = store.loadState();
    bytes.set(k, '{corrupted');
    store.loadState();
    graph.module('app/17-spa-observer-startup.js').start();
    gates.pendingFileResults.set('untracked', {chatKey:'chat:untracked'});
    // A hidden/paused tab receives the cross-tab Wipe without mounting UI.
    graph.module('runtime/01-runtime-pause-state.js').setChatAvailable(false);
    bytes.clear();
    events.storage({ key: null, newValue: null, oldValue: null });
    assert.equal(gates.corruptLedgerKeys.has(chat), false);
    assert.equal(gates.storageFailures.has(chat), false);
    assert.equal(gates.pendingFileResults.size, 0);
    assert.equal(commit.saveState(stale), false);
    const fresh = store.loadState();
    fresh.messages.FRESH = {role: 'assistant', chars: 6, tokens: 2};
    assert.equal(commit.saveState(fresh), true);
    assert.deepEqual(Object.keys(JSON.parse(bytes.get(k)).messages), ['FRESH']);
  });
  await test('queued stale delete event cannot dismiss newly corrupt bytes', async () => {
    const { graph, bytes, events, chat } = await reviewRealm();
    const k = graph.module('storage/03-ledger-foundation.js').stateKey(chat);
    bytes.set(k, '{broken');
    graph.module('storage/03-ledger-repository.js').loadState();
    graph.module('app/17-spa-observer-startup.js').start();
    events.storage({ key: k, newValue: null, oldValue: '{former' });
    assert.equal(graph.module('runtime/01-runtime-ledger-state.js').corruptLedgerKeys.has(chat), true);
    assert.equal(bytes.get(k), '{broken');
  });
  await test('corrupt ledger is never recorded as a zero-turn chat limit', async () => {
    const { graph, bytes, chat } = await reviewRealm();
    const cfg = graph.module('runtime/01-runtime-configuration.js');
    const k = graph.module('storage/03-ledger-foundation.js').stateKey(chat);
    bytes.set(k, '{broken');
    const before = [...bytes.entries()];
    const result = graph.module('app/03-calibration-command.js').saveEndedChatSample();
    assert.equal(result.status, 'corrupt-ledger');
    assert.deepEqual([...bytes.entries()], before);
    assert.equal(bytes.has(cfg.HISTORY_KEY), false);
    assert.equal(bytes.has(cfg.SETTINGS_KEY), false);
  });
  await test('fully parsed zero-token text has no metadata double count', async () => {
    const { graph, chat } = await reviewRealm();
    await graph.module('attachments/06-attachment-reading.js').rememberSentFile(
      { name: 'whitespace.txt', size: 1024, type: 'text/plain', lastModified: 1,
        text: async () => ' '.repeat(1024) }, 'file-input', chat, 'msg:test');
    const state = graph.module('storage/03-ledger-repository.js').loadState();
    const f = Object.values(state.files)[0];
    assert.equal(f.tokens, 0);
    assert.equal(f.method, 'text');
    const fc = graph.module('app/07-forecast.js').fileForecast(state.files);
    assert.equal(fc.fileOptimistic, 0);
    assert.equal(fc.filePessimistic, 0);
    assert.equal(fc.parsedFiles, 1);
    assert.equal(fc.unparsedFiles, 0);
    // A sampled text file is not fully known and retains uncertainty.
    const partial = graph.module('app/07-forecast.js').fileForecast({
      partial: {name:'long.txt',method:'text-extrapolated',tokens:0,size:20*1024*1024}
    });
    assert.ok(partial.filePessimistic > 0);
  });
  await test('hidden search units allow visible real-ID fallback', async () => {
    class El {
      constructor(unit, visible) { this.unit = unit; this.visible = visible; this.isConnected = true; }
      getAttribute(name) { return name === 'data-chatgpt-search-unit-key' ? (this.unit ? 'turn:user' : null)
        : name === 'data-message-author-role' ? 'user'
        : name === 'data-message-id' ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : null; }
      hasAttribute(name) { return this.unit && name === 'data-chatgpt-search-unit-key'; }
      getBoundingClientRect() { return { width: this.visible ? 100 : 0, height: this.visible ? 100 : 0 }; }
      closest() { return null; } matches() { return false; } querySelectorAll() { return []; }
    }
    const hidden = new El(true, false), fallback = new El(false, true);
    let fallbackVisible = true;
    const document = { querySelectorAll: selector => selector.includes('data-chatgpt-search-unit-key')
      ? [hidden] : [fallbackVisible ? fallback : new El(false, false)] };
    const { graph } = await reviewRealm({document});
    const collect = graph.module('chatgpt/09-dom-collection.js').collectMessageNodes;
    let result = collect();
    assert.equal(result.name, 'message-id');
    assert.equal(result.nodes.length, 1);
    assert.equal(result.noLayout, 1);
    fallbackVisible = false;
    result = collect();
    assert.equal(result.nodes.length, 0); // no offscreen/outgoing history
  });
  await test('ESLint declares used browser DOMParser', async () => {
    const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
    const ctx = { module: {exports: {}}, require: () => ({}) };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../eslint.config.cjs'), 'utf8'), ctx);
    const conf = ctx.module.exports.find(c => c.files?.includes('src/**/*.js'));
    assert.equal(conf.languageOptions.globals.DOMParser, 'readonly');
    assert.equal(conf.rules['no-undef'], 'error');
  });
  console.log(`\n${passed} native ESM multi-tab storage regressions passed`);
})().catch(error => { console.error(error); process.exitCode=1; });
