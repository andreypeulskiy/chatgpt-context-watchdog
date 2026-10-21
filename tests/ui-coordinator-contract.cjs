'use strict';
// UI lifecycle and dialog dependencies go one way, with no direct cycles.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const src=path.join(root,'src');
const read=id=>fs.readFileSync(path.join(src,id),'utf8');
const coordinator=read('ui/15-panel-ui-coordinator.js');
const fields=read('ui/15-panel-settings-controls.js');
const events=read('ui/15-panel-settings-events.js');
const dialog=read('ui/15-panel-dialog-lifecycle.js');
const hooks=read('ui/15-panel-dialog-hooks.js');
const shell=read('ui/12-panel-shell.js');
assert.match(coordinator,/function ensureUI\(/);
assert.match(coordinator,/bindPanelDialogHooks\(mountPanelDialog, discardUnsavedSettingsInputs\)/);
assert.match(read('ui/15-panel-dialog-mount.js'),/function mountPanelDialog\(/);
assert.match(coordinator,/disposePanelDialogObservers\(ui\.root\)/);
assert.match(coordinator,/resetPanelDialogsForRemount\(\)/);
assert.doesNotMatch(fields,/\bfunction ensureUI\(/);
assert.doesNotMatch(fields,/from ['"]\.\/15-panel-settings-events\.js['"]/);
assert.doesNotMatch(fields,/from ['"]\.\/14-panel-view-coordinator\.js['"]/);
assert.doesNotMatch(dialog,/from ['"]\.\/15-panel-action-handlers\.js['"]/);
assert.doesNotMatch(dialog,/from ['"]\.\/15-panel-settings-controls\.js['"]/);
assert.match(dialog,/function resetPanelDialogsForRemount\(/);
assert.match(hooks,/function ensurePanelDialogMounted\(/);
assert.match(events,/\bfunction bindUiEvents\(/);
assert.match(shell,/window\.removeEventListener\('resize', previousResizeHandler\)/);
assert.doesNotMatch(shell,/from ['"]\.\/15-panel-ui-coordinator\.js['"]/);
const modules=new Map();
function walk(folder){
  for(const ent of fs.readdirSync(folder,{withFileTypes:true})){
    const f=path.join(folder,ent.name);
    if(ent.isDirectory()) walk(f);
    else if(ent.name.endsWith('.js')){
      const id=path.relative(src,f).replaceAll(path.sep,'/');
      modules.set(id,[...fs.readFileSync(f,'utf8').matchAll(/^import\s+.*?from\s+['"]([^'"]+)['"]/gm)]
        .map(m=>path.posix.normalize(path.posix.join(path.posix.dirname(id),m[1]))));
    }
  }
}
walk(src);
for(const [id,ds] of modules){
  for(const d of ds){
    assert.ok(modules.has(d),`${id}: unresolved import ${d}`);
    assert.ok(!modules.get(d).includes(id),`Mutual import: ${id} <-> ${d}`);
  }
}
// Importing coordinator must not implicitly construct DOM or read storage.
const script=String.raw`
  import assert from 'node:assert/strict';
  for(const key of ['window','document','location','localStorage']){
    Object.defineProperty(globalThis,key,{configurable:true,get(){throw Error('Import accessed browser: '+key)}});
  }
  const coordinator=await import('./src/ui/15-panel-ui-coordinator.js');
  assert.equal(typeof coordinator.ensureUI,'function');
  console.log('PASS UI coordinator import has no browser side effects');
`;
const r=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:12000});
assert.equal(r.status,0,r.stderr||r.stdout||String(r.error));
process.stdout.write(r.stdout);
console.log(`PASS UI lifecycle graph (${modules.size} modules, zero direct mutual imports)`);
