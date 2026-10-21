'use strict';
// One focused suite of production-code boundary scenarios; no UI/network dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const file = require('./support/module-source.cjs').source;
const keys = { state: 'cgpt-context-watchdog:state:v2:', history: 'cgpt-context-watchdog:history' };
const uuid = x => x.repeat(8)+'-'+x.repeat(4)+'-'+x.repeat(4)+'-'+x.repeat(4)+'-'+x.repeat(12);
const chatA = 'chat:'+uuid('a');
const chatB = 'chat:'+uuid('b');
const msgUser = 'msg:'+uuid('1');
const msgAI = 'msg:'+uuid('2');
const production = [
  '03-storage-io','03-ledger-foundation','03-ledger-schema','03-ledger-validation',
  '03-ledger-repository','03-ledger-merge','03-ledger-commit',
  '03-calibration-store','09-dom-message-identity',
  '11-message-completion-context','11-message-ledger-commit',
  '11-message-capture','11-route-inspection','11-message-scan',
  '05-attachment-scan','09-dom-image-accounting'
].map(file).join('\n');
const func = (text,name) => {
  const start = new RegExp('^  function '+name+'\\(','m').exec(text);
  assert.ok(start,name);
  const end = /\n  }(?=\n)/g; end.lastIndex = start.index;
  const stop=end.exec(text);assert.ok(stop,name+' closing brace');
  return text.slice(start.index,stop.index+4);
};
const events = func(file('01-runtime-ledger-state'),'resetEpoch') + '\n' +
  func(file('17-conversation-coordinator'),'onConversationEvent') + '\n' +
  file('03-chat-transition') + '\n' + file('11-chat-transition');
function fixture(options={}) {
  const bytes = new Map();
  let failOnce=false;
  const localStorage = {
    getItem(k) {return bytes.get(k)??null;},
    setItem(k,v) {if(failOnce){failOnce=false;throw new Error('one-shot quota rejection');}bytes.set(k,String(v));},
    removeItem(k) {bytes.delete(k);}
  };
  const metricsCalls=[];const warnings=[];
  const latestMetrics = {tokens:options.tokens??200, chars:options.chars??500,
    fingerprint:'v3:test-new'};
  const seen = options.nodes || [];
  const collected={nodes:seen,identities:new WeakMap(),ambiguousIds:new Set()};
  const roles = options.roles||[];
  for(const [i,node] of seen.entries()) collected.identities.set(node,{role:roles[i]?.role,id:roles[i]?.id});
  const ctx={
    console:{warn:()=>{}}, Map,Set,WeakMap,WeakSet,Date,Math,JSON,Object,Number,
    HTMLImageElement:Object,
    APP:'cgpt-context-watchdog', currentChatKey:chatA, STATE_PREFIX:keys.state,
    HISTORY_KEY:keys.history, location:{pathname:'/c/'+uuid('a')},
    CHAT_PATH_RE:/(?:^|\/)c\/([0-9a-f-]{36})(?:\/|$)/i,
    localStorage, measuredStorageRead:key=>localStorage.getItem(key),
    perf:{enabled:false},perfStart:()=>null,perfEnd:()=>{},
    corruptLedgerKeys:new Set(),storageFailures:new Map(),ledgerReadSnapshots:new WeakMap(),
    ledgerResetEpochs:new Map(),pendingFileResults:new Map(),pendingTransientPromotions:new Map(),storageWarningShown:false,
    transientState:null,historyCache:null,historySummaryCache:null,calibrationHistoryCorrupt:false,
    showToast:text=>warnings.push(text), notifyStorageFailure:text=>warnings.push(text),
    settings:{averageImageTokens:2000},
    runtime:{phase:'ready',work:{initial:false,backfill:false,completion:false},route:null},
    revisionTargets:new Map(),completedRevisions:new Map(),revisionGeneration:0,failedScanDraft:null,hydrationCandidates:new Map(),
    lastCommit:null,lastScanReason:'',lastBackfillDeferred:0,
    lastUiSignals:{actions:null,stop:false,send:false},
    clearAuditConfirmation:()=>{},deferredConversationFrame:0,hydrationCheckTimer:0,
    cancelAnimationFrame:()=>{},clearTimeout:()=>{},
    inspectedFileTurns:new WeakMap(),dirtyFileTurns:new WeakSet(),
    inspectedImageTurns:new WeakMap(),dirtyImageTurns:new WeakSet(),watchedImageNodes:new WeakSet(),
    notifyImageRescan:()=>{}, setInspectedImageTurns:value=>{ ctx.inspectedImageTurns=value; },
    pendingLocalFiles:[],
    document:{hidden:false,title:'Test'},
    isWatchdogPaused:()=>false,
    synchronizeChatRoute:()=>false,routeVerifiedOrWait:()=>true,
    retryPendingFileResults:()=>{},queueCommittedFileJobs:()=>{},rememberSentFile:()=>{},
    collectMessageNodes:()=>collected,rememberCollected:()=>{},
    getComposerMode:()=> 'ready',hasLastAssistantActions:()=>true,
    render:()=>{},stats:()=>({}),effectiveBudgets:()=>({}),
    getCanonicalMessageMetrics:(el,role)=>{
      metricsCalls.push([el,role]);
      return {...latestMetrics,
        parts:{prose:'Finished content',code:'',source:'unit-markdown'}};
    },
    mayBackfillMessage:()=>true,
    normalizeText:s=>String(s).trim(),normalizeImageSrc:s=>s,
    normalizeFileName:s=>String(s||'').trim().toLowerCase(),
    hash32:s=>'hash-'+s, fileMetadataFromElement:()=>({name:'file.txt',size:128,type:'text/plain'}),
    fileSizesCompatible:(a,b)=>a===b,
    isAutoPasteName:()=>false,
    isLikelyConversationImage:()=>true,
    requestAnimationFrame:()=>0,
    currentBudgetValues:()=>({}),syncGroupInputs:()=>{}
  };
  vm.createContext(ctx);
  vm.runInContext(production+'\n'+events,ctx);
  const run = code=>vm.runInContext(code,ctx);
  const stateKey=keys.state+encodeURIComponent(chatA);
  return {ctx,bytes,localStorage,metricsCalls,latestMetrics,warnings,collected,run,stateKey,
    failNext:()=>{failOnce=true;}};
}
const msg = (tokens=10) => ({role:'assistant',tokens,chars:40,fingerprint:'v3:old'});
function test(name,fn) {fn();console.log('PASS',name);}

