import { completedRevisions, currentChatKey, initializeCaptureState, failedScanDraft, perf, revisionTargets, setFailedScanDraft, setSettings } from '../runtime/01-runtime-capture-state.js';
import { APP, HISTORY_KEY, SETTINGS_KEY, STATE_PREFIX } from '../runtime/01-runtime-configuration.js';
import { booted, dirtyFileTurns, dirtyImageTurns, setBooted, setCalibrationHistoryCorrupt, setHistoryCache, setHistorySummaryCache, setInspectedFileTurns, setInspectedImageTurns, setImageRescanRequester } from '../runtime/01-runtime-dom-state.js';
import { corruptLedgerKeys, invalidateLedgerJobs, invalidateLedgerReadSnapshots, ledgerResetEpochs, pendingFileResults, pendingTransientPromotions, setStorageFailureNotifier, setStorageWarningShown, storageFailures } from '../runtime/01-runtime-ledger-state.js';
import { runtime, hydrationCheckTimer, setHydrationCheckTimer } from '../runtime/01-runtime-session-state.js';
import { deferredConversationFrame, setDeferredConversationFrame } from '../runtime/01-runtime-dom-state.js';
import { isChatAvailable, isWatchdogPaused, setChatAvailable, setRunStateSynchronizer } from '../runtime/01-runtime-pause-state.js';
import { findAvailableChatComposer, mutationMayChangeChatAvailability } from '../chatgpt/09-chat-availability.js';
import { observer, pendingLocalFiles, setObserver, setUiInitializer, ui } from '../runtime/01-runtime-ui-state.js';
import { perfEnd, perfStart } from '../runtime/02-profiling.js';
import { getChatKey, reportStorageFailure, stateKey } from '../storage/03-ledger-foundation.js';
import { decodeLedger } from '../core/03-ledger-validation.js';
import { loadState } from '../storage/03-ledger-repository.js';
import { loadSettings } from '../storage/03-settings-store.js';
import { installFileWatchers, isActiveSubmittedFile } from '../attachments/06-attachment-reading.js';
import { applyAppearance, syncViewControls, watchPageTheme } from '../ui/08-theme-budgets.js';
import { isFinishedActionNode } from '../chatgpt/09-dom-composer-state.js';
import { markRevisionFromClick } from '../chatgpt/09-dom-revision-controls.js';
import { requestBackfill, requestInitialInspection, startRouteTransition } from './11-route-inspection.js';
import { changeChatKey } from './11-chat-transition.js';
import { resumePausedFileJobs, cancelPausedFileJobs } from '../attachments/06-attachment-reading.js';
import { synchronizeChatRoute } from './11-route-navigation.js';
import { queueConversationEvent } from './17-conversation-coordinator.js';
import { SETTING_GROUPS, syncGroupInputs } from '../ui/15-panel-settings-controls.js';
import { syncHandoffEditor } from '../ui/15-panel-handoff-settings.js';
import { ensureUI } from '../ui/15-panel-ui-coordinator.js';
import { render, renderRunState, showToast } from '../ui/16-panel-rendering.js';

  // Invalidate only user turns touched by the mutation. Also recognize
  // previously detached nodes reattached with changes React made off-DOM.
  const FILE_USER_TURN_SELECTOR =
    '[data-chatgpt-search-unit-key$=":user"], [data-chatgpt-search-unit-key="user"], ' +
    '[data-message-id][data-message-author-role="user"], ' +
    '[data-message-id][data-message-role="user"]';

  function markFileTurnDirty(mutation, batchTurnCache = null) {
    const target = mutation.target.nodeType === Node.TEXT_NODE
      ? mutation.target.parentElement : mutation.target;
    if (!(target instanceof Element)) return;
    // A MutationObserver callback sees the final DOM state for its batch.
    // Reuse ancestry classification only inside that callback: never cache
    // across route changes, React remounts or separate observation batches.
    let turn = batchTurnCache?.get(target);
    if (!turn) {
      // Assistant streaming cannot change the user-only file ledger.
      const assistant = !!target.closest('[data-chatgpt-search-unit-key$=":assistant"], [data-chatgpt-search-unit-key="assistant"]');
      turn = { assistant, user: assistant ? null : target.closest(FILE_USER_TURN_SELECTOR) };
      batchTurnCache?.set(target, turn);
    }
    if (turn.assistant) return;
    if (turn.user) {
      dirtyFileTurns.add(turn.user);
      if (mutation.type !== 'characterData') dirtyImageTurns.add(turn.user);
    }
    if (mutation.type !== 'childList') return;
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches(FILE_USER_TURN_SELECTOR)) {
        dirtyFileTurns.add(node);
        dirtyImageTurns.add(node);
      } else if (node.querySelector(FILE_USER_TURN_SELECTOR)) {
        // A whole conversation-turn wrapper may be attached after its children
        // were changed while detached. Catch nested user units as well.
        for (const nested of node.querySelectorAll(FILE_USER_TURN_SELECTOR)) {
          dirtyFileTurns.add(nested);
          dirtyImageTurns.add(nested);
        }
      }
    }
  }

  function mutationTouchesConversation(mutation, urgency = null) {
    const root = document.getElementById(`${APP}-root`);
    let target = mutation.target;
    if (target?.nodeType === Node.TEXT_NODE) target = target.parentElement;
    if (root && target instanceof Element && root.contains(target)) return false;

    // Changes to completion/visibility gates may have no accompanying
    // childList mutation. Track them on messages, main and their ancestors.
    if (mutation.type === 'attributes' &&
        ['aria-busy', 'aria-hidden', 'inert'].includes(mutation.attributeName) &&
        target instanceof Element &&
        (target.matches('main') || target.closest('main') ||
         target.querySelector('main [data-chatgpt-search-unit-key], main [data-message-id]'))) {
      if (runtime.phase !== 'generating') requestBackfill();
      if (urgency) urgency.value = true;
      return true;
    }

    // A composer button can change state by CSS class/style as well as
    // aria-label; treat both as events without scanning response text.
    if (target instanceof Element &&
        target.closest('form[data-chatgpt-composer], #composer-background, #prompt-textarea')) {
      if (urgency) urgency.value = true;
      return true;
    }

    // Streaming emits frequent characterData changes. Stop/Send controls are
    // handled above, while newly mounted actions still arrive as childList.
    // Avoid descendant toolbar queries for every in-progress text fragment.
    if (runtime.phase === 'generating' && mutation.type === 'characterData') return false;

    if (target instanceof Element && isFinishedActionNode(target)) {
      if (runtime.phase !== 'generating') requestBackfill();
      if (urgency) urgency.value = true;
      return true;
    }
    for (const node of mutation.addedNodes || []) {
      if (!(node instanceof Element)) continue;
      if (root && root.contains(node)) continue;
      if (isFinishedActionNode(node)) {
        if (runtime.phase !== 'generating') requestBackfill();
        if (urgency) urgency.value = true;
        return true;
      }
      if (node.matches?.('form[data-chatgpt-composer], #composer-background') ||
          node.querySelector?.('form[data-chatgpt-composer], #composer-background')) {
        if (urgency) urgency.value = true;
        return true;
      }
    }

    // During generation, only a newly mounted user turn/card may resolve a
    // submitted File to its UUID. Assistant streaming remains ignored.
    if (runtime.phase === 'generating') {
      if (!pendingLocalFiles.some(item =>
        isActiveSubmittedFile(item, currentChatKey) && !item.boundMessageId)) return false;
      if (target instanceof Element &&
          (target.matches(FILE_USER_TURN_SELECTOR) ||
           target.closest(FILE_USER_TURN_SELECTOR))) return true;
      for (const node of mutation.addedNodes || []) {
        if (node instanceof Element &&
            (node.matches(FILE_USER_TURN_SELECTOR) ||
             node.querySelector(FILE_USER_TURN_SELECTOR))) return true;
      }
      return false;
    }

    // Streamed assistant tokens are ignored. Once the composer is ready,
    // mounting/hydrating an unfamiliar search unit can trigger ONE cheap
    // ID-only pass, not recurring rescans of previously stored messages.
    const needsContent = runtime.work.initial ||
      (runtime.work.completion && runtime.phase !== 'generating');
    const contentSelector =
      'main [data-chatgpt-search-unit-key], main [data-turn-key], ' +
      'main [data-message-id], main [data-message-author-role]';
    const inMessage = target instanceof Element &&
      (!!target.closest?.(contentSelector) || target.matches?.('main'));
    let mounted = false;
    for (const node of mutation.addedNodes || []) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.('main, [data-chatgpt-search-unit-key], [data-turn-key], [data-message-id]') ||
          node.querySelector?.('[data-chatgpt-search-unit-key], [data-turn-key], [data-message-id]')) {
        mounted = true;
        break;
      }
    }
    if (inMessage || mounted) {
      requestBackfill();
      return true;
    }
    return !!(needsContent && target instanceof Element && target.closest?.('main'));
  }

  function installObserver() {
    if (isWatchdogPaused()) return;
    if (observer) observer.disconnect();
    setObserver(new MutationObserver(mutations => {
      if (isWatchdogPaused()) return;
      const started = perfStart();
      try {
        let needsEvent = false, urgent = false, pageMutations = 0;
        const urgency = { value: false };
        // Only characterData records for the very same Node can be coalesced.
        // Do not drop childList or attribute records: attachments, composer
        // controls and route transitions depend on their final DOM state.
        // Single-record callbacks are common: avoid cache allocations unless
        // the batch actually contains more than one mutation record.
        const seenTextNodes = mutations.length > 1 ? new WeakSet() : null;
        const batchTurnCache = mutations.length > 1 ? new WeakMap() : null;
        for (const mutation of mutations) {
          // Watchdog's own DOM writes are not conversation activity.
          if (ui?.root && (mutation.target === ui.root || ui.root.contains(mutation.target))) continue;
          pageMutations++;
          if (seenTextNodes && mutation.type === 'characterData') {
            if (seenTextNodes.has(mutation.target)) {
              if (perf.enabled) perf.duplicateTextMutations++;
              continue;
            }
            seenTextNodes.add(mutation.target);
          }
          markFileTurnDirty(mutation, batchTurnCache);
          if (!document.hidden && !urgent) {
            urgency.value = false;
            if (mutationTouchesConversation(mutation, urgency)) needsEvent = true;
            if (urgency.value) urgent = true;
          } else if (document.hidden && mutation.type !== 'characterData' &&
              pendingLocalFiles.some(item =>
                isActiveSubmittedFile(item, currentChatKey) && !item.boundMessageId)) {
            // Keep attachment identity tracking alive in a hidden tab; do not
            // scan response text or schedule general conversation inspection.
            let target = mutation.target;
            if (target?.nodeType === Node.TEXT_NODE) target = target.parentElement;
            if (target instanceof Element &&
                (target.matches(FILE_USER_TURN_SELECTOR) ||
                 target.closest(FILE_USER_TURN_SELECTOR))) needsEvent = true;
            for (const node of mutation.addedNodes || []) {
              if (node instanceof Element &&
                  (node.matches(FILE_USER_TURN_SELECTOR) ||
                   node.querySelector(FILE_USER_TURN_SELECTOR))) needsEvent = true;
            }
          }
        }
        if (perf.enabled && pageMutations) {
          perf.mutationBatches++;
          perf.mutations += pageMutations;
        }
        if (needsEvent) queueConversationEvent(urgent ? 'urgent' : 'background');
      } finally {
        perfEnd('observerCallback', started);
      }
    }));
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'data-testid', 'aria-label', 'aria-busy', 'aria-hidden', 'inert',
        'hidden', 'disabled', 'class',
        'style', 'data-state', 'aria-disabled',
        'data-chatgpt-search-unit-key', 'data-chatgpt-search-message-ids',
        'data-message-id', 'data-message-author-role', 'data-message-role',
        'title', 'download', 'href',
        'src', 'srcset', 'sizes', 'width', 'height', 'alt', 'media', 'type'
      ]
    });
  }

  // Structural-only, event-driven chat detection: active and paused tabs share
  // this one small observer. Streaming characterData cannot invoke it. Most
  // childList mutations need only cheap node-type/tag checks, not a DOM search.
  let availableComposer = null;
  let heavyObserving = false;
  let lastRoutePath = '';
  let availabilityObserver = null;
  let routeAvailabilityFrame = 0;
  function installAvailabilityObserver() {
    if (availabilityObserver) availabilityObserver.disconnect();
    availabilityObserver = new MutationObserver(mutations => {
    if (ui && !ui.root.isConnected) {
      ensureUI();
      renderRunState();
    }
    // Attribute changes to a large hidden ancestor can generate hundreds of
    // records for one target. Inspect each subtree at most once per batch.
    const checkedSubtrees = mutations.length > 1 ? new WeakMap() : null;
    if (!mutations.some(mutation => {
      const target = mutation.target;
      if (ui?.root && (target === ui.root || ui.root.contains(target))) return false;
      return mutationMayChangeChatAvailability(mutation, availableComposer, checkedSubtrees);
    })) return;
    refreshChatAvailability();
    });
    availabilityObserver.observe(document.body || document.documentElement, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'inert', 'class', 'style']
    });
  }

  function refreshChatAvailability() {
    availableComposer = findAvailableChatComposer();
    if (setChatAvailable(!!availableComposer)) synchronizeRunState();
  }

  function synchronizeRunState() {
    if (isWatchdogPaused()) {
      if (heavyObserving) {
        observer?.disconnect();
        heavyObserving = false;
      }
      if (deferredConversationFrame) {
        cancelAnimationFrame(deferredConversationFrame);
        setDeferredConversationFrame(0);
      }
      if (hydrationCheckTimer) {
        clearTimeout(hydrationCheckTimer);
        setHydrationCheckTimer(0);
      }
    } else if (!heavyObserving) {
      // A route changed while heavy inspection was disabled. Gate the return
      // against durable IDs belonging to the previous chat, not stale DOM.
      const next = getChatKey();
      if (next !== currentChatKey) {
        const previousIds = currentChatKey
          ? new Set(Object.keys(loadState(currentChatKey).messages || {})) : new Set();
        changeChatKey(next);
        if (next && previousIds.size) {
          startRouteTransition({ beforeIds: previousIds, beforeNodes: new WeakMap() },
            previousIds, false);
        }
      }
      // Mutations and loads may have occurred while heavy observer was off.
      // A fresh DOM inspection is mandatory on every resume.
      setInspectedImageTurns(new WeakMap());
      installObserver();
      heavyObserving = true;
      requestInitialInspection();
      requestBackfill();
      resumePausedFileJobs();
      queueConversationEvent();
    }
    renderRunState();
  }

  function watchRouteChanges() {
    // Preserve the existing UUID route gate when navigation starts in Play.
    // Never collect outgoing DOM or access a ledger during Pause.
    const onNavigation = () => {
      const pathChanged = location.pathname !== lastRoutePath;
      lastRoutePath = location.pathname;
      if (!pathChanged) return;
      if (!isWatchdogPaused()) synchronizeChatRoute();
      // Pause until availability is rechecked, even when React reuses the
      // composer without a structural mutation. Availability only resumes
      // observation; the existing route/UUID gate still controls ledger writes.
      if (setChatAvailable(false)) synchronizeRunState();
      if (!routeAvailabilityFrame) {
        routeAvailabilityFrame = requestAnimationFrame(() => {
          routeAvailabilityFrame = 0;
          refreshChatAvailability();
        });
      }
    };
    for (const method of ['pushState', 'replaceState']) {
      const native = history[method];
      if (typeof native !== 'function') continue;
      history[method] = function(...args) {
        const before = location.pathname;
        const result = native.apply(this, args);
        if (location.pathname !== before) onNavigation();
        return result;
      };
    }
    window.addEventListener('popstate', onNavigation);
    window.addEventListener('hashchange', onNavigation);
    window.navigation?.addEventListener?.('currententrychange', onNavigation);
  }

  function boot() {
    if (booted) return;
    setBooted(true);
    setStorageFailureNotifier(showToast);
    initializeCaptureState(loadSettings(), getChatKey());

    ensureUI();
    setRunStateSynchronizer(synchronizeRunState);
    setImageRescanRequester(() => {
      if (!isWatchdogPaused() && !document.hidden) {
        requestBackfill();
        queueConversationEvent('background');
      }
    });
    lastRoutePath = location.pathname;
    // Structural changes or visibility flips wake the page; text streaming
    // never triggers availability searches while paused.
    installAvailabilityObserver();
    refreshChatAvailability();
    synchronizeRunState();
    installFileWatchers();
    document.addEventListener('click', markRevisionFromClick, true);
    watchRouteChanges();
    if (!isWatchdogPaused()) queueConversationEvent();

    watchPageTheme();
    const themeMq = window.matchMedia?.('(prefers-color-scheme: dark)');
    themeMq?.addEventListener?.('change', applyAppearance);

    window.addEventListener('pageshow', () => {
      setInspectedImageTurns(new WeakMap());
      refreshChatAvailability();
      if (!isWatchdogPaused()) queueConversationEvent();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        // The tab may have missed async loads while hidden.
        setInspectedImageTurns(new WeakMap());
        refreshChatAvailability();
        if (!isWatchdogPaused()) {
          requestBackfill();
          queueConversationEvent();
        }
      }
    });

    console.info('[Context Watchdog __WATCHDOG_VERSION__] first-seen backfill, role-qualified IDs, write-once; no polling/network APIs.');
  }

  let startupRegistered = false;
  function start() {
    if (startupRegistered) return;
    startupRegistered = true;
    // Register before any event listener can request a render.
    setUiInitializer(ensureUI);
  window.addEventListener('storage', (event) => {
    // A reset in another tab must cancel pending file-estimate completions.
    // Ordinary additions to the ledger do not cancel them: they are merged.
    if (event.key === null) {
      // Other-tab clear() is the same storage reset boundary as local Wipe.
      // Invalidate drafts BEFORE allowing fresh loads; old snapshots whose
      // baseline was already null must not recreate a deleted ledger.
      invalidateLedgerReadSnapshots();
      for (const key of new Set([
        ...ledgerResetEpochs.keys(), ...corruptLedgerKeys,
        ...pendingTransientPromotions.keys(),
        ...[...pendingFileResults.values()].map(job => job.chatKey), currentChatKey
      ])) invalidateLedgerJobs(key);
      pendingFileResults.clear();
      corruptLedgerKeys.clear();
      storageFailures.clear();
      setStorageWarningShown(false);
      pendingTransientPromotions.clear();
      pendingLocalFiles.length = 0;
      cancelPausedFileJobs();
      setFailedScanDraft(null);
      revisionTargets.clear();
      completedRevisions.clear();
    } else if (event.key.startsWith(STATE_PREFIX)) {
      // A tab may remove a bad ledger and immediately re-save finished turns.
      // By the time this deletion event reaches us, the key can already exist.
      // Validate the LIVE bytes rather than requiring getItem() === null.
      try {
        const resetChat = decodeURIComponent(event.key.slice(STATE_PREFIX.length));
        if (resetChat && stateKey(resetChat) === event.key &&
            (event.newValue === null || corruptLedgerKeys.has(resetChat))) {
          let validLiveLedger = false;
          let validationError = null;
          try {
            const liveRaw = localStorage.getItem(event.key);
            if (liveRaw === '') throw new Error('Empty ledger bytes');
            decodeLedger(resetChat, liveRaw); // null (deleted) is a valid empty ledger.
            validLiveLedger = true;
          } catch (err) { validationError = err; }

          // A deletion is always a reset boundary, even if a later write has
          // already replaced it. A valid write replacing a known corrupt ledger
          // is also a recovery boundary. Ordinary updates aren't resets.
          if (event.newValue === null || validLiveLedger) {
            pendingTransientPromotions.delete(resetChat);
            if (failedScanDraft?.chatKey === resetChat) setFailedScanDraft(null);
            if (resetChat === currentChatKey) {
              revisionTargets.clear();
              completedRevisions.clear();
              pendingLocalFiles.length = 0;
            }
            // Bump ONLY this chat's epoch. Unrelated snapshots (including
            // failed-write drafts) must retain their optimistic baselines.
            invalidateLedgerJobs(resetChat);
            cancelPausedFileJobs(resetChat);
          }

          if (validLiveLedger) {
            corruptLedgerKeys.delete(resetChat);
            storageFailures.delete(resetChat);
            if (!corruptLedgerKeys.size && !storageFailures.size) setStorageWarningShown(false);
          } else if (event.newValue === null) {
            // A queued delete event is not proof that newer malformed bytes
            // were repaired: retain the read-only gate and the raw bytes.
            corruptLedgerKeys.add(resetChat);
            reportStorageFailure(resetChat,
              'CORRUPT LEDGER: writes blocked. Back up the original storage entry.',
              validationError);
          }
        }
      } catch { /* A malformed external storage key is not a chat identity. */ }
    }
    if (event.key === null || (currentChatKey && event.key === stateKey(currentChatKey))) {
      setInspectedFileTurns(new WeakMap());
      setInspectedImageTurns(new WeakMap());
      if (!isWatchdogPaused()) {
        requestBackfill();
        if (!document.hidden) queueConversationEvent();
      }
    }
    if (event.key === HISTORY_KEY || event.key === null) {
      setHistoryCache(null);
      setHistorySummaryCache(null);
      setCalibrationHistoryCorrupt(false);
      if (!document.hidden && !isWatchdogPaused()) render(loadState());
    }

    if (event.key === SETTINGS_KEY || event.key === null) {
      setSettings(loadSettings());
      synchronizeRunState();
      applyAppearance();
      syncViewControls();
      if (ui) {
        for (const group of Object.keys(SETTING_GROUPS)) syncGroupInputs(group);
        syncHandoffEditor();
        if (!document.hidden && !isWatchdogPaused()) render(loadState());
      }
    }

  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
  }

export { start, FILE_USER_TURN_SELECTOR, markFileTurnDirty, mutationTouchesConversation, installObserver, watchRouteChanges, boot };
