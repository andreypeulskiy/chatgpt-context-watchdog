'use strict';
// History & calibration stays a dedicated metric-only panel.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = f => fs.readFileSync(path.join(__dirname, '../src/ui', f), 'utf8');
const markup = src('13-panel-markup.js');
const renderer = src('16-panel-rendering.js');
const styles = src('13-panel-styles.js');
const components = src('14-panel-components.js');
const history = markup.match(/historyBody: "([^\n]*)",/);
assert(history, 'lazy History pane is present');
const body = history[1];
assert.match(body, /cw-history-line/);
assert.match(body, /cw-history-note/);
for (const label of ['cw-messages-line','cw-roles-line','cw-effective-budgets','Ended chats','C \/ N \/ G token budget'])
  assert(!body.includes(label),`removed unrelated history metric: ${label}`);
for (const name of ['Recorded limit samples','Average message text','Average optimistic context',
  'Average pessimistic context','Calibration weight'])
  assert(renderer.includes(name),`missing metric: ${name}`);
assert.match(renderer, /hs\.avgOptimistic/);
assert.match(renderer, /hs\.n && Number\.isFinite\(value\)/);
assert.match(renderer, /'none'/);
assert.match(renderer, /historyWeight\.toFixed\(2\)/);
// History browser tests verify readable lines and missing-value semantics; no pixel/color-source string contract.
assert(!components.includes('messagesLine rolesLine'));
console.log('PASS history metric-only section, unit labels, missing-value semantics');
