// Application-owned chat lifecycle; Storage never imports Audit or UI.
import { completedRevisions, currentChatKey, revisionTargets, setCurrentChatKey, setFailedScanDraft, setLastBackfillDeferred, setLastCommit, setLastScanReason, setLastUiSignals, setTransientState, transientState } from '../runtime/01-runtime-capture-state.js';
import { deferredConversationFrame, setDeferredConversationFrame, setInspectedFileTurns, setInspectedImageTurns } from '../runtime/01-runtime-dom-state.js';
import { ledgerResetEpochs, pendingTransientPromotions } from '../runtime/01-runtime-ledger-state.js';
import { hydrationCandidates, hydrationCheckTimer, runtime, setHydrationCheckTimer } from '../runtime/01-runtime-session-state.js';
import { pendingLocalFiles } from '../runtime/01-runtime-ui-state.js';
import { getChatKey } from '../storage/03-ledger-foundation.js';
import { promoteTransientLedger } from '../storage/03-chat-transition.js';
import { clearAuditConfirmation } from './10-audit-confirmation.js';

  function retryTransientPromotion(chatKey = currentChatKey) {
  const pending = pendingTransientPromotions.get(chatKey);
  if (!pending) return true;
  if (pending.epoch !== (ledgerResetEpochs.get(chatKey) || 0)) {
    pendingTransientPromotions.delete(chatKey);
    return false;
  }
  if (!promoteTransientLedger(chatKey, pending.draft)) return false;
  pendingTransientPromotions.delete(chatKey);
  return true;
  }

  function changeChatKey(next = getChatKey()) {
  if (next === currentChatKey) return false;
  if (deferredConversationFrame) {
    cancelAnimationFrame(deferredConversationFrame);
    setDeferredConversationFrame(0);
  }
  if (next && !currentChatKey && transientState) {
    // Failed storage writes must not lose a nonempty transient draft.
    // Keep its destination UUID and reset epoch until a later successful retry.
    const draft = transientState;
    pendingTransientPromotions.set(next, {
      draft, epoch: ledgerResetEpochs.get(next) || 0
    });
    retryTransientPromotion(next);
  }
  if (next && !currentChatKey) {
    for (const item of pendingLocalFiles) if (item.chatKey === null) item.chatKey = next;
  }
  if (currentChatKey) pendingLocalFiles.length = 0;
  setTransientState(null);
  setCurrentChatKey(next);
  setLastUiSignals({ stop: false, send: false, actions: null });
  setLastCommit(null);
  clearAuditConfirmation();
  revisionTargets.clear();
  completedRevisions.clear();
  setFailedScanDraft(null);
  hydrationCandidates.clear();
  if (hydrationCheckTimer) clearTimeout(hydrationCheckTimer);
  setHydrationCheckTimer(0);
  setInspectedFileTurns(new WeakMap());
  setInspectedImageTurns(new WeakMap());
  setLastBackfillDeferred(0);
  runtime.route = null;
  runtime.work.backfill = false;
  setLastScanReason('navigation');
  return true;
  }

export { changeChatKey, retryTransientPromotion };
