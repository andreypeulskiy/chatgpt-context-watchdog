#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const markup=fs.readFileSync(path.join(root,'src/ui/13-panel-markup.js'),'utf8');
const lifecycle=fs.readFileSync(path.join(root,'src/ui/15-panel-dialog-lifecycle.js'),'utf8');
const actions=fs.readFileSync(path.join(root,'src/ui/15-panel-action-handlers.js'),'utf8');
// Protect user-visible factual concepts, not copywriting or incidental punctuation.
const concepts=[
  ['locally stored numeric estimates', /numeric estimates|numeric estimates?, message identifiers/i],
  ['chat prose not stored', /Full message text.{0,120}not saved|does not store full message text/i],
  ['HANDOFF exception', /HANDOFF template.{0,80}stored|saved (?:global )?HANDOFF/i],
  ['estimated, not measured', /Estimates, not measurements|not a measured model token count/i],
  ['no automatic network fallback for logo', /only-if-cached|cache-only/i],
  ['wipe does not reload', /without reloading|no page reload/i],
  ['visible chats can be recaptured', /(?:Visible|visible).{0,40}(?:messages|chat).{0,65}(?:collected again|recaptured)/i],
];
for (const [role,expression] of concepts)
  assert.match(markup,expression,`About missing meaning: ${role}`);
assert.match(actions,/badgePosition = \{ left: Math\.round/);
assert.match(lifecycle,/ui\.aboutDialog\.show\(\)/);
assert.match(lifecycle,/ui\.closeAbout\.focus\(\)/);
assert.match(actions,/insertAdjacentHTML\('beforeend', LAZY_SECTION_MARKUP\.aboutHelp\)/);
assert.doesNotMatch(actions,/window\.location\.reload\s*\(/);
console.log('PASS About factual guarantees and native disclosure lifecycle');
