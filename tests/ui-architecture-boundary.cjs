'use strict';
// Stage 4: passive UI components are not coupled to view coordination or actions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname,'..');
const sourceRoot = path.join(root,'src');
const get = name => fs.readFileSync(path.join(sourceRoot,name),'utf8');
const base = get('ui/14-panel-components.js');
const view = get('ui/14-panel-view-coordinator.js');
const actions = get('ui/15-panel-action-handlers.js');
const clamp = get('ui/12-panel-clamp.js');
const position = get('ui/12-panel-position.js');
assert.match(base,/function collectUiFields\(/);
assert.match(base,/function installUiHints\(/);
assert.match(view,/function mountPanelView\(/);
assert.match(view,/function setPanelView\(/);
assert.match(actions,/function bindPanelDialogActions\(/);
assert.match(get('ui/15-panel-dialog-mount.js'),/function mountPanelDialog\(/);
assert.match(actions,/function mountPanelSubsection\(/);
assert.doesNotMatch(get('ui/16-panel-rendering.js'),/\bmountPanelView\b/, 'Rendering must not construct UI views');
assert.doesNotMatch(base,/\b(?:mountPanelView|mountPanelDialog|mountPanelSubsection|renderDiagnostics|saveState|loadState)\b/);
assert.doesNotMatch(clamp,/^import\s/m);
assert.match(position,/function placePanel\(/);
assert.match(position,/function constrainPanel\(/);
for (const name of ['ui/14-panel-view-coordinator.js',
  'ui/14-panel-mini-navigation.js', 'ui/16-panel-rendering.js']) {
  assert.doesNotMatch(get(name),/\b(?:placePanel|constrainPanel|positionPanel|stabilizePanelPosition)\b/,
    `${name}: content rendering must not trigger panel geometry`);
}
assert.doesNotMatch(position,/from ['"]\.\/12-panel-shell\.js['"]/);
const baseImports = [...base.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m=>m[1]).sort();
assert.deepEqual(baseImports,["../runtime/01-runtime-ui-state.js","./12-panel-clamp.js"]);
const all = new Map();
function walk(dir){
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,ent.name);
    if(ent.isDirectory()) walk(full);
    else if(ent.name.endsWith('.js')){
      const id=path.relative(sourceRoot,full).split(path.sep).join('/');
      const deps = [...fs.readFileSync(full,'utf8').matchAll(/^import\s+.+?\s+from\s+['"]([^'"]+)['"]/gm)]
        .map(m=>path.posix.normalize(path.posix.join(path.posix.dirname(id),m[1])));
      all.set(id,deps);
    }
  }
}
walk(sourceRoot);
assert.ok(all.size >= 59, 'UI coordinator can add modules without changing the architectural contract');
for (const [id,deps] of all) for(const dep of deps) assert.ok(all.has(dep),`${id}: missing ${dep}`);
const baseId='ui/14-panel-components.js';
const reach=(id,seen=new Set())=>{
  if(seen.has(id)) return seen;
  seen.add(id);
  for(const d of all.get(id)||[]) reach(d,seen);
  return seen;
};
assert.ok(!reach(baseId).has('ui/16-panel-rendering.js'));
assert.ok(!reach(baseId).has('ui/15-panel-settings-controls.js'));
assert.ok(!reach(baseId).has('app/11-message-scan.js'));
for(const [id,deps] of all){
  if(id===baseId) continue;
  if(reach(id).has(baseId)) assert.ok(!reach(baseId).has(id),`Component dependency cycle with ${id}`);
}
const directMutual=[...all].flatMap(([id,deps])=>deps.filter(dep=>id<dep&&(all.get(dep)||[]).includes(id)).map(dep=>[id,dep]));
assert.ok(directMutual.length<=7,`Direct mutual imports: ${directMutual.length}`);
const check = String.raw`
  import assert from 'node:assert/strict';
  for (const key of ['window','document','location','localStorage']) {
    Object.defineProperty(globalThis,key,{configurable:true,get(){throw Error('Unexpected import-time browser access: '+key);}});
  }
  const base = await import('./src/ui/14-panel-components.js');
  assert.equal(typeof base.collectUiFields,'function');
  assert.equal(typeof base.installUiHints,'function');
  assert.ok(Array.isArray(base.PANEL_VIEWS));
  console.log('PASS passive UI components imported without browser access');
`;
const result=spawnSync(process.execPath,['--input-type=module','-e',check],{
  cwd:root,encoding:'utf8',timeout:12000
});
assert.equal(result.status,0,result.stderr||result.stdout||String(result.error));
process.stdout.write(result.stdout);
console.log(`PASS stage 4 UI boundaries, ${directMutual.length} direct import cycles`);
