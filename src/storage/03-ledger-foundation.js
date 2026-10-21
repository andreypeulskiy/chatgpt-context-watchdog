import { currentChatKey } from '../runtime/01-runtime-capture-state.js';
import { CHAT_PATH_RE, SETTINGS_KEY, STATE_PREFIX } from '../runtime/01-runtime-configuration.js';
import { calibrationHistoryCorrupt } from '../runtime/01-runtime-dom-state.js';
import { corruptLedgerKeys, notifyStorageFailure, setStorageWarningShown, storageFailures, storageWarningShown } from '../runtime/01-runtime-ledger-state.js';

  function getChatKey() {
    // Also works for project chats: /g/.../c/<uuid>.
    const match = location.pathname.match(CHAT_PATH_RE);
    return match ? `chat:${match[1].toLowerCase()}` : null;
  }

  function stateKey(chatKey = currentChatKey) {
    return STATE_PREFIX + encodeURIComponent(chatKey);
  }

  function storageProblem(chatKey = currentChatKey) {
    if (chatKey && corruptLedgerKeys.has(chatKey)) return 'CORRUPT LEDGER — read-only. Export/backup the raw localStorage entry before resetting.';
    if (calibrationHistoryCorrupt) return 'CORRUPT CALIBRATION HISTORY — raw bytes preserved; recording blocked.';
    // Settings are global. A failed preferences write cannot depend on a chat UUID.
    if (storageFailures.has(SETTINGS_KEY)) return storageFailures.get(SETTINGS_KEY);
    return chatKey ? (storageFailures.get(chatKey) || '') : '';
  }

  function reportStorageFailure(chatKey, reason, err = null) {
    if (chatKey) storageFailures.set(chatKey, reason);
    if (err) console.warn('[Context Watchdog] storage problem:', err);
    if (!storageWarningShown) {
      setStorageWarningShown(true);
      // Inline panel warning persists even after the toast disappears.
      notifyStorageFailure(reason);
    }
  }

export { getChatKey, stateKey, storageProblem, reportStorageFailure };
