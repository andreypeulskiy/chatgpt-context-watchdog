'use strict';
// Focused production-function regressions for generations and long answers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname,'..');
const source = require('./support/module-source.cjs').source;
function extract(text,name) {
  const start = new RegExp('^  function '+name+'\\(','m').exec(text);
  assert.ok(start,name);
  const end=/\n  }(?=\n)/g;end.lastIndex=start.index;
  const stop=end.exec(text);assert.ok(stop,name+' boundary');
  return text.slice(start.index,stop.index+4);
}
function test(name,fn) {fn();console.log('PASS',name);}

test('N1: explicit clicks assign a distinct generation, even for the same UUID',()=>{
  const id='msg:AI';
  const turn={contains:el=>el===message};
  const message={contains:()=>false};
  const button={getAttribute:key=>key==='aria-label'?'Regenerate response':'',
    closest:selector=>selector.includes("data-message-id")?turn:null};
  const ctx={isWatchdogPaused:()=>false,revisionTargets:new Map(),completedRevisions:new Map(),revisionGeneration:0,APP:'cgpt-context-watchdog',
    collectMessageNodes:()=>({nodes:[message]}),
    identifiedMessages:function*(){yield {el:message,id,role:'assistant'};}};
  vm.createContext(ctx);
  vm.runInContext(source('09-dom-revision-controls'),ctx);
  const event={target:{closest:()=>button}};
  ctx.markRevisionFromClick(event);
  const first=ctx.revisionTargets.get(id);
  ctx.markRevisionFromClick(event);
  assert.ok(ctx.revisionTargets.get(id)>first);
  assert.equal(ctx.revisionTargets.size,1);
});

function fileFixture() {
  let now=10_000_000, epoch=0, mode='generating', committedFiles={};
  const jobs=[],associated=[], saves=[];
  const file={name:'long-answer.txt',size:128,type:'text/plain',lastModified:10};
  const card={name:file.name,size:file.size,closest:()=>null};
  const turn={querySelectorAll:()=>[card]};
  const old={querySelectorAll:()=>[]};
  const collected={nodes:[old],ambiguousIds:new Set(),
    identities:new WeakMap([[old,{role:'user',id:'msg:OLD'}],
      [turn,{role:'user',id:'msg:NEW'}]])};
  const ctx={
    APP:'cgpt-context-watchdog',Date:{now:()=>now}, currentChatKey:'A',
    isWatchdogPaused:()=>false,
    isVisibleChatElement:el=>!!el?.isConnected && !!el.getClientRects?.().length,
    settings:{localFileParsingLimitMiB:75},pendingLocalFiles:[],
    inspectedFileTurns:new WeakMap(),dirtyFileTurns:new WeakSet(),
    corruptLedgerKeys:new Set(),perf:{enabled:false},perfStart:()=>0,perfEnd:()=>{},
    LOCAL_FILE_SUBMISSION_WINDOW_MS:120000,LOCAL_FILE_SELECTION_WINDOW_MS:900000,
    getFileKey:f=>`${f.name}:${f.size}`,
    collectMessageNodes:()=>collected,
    structuralMessageIds:nodes=>new Set(nodes.map(node=>collected.identities.get(node)?.id)),
    loadState:()=>({messages:{'msg:OLD':{}},files:committedFiles}),
    normalizeFileName:name=>String(name||'').trim().toLowerCase(),
    fileSizesCompatible:(a,b)=>a===b,
    fileMetadataFromElement:el=>({name:el.name,size:el.size,type:'text/plain'}),
    resetEpoch:()=>epoch,
    hash32:s=>s,
    isAutoPasteName:()=>false,
    queueMicrotask:fn=>jobs.push(fn),
    rememberSentFile:(...args)=>{associated.push(args);args[4]?.(true);},
    retryTransientPromotion:()=>true,
    synchronizeChatRoute:()=>false,routeVerifiedOrWait:()=>true,
    getComposerMode:()=>mode,
    normalizeCollectedMessageEntries:snapshot=>snapshot.nodes.map((el,index)=>({
      el,index,...snapshot.identities.get(el)})),
    trustedCollectedMessageId:(id,snapshot)=>!!id&&!snapshot.ambiguousIds.has(id),
    runtime:{work:{completion:false,initial:false,backfill:false},route:null},
    setCompletionPending(value){ctx.runtime.work.completion=value;},
    setSessionPhase:()=>{},updateVisibleSessionPhase:()=>{},
    document:{hidden:false},render:()=>{},
    saveState:(...args)=>saves.push(args)
  };
  vm.createContext(ctx);
  vm.runInContext(source('05-attachment-submission')+'\n'+source('05-attachment-scan')+'\n'+source('06-attachment-reading')+'\n'+
    extract(source('17-conversation-coordinator'),'onConversationEvent'),ctx);
  ctx.rememberSentFile=(...args)=>{associated.push(args);args[4]?.(true);}; // acknowledge durable reading state
  const composer={isConnected:true,getClientRects:()=>[{}],closest:()=>null,
    querySelectorAll:()=>[{
      isConnected:true,getClientRects:()=>[{}],
      getAttribute:k=>k==='title'?file.name:null,closest:()=>null,textContent:file.name
    }]};
  return {ctx,file,collected,jobs,associated,saves,stage(){
    ctx.stageLocalFile(file,'file-input');ctx.submittedLocalFiles(composer);
    collected.nodes.push(turn); // The new UUID only appears after submission.
    assert.ok(ctx.pendingLocalFiles[0].submittedAt);
  },time(ms){now+=ms;},epoch(){epoch++;},mode(value){mode=value;},
  scan(){const state={chatKey:'A',files:{}};
    const entries=[{el:old,id:'msg:OLD',role:'user'},
      {el:turn,id:'msg:NEW',role:'user'}].filter(entry=>
      ctx.trustedCollectedMessageId(entry.id,collected));
    const result=ctx.scanConversationFiles(entries,state);
    assert.equal(jobs.length,0,'reading must wait for commit');
    committedFiles=state.files; // simulated successful metadata commit
    ctx.queueCommittedFileJobs(result.jobs, ctx.rememberSentFile);
    return {state, result};}}
}

