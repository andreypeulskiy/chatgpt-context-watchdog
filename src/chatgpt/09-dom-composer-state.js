import { setLastUiSignals } from '../runtime/01-runtime-capture-state.js';
import { collectorState } from '../runtime/02-profiling.js';
import { collectMessageNodes } from './09-dom-collection.js';
import { inferRole } from './09-dom-unit-identity.js';

  function visibleControl(el) {
    return !!el && !el.hidden &&
      el.getAttribute('aria-hidden') !== 'true' &&
      el.getClientRects().length > 0;
  }

  // Read only visible composer controls. This is intentionally DOM-only:
  // no API calls, request interception, repeated polling or response-text IO.
  const COMPOSER_CONTROLS = Object.freeze({
    stop: [
      'button[data-testid="stop-button"]',
      'button[aria-label="Stop streaming"]',
      'button[aria-label="Stop generating"]',
      'button[aria-label="Stop"]',
      'button[aria-label="Остановить генерацию"]',
      'button[aria-label="Остановить"]'
    ].join(', '),
    send: [
      'button[data-testid="send-button"]',
      'button[data-testid="composer-submit-button"]',
      'button#composer-submit-button',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send"]',
      'button[aria-label="Отправить сообщение"]',
      'button[aria-label="Отправить"]'
    ].join(', ')
  });

  function anyVisibleControl(selector) {
    // Do not materialize an array of all controls for every observer event.
    for (const node of document.querySelectorAll(selector)) {
      if (visibleControl(node)) return true;
    }
    return false;
  }

  // Read-only snapshot for Diagnostics. Never invokes the conversation
  // coordinator, collects messages or schedules an inspection.
  function readComposerControlsForDiagnostics() {
    return {
      stop: anyVisibleControl(COMPOSER_CONTROLS.stop),
      send: anyVisibleControl(COMPOSER_CONTROLS.send)
    };
  }

  function getComposerMode(getCollected = collectMessageNodes) {
    const stop = anyVisibleControl(COMPOSER_CONTROLS.stop);
    if (stop) {
      setLastUiSignals({ stop: true, send: false, actions: null });
      return 'generating';
    }

    const send = anyVisibleControl(COMPOSER_CONTROLS.send);
    if (send) {
      setLastUiSignals({ stop: false, send: true, actions: null });
      return 'ready';
    }

    // Empty composers can show only a microphone/dictation control. After
    // After an F5 we may not have observed Stop; the latest assistant's
    // completed toolbar is an independent completion signal.
    // The assistant's final actions also let us recognize an already-loaded
    // conversation without any timer or additional network request.
    const composerPresent = !!document.querySelector(
      'form[data-chatgpt-composer], #prompt-textarea'
    );
    const actions = composerPresent ? hasLastAssistantActions(getCollected()) : false;
    setLastUiSignals({ stop: false, send: false, actions });
    return composerPresent && actions ? 'ready' : 'unknown';
  }

  const FINISHED_ACTION_SELECTOR = [
    'button[data-testid="copy-turn-action-button"]',
    'button[aria-label="Копировать"]',
    'button[aria-label="Copy"]',
    'button[aria-label="Копировать ответ"]',
    'button[aria-label="Copy response"]',
    'button[aria-label="Сгенерировать ответ заново"]',
    'button[aria-label="Regenerate"]',
    'button[aria-label="Regenerate response"]',
    'button[aria-label="Прочитать вслух"]',
    'button[aria-label="Read aloud"]'
  ].join(', ');

  function isFinishedActionNode(node) {
    if (!(node instanceof Element)) return false;
    return node.matches(FINISHED_ACTION_SELECTOR) ||
      !!node.querySelector(FINISHED_ACTION_SELECTOR);
  }

  function hasLastAssistantActions(collected = null) {
    // Reuse a scan snapshot only within the same synchronous DOM event.
    // Never cache it across React remounts or attribute changes.
    const nodes = (collected || collectMessageNodes()).nodes;
    if (!nodes.length) return false;
    const last = nodes[nodes.length - 1];
    if (inferRole(last) !== 'assistant') return false;

    const outer = last.closest?.(
      '[data-testid^="conversation-turn-"], [data-virtualized-turn-content], [data-message-author-role="assistant"]'
    );
    if (outer && outer.querySelector(FINISHED_ACTION_SELECTOR)) return true;

    // Check finished actions following the last assistant content.
    // Require the button to follow the last assistant content in DOM order.
    for (const button of document.querySelectorAll(
      `main ${FINISHED_ACTION_SELECTOR.replaceAll(', ', ', main ')}`
    )) {
      if (last.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) {
        return true;
      }
    }
    return false;
  }

  function rememberCollected(collected) {
    collectorState.name = collected.name;
    collectorState.visible = collected.nodes.length;
    collectorState.raw = collected.rawCount;
    collectorState.collapsed = collected.collapsed;
    collectorState.ambiguous = collected.ambiguousIds.size;
    collectorState.noLayout = collected.noLayout || 0;
  }

export { visibleControl, COMPOSER_CONTROLS, anyVisibleControl, readComposerControlsForDiagnostics, getComposerMode, FINISHED_ACTION_SELECTOR, isFinishedActionNode, hasLastAssistantActions, rememberCollected };
