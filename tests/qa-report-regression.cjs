'use strict';
// A missing release tool must remain NOT RUN (and the gate FAIL), even when
// functional tests passed. The report is generated from evidence, not guessed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const folder = fs.mkdtempSync(path.join(os.tmpdir(),'watchdog-qa-report-test-'));
try {
  const input=path.join(folder,'evidence.json');
  const output=path.join(folder,'report.md');
  fs.writeFileSync(input,JSON.stringify({
    schemaVersion:1, complete:true, version:'test-version',selection:'release-gate',
    startedAt:'sample',finishedAt:'sample',node:'test-node',
    summary:{overall:'FAIL'},build:[{variant:'stable',method:'offline fallback',sha256:'abc'}],
    suites:[{lane:'functional',status:'PASS'},{lane:'visual',status:'FAIL'}],
    stages:[{id:'release:eslint',lane:'release',status:'NOT_RUN',reason:'missing tool',durationMs:0}]
  }));
  const run=spawnSync(process.execPath,['tools/render-qa-report.cjs',input,output],
    {cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr||run.stdout);
  const md=fs.readFileSync(output,'utf8');
  assert.match(md,/Status: \*\*FAIL\*\*/);
  assert.match(md,/\| functional \| 1 \| 0 \| 1 \|/);
  assert.match(md,/\| visual \| 0 \| 1 \| 1 \|/);
  assert.match(md,/release:eslint \| release \| NOT_RUN/);
  assert.match(md,/offline fallback/);
  console.log('PASS report renderer: independent lane outcomes and explicit NOT RUN');
} finally {fs.rmSync(folder,{recursive:true,force:true});}
