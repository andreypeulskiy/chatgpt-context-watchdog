import { retryTransientPromotion } from './11-chat-transition.js';
import { currentChatKey, lastUiSignals, perf } from '../runtime/01-runtime-capture-state.js';
import { deferredConversationFrame, mutationCheckQueued, setDeferredConversationFrame, setMutationCheckQueued } from '../runtime/01-runtime-dom-state.js';
import { runtime } from '../runtime/01-runtime-session-state.js';
import { isWatchdogPaused } from '../runtime/01-runtime-pause-state.js';
import { pendingLocalFiles } from '../runtime/01-runtime-ui-state.js';
import { bindSubmittedFilesToMessage } from '../attachments/05-attachment-scan.js';
import { isActiveSubmittedFile } from '../attachments/06-attachment-reading.js';
import { collectMessageNodes } from '../chatgpt/09-dom-collection.js';
import { getComposerMode, hasLastAssistantActions } from '../chatgpt/09-dom-composer-state.js';
import { normalizeCollectedMessageEntries, trustedCollectedMessageId } from '../chatgpt/09-dom-message-identity.js';
import { scanMessages } from './11-message-scan.js';
import { finishRouteTransition, needsInspection, setCompletionPending, setSessionPhase } from './11-route-inspection.js';
import { routeVerifiedOrWait, synchronizeChatRoute } from './11-route-navigation.js';
import { loadState } from '../storage/03-ledger-repository.js';
import { render } from '../ui/16-panel-rendering.js';

  // Repaint at the application boundary; route state has no UI dependency.
  function updateVisibleSessionPhase(phase) {
    if (setSessionPhase(phase)) render(loadState());
  }

  // All composer/route transitions go through one handler. The jobs are
  // orthogonal to the phase: an initial scan may coexist with a pending reply.
  function onConversationEvent() {
    if (isWatchdogPaused()) return;
    if (perf.enabled) perf.processedEvents++;
    // Retry only against its original destination, never another chat.
    if (currentChatKey) retryTransientPromotion(currentChatKey);
    if (document.hidden) {
      // A background tab may finish a long answer before it becomes visible.
      // Only confirm the submitted-file UUID here; never capture messages.
      if (!pendingLocalFiles.some(item =>
        isActiveSubmittedFile(item, currentChatKey) && !item.boundMessageId)) return;
      if (synchronizeChatRoute() || !currentChatKey) return;
      const snapshot = collectMessageNodes();
      if (!routeVerifiedOrWait(snapshot)) return;
      bindSubmittedFilesToMessage(normalizeCollectedMessageEntries(snapshot).filter(
        entry => trustedCollectedMessageId(entry.id, snapshot)), currentChatKey);
      return;
    }
    if (synchronizeChatRoute()) return;
    if (!currentChatKey) {
      const mode = getComposerMode();
      if (mode === 'generating') setCompletionPending(true);
      updateVisibleSessionPhase(mode);
      return;
    }

    // An event-local DOM snapshot is shared by route gating, the optional
    // action-toolbar check and UUID capture. It expires at event return.
    let collected = null;
    const getCollected = () => collected || (collected = collectMessageNodes());
    // Never read controls left behind by the outgoing chat until UUID-based
    // route identity has been confirmed for the destination.
    if (!routeVerifiedOrWait(runtime.route ? getCollected() : null)) return;
    if (runtime.route) finishRouteTransition();
    const mode = getComposerMode(getCollected);

    if (mode === 'generating') {
      setCompletionPending(true);
      updateVisibleSessionPhase('generating');
      // Bind a confirmed sent file to the new trusted user UUID now; waiting
      // until the assistant finishes can exceed the submission window.
      if (pendingLocalFiles.some(item =>
        isActiveSubmittedFile(item, currentChatKey) && !item.boundMessageId)) {
        const snapshot = getCollected();
        bindSubmittedFilesToMessage(normalizeCollectedMessageEntries(snapshot).filter(
          entry => trustedCollectedMessageId(entry.id, snapshot)), currentChatKey);
      }
      return; // Streaming text is never committed.
    }

    if (mode === 'ready' && needsInspection()) {
      const completing = runtime.work.completion;
      if (completing) {
        const actions = hasLastAssistantActions(getCollected());
        lastUiSignals.actions = actions;
        if (!actions) {
          updateVisibleSessionPhase('finishing');
          return;
        }
      }
      const wasBackfill = runtime.work.backfill;
      setCompletionPending(false);
      setSessionPhase('ready', false);
      scanMessages({
        commitCompleted: completing, backfill: true,
        reason: completing ? 'response finished + unseen history' :
          (wasBackfill ? 'DOM mount/scroll backfill' : 'initial/navigation backfill'),
        collected, inspectedMode: mode
      });
      // scanMessages owns revision permissions and their durability outcome.
      return;
    }

    if (mode === 'unknown' && (runtime.work.initial || runtime.work.backfill)) {
      // Unknown composer: only old per-message-certified responses may backfill.
      // It is NEVER evidence that the newest in-progress reply finished.
      setSessionPhase('unknown', false);
      scanMessages({
        commitCompleted: false, backfill: true,
        reason: 'DOM backfill (composer unknown; per-message finality)',
        collected, inspectedMode: mode
      });
      return;
    }
    updateVisibleSessionPhase(mode);
  }

  function queueConversationEvent(priority = 'urgent') {
    if (isWatchdogPaused()) return;
    // Coalesce background-only mounts within one frame. Completion controls,
    // SPA navigation and initial scans keep the original microtask priority.
    if (priority === 'background' && !runtime.work.completion &&
        !runtime.route && !runtime.work.initial && !mutationCheckQueued) {
      if (!deferredConversationFrame) {
        setDeferredConversationFrame(requestAnimationFrame(() => {
          setDeferredConversationFrame(0);
          queueConversationEvent();
        }));
      }
      return;
    }
    if (deferredConversationFrame) {
      cancelAnimationFrame(deferredConversationFrame);
      setDeferredConversationFrame(0);
    }
    if (mutationCheckQueued) return;
    setMutationCheckQueued(true);
    if (perf.enabled) perf.queuedEvents++;
    queueMicrotask(() => {
      setMutationCheckQueued(false);
      if (!isWatchdogPaused()) onConversationEvent();
    });
  }


export { onConversationEvent, queueConversationEvent };
