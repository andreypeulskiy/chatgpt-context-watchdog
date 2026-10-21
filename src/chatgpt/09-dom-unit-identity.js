import { DOM_SELECTORS, UUID_ANYWHERE_RE } from '../runtime/01-runtime-configuration.js';

  // Role-qualified search units are our primary structural source.
  function searchUnitInfo(el) {
    const unit = el?.closest?.(DOM_SELECTORS.searchUnit) ||
      (el?.matches?.(DOM_SELECTORS.searchUnit) ? el : null);
    if (!unit || !unit.closest?.('main')) return null;
    const key = unit.getAttribute('data-chatgpt-search-unit-key') || '';
    const role = /(?:^|:)(user|assistant)$/i.exec(key)?.[1]?.toLowerCase();
    if (!role) return null;
    return { unit, key, role };
  }

  // Only a single unambiguous UUID is promoted to a true message identity.
  // Some search units contain MULTIPLE message IDs (e.g. progress + final),
  // and treating the first arbitrarily as final would cause duplicate counts.
  function searchUnitRealMessageId(unit) {
    if (!unit) return null;
    const values = [unit.getAttribute('data-chatgpt-search-message-ids')];
    for (const node of unit.querySelectorAll(DOM_SELECTORS.searchMessageIds)) {
      // Nested search units must never leak their UUIDs into the parent.
      if (node.closest(DOM_SELECTORS.searchUnit) === unit) {
        values.push(node.getAttribute('data-chatgpt-search-message-ids'));
      }
    }
    const uuids = new Set();
    for (const value of values) {
      for (const match of String(value).matchAll(UUID_ANYWHERE_RE)) {
        uuids.add(match[0].toLowerCase());
      }
    }
    return uuids.size === 1 ? `msg:${[...uuids][0]}` : null;
  }

  // One identity namespace: real UUID; never synthesize turn-based IDs.
  function inferRole(el) {
    const unit = searchUnitInfo(el);
    if (unit) return unit.role;
    const role = el.getAttribute?.('data-message-author-role') ||
      el.getAttribute?.('data-message-role') ||
      el.closest?.('[data-message-author-role]')?.getAttribute('data-message-author-role') ||
      el.closest?.('[data-message-role]')?.getAttribute('data-message-role');
    return role === 'user' || role === 'assistant' ? role : null;
  }

export { searchUnitInfo, searchUnitRealMessageId, inferRole };
