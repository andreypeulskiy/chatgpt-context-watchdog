'use strict';
// the route state controller and attachment metadata scanner must not
// import presentation or local file reading; scan jobs execute only after commit.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const srcRoot = path.join(root, 'src');
const read = file => fs.readFileSync(path.join(srcRoot, file), 'utf8');
const route = read('app/11-route-inspection.js');
const scan = read('attachments/05-attachment-scan.js');
const coordinator = read('app/11-message-scan.js');
const conversation = read('app/17-conversation-coordinator.js');
assert.doesNotMatch(route, /from ['"]\.\.\/ui\//);
assert.doesNotMatch(route, /\brender\s*\(/);
assert.doesNotMatch(scan, /from ['"]\.\/06-attachment-reading\.js['"]/);
assert.match(scan, /function queueCommittedFileJobs\(jobs, rememberSentFile\)/);
assert.match(coordinator, /queueCommittedFileJobs\(fileScan\.jobs, rememberSentFile\)/);
assert.match(coordinator, /queueCommittedFileJobs\(pending\.fileJobs, rememberSentFile\)/);
assert.match(conversation, /if \(setSessionPhase\(phase\)\) render\(loadState\(\)\)/);

const deps = new Map();
function walk(dir) {
  for (const item of fs.readdirSync(dir, {withFileTypes:true})) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) walk(file);
    else if (item.name.endsWith('.js')) {
      const id = path.relative(srcRoot,file).replaceAll(path.sep,'/');
      const imports = [...fs.readFileSync(file,'utf8').matchAll(/^import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm)]
        .map(m=>path.posix.normalize(path.posix.join(path.posix.dirname(id),m[1])));
      deps.set(id,imports);
    }
  }
}
walk(srcRoot);
assert.ok(deps.size >= 59, 'Additional focused modules must not fail this architectural check');
for (const [file, imports] of deps) for (const imported of imports)
  assert.ok(deps.has(imported),`${file}: missing ${imported}`);
// Tarjan: prevent the two removed reverse edges from silently coming back.
const stack=[], indices=new Map(), low=new Map(), onStack=new Set(), groups=[];
function visit(v) {
  indices.set(v,indices.size);low.set(v,indices.get(v));stack.push(v);onStack.add(v);
  for(const w of deps.get(v)) {
    if (!indices.has(w)) {visit(w);low.set(v,Math.min(low.get(v),low.get(w)));}
    else if(onStack.has(w)) low.set(v,Math.min(low.get(v),indices.get(w)));
  }
  if (low.get(v)===indices.get(v)) {
    const group=[];let w;
    do {w=stack.pop();onStack.delete(w);group.push(w);} while(w!==v);
    groups.push(group);
  }
}
for(const v of deps.keys()) if(!indices.has(v)) visit(v);
const largest=Math.max(...groups.map(group=>group.length));
assert.ok(largest<=16,`Largest cyclic component grew to ${largest} modules`);
assert.ok(!groups.some(group=>group.length>1 && group.includes('attachments/05-attachment-scan.js')));
assert.ok(!groups.some(group=>group.length>1 && group.includes('app/11-route-inspection.js')));
const script=String.raw`
  import assert from 'node:assert/strict';
  for (const key of ['window','document','location','localStorage']) {
    Object.defineProperty(globalThis,key,{configurable:true,get(){throw Error('Import-time browser access: '+key);}});
  }
  const scan=await import('./src/attachments/05-attachment-scan.js');
  const route=await import('./src/app/11-route-inspection.js');
  const runtime=await import('./src/runtime/01-runtime-session-state.js');
  assert.equal(typeof scan.queueCommittedFileJobs,'function');
  assert.equal(typeof route.setSessionPhase,'function');
  const next=runtime.runtime.phase==='ready'?'generating':'ready';
  assert.equal(route.setSessionPhase(next),true);
  assert.equal(runtime.runtime.phase,next);
  assert.equal(route.setSessionPhase(next),false);
  console.log('PASS native browser-inert scanner and route state imports');
`;
const run=spawnSync(process.execPath,['--input-type=module','-e',script],{
  cwd:root,encoding:'utf8',timeout:12000
});
assert.equal(run.status,0,run.stderr||run.stdout||String(run.error));
process.stdout.write(run.stdout);
console.log(`PASS cycle boundaries (${largest} modules in largest SCC)`);
