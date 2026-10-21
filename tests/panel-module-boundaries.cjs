'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const {source:read,reachableFrom,assertImport}=require('./support/source-graph.cjs');

let passed = 0;
function check(label, action) { action(); console.log(`PASS ${label}`); passed++; }
check('CSS and markup are separate, reachable ES modules', () => {
  assertImport('ui/15-panel-ui-coordinator.js', 'ui/13-panel-styles.js');
  assertImport('ui/15-panel-ui-coordinator.js', 'ui/13-panel-markup.js');
  assert.match(read('ui/13-panel-styles.js'),/const UI_CSS = `/);
  assert.doesNotMatch(read('ui/13-panel-styles.js'),/LAZY_DIALOG_MARKUP|UI_MARKUP/);
  assert.match(read('ui/13-panel-markup.js'),/const UI_MARKUP = `/);
  assert.doesNotMatch(read('ui/13-panel-markup.js'),/const UI_CSS/);
});
check('Dialog modules are reachable and wired through ES imports', () => {
  const names=['ui/15-panel-settings-controls.js','ui/15-panel-dialog-geometry.js',
    'ui/15-panel-dialog-lifecycle.js','ui/15-panel-settings-events.js'];
  const reachable = reachableFrom();
  assert.ok(names.every(name => reachable.has(name)));
  for (const name of names) assertImport('ui/15-panel-ui-coordinator.js', name);
});
check('Geometry reads the current dialog height but does not touch ledger or forecast', () => {
  const code=read('ui/15-panel-dialog-geometry.js');
  assert.match(code,/function fitPanelDialogToPanel\(/);
  assert.match(code,/function observePanelDialogLayout\(/);
  assert.match(code,/function queuePanelDialogFit\(/);
  assert.match(code,/ResizeObserver/);
  assert.doesNotMatch(code,/\b(?:loadState|saveState|captureMessages|effectiveImageStats|fetch|XMLHttpRequest|WebSocket)\s*\(/);
  assert.doesNotMatch(code,/panelDialogAppearanceMinHeight/);
});
check('Lifecycle restores original size and focus when closing', () => {
  const code=read('ui/15-panel-dialog-lifecycle.js');
  assert.match(code,/function closePanelDialog\(/);
  assert.match(code,/setPanelDialogBaseline\(null\)/);
  assert.match(code,/baseline\?\.inlineHeight \?\? ''/);
  assert.match(code,/function openAboutDialog\(/);
  assert.doesNotMatch(code,/terms\.open = false|section\.open =/);
  assert.doesNotMatch(code,/\b(?:saveState|captureMessages|fetch)\s*\(/);
});
check('Settings fields, settings interaction and UI event wiring remain distinct', () => {
  const controls=read('ui/15-panel-settings-controls.js');
  const events=read('ui/15-panel-settings-events.js');
  assert.match(controls,/const SETTING_GROUPS = Object\.freeze/);
  assert.match(controls,/function bindSettingsGroup\(/);
  assert.doesNotMatch(controls,/function fitPanelDialogToPanel\(/);
  assert.match(events,/function bindUiEvents\(/);
  assert.doesNotMatch(events,/function fitPanelDialogToPanel\(/);
});
check('Active ESM tests execute native source modules, never historical bundles', () => {
  const esm=['regression-esm.cjs','storage-esm-regression.cjs',
    'attachment-metadata-esm.cjs','image-identity-esm.cjs','ledger-audit-esm.cjs'];
  for(const name of esm) {
    const test=fs.readFileSync(path.join(root,'tests',name),'utf8');
    assert.match(test,/support\/isolated-esm\.cjs/,name);
    assert.doesNotMatch(test,/classicRelative|legacy-manifest|fixtures\/chatgpt-context-watchdog-/,name);
  }
  for(const name of ['observer-behavior.cjs','estimator-collector-contract.cjs',
    'calibration-profiling-contract.cjs']) {
    const test=fs.readFileSync(path.join(root,'tests',name),'utf8');
    assert.match(test,/support\/module-source\.cjs/,name);
  }
});
console.log(`${passed} panel module boundaries verified`);