test('R1: rejected write keeps revision draft and the next event retries it',()=>{
  const old={querySelectorAll:()=>[]}, reply={querySelectorAll:()=>[]};
  const h=fixture({nodes:[old,reply],roles:[{role:'user',id:msgUser},{role:'assistant',id:msgAI}]});
  const st=h.ctx.loadState(); st.messages[msgUser]={role:'user',tokens:7,chars:16,fingerprint:'v3:user'};
  st.messages[msgAI]=msg(10);
  assert.equal(h.ctx.saveState(st),true);
  h.ctx.revisionTargets.set(msgAI,++h.ctx.revisionGeneration);
  h.ctx.runtime.work.completion=true;
  h.failNext();
  h.run('onConversationEvent()');
  assert.equal(JSON.parse(h.bytes.get(h.stateKey)).messages[msgAI].tokens,10);
  assert.equal(h.ctx.revisionTargets.has(msgAI),true);
  assert.ok(h.ctx.failedScanDraft);
  assert.equal(h.ctx.runtime.work.completion,false);
  assert.equal(h.run('needsInspection()'),true);
  assert.equal(h.metricsCalls.length,1); // known user UUID never retokenized
  h.run('onConversationEvent()');
  const result=JSON.parse(h.bytes.get(h.stateKey));
  assert.equal(result.messages[msgAI].tokens,200);
  assert.equal(result.messages[msgUser].tokens,7);
  assert.equal(h.ctx.failedScanDraft,null);
  assert.equal(h.ctx.revisionTargets.size,0);
  assert.equal(h.metricsCalls.length,1); // replay uses stored draft, not fresh text
});

test('N1: replay of revision 200 cannot consume newer revision 300 of the same UUID',()=>{
  const user={querySelectorAll:()=>[]}, reply={querySelectorAll:()=>[]};
  const h=fixture({nodes:[user,reply],roles:[{role:'user',id:msgUser},{role:'assistant',id:msgAI}]});
  const st=h.ctx.loadState();st.messages[msgAI]=msg(10);
  st.messages[msgUser]={role:'user',tokens:7,chars:16,fingerprint:'v3:user'};
  h.ctx.saveState(st);
  h.ctx.revisionTargets.set(msgAI,++h.ctx.revisionGeneration);
  h.ctx.runtime.work.completion=true;
  h.failNext();
  h.run('onConversationEvent()');
  assert.equal(h.ctx.failedScanDraft.state.messages[msgAI].tokens,200);
  assert.equal(h.ctx.loadState().messages[msgAI].tokens,10);
  // The new explicit operation finishes before the previous failed draft retries.
  h.latestMetrics.tokens=300;
  h.latestMetrics.chars=750;
  h.latestMetrics.fingerprint='v3:revision-300';
  h.ctx.revisionTargets.set(msgAI,++h.ctx.revisionGeneration);
  const newer=h.ctx.revisionTargets.get(msgAI);
  h.run('scanMessages({backfill:true})'); // replay 200; never recapture unfinished revision
  assert.equal(h.ctx.loadState().messages[msgAI].tokens,200);
  assert.equal(h.ctx.revisionTargets.get(msgAI),newer);
  assert.equal(h.metricsCalls.length,1);
  h.ctx.runtime.work.completion=true;
  h.run('onConversationEvent()');
  assert.equal(h.ctx.loadState().messages[msgAI].tokens,300);
  assert.equal(h.ctx.loadState().messages[msgAI].chars,750);
  assert.equal(h.ctx.loadState().messages[msgAI].fingerprint,'v3:revision-300');
  assert.equal(h.metricsCalls.length,2);
  assert.equal(h.ctx.revisionTargets.size,0);
});