test('N2: newly mounted user card is bound while assistant generates; no ledger save',()=>{
  const f=fileFixture();f.stage();f.ctx.onConversationEvent();
  assert.equal(f.ctx.pendingLocalFiles[0].boundMessageId,'msg:NEW');
  assert.equal(f.saves.length,0);
});

test('N2: hidden tab can confirm user UUID without saving streaming messages',()=>{
  const f=fileFixture();f.stage();f.ctx.document.hidden=true;
  f.ctx.onConversationEvent();
  assert.equal(f.ctx.pendingLocalFiles[0].boundMessageId,'msg:NEW');
  assert.equal(f.saves.length,0);
  f.time(121000);
  f.scan();
  assert.equal(f.jobs.length,1);
});

test('N2: 121 seconds after send, verified binding still starts local file reading',()=>{
  const f=fileFixture();f.stage();f.ctx.onConversationEvent();
  f.time(121000);
  assert.equal(f.ctx.isActiveSubmittedFile(f.ctx.pendingLocalFiles[0],'A'),false);
  const {state}=f.scan();
  assert.equal(f.jobs.length,1);
  assert.equal(f.ctx.pendingLocalFiles[0].used,false);
  f.jobs.shift()();
  assert.equal(f.ctx.pendingLocalFiles.length,0);
  assert.equal(f.associated.length,1);
  assert.equal(f.associated[0][3],'msg:NEW');
  assert.ok(Object.values(state.files).some(entry=>entry.messageId==='msg:NEW'));
});

test('N2: queued file work cannot revive an association cleared by Wipe',()=>{
  const f=fileFixture();f.stage();f.ctx.onConversationEvent();
  f.scan();
  assert.equal(f.jobs.length,1);
  f.ctx.pendingLocalFiles.length=0; // Confirmed full wipe invalidates drafts.
  f.epoch();
  f.jobs.shift()();
  assert.equal(f.associated.length,0);
});

test('N2: queued file work cannot survive a chat reset epoch',()=>{
  const f=fileFixture();f.stage();f.ctx.onConversationEvent();
  f.scan();
  assert.equal(f.jobs.length,1);
  f.epoch();
  f.jobs.shift()();
  assert.equal(f.associated.length,0);
});

test('N2: 119-second fallback still binds at normal finished scan',()=>{
  const f=fileFixture();f.stage();f.time(119000);
  assert.equal(f.ctx.pendingLocalFiles[0].boundMessageId,null);
  f.scan();
  assert.equal(f.jobs.length,1);
});

test('N2: expired unbound / ambiguous / historical / mismatched files never attach',()=>{
  for (const condition of ['expired','ambiguous','historical','size']) {
    const f=fileFixture();f.stage();
    if(condition==='ambiguous') f.collected.ambiguousIds.add('msg:NEW');
    if(condition==='historical') f.ctx.pendingLocalFiles[0].existingMessageIds.add('msg:NEW');
    if(condition==='size') f.file.size=456;
    if(condition!=='expired') f.ctx.onConversationEvent();
    if(condition==='expired') f.time(121000);
    const {state}=f.scan();
    assert.equal(f.jobs.length,0,condition);
    assert.ok(Object.values(state.files).every(x=>x.metadataOnly),condition);
  }
});

test('N2: binding from another chat or reset epoch cannot be promoted',()=>{
  for(const invalidate of ['chat','epoch']) {
    const f=fileFixture();f.stage();f.ctx.onConversationEvent();
    if(invalidate==='chat') f.ctx.pendingLocalFiles[0].chatKey='B';
    else f.epoch();
    f.time(121000);
    f.scan();
    assert.equal(f.jobs.length,0,invalidate);
  }
});

test('N2: during generation only user-card changes schedule a binding pass',()=>{
  class Element {
    constructor(role){this.role=role;this.nodeType=1;}
    matches(selector){return selector==='USER_TURN'&&this.role==='user';}
    closest(selector){return selector==='USER_TURN'&&this.role==='user'?this:null;}
    querySelector(){return null;}
  }
  const ctx={Element,Node:{TEXT_NODE:3},APP:'cgpt-context-watchdog',
    document:{getElementById:()=>null},runtime:{phase:'generating',work:{}},
    currentChatKey:'A',FILE_USER_TURN_SELECTOR:'USER_TURN',
    pendingLocalFiles:[{submittedAt:1,used:false}],
    isActiveSubmittedFile:()=>true,isFinishedActionNode:()=>false};
  vm.createContext(ctx);
  vm.runInContext(extract(source('17-spa-observer-startup'),'mutationTouchesConversation'),ctx);
  assert.equal(ctx.mutationTouchesConversation({type:'childList',target:new Element('user'),addedNodes:[]}),true);
  assert.equal(ctx.mutationTouchesConversation({type:'childList',target:new Element('assistant'),addedNodes:[]}),false);
  assert.equal(ctx.mutationTouchesConversation({type:'characterData',target:new Element('user'),addedNodes:[]}),false);
});
