'use strict';
// Current-source contract tests: write-once capture, revisions and hydration.
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {source}=require('./support/module-source.cjs');
const currentCapture=source('11-message-completion-context.js')+
  source('11-message-capture.js')+source('11-message-ledger-commit.js');
const fixture={
  messages: {
    'msg:EXIST': {role:'user',tokens:40,chars:160,fingerprint:'old'},
    'msg:EDIT': {role:'user',tokens:10,chars:40,fingerprint:'original'}
  },
  candidate: {chars:80,tokens:42,fingerprint:'changed',parts:{source:'markdown',prose:'Valid content',code:''}}
};
function run(source, config={}) {
  const events=[];
  const entries=(config.entries || [
    {index:0,role:'user',id:'msg:EXIST'},
    {index:1,role:'assistant',id:'msg:NEW'},
    {index:2,role:'user',id:'msg:SHORT'}
  ]).map((entry,i)=>({...entry,el:{i,role:entry.role,id:entry.id}, index:entry.index ?? i}));
  const state={messages:structuredClone(config.messages??fixture.messages)};
  const commit={added:0,changed:0,unchanged:0,user:0,assistant:0,other:0};
  const sandbox={
    entries,
    collected:{ambiguousIds:new Set(config.ambiguous || [])},
    state, commit,
    revisionTargets:new Map((config.revisions||[]).map((id,i)=>[id,i+1])),
    completedRevisions:new Map(),
    trustedCollectedMessageId:(id,collected)=>!!id&&!collected.ambiguousIds.has(id),
    lastBackfillDeferred:0,
    hydrationCandidates:{delete:id=>events.push(['hydration-delete',id])},
    getCanonicalMessageMetrics:(el,role)=>{
      events.push(['metrics',el.id,role]);
      return structuredClone(config.metricsById?.[el.id] || fixture.candidate);
    },
    mayBackfillMessage:(el,role,id,metrics,laterUser)=>{
      events.push(['backfill',id,laterUser]);
      return config.allowBackfill !== false;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source+'\nresult=captureMessages(entries,collected,state,'+
    JSON.stringify(config.mode??'ready')+','+(config.completed!==false)+',commit);',sandbox);
  return {
    changed:sandbox.result,
    state:JSON.parse(JSON.stringify(sandbox.state)),
    commit:JSON.parse(JSON.stringify(sandbox.commit)),
    deferred:sandbox.lastBackfillDeferred,
    events
  };
}
let count=0;
function check(name,options,verify){
  const result=run(currentCapture,options);
  verify(result);
  console.log('PASS',name);count++;
}
const defaultIds=['msg:EXIST','msg:EDIT'];
const expectStored=(result,ids)=>assert.deepEqual(Object.keys(result.state.messages).sort(),ids.slice().sort());
const expectCommit=(result,expected)=>{
  for (const [key,value] of Object.entries(expected)) assert.equal(result.commit[key],value,key);
};
check('new UUIDs are captured without overwriting existing entries',{},r=>{
  assert.equal(r.changed,true);
  expectStored(r,[...defaultIds,'msg:NEW','msg:SHORT']);
  expectCommit(r,{added:2,changed:0,unchanged:1,user:1,assistant:1});
  assert.equal(r.state.messages['msg:EXIST'].fingerprint,'old');
  assert.equal(r.state.messages['msg:NEW'].role,'assistant');
  assert.equal(r.events.filter(e=>e[0]==='metrics').length,2);
});
check('unknown completion mode requires backfill authorization',{mode:'unknown',completed:false},r=>{
  expectCommit(r,{added:2,unchanged:1});
  assert.equal(r.events.filter(e=>e[0]==='backfill').length,2);
});
check('unknown mode accepts evidenced backfill',{mode:'unknown',completed:false,allowBackfill:true},r=>{
  assert.equal(r.changed,true);
  expectCommit(r,{added:2});
  assert.equal(r.deferred,0);
});
check('unhydrated candidates are deferred',{mode:'unknown',completed:false,allowBackfill:false},r=>{
  assert.equal(r.changed,false);
  expectStored(r,defaultIds);
  expectCommit(r,{added:0,changed:0,unchanged:1});
  assert.equal(r.deferred,2);
});
check('missing and ambiguous UUIDs are not captured',{
  entries:[{id:null,role:'user'},{id:'msg:OTHER',role:'assistant'},{id:'msg:EXIST',role:'user'}],
  ambiguous:['msg:OTHER']
},r=>{
  expectStored(r,defaultIds);
  assert.equal(r.changed,false);
  assert.equal(r.deferred,1);
  assert.deepEqual(r.events,[]);
});
check('unfinished explicit revision cannot change the stored message',{
  entries:[{id:'msg:EDIT',role:'user'}],revisions:['msg:EDIT'],completed:false
},r=>{
  assert.equal(r.changed,false);
  assert.equal(r.state.messages['msg:EDIT'].fingerprint,'original');
  expectCommit(r,{changed:0});
  assert.equal(r.deferred,1);
});
check('completed explicit revision changes only its targeted UUID',{
  entries:[{id:'msg:EDIT',role:'user'}],revisions:['msg:EDIT']
},r=>{
  expectStored(r,defaultIds);
  assert.equal(r.changed,true);
  expectCommit(r,{added:0,changed:1,user:1});
  assert.equal(r.state.messages['msg:EDIT'].fingerprint,'changed');
  assert.equal(r.state.messages['msg:EXIST'].fingerprint,'old');
});
check('unchanged revision fingerprint avoids rewriting',{
  entries:[{id:'msg:EDIT',role:'user'}],revisions:['msg:EDIT'],
  metricsById:{'msg:EDIT':{chars:40,tokens:10,fingerprint:'original',parts:{source:'markdown',prose:'Existing',code:''}}}
},r=>{
  assert.equal(r.changed,false);
  expectCommit(r,{added:0,changed:0,unchanged:1});
  assert.equal(r.state.messages['msg:EDIT'].fingerprint,'original');
});
check('backfill signal does not mutate unfinished revision',{
  entries:[{id:'msg:EDIT',role:'user'}],revisions:['msg:EDIT'],completed:false,mode:'unknown'
},r=>{
  assert.equal(r.changed,false);
  expectCommit(r,{changed:0});
  assert.equal(r.deferred,1);
  assert.equal(r.state.messages['msg:EDIT'].fingerprint,'original');
});
check('a later user does not remove an earlier assistant',{
  entries:[{id:'msg:A',role:'assistant'},{id:'msg:U',role:'user'}]
},r=>{
  expectStored(r,[...defaultIds,'msg:A','msg:U']);
  expectCommit(r,{added:2,user:1,assistant:1});
});
check('backfill evidence is attached only to earlier assistant',{
  entries:[{id:'msg:A',role:'assistant'},{id:'msg:U',role:'user'},{id:'msg:B',role:'assistant'}],
  completed:false,mode:'unknown'
},r=>{
  assert.deepEqual(r.events.filter(e=>e[0]==='backfill').map(e=>[e[1],e[2]]),[
    ['msg:A',true],['msg:U',false],['msg:B',false]
  ]);
});
check('empty metrics do not become ledger entries',{
  entries:[{id:'msg:NEW',role:'assistant'}],
  metricsById:{'msg:NEW':{chars:0,tokens:0,fingerprint:'',parts:{source:'markdown',prose:'',code:''}}}
},r=>{
  assert.equal(r.changed,false);
  expectStored(r,defaultIds);
  expectCommit(r,{added:0,changed:0});
});
check('stored write-once UUID is never re-read without revision',{
  entries:[{id:'msg:EXIST',role:'user'}],completed:true
},r=>{
  assert.deepEqual(r.events,[]);
  assert.equal(r.changed,false);
  expectCommit(r,{unchanged:1});
  assert.equal(r.state.messages['msg:EXIST'].fingerprint,'old');
});
console.log(count,'current capture contract scenarios passed');
