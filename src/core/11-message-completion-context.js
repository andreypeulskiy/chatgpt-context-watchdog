  /** WATCHDOG_CONTRACT: event-local completion evidence. No DOM or storage IO.
   * An explicit completion can certify only the final assistant in the scan;
   * older assistants require their own hydration/finality evidence.
   */
  function captureCompletionContext(entries) {
    const laterUser = new Array(entries.length).fill(false);
    let foundUser = false, lastAssistantIndex = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
      laterUser[i] = foundUser;
      if (entries[i].role === 'user') foundUser = true;
      if (lastAssistantIndex < 0 && entries[i].role === 'assistant') lastAssistantIndex = i;
    }
    return { laterUser, lastAssistantIndex };
  }

export { captureCompletionContext };
