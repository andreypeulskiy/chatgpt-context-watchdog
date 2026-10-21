'use strict';
// Stage 3: Dev responsive CSS is source-only; two standalone variants are built.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const os=require('node:os');
const root=path.join(__dirname,'..');
const {version}=require('./support/current.cjs');
const src=fs.readFileSync(path.join(root,'src/ui/13-panel-styles.js'),'utf8');
const devSource=fs.readFileSync(path.join(root,'src/ui/dev-responsive.css'),'utf8');
const stablePath=path.join(root,`dist/chatgpt-context-watchdog-${version}.user.js`);
const devPath=path.join(root,`dist/chatgpt-context-watchdog-${version}.dev.user.js`);
const original=fs.readFileSync(stablePath);
assert.doesNotMatch(src,/@media\s*\(\s*max-width\s*:/);
assert.match(devSource, /@media\s*\(\s*max-width\s*:/, 'Dev CSS must define responsive overrides');
assert.match(src,/@media\s*\(hover:\s*hover\)/);
assert.match(src,/@media\s*\(hover:\s*none\)/);
// Never rebuild or overwrite the shipped dist while running a test.
// Use a disposable directory: bundle correctness is checked by release gate.
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'watchdog-build-isolation-'));
let stable,dev;
try {
 fs.cpSync(path.join(root,'src'),path.join(temp,'src'),{recursive:true});
 fs.mkdirSync(path.join(temp,'tools'),{recursive:true});
 fs.mkdirSync(path.join(temp,'dist'),{recursive:true});
 fs.copyFileSync(path.join(root,'tools/build.cjs'),path.join(temp,'tools/build.cjs'));
 fs.copyFileSync(path.join(root,'tools/cache-only-policy.cjs'),path.join(temp,'tools/cache-only-policy.cjs'));
 fs.copyFileSync(stablePath,path.join(temp,'dist',path.basename(stablePath)));
 const result=spawnSync(process.execPath,[path.join(temp,'tools/build.cjs'),'--dev','--offline'],
   {cwd:temp,encoding:'utf8',timeout:26000});
 assert.equal(result.status,0,result.stderr||result.stdout||String(result.error));
 stable=fs.readFileSync(path.join(temp,'dist',path.basename(stablePath)),'utf8');
 dev=fs.readFileSync(path.join(temp,'dist',path.basename(devPath)),'utf8');
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
assert.deepEqual(fs.readFileSync(stablePath),original,'Test must preserve shipped Stable bytes');
assert.deepEqual(Buffer.from(stable),original,'Dev build must not affect the Stable build');
assert.doesNotMatch(stable,/@media\s*\(\s*max-width\s*:/);
assert.match(dev, /@media\s*\(\s*max-width\s*:/, 'Dev build includes responsive rules');
assert.match(stable,/^\/\/ @name\s+ChatGPT Context Watchdog \(Local\)$/m);
assert.match(dev,/^\/\/ @name\s+ChatGPT Context Watchdog \(Local Dev\)$/m);
assert.match(dev,/^\/\/ @namespace\s+local\.chatgpt\.context\.watchdog\.dev$/m);
assert.match(stable,/^\/\/ @namespace\s+local\.chatgpt\.context\.watchdog$/m);
assert.ok(Buffer.byteLength(dev)>Buffer.byteLength(stable),'Dev includes CSS not present in Stable');
assert.doesNotMatch(stable,/DEV ONLY: narrow browser viewport/);
assert.match(dev,/DEV ONLY: narrow browser viewport/);
console.log('PASS Stable/Dev isolated builds, responsive Dev CSS, unchanged Stable, distinct metadata');
