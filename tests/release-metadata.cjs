'use strict';
// Release-only metadata and installed About version coherence.
// Intentionally not part of functional or visual test lanes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {root, version, bundlePath} = require('./support/current.cjs');
const packageVersion = JSON.parse(fs.readFileSync(path.join(root,'package.json'), 'utf8')).version;
assert.equal(packageVersion,version,'Package and userscript header versions must match');
const bundle = fs.readFileSync(bundlePath,'utf8');
assert.match(bundle,new RegExp('^// @version\\s+'+version.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$', 'm'));
const parsed = ts.createSourceFile(bundlePath,bundle,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let foundAbout = false;
function visit(node) {
  if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text.includes(`Version ${version} · Designed &amp; maintained`)) foundAbout = true;
  ts.forEachChild(node,visit);
}
visit(parsed);
assert.ok(foundAbout, 'Installed About version must match the current userscript header');
console.log('PASS release metadata, package and About version are coherent');
