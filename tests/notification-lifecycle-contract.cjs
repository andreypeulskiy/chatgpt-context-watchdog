'use strict';
const assert = require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,'src',p),'utf8');
const rendering=read('ui/16-panel-rendering.js');
const dialogs=read('ui/15-panel-dialog-lifecycle.js');
const events=read('ui/15-panel-settings-events.js');
const markup=read('ui/13-panel-markup.js');
const positioning=read('ui/12-panel-position.js');
assert.match(rendering,/function clearTransientNotification\(\)/);
assert.match(rendering,/currentUi\.toast\.hidden = false/);
assert.match(rendering,/clearTimeout\(showToast\._timer\)/);
assert.match(rendering,/if \(ui !== currentUi\) return/);
assert.doesNotMatch(rendering,/currentUi\.toast\.hidden = anyDialogOpen/);
for (const fn of ['openSettingsDialog','openAboutDialog','openLimitDialog','requestPanelConfirmation','closePanelDialog']) {
 const segment=dialogs.slice(dialogs.indexOf('function '+fn+'(')).split('\n  function ')[0];
 assert.ok(!segment.includes('clearTransientNotification()'),fn+' preserves notice');
}
assert.doesNotMatch(events,/clearTransientNotification/,'Panel dismissal cannot clear a live notice');
assert.match(markup,/cw-toolbar[\s\S]*cw-notice-lane[\s\S]*cw-toast[\s\S]*cw-tabs/);
// Browser notification-lifecycle-ui protects visible notice placement/stacking.
// CSS grid tracks, columns and heights are not a Node-level implementation contract.
assert.doesNotMatch(positioning,/anchorPanelToastToViewport/);
assert.match(rendering,/ui\.storageWarning\.hidden = !problem/);
console.log('PASS notification compact header: one latest-message timer, dialog blur preservation, panel close preserves notice lifetime and persistent storage warning');
