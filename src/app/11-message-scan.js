import { completedRevisions, currentChatKey, failedScanDraft, perf, revisionTargets, setFailedScanDraft, setLastBackfillDeferred, setLastCommit, setLastScanReason } from '../runtime/01-runtime-capture-state.js';
import { dirtyFileTurns, inspectedFileTurns, dirtyImageTurns, inspectedImageTurns } from '../runtime/01-runtime-dom-state.js';
import { resetEpoch } from '../runtime/01-runtime-ledger-state.js';
import { isWatchdogPaused } from '../runtime/01-runtime-pause-state.js';
import { perfEnd, perfStart } from '../runtime/02-profiling.js';
import { effectiveBudgets } from '../storage/03-calibration-store.js';
import { saveState } from '../storage/03-ledger-commit.js';
import { loadState } from '../storage/03-ledger-repository.js';
import { queueCommittedFileJobs, scanConversationFiles } from '../attachments/05-attachment-scan.js';
import { rememberSentFile, retryPendingFileResults } from '../attachments/06-attachment-reading.js';
import { collectMessageNodes } from '../chatgpt/09-dom-collection.js';
import { getComposerMode, rememberCollected } from '../chatgpt/09-dom-composer-state.js';
import { scanConversationImages } from '../chatgpt/09-dom-image-accounting.js';
import { normalizeCollectedMessageEntries, trustedCollectedMessageId } from '../chatgpt/09-dom-message-identity.js';
import { stats } from './11-ledger-statistics.js';
import { captureMessages } from './11-message-capture.js';
import { finishRouteTransition, markInspectionDone, setSessionPhase } from './11-route-inspection.js';
import { render } from '../ui/16-panel-rendering.js';
import { routeVerifiedOrWait, synchronizeChatRoute } from './11-route-navigation.js';

  // Background inspections may add only NEW, finished IDs, never overwrite
  // old IDs. Manual Audit is still strictly read-only.
  function scanMessages({
    commitCompleted = false, backfill = false, reason = 'inspection',
    collected: inspectedNodes = null, inspectedMode = null
  } = {}) {
    if (isWatchdogPaused()) return { status: 'paused' };
    const perfStartedAt = perfStart();
    try {
      if (synchronizeChatRoute()) return { status: 'deferred' };
      if (!routeVerifiedOrWait(inspectedNodes)) return { status: 'deferred' };
      finishRouteTransition();
      if (!currentChatKey) {
        setSessionPhase('awaiting-uuid', false);
        render(loadState());
        return { status: 'deferred' };
      }
      const mode = inspectedMode || getComposerMode(
        inspectedNodes ? () => inspectedNodes : collectMessageNodes
      );
      setSessionPhase(mode, false);
      if (mode === 'generating') {
        render(loadState());
        return { status: 'deferred' };
      }

      retryPendingFileResults(currentChatKey);

      // A failed save keeps an immutable-to-the-DOM draft in RAM. Retry only
      // after route validation and with the same chat/reset epoch. This is not
      // permission to recapture a known UUID or an unfinished reply.
      if (failedScanDraft) {
        const pending = failedScanDraft;
        if (pending.chatKey !== currentChatKey ||
            pending.epoch !== resetEpoch(currentChatKey)) {
          for (const [id, generation] of pending.revisions) {
            if (revisionTargets.get(id) === generation) {
              revisionTargets.delete(id);
              completedRevisions.delete(id);
            }
          }
          setFailedScanDraft(null);
        } else if (!saveState(pending.state)) {
          setLastCommit({ ...pending.commit, added: 0, changed: 0, failed: true });
          setLastScanReason('retry · STORAGE WRITE FAILED');
          render(loadState());
          return { status: 'failed' };
        } else {
          for (const [id, generation] of pending.revisions) {
            if (revisionTargets.get(id) === generation) {
              revisionTargets.delete(id);
              completedRevisions.delete(id);
            }
          }
          queueCommittedFileJobs(pending.fileJobs, rememberSentFile);
          setFailedScanDraft(null);
          // The original failed capture is now durable. The current event
          // can continue with a fresh read and normal write-once rules.
        }
      }

      // Once ready, first-seen UUIDs may be captured on load/scroll.
      // Saved UUIDs are skipped before reading their text.
      const collected = inspectedNodes || collectMessageNodes();
      const nodes = collected.nodes;
      rememberCollected(collected);
      markInspectionDone(nodes.length > 0);

      const commit = {
        added: 0, changed: 0, unchanged: 0,
        user: 0, assistant: 0, other: 0, at: Date.now()
      };
      // The composer is not a reliable historical-message completion signal.
      // SPA navigation can leave it absent (unknown) despite fully mounted,
      // finished search units. The caller may request historical-only backfill;
      // mayBackfillMessage() then requires per-message finality evidence.
      // The newest assistant is NEVER explicitly certified in unknown mode.
      if ((!commitCompleted && !backfill) || (mode !== 'ready' && mode !== 'unknown')) {
        setLastScanReason(reason);
        // Display the existing history without mutating it.
        setLastCommit(commit);
        render(loadState());
        return { status: 'unchanged' };
      }

      const state = loadState();
      // Completion is proof of the operation, not of React having mounted
      // the new text. Preserve these generations for later ready-state scans.
      if (commitCompleted && mode === 'ready') {
        for (const [id, generation] of revisionTargets) {
          completedRevisions.set(id, generation);
        }
      }
      setLastBackfillDeferred(0);
      // Reuse UUIDs certified by this same DOM collection; do not rescan their
      // nested attributes. No cache survives the synchronous inspection event.
      const entries = normalizeCollectedMessageEntries(collected);
      // Capture retains the full positional snapshot for finality logic, but
      // attachments must never cross the same ambiguity gate as message text.
      const trustedEntries = entries.filter(entry =>
        trustedCollectedMessageId(entry.id, collected));
      let changed = false;
      const imageInspected = [];
      if (scanConversationImages(trustedEntries, state, imageInspected)) changed = true;
      const fileScan = scanConversationFiles(trustedEntries, state);
      if (fileScan.changed) changed = true;

      const capturedRevisions = new Map();
      if (captureMessages(entries, collected, state, mode, commitCompleted, commit, capturedRevisions)) {
        changed = true;
      }
      const persisted = !changed || saveState(state);
      if (perf.enabled && persisted && !changed) perf.noChangeScans++;
      if (persisted) {
        for (const entry of imageInspected) {
          inspectedImageTurns.set(entry.turn, entry);
          dirtyImageTurns.delete(entry.turn);
        }
        for (const { turn, messageId } of fileScan.inspected) {
          inspectedFileTurns.set(turn, `${state.chatKey}|${messageId}`);
          dirtyFileTurns.delete(turn);
        }
      }
      if (!persisted) {
        // Keep the measured draft, its optimistic storage snapshot and the
        // specific revision identities until a successful retry. No raw text
        // and no extra network activity are retained or introduced.
        setFailedScanDraft({ chatKey: state.chatKey, state,
          epoch: resetEpoch(state.chatKey), revisions: [...capturedRevisions],
          fileJobs: fileScan.jobs, commit: { ...commit } });
        setLastCommit({ ...commit, added: 0, changed: 0, failed: true });
        setLastScanReason(`${reason} · STORAGE WRITE FAILED`);
        render(loadState());
        return { status: 'failed' };
      }
      // A no-op can still be stale DOM. Only generations whose NEW metrics
      // were durably written may be consumed; others wait for hydration.
      for (const [id, generation] of capturedRevisions) {
        if (revisionTargets.get(id) === generation) {
          revisionTargets.delete(id);
          completedRevisions.delete(id);
        }
      }
      queueCommittedFileJobs(fileScan.jobs, rememberSentFile);
      setLastCommit(commit);
      setLastScanReason(reason);
      const metrics = stats(state);
      const budgets = effectiveBudgets();
      render(state, metrics, budgets);
      return { status: changed ? 'persisted' : 'unchanged' };
    } finally {
      perfEnd('conversation', perfStartedAt);
    }
  }

export { scanMessages };
