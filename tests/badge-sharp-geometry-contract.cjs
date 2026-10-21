'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = p => fs.readFileSync(path.join(root, p), 'utf8');
const position = source('src/ui/12-panel-position.js');
const shell = source('src/ui/12-panel-shell.js');
const handlers = source('src/ui/15-panel-action-handlers.js');
assert.match(position, /function restoreDefaultBadgeAnchor\(root, panelOpen\)/);
assert.match(position, /window\.innerWidth - badgeRect\.width/);
assert.match(position, /window\.innerHeight - badgeRect\.height/);
assert.match(position, /delete root\.dataset\.cwPanelOpen/);
// The restore path must measure the FULL badge. A global grep would also
// match applySavedBadgePosition(), missing a regression in this function.
const resetStart = position.indexOf('function restoreDefaultBadgeAnchor(');
assert.ok(resetStart >= 0, 'Default badge reset is required');
const resetBody = position.slice(resetStart,position.indexOf('function placePanel(',resetStart));
assert.match(resetBody, /root\.querySelector\('\.cw-chip'\)\.getBoundingClientRect\(\)/);
assert.match(shell, /restoreDefaultBadgeAnchor\(root, !ui\?\.panel\?\.hidden\)/);
assert.match(handlers, /restoreDefaultBadgeAnchor\(ui\.root, !ui\.panel\.hidden\)/);
assert.match(handlers, /placePanel\(\);\s+fitPanelDialogToPanel\(\)/);
assert.doesNotMatch(handlers, /ui\.root\.style\.right = window\.innerWidth <= 600/);
// Chromium badge-sharp-geometry-ui exercises visible focus, Soft/Sharp distinction,
// hit target and viewport edges. The implementation need not use a CSS polygon.
console.log('PASS reset measures full badge; Sharp/Soft visual behavior covered in Chromium');
