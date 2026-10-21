'use strict';
// Reproducibility is a RELEASE contract, and must never overwrite dist.
// A test that mutates the artifact under test invalidates subsequent QA.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const os=require('node:os');
const {inspectCacheOnlyCalls}=require('./cache-only-policy.cjs');
const {root,bundlePath,version}=require('../tests/support/current.cjs');
const original=fs.readFileSync(bundlePath);
const minBundlePath=path.join(root,'dist',`chatgpt-context-watchdog-${version}.min.user.js`);
const originalMin=fs.readFileSync(minBundlePath);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'watchdog-reproducibility-'));
try {
  const localDependencies=path.join(root,'node_modules');
  if(!fs.existsSync(localDependencies))throw Error('Canonical esbuild dependencies unavailable; release reproducibility NOT RUN');
  fs.cpSync(path.join(root,'src'),path.join(tmp,'src'),{recursive:true});
  fs.mkdirSync(path.join(tmp,'tools'),{recursive:true});
  fs.copyFileSync(path.join(root,'tools/build.cjs'),path.join(tmp,'tools/build.cjs'));
  fs.copyFileSync(path.join(root,'tools/cache-only-policy.cjs'),path.join(tmp,'tools/cache-only-policy.cjs'));
  fs.symlinkSync(localDependencies,path.join(tmp,'node_modules'),'dir');
  const run=spawnSync(process.execPath,[path.join(tmp,'tools/build.cjs')],
    {cwd:tmp,encoding:'utf8',timeout:25000});
  assert.equal(run.status,0,run.stderr||run.stdout||String(run.error));
  assert.match(run.stdout,/\(.*esbuild\)/,'Must be canonical esbuild, never offline fallback');
  const generated=path.join(tmp,'dist',path.basename(bundlePath));
  const built=fs.readFileSync(generated);
  assert.deepEqual(original,built,'Canonical bundled output must be reproducible');
  const text=built.toString('utf8');
  new vm.Script(text,{filename:path.basename(bundlePath)});
  assert.match(text,new RegExp('^// @version\\s+'+version.replaceAll('.','\\.')+'$','m'));
  assert.match(text,/function validMessageRecord\(/);
  assert.match(text,/failedScanDraft/);
  assert.doesNotMatch(text,/^\/\/ @require\s/m);
  assert.doesNotMatch(text,/\b(?:XMLHttpRequest|WebSocket|EventSource)\s*\(/);
  const cacheReview=inspectCacheOnlyCalls(text,'bundle');
  assert.equal(cacheReview.count,1);
  assert.deepEqual(cacheReview.problems,[]);
  assert.doesNotMatch(text,/\b(?:readZipEntries|inflateRawBytes|estimateOfficeFileTokens)\s*\(/);
  assert.equal((text.match(/^\/\/ ==UserScript==$/gm)||[]).length,1);
  assert.ok(text.includes('function calculateContextEstimate('),'Pure calculations are bundled');
  const minRun=spawnSync(process.execPath,[path.join(tmp,'tools/build.cjs'),'--minify'],
    {cwd:tmp,encoding:'utf8',timeout:25000});
  assert.equal(minRun.status,0,minRun.stderr||minRun.stdout||String(minRun.error));
  assert.match(minRun.stdout,/\(.*esbuild\)/,'Minified build must use canonical esbuild');
  const minGenerated=path.join(tmp,'dist',path.basename(minBundlePath));
  const minBuilt=fs.readFileSync(minGenerated);
  assert.deepEqual(originalMin,minBuilt,'Minified canonical output must be reproducible');
  const minText=minBuilt.toString('utf8');
  new vm.Script(minText,{filename:path.basename(minBundlePath)});
  assert.match(minText,new RegExp('^// @version\\s+'+version.replaceAll('.','\\.')+'$','m'));
  assert.equal((minText.match(/^\/\/ ==UserScript==$/gm)||[]).length,1);
  assert.doesNotMatch(minText,/\b(?:XMLHttpRequest|WebSocket|EventSource)\s*\(/);
  const minCacheReview=inspectCacheOnlyCalls(minText,'bundle',{checkNamedUrlGuard:false});
  assert.equal(minCacheReview.count,1);
  assert.deepEqual(minCacheReview.problems,[]);
  assert.ok(minBuilt.length<original.length,'Minified stable must be smaller than Stable');
  console.log('PASS canonical ES module reproducibility, standalone local-only build, no artifact modification');
  console.log('SHA256',crypto.createHash('sha256').update(built).digest('hex'));
  console.log('PASS minified Stable reproducibility, syntax, cache-only policy and reduced size');
  console.log('SHA256 minified',crypto.createHash('sha256').update(minBuilt).digest('hex'));
} finally {
  fs.rmSync(tmp,{recursive:true,force:true});
  assert.deepEqual(fs.readFileSync(bundlePath),original,'Release test must preserve supplied artifact bytes');
  assert.deepEqual(fs.readFileSync(minBundlePath),originalMin,'Release test must preserve supplied minified artifact bytes');
}
