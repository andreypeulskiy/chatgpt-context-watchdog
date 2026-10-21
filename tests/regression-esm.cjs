'use strict';
// Actual linked ES modules: SPA guard, draft file submission, byte-sampled file
// estimation and one-shot hydration. Only UI and event callbacks are stubbed.
const assert=require('node:assert/strict');
const {isolatedModules,silentPanelRendering}=require('./support/isolated-esm.cjs');
const uuid=d=>`${d.repeat(8)}-${d.repeat(4)}-${d.repeat(4)}-${d.repeat(4)}-${d.repeat(12)}`;
const mid=d=>`msg:${uuid(d)}`;
const oldId=mid('1'),oldNewId=mid('2'),freshId=mid('3'),reusedId=mid('4'), storedId=mid('5');
let passed=0;
const test=async(name,action)=>{await action();passed++;console.log('PASS',name);};
const storageMap=new Map();
const localStorage={
  getItem:k=>storageMap.get(k)??null,
  setItem:(k,v)=>storageMap.set(k,String(v)),
  removeItem:k=>storageMap.delete(k)
};
function message(id){return {
  id,
  getAttribute(k) {return k==='data-message-id'?this.id.slice(4):
    k==='data-message-author-role'?'user':null;},
  closest:()=>null,hasAttribute:()=>false,isConnected:true,
  getBoundingClientRect:()=>({width:240,height:30})
};}
let visible=[],now=1000;
const timers=[],queued=[],events=[];
const document={hidden:false,
  querySelectorAll(selector) {
    return selector.startsWith('main [data-message-id]') ? visible : [];
  }
};
class FixtureDate extends Date {static now(){return now;}}
function fakeEntry(id) {
  const name='same-name.txt', turn={parentElement:null};
  const leaf={textContent:name,parentElement:null,
    getAttribute:k=>k==='title'?name:null,
    closest:()=>null,querySelectorAll:()=>[]};
  const card={textContent:name,parentElement:turn,
    getAttribute:()=>null,closest:()=>null,querySelectorAll:()=>[leaf]};
  leaf.parentElement=card;
  leaf['__reactFiber$card']={memoizedProps:{attachment:{name,sizeBytes:8,mimeType:'text/plain'}},return:null};
  turn.contains=el=>[turn,card,leaf].includes(el);
  turn.querySelectorAll=()=>[card];
  return {role:'user',id,el:turn};
}
(async()=>{
  const realm=await isolatedModules({localStorage,document,Date:FixtureDate,
    getComputedStyle:()=>({visibility:'visible'}),
    location:{pathname:'/c/abc'},
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},
    queueMicrotask:fn=>queued.push(fn)
  },{
    'ui/16-panel-rendering.js':silentPanelRendering(),
    'app/17-conversation-coordinator.js':{
      queueConversationEvent:()=>events.push('event'),onConversationEvent:()=>{}
    }
  });
  const capture=realm.module('runtime/01-runtime-capture-state.js');
  capture.initializeCaptureState({...realm.module('runtime/01-runtime-configuration.js').DEFAULTS,
    averageImageTokens:900,localFileParsingLimitMiB:75},'B');
  // These linked modules are driven directly without browser startup; provide
  // the positive chat-availability state normally established at boot.
  realm.module('runtime/01-runtime-pause-state.js').setChatAvailable(true);
  const repository=realm.module('storage/03-ledger-repository.js');
  const save=realm.module('storage/03-ledger-commit.js').saveState;
  const session=realm.module('runtime/01-runtime-session-state.js');
  const navigation=realm.module('app/11-route-navigation.js');
  const oldKnown=message(oldId),oldNew=message(oldNewId);
  const beforeNodes=new WeakMap([[oldKnown,oldId],[oldNew,oldNewId]]);
  function createRoute(){return {beforeIds:new Set([oldId,oldNewId]),beforeNodes,
    outgoingKnownIds:new Set([oldId]),gate:null};}
  await test('SPA: old unsaved UUID still mounted does not confirm destination',()=>{
    session.runtime.route=createRoute();
    assert.equal(navigation.routeDomHasChanged({nodes:[oldNew]}),false);
    assert.equal(session.runtime.route.gate.reason,'outgoing DOM nodes still mounted');
  });
  await test('SPA: fresh destination UUID confirms after stale nodes vanish',()=>{
    assert.equal(navigation.routeDomHasChanged({nodes:[message(freshId)]}),true);
    assert.equal(session.runtime.route.gate.reason,'confirmed');
  });
  await test('SPA: outgoing-only UUID blocks a mixed destination snapshot',()=>{
    session.runtime.route=createRoute();
    assert.equal(navigation.routeDomHasChanged({nodes:[message(oldId),message(freshId)]}),false);
    assert.equal(session.runtime.route.gate.reason,'outgoing-only IDs still visible');
  });
  await test('SPA: missing UUID enters recoverable awaiting-uuid phase',()=>{
    session.runtime.route=createRoute();session.runtime.phase='switching';
    assert.equal(navigation.routeVerifiedOrWait({nodes:[]}),false);
    assert.equal(session.runtime.phase,'awaiting-uuid');
    assert.equal(navigation.routeVerifiedOrWait({nodes:[message(freshId)]}),true);
  });
  await test('SPA: React reused DOM node with a new UUID is detected',()=>{
    session.runtime.route=createRoute();
    oldNew.id=reusedId;
    assert.equal(navigation.routeDomHasChanged({nodes:[oldNew]}),true);
    oldNew.id=oldNewId;
  });
  await test('SPA: shared destination UUID requires outgoing DOM replacement',()=>{
    session.runtime.route=createRoute();
    const state=repository.loadState('B');
    state.messages[oldNewId]={role:'user',chars:5,tokens:3,fingerprint:'v3:sample'};
    assert.equal(save(state),true);
    assert.equal(navigation.routeDomHasChanged({nodes:[oldNew]}),false);
    assert.equal(navigation.routeDomHasChanged({nodes:[message(oldNewId)]}),true);
  });

  capture.setCurrentChatKey('A');
  const stored=repository.loadState('A');
  stored.messages[storedId]={role:'user',chars:7,tokens:4,fingerprint:'v3:stored'};
  assert.equal(save(stored),true);
  const files=realm.module('attachments/06-attachment-reading.js');
  const scans=realm.module('attachments/05-attachment-scan.js');
  const pending=realm.module('runtime/01-runtime-ui-state.js').pendingLocalFiles;
  const selected={name:'same-name.txt',size:8,lastModified:123,type:'text/plain'};
  visible=[message(oldNewId)];
  await test('Files: stage snapshots stored and visible prior UUIDs',()=>{
    files.stageLocalFile(selected,'file-input');
    assert.equal(pending.length,1);
    assert.ok(pending[0].existingMessageIds.has(storedId));
    assert.ok(pending[0].existingMessageIds.has(oldNewId));
  });
  await test('Files: old mounted card does not consume new draft File',()=>{
    const result=scans.scanConversationFiles([fakeEntry(oldNewId)],{files:{},chatKey:'A'});
    assert.equal(pending[0].used,false);
    assert.equal(result.jobs.length,0);
  });
  await test('Files: unsubmitted file cannot bind to newly revealed history',()=>{
    const result=scans.scanConversationFiles([fakeEntry(freshId)],{files:{},chatKey:'A'});
    assert.equal(pending[0].used,false);
    assert.equal(result.jobs.length,0);
  });
  await test('Files: removed draft attachment card invalidates local File',()=>{
    files.submittedLocalFiles({querySelectorAll:()=>[]});
    assert.equal(pending.length,0);
    files.stageLocalFile(selected,'file-input');
    assert.equal(pending.length,1);
  });
  await test('Files: only a composer card authorizes local File processing',()=>{
    const card={textContent:'same-name.txt',isConnected:true,
      getClientRects:()=>[{}],closest:()=>null,
      getAttribute:k=>k==='title'?'same-name.txt':null};
    files.submittedLocalFiles({isConnected:true,getClientRects:()=>[{}],
      closest:()=>null,querySelectorAll:()=>[card]});
    assert.ok(pending[0].submittedAt>0);
  });
  await test('Files: new sent UUID schedules exactly one read after metadata commit',()=>{
    const state=repository.loadState('A');
    const result=scans.scanConversationFiles([fakeEntry(reusedId)],state);
    assert.equal(save(state),true,'metadata commit must precede local reading');
    assert.equal(queued.length,0);
    assert.equal(result.jobs.length,1);
    const associated=[];
    scans.queueCommittedFileJobs(result.jobs,(...args)=>{
      associated.push(args);args[4]?.(true);
    });
    assert.equal(queued.length,1);
    queued.shift()();
    assert.equal(associated.length,1);
    assert.equal(associated[0][3],reusedId);
    assert.equal(pending.length,0);
  });

  const estimator=realm.module('chatgpt/04-text-estimators.js').estimateProseTokens;
  await test('P1: up to 10 MiB reads whole local text without slicing',async()=>{
    const file={name:'small.txt',size:10*1024*1024,type:'text/plain',
      text:async()=>'abc',slice:()=>{throw Error('Small file was sampled');}};
    const result=await files.estimateFileTokens(file);
    assert.equal(result.method,'text');assert.equal(result.tokens,estimator('abc'));
  });
  await test('P1: large text samples no more than 10 MiB and extrapolates',async()=>{
    const cap=10*1024*1024;
    const sample='a'.repeat(cap);
    let end=-1;
    const file={name:'large.txt',type:'text/plain',size:25*1024*1024,
      text:async()=>{throw Error('Large file read in full');},
      slice(start,stop){assert.equal(start,0);end=stop;
        return {arrayBuffer:async()=>new Uint8Array(cap).fill(97).buffer};}};
    const result=await files.estimateFileTokens(file);
    assert.equal(end,cap);
    assert.equal(result.tokens,Math.round(estimator(sample)*file.size/cap));
    assert.equal(result.method,'text-extrapolated');
    assert.match(result.detail,/First 10 MiB sampled/);
  });
  await test('P1: trailing incomplete UTF-8 sequence adds no replacement char',async()=>{
    const cap=10*1024*1024;
    const bytes=new Uint8Array(cap).fill(97);bytes[cap-1]=0xc3;
    const file={name:'unicode.txt',type:'text/plain',size:20*1024*1024,
      text:async()=>{throw Error('Large file read in full');},
      slice:()=>({arrayBuffer:async()=>bytes.buffer})};
    const result=await files.estimateFileTokens(file);
    assert.equal(result.tokens,Math.round(estimator('a'.repeat(cap-1))*2));
  });
  const binary=name=>({name,type:'',size:1000,
    text:async()=>{throw Error('Binary content read');},
    arrayBuffer:async()=>{throw Error('Binary archive unpacked');}});
  for(const name of ['payload.zip','document.docx','slides.pptx','sheet.xlsx','document.pdf','archive.7z']){
    await test(`Binary metadata-only: ${name} is never unpacked`,async()=>{
      const result=await files.estimateFileTokens(binary(name));
      assert.equal(result.tokens,0);
      assert.equal(result.method,'metadata-size');
      assert.equal(result.metadataOnly,true);
    });
  }
  const hydrate=realm.module('chatgpt/11-message-hydration.js');
  await test('Hydration: first short message is staged with one-shot recheck',()=>{
    assert.equal(hydrate.stableHydration('msg:H',{chars:7,fingerprint:'abc'}),false);
    assert.equal(timers.length,1);
  });
  await test('Hydration: silent recheck requests backfill and permits stable text',()=>{
    now+=430;
    timers.shift()();
    assert.equal(session.runtime.work.backfill,true);
    assert.deepEqual(events,['event']);
    assert.equal(hydrate.stableHydration('msg:H',{chars:7,fingerprint:'abc'}),true);
  });
  console.log(`\n${passed} current ESM regression scenarios passed`);
})().catch(err=>{console.error(err);process.exitCode=1;});
