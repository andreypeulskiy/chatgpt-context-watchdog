'use strict';
// Independent Node suites; classification and selection come from groups.json.
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {groups, LANES, CATEGORIES, validateRegistry, select} = require('./support/registry.cjs');
const selector = process.argv[2] || 'logic';
const resultFlag = process.argv.find(arg => arg.startsWith('--results='));
const resultPath = resultFlag?.slice('--results='.length);
try { validateRegistry(__dirname); }
catch (error) { console.error('TEST REGISTRY ERROR:', error.message); process.exit(1); }
if (selector === '--list') {
  for (const [name, suite] of Object.entries(groups))
    console.log(`${name}: ${suite.node.length} Node, ${suite.browser.length} browser`);
  for (const lane of LANES) {
    const suites = select(lane);
    console.log(`${lane}: ${suites.filter(x => x.kind === 'node').length} Node, ${suites.filter(x => x.kind === 'browser').length} browser`);
  }
  process.exit(0);
}
if (!['all', ...CATEGORIES, ...LANES].includes(selector)) {
  console.error('Usage: node tests/run.cjs [functional|visual|release|css|ui|logic|security|build|integration|all|--list] [--results=path]');
  process.exit(2);
}
const esmVmSuites = new Set([
  'attachment-pause-submission-esm.cjs', 'regression-esm.cjs', 'storage-esm-regression.cjs',
  'attachment-metadata-esm.cjs', 'settings-esm.cjs', 'ui-action-styles-esm.cjs',
  'thinking-route-regression.cjs', 'numeric-settings-esm.cjs', 'image-identity-esm.cjs', 'image-cache-invalidation-esm.cjs', 'ledger-audit-esm.cjs'
]);
const entries = select(selector).filter(item => item.kind === 'node');
const results = [];
for (const {file, category, lane} of entries) {
  const started = process.hrtime.bigint();
  const run = spawnSync(process.execPath,
    [...(esmVmSuites.has(file) ? ['--experimental-vm-modules'] : []), path.join(__dirname, file)],
    {cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024});
  const durationMs = Number((process.hrtime.bigint() - started) / 1000000n);
  const status = !run.error && run.status === 0 ? 'PASS' : 'FAIL';
  results.push({file, category, lane, kind:'node', status, durationMs,
    exitCode:run.status, error:run.error?.message || null});
  if (status === 'FAIL') console.error(`FAIL [${lane}/${category}] ${file}\n${run.stdout || ''}\n${run.stderr || ''}\n${run.error || ''}`);
  else console.log(`PASS [${lane}/${category}] ${file}`);
}
if (resultPath) fs.writeFileSync(resultPath, JSON.stringify({runner:'node',selector,results},null,2)+'\n');
const passed = results.filter(item => item.status === 'PASS').length;
console.log(`${passed}/${results.length} Node suites PASS (${selector})`);
if (passed !== results.length) process.exitCode = 1;
