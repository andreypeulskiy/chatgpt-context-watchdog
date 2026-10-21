import { revisionTargets } from '../runtime/01-runtime-capture-state.js';
import { hydrationCandidates } from '../runtime/01-runtime-session-state.js';

  /** WATCHDOG_CONTRACT: the ONLY message-entry mutation in the capture path.
   * Called only after UUID, route, completion and hydration gates succeed.
   * No localStorage IO or render here; outer scan owns durability.
   */
  function commitCapturedMessage(state, id, role, measured, commit) {
    const prev = state.messages[id];
    if (prev && !revisionTargets.has(id)) {
      commit.unchanged++;
      return false;
    }
    if (prev && prev.fingerprint === measured.fingerprint &&
        prev.chars === measured.chars && prev.role === role) {
      commit.unchanged++;
      return false;
    }
    state.messages[id] = {
      role, tokens: measured.tokens, chars: measured.chars,
      fingerprint: measured.fingerprint
    };
    hydrationCandidates.delete(id);
    if (prev) commit.changed++;
    else commit.added++;
    if (role === 'user') commit.user++;
    else if (role === 'assistant') commit.assistant++;
    else commit.other++;
    return true;
  }

export { commitCapturedMessage };
