'use strict';
// Stage 3: SPA routing belongs to Application, while Startup only wires events.
// Check the actual ESM graph and lifecycle, not the classic test projection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root,'src',relative),'utf8');
const startup = read('app/17-spa-observer-startup.js');
const route = read('app/11-route-navigation.js');
const scan = read('app/11-message-scan.js');
const coordinator = read('app/17-conversation-coordinator.js');
const audit = read('app/10-audit-repair.js');
const controller = read('app/11-route-inspection.js');
const main = read('main.js');
const sourceDir = path.join(root, 'src');
function inspectImports(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) { inspectImports(full); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const id = path.relative(sourceDir,full).split(path.sep).join('/');
    if (id === 'main.js') continue;
    const text = fs.readFileSync(full,'utf8');
    assert.doesNotMatch(text,/from ['"][^'"]*17-spa-observer-startup\.js['"]/, 
      `Only main.js may import Startup; unexpected dependency in ${id}`);
  }
}
inspectImports(sourceDir);
for (const name of ['ui/14-panel-components.js','ui/15-panel-settings-events.js',
                   'chatgpt/11-message-hydration.js']) {
  assert.doesNotMatch(read(name),/from ['"]\.\.\/app\/17-spa-observer-startup\.js['"]/,
    `Reverse Startup dependency: ${name}`);
}

for (const [name, source] of [['scan',scan],['audit',audit],['route',route],['controller',controller],['coordinator',coordinator]]) {
  assert.doesNotMatch(source,/from ['"]\.\/17-spa-observer-startup\.js['"]/,`${name} depends on Startup`);
}
assert.match(main,/import \{ start \} from '\.\/app\/17-spa-observer-startup\.js'/);
assert.match(main,/\nstart\(\);/);
assert.match(startup,/function start\(\)/);
assert.doesNotMatch(startup,/function synchronizeChatRoute\(/);
for(const name of ['snapshotRouteDom','routeDomHasChanged','synchronizeChatRoute','routeVerifiedOrWait']){
  assert.match(route,new RegExp(`function ${name}\\(`));
}
assert.match(startup,/import \{ synchronizeChatRoute \} from '\.\/11-route-navigation\.js'/);
assert.match(scan,/from '\.\/11-route-navigation\.js'/);
assert.match(coordinator,/function onConversationEvent\(/);
assert.match(coordinator,/function queueConversationEvent\(/);
assert.doesNotMatch(startup,/function onConversationEvent\(/);
assert.match(audit,/from '\.\/11-route-navigation\.js'/);
const native = String.raw`
  import assert from 'node:assert/strict';
  let storageListeners=0, domListeners=0, called=0;
  for (const key of ['window','document','location','localStorage']) {
    Object.defineProperty(globalThis,key,{configurable:true,get(){throw Error('Unexpected access during ESM import: '+key);}});
  }
  const startup = await import('./src/app/17-spa-observer-startup.js');
  const route = await import('./src/app/11-route-navigation.js');
  assert.equal(typeof startup.start,'function');
  assert.equal(typeof route.synchronizeChatRoute,'function');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{
    addEventListener(type){if(type==='storage') storageListeners++;}
  }});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{
    readyState:'loading', addEventListener(type){if(type==='DOMContentLoaded') domListeners++;}
  }});
  startup.start();startup.start();
  assert.equal(storageListeners,1,'only one storage listener registered');
  assert.equal(domListeners,1,'boot awaits DOMContentLoaded once');
  assert.equal(called,0);
  console.log('PASS native ESM import without browser effects; explicit idempotent startup');
`;
const proc = spawnSync(process.execPath,['--input-type=module','-e',native],{
  cwd:root,encoding:'utf8',timeout:12000
});
assert.equal(proc.status,0,proc.stderr||proc.stdout||String(proc.error));
process.stdout.write(proc.stdout);
console.log('PASS stage 3 application/SPA/startup import boundary');
