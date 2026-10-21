'use strict';
// Convert captured results only; never infer that an unexecuted test passed.
const fs = require('node:fs');
const path = require('node:path');
if (process.argv.length !== 4) {
  console.error('Usage: node tools/render-qa-report.cjs evidence.json report.md');
  process.exit(2);
}
const record=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if (record.schemaVersion !== 1 || !record.complete || !Array.isArray(record.suites) || !Array.isArray(record.stages))
  throw Error('Invalid/incomplete QA evidence');
const lines=[`# QA — ${record.version} — ${record.selection}`,'',
  `- Started: ${record.startedAt}`,
  `- Finished: ${record.finishedAt}`,
  `- Node: ${record.node}`,
  `- Status: **${record.summary.overall}**`,'',
  '## Suite outcomes','','| Lane | PASS | FAIL | Total executed |','| --- | ---: | ---: | ---: |'];
for (const lane of ['functional','visual','release']) {
  const rows=record.suites.filter(x=>x.lane===lane);
  lines.push(`| ${lane} | ${rows.filter(x=>x.status==='PASS').length} | ${rows.filter(x=>x.status==='FAIL').length} | ${rows.length} |`);
}
lines.push('','## Execution stages','','| Stage | Lane | Status | Duration, ms |','| --- | --- | --- | ---: |');
for (const step of record.stages)
  lines.push(`| ${step.id} | ${step.lane} | ${step.status}${step.reason?' — '+step.reason.replaceAll('|','/') :''} | ${step.durationMs??'—'} |`);
lines.push('','## Built artifacts','','| Variant | Method | SHA-256 |','| --- | --- | --- |');
for (const b of record.build) lines.push(`| ${b.variant} | ${b.method} | ${b.sha256??'NOT AVAILABLE'} |`);
lines.push('','The totals above come exclusively from actual executions. **NOT RUN is not PASS.**',
 'Functional/Visual PASS does not certify release readiness.','');
fs.mkdirSync(path.dirname(path.resolve(process.argv[3])),{recursive:true});
fs.writeFileSync(process.argv[3],lines.join('\n'));
