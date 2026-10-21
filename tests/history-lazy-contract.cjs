'use strict';
// Budget/forecast consumers must not deserialize history until it is requested.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const file = rel => fs.readFileSync(path.join(root,rel),'utf8');
const store = file('src/storage/03-calibration-store.js');
const render = file('src/ui/16-panel-rendering.js');
const coord = file('src/ui/14-panel-view-coordinator.js');
function extract(source, name) {
  const start = new RegExp(`^  function ${name}\\(`,'m').exec(source);
  assert.ok(start, `missing ${name}`);
  const close = /\n  }(?=\n)/g;
  close.lastIndex = start.index;
  const end = close.exec(source);
  assert.ok(end,`unclosed ${name}`);
  return source.slice(start.index,end.index+4);
}
{
  const ctx = {
    settings:{conservativeBudget:80000,normalBudget:120000,optimisticBudget:180000,budgetCalibrationWeight:.35},
    historyStats:()=>{throw Error('History read during ordinary forecast!');}
  };
  vm.createContext(ctx);
  vm.runInContext(extract(store,'effectiveBudgets')+'\nthis.budgets = effectiveBudgets();',ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.budgets)),{
    conservative:80000,normal:120000,optimistic:180000,historyWeight:.35
  });
}
{
  let reads=0;
  const line = {textContent:'',removeAttribute:()=>{}};
  const ctx = {
    ui:{history:line},Number,historyStats:()=>{reads++;return {n:0,avgSeen:0,avgOptimistic:0,avgPessimistic:0};},
    formatFullNumber:String,setTextIfChanged:(node,v)=>{node.textContent=String(v);}
  };
  vm.createContext(ctx);
  vm.runInContext(extract(render,'renderHistory')+'\nrenderHistory({historyWeight:0});',ctx);
  assert.equal(reads,1);
  assert.match(line.textContent,/Recorded limit samples: 0/);
  assert.match(line.textContent,/Average pessimistic context: none/);
}
assert.match(coord,/renderHistory\(effectiveBudgets\(\)\)/);
assert.doesNotMatch(coord,/selected === 'history'\) render\(loadState\(\)\)/);
assert.match(render,/if \(ui\.historyDetails\?\.hidden === false/);
console.log('PASS lazy History data contract, no eager forecast history or full ledger render on switching');
