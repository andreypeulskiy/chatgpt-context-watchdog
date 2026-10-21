import { completedRevisions, failedScanDraft, revisionTargets } from '../runtime/01-runtime-capture-state.js';
import { runtime } from '../runtime/01-runtime-session-state.js';
import { pendingFileResults } from '../runtime/01-runtime-ledger-state.js';
import { currentChatKey } from '../runtime/01-runtime-capture-state.js';

  // Route and completion flags are transient state; this module schedules no work.
  function setSessionPhase(phase) {
    if (runtime.phase === phase) return false;
    runtime.phase = phase;
    return true;
  }

  // Session controller: mutating reply/inspection flags is centralized here.
  // No storage calls, timers or DOM reads; state stays transient to this page.
  function setCompletionPending(pending) {
    runtime.work.completion = !!pending;
  }

  function requestInitialInspection() {
    runtime.work.initial = true;
  }

  // Diagnostics receive primitives and a copied gate, never mutable route state.
  function sessionDiagnosticsSnapshot() {
    const gate = runtime.route?.gate;
    return {
      phase: runtime.phase,
      completion: runtime.work.completion,
      initial: runtime.work.initial,
      routePending: !!runtime.route,
      gate: gate ? { ...gate } : null
    };
  }

  function requestBackfill() {
    runtime.work.backfill = true;
  }

  function startRouteTransition(beforeSnapshot, outgoingKnownIds, keepCompletion) {
    runtime.route = beforeSnapshot ? {
      ...beforeSnapshot, outgoingKnownIds, gate: null
    } : null;
    runtime.work.initial = true;
    runtime.work.backfill = false;
    runtime.work.completion = !!keepCompletion;
    setSessionPhase('switching', false);
  }

  function finishRouteTransition() {
    runtime.route = null;
  }

  function markInspectionDone(hasNodes) {
    if (hasNodes) runtime.work.initial = false;
    runtime.work.backfill = false;
  }

  function needsInspection() {
    return runtime.work.initial || runtime.work.backfill || runtime.work.completion ||
      !!failedScanDraft || [...pendingFileResults.values()].some(job =>
        job.chatKey === currentChatKey) || [...completedRevisions].some(([id, generation]) =>
        revisionTargets.get(id) === generation);
  }


export { setSessionPhase, setCompletionPending, requestInitialInspection, sessionDiagnosticsSnapshot, requestBackfill, startRouteTransition, finishRouteTransition, markInspectionDone, needsInspection };
