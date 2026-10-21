import { UUID_ONLY_RE } from '../runtime/01-runtime-configuration.js';
import { inferRole, searchUnitInfo, searchUnitRealMessageId } from './09-dom-unit-identity.js';

  // MUST run before tokenization, so previously committed IDs are write-once.
  function getStructuralMessageId(el, role = inferRole(el)) {
    if (role !== 'user' && role !== 'assistant') return null;
    const info = searchUnitInfo(el);
    if (info) return searchUnitRealMessageId(info.unit);
    // Do not invent a turn-key ID: a turn contains both sides of the dialog.
    const value = el.getAttribute?.('data-message-id');
    const uuid = typeof value === 'string' &&
      value.match(UUID_ONLY_RE);
    return uuid ? `msg:${uuid[0].toLowerCase()}` : null;
  }

  // Shared metadata walk for Audit / Export / Repair / Capture. It never reads
  // text or touches storage; each caller retains its own safety rules.
  function* identifiedMessages(nodes) {
    for (const [index, el] of (nodes || []).entries()) {
      const role = inferRole(el);
      yield { el, index, role, id: getStructuralMessageId(el, role) };
    }
  }

  function structuralMessageIds(nodes) {
    const ids = new Set();
    for (const { id } of identifiedMessages(nodes)) if (id) ids.add(id);
    return ids;
  }


  /** WATCHDOG_CONTRACT: normalize one already-collected DOM snapshot for the
   * image/file/message pipelines. Prefer its event-local UUID/role cache;
   * never parse message text, touch storage or carry entries across routes.
   * @param {WatchdogCollectedMessages} collected
   * @returns {Array<{el: Element, index: number, role: string, id: string|null}>}
   */
  function trustedCollectedMessageId(id, collected) {
    return !!id && !collected.ambiguousIds.has(id);
  }

  function normalizeCollectedMessageEntries(collected) {
    const nodes = collected.nodes;
    return collected.identities
      ? nodes.map((el, index) => ({ el, index, ...collected.identities.get(el) }))
      : [...identifiedMessages(nodes)];
  }

export { getStructuralMessageId, identifiedMessages, structuralMessageIds, trustedCollectedMessageId, normalizeCollectedMessageEntries };
