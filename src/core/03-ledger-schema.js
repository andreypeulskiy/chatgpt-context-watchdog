  /** WATCHDOG_CONTRACT: create a new in-memory ledger without changing persistent schema.
   * @param {string|null} chatKey
   * @returns {WatchdogLedgerV2}
   */
  function emptyState(chatKey) {
    return {
      chatKey,
      messages: {},
      repairHistory: [], // compact reversible snapshots for explicit Audit repairs
      attachmentLedgerVersion: 2,
      files: {},
      domImages: {},
      updatedAt: 0
    };
  }

export { emptyState };
