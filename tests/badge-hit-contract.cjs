'use strict';
// only the original logo can toggle by pointer; comment contracts are truthful.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../src');
const load=name=>fs.readFileSync(path.join(root,name),'utf8');
const markup=load('ui/13-panel-markup.js');
const events=load('ui/15-panel-settings-events.js'), header=load('userscript-header.txt');
assert.match(markup,/<span class="cw-logo-hit"><span class="cw-site-icon cw-brand-mark" aria-hidden="true"><\/span><\/span>/);
// Browser badge-hit and logo-circle suites test the real pointer and keyboard region.
// Hover presentation is exercised in Chromium by the brand-colors and badge-hit UI suites.
assert.match(events,/function isBadgeLogoActivation\(event\)/);
assert.match(events,/if \(event\.detail === 0\) return true/);
assert.match(events,/Math\.hypot\(dx, dy\) <= hitDiameter \/ 2/);
assert.match(events,/if \(!isBadgeLogoActivation\(event\)\) return/);
assert.match(header,/bounded one-shot checks/);
assert.match(header,/Edit\/Regenerate/);
assert.match(header,/Read-only Audit/);
assert.match(header,/cannot inspect hidden system context/);
assert.doesNotMatch(header,/known IDs are\s*\n?\s*never re-tokenized|DOM events only/);
console.log('PASS pointer-only icon activation, hover feedback and accurate header comments');
