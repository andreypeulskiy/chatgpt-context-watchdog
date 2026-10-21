'use strict';
// real native ESM data contracts, no UI projection or offline bundle internals.
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const script=String.raw`
import assert from 'node:assert/strict';
const kv=new Map();
globalThis.localStorage={getItem:k=>kv.get(k)??null,setItem:(k,v)=>kv.set(k,String(v)),key:i=>[...kv.keys()][i]??null,get length(){return kv.size}};
const [{DEFAULTS, HANDOFF_PROMPT, SETTINGS_KEY},{loadSettings},{settings},{fileForecast},{calculateContextEstimate},{buildDetailGroups}]=await Promise.all([
  import('./src/runtime/01-runtime-configuration.js'),
  import('./src/storage/03-settings-store.js'),
  import('./src/runtime/01-runtime-capture-state.js'),
  import('./src/app/07-forecast.js'),
  import('./src/core/context-estimate.js'),
  import('./src/ui/16-panel-rendering.js')
]);
assert.ok(HANDOFF_PROMPT.length<4000);
assert.equal(DEFAULTS.handoffPrompt,HANDOFF_PROMPT);
assert.equal(loadSettings().handoffPrompt,HANDOFF_PROMPT);
for(const invalid of ['', '  ', 'x'.repeat(4001), 7, null, {}, []]){
  kv.set(SETTINGS_KEY,JSON.stringify({handoffPrompt:invalid}));
  assert.equal(loadSettings().handoffPrompt,HANDOFF_PROMPT);
}
kv.set(SETTINGS_KEY,JSON.stringify({handoffPrompt:'User-authored global prompt'}));
assert.equal(loadSettings().handoffPrompt,'User-authored global prompt');
const file={name:'large.txt',method:'text-extrapolated',tokens:2000,metadataOnly:false,size:12*1024*1024,lastSeenAt:Date.now()};
const ff=fileForecast({file});
assert.equal(ff.sampledTextFiles,1);
assert.equal(ff.parsedFiles,1);
assert.equal(ff.fileOptimistic,500);
assert.equal(ff.filePessimistic,1500);
assert.equal(ff.fullyReadTextFiles,0);
const estimate=calculateContextEstimate({files:{}},100,{...ff,fileOptimistic:400,filePessimistic:1500},{tokens:200,effective:1,captured:1,historical:1},{...DEFAULTS});
assert.equal(estimate.sampledTextFiles,1);
assert.equal(estimate.optimistic,100+400+40+DEFAULTS.hiddenOptimistic);
assert.equal(estimate.pessimistic,100+1500+160+DEFAULTS.hiddenPessimistic);
const metrics={...estimate,turns:2,userTurns:1,assistantTurns:1,otherTurns:0,chars:180,tokens:100};
const budgets={conservative:10000,normal:12000,optimistic:20000};
const groups=buildDetailGroups({...metrics,optimistic:14501,pessimistic:17500},budgets);
assert.equal(groups.length,5);
assert.ok(groups.every(x=>x.length>0));
const report=groups.map(g=>g.join('\n')).join('\n---\n');
assert.match(report,/Conservative: 14,501–17,500 \/ 10,000 tokens/);
assert.match(report,/Sampled: 1 files/);
assert.match(report,/Hidden context: 4,000–16,000 tokens/);
assert.match(report,/React metadata: 0 files/);
assert.doesNotMatch(report,/Status:|\bHealthy\b|\bHigh\b|\bLow\b|remaining|overrun|exceeded/i);
assert.equal(groups[0].filter(s=>s.includes('tokens')).length,0,'Text tokens are presented only as a context contribution');
const empty=buildDetailGroups({...metrics,totalFileBytes:0,knownFileCount:0},budgets);
assert.ok(empty.flat().includes('Known size: none'));
console.log('PASS native  metric details and validated global HANDOFF defaults');
`;
const p=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:15000});
assert.equal(p.status,0,p.stderr||p.stdout||String(p.error));
process.stdout.write(p.stdout);
