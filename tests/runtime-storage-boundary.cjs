'use strict';
// Stage 2: runtime and storage modules are inert on import; the application
// explicitly initializes chat/settings and wires storage diagnostics to the UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname,'..');
const source = name => fs.readFileSync(path.join(root,'src',name),'utf8');
for(const name of ['runtime/01-runtime-capture-state.js','runtime/02-profiling.js']) {
  assert.doesNotMatch(source(name),/from ['"]\.\.\/storage\//,`${name} must not import Storage`);
  assert.doesNotMatch(source(name),/from ['"]\.\.\/ui\//,`${name} must not import UI`);
  if(name.endsWith('capture-state.js')) assert.doesNotMatch(source(name),
    /\b(?:localStorage|location\.pathname|document\.|window\.)\s*(?:\.|\[|\()/,
    `${name} must not use browser state directly`);
}
for(const name of ['storage/03-ledger-foundation.js','storage/03-calibration-store.js']) {
  assert.doesNotMatch(source(name),/from ['"]\.\.\/ui\//,`${name} must not import UI`);
}
assert.doesNotMatch(source('runtime/02-profiling.js'),/\bfunction renderPerformance\(/);
assert.match(source('ui/16-panel-rendering.js'),/\bfunction renderPerformance\(/);
assert.doesNotMatch(source('storage/03-calibration-store.js'),/\bfunction saveEndedChatSample\(/);
assert.match(source('app/03-calibration-command.js'),/\bfunction saveEndedChatSample\(/);
const app = source('app/17-spa-observer-startup.js');
assert.match(app,/setStorageFailureNotifier\(showToast\)/);
assert.match(app,/initializeCaptureState\(loadSettings\(\), getChatKey\(\)\)/);

const test = String.raw`
  import assert from 'node:assert/strict';
  // Imports must be safe with neither a browser nor readable storage.
  for(const key of ['window','document','location','localStorage','performance'])
    Object.defineProperty(globalThis,key,{configurable:true,get(){throw Error('Import touched '+key);}});
  const capture = await import('./src/runtime/01-runtime-capture-state.js');
  const profiling = await import('./src/runtime/02-profiling.js');
  const warnings = await import('./src/runtime/01-runtime-ledger-state.js');
  const ledger = await import('./src/storage/03-ledger-foundation.js');
  const calibration = await import('./src/storage/03-calibration-store.js');
  assert.equal(capture.currentChatKey,null);
  assert.equal(capture.settings.normalBudget,120000);
  assert.equal(typeof profiling.perfStart,'function');
  assert.equal(typeof calibration.effectiveBudgets,'function');
  const readKeys=[];
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem(key){readKeys.push(key);return key.endsWith(':settings:v1')?'{"normalBudget":222000}':null;}
  }});
  Object.defineProperty(globalThis,'location',{configurable:true,value:{
    pathname:'/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  }});
  const {loadSettings}=await import('./src/storage/03-settings-store.js');
  assert.equal(readKeys.length,0,'import did not load settings');
  capture.initializeCaptureState(loadSettings(),ledger.getChatKey());
  assert.equal(readKeys.length,1,'startup loads settings once');
  assert.equal(capture.settings.normalBudget,222000);
  assert.equal(capture.currentChatKey,'chat:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  const messages=[];
  warnings.setStorageFailureNotifier((message,ms)=>messages.push([message,ms]));
  ledger.reportStorageFailure(capture.currentChatKey,'Synthetic storage error');
  ledger.reportStorageFailure(capture.currentChatKey,'Second error');
  assert.deepEqual(messages,[['Synthetic storage error',12000]],'first error toast only');
  assert.equal(ledger.storageProblem(capture.currentChatKey),'Second error',
    'persistent warning retains latest storage reason');
  console.log('PASS runtime import without browser IO, explicit startup initialization, storage warning callback');
`;
const native=spawnSync(process.execPath,['--input-type=module','-e',test],{
  cwd:root,encoding:'utf8',timeout:10000
});
assert.equal(native.status,0,native.stderr||native.stdout||String(native.error));
process.stdout.write(native.stdout);
console.log('PASS Stage 2 dependency direction and application-owned calibration command');
