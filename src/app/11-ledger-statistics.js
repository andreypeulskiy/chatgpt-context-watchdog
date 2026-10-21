import { perfEnd, perfStart } from '../runtime/02-profiling.js';
import { loadState } from '../storage/03-ledger-repository.js';
import { estimateCurrentContext } from './07-forecast.js';

  /** WATCHDOG_CONTRACT: read-only totals and context forecast for a ledger.
   * @param {WatchdogLedgerV2} [state]
   * @returns {Object<string, *>}
   */
  function stats(state = loadState()) {
    const perfStartedAt = perfStart();
    try {
      let tokens = 0;
      let chars = 0;
      let turns = 0;
      let userTurns = 0;
      let assistantTurns = 0;
      let otherTurns = 0;
      let uuidMessages = 0;

      for (const id in (state.messages || {})) {
        const item = state.messages[id];
        tokens += Number(item?.tokens) || 0;
        chars += Number(item?.chars) || 0;
        turns++;
        if (item?.role === 'user') userTurns++;
        else if (item?.role === 'assistant') assistantTurns++;
        else otherTurns++;
        if (id.startsWith('msg:')) uuidMessages++;
      }

      const estimate = estimateCurrentContext(state, tokens);

      return {
        tokens,
        chars,
        turns,
        userTurns,
        assistantTurns,
        otherTurns,
        uuidMessages,
        ...estimate
      };
    } finally {
      perfEnd('stats', perfStartedAt);
    }
  }

  function formatScaledTokens(n, precision) {
    if (n < 1000) return String(Math.round(n));
    if (n < 1_000_000) return `${(n / 1000).toFixed(precision)}k`;
    return `${(n / 1_000_000).toFixed(2)}M`;
  }

export { stats, formatScaledTokens };