test('R1: route change discards pending failed write before it can touch another chat',()=>{
  const el={querySelectorAll:()=>[]};
  const h=fixture({nodes:[el],roles:[{role:'assistant',id:msgAI}]});
  const st=h.ctx.loadState();st.messages[msgAI]=msg(10);h.ctx.saveState(st);
  h.ctx.revisionTargets.set(msgAI,++h.ctx.revisionGeneration);h.ctx.runtime.work.completion=true;h.failNext();
  h.run('onConversationEvent()');
  assert.ok(h.ctx.failedScanDraft);
  h.run('changeChatKey('+JSON.stringify(chatB)+')');
  assert.equal(h.ctx.failedScanDraft,null);
  assert.equal(h.ctx.revisionTargets.size,0);
  assert.equal(JSON.parse(h.bytes.get(h.stateKey)).messages[msgAI].tokens,10);
  assert.equal(h.bytes.get(keys.state+encodeURIComponent(chatB)),undefined);
});

test('R1: reset epoch invalidates a failed draft rather than restoring deleted bytes',()=>{
  const el={querySelectorAll:()=>[]};
  const h=fixture({nodes:[el],roles:[{role:'assistant',id:msgAI}]});
  const state=h.ctx.loadState();state.messages[msgAI]=msg(10);h.ctx.saveState(state);
  h.ctx.revisionTargets.set(msgAI,++h.ctx.revisionGeneration);h.ctx.runtime.work.completion=true;h.failNext();
  h.run('onConversationEvent()');
  assert.ok(h.ctx.failedScanDraft);
  h.bytes.delete(h.stateKey);h.ctx.ledgerResetEpochs.set(chatA,1);
  assert.equal(h.run('scanMessages({commitCompleted:false,backfill:false})').status,'unchanged');
  assert.equal(h.ctx.failedScanDraft,null);
  assert.equal(h.ctx.revisionTargets.size,0);
  assert.equal(h.bytes.has(h.stateKey),false);
});

test('R3: ambiguous user UUID produces no text/file/image; valid UUID is admitted once',()=>{
  const image={naturalWidth:200,naturalHeight:200,clientWidth:200,clientHeight:200,
    currentSrc:'blob:source',getAttribute:name=>name==='alt'?'picture':'blob:source',
    closest:()=>null};
  const attachment={closest:()=>null};
  const user={querySelectorAll:selector=>selector==='img'?[image]:[attachment]};
  const h=fixture({nodes:[user],roles:[{role:'user',id:msgUser}]});
  h.collected.ambiguousIds.add(msgUser);
  assert.equal(h.run('scanMessages({backfill:true})').status,'unchanged');
  assert.equal(h.ctx.loadState().messages[msgUser],undefined);
  assert.equal(Object.keys(h.ctx.loadState().files).length,0);
  assert.equal(Object.keys(h.ctx.loadState().domImages).length,0);
  assert.equal(h.metricsCalls.length,0);
  h.collected.ambiguousIds.clear();
  assert.equal(h.run('scanMessages({backfill:true})').status,'persisted');
  assert.equal(h.ctx.loadState().messages[msgUser].tokens,200);
  assert.equal(Object.keys(h.ctx.loadState().files).length,1);
  assert.equal(Object.keys(h.ctx.loadState().domImages).length,1);
  h.run('scanMessages({backfill:true})');
  assert.equal(Object.keys(h.ctx.loadState().files).length,1);
  assert.equal(Object.keys(h.ctx.loadState().domImages).length,1);
});

