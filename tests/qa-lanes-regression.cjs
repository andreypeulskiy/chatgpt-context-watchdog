'use strict';
// Policy regression: version, CSS-source details and architecture are not
// functional/visual test prerequisites. Registry holds every suite once.
const assert = require('node:assert/strict');
const path = require('node:path');
const {groups, LANES, validateRegistry, select} = require('./support/registry.cjs');
const registered = Object.values(groups).reduce((count, suite) => count + suite.node.length + suite.browser.length, 0);
assert.equal(validateRegistry(path.join(__dirname)), registered);
const all = select('all');
const functional = select('functional');
const visual = select('visual');
const release = select('release');
assert.equal(all.length, functional.length + visual.length + release.length);
assert.equal(new Set(all.map(e => e.file)).size, all.length);
for (const suite of [...functional, ...visual]) {
  assert.notEqual(suite.file, 'release-metadata.cjs');
  assert.notEqual(suite.file, 'css-build-isolation.cjs');
  assert.notEqual(suite.file, 'documentation-regression.cjs');
}
assert.ok(release.some(item => item.file === 'release-metadata.cjs'));
assert.ok(visual.some(item => item.file === 'css-variants-ui.py'));
assert.ok(functional.some(item => item.file === 'pause-availability-ui.py'));
assert.ok(functional.some(item => item.file === 'data-integrity.cjs'));
const bogus = JSON.parse(JSON.stringify(groups));
bogus.build.node.push({file:'release-metadata.cjs',lane:'release'});
assert.throws(() => validateRegistry(__dirname,bogus),/Duplicate/);
const bogusLane = JSON.parse(JSON.stringify(groups));
bogusLane.logic.node[0].lane = 'other';
assert.throws(() => validateRegistry(__dirname,bogusLane),/Invalid/);
const missing = JSON.parse(JSON.stringify(groups));
missing.build.node.splice(missing.build.node.findIndex(item=>item.file==='release-metadata.cjs'),1);
assert.throws(() => validateRegistry(__dirname,missing),/Unclassified/);
console.log('PASS QA lanes: single inventory, independent selection, reject missing/duplicate/wrong lanes');
