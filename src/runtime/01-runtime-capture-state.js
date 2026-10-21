import { DEFAULTS } from './01-runtime-configuration.js';

  const perf = {
    enabled: false, mutationBatches: 0, mutations: 0,
    queuedEvents: 0, processedEvents: 0, noChangeScans: 0,
    duplicateTextMutations: 0,
    timings: Object.create(null)
  };
  // Imports must not read localStorage or inspect ChatGPT's route.
  // Startup initializes both before the UI, observer and first scan.
  let settings = { ...DEFAULTS };
  let currentChatKey = null;
  function initializeCaptureState(initialSettings, initialChatKey) {
    settings = initialSettings;
    currentChatKey = initialChatKey;
  }
  let transientState = null; // The initial / page has no chat UUID yet.
  // Debug values cached on UI events: rendering diagnostics must not rescan DOM.
  let lastUiSignals = { stop: false, send: false, actions: null };
  let lastCommit = null; // { added, changed, unchanged, user, assistant, other, at }
  // Only an explicit Edit/Regenerate UI action can unlock a stored record.
  // Normal reloads, scrolls, Audit and navigation may never rewrite it.
  // An explicit edit unlocks its UUID only for that operation. A failed
  // earlier capture must never consume permission for a later edit.
  const revisionTargets = new Map(); // UUID -> RAM-only revision generation
  // A completion signal may precede DOM hydration. Keep its exact generation
  // eligible until that revision's new metrics have been durably committed.
  const completedRevisions = new Map(); // UUID -> completed revision generation
  let revisionGeneration = 0;
  // RAM-only failed transaction. Replaying already measured data never grants
  // permission to tokenize a known UUID again; discarded on chat/reset changes.
  let failedScanDraft = null;
  let lastScanReason = 'startup';
  // Manual Audit is read-only and never writes message history.
  let lastAudit = null;
  // Manual Audits confirm repair candidates across two separate inspections.
  // Only metadata is cached, never the message text.
  let priorRepairCandidates = new Map();
  let lastBackfillDeferred = 0;

  // Live mutable binding: write access from a different ES module.
  function setSettings(value) { return (settings = value); }

  // Live mutable binding: write access from a different ES module.
  function setTransientState(value) { return (transientState = value); }

  // Live mutable binding: write access from a different ES module.
  function setCurrentChatKey(value) { return (currentChatKey = value); }

  // Live mutable binding: write access from a different ES module.
  function setLastUiSignals(value) { return (lastUiSignals = value); }

  // Live mutable binding: write access from a different ES module.
  function setLastCommit(value) { return (lastCommit = value); }

  // Live mutable binding: write access from a different ES module.
  function setFailedScanDraft(value) { return (failedScanDraft = value); }

  // Live mutable binding: write access from a different ES module.
  function setLastBackfillDeferred(value) { return (lastBackfillDeferred = value); }

  // Live mutable binding: write access from a different ES module.
  function setLastScanReason(value) { return (lastScanReason = value); }

  // Live mutable binding: write access from a different ES module.
  function setRevisionGeneration(value) { return (revisionGeneration = value); }

  // Live mutable binding: write access from a different ES module.
  function setLastAudit(value) { return (lastAudit = value); }

  // Live mutable binding: write access from a different ES module.
  function setPriorRepairCandidates(value) { return (priorRepairCandidates = value); }

export { initializeCaptureState, perf, settings, currentChatKey, transientState, lastUiSignals, lastCommit, revisionTargets, completedRevisions, revisionGeneration, failedScanDraft, lastScanReason, lastAudit, priorRepairCandidates, lastBackfillDeferred, setSettings, setTransientState, setCurrentChatKey, setLastUiSignals, setLastCommit, setFailedScanDraft, setLastBackfillDeferred, setLastScanReason, setRevisionGeneration, setLastAudit, setPriorRepairCandidates };
