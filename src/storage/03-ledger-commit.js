import { setTransientState } from '../runtime/01-runtime-capture-state.js';
import { corruptLedgerKeys, ledgerReadSnapshots, pendingFileResults, resetEpoch, setStorageWarningShown, storageFailures } from '../runtime/01-runtime-ledger-state.js';
import { measuredStorageRead, perfEnd, perfStart } from '../runtime/02-profiling.js';
import { reportStorageFailure, stateKey } from './03-ledger-foundation.js';
import { reconcileLedger } from '../core/03-ledger-merge.js';
import { writeJson } from './03-storage-io.js';

  /** WATCHDOG_CONTRACT: commit a draft only when its load snapshot is available.
   * @param {WatchdogLedgerV2} state
   * @returns {boolean} False on conflict or storage failure
   */
  function saveState(state) {
    if (!state.chatKey) {
      state.attachmentLedgerVersion = 2;
      state.updatedAt = Date.now();
      setTransientState(state);
      return true;
    }
    if (corruptLedgerKeys.has(state.chatKey)) {
      reportStorageFailure(state.chatKey, 'CORRUPT LEDGER: writes blocked. Back up the original storage entry.');
      return false;
    }
    // Reject untracked drafts. Each persisted edit must start at loadState(),
    // otherwise there is no safe baseline for an intervening cross-tab edit.
    if (!ledgerReadSnapshots.has(state)) {
      reportStorageFailure(state.chatKey, 'STORAGE CONFLICT: missing ledger baseline; reload before retrying.');
      return false;
    }
    const baseline = ledgerReadSnapshots.get(state);
    // A per-chat Reset (local or remote) fences off pre-reset drafts, even
    // when their original load saw an absent/null ledger. Unrelated chats keep
    // their original snapshots and can retry failed writes normally.
    if (baseline.epoch !== resetEpoch(state.chatKey)) {
      reportStorageFailure(state.chatKey, 'STORAGE CONFLICT: missing ledger baseline after chat reset; rescan before retrying.');
      return false;
    }
    const baseRaw = baseline.raw;
    let candidate = state;
    try {
      const liveRaw = measuredStorageRead(stateKey(state.chatKey));
      if (liveRaw !== baseRaw) candidate = reconcileLedger(baseRaw, liveRaw, state, text => {
        const parsingStarted = perfStart();
        try { return JSON.parse(text); }
        finally { perfEnd('ledgerParse', parsingStarted); }
      });
    } catch (err) {
      // Malformed remote bytes are never overwritten by a stale draft.
      reportStorageFailure(state.chatKey,
        `STORAGE CONFLICT: ${String(err?.message || err)}. Reload or rescan before retrying.`, err);
      return false;
    }
    candidate.attachmentLedgerVersion = 2;
    candidate.updatedAt = Date.now();
    if (!writeJson(stateKey(state.chatKey), candidate, state.chatKey,
      'STORAGE WRITE FAILED: new counts were not saved.', null, raw => {
        ledgerReadSnapshots.set(state, { raw, epoch: resetEpoch(state.chatKey) });
      })) return false;
    if (candidate !== state) Object.assign(state, candidate);
    else state.updatedAt = candidate.updatedAt;
    // RC-3: another successful ledger write is not proof that a failed
    // completed-file result has been durably stored.
    if (![...pendingFileResults.values()].some(job => job.chatKey === state.chatKey)) {
      storageFailures.delete(state.chatKey);
      setStorageWarningShown(false);
    }
    return true;
  }

export { saveState };
