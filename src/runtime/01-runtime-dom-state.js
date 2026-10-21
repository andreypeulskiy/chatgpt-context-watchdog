  // A mounted user card is rescanned only after its DOM changes. Weak keys let
  // React-unmounted cards disappear without keeping DOM nodes alive.
  let inspectedFileTurns = new WeakMap();
  let dirtyFileTurns = new WeakSet();
  // Image inspection is committed only after the ledger save succeeds.
  // Weak keys avoid retaining virtualized/removed conversation turns or images.
  let inspectedImageTurns = new WeakMap();
  let dirtyImageTurns = new WeakSet();
  const watchedImageNodes = new WeakSet();
  let requestImageRescan = null;
  let mutationCheckQueued = false;
  let booted = false;
  let historyCache = null;
  let calibrationHistoryCorrupt = false;
  // Only derived, read-only history statistics are memoized; state:v2 is never cached.
  let historySummaryCache = null;
  let deferredConversationFrame = 0;


  // Live mutable binding: write access from a different ES module.
  function setHistorySummaryCache(value) { return (historySummaryCache = value); }

  // Live mutable binding: write access from a different ES module.
  function setHistoryCache(value) { return (historyCache = value); }

  // Live mutable binding: write access from a different ES module.
  function setCalibrationHistoryCorrupt(value) { return (calibrationHistoryCorrupt = value); }

  // Live mutable binding: write access from a different ES module.
  function setDeferredConversationFrame(value) { return (deferredConversationFrame = value); }

  // Live mutable binding: write access from a different ES module.
  function setInspectedFileTurns(value) { return (inspectedFileTurns = value); }
  // Wipe discards all prior user-turn invalidation hints without retaining DOM.
  function setDirtyFileTurns(value) { return (dirtyFileTurns = value); }
  function setInspectedImageTurns(value) { return (inspectedImageTurns = value); }
  function setDirtyImageTurns(value) { return (dirtyImageTurns = value); }
  function setImageRescanRequester(value) { requestImageRescan = value; }
  function notifyImageRescan() { requestImageRescan?.(); }

  // Live mutable binding: write access from a different ES module.
  function setMutationCheckQueued(value) { return (mutationCheckQueued = value); }

  // Live mutable binding: write access from a different ES module.
  function setBooted(value) { return (booted = value); }

export { inspectedFileTurns, dirtyFileTurns, inspectedImageTurns, dirtyImageTurns, watchedImageNodes, notifyImageRescan, setImageRescanRequester, setInspectedImageTurns, setDirtyImageTurns, mutationCheckQueued, booted, historyCache, calibrationHistoryCorrupt, historySummaryCache, deferredConversationFrame, setHistorySummaryCache, setHistoryCache, setCalibrationHistoryCorrupt, setDeferredConversationFrame, setInspectedFileTurns, setDirtyFileTurns, setMutationCheckQueued, setBooted };
