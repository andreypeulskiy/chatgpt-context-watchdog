// Behavior contracts for the current MutationObserver and statistics modules.
// Synthetic DOM/MutationObserver fixtures only, not a browser integration claim.
'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {performance} = require('node:perf_hooks');
const {source} = require('./support/module-source.cjs');
const observerSource = source('17-spa-observer-startup.js');
const statsSource = source('11-ledger-statistics.js');
let passed = 0;
function test(label, fn) { fn(); passed++; console.log('PASS', label); }
function extract(text, name) {
  const re = new RegExp('^  function ' + name + '\\(', 'm');
  const start = re.exec(text);
  assert.ok(start, `Missing ${name}`);
  const close = /\n  }(?=\n)/g;
  close.lastIndex = start.index;
  const end = close.exec(text);
  assert.ok(end, `Unclosed ${name}`);
  return text.slice(start.index, end.index+4);
}
function observerFixture(enabled=true, hidden=false) {
  const hits = { dirties:[], touches:[], queues:[], timings:[] };
  let callback;
  const ctx = {
    observer: null, isWatchdogPaused: () => false,
    document: { body:{}, documentElement:{}, hidden },
    ui: null, pendingLocalFiles:[], currentChatKey:'A',
    perf: {enabled, mutationBatches:0, mutations:0, duplicateTextMutations:0},
    perfStart: () => enabled ? performance.now() : null,
    perfEnd: (name, started) => {if(started!==null)hits.timings.push(name);},
    MutationObserver: class { constructor(cb){ callback=cb; } observe(){} disconnect(){} },
    markFileTurnDirty: m => {hits.dirties.push(m);},
    mutationTouchesConversation: (m, urgent) => {
      hits.touches.push(m);
      if(m.urgent) urgent.value=true;
      return !!m.relevant;
    },
    queueConversationEvent: p => {hits.queues.push(p);},
    WeakSet, WeakMap
  };
  vm.createContext(ctx);
  vm.runInContext(extract(observerSource,'installObserver'),ctx);
  ctx.installObserver();
  return {callback: mutations => callback(mutations), hits, perf:ctx.perf};
}
const textNode = id => ({nodeType:3, name:id});
const mutation = (type,target,relevant=false,urgent=false) => ({type,target,relevant,urgent,addedNodes:[]});
function process(batches, enabled=true, hidden=false) {
  const runner = observerFixture(enabled, hidden);
  for (const batch of batches) runner.callback(batch);
  return runner;
}
test('Repeated text records in one callback are processed once; every distinct mutation is retained', () => {
  const text = textNode('streaming');
  const records = Array.from({length:4000},()=>mutation('characterData',text,true));
  records.push(mutation('attributes', {name:'composer'}, true, true));
  records.push(mutation('childList',{name:'mount'},true));
  const b=process([records]);
  assert.deepEqual(b.hits.queues,['urgent']);
  assert.equal(b.hits.dirties.length,3);
  assert.equal(b.hits.touches.length,2);
  assert.equal(b.perf.mutations,4002);
  assert.equal(b.perf.duplicateTextMutations,3999);
});
test('A text target touched in distinct batches must still be examined in each batch',()=>{
  const t = textNode('same');
  const input=[[mutation('characterData',t,true)],[mutation('characterData',t,true)]];
  const result=process(input);
  assert.equal(result.hits.dirties.length,2);
  assert.deepEqual(result.hits.queues,['background','background']);
  assert.equal(result.perf.duplicateTextMutations,0);
});
test('Different text nodes in one batch are never collapsed',()=>{
  const result=process([[mutation('characterData',textNode('a'),true),mutation('characterData',textNode('b'),true)]]);
  assert.equal(result.hits.dirties.length,2);
  assert.equal(result.perf.duplicateTextMutations,0);
});
test('Attribute mutations and childList records on the same node remain distinct',()=>{
  const target = {name:'container'};
  const records=[mutation('attributes',target,true),mutation('attributes',target,true),mutation('childList',target,true),mutation('childList',target,true)];
  const result=process([records]);
  assert.equal(result.hits.dirties.length,4);
  assert.equal(result.hits.touches.length,4);
});
test('Hidden document still tracks dirty-file changes but never queues scans',()=>{
  const node = textNode('hidden');
  const records = [mutation('characterData',node,true),mutation('characterData',node,true),mutation('childList',{},true)];
  const b=process([records],true,true);
  assert.equal(b.hits.queues.length,0);
  assert.equal(b.hits.dirties.length,2);
  assert.equal(b.perf.mutations,3);
});
test('Hidden tab with submitted File queues only relevant user-card mounts',()=>{
  class UserElement {
    constructor(isUser) {this.isUser=isUser;this.nodeType=1;}
    matches(sel){return sel==='USER_TURN'&&this.isUser;}
    closest(sel){return sel==='USER_TURN'&&this.isUser?this:null;}
    querySelector(){return null;}
  }
  // Use the real observer body with the file-related hidden-branch dependencies.
  let callback;
  const context={
    observer:null,isWatchdogPaused:()=>false,document:{body:{},documentElement:{},hidden:true},ui:null,
    pendingLocalFiles:[{submittedAt:100,used:false}],currentChatKey:'A',
    isActiveSubmittedFile:()=>true,FILE_USER_TURN_SELECTOR:'USER_TURN',
    Node:{TEXT_NODE:3},Element:UserElement,
    perf:{enabled:false},perfStart:()=>null,perfEnd:()=>{},
    MutationObserver:class{constructor(cb){callback=cb;}observe(){}disconnect(){}},
    markFileTurnDirty:()=>{},mutationTouchesConversation:()=>false,
    queueConversationEvent:priority=>calls.push(priority),WeakSet,WeakMap
  };
  const calls=[];
  vm.createContext(context);
  vm.runInContext(extract(observerSource,'installObserver'),context);
  context.installObserver();
  callback([{type:'childList',target:new UserElement(true),addedNodes:[]}]);
  callback([{type:'childList',target:new UserElement(false),addedNodes:[]}]);
  assert.deepEqual(calls,['background']);
});
test('Instrumentation disabled does not change event scheduling',()=>{
  const t=textNode('quiet');
  const records=[mutation('characterData',t,true),mutation('characterData',t,true)];
  const result=process([records],false);
  assert.deepEqual(result.hits.queues,['background']);
  assert.equal(result.hits.timings.length,0);
});
test('Observer profiling measures elapsed time only when opted in',()=>{
  const result=process([[mutation('attributes',{},false)]],true);
  assert.deepEqual(result.hits.timings,['observerCallback']);
});
function fileDirtyFixture() {
  let closestCalls=0;
  const marked=new WeakSet();
  class Element {
    constructor(role='other') {this.role=role;this.nodeType=1;this.children=[];this.parent=null;}
    closest(sel) {
      closestCalls++;
      if(sel.includes(':assistant')) return this.role==='assistant'?this:null;
      if(sel==='USER_TURN') return this.role==='user'?this:null;
      return null;
    }
    matches(sel) { return sel==='USER_TURN' && this.role==='user'; }
    querySelector(sel) {return sel==='USER_TURN' ? this.children[0] || null:null;}
    querySelectorAll(sel) {return sel==='USER_TURN'?this.children:[];}
  }
  const ctx={Element,Node:{TEXT_NODE:3},FILE_USER_TURN_SELECTOR:'USER_TURN', dirtyFileTurns:{add:n=>marked.add(n)},dirtyImageTurns:new WeakSet()};
  vm.createContext(ctx);
  vm.runInContext('const FILE_USER_TURN_SELECTOR = "USER_TURN";\n'+extract(observerSource,'markFileTurnDirty'),ctx);
  return {ctx,Element,marked,closestCalls:()=>closestCalls};
}
test('File dirty classification keeps user cards and reuses per-batch ancestry',()=>{
  const run=fileDirtyFixture();
  const user = new run.Element('user');
  const assistant = new run.Element('assistant');
  const other = new run.Element('other');
  const added = new run.Element('user');
  const wrapper = new run.Element(); wrapper.children=[added];
  const cache=new WeakMap();
  for(let i=0;i<200;i++) run.ctx.markFileTurnDirty(mutation('attributes',user),cache);
  for(let i=0;i<200;i++) run.ctx.markFileTurnDirty(mutation('attributes',assistant),cache);
  for(let i=0;i<200;i++) run.ctx.markFileTurnDirty(mutation('attributes',other),cache);
  run.ctx.markFileTurnDirty({type:'childList',target:wrapper,addedNodes:[added]},cache);
  assert.equal(run.marked.has(user),true);
  assert.equal(run.marked.has(assistant),false);
  assert.equal(run.marked.has(other),false);
  assert.equal(run.marked.has(added),true);
  assert.ok(run.closestCalls()<30,'Ancestry checks should be bounded per batch');
});
test('Stats totals count each current-ledger message once and preserve profiling',()=>{
  const hits=[];
  const ctx={ perfStart:()=>3,perfEnd:(name,started)=>hits.push(`${name}:${started}`),
    loadState:()=>({messages:{}}), estimateCurrentContext:(state,tokens)=>({optimistic:tokens+10,pessimistic:tokens+20}) };
  vm.createContext(ctx);
  vm.runInContext(extract(statsSource,'stats'),ctx);
  const state={messages:{'msg:one':{tokens:5,chars:30,role:'user'},'msg:two':{tokens:6,chars:40,role:'assistant'}}};
  const result=ctx.stats(state);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{
    tokens:11,chars:70,turns:2,userTurns:1,assistantTurns:1,otherTurns:0,
    uuidMessages:2,optimistic:21,pessimistic:31
  });
  assert.deepEqual(hits,['stats:3']);
});
console.log(`\n${passed} observer/statistics behavior checks passed.`);

for (const attribute of ['aria-busy','aria-hidden','inert']) {
  assert.match(extract(observerSource,'installObserver'), new RegExp('\\b' + attribute + '\\b'), `Observer must listen to ${attribute}`);
}
console.log('PASS R4 message gating attributeFilter includes aria-busy / aria-hidden / inert');
