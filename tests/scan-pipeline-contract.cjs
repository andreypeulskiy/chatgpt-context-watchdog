'use strict';
// Current-source scan orchestration contracts: collector -> capture -> persistence.
// All side effects are mocked; no browser, network, or durable storage touched.
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {source}=require('./support/module-source.cjs');
const currentScan=source('11-message-scan.js');
const norm=source('09-dom-message-identity.js').match(/  \/\*\* WATCHDOG_CONTRACT: normalize one[\s\S]*$/)[0];
function execute(source, config={}) {
  const calls=[];
  const n1={name:'u'}, n2={name:'a'};
  const nodes=[n1,n2];
  const identities=new WeakMap([[n1,{id:'msg:U',role:'user'}],[n2,{id:'msg:A',role:'assistant'}]]);
  const collected={nodes,identities,ambiguousIds:new Set(),rawCount:2};
  const state={chatKey:'chat:A',messages:{},files:{},domImages:{}};
  const fakeTurn={};
  const sandbox={
    Date:{now:()=>1000},
    perfStart:()=>0,perfEnd:name=>calls.push(['perf',name]),
    isWatchdogPaused:()=>false,
    synchronizeChatRoute:()=>config.syncRedirect??false,
    routeVerifiedOrWait:()=>!config.unverified,
    finishRouteTransition:()=>calls.push(['finishRoute']),
    currentChatKey:config.noChat?null:'chat:A',
    runtime:{phase:'initial'},
    setSessionPhase(phase) { sandbox.runtime.phase=phase; },
    getComposerMode:()=>config.mode??'ready',
    collectMessageNodes:()=>{calls.push(['collect']);return collected;},
    rememberCollected:()=>calls.push(['remember']),
    markInspectionDone:has=>calls.push(['inspected',has]),
    loadState:()=>state,
    render:(...args)=>calls.push(['render',args.length]),
    scanConversationImages:entries=>{calls.push(['images',entries.map(x=>x.id).join(',')]);return !!config.imageChanged;},
    scanConversationFiles:entries=>{calls.push(['files',entries.map(x=>x.id).join(',')]);return {changed:!!config.fileChanged,inspected:[{turn:fakeTurn,messageId:'msg:U'}]};},
    captureMessages:entries=>{calls.push(['capture',entries.map(x=>x.id).join(',')]);return !!config.messageChanged;},
    saveState:()=>{calls.push(['save']);return config.persist!==false;},
    stats:()=>{calls.push(['stats']);return {turns:2};},
    effectiveBudgets:()=>{calls.push(['budgets']);return {normal:120000};},
    inspectedFileTurns:{set:(_,v)=>calls.push(['fileSeen',v])},
    dirtyFileTurns:{delete:()=>calls.push(['dirtyCleared'])},
    perf:{enabled:!!config.profiling,noChangeScans:0},
    lastBackfillDeferred:42,
    failedScanDraft:null,
    resetEpoch:()=>0,
    revisionTargets:new Map(),
    completedRevisions:new Map(),
    pendingFileResults:new Map(),
    retryPendingFileResults:()=>{},
    queueCommittedFileJobs:()=>{}, rememberSentFile:()=>{},
    trustedCollectedMessageId:(id,collected)=>!!id&&!collected.ambiguousIds.has(id),
    lastScanReason:'pre',lastCommit:null,
    identifiedMessages:function*(xs){for(const [index,el] of xs.entries()) yield {el,index,role:'user',id:'msg:U'};}
  };
  vm.createContext(sandbox);
  vm.runInContext(norm+source+'\nscanMessages({commitCompleted:'+!!config.completed+',backfill:'+!!config.backfill+',reason:"test"'+(config.preCollected?',collected:fixtureCollected':'')+'});',
    Object.assign(sandbox,{fixtureCollected:collected}));
  return {calls,phase:sandbox.runtime.phase,commit:JSON.parse(JSON.stringify(sandbox.lastCommit)),
    scanReason:sandbox.lastScanReason, deferred:sandbox.lastBackfillDeferred,
    noChangeScans:sandbox.perf.noChangeScans};
}
let count=0;
function check(name,config,verify){
 const result=execute(currentScan,config);
 verify(result);
 console.log('PASS',name);count++;
}
const eventNames=result=>result.calls.map(call=>call[0]);
const has=(result,name)=>eventNames(result).includes(name);
const expectPhase=(result,phase)=>assert.equal(result.phase,phase);
const expectNoWrite=result=>assert.equal(has(result,'save'),false);
check('route transition aborts before touching DOM',{syncRedirect:true},r=>{
  expectNoWrite(r);
  assert.deepEqual(eventNames(r),['perf']);
  assert.equal(r.commit,null);
});
check('unverified destination never captures outgoing DOM',{unverified:true},r=>{
  assert.deepEqual(eventNames(r),['perf']);
  assert.equal(r.commit,null);
});
check('missing chat key defers capture',{noChat:true},r=>{
  expectPhase(r,'awaiting-uuid');
  expectNoWrite(r);
  assert.equal(has(r,'collect'),false);
});
check('generation in progress cannot persist',{mode:'generating'},r=>{
  expectPhase(r,'generating');
  expectNoWrite(r);
  assert.equal(has(r,'capture'),false);
});
check('inspection without completion evidence is read-only',{},r=>{
  expectPhase(r,'ready');
  expectNoWrite(r);
  assert.equal(has(r,'collect'),true);
  assert.equal(has(r,'capture'),false);
  assert.equal(r.commit.added,0);
});
check('completed capture persists before rendering statistics',{
  completed:true,messageChanged:true
},r=>{
  assert.equal(eventNames(r).filter(n=>n==='collect').length,1);
  assert.equal(eventNames(r).filter(n=>n==='save').length,1);
  for(const name of ['images','files','capture','fileSeen','stats','budgets']) assert.equal(has(r,name),true,name);
  assert.ok(eventNames(r).indexOf('save')<eventNames(r).indexOf('stats'));
  assert.equal(r.deferred,0);
});
check('unknown composer mode can backfill with explicit evidence',{
  mode:'unknown',backfill:true,messageChanged:true
},r=>{
  expectPhase(r,'unknown');
  assert.equal(has(r,'save'),true);
  assert.equal(has(r,'capture'),true);
});
check('unsupported composer mode is read-only',{
  mode:'other',completed:true
},r=>{
  expectPhase(r,'other');
  expectNoWrite(r);
  assert.equal(has(r,'capture'),false);
});
check('unchanged scan avoids storage writes',{
  completed:true,profiling:true
},r=>{
  expectNoWrite(r);
  assert.equal(has(r,'capture'),true);
  assert.equal(r.noChangeScans,1);
});
check('attachment metadata changes commit before reporting',{
  completed:true,imageChanged:true,fileChanged:true
},r=>{
  assert.equal(has(r,'save'),true);
  assert.ok(eventNames(r).indexOf('save')<eventNames(r).indexOf('stats'));
  assert.equal(has(r,'dirtyCleared'),true);
});
check('failed storage commit does not mark message as committed',{
  completed:true,messageChanged:true,persist:false
},r=>{
  assert.equal(has(r,'save'),true);
  assert.equal(has(r,'stats'),false);
  assert.equal(has(r,'fileSeen'),false);
  assert.equal(r.commit.failed,true);
  assert.match(r.scanReason,/STORAGE WRITE FAILED/);
});
check('provided collection is reused without rescanning',{
  completed:true,messageChanged:true,preCollected:true
},r=>{
  assert.equal(has(r,'collect'),false);
  assert.equal(has(r,'capture'),true);
  assert.equal(has(r,'save'),true);
});
console.log(count,'current scan orchestration contract scenarios passed');
