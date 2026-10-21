import { currentChatKey, setTransientState, transientState } from '../runtime/01-runtime-capture-state.js';
import { corruptLedgerKeys, ledgerReadSnapshots, resetEpoch } from '../runtime/01-runtime-ledger-state.js';
import { measuredStorageRead, perfEnd, perfStart } from '../runtime/02-profiling.js';
import { emptyState } from '../core/03-ledger-schema.js';
import { reportStorageFailure, stateKey } from './03-ledger-foundation.js';
import { decodeLedger } from '../core/03-ledger-validation.js';

  /** WATCHDOG_CONTRACT: always read live storage for cross-tab conflict detection.
   * @param {string|null} [chatKey]
   * @returns {WatchdogLedgerV2}
   */
  function loadState(chatKey = currentChatKey) {
    const perfStartedAt = perfStart();
    try {
      if (!chatKey) {
        if (!transientState) setTransientState(emptyState(null));
        return transientState;
      }
      if (corruptLedgerKeys.has(chatKey)) return emptyState(chatKey);
      try {
        const raw = measuredStorageRead(stateKey(chatKey));
        const state = decodeLedger(chatKey, raw, text => {
          const parsingStarted = perfStart();
          try { return JSON.parse(text); }
          finally { perfEnd('ledgerParse', parsingStarted); }
        });
        ledgerReadSnapshots.set(state, { raw, epoch: resetEpoch(chatKey) });
        return state;
      } catch (err) {
        // Never overwrite malformed bytes with an automatically created empty ledger.
        corruptLedgerKeys.add(chatKey);
        reportStorageFailure(chatKey, 'CORRUPT LEDGER: writes blocked. Back up the original storage entry.', err);
        return emptyState(chatKey);
      }
    } finally {
      perfEnd('ledgerLoad', perfStartedAt);
    }
  }

export { loadState };
