import { settings } from '../runtime/01-runtime-capture-state.js';
import { SETTINGS_KEY } from '../runtime/01-runtime-configuration.js';
import { perfEnd, perfStart } from '../runtime/02-profiling.js';
import { reportStorageFailure } from './03-ledger-foundation.js';
import { storageFailures } from '../runtime/01-runtime-ledger-state.js';

  function writeJson(key, value, chatKey, failure, onFailure = null, onSuccess = null) {
    const perfStartedAt = perfStart();
    try {
      try {
        let raw;
        const encodingStarted = perfStart();
        try { raw = JSON.stringify(value); }
        finally { perfEnd('storageEncode', encodingStarted); }
        const commitStarted = perfStart();
        try { localStorage.setItem(key, raw); }
        finally { perfEnd('storageCommit', commitStarted); }
        onSuccess?.(raw);
        return true;
      } catch (err) {
        onFailure?.();
        reportStorageFailure(chatKey, failure, err);
        return false;
      }
    } finally {
      perfEnd('storageWrite', perfStartedAt);
    }
  }

  function saveSettings() {
    // The settings key is global; keep its failure visible without a chat UUID.
    // A confirmed successful retry clears only this failure, not ledger errors.
    return writeJson(SETTINGS_KEY, settings, SETTINGS_KEY,
      'STORAGE WRITE FAILED: settings were not saved.', null,
      () => storageFailures.delete(SETTINGS_KEY));
  }

export { writeJson, saveSettings };
