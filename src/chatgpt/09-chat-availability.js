// Availability is deliberately independent of route UUID and message ledger.
// Branch views may keep hidden standard composers and mount an active generic
// form in a different main. Never rely on the index of a main element.
const CHAT_FORM = 'form[data-chatgpt-composer]';
const CHAT_TEXTBOX = '[contenteditable="true"][role="textbox"]';

function isVisibleChatElement(el) {
  return !!el?.isConnected &&
    !el.closest('[hidden], [inert], [aria-hidden="true"]') &&
    el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility === 'visible';
}

// Availability and file submission must recognize the same visible forms.
function isAvailableChatForm(form) {
  if (!isVisibleChatElement(form)) return false;
  if (form.matches(CHAT_FORM)) return true;
  for (const editor of form.querySelectorAll('#prompt-textarea')) {
    if (isVisibleChatElement(editor)) return true;
  }
  if (!isVisibleChatElement(form.closest('main'))) return false;
  for (const textbox of form.querySelectorAll(CHAT_TEXTBOX)) {
    if (isVisibleChatElement(textbox)) return true;
  }
  return false;
}

function findChatComposerForTarget(node) {
  const form = node?.closest?.('form');
  return isAvailableChatForm(form) ? form : null;
}

function findAvailableChatComposer() {
  for (const main of document.querySelectorAll('main')) {
    if (!isVisibleChatElement(main)) continue;
    for (const form of main.querySelectorAll('form')) {
      if (isAvailableChatForm(form)) return form;
    }
  }
  // A few ChatGPT layouts mount the standard composer adjacent to <main>.
  // Requiring the special attribute avoids treating a generic page form as chat.
  for (const form of document.querySelectorAll(CHAT_FORM)) {
    if (isAvailableChatForm(form)) return form;
  }
  // Historical fallback, but only inside a real visible form.
  for (const editor of document.querySelectorAll('#prompt-textarea')) {
    const form = editor.closest('form');
    if (isVisibleChatElement(editor) && isAvailableChatForm(form)) return form;
  }
  return null;
}

// Fast filter used by a *structural-only* observer. No document-wide selector
// is run for streamed text or unrelated class updates.
function mutationMayChangeChatAvailability(mutation, currentComposer, checkedSubtrees = null) {
  const target = mutation.target;
  if (mutation.type === 'attributes') {
    if (!(target instanceof Element)) return false;
    if (target.matches('main, form, [role="textbox"], [contenteditable]')) return true;
    if (currentComposer) return target.contains(currentComposer);
    // A hidden ancestor can become visible without mounting a new form.
    // All MutationRecords in a callback see the FINAL tree, so inspecting
    // the same ancestor twice cannot produce new information. Cache only
    // within this callback: a cache across batches could miss later remounts.
    if (checkedSubtrees?.has(target)) return checkedSubtrees.get(target);
    const containsCandidate = !!target.querySelector(
      'main, form, [role="textbox"][contenteditable], #prompt-textarea');
    checkedSubtrees?.set(target, containsCandidate);
    return containsCandidate;
  }
  if (mutation.type !== 'childList') return false;
  if (currentComposer && !currentComposer.isConnected) return true;
  for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
    if (!(node instanceof Element)) continue;
    if (node.matches('main, form, [role="textbox"], [contenteditable]') ||
        (node.childElementCount > 0 &&
          node.querySelector('main, form, [role="textbox"][contenteditable]'))) return true;
    if (currentComposer && node.contains(currentComposer)) return true;
  }
  return false;
}

export { findAvailableChatComposer, findChatComposerForTarget, mutationMayChangeChatAvailability,
  isVisibleChatElement };
