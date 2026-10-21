'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const script=String.raw`
import assert from 'node:assert/strict';
import {HANDOFF_PROMPT, HANDOFF_MAX_CHARS, DEFAULTS, isValidHandoffPrompt} from './src/runtime/01-runtime-configuration.js';
import {LAZY_SECTION_MARKUP} from './src/ui/13-panel-markup.js';
assert.equal(HANDOFF_MAX_CHARS,4000);
assert.equal(DEFAULTS.handoffPrompt,HANDOFF_PROMPT);
assert.ok(isValidHandoffPrompt(HANDOFF_PROMPT));
assert.ok(isValidHandoffPrompt('a'.repeat(HANDOFF_MAX_CHARS)));
for(const invalid of [undefined,null,0,{},'', '   ', 'x'.repeat(HANDOFF_MAX_CHARS+1)]){
  assert.equal(isValidHandoffPrompt(invalid),false);
}
const markup=LAZY_SECTION_MARKUP.technicalForm;
assert.ok(markup.includes('maxlength="'+HANDOFF_MAX_CHARS+'"'));
assert.ok(markup.includes('0 / '+HANDOFF_MAX_CHARS));
console.log('PASS canonical HANDOFF validation and textarea contract');
`;
const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:15000});
assert.equal(result.status,0,result.stderr||result.stdout||String(result.error));
process.stdout.write(result.stdout);
