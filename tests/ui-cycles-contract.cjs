'use strict';
// the render path and mini-navigation do not pull in Settings controllers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const read = id => fs.readFileSync(path.join(src,id),'utf8');
const rendering = read('ui/16-panel-rendering.js');
const view = read('ui/14-panel-view-coordinator.js');
const actions = read('ui/15-panel-action-handlers.js');
const events = read('ui/15-panel-settings-events.js');
const startup = read('app/17-spa-observer-startup.js');
assert.doesNotMatch(rendering,/from ['"]\.\/15-panel-settings-controls\.js['"]/);
assert.match(rendering,/\bensureUiReady\(\)/);
assert.match(startup,/\bsetUiInitializer\(ensureUI\)/);
assert.doesNotMatch(view,/from ['"]\.\/15-panel-settings-events\.js['"]/);
assert.doesNotMatch(actions,/from ['"]\.\/14-panel-view-coordinator\.js['"]/);
assert.doesNotMatch(events,/\bfunction mountEstimationSection\(/);
assert.match(view,/\bfunction mountEstimationSection\(/);
assert.match(read('ui/14-panel-mini-navigation.js'), /function bindMiniNavigation\(/);
const deps = new Map();
function walk(dir) {
  for (const ent of fs.readdirSync(dir,{withFileTypes:true})) {
    const full=path.join(dir,ent.name);
    if(ent.isDirectory()) walk(full);
    else if(ent.name.endsWith('.js')) {
      const id=path.relative(src,full).replaceAll(path.sep,'/');
      deps.set(id,[...fs.readFileSync(full,'utf8').matchAll(/^import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm)]
        .map(m=>path.posix.normalize(path.posix.join(path.posix.dirname(id),m[1]))));
    }
  }
}
walk(src);
assert.ok(deps.size >= 59, 'New well-scoped UI modules are allowed');
const groups=[];
const stack=[],indices=new Map(),low=new Map(),onStack=new Set();
function visit(v) {
  indices.set(v,indices.size);low.set(v,indices.get(v));stack.push(v);onStack.add(v);
  for(const w of deps.get(v)) {
    assert.ok(deps.has(w),`${v}: missing ${w}`);
    if(!indices.has(w)) {visit(w);low.set(v,Math.min(low.get(v),low.get(w)));}
    else if(onStack.has(w)) low.set(v,Math.min(low.get(v),indices.get(w)));
  }
  if(low.get(v)===indices.get(v)) {
    const group=[];let w;
    do {w=stack.pop();onStack.delete(w);group.push(w);} while(w!==v);
    groups.push(group);
  }
}
for(const v of deps.keys()) if(!indices.has(v)) visit(v);
const largest=Math.max(...groups.map(x=>x.length));
const mutual=[...deps].flatMap(([id,list])=>list.filter(dep=>id<dep&&deps.get(dep)?.includes(id)).map(dep=>[id,dep]));
assert.ok(largest<=14,`Largest cycle unexpectedly grew: ${largest}`);
assert.ok(mutual.length<=4,`Unexpected mutual import pairs: ${mutual.length}`);
const code=String.raw`
  import assert from 'node:assert/strict';
  for(const key of ['window','document','localStorage','location']) {
    Object.defineProperty(globalThis,key,{configurable:true,get(){throw Error('Unexpected access '+key);}});
  }
  const state=await import('./src/runtime/01-runtime-ui-state.js');
  assert.throws(()=>state.ensureUiReady(),/not been initialized/);
  const sentinel={ready:true};let called=0;
  state.setUiInitializer(()=>{called++;return sentinel;});
  assert.equal(state.ensureUiReady(),sentinel);
  assert.equal(state.ensureUiReady(),sentinel);
  assert.equal(called,2);
  console.log('PASS UI initializer can be registered without browser side effects');
`;
const check=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:root,encoding:'utf8',timeout:12000});
assert.equal(check.status,0,check.stderr||check.stdout||String(check.error));
process.stdout.write(check.stdout);
console.log(`PASS UI graph boundaries: ${largest} in largest SCC, ${mutual.length} mutual pairs`);
