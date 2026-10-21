'use strict';
const assert=require('node:assert/strict');
const {isolatedModules,silentPanelRendering}=require('./support/isolated-esm.cjs');
const chatKey='chat:11111111-1111-4111-8111-111111111111';
const messageId='msg:22222222-2222-4222-8222-222222222222';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture() {
 const bytes=new Map(), listeners={};let rejectWrites=false;
 const realm=await isolatedModules({
  console:{...console,warn(){}},location:{pathname:'/c/'+chatKey.slice(5)},
  localStorage:{getItem:k=>bytes.get(k)??null,removeItem:k=>bytes.delete(k),setItem(k,v){
   if(rejectWrites)throw Error('transient write failure');bytes.set(k,String(v));
  }},
  document:{querySelectorAll:()=>[],addEventListener(type,fn){listeners[type]=fn;}},
  getComputedStyle:()=>({visibility:'visible'})
 },{'ui/16-panel-rendering.js':silentPanelRendering()});
 const capture=realm.module('runtime/01-runtime-capture-state.js');
 capture.initializeCaptureState({...realm.module('runtime/01-runtime-configuration.js').DEFAULTS},chatKey);
 realm.module('runtime/01-runtime-pause-state.js').setChatAvailable(true);
 return {realm,capture,listeners,reject:v=>rejectWrites=v,
  files:realm.module('attachments/06-attachment-reading.js'),
  ledger:realm.module('storage/03-ledger-repository.js'),
  pending:realm.module('runtime/01-runtime-ui-state.js').pendingLocalFiles};
}
async function suspend(f) {
 let finish,reads=0;
 const file={name:'review.txt',size:100,type:'text/plain',lastModified:1,
  text(){reads++;return reads===1?new Promise(resolve=>{finish=resolve;}):Promise.resolve('text '.repeat(20));}};
 const task=f.files.rememberSentFile(file,'file-input',chatKey,messageId);
 assert.equal(reads,1);f.capture.settings.watchdogPaused=true;finish('text '.repeat(20));await task;
 assert.equal(Object.values(f.ledger.loadState(chatKey).files)[0].status,'reading');
 f.capture.settings.watchdogPaused=false;
 return ()=>reads;
}
(async()=>{
 {
  const f=await fixture(),reads=await suspend(f);
  f.reject(true);f.files.resumePausedFileJobs();await flush();assert.equal(reads(),1);
  f.reject(false);f.files.resumePausedFileJobs();await flush();
  assert.equal(reads(),2);assert.equal(Object.values(f.ledger.loadState(chatKey).files)[0].status,'ready');
  f.files.resumePausedFileJobs();await flush();assert.equal(reads(),2);
  console.log('PASS resumed File survives failed reading commit and completes exactly once');
 }
 for(const invalidation of ['epoch','missing-entry']) {
  const f=await fixture(),reads=await suspend(f);
  if(invalidation==='epoch')f.realm.module('runtime/01-runtime-ledger-state.js').invalidateLedgerJobs(chatKey);
  else {const state=f.ledger.loadState(chatKey);state.files={};assert.equal(f.realm.module('storage/03-ledger-commit.js').saveState(state),true);}
  f.files.resumePausedFileJobs();await flush();assert.equal(reads(),1);
  if(invalidation==='missing-entry')assert.equal(Object.keys(f.ledger.loadState(chatKey).files).length,0);
  console.log('PASS paused File cancelled after '+invalidation);
 }
 for(const kind of ['standard','generic','hidden','unrelated']) {
  for(const action of ['click','keydown','submit']) {
   const f=await fixture();
   const visible=()=>({isConnected:true,getClientRects:()=>kind==='hidden'?[]:[{}],closest:()=>null});
   const main=visible(),editor=visible();
   const card={isConnected:true,getClientRects:()=>[{}],closest:()=>null,
    getAttribute:k=>k==='title'?'review.txt':null,textContent:'review.txt'};
   const form={...visible(),matches:s=>kind==='standard'&&s==='form[data-chatgpt-composer]',
    closest:s=>s==='main'&&kind!=='unrelated'?main:s==='form'?form:null,
    querySelectorAll:s=>s==='#prompt-textarea'?[]:s==='[contenteditable="true"][role="textbox"]'?[editor]:[card]};
   const button={disabled:false,closest:s=>s==='form'?form:s.includes('button')?button:null};
   editor.closest=s=>s==='form'?form:s.includes('contenteditable')?editor:null;
   f.pending.push({file:{name:'review.txt'},chatKey,selectedAt:Date.now(),submittedAt:0,used:false});
   f.files.installFileWatchers();
   f.listeners[action]({target:action==='click'?button:action==='submit'?form:editor,key:'Enter'});
   assert.equal(f.pending.length,1,'unrecognized composer must not discard selected File');
   assert.equal(f.pending[0].submittedAt>0,['standard','generic'].includes(kind));
  }
  console.log('PASS '+kind+' composer: Send / Enter / submit');
 }
 // The chip may be a sibling of the form, beneath the same composer-background.
 // Never match hidden React copies or attachment cards in a different form.
 for (const kind of ['inside-form','visible-background','hidden-card','hidden-background',
                      'other-form','unrelated-background','removed-card','paused']) {
  const f=await fixture();
  const visible=show=>({isConnected:true,getClientRects:()=>show?[{}]:[],
    closest:()=>null});
  let otherForm=null;
  const card={...visible(kind!=='hidden-card'),
    closest:selector=>selector==='form'?otherForm:null,
    getAttribute:k=>k==='title'?'review.txt':null,textContent:'review.txt'};
  const bg={...visible(kind!=='hidden-background'),
    querySelectorAll:()=>kind==='removed-card'?[]:[card]};
  const form={...visible(true),
    closest:selector=>selector==='#composer-background' && kind!=='unrelated-background'?bg:null,
    querySelectorAll:()=>kind==='inside-form'?[card]:[]};
  if(kind==='other-form')otherForm={};
  const expected=['inside-form','visible-background','paused'].includes(kind);
  assert.equal(f.files.composerContainsFile(form,'review.txt'),expected,kind);
  f.pending.push({file:{name:'review.txt'},chatKey,selectedAt:Date.now(),submittedAt:0,used:false});
  if(kind==='paused')f.capture.settings.watchdogPaused=true;
  f.files.submittedLocalFiles(form);
  const marked=kind!=='paused'&&expected;
  assert.equal(f.pending[0]?.submittedAt>0,marked,kind);
  if(kind==='paused')assert.equal(f.pending.length,1,'Pause preserves draft without reading');
  else if(!expected)assert.equal(f.pending.length,0,'Absent/hidden/wrong card cancels draft');
  console.log('PASS composer file-card scope: '+kind);
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
