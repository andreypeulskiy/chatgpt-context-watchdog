'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const {source:read,assertImport,reachableFrom}=require('./support/source-graph.cjs');

let passed = 0;
const check = (label, fn) => { fn(); console.log('PASS', label); passed++; };
check('Attachment modules are reachable via actual ES-module imports', () => {
  const reachable = reachableFrom();
  for (const id of ['attachments/05-attachment-helpers.js', 'attachments/05-react-metadata.js',
    'attachments/05-attachment-submission.js', 'attachments/05-attachment-scan.js',
    'attachments/06-attachment-reading.js']) assert.ok(reachable.has(id), id);
  assertImport('attachments/05-react-metadata.js', 'attachments/05-attachment-helpers.js');
  assertImport('attachments/05-attachment-scan.js', 'attachments/05-react-metadata.js');
  assertImport('attachments/05-attachment-scan.js', 'attachments/05-attachment-submission.js');
  assertImport('attachments/06-attachment-reading.js', 'attachments/05-attachment-submission.js');
});
check('React adapter is isolated and does not depend on the ledger or networking', () => {
  const code = read('attachments/05-react-metadata.js');
  assert.match(code, /function reactAttachmentMetadata\(/);
  assert.match(code, /function fileMetadataFromElement\(/);
  assert.doesNotMatch(code, /(?:saveState|loadState|fetch|XMLHttpRequest|WebSocket|EventSource|DecompressionStream)\s*\(/);
});
check('File scanner is isolated and never parses files', () => {
  const code = read('attachments/05-attachment-scan.js');
  assert.match(code, /function scanConversationFiles\(/);
  assert.doesNotMatch(code, /(?:arrayBuffer|text|DecompressionStream|fetch)\s*\(/);
});
check('The attachment helpers do not reference React internals', () => {
  const code = read('attachments/05-attachment-helpers.js');
  assert.match(code, /function metadataFileContextEstimate\(/);
  assert.doesNotMatch(code, /__reactFiber|memoizedProps/);
});
check('User-facing details expose unparsed counts without affecting estimates', () => {
  const code = read('ui/16-panel-rendering.js');
  assert.match(code, /Unparsed: \$\{number\(s\.unparsedFiles\)\}/);
  assert.doesNotMatch(code, /s\.tokens\s*=/);
});
console.log(`${passed} current attachment module-boundary checks passed`);
