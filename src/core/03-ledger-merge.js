import { decodeLedger } from './03-ledger-validation.js';

  // Merge only independent changes. When two tabs edit the same existing key,
  // fail closed rather than silently losing an edit or breaking write-once.
  // This is optimistic conflict detection, NOT an atomic cross-tab transaction.
  /** WATCHDOG_CONTRACT: optimistic merge; not an atomic cross-tab transaction.
   * @param {string|null} baseRaw
   * @param {string|null} liveRaw
   * @param {WatchdogLedgerV2} draft
   * @param {(raw: string) => unknown} [parse] Optional JSON parser for storage-side profiling.
   * @returns {WatchdogLedgerV2}
   * @throws {Error} Concurrent edits or reset conflict
   */
  function reconcileLedger(baseRaw, liveRaw, draft, parse = JSON.parse) {
    if (baseRaw && !liveRaw) throw new Error('Ledger was reset in another tab');
    const base = decodeLedger(draft.chatKey, baseRaw, parse);
    const live = decodeLedger(draft.chatKey, liveRaw, parse);
    // A reset may already have been followed by fresh captures in the other
    // tab. Never import pre-reset work into a ledger missing old message IDs.
    if (Object.keys(base.messages).some(id => !Object.hasOwn(live.messages, id))) {
      throw new Error('Previously saved message IDs disappeared (possible chat reset)');
    }
    const merged = { ...live };
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    for (const field of ['messages', 'files', 'domImages']) {
      const before = base[field] || {};
      const after = draft[field] || {};
      const latest = live[field] || {};
      const result = { ...latest };
      for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (equal(after[id], before[id])) continue;
        if (!equal(latest[id], before[id]) && !equal(latest[id], after[id])) {
          throw new Error(`Concurrent ${field} change: ${id}`);
        }
        if (Object.hasOwn(after, id)) result[id] = after[id];
        else delete result[id];
      }
      merged[field] = result;
    }
    if (!equal(draft.repairHistory, base.repairHistory)) {
      if (!equal(live.repairHistory, base.repairHistory) &&
          !equal(live.repairHistory, draft.repairHistory)) {
        throw new Error('Concurrent Audit repair history change');
      }
      merged.repairHistory = draft.repairHistory;
    }
    return merged;
  }

export { reconcileLedger };
