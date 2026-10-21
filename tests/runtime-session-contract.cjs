'use strict';
// Runtime ownership contract: no persisted schema, network, timers or DOM objects
// introduced by these accessors. All actions are deterministic in isolation.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {source:read,rawSource,files:sourceFiles}=require('./support/module-source.cjs');

const fragments = [
  '01-runtime-configuration.js', '01-runtime-capture-state.js',
  '01-runtime-ledger-state.js', '01-runtime-ui-state.js',
  '01-runtime-session-state.js', '01-runtime-dom-state.js'
];
let total = 0;
function check(name, work) { work(); console.log('PASS', name); ++total; }
check('Shared runtime is split into six contiguous concern-specific fragments', () => {
  assert.ok(fragments.every(name => sourceFiles.includes(name)));
  assert.equal(sourceFiles.includes('01-runtime-state.js'), false);
  assert.match(read(fragments[0]), /const DEFAULTS =/);
  assert.match(read(fragments[1]), /const revisionTargets = new Map\(\)/);
  assert.match(read(fragments[2]), /let ledgerReadSnapshots = new WeakMap\(\)/);
  assert.match(read(fragments[3]), /let panelPinned = false/);
  assert.match(read(fragments[4]), /const runtime = \{/);
  assert.match(read(fragments[5]), /let inspectedFileTurns = new WeakMap\(\)/);
});
check('Session phase, pending reply and initial inspection have a single mutation owner', () => {
  const except = '11-route-inspection.js';
  const code = sourceFiles.filter(x => x !== except).map(x => [x,read(x)]);
  for (const [file, source] of code) {
    for (const pattern of [
      /runtime\.phase\s*=(?!=)/, /runtime\.work\.completion\s*=(?!=)/,
      /runtime\.work\.initial\s*=(?!=)/
    ]) {
      assert.doesNotMatch(source,pattern,file);
    }
  }
  assert.match(read(except), /function setSessionPhase\(/);
  assert.match(read(except), /function setCompletionPending\(/);
  assert.match(read(except), /function requestInitialInspection\(/);
  assert.match(read(except), /function sessionDiagnosticsSnapshot\(/);
});
check('UI diagnostic renderer reads a copied snapshot, not the mutable route', () => {
  const source=read('16-panel-rendering.js');
  assert.match(source,/const session = sessionDiagnosticsSnapshot\(\)/);
  assert.match(source,/session\.routePending && gate/);
  assert.doesNotMatch(source,/runtime\.route\?\.gate/);
  assert.doesNotMatch(source,/runtime\.work\./);
});
check('Session state controller preserves flags and renders only on phase changes', () => {
  const context = {
    runtime:{phase:'unknown',work:{initial:true,backfill:false,completion:false},route:null},
    renderCount:0,render() { this.renderCount++; },loadState:()=>({}),
    routeDomHasChanged:()=>false
  };
  vm.createContext(context);
  vm.runInContext(read('11-route-inspection.js'),context);
  const act = code => vm.runInContext(code,context);
  assert.equal(act('setSessionPhase("ready",false)'),true);
  assert.equal(context.renderCount,0);
  assert.equal(act('setSessionPhase("ready")'),false);
  assert.equal(context.renderCount,0);
  act('setCompletionPending(true)');
  assert.equal(context.runtime.work.completion,true);
  act('setCompletionPending(false)');
  assert.equal(context.runtime.work.completion,false);
  act('requestBackfill()');
  assert.equal(context.runtime.work.backfill,true);
  act('markInspectionDone(true)');
  assert.equal(context.runtime.work.initial,false);
  assert.equal(context.runtime.work.backfill,false);
  act('requestInitialInspection()');
  assert.equal(context.runtime.work.initial,true);
  act('startRouteTransition({beforeIds:new Set(),beforeNodes:new WeakMap()},new Set(),true)');
  assert.equal(context.runtime.phase,'switching');
  assert.equal(context.runtime.work.completion,true);
  assert.equal(context.runtime.work.initial,true);
  assert.equal(context.runtime.work.backfill,false);
  assert.ok(context.runtime.route);
  act('finishRouteTransition()');
  assert.equal(context.runtime.route,null);
});
check('Diagnostics snapshot owns no mutable live reference and has no side effects', () => {
  const context = {
    runtime: { phase: 'switching', work: {initial: false,completion: true,backfill:false},
      route: { gate: {reason:'awaiting DOM UUIDs', visible:3, destinationKnown:0} } },
    render:()=>{throw Error('must not render');},
    loadState:()=>{throw Error('must not load state');}
  };
  vm.createContext(context);
  vm.runInContext(read('11-route-inspection.js')+'\nsnapshot=sessionDiagnosticsSnapshot();',context);
  assert.equal(context.snapshot.phase,'switching');
  assert.equal(context.snapshot.routePending,true);
  assert.equal(context.snapshot.gate.visible,3);
  context.snapshot.gate.visible=99;
  assert.equal(context.runtime.route.gate.visible,3);
  assert.equal(context.runtime.work.completion,true);
});
check('Route verification is blocked until positive destination evidence arrives', () => {
  const old={id:'msg:old'};
  const destination={id:'msg:new'};
  const context={runtime:{phase:'switching',route:{beforeIds:new Set(['msg:old']),
    beforeNodes:new WeakMap([[old,'msg:old']]),outgoingKnownIds:new Set(['msg:old'])}},
    loadState:()=>({messages:{'msg:new':{role:'assistant'}}}),
    collectMessageNodes:()=>({nodes:[]}),
    identifiedMessages:function* (nodes) { for(const el of nodes)yield {el,id:el.id}; }};
  vm.createContext(context);
  vm.runInContext(read('11-route-navigation.js')+'\ncheckGate=routeDomHasChanged;',context);
  assert.equal(context.checkGate({nodes:[old]}),false);
  assert.equal(context.runtime.route.gate.reason,'outgoing-only IDs still visible');
  assert.equal(context.checkGate({nodes:[]}),false);
  assert.equal(context.runtime.route.gate.reason,'awaiting DOM UUIDs');
  assert.equal(context.checkGate({nodes:[destination]}),true);
  assert.equal(context.runtime.route.gate.reason,'confirmed');
});
check('Route verification pauses inspection and only renders on changed phase', () => {
  let renders=0,loads=0;
  const context={runtime:{phase:'switching',route:{gate:{visible:0}}},
    routeDomHasChanged:()=>false,
    setSessionPhase:phase=>{if(context.runtime.phase===phase)return false;
      context.runtime.phase=phase;return true;},
    render:()=>{renders++;},loadState:()=>{loads++;return {};}};
  vm.createContext(context);
  const navigation=read('11-route-navigation.js');
  const start=navigation.indexOf('  function routeVerifiedOrWait(');
  assert.ok(start>=0);
  const end=navigation.indexOf('\n  }',start);
  assert.ok(end>start);
  vm.runInContext(navigation.slice(start,end+4)+'\nverifyRoute=routeVerifiedOrWait;',context);
  assert.equal(context.verifyRoute(),false);
  assert.equal(context.runtime.phase,'awaiting-uuid');
  assert.equal(renders,1);
  assert.equal(context.verifyRoute(),false);
  assert.equal(renders,1);
  assert.equal(loads,1);
  context.routeDomHasChanged=()=>true;
  assert.equal(context.verifyRoute(),true);
});
check('Hydration requires a stable fingerprint for at least 400ms', () => {
  let now=1000,schedules=0;
  const context={hydrationCandidates:new Map(),
    Date:{now:()=>now},scheduleHydrationRecheck:()=>{schedules++;}};
  vm.createContext(context);
  const hydration=read('11-message-hydration.js');
  const start=hydration.indexOf('  function stableHydration(');
  assert.ok(start>=0);
  const end=hydration.indexOf('\n  }',start);
  assert.ok(end>start);
  vm.runInContext(hydration.slice(start,end+4)+'\ncheckHydration=stableHydration;',context);
  const item={chars:5,fingerprint:'abc'};
  assert.equal(context.checkHydration('msg:1',item),false);
  now=1399;assert.equal(context.checkHydration('msg:1',item),false);
  now=1400;assert.equal(context.checkHydration('msg:1',item),true);
  assert.equal(context.checkHydration('msg:1',{chars:5,fingerprint:'def'}),false);
  assert.ok(schedules>=2);
});
check('Native core ownership keeps storage merge and context estimation distinct', () => {
  const merge=rawSource('03-ledger-merge.js');
  const contextEstimate=rawSource('context-estimate.js');
  assert.match(merge,/function reconcileLedger\(baseRaw, liveRaw, draft, parse = JSON\.parse\)/);
  assert.match(merge,/Previously saved message IDs disappeared \(possible chat reset\)/);
  assert.match(merge,/Concurrent \$\{field\} change/);
  assert.match(contextEstimate,/function calculateContextEstimate\(/);
  assert.match(read('03-ledger-repository.js'),/function loadState\(/);
  assert.match(read('03-ledger-commit.js'),/function saveState\(/);
});
console.log(`${total} dedicated Runtime/Dependency checks passed`);
