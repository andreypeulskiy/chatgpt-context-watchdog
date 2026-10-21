'use strict';
// RED regression for an existing chat opened while its response is generating.
// Run: node --experimental-vm-modules tests/thinking-route-regression.cjs
// Runs the real linked ESM coordinator, route gate, collector, renderer and ledger.
// Only browser primitives (DOM/controls/localStorage) are synthetic.
const assert = require('node:assert/strict');
const { isolatedModules } = require('./support/isolated-esm.cjs');

const uuid = digit => `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`;
const chatKey = digit => `chat:${uuid(digit)}`;
const messageId = digit => `msg:${uuid(digit)}`;
const documentPosition = { DOCUMENT_POSITION_FOLLOWING: 4, DOCUMENT_POSITION_PRECEDING: 2 };

function syntheticUnit(digit, role, order) {
  const attrs = {
    'data-chatgpt-search-unit-key': `fixture:${role}`,
    'data-chatgpt-search-message-ids': uuid(digit)
  };
  return {
    order, isConnected: true,
    getAttribute: name => attrs[name] ?? null,
    hasAttribute: name => Object.hasOwn(attrs, name),
    matches: selector => selector === '[data-chatgpt-search-unit-key]',
    closest(selector) {
      return selector === 'main' ? main :
        selector === '[data-chatgpt-search-unit-key]' ? this : null;
    },
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 300, height: 48 }),
    compareDocumentPosition(other) {
      return order < other.order ? documentPosition.DOCUMENT_POSITION_FOLLOWING :
        documentPosition.DOCUMENT_POSITION_PRECEDING;
    }
  };
}
const main = {};
function element() {
  const attributes = new Map();
  return {
    hidden: false, textContent: '', dataset: {}, style: {},
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: name => attributes.get(name) ?? null,
    removeAttribute: name => attributes.delete(name),
    querySelectorAll: () => []
  };
}
function panelFixture() {
  const names = ['chip','chipStatus','average','pausedLabel','pauseToggle','pauseControl',
    'rescan','endChat','repairShort','undoRepair','storageWarning','storageIndicator',
    'panel','budgetTabMark','budgetTab','contextRange','dataChars','dataTokens',
    'contextMessages','dataFiles','dataQuality','dataQualityExtra','dataImages'];
  const ui = Object.fromEntries(names.map(name => [name, element()]));
  ui.panel.hidden = false;
  return ui;
}
function units(digits) {
  return digits.map((digit, index) => syntheticUnit(digit, index % 2 ? 'assistant' : 'user', index));
}
function seedState(repository, saveState, key, digits) {
  const ledger = repository.loadState(key);
  digits.forEach((digit, index) => {
    ledger.messages[messageId(digit)] = {
      role: index % 2 ? 'assistant' : 'user', chars: 120 + index,
      tokens: 65 + index, fingerprint: `v3:synthetic-${digit}`
    };
  });
  assert.equal(saveState(ledger), true, 'fixture ledger seeding failed');
}

