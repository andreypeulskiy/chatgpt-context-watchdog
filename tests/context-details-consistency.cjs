// UI-only forecast visibility: factual diagnostics remain visible.
'use strict';
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const script = String.raw`
import assert from 'node:assert/strict';
import {buildDetailGroups} from './src/ui/16-panel-rendering.js';
const s = {
  turns:0,userTurns:0,assistantTurns:0,otherTurns:0,chars:0,tokens:0,uuidMessages:0,
  knownFileCount:0,totalFileBytes:0,knownImages:0,
  fileOptimistic:0,filePessimistic:0,imageOptimistic:0,imagePessimistic:0,
  optimistic:4000,pessimistic:16000
};
const eb = {conservative:80000,normal:120000,optimistic:180000};
const confirmed = buildDetailGroups(s,eb);
const pending = buildDetailGroups(s,eb,false);
assert.equal(confirmed.length,5);
assert.equal(pending.length,5);
assert.equal(confirmed[3][4],'Total context: 4,000–16,000 tokens');
assert.equal(pending[3][4],'Total context: none');
assert.equal(pending[3][5],'No context estimate yet.');
assert.equal(pending[4][0],'Conservative: none');
assert.equal(pending[4][1],'Normal: none');
assert.equal(pending[4][2],'Generous: none');
assert.equal(pending[4][3],'No context estimate yet.');
assert.equal(pending[0][0],'Messages: 0 total');
assert.equal(pending[3][0],'Message text: ≈ 0 tokens');
assert.equal(pending[3][3],'Hidden context: 4,000–16,000 tokens');
assert.deepEqual(pending.slice(0,3),confirmed.slice(0,3), 'Factual diagnostics stay visible');
const back=buildDetailGroups({...s,optimistic:12345,pessimistic:67890},eb,true);
assert.equal(back[3][4],'Total context: 12,345–67,890 tokens');
assert.match(back[4][0], /^Conservative: 12,345–67,890 \/ 80,000 tokens$/);
console.log('PASS Details forecast availability and unchanged factual metrics');
`;
const p=spawnSync(process.execPath,['--input-type=module','-e',script],
  {cwd:root,encoding:'utf8',timeout:15000});
assert.equal(p.status,0,p.stderr||p.stdout||String(p.error));
process.stdout.write(p.stdout);
