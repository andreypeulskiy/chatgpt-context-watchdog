import { completedRevisions, lastBackfillDeferred, revisionTargets, setLastBackfillDeferred } from '../runtime/01-runtime-capture-state.js';
import { getCanonicalMessageMetrics } from '../chatgpt/04-text-estimators.js';
import { trustedCollectedMessageId } from '../chatgpt/09-dom-message-identity.js';
import { captureCompletionContext } from '../core/11-message-completion-context.js';
import { mayBackfillMessage } from '../chatgpt/11-message-hydration.js';
import { commitCapturedMessage } from './11-message-ledger-commit.js';

  // Ledger write-once capture is independent from event routing and UI.
  // Return a boolean so only the caller decides when to persist/render.
  function captureMessages(entries, collected, state, mode, commitCompleted, commit, capturedRevisions = new Map()) {
    let changed = false;
    const { laterUser, lastAssistantIndex } = captureCompletionContext(entries);
    for (const { index, el, role, id: directId } of entries) {
      if (!trustedCollectedMessageId(directId, collected)) {
        if (!directId) (setLastBackfillDeferred(lastBackfillDeferred+1)-1);
        continue;
      }
      // The fast path preserves write-once behavior: no reading, cloning, hashing or
      // tokenization for known IDs, even if the UI currently shows a stub.
      if (directId && state.messages[directId] &&
          !revisionTargets.has(directId)) {
        commit.unchanged++;
        continue;
      }
      // An explicit Edit/Regenerate may unlock a record, but ONLY after the
      // response-completed event. Unknown/readiness-only backfill must not
      // overwrite its saved text while the edited version is still mounting.
      const revision = revisionTargets.get(directId);
      const revisionReady = revision !== undefined && mode === 'ready' &&
        (commitCompleted || completedRevisions.get(directId) === revision);
      if (revision !== undefined && !revisionReady) {
        (setLastBackfillDeferred(lastBackfillDeferred+1)-1);
        continue;
      }
      // Extract and tokenize ONLY previously unseen IDs or explicit revisions.
      const measured = getCanonicalMessageMetrics(el, role);
      if (!measured.chars) continue;
      const id = directId;
      const explicitlyFinished = mode === 'ready' && commitCompleted &&
        (role === 'user' || (role === 'assistant' && index === lastAssistantIndex));
      if (!explicitlyFinished && !revisionTargets.has(id)) {
        if (!mayBackfillMessage(el, role, id, measured, laterUser[index])) {
          (setLastBackfillDeferred(lastBackfillDeferred+1)-1);
          continue;
        }
      }
      if (commitCapturedMessage(state, id, role, measured, commit)) {
        changed = true;
        if (revisionReady) capturedRevisions.set(id, revision);
      }
    }
    return changed;
  }

export { captureMessages };
