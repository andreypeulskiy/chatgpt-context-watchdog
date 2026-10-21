import { isWatchdogPaused } from '../runtime/01-runtime-pause-state.js';
import { currentChatKey } from '../runtime/01-runtime-capture-state.js';
import { hydrationCandidates, hydrationCheckTimer, setHydrationCheckTimer } from '../runtime/01-runtime-session-state.js';
import { normalizeText } from './04-text-estimators.js';
import { FINISHED_ACTION_SELECTOR } from './09-dom-composer-state.js';
import { getStructuralMessageId } from './09-dom-message-identity.js';
import { requestBackfill } from '../app/11-route-inspection.js';
import { queueConversationEvent } from '../app/17-conversation-coordinator.js';

  // Historical messages need a positive completion/hydration signal before
  // first-time capture. A role-qualified search unit with an unambiguous
  // identity is preferred. Fallback-only/unkeyed fragments are audit-only.
  // A short assistant view or a response lacking its own final toolbar is
  // staged until a later independent DOM event shows identical content.
  // This is NOT a background timer, and no text is persisted while staging.
  function assistantHasOwnActions(el) {
    const turn = el.closest?.('[data-turn-key], [data-testid^="conversation-turn-"]');
    return !!turn?.querySelector?.(FINISHED_ACTION_SELECTOR);
  }

  // A short/unfinished message is stable only after a later independent UI
  // event finds the same fingerprint at least 400 ms after its first sighting.
  function scheduleHydrationRecheck(delay = 420) {
    if (hydrationCheckTimer) return;
    const chatKey = currentChatKey;
    // A single delayed recheck resolves otherwise silent, fully hydrated short
    // messages. This is not a recurring timer or a scan of stored UUIDs.
    setHydrationCheckTimer(setTimeout(() => {
      setHydrationCheckTimer(0);
      if (document.hidden || currentChatKey !== chatKey || !hydrationCandidates.size) return;
      requestBackfill();
      if (!isWatchdogPaused()) queueConversationEvent();
    }, delay));
  }

  function stableHydration(id, metrics) {
    const previous = hydrationCandidates.get(id);
    const snapshot = `${metrics.chars}:${metrics.fingerprint}`;
    if (!previous || previous.snapshot !== snapshot) {
      hydrationCandidates.set(id, { snapshot, seenAt: Date.now() });
      scheduleHydrationRecheck();
      return false;
    }
    const elapsed = Date.now() - previous.seenAt;
    if (elapsed < 400) scheduleHydrationRecheck(Math.max(30, 410 - elapsed));
    return elapsed >= 400;
  }

  function messageBusy(el, withSkeleton = false) {
    return !!(el.hidden || el.closest?.('[hidden], [inert], [aria-busy="true"]') ||
      el.querySelector?.(withSkeleton
        ? '[aria-busy="true"], [data-state="loading"], [data-testid*="skeleton"]'
        : '[aria-busy="true"], [data-state="loading"]'));
  }

  function mayBackfillMessage(el, role, id, metrics, laterUserPresent) {
    if (role !== 'user' && role !== 'assistant') return false;
    const structural = getStructuralMessageId(el, role);
    if (!structural?.startsWith('msg:')) return false;
    if (metrics.parts.source === 'fallback') return false;
    if (messageBusy(el, true)) return false;
    const content = metrics.parts.prose + '\n' + metrics.parts.code;
    if (!normalizeText(content) || /^(?:loading|загрузка|загружаем|подождите|please wait)[.…! ]*$/i.test(content.trim())) return false;
    if (role === 'user') {
      // A six-character user view was observed during F5 hydration in Chromium.
      // Short *historical* prompts must also survive two distinct events
      // before being committed. The current sent prompt is still captured
      // immediately on the confirmed Stop -> ready completion event.
      if (metrics.chars >= 24) {
        hydrationCandidates.delete(id);
        return true;
      }
      return stableHydration(id, metrics);
    }

    const finalActions = assistantHasOwnActions(el);
    // A historical assistant with no local action toolbar and no following
    // user message might be the ongoing/partially mounted last answer.
    if (!finalActions && !laterUserPresent) return false;

    const needsSecondObservation = metrics.chars < 64 || !finalActions;
    if (!needsSecondObservation) {
      hydrationCandidates.delete(id);
      return true;
    }
    return stableHydration(id, metrics);
  }

export { assistantHasOwnActions, scheduleHydrationRecheck, stableHydration, messageBusy, mayBackfillMessage };