test('R5: malformed nested ledger is read-only; raw bytes never overwritten',()=>{
  const h=fixture();
  for(const value of [null,[],{role:'user',tokens:-500,chars:10},
    {role:'user',tokens:'Infinity',chars:10}]) {
    const payload={chatKey:chatA,attachmentLedgerVersion:2,
      messages:{[msgUser]:value},files:{},domImages:{},repairHistory:[]};
    const raw=JSON.stringify(payload);
    const k=h.stateKey;
    h.bytes.set(k,raw);h.ctx.corruptLedgerKeys.delete(chatA);
    const loaded=h.ctx.loadState();
    assert.equal(h.ctx.corruptLedgerKeys.has(chatA),true);
    assert.deepEqual(Object.keys(loaded.messages),[]);
    assert.equal(h.ctx.saveState(loaded),false);
    assert.equal(h.bytes.get(k),raw);
  }
  const good={chatKey:chatA,attachmentLedgerVersion:2,
    messages:{[msgUser]:{role:'user',tokens:10,chars:5,fingerprint:'v3:old'}},
    files:{F:{status:'ready',tokens:0}},domImages:{I:{width:20,height:20}},repairHistory:[]};
  h.bytes.set(h.stateKey,JSON.stringify(good));h.ctx.corruptLedgerKeys.delete(chatA);
  assert.equal(h.ctx.loadState().messages[msgUser].tokens,10);
});

test('R5: a null calibration sample never crashes totals or overwrites saved bytes',()=>{
  const h=fixture();
  const original='[null]';h.bytes.set(keys.history,original);
  assert.equal(h.ctx.loadHistory().length,0);
  assert.equal(h.ctx.historyStats().n,0);
  assert.equal(h.ctx.calibrationHistoryCorrupt,true);
  assert.equal(h.ctx.saveHistory([{
    chatKey:chatA,seen:10,optimistic:20,pessimistic:30
  }]),false);
  assert.equal(h.bytes.get(keys.history),original);
  // External correction is read after cache invalidation, never written by us.
  h.bytes.set(keys.history,JSON.stringify([{
    chatKey:chatA,seen:10,optimistic:20,pessimistic:30
  }]));
  h.ctx.historyCache=null;
  assert.equal(h.ctx.loadHistory().length,1);
  assert.equal(h.ctx.calibrationHistoryCorrupt,false);
  assert.equal(h.ctx.historyStats().n,1);
});

test('RC-1: completed revision survives old text, then commits newly hydrated text',()=>{
  const reply={querySelectorAll:()=>[]};
  const h=fixture({nodes:[reply],roles:[{role:'assistant',id:msgAI}]});
  const st=h.ctx.loadState(); st.messages[msgAI]=msg(10);h.ctx.saveState(st);
  const gen=++h.ctx.revisionGeneration;h.ctx.revisionTargets.set(msgAI,gen);
  // The first completion event still exposes the previous saved fingerprint.
  h.latestMetrics.tokens=10;h.latestMetrics.chars=40;
  h.latestMetrics.fingerprint='v3:old';
  h.ctx.runtime.work.completion=true;
  h.run('onConversationEvent()');
  assert.equal(h.ctx.loadState().messages[msgAI].tokens,10);
  assert.equal(h.ctx.revisionTargets.get(msgAI),gen);
  assert.equal(h.ctx.completedRevisions.get(msgAI),gen);
  assert.equal(h.run('needsInspection()'),true);
  // A later DOM hydration happens without another completion event.
  h.latestMetrics.tokens=300;h.latestMetrics.chars=750;
  h.latestMetrics.fingerprint='v3:new-dom';
  h.run('onConversationEvent()');
  assert.equal(h.ctx.loadState().messages[msgAI].tokens,300);
  assert.equal(h.ctx.loadState().messages[msgAI].chars,750);
  assert.equal(h.ctx.revisionTargets.size,0);
  assert.equal(h.ctx.completedRevisions.size,0);
});

test('RC-1: absent and empty revision DOM do not consume its completed generation',()=>{
  for (const initial of ['missing','empty']) {
    const reply={querySelectorAll:()=>[]};
    const h=fixture({nodes:[reply],roles:[{role:'assistant',id:msgAI}]});
    const st=h.ctx.loadState();st.messages[msgAI]=msg(10);h.ctx.saveState(st);
    const gen=++h.ctx.revisionGeneration;h.ctx.revisionTargets.set(msgAI,gen);
    if (initial==='missing') h.collected.nodes.length=0;
    else {h.latestMetrics.tokens=0;h.latestMetrics.chars=0;}
    h.ctx.runtime.work.completion=true;
    h.run('onConversationEvent()');
    assert.equal(h.ctx.revisionTargets.get(msgAI),gen,initial);
    assert.equal(h.ctx.loadState().messages[msgAI].tokens,10,initial);
    if (initial==='missing') h.collected.nodes.push(reply);
    h.latestMetrics.tokens=300;h.latestMetrics.chars=750;
    h.latestMetrics.fingerprint='v3:late';
    h.run('onConversationEvent()');
    assert.equal(h.ctx.loadState().messages[msgAI].tokens,300,initial);
    assert.equal(h.ctx.revisionTargets.size,0,initial);
  }
});
