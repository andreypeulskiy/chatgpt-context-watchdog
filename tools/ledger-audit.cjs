#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { auditLedger } = require('./lib/ledger-audit.cjs');

const args = process.argv.slice(2);
const fail = message => { console.error(message); process.exitCode = 2; };
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node tools/ledger-audit.cjs ledger-snapshot.json [--output report.json]');
  console.log('Read-only offline audit. The report omits UUIDs, filenames, URLs and message content.');
} else {
  const input = args[0];
  const outputIndex = args.indexOf('--output');
  const output = outputIndex >= 0 ? args[outputIndex + 1] : null;
  if (args.length !== (outputIndex >= 0 ? 3 : 1) || (outputIndex >= 0 && (!output || outputIndex !== 1))) {
    fail('Invalid arguments; use --help for usage.');
  } else if (output && path.resolve(input) === path.resolve(output)) {
    fail('Output must not overwrite input.');
  } else {
    try {
      const size = fs.statSync(input).size;
      if (size > 25 * 1024 * 1024) throw new Error('Snapshot exceeds the 25 MiB safety cap.');
      const source = fs.readFileSync(input, 'utf8');
      const report = auditLedger(JSON.parse(source));
      if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ summary: report.summary, findingCounts: report.findingCounts,
        displayedFindings: report.findings, limitations: report.limitations }, null, 2));
      if (report.findingCounts.critical > 0) process.exitCode = 1;
    } catch (err) { fail(`Could not audit snapshot: ${err.message}`); }
  }
}
