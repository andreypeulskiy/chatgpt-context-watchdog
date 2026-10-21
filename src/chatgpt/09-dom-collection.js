import { DOM_SELECTORS } from '../runtime/01-runtime-configuration.js';
import { perfEnd, perfStart } from '../runtime/02-profiling.js';
import { getStructuralMessageId } from './09-dom-message-identity.js';
import { inferRole, searchUnitInfo, searchUnitRealMessageId } from './09-dom-unit-identity.js';

  // A keyed turn can contain one user bubble and several assistant MarkdownRoots.
  // Collect both as separate role-specific messages; group only same-role roots.
  function domDocumentOrder(a, b) {
    if (a === b) return 0;
    const relation = a.compareDocumentPosition(b);
    return relation & Node.DOCUMENT_POSITION_FOLLOWING ? -1 :
      relation & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
  }

  // React can retain outgoing-chat search units in the DOM after navigation.
  // They may have neither [hidden] nor aria-hidden, but have a ZERO layout box.
  // They must not block route verification and, more importantly, must never
  // enter the message/file/image backfill for the destination chat.
  // A nonzero layout box may be outside the viewport due to scrolling; it is
  // still eligible. We do not require viewport intersection.
  function hasMountedMessageLayout(el) {
    if (!el?.isConnected || el.closest?.('[hidden], [inert], [aria-hidden="true"]')) return false;
    const rect = el.getBoundingClientRect?.();
    return !!rect && rect.width > 0 && rect.height > 0;
  }

  // Never climb into an unkeyed general conversation wrapper.
  /** WATCHDOG_CONTRACT: DOM-only scan; cannot infer identities for missing UUIDs.
   * @returns {WatchdogCollectedMessages & {name: string}}
   */
  function collectMessageNodes() {
    const perfStartedAt = perfStart();
    try {
      // Search-unit elements expose role and real message ID. No full-turn text
      // is selected, so the user and assistant cannot contaminate each other.
      // Selector already guarantees the element is inside main and is itself
      // a search unit; avoid the redundant closest('main')/closest(unit) calls.
      const units = [...document.querySelectorAll(`main ${DOM_SELECTORS.searchUnit}`)]
        .filter(el => /(?:^|:)(?:user|assistant)$/i.test(
          el.getAttribute('data-chatgpt-search-unit-key') || ''));
      const raw = units.filter(hasMountedMessageLayout);
      let noLayout = units.length - raw.length;
      if (!raw.length) {
        // Hidden/stale search units cannot suppress visible legacy wrappers.
        // Only a real-ID + explicit-role wrapper is trusted in older layouts.
        const alternatives = [...document.querySelectorAll(
          'main [data-message-id][data-message-author-role], ' +
          'main [data-message-id][data-message-role]'
        )];
        raw.push(...alternatives.filter(hasMountedMessageLayout));
        noLayout += alternatives.length - raw.length;
      }
      const seenNodes = new Set(), seenIds = new Map(), ambiguousIds = new Set();
      // Event-local identities avoid a second DOM UUID walk during capture.
      const identities = new WeakMap();
      const nodes = [];
      for (const el of raw) {
        if (seenNodes.has(el)) continue;
        seenNodes.add(el);
        // A collected search unit already provides its own role and UUID
        // scope. Avoid re-running searchUnitInfo in inferRole + ID extraction.
        const info = el.hasAttribute('data-chatgpt-search-unit-key')
          ? searchUnitInfo(el) : null;
        const role = info?.role || inferRole(el);
        if (!role) continue;
        const id = info ? searchUnitRealMessageId(el) : getStructuralMessageId(el, role);
        if (!id) {
          identities.set(el, { role, id: null });
          nodes.push(el); // read-only audit can report the missing UUID
          continue;
        }
        const prior = seenIds.get(id);
        if (prior) {
          // Duplicate views are ignored; disjoint copies are ambiguous, not saved.
          if (!prior.contains(el) && !el.contains(prior)) ambiguousIds.add(id);
          continue;
        }
        seenIds.set(id, el);
        identities.set(el, { role, id });
        nodes.push(el);
      }
      nodes.sort(domDocumentOrder);
      return {
        name: raw.length ? (raw[0].hasAttribute('data-chatgpt-search-unit-key')
          ? 'search-units' : 'message-id') : 'no-message-ids',
        nodes, identities, rawCount: raw.length, noLayout,
        collapsed: raw.length - nodes.length, ambiguousIds
      };
    } finally {
      perfEnd('collect', perfStartedAt);
    }
  }

export { domDocumentOrder, hasMountedMessageLayout, collectMessageNodes };
