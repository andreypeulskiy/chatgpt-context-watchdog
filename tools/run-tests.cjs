'use strict';
// Three independent QA lanes; test inventory is tests/groups.json.
// Candidate QA is allowed with explicitly recorded offline fallback builds.
// Canonical compiler/linter checks are deferred to user-controlled final release.
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {LANES, CATEGORIES, select} = require('../tests/support/registry.cjs');
const root = path.resolve(__dirname,'..');
const selector = process.argv[2] || 'logic';
const reportArg = process.argv.find(arg => arg.startsWith('--report='));
const reportPath = reportArg?.slice('--report='.length);
const allSelectors = [...LANES, ...CATEGORIES, 'all', 'node-all', 'candidate-gate', 'release-gate'];
if (!allSelectors.includes(selector)) {
  console.error('Usage: node tools/run-tests.cjs [functional|visual|release|css|ui|logic|security|build|integration|all|candidate-gate|release-gate] [--report=output.json]');
  process.exit(2);
}
const candidateGate = selector === 'candidate-gate';
const suites = candidateGate ? select('all') : (selector === 'node-all' ? select('all').filter(item => item.kind === 'node') : select(selector));
const version = require('../tests/support/current.cjs').version;
const record = {schemaVersion:1, version, selection:selector,
  startedAt:new Date().toISOString(), node:process.version,
  stages:[], suites:[], build:[], complete:false};
