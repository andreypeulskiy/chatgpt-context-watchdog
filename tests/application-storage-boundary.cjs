'use strict';
// real ESM command boundaries and transient promotion durability.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const read=part=>fs.readFileSync(path.join(root,'src',part),'utf8');
for(const name of ['app/03-calibration-command.js','app/10-audit-repair.js',
  'storage/03-chat-transition.js','app/11-chat-transition.js']) {
  assert.doesNotMatch(read(name),/from\s+['"]\.\.\/ui\//,`${name} must not import UI`);
}
assert.doesNotMatch(read('storage/03-chat-transition.js'),/from\s+['"]\.\.\/app\//);
assert.doesNotMatch(read('storage/03-chat-transition.js'),/cancelAnimationFrame|setCurrentChatKey/);
assert.match(read('app/11-route-navigation.js'),/from ['"]\.\/11-chat-transition\.js['"]/);
assert.match(read('ui/15-panel-audit-actions.js'),/requestPanelConfirmation\(prepared\.message/);
const script=String.raw`
  import assert from 'node:assert/strict';
  const messages=new Map();
  let failNext=false;
  let rejectWriteNumber=0;
  let writeCount=0;
  globalThis.localStorage={
    getItem(key){return messages.get(key)??null;},
    setItem(key,value){writeCount++;if(failNext || writeCount===rejectWriteNumber){failNext=false;rejectWriteNumber=0;throw Error('one-shot failure');}messages.set(key,String(value));},
    removeItem(key){messages.delete(key);},key(i){return [...messages.keys()][i];},
    get length(){return messages.size;}
  };
  globalThis.location={pathname:'/'};
  globalThis.document={title:'Fixture chat'};
  const [{initializeCaptureState,currentChatKey,setTransientState}, {DEFAULTS},
    {loadState}, {saveState}, {changeChatKey,retryTransientPromotion},
    {pendingTransientPromotions,invalidateLedgerJobs}, {saveEndedChatSample},
    {prepareShortRecordRepair,prepareUndoLastAuditRepair}, {setChatAvailable}]=await Promise.all([
    import('./src/runtime/01-runtime-capture-state.js'),
    import('./src/runtime/01-runtime-configuration.js'),
    import('./src/storage/03-ledger-repository.js'),
    import('./src/storage/03-ledger-commit.js'),
    import('./src/app/11-chat-transition.js'),
    import('./src/runtime/01-runtime-ledger-state.js'),
    import('./src/app/03-calibration-command.js'),
    import('./src/app/10-audit-repair.js'),
    import('./src/runtime/01-runtime-pause-state.js')
  ]);
  const chatA='chat:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const chatB='chat:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const msg='msg:11111111-1111-1111-1111-111111111111';
  initializeCaptureState({...DEFAULTS},null);
  setChatAvailable(true);
  const unsaved=loadState();
  unsaved.messages[msg]={role:'user',tokens:11,chars:30,fingerprint:'v3:fixture'};
  assert.equal(saveState(unsaved),true);
  failNext=true;
  assert.equal(changeChatKey(chatA),true);
  assert.equal(pendingTransientPromotions.has(chatA),true);
  assert.equal(loadState(chatA).messages[msg],undefined);
  // A pending promotion is not applied to a different chat.
  assert.equal(retryTransientPromotion(chatB),true);
  assert.equal(loadState(chatB).messages[msg],undefined);
  assert.equal(retryTransientPromotion(chatA),true);
  assert.equal(pendingTransientPromotions.has(chatA),false);
  assert.equal(loadState(chatA).messages[msg].tokens,11);
  assert.equal(loadState(chatA).repairHistory.length,0);
  assert.equal(retryTransientPromotion(chatA),true);
  assert.equal(Object.keys(loadState(chatA).messages).length,1);
  // A later reset invalidates a failed promotion even if the original UUID returns.
  changeChatKey(null);
  setTransientState({...loadState(),messages:{[msg]:{role:'user',tokens:99,chars:300,fingerprint:'v3:other'}}});
  failNext=true;
  changeChatKey(chatB);
  assert.equal(pendingTransientPromotions.has(chatB),true);
  invalidateLedgerJobs(chatB);
  assert.equal(retryTransientPromotion(chatB),false);
  assert.equal(pendingTransientPromotions.has(chatB),false);
  assert.equal(loadState(chatB).messages[msg],undefined);
  assert.ok(writeCount>=2);
  // Audit commands never open a dialog: the UI presents the returned intent.
  assert.equal(prepareShortRecordRepair().status,'not-ready');
  // No repair history exists on the destination, so Undo is unavailable.
  globalThis.location.pathname='/c/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  assert.equal(prepareUndoLastAuditRepair().status,'none');
  // No current-chat UUID: Calibration reports outcome instead of touching UI.
  changeChatKey(null);
  assert.equal(saveEndedChatSample('Sample').status,'missing-chat');
  changeChatKey(chatA);
  globalThis.location.pathname='/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const sample=saveEndedChatSample('Sample title');
  assert.equal(sample.status,'saved');
  assert.equal(sample.count,1);
  const historyKey='cgpt-context-watchdog:ended-history:v2';
  const beforeHistory=messages.get(historyKey);
  assert.equal(Object.hasOwn(JSON.parse(beforeHistory)[0], 'title'), false);
  failNext=true;
  assert.equal(saveEndedChatSample('Unpersisted title').status,'storage-failed');
  assert.equal(messages.get(historyKey),beforeHistory);
  // Settings write fails after history has been written: rollback the sample.
  rejectWriteNumber=writeCount+2;
  assert.equal(saveEndedChatSample('Settings rejected').status,'storage-failed');
  assert.equal(messages.get(historyKey),beforeHistory);
  console.log('PASS native  command and transient-promotion contracts');
`;
const run=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:15000});
assert.equal(run.status,0,run.stderr||run.stdout||String(run.error));
process.stdout.write(run.stdout);
console.log('PASS Application/Storage direction and native ESM behavior');
