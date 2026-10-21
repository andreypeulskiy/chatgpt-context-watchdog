import { currentChatKey } from '../runtime/01-runtime-capture-state.js';

  const LOCAL_FILE_SUBMISSION_WINDOW_MS = 2 * 60 * 1000;

  function isActiveSubmittedFile(item, chatKey, now = Date.now()) {
    return !item.used && !!item.submittedAt &&
      now - item.submittedAt >= 0 &&
      now - item.submittedAt <= LOCAL_FILE_SUBMISSION_WINDOW_MS &&
      (item.chatKey === chatKey ||
        (item.chatKey === null && chatKey === currentChatKey));
  }


export { LOCAL_FILE_SUBMISSION_WINDOW_MS, isActiveSubmittedFile };
