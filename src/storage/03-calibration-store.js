import { currentChatKey, settings } from '../runtime/01-runtime-capture-state.js';
import { HISTORY_KEY } from '../runtime/01-runtime-configuration.js';
import { calibrationHistoryCorrupt, historyCache, historySummaryCache, setCalibrationHistoryCorrupt, setHistoryCache, setHistorySummaryCache } from '../runtime/01-runtime-dom-state.js';
import { measuredStorageRead } from '../runtime/02-profiling.js';
import { reportStorageFailure } from './03-ledger-foundation.js';
import { writeJson } from './03-storage-io.js';

  function loadHistory() {
    if (historyCache) return historyCache;
    setHistorySummaryCache(null);

    try {
      const parsed = JSON.parse(measuredStorageRead(HISTORY_KEY) || '[]');
      if (!Array.isArray(parsed) || !parsed.every(validCalibrationSample)) {
        throw new Error('Invalid calibration history samples');
      }
      setHistoryCache(parsed);
      setCalibrationHistoryCorrupt(false);
    } catch (err) {
      setHistoryCache([]);
      setCalibrationHistoryCorrupt(true);
      reportStorageFailure(null,
        'CORRUPT CALIBRATION HISTORY: raw bytes preserved; recording blocked.', err);
    }

    return historyCache;
  }

  // Nullable or malformed samples must not crash the forecast even when a
  // caller constructs a temporary array independently of loadHistory().
  function validCalibrationSample(sample) {
    if (!sample || typeof sample !== 'object' || Array.isArray(sample) ||
        typeof sample.chatKey !== 'string' || !sample.chatKey) return false;
    for (const key of ['seen', 'optimistic', 'pessimistic',
      'knownAttachmentTokens', 'knownImages', 'turns', 'savedAt']) {
      if (sample[key] !== undefined &&
          (typeof sample[key] !== 'number' || !Number.isFinite(sample[key]) || sample[key] < 0)) return false;
    }
    return typeof sample.seen === 'number' && typeof sample.pessimistic === 'number';
  }

  function saveHistory(history) {
    if (historyCache === null) loadHistory(); // validate existing raw bytes before overwriting
    if (calibrationHistoryCorrupt || !Array.isArray(history) ||
        !history.every(validCalibrationSample)) {
      reportStorageFailure(null,
        'CALIBRATION HISTORY NOT SAVED: invalid stored or pending samples.');
      return false;
    }
    if (!writeJson(HISTORY_KEY, history, currentChatKey,
      'STORAGE WRITE FAILED: limit calibration was not saved.',
      () => { setHistoryCache(null); setHistorySummaryCache(null); })) return false;
    setHistoryCache(history);
    setHistorySummaryCache(null);
    return true;
  }

  function historyStatsFor(history, requireValid = false) {
    let n = 0;
    let seen = 0, optimistic = 0, pessimistic = 0;
    for (const sample of history) {
      // Ordinary callers keep the original Number(x) || 0 fallback.
      // Forecast rendering accepts only samples with finite seen/pessimistic,
      // exactly as the previous filter() + three reduce() passes did.
      if (!validCalibrationSample(sample)) continue;
      if (requireValid && (!Number.isFinite(Number(sample.seen)) ||
          !Number.isFinite(Number(sample.pessimistic)))) continue;
      n++;
      seen += Number(sample.seen) || 0;
      optimistic += Number(sample.optimistic) || 0;
      pessimistic += Number(sample.pessimistic) || 0;
    }
    if (!n) return { n: 0, avgSeen: 0, avgOptimistic: 0, avgPessimistic: 0 };
    return {
      n,
      avgSeen: Math.round(seen / n),
      avgOptimistic: Math.round(optimistic / n),
      avgPessimistic: Math.round(pessimistic / n)
    };
  }

  function historyStats() {
    if (historySummaryCache) return historySummaryCache;
    setHistorySummaryCache(historyStatsFor(loadHistory(), true));
    return historySummaryCache;
  }

  function currentBudgetValues() {
    return {
      conservativeBudget: settings.conservativeBudget,
      normalBudget: settings.normalBudget,
      optimisticBudget: settings.optimisticBudget
    };
  }

  // Budgets are materialized into the SAME editable settings fields when a
  // sample is recorded. Re-rendering/reloading must never apply history again.
  function effectiveBudgets() {
    return {
      conservative: settings.conservativeBudget,
      normal: settings.normalBudget,
      optimistic: settings.optimisticBudget,
      // Samples are only needed by History and by explicit calibration.
      // Ordinary forecast/badge renders must not read calibration history.
      historyWeight: settings.budgetCalibrationWeight || 0
    };
  }

  function calibratedBudgets(base, hs) {
    if (!hs.n || hs.avgPessimistic <= 0) {
      return { ...base, weight: 0 };
    }
    const prior = Math.max(1, Number(settings.historyPriorStrength) || 4);
    const w = hs.n / (hs.n + prior);
    const normalBase = Math.max(10000, base.normalBudget);
    const targetNormal = hs.avgPessimistic;
    const blend = (manual, target) => Math.round(manual * (1 - w) + target * w);
    // The pre-calibration C:N:G proportions are stable across repeated saves
    // of the same chat sample; no feedback/double-calibration occurs.
    const conservative = Math.max(10000, Math.min(1e9,
      blend(base.conservativeBudget, targetNormal * base.conservativeBudget / normalBase)));
    const normal = Math.max(conservative, Math.min(1e9,
      blend(base.normalBudget, targetNormal)));
    const optimistic = Math.max(normal, Math.min(1e9,
      blend(base.optimisticBudget, targetNormal * base.optimisticBudget / normalBase)));
    return {
      conservativeBudget: conservative,
      normalBudget: normal,
      optimisticBudget: optimistic,
      weight: w
    };
  }


export { loadHistory, validCalibrationSample, saveHistory, historyStatsFor, historyStats, currentBudgetValues, effectiveBudgets, calibratedBudgets };
