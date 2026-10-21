import { currentChatKey } from '../runtime/01-runtime-capture-state.js';
import { runtime } from '../runtime/01-runtime-session-state.js';
import { changeChatKey } from './11-chat-transition.js';
import { getChatKey } from '../storage/03-ledger-foundation.js';
import { loadState } from '../storage/03-ledger-repository.js';
import { collectMessageNodes } from '../chatgpt/09-dom-collection.js';
import { identifiedMessages } from '../chatgpt/09-dom-message-identity.js';
import { render } from '../ui/16-panel-rendering.js';
import { setSessionPhase, startRouteTransition } from './11-route-inspection.js';

  // Snapshot UUIDs rather than DOM elements. No text reads or retained DOM
  // references while a SPA transition is pending.
  /** WATCHDOG_CONTRACT: capture identities before SPA navigation without retaining nodes.
   * @returns {{beforeIds: Set<string>, beforeNodes: WeakMap<Element, string|null>}}
   */
  function snapshotRouteDom() {
    const beforeIds = new Set();
    // Weak keys let React-discarded nodes be collected during a long route.
    // A node being reused with a DIFFERENT UUID is a real identity change.
    const beforeNodes = new WeakMap();
    for (const { el, id } of identifiedMessages(collectMessageNodes().nodes)) {
      beforeNodes.set(el, id || null);
      if (id) beforeIds.add(id);
    }
    return { beforeIds, beforeNodes };
  }

  /** WATCHDOG_CONTRACT: confirm only with positive destination evidence; never a time-based unlock.
   * @param {WatchdogCollectedMessages|null} [collected]
   * @returns {boolean}
   */
  function routeDomHasChanged(collected = null) {
    if (!runtime.route) return true;
    const { beforeIds, beforeNodes, outgoingKnownIds } = runtime.route;
    const nodes = (collected || collectMessageNodes()).nodes;
    const currentIds = new Set();
    let outgoingMounted = 0;
    for (const { el, id } of identifiedMessages(nodes)) {
      if (id) currentIds.add(id);
      if (beforeNodes.has(el) && beforeNodes.get(el) === (id || null)) outgoingMounted++;
    }
    const destinationMessages = loadState().messages;
    let destinationKnown = 0;
    let outgoingOnly = 0;
    let shared = 0;
    for (const id of currentIds) {
      const inDestination = !!destinationMessages[id];
      const inOutgoing = !!outgoingKnownIds?.has(id);
      if (inDestination) destinationKnown++;
      if (inOutgoing && inDestination) shared++;
      else if (inOutgoing) outgoingOnly++;
    }
    const checkpoint = reason => {
      runtime.route.gate = { reason, visible: currentIds.size,
        destinationKnown, outgoingOnly, outgoingMounted, shared };
      return reason === 'confirmed';
    };
    if (!currentIds.size) return checkpoint('awaiting DOM UUIDs');
    // Never confirm merely because outgoing history exists. A previously
    // unknown outgoing message can remain mounted during SPA navigation.
    if (outgoingOnly) return checkpoint('outgoing-only IDs still visible');
    if (outgoingMounted) return checkpoint('outgoing DOM nodes still mounted');
    // Destination-known UUIDs are positive proof only once outgoing elements
    // are gone. For new chats, a fresh UUID not seen before route is enough.
    if (destinationKnown) return checkpoint('confirmed');
    if ([...currentIds].some(id => !beforeIds.has(id) && !outgoingKnownIds?.has(id))) {
      return checkpoint('confirmed');
    }
    return checkpoint('waiting for fresh destination UUIDs');
  }

  function synchronizeChatRoute() {
    const next = getChatKey();
    if (next === currentChatKey) return false;
    // / -> /c/UUID promotes the same new conversation, not an unrelated one.
    const promotingNewChat = !currentChatKey && !!next;
    const keepCompletion = promotingNewChat && runtime.work.completion;
    const beforeSnapshot = promotingNewChat ? null : snapshotRouteDom();
    const outgoingKnownIds = !promotingNewChat && currentChatKey
      ? new Set(Object.keys(loadState(currentChatKey).messages || {})) : null;
    if (!changeChatKey(next)) return false;
    startRouteTransition(beforeSnapshot, outgoingKnownIds, keepCompletion);
    render(loadState());
    return true;
  }


  function routeVerifiedOrWait(collected = null) {
    if (runtime.route && !routeDomHasChanged(collected)) {
      // Missing DOM UUIDs are a visibility limitation, not a permanently
      // locked route. Keep observing future DOM events and resume when real
      // IDs arrive. Never promote unknown IDs or an expired timeout.
      if (setSessionPhase(runtime.route.gate?.visible ? 'switching' : 'awaiting-uuid'))
        render(loadState());
      return false;
    }
    return true;
  }


export { snapshotRouteDom, routeDomHasChanged, synchronizeChatRoute, routeVerifiedOrWait };