(async () => {
  const bytes = new Map();
  let writes = 0;
  const localStorage = {
    getItem: key => bytes.get(key) ?? null,
    setItem(key, value) { writes++; bytes.set(key, String(value)); },
    removeItem: key => bytes.delete(key)
  };
  let mounted = units(['1','2','3','4']);
  let generating = false;
  const stop = {
    hidden: false, getAttribute: () => null, getClientRects: () => [{}]
  };
  const send = {
    hidden: false, getAttribute: () => null, getClientRects: () => [{}]
  };
  const document = {
    hidden: false,
    querySelectorAll(selector) {
      if (selector === 'main [data-chatgpt-search-unit-key]') return mounted;
      if (selector.includes('stop-button')) return generating ? [stop] : [];
      if (selector.includes('send-button')) return generating ? [] : [send];
      return [];
    },
    querySelector: () => null
  };
  const location = { pathname: `/c/${uuid('a')}` };
  const ui = panelFixture();
  const realm = await isolatedModules({
    document, location, localStorage, Node: documentPosition,
    getComputedStyle: () => ({ visibility: 'visible' })
  });
  const capture = realm.module('runtime/01-runtime-capture-state.js');
  const defaults = realm.module('runtime/01-runtime-configuration.js').DEFAULTS;
  capture.initializeCaptureState({ ...defaults, watchdogPaused: false }, chatKey('a'));
  realm.module('runtime/01-runtime-pause-state.js').setChatAvailable(true);
  realm.module('runtime/01-runtime-ui-state.js').setUi(ui);
  realm.module('runtime/01-runtime-ui-state.js').setUiInitializer(() => ui);
  const repository = realm.module('storage/03-ledger-repository.js');
  const saveState = realm.module('storage/03-ledger-commit.js').saveState;
  const rendering = realm.module('ui/16-panel-rendering.js');
  const coordinator = realm.module('app/17-conversation-coordinator.js');
  const session = realm.module('runtime/01-runtime-session-state.js');
  const inspection = realm.module('app/11-route-inspection.js');
  const navigation = realm.module('app/11-route-navigation.js');

  seedState(repository, saveState, chatKey('a'), ['1','2','3','4']);
  seedState(repository, saveState, chatKey('b'), ['5','6','7','8','9','c','d','e']);
  const destinationMessageCount = 8;
  const seededWrites = writes;

  rendering.render(repository.loadState());
  assert.notEqual(ui.contextRange.textContent, 'None', 'ordinary source chat should show its estimate');
  console.log('PASS initial source chat displays a stored estimate');
  // The paused badge and hidden/inert panel must not request confirmed
  // context or budget status. Active badge rendering must still do so.
  const savedSettings = capture.settings;
  let confirmedReads = 0;
  const probeState = {chatKey: chatKey('a'), files:{},domImages:{},
    get messages() { confirmedReads++; return {[messageId('1')]: {}}; }};
  const probeMetrics = {optimistic:100,pessimistic:200};
  const probeBudgets = {normal:500};
  ui.panel.hidden = true;
  capture.setSettings({...savedSettings, watchdogPaused:true});
  rendering.render(probeState, probeMetrics, probeBudgets);
  assert.equal(confirmedReads,0,'paused, hidden render cannot read confirmed context');
  ui.panel.hidden = false;
  ui.settingsDialog = {open:true};
  rendering.render(probeState, probeMetrics, probeBudgets);
  assert.equal(confirmedReads,0,'paused, inert render cannot read confirmed context');
  ui.panel.hidden = true;
  ui.settingsDialog.open = false;
  capture.setSettings({...savedSettings, watchdogPaused:false});
  rendering.render(probeState, probeMetrics, probeBudgets);
  assert.equal(confirmedReads,1,'running badge still reads confirmed context when panel hidden');
  ui.panel.hidden = false;
  capture.setSettings(savedSettings);
  console.log('PASS lazy derived status for paused hidden/inert UI and live active badge');

  // SPA route starts while the old chat is still mounted; no cross-chat estimate.
  location.pathname = `/c/${uuid('b')}`;
  coordinator.onConversationEvent();
  assert.equal(capture.currentChatKey, chatKey('b'));
  assert.equal(inspection.sessionDiagnosticsSnapshot().routePending, true);
  assert.equal(ui.contextRange.textContent, 'None');
  console.log('PASS unconfirmed destination does not inherit the previous estimate');

  // Retained old nodes must still prevent route confirmation.
  coordinator.onConversationEvent();
  assert.equal(session.runtime.route.gate.reason, 'outgoing-only IDs still visible');
  assert.equal(ui.contextRange.textContent, 'None');
  console.log('PASS outgoing-only DOM does not unlock the destination');

  // Exact diagnostic pattern: 9 visible, 8 destination-known, Stop visible,
  // confirmed route with no outgoing-only IDs or retained outgoing DOM nodes.
  mounted = units(['5','6','7','8','9','c','d','e','f']);
  generating = true;
  // Ground positive destination proof independently of later route cleanup.
  const collector = realm.module('chatgpt/09-dom-collection.js');
  assert.equal(navigation.routeDomHasChanged(collector.collectMessageNodes()), true);
  const confirmedProof = { ...session.runtime.route.gate };
  assert.equal(confirmedProof.reason, 'confirmed');
  assert.equal(confirmedProof.visible, 9);
  assert.equal(confirmedProof.destinationKnown, destinationMessageCount);
  assert.equal(confirmedProof.outgoingOnly, 0);
  assert.equal(confirmedProof.outgoingMounted, 0);
  coordinator.onConversationEvent();
  for (let i = 0; i < 5; i++) coordinator.onConversationEvent();
  const report = inspection.sessionDiagnosticsSnapshot();
  assert.equal(report.phase, 'generating');
  assert.equal(report.completion, true);
  assert.equal(report.initial, true);
  assert.equal(Object.keys(repository.loadState().messages).length, destinationMessageCount);
  assert.equal(writes, seededWrites, 'generating must never commit unfinished message text');
  console.log('OBSERVED after 6 generating events:',
    `routePending=${report.routePending}, estimate=${ui.contextRange.textContent}`);
  console.log('PASS matched live diagnostics (confirmed, 9 UUIDs, 8 known, generating)');
  console.log('PASS generating has not modified the write-once ledger');

  // Demonstrate that a genuinely empty ledger should still show None without
  // default hidden-context allowance appearing as a measured conversation.
  assert.equal(rendering.hasConfirmedContext({
    chatKey: chatKey('b'), messages: {}, files: {}, domImages: {}
  }), false);
  console.log('PASS empty destination ledger does not unlock the forecast');

  // Desired regression invariant: after positive destination UUID verification,
  // show the known history, WITHOUT capturing an in-progress reply.
  // Guard against restoring the stale-route behavior.
  assert.equal(report.routePending, false,
    'BUG: confirmed destination stays route-pending throughout generating');
  assert.notEqual(ui.contextRange.textContent, 'None',
    'BUG: confirmed destination with eight stored messages must show its history');
  console.log('PASS confirmed generating destination displays stored estimate');
})().catch(error => {
  console.error('FAIL THINKING-ROUTE-001:', error.stack || error);
  process.exitCode = 1;
});
