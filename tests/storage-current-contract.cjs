'use strict';
// Current-source storage contracts: settings validation, write outcomes, merge safety.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {source} = require('./support/module-source.cjs');
let passed = 0;
function test(name, action) { action(); console.log('PASS', name); passed++; }
function sourceFunction(fragment,name) {
  const text=source(fragment);
  const start = new RegExp('^  function '+name+'\\(','m').exec(text);
  assert.ok(start, name+' is owned by '+fragment);
  const close=/\n  }(?=\n)/g; close.lastIndex=start.index;
  const finish=close.exec(text);
  assert.ok(finish, name+' closes');
  return text.slice(start.index,finish.index+4);
}
function fixture(overrides={}) {
  const store=new Map();
  const failures=[],timings=[],successes=[];
  const defaults={normalBudget:120000,conservativeBudget:80000,optimisticBudget:180000,
    hiddenOptimistic:4000,hiddenPessimistic:16000,viewTheme:'chatgpt',viewStyle:'soft',
    handoffPrompt:'Default prompt',budgetCalibrationWeight:0,
    imageOptimisticPct:20,imagePessimisticPct:80,
    fileOptimisticPct:25,filePessimisticPct:75};
  const ctx={SETTINGS_KEY:'settings-current',currentChatKey:'chat:test',
    settings:{normalBudget:120000,viewStyle:'sharp'},storageFailures:new Map(),DEFAULTS:defaults,MAX_LOCAL_FILE_MIB:256,
    METADATA_SETTING_SPECS:[], // this older isolated contract tests storage, not metadata calibration

    localStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>{store.set(key,value);}},
    measuredStorageRead:key=>store.get(key)??null,
    perfStart:()=>17,perfEnd:(name,started)=>timings.push([name,started]),
    reportStorageFailure:(...args)=>failures.push(args),...overrides};
  vm.createContext(ctx);
  const numericSource=source('01-numeric-settings');
  const numericStart=numericSource.indexOf('const NUMERIC_SETTING_SPECS =');
  const numericEnd=numericSource.indexOf('\n});',numericStart);
  assert.ok(numericStart>=0 && numericEnd>numericStart);
  const numericRegistry=numericSource.slice(numericStart,numericEnd+4);
  // The current settings loader delegates HANDOFF validation to the canonical
  // pure runtime helper; load it into this isolated VM from the real source.
  const configuration=source('01-runtime-configuration');
  const handoffLimit=configuration.match(/^  const HANDOFF_MAX_CHARS = \d+;$/m)?.[0];
  assert.ok(handoffLimit,'HANDOFF limit comes from canonical runtime configuration');
  vm.runInContext(handoffLimit+'\n'+sourceFunction('01-runtime-configuration','isValidHandoffPrompt'),ctx);
  vm.runInContext(numericRegistry+'\n'+sourceFunction('03-storage-io','writeJson')+'\n'+
    sourceFunction('03-storage-io','saveSettings')+'\n'+
    sourceFunction('03-settings-store','loadSettings'),ctx);
  return {ctx,store,failures,timings,successes,defaults};
}
test('Successful JSON write commits exactly once and invokes success with committed bytes',()=>{
  const f=fixture(); let done='';
  assert.equal(f.ctx.writeJson('record',{n:5},'chat:test','failure',null,raw=>done=raw),true);
  assert.equal(f.store.get('record'),'{'+'"n":5}');
  assert.equal(done,'{"n":5}');
  assert.ok(f.timings.some(([name])=>name==='storageWrite'));
  assert.ok(f.timings.some(([name])=>name==='storageEncode'));
  assert.ok(f.timings.some(([name])=>name==='storageCommit'));
  assert.equal(f.failures.length,0);
});
test('Failed writes report failure and do not call success',()=>{
  const f=fixture({localStorage:{setItem:()=>{throw Error('quota');}}});
  let failures=0, successes=0;
  assert.equal(f.ctx.writeJson('k',{},'chat:test','fail',()=>failures++,()=>successes++),false);
  assert.equal(failures,1);
  assert.equal(successes,0);
  assert.equal(f.failures.length,1);
});
test('saveSettings writes the current settings object to the current settings key',()=>{
  const f=fixture();
  assert.equal(f.ctx.saveSettings(),true);
  assert.deepEqual(JSON.parse(f.store.get('settings-current')),{normalBudget:120000,viewStyle:'sharp'});
});
test('saveSettings reports a global write failure and clears it only on a successful retry',()=>{
  const f=fixture({localStorage:{setItem:()=>{throw Error('quota');}}});
  assert.equal(f.ctx.saveSettings(),false);
  assert.equal(f.failures[0][0],'settings-current');
  f.ctx.storageFailures.set('settings-current','failed write');
  assert.equal(f.ctx.storageFailures.has('settings-current'),true);
  f.ctx.localStorage={setItem:(key,value)=>f.store.set(key,value)};
  assert.equal(f.ctx.saveSettings(),true);
  assert.equal(f.ctx.storageFailures.has('settings-current'),false);
});
test('loadSettings accepts valid current-version options, position and HANDOFF prompt',()=>{
  const f=fixture();
  f.store.set('settings-current',JSON.stringify({normalBudget:150000,
    viewStyle:'sharp',viewTheme:'dark',handoffPrompt:'Custom prompt',
    badgePosition:{left:85,top:34},hiddenOptimistic:1200,hiddenPessimistic:4200}));
  const loaded=f.ctx.loadSettings();
  assert.equal(loaded.normalBudget,150000);
  assert.equal(loaded.viewStyle,'sharp');
  assert.equal(loaded.viewTheme,'dark');
  assert.equal(loaded.handoffPrompt,'Custom prompt');
  assert.equal(loaded.badgePosition.left,85);
  assert.equal(loaded.badgePosition.top,34);
  assert.equal(loaded.hiddenOptimistic,1200);
});
test('loadSettings rejects invalid budgets, inverted hidden estimates and invalid view choices',()=>{
  const f=fixture();
  f.store.set('settings-current',JSON.stringify({normalBudget:7000,conservativeBudget:150000,
    optimisticBudget:130000,hiddenOptimistic:20000,hiddenPessimistic:100,
    handoffPrompt:'',viewStyle:'old-theme',viewTheme:'unknown'}));
  const loaded=f.ctx.loadSettings();
  assert.equal(loaded.normalBudget,f.defaults.normalBudget);
  assert.equal(loaded.conservativeBudget,f.defaults.conservativeBudget);
  assert.equal(loaded.optimisticBudget,f.defaults.optimisticBudget);
  assert.equal(loaded.hiddenOptimistic,4000);
  assert.equal(loaded.hiddenPessimistic,16000);
  assert.equal(loaded.viewStyle,'soft');
  assert.equal(loaded.viewTheme,'chatgpt');
  assert.equal(loaded.handoffPrompt,'Default prompt');
});
test('loadSettings falls back safely on malformed JSON',()=>{
  const f=fixture();f.store.set('settings-current','{oops');
  assert.deepEqual(JSON.parse(JSON.stringify(f.ctx.loadSettings())),f.defaults);
});
// Optimistic merge logic is also exercised by storage-regression suite in isolation.
test('reconcileLedger merges independent edits without discarding remote state',()=>{
  const ctx={decodeLedger:(chatKey,raw)=>raw?JSON.parse(raw):
    ({chatKey,messages:{},files:{},domImages:{},repairHistory:[]})};
  vm.createContext(ctx);
  vm.runInContext(sourceFunction('03-ledger-merge','reconcileLedger'),ctx);
  const original={chatKey:'chat:test',messages:{},files:{},domImages:{},repairHistory:[]};
  const live={...original,messages:{A:{tokens:3}}};
  const draft={...original,files:{F:{tokens:4}}};
  const merged=ctx.reconcileLedger(JSON.stringify(original),JSON.stringify(live),draft);
  assert.equal(merged.messages.A.tokens,3);
  assert.equal(merged.files.F.tokens,4);
});
test('reconcileLedger rejects reset and concurrent writes of one message',()=>{
  const ctx={decodeLedger:(chatKey,raw)=>raw?JSON.parse(raw):
    ({chatKey,messages:{},files:{},domImages:{},repairHistory:[]})};
  vm.createContext(ctx);
  vm.runInContext(sourceFunction('03-ledger-merge','reconcileLedger'),ctx);
  const baseline={chatKey:'chat:test',messages:{A:{tokens:1}},files:{},domImages:{},repairHistory:[]};
  const changed={...baseline,messages:{A:{tokens:2}}};
  const conflict={...baseline,messages:{A:{tokens:3}}};
  assert.throws(()=>ctx.reconcileLedger(JSON.stringify(baseline),null,changed),/reset/);
  assert.throws(()=>ctx.reconcileLedger(JSON.stringify(baseline),JSON.stringify(conflict),changed),/Concurrent messages/);
});
console.log(`${passed} storage behavior checks passed`);
