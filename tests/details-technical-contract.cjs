'use strict';
// native ESM layout contracts, no dependency on userscript loader internals.
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = String.raw`
import assert from 'node:assert/strict';
import {buildDetailGroups} from './src/ui/16-panel-rendering.js';
import {LAZY_SECTION_MARKUP} from './src/ui/13-panel-markup.js';
const metrics = {
  turns:190,userTurns:101,assistantTurns:89,otherTurns:0,chars:116264,uuidMessages:190,
  knownFileCount:3,totalFileBytes:1266627,unknownSizeFiles:0,
  parsedFiles:0,metadataFiles:3,unparsedFiles:0,reactMetadataFiles:3,
  autoPasteMinimumFiles:0,autoPasteMinimumChars:0,fullyReadTextFiles:0,
  sampledTextFiles:0,knownFileTokens:0,
  knownImages:12,capturedImages:0,historicalImages:12,knownImageTokens:25200,
  tokens:56892,fileOptimistic:1503,filePessimistic:10637,
  imageOptimistic:5040,imagePessimistic:20160,optimistic:67535,pessimistic:103789
};
const budgets={conservative:80000,normal:120000,optimistic:180000};
const groups=buildDetailGroups(metrics,budgets);
assert.equal(groups.length,5);
assert.deepEqual(groups[3], [
  'Message text: ≈ 56,892 tokens',
  'Files: 1,503–10,637 tokens',
  'Images: 5,040–20,160 tokens',
  'Hidden context: 4,000–16,000 tokens',
  'Total context: 67,535–103,789 tokens',
  'Ranges: optimistic–pessimistic.'
]);
assert.deepEqual(groups[4], [
  'Conservative: 67,535–103,789 / 80,000 tokens',
  'Normal: 67,535–103,789 / 120,000 tokens',
  'Generous: 67,535–103,789 / 180,000 tokens',
  'Estimated usage / context budget.'
]);
assert.ok(groups[0].includes('Message length: 116,264 characters'));
assert.ok(groups[1].includes('Known size: 1,266,627 bytes'));
assert.ok(groups[1].includes('Auto-paste assumed text: 0 characters'));
assert.ok(groups[1].includes('React metadata: 3 files'));
assert.ok(groups[2].includes('Found in history: 12 images'));
for(const line of groups.flat()){
 assert.doesNotMatch(line, /\d+\s*%|\b(?:OK|Healthy|High|Low|overrun|remaining)\b/i);
 assert.doesNotMatch(line, /\b(?:Optimistic|Pessimistic)\s*:/i);
}
const exceeded=buildDetailGroups({...metrics,optimistic:14501,pessimistic:17500}, {conservative:10000,normal:12000,optimistic:20000});
assert.equal(exceeded[4][0],'Conservative: 14,501–17,500 / 10,000 tokens');
const unknown=buildDetailGroups({...metrics,fileOptimistic:undefined,filePessimistic:undefined},budgets);
assert.equal(unknown[3][1],'Files: none');
assert.equal(buildDetailGroups({...metrics, tokens:undefined}, budgets)[3][0], 'Message text: none');
assert.ok(groups[1].at(-1).includes('no age-based reduction'));
const markup=LAZY_SECTION_MARKUP.technicalForm;
assert.ok(markup.indexOf('class="cw-handoff-editor"')<markup.indexOf('class="cw-hidden-optimistic"'), 'HANDOFF must be first in Technical');
assert.ok(markup.indexOf('class="cw-handoff-editor"')<markup.indexOf('class="cw-save-settings"'));
assert.ok(markup.includes('maxlength="4000"') && markup.includes('cw-handoff-unsaved'));
console.log('PASS native  Details metric/legend/budget/Technical-order contracts');
`;
const p=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:15000});
assert.equal(p.status,0,p.stderr||p.stdout||String(p.error));
process.stdout.write(p.stdout);
