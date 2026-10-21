'use strict';
const assert = require('node:assert/strict');
const {source, rawSource} = require('./support/module-source.cjs');
const markup = source('13-panel-markup.js');
const interactions = rawSource('15-panel-settings-events.js');
const uiState = source('01-runtime-ui-state.js');
const shell = source('12-panel-shell.js');
const config = rawSource('01-runtime-configuration.js');
let passed = 0;
function check(label, fn) { fn(); passed++; console.log('PASS', label); }
check('Pin button has an accessible toggle contract', () => {
  assert.match(markup, /class="cw-tool-button cw-pin-panel" aria-label="Pin panel" aria-pressed="false"/);
  assert.match(interactions, /setPanelPinned\(!panelPinned\)/);
  assert.match(interactions, /ui\.pinBtn\.setAttribute\('aria-pressed', String\(panelPinned\)\)/);
  assert.match(interactions, /ui\.pinBtn\.setAttribute\('aria-label', panelPinned \? 'Unpin panel' : 'Pin panel'\)/);
  assert.match(interactions, /if \(!ui\.panel\.hidden\) \{[\s\S]*?dismissWatchdogPanel\(\);\s*return;/);
  assert.match(interactions, /if \(!panelPinned\) dismissWatchdogPanel\(\)/);
});
check('Pin state is session-local and outside click is non-invasive', () => {
  assert.match(uiState, /let panelPinned = false;/);
  assert.match(uiState, /function setPanelPinned\(value\) \{ return \(panelPinned = value\); \}/);
  assert.match(interactions, /document\.addEventListener\('pointerdown',[\s\S]*?if \(!panelPinned\) dismissWatchdogPanel\(\);[\s\S]*?\}, true\)/);
  assert.doesNotMatch(uiState, /\b(?:localStorage|sessionStorage|writeJson|saveSettings)\b/);
});
check('Dialogs dismiss in controlled order and tab caption remains intact', () => {
  assert.match(interactions, /function dismissOpenPanelDialog\(\)/);
  assert.match(interactions, /if \(ui\.confirmDialog\?\.open\) settlePanelConfirmation\(false\)/);
  assert.match(interactions, /if \(ui\.settingsDialog\?\.open\) closeSettingsDialog\(\)/);
  assert.match(markup, /Heuristic midpoint of optimistic<\/span> <span>and pessimistic estimates<\/span>/);
  // Pin-context browser checks the actual displayed caption, not a specific span layout declaration.
});
check('Badge icon uses cache-only favicon and shared Watchdog header fallback', () => {
  const finder = rawSource('12-panel-site-icon.js');
  assert.doesNotMatch(config, /EMBEDDED_SITE_ICON_DATA/);
  assert.doesNotMatch(shell, /resolveLocallyCachedSiteIcon/);
  assert.match(markup, /<span class="cw-site-icon cw-brand-mark" aria-hidden="true"><\/span>/);
  assert.match(interactions, /installBadgeSiteIcon\(root, ui\.siteIcon\)/);
  assert.doesNotMatch(finder, /data-app-shell-sidebar-trigger|findSiteLogoPath|rememberedSitePath|new MutationObserver/);
  assert.match(finder, /switchToWatchdogAfterCacheFailure/);
  assert.match(finder, /saveSettings\(\)/);
  // Tooltip logo appearance is covered by the favicon/tooltip browser tests.
  assert.doesNotMatch(finder, /XMLHttpRequest|localStorage/);
  const {inspectCacheOnlyCalls} = require('../tools/cache-only-policy.cjs');
  const review = inspectCacheOnlyCalls(finder, 'src/ui/12-panel-site-icon.js');
  assert.equal(review.count, 1);
  assert.deepEqual(review.problems, []);
});
console.log(`${passed} current interface contracts passed`);
