import { completedRevisions, revisionGeneration, revisionTargets, setRevisionGeneration } from '../runtime/01-runtime-capture-state.js';
import { APP } from '../runtime/01-runtime-configuration.js';
import { isWatchdogPaused } from '../runtime/01-runtime-pause-state.js';
import { collectMessageNodes } from './09-dom-collection.js';
import { identifiedMessages } from './09-dom-message-identity.js';

  function markRevisionFromClick(event) {
    if (isWatchdogPaused()) return;
    const button = event.target?.closest?.('button, [role="button"]');
    if (!button || button.closest?.(`#${APP}-root`)) return;
    const label = (button.getAttribute('aria-label') ||
      button.getAttribute('title') || button.textContent || '').trim();
    if (/^(?:cancel|отмена)(?:\s|$)/i.test(label)) {
      revisionTargets.clear();
      completedRevisions.clear();
      return;
    }
    if (!/^(?:edit(?:\s+message)?|редактировать(?:\s+сообщение)?|regenerate(?:\s+(?:response|answer))?|сгенерировать\s+ответ\s+заново)(?:\s|$)/i.test(label)) {
      return;
    }
    // Editing/regenerating is an explicit exception to write-once storage.
    // Only the affected message (and the final assistant reply) may change.
    const entries = [...identifiedMessages(collectMessageNodes().nodes)];
    const actionTurn = button.closest?.(
      '[data-message-id], [data-turn-key], [data-testid^="conversation-turn-"]'
    );
    const matched = actionTurn && entries.find(({ el }) =>
      actionTurn.contains(el) || el.contains(actionTurn)
    );
    const lastAssistant = entries.findLast(({ role }) => role === 'assistant');
    const targets = new Set([matched?.id, lastAssistant?.id].filter(Boolean));
    if (!targets.size) return;
    const generation = setRevisionGeneration(revisionGeneration+1);
    for (const id of targets) {
      revisionTargets.set(id, generation);
      completedRevisions.delete(id);
    }
  }

export { markRevisionFromClick };