let failed = false;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(),'watchdog-qa-'));
function execute(id, lane, bin, args, options = {}) {
  console.log(`\n=== ${id} [${lane}] ===`);
  const begin = process.hrtime.bigint();
  const proc = spawnSync(bin,args,{cwd:root,encoding:'utf8',maxBuffer:5*1024*1024, ...options});
  const durationMs = Number((process.hrtime.bigint()-begin)/1000000n);
  const status = proc.error || proc.status !== 0 ? 'FAIL' : 'PASS';
  if (proc.stdout) process.stdout.write(proc.stdout);
  if (proc.stderr) process.stderr.write(proc.stderr);
  const result = {id,lane,status,durationMs,exitCode:proc.status,error:proc.error?.message || null};
  record.stages.push(result);
  if (status !== 'PASS') failed=true;
  console.log(`${status} ${id}`);
  return {result, stdout:proc.stdout || '', stderr:proc.stderr || ''};
}
function notRun(id,lane,reason) {
  record.stages.push({id,lane,status:'NOT_RUN',reason,durationMs:0});
  failed=true;
  console.warn(`NOT RUN ${id}: ${reason}`);
}
function moduleInstalled(module) {
  try { require.resolve(module,{paths:[root]}); return true; }
  catch { return false; }
}
function recordBundle(variant, buildOutput) {
  const suffix=variant==='dev'?'.dev':'';
  const p=path.join(root,'dist',`chatgpt-context-watchdog-${version}${suffix}.user.js`);
  record.build.push({variant,method:buildOutput.includes('(esbuild)')||buildOutput.includes(', esbuild)')?'esbuild':
    buildOutput.includes('offline fallback')?'offline fallback': 'unknown',
    sha256: fs.existsSync(p)?crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'):null});
}
try {
  const registry = execute('registry','release',process.execPath,['tests/run.cjs','--list']);
  const prereqOk=registry.result.status==='PASS';
  const needsDev=suites.some(item => item.kind==='browser' && item.category!=='integration') ||
    suites.some(item=>item.category==='build') || selector === 'release-gate' || candidateGate;
  let built=false;
  if (prereqOk && candidateGate) {
    // This is intentionally NOT an esbuild or publication certification.
    // Build both variants from current source and test those exact bytes.
    const stable=execute('candidate:build-stable-offline','release',process.execPath,['tools/build.cjs','--offline']);
    recordBundle('stable',stable.stdout);
    const dev=execute('candidate:build-dev-offline','release',process.execPath,['tools/build.cjs','--dev','--offline']);
    recordBundle('dev',dev.stdout);
    built=stable.result.status==='PASS' && dev.result.status==='PASS';
    record.candidatePolicy={offlineCompilerPermitted:true,canonicalEsbuild:'DEFERRED_TO_PUBLIC_RELEASE',
      eslint:'DEFERRED_TO_PUBLIC_RELEASE',stylelint:'DEFERRED_TO_PUBLIC_RELEASE',
      historicRc3Provenance:'NOT_APPLICABLE_TO_REBUILT_CANDIDATE'};
  } else if (prereqOk && !moduleInstalled('esbuild')) {
    // Testing a verified source-matched original esbuild bundle is more
    // informative than silently overwriting it with an incompatible offline
    // module-loader. Canonical rebuild is still a separate release gate.
    const artifact = execute('artifact:source-and-SHA','release',process.execPath,['tools/verify-test-artifacts.cjs']);
    built=artifact.result.status==='PASS';
    if(built) {
      const artifacts=require('./verify-test-artifacts.cjs').verify();
      for(const [variant,entry] of Object.entries(artifacts))
        record.build.push({variant,method:'verified prebuilt',sha256:entry.sha256});
    }
  } else if (prereqOk) {
    const stable=execute('build:stable','release',process.execPath,['tools/build.cjs']);
    recordBundle('stable',stable.stdout);
    const dev=needsDev?execute('build:dev','release',process.execPath,['tools/build.cjs','--dev']):null;
    if(dev)recordBundle('dev',dev.stdout);
    built=stable.result.status==='PASS' && (!needsDev||dev?.result.status==='PASS');
  }
  if (built) {
    // Run safety gates for the relevant selection, independently of suite classification.
    const wantFunctional = ['functional','all','node-all','release-gate','candidate-gate','security'].includes(selector);
    const wantRelease = ['release','all','node-all','release-gate','candidate-gate','build'].includes(selector);
    const wantCss = ['css','all','node-all','release-gate','candidate-gate'].includes(selector);
    if (wantFunctional) {
      execute('security:local-only','functional',process.execPath,['tools/source-safety-check.cjs']);
      execute('security:gate','functional',process.execPath,['tools/security-gate.cjs']);
    }
    if (wantRelease) {
      execute('architecture:guards','release',process.execPath,['tools/architecture-guards.cjs']);
      execute('build:modules','release',process.execPath,['tools/verify-modules.cjs']);
    }
    if (wantCss) execute('style:basic','release',process.execPath,['tools/style-check.cjs']);
    const nodeOut=path.join(scratch,'node.json');
    execute('node:suites',selector,process.execPath,['tests/run.cjs',['release-gate','candidate-gate','node-all'].includes(selector)?'all':selector,`--results=${nodeOut}`]);
    if (fs.existsSync(nodeOut)) record.suites.push(...JSON.parse(fs.readFileSync(nodeOut,'utf8')).results);
    const browserCount=suites.filter(item=>item.kind==='browser').length;
    if (browserCount) {
      const browserOut=path.join(scratch,'browser.json');
      execute('browser:suites',selector,'python',['-u','tests/ui-run.py',['release-gate','candidate-gate'].includes(selector)?'all':selector,`--results=${browserOut}`]);
      if (fs.existsSync(browserOut)) record.suites.push(...JSON.parse(fs.readFileSync(browserOut,'utf8')).results);
    }
  } else {
    notRun('node:suites',selector,'Failed registry validation or build');
    if (suites.some(item=>item.kind==='browser')) notRun('browser:suites',selector,'Failed registry validation or build');
  }
  if (selector==='release-gate') {
    if (!moduleInstalled('esbuild')) notRun('release:canonical-esbuild','release','esbuild dependency unavailable; offline fallback is not a certified release build');
    else if (record.build.some(item=>item.method!=='esbuild')) notRun('release:canonical-esbuild','release','At least one bundle used a noncanonical builder');
    else execute('release:canonical-esbuild','release',process.execPath,['tools/verify-build.cjs']);
    for (const [id,mod,args] of [
      ['release:eslint','eslint',['run','qa:js']],
      ['release:stylelint','stylelint',['run','qa:css']]]) {
      if (!moduleInstalled(mod)) notRun(id,'release',`${mod} dependency unavailable`);
      else execute(id,'release','npm',args);
    }
    execute('release:typecheck','release','tsc',['--noEmit','--strict','--lib','ES2022,DOM','types/context-watchdog.d.ts']);
  }
} catch (error) {
  notRun('orchestration','release',`Runner exception: ${error.stack||error}`);
} finally {
  record.finishedAt=new Date().toISOString();
  record.complete=true; // runner finished; does not imply all gates passed
  record.summary={passed:record.suites.filter(item=>item.status==='PASS').length,
    failed:record.suites.filter(item=>item.status==='FAIL').length,
    notRunStages:record.stages.filter(item=>item.status==='NOT_RUN').length,
    failingStages:record.stages.filter(item=>item.status==='FAIL').length,
    overall:failed?'FAIL':'PASS'};
  if (reportPath) {
    fs.mkdirSync(path.dirname(path.resolve(reportPath)),{recursive:true});
    fs.writeFileSync(reportPath,JSON.stringify(record,null,2)+'\n');
    const md=reportPath.replace(/\.json$/,'')+'.md';
    const res=spawnSync(process.execPath,['tools/render-qa-report.cjs',reportPath,md],{cwd:root,encoding:'utf8'});
    if (res.status!==0) console.error('Cannot render Markdown report:',res.stderr);
    else console.log(`QA evidence: ${path.resolve(reportPath)} | ${path.resolve(md)}`);
  }
  fs.rmSync(scratch,{recursive:true,force:true});
  console.log(`\n${record.summary.overall} ${selector}: ${record.summary.passed}/${record.suites.length} suites PASS; ${record.summary.failingStages} failed stages; ${record.summary.notRunStages} NOT RUN stages`);
}
if (failed) process.exitCode=1;
