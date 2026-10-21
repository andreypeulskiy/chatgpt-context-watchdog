import { isWatchdogPaused } from '../runtime/01-runtime-pause-state.js';
// Application command: persist a finished-chat sample and refresh the UI.
// Storage/calibration primitives remain independent of the interface.
import { currentChatKey, setSettings, settings } from '../runtime/01-runtime-capture-state.js';
import { calibrationHistoryCorrupt } from '../runtime/01-runtime-dom-state.js';
import { corruptLedgerKeys } from '../runtime/01-runtime-ledger-state.js';
import { stats } from './11-ledger-statistics.js';
import { currentBudgetValues, loadHistory, historyStatsFor, calibratedBudgets, saveHistory } from '../storage/03-calibration-store.js';
import { loadState } from '../storage/03-ledger-repository.js';
import { saveSettings } from '../storage/03-storage-io.js';

  function saveEndedChatSample() {
    if (isWatchdogPaused()) return { status: 'paused' };
    if (!currentChatKey) {
      return { status: 'missing-chat' };
    }
    const state = loadState();
    // loadState deliberately returns an empty in-memory placeholder when the
    // persisted ledger is corrupt. That placeholder is NOT a valid calibration
    // sample: recording it would skew budgets while preserving broken bytes.
    if (corruptLedgerKeys.has(currentChatKey)) return { status: 'corrupt-ledger' };
    const s = stats(state);
    const history = [...loadHistory()];
    if (calibrationHistoryCorrupt) {
      return { status: 'corrupt-history' };
    }
    const key = currentChatKey;

    const sample = {
      chatKey: key,
      savedAt: Date.now(),
      seen: Math.round(s.tokens),
      optimistic: Math.round(s.optimistic),
      pessimistic: Math.round(s.pessimistic),
      knownAttachmentTokens: Math.round(s.knownTokens || 0),
      knownImages: Math.round(s.knownImages || 0),
      turns: Math.round(s.turns || 0)
    };

    const existingIndex = history.findIndex((x) => x.chatKey === key);
    if (existingIndex >= 0) {
      history[existingIndex] = sample;
    } else {
      history.push(sample);
    }

    // Calculate from the stable anchor and the NEW sample set; do not use
    // currently calibrated values as the next baseline.
    const base = settings.budgetCalibrationBase || currentBudgetValues();
    const valid = history.filter(x => Number.isFinite(Number(x.seen)) &&
      Number.isFinite(Number(x.pessimistic)));
    const hs = historyStatsFor(valid);
    const budgets = calibratedBudgets(base, hs);
    // History and settings use separate storage keys. On a settings write
    // failure, restore the previous history; never report partial success.
    const previousHistory = [...loadHistory()];
    const previousSettings = { ...settings };
    if (!saveHistory(history)) return { status: 'storage-failed' };
    Object.assign(settings, {
      budgetCalibrationBase: base,
      conservativeBudget: budgets.conservativeBudget,
      normalBudget: budgets.normalBudget,
      optimisticBudget: budgets.optimisticBudget,
      budgetCalibrationWeight: budgets.weight
    });
    if (!saveSettings()) {
      setSettings(previousSettings);
      // Roll back the sample so a failed calibration cannot silently affect
      // subsequent calculations. Storage failure is already signaled.
      saveHistory(previousHistory);
      return { status: 'storage-failed' };
    }
    return { status: 'saved', state, count: hs.n };
  }

export { saveEndedChatSample };
