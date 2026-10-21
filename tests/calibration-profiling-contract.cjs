// Current calibration history and profiling contracts.
// Isolated Node/V8 fixtures, not a browser benchmark.
'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {performance} = require('node:perf_hooks');
const {source} = require('./support/module-source.cjs');
const modules = [source('03-calibration-store.js'),source('02-profiling.js'),
  source('16-panel-rendering.js'),source('03-ledger-validation.js'),source('03-storage-io.js')];
const extract = (text,name) => {
  const match = new RegExp('^  function '+name+'\\(', 'm').exec(text);
  assert.ok(match,`missing ${name}`);
  const re=/\n  }(?=\n)/g; re.lastIndex=match.index;
  const end=re.exec(text);assert.ok(end,`no function boundary for ${name}`);
  return text.slice(match.index,end.index+4);
};
function isolate(names,context) {
  const ctx={console,Date,Math,Number,JSON,...context};
  vm.createContext(ctx);
  const helpers = ['validCalibrationSample','ledgerRecordObject', 'nonnegativeFiniteField',
    'validMessageRecord','validAttachmentRecord','validRepairSnapshot'];
  const code=helpers.concat(names).map(name=>{
    const module=modules.find(m=>new RegExp('^  function '+name+'\\(','m').test(m));
    assert.ok(module, 'Missing current module function '+name);
    return extract(module,name);
  }).join('\n');
  vm.runInContext(code+'\nObject.assign(globalThis,{'+names.join(',')+'});',ctx);
  return ctx;
}
let passed=0;
function check(name,fn) { fn();passed++; console.log('PASS '+name); }
function plain(x){return JSON.parse(JSON.stringify(x));}
const testHistory = [
  {chatKey:'chat:1',seen:12,optimistic:22,pessimistic:32},
  {chatKey:'chat:2',seen:100,optimistic:200,pessimistic:300},
  {chatKey:'chat:3',seen:0,optimistic:0,pessimistic:0}
];
check('Current-schema history summary has exact expected averages',()=>{
  const ctx=isolate(['historyStatsFor'],{});
  assert.deepEqual(plain(ctx.historyStatsFor(testHistory)),
    {n:3,avgSeen:37,avgOptimistic:74,avgPessimistic:111});
});
check('null and malformed history entries do not crash the forecast',()=>{
  const ctx=isolate(['historyStatsFor'],{});
  assert.equal(ctx.historyStatsFor([null,42,{},...testHistory],true).n,3);
});
check('historyStats caches only the derived summary, not ledger or token results',()=>{
  let loads=0;
  const ctx=isolate(['historyStatsFor','historyStats'],{
    historySummaryCache:null,
    loadHistory:()=>{loads++;return testHistory;}
  });
  const a=ctx.historyStats(),b=ctx.historyStats();
  assert.strictEqual(a,b);
  assert.equal(loads,1);
  assert.equal(ctx.historySummaryCache.n,3);
});
check('history save and reload invalidate the memoized summary',()=>{
  const storage=new Map();
  const ctx=isolate(['loadHistory','saveHistory','historyStatsFor','historyStats'],{
    historyCache:null,historySummaryCache:null,calibrationHistoryCorrupt:false,
    reportStorageFailure:()=>{},
    HISTORY_KEY:'history',currentChatKey:'A',
    measuredStorageRead:key=>storage.get(key)??null,
    writeJson:(key,data,_chat,_message,onFail)=>{storage.set(key,JSON.stringify(data));return true;}
  });
  const first=ctx.historyStats();assert.equal(first.n,0);
  assert.equal(ctx.saveHistory([{chatKey:'chat:1',seen:11,optimistic:12,pessimistic:15}]),true);
  const second=ctx.historyStats();assert.equal(second.n,1);
  assert.notStrictEqual(first,second);
  assert.strictEqual(ctx.historyStats(),second);
  ctx.historyCache=null;  // storage event's history invalidation path
  const reloaded=ctx.loadHistory();
  assert.equal(reloaded.length,1);
  assert.equal(ctx.historySummaryCache,null);
  assert.equal(ctx.historyStats().n,1);
});
check('failed history save invalidates summaries and can recover from storage',()=>{
  const ctx=isolate(['loadHistory','saveHistory','historyStatsFor','historyStats'],{
    historyCache:null,historySummaryCache:null,calibrationHistoryCorrupt:false,
    reportStorageFailure:()=>{},HISTORY_KEY:'h',currentChatKey:'A',
    measuredStorageRead:()=>JSON.stringify([{chatKey:'chat:1',seen:100,optimistic:101,pessimistic:102}]),
    writeJson:(_k,_v,_c,_msg,onFail)=>{onFail();return false;}
  });
  const a=ctx.historyStats();assert.equal(a.avgSeen,100);
  assert.equal(ctx.saveHistory([{chatKey:'chat:2',seen:7,pessimistic:9}]),false);
  assert.equal(ctx.historySummaryCache,null);
  assert.equal(ctx.historyStats().avgSeen,100);
});
check('bounded profiling keeps the latest 64 samples while maintaining total and max',()=>{
  let tick=0;
  const ctx=isolate(['perfEnd'],{
    perf:{timings:Object.create(null)}, performance:{now:()=>tick}
  });
  for(let i=0;i<100;i++) {tick=i;ctx.perfEnd('stats',i-(i+1));}
  const t=ctx.perf.timings.stats;
  assert.equal(t.count,100);
  assert.equal(t.recent.length,64);
  assert.equal(t.max,100);
  assert.equal(t.recent[0],37);
  assert.equal(t.recent.at(-1),100);
  assert.equal(t.total,5050);
  ctx.perfEnd('quiet',null);
  assert.equal(ctx.perf.timings.quiet,undefined);
});
check('Performance panel displays p95 from a bounded recent sample window',()=>{
  const ui={panel:{hidden:false},performanceDetails:{hidden:false},
    performanceLine:{textContent:''},performanceToggle:{textContent:''}};
  const ctx=isolate(['renderPerformance'],{
    ui,perf:{enabled:true,mutationBatches:0,mutations:0,duplicateTextMutations:0,
      queuedEvents:0,processedEvents:0,noChangeScans:0,
      timings:{stats:{count:5,total:15,max:5,recent:[1,2,3,4,5]}}},
    setTextIfChanged:(node,text)=>{node.textContent=text;},
    setUiHint:(node,text)=>{node.dataset={cwTip:text};}
  });
  ctx.renderPerformance();
  assert.ok(ui.performanceLine.textContent.includes('p95(last 5) 5.00 ms'));
  assert.ok(ui.performanceLine.textContent.includes('Ledger JSON.parse'));
  assert.ok(ui.performanceLine.textContent.includes('JSON.stringify'));
  assert.equal(ui.performanceToggle.textContent,'Pause profiling');
  assert.equal(ui.performanceToggle.dataset.cwTip,'Pause in-memory performance measurements.');
});
check('pure decoder validates established schema and accepts injected JSON.parse',()=>{
  const bytes=JSON.stringify({messages:{A:{role:'user',tokens:3,chars:5}},repairHistory:[],files:{},domImages:{},attachmentLedgerVersion:2,updatedAt:9});
  const make = () => isolate(['decodeLedger'],{
    emptyState:chatKey=>({chatKey,messages:{},files:{},domImages:{},repairHistory:[]}),
    perfStart:()=>{throw Error('Core must not access profiling');},
    perfEnd:()=>{throw Error('Core must not access profiling');}
  });
  const b=make();
  assert.deepEqual(plain(b.decodeLedger('chat',bytes).messages),
    {A:{role:'user',tokens:3,chars:5}});
  assert.deepEqual(plain(b.decodeLedger('chat',null).messages),{});
  assert.throws(()=>b.decodeLedger('chat','{bad'),/SyntaxError/);
  const calls=[];
  const parse=raw=>{calls.push(raw);return JSON.parse(raw);};
  assert.deepEqual(plain(b.decodeLedger('chat',bytes,parse).messages),
    {A:{role:'user',tokens:3,chars:5}});
  assert.deepEqual(calls,[bytes]);
  b.decodeLedger('chat',null,parse); // No payload means no JSON.parse work.
  assert.equal(calls.length,1);
});
check('production writeJson retains successful writes and failure handling',()=>{
  const storage=new Map(),times=[],fails=[];
  const ctx=isolate(['writeJson'],{
    perfStart:()=>1,perfEnd:key=>times.push(key),
    localStorage:{setItem:(key,val)=>storage.set(key,val)},
    reportStorageFailure:(chat,message)=>fails.push([chat,message])
  });
  let rawReceived=null;
  assert.equal(ctx.writeJson('k',{x:2},'A','write failed',null,raw=>rawReceived=raw),true);
  assert.equal(storage.get('k'),'{"x":2}');
  assert.equal(rawReceived,'{"x":2}');
  assert.deepEqual(times,['storageEncode','storageCommit','storageWrite']);
  ctx.localStorage={setItem:()=>{throw new Error('quota');}};
  let rollback=0;
  assert.equal(ctx.writeJson('k',{x:3},'A','write failed',()=>rollback++),false);
  assert.equal(rollback,1);
  assert.deepEqual(fails,[['A','write failed']]);
});
const largeHistory=Array.from({length:500},(_,i)=>({
  chatKey:'chat:'+i,seen:i+1,optimistic:i*2,pessimistic:i*3
}));
check('Repeated history forecast reads reuse one cached summary',()=>{
  let loads=0;
  const ctx=isolate(['historyStats','historyStatsFor'],{
    loadHistory:()=>{loads++;return largeHistory;},historySummaryCache:null
  });
  const first=ctx.historyStats();
  for(let i=0;i<800;i++) assert.strictEqual(ctx.historyStats(),first);
  assert.equal(loads,1);
  assert.equal(first.n,500);
  assert.equal(first.avgSeen,251);
  assert.equal(first.avgOptimistic,499);
  assert.equal(first.avgPessimistic,749);
});
console.log(`\n${passed} calibration/profiling behavior checks passed.`);
