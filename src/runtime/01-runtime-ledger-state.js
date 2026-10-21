  // Failed writes and malformed ledgers are shown persistently, never silently
  // mistaken for a saved history. A corrupt ledger is read-only until reset.
  const corruptLedgerKeys = new Set();
  const storageFailures = new Map();
  // Per-load {raw, epoch} snapshots enable optimistic reconciliation and
  // reject pre-reset drafts for just their chat, without touching other chats.
  // No extra fields are added to the persisted state:v2 schema.
  let ledgerReadSnapshots = new WeakMap();
  // Wiping all Watchdog storage invalidates every read snapshot globally.
  // A single-chat Reset instead bumps that chat's resetEpoch (see below).
  function invalidateLedgerReadSnapshots() { ledgerReadSnapshots = new WeakMap(); }
  // Invalidates in-flight local-file estimates when a chat ledger is reset.
  const ledgerResetEpochs = new Map();
  const pendingTransientPromotions = new Map(); // destination UUID -> {draft, epoch}; RAM only
  // RC-3: completed local estimates awaiting durable storage commit (RAM only).
  const pendingFileResults = new Map();
  function resetEpoch(chatKey) { return ledgerResetEpochs.get(chatKey) || 0; }
  function invalidateLedgerJobs(chatKey) {
    if (chatKey) {
      ledgerResetEpochs.set(chatKey, resetEpoch(chatKey) + 1);
      for (const [key, job] of pendingFileResults)
        if (job.chatKey === chatKey) pendingFileResults.delete(key);
    }
  }
  let storageWarningShown = false;
  let storageFailureNotifier = null;
  function setStorageFailureNotifier(notifier) {
    storageFailureNotifier = notifier;
  }
  function notifyStorageFailure(message) {
    storageFailureNotifier?.(message, 12000);
  }

  // Live mutable binding: write access from a different ES module.
  function setStorageWarningShown(value) { return (storageWarningShown = value); }

export { pendingTransientPromotions, setStorageFailureNotifier, notifyStorageFailure, corruptLedgerKeys, storageFailures, ledgerReadSnapshots, pendingFileResults, invalidateLedgerReadSnapshots, ledgerResetEpochs, resetEpoch, invalidateLedgerJobs, storageWarningShown, setStorageWarningShown };
