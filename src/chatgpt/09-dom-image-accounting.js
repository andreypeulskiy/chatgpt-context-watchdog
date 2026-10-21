import { settings } from '../runtime/01-runtime-capture-state.js';
import { APP } from '../runtime/01-runtime-configuration.js';
import { dirtyImageTurns, inspectedImageTurns, watchedImageNodes, notifyImageRescan } from '../runtime/01-runtime-dom-state.js';
import { resetEpoch } from '../runtime/01-runtime-ledger-state.js';
import { perfEnd, perfStart } from '../runtime/02-profiling.js';
import { hash32 } from './04-text-estimators.js';
import { forEachUserMessage } from '../attachments/05-attachment-scan.js';

  function isLikelyConversationImage(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    if (img.closest(`#${APP}-root`)) return false;

    const src = img.currentSrc || img.getAttribute('src') || '';
    if (!src) return false;

    // Ignore obvious UI icons / avatars. naturalWidth is 0 while lazy-loading,
    // so fall back to rendered/attribute dimensions when available.
    const w =
      img.naturalWidth ||
      img.clientWidth ||
      Number(img.getAttribute('width')) ||
      0;
    const h =
      img.naturalHeight ||
      img.clientHeight ||
      Number(img.getAttribute('height')) ||
      0;

    if (w && h && w < 96 && h < 96) return false;

    const alt = (img.getAttribute('alt') || '').toLowerCase();
    if (/avatar|profile|logo|icon/.test(alt) && w < 160 && h < 160) return false;

    return true;
  }

  // The load event does not produce a MutationObserver record. Listen on
  // individual images (not a global document handler), including icons that
  // might become full-size pictures after lazy loading.
  const USER_IMAGE_TURN_SELECTOR =
    '[data-chatgpt-search-unit-key$=":user"], [data-chatgpt-search-unit-key="user"], ' +
    '[data-message-id][data-message-author-role="user"], ' +
    '[data-message-id][data-message-role="user"]';

  function onDomImageLoad(event) {
    const turn = event.currentTarget?.closest?.(USER_IMAGE_TURN_SELECTOR);
    if (!turn) return;
    dirtyImageTurns.add(turn);
    notifyImageRescan();
  }

  function scanConversationImages(entries, state, inspected = []) {
    const perfStartedAt = perfStart();
    try {
      state.domImages = state.domImages || {};
      let changed = false;

      forEachUserMessage(entries, (turn, messageId) => {
        const epoch = resetEpoch(state.chatKey);
        const prev = inspectedImageTurns.get(turn);
        if (!dirtyImageTurns.has(turn) && prev?.chatKey === state.chatKey &&
            prev.messageId === messageId && prev.epoch === epoch &&
            prev.keys.every(key => state.domImages[key])) {
          // Preserve the original lastSeenAt side effect on a subsequent
          // changed commit without touching the unchanged DOM subtree.
          const now = Date.now();
          for (const key of prev.keys) state.domImages[key].lastSeenAt = now;
          return;
        }
        const imgs = Array.from(turn.querySelectorAll?.('img') || []);
        const keys = [];
        let cacheable = true;

        // Source URLs (including pathname) may change on every ChatGPT reload.
        // Identify an image by its ordinal within a confirmed user message,
        // not by an ephemeral download URL. Multiple pictures in one message
        // remain distinct slots; lazy-loaded dimensions do not affect identity.
        let slot = 0;
        for (const img of imgs) {
          if (img instanceof HTMLImageElement && !watchedImageNodes.has(img)) {
            img.addEventListener?.('load', onDomImageLoad);
            watchedImageNodes.add(img);
          }
          if (!isLikelyConversationImage(img)) continue;
          // Only accounted images can make this turn uncacheable. A broken
          // icon/avatar must not force unrelated user images to be rescanned.
          // An accounted image can gain natural dimensions without a DOM
          // mutation, so keep checking until measured even if load was missed.
          if (!img.naturalWidth || !img.naturalHeight) cacheable = false;
          const w = img.naturalWidth || img.clientWidth || 0;
          const h = img.naturalHeight || img.clientHeight || 0;
          const key = `dom-user-image-slot:${hash32(`${messageId}\n${slot++}`)}`;
          keys.push(key);
          if (!state.domImages[key]) {
            state.domImages[key] = {
              messageId,
              width: w, height: h,
              tokens: Math.max(1, Math.round(settings.averageImageTokens)),
              firstSeenAt: Date.now(), lastSeenAt: Date.now()
            };
            changed = true;
          } else {
            state.domImages[key].lastSeenAt = Date.now();
            if ((!state.domImages[key].width || !state.domImages[key].height) && w && h) {
              state.domImages[key].width = w;
              state.domImages[key].height = h;
              changed = true;
            }
          }
        }
        // Caller marks this inspection durable only after saveState succeeds.
        // Never certify a turn with an image still loading or of unknown size.
        if (cacheable) inspected.push({ turn, messageId, chatKey: state.chatKey, epoch, keys });
      });
      return changed;
    } finally {
      perfEnd('images', perfStartedAt);
    }
  }

  // Images discovered via file input and via the rendered user turn can
  // describe the same upload. Deduplicate within a message UUID, but add
  // images from distinct messages: Math.max(totalCaptured, totalDOM) was
  // incorrect for disjoint sources. Each unbound file retains its own key.
  function effectiveImageStats(state, capturedImages = null) {
    const capturedByMessage = capturedImages?.byMessage || new Map();
    const domByMessage = new Map();
    let captured = capturedImages ? capturedImages.count : 0;
    let historical = 0;
    // Standalone callers retain the original behavior. The forecast caller
    // supplies the capture counts produced by its single traversal of files.
    if (!capturedImages) for (const [key, file] of Object.entries(state.files || {})) {
      if (file?.method !== 'image-average') continue;
      captured++;
      const id = file.messageId || `unbound-file:${key}`;
      capturedByMessage.set(id, (capturedByMessage.get(id) || 0) + 1);
    }
    // Only the established per-message slot key is a supported DOM-image
    // identity. Unknown keys must not inflate an estimate; leave storage
    // untouched so diagnosis/export remains possible.
    for (const [key, image] of Object.entries(state.domImages || {})) {
      if (!key.startsWith('dom-user-image-slot:') || !image) continue;
      historical++;
      const id = image.messageId || `unbound-dom:${key}`;
      domByMessage.set(id, (domByMessage.get(id) || 0) + 1);
    }
    let effective = 0;
    for (const id of new Set([...capturedByMessage.keys(), ...domByMessage.keys()])) {
      effective += Math.max(capturedByMessage.get(id) || 0, domByMessage.get(id) || 0);
    }
    return {
      captured, historical, effective,
      tokens: effective * settings.averageImageTokens
    };
  }

export { isLikelyConversationImage, scanConversationImages, effectiveImageStats };
