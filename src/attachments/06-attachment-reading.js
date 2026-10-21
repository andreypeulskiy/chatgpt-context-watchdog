import { currentChatKey, settings } from '../runtime/01-runtime-capture-state.js';
import { isWatchdogPaused } from '../runtime/01-runtime-pause-state.js';
import { MAX_LOCAL_FILE_MIB, RECOMMENDED_LOCAL_FILE_MIB } from '../runtime/01-runtime-configuration.js';
import { corruptLedgerKeys, ledgerResetEpochs, pendingFileResults, resetEpoch, storageFailures, setStorageWarningShown } from '../runtime/01-runtime-ledger-state.js';
import { pendingLocalFiles } from '../runtime/01-runtime-ui-state.js';
import { saveState } from '../storage/03-ledger-commit.js';
import { loadState } from '../storage/03-ledger-repository.js';
import { estimateProseTokens, hash32 } from '../chatgpt/04-text-estimators.js';
import { fileSizesCompatible, getFileExt, getFileKey, isImageFile, isTextLikeExt, normalizeFileName } from './05-attachment-helpers.js';
import { collectMessageNodes } from '../chatgpt/09-dom-collection.js';
import { COMPOSER_CONTROLS } from '../chatgpt/09-dom-composer-state.js';
import { findChatComposerForTarget, isVisibleChatElement } from '../chatgpt/09-chat-availability.js';
import { structuralMessageIds } from '../chatgpt/09-dom-message-identity.js';
import { render } from '../ui/16-panel-rendering.js';
import { LOCAL_FILE_SUBMISSION_WINDOW_MS, isActiveSubmittedFile } from './05-attachment-submission.js';

  async function estimateFileTokens(file, canContinue = () => true) {
    const ext = getFileExt(file.name);

    if (isImageFile(file)) {
      return {
        tokens: Math.max(1, Math.round(settings.averageImageTokens)),
        method: 'image-average',
        detail: `${Math.round(file.size / 1024)} KiB`
      };
    }

    if (isTextLikeExt(ext) || (file.type || '').startsWith('text/')) {
      // The limit matters only when we actually read local content.
      const parsingLimitMiB = Math.min(MAX_LOCAL_FILE_MIB,
        Math.max(0, Number(settings.localFileParsingLimitMiB ?? RECOMMENDED_LOCAL_FILE_MIB)));
      if (parsingLimitMiB === 0 || file.size > parsingLimitMiB * 1024 * 1024) {
        return { tokens: 0, method: 'too-large', metadataOnly: true,
          detail: `>${parsingLimitMiB} MiB local limit` };
      }
      // P1: For large local text files, bound both decoding and the synchronous
      // token estimator to the first 10 MiB; scale by byte density afterwards.
      // For files up to the sample size preserve the previous exact behavior.
      const sampleBytes = 10 * 1024 * 1024;
      if (file.size <= sampleBytes) {
        const text = await file.text();
        if (!canContinue()) return null;
        return { tokens: estimateProseTokens(text), method: 'text' };
      }
      const bytes = await file.slice(0, sampleBytes).arrayBuffer();
      if (!canContinue()) return null;
      // Streaming decode with no final flush avoids inventing a replacement
      // character if the byte slice ends mid-UTF-8 codepoint.
      const sample = new TextDecoder('utf-8').decode(bytes, { stream: true });
      const observed = bytes.byteLength;
      if (!observed) return { tokens: 0, method: 'text-extrapolated',
        detail: 'Empty text sample' };
      const sampleTokens = estimateProseTokens(sample);
      const estimated = Math.max(0, Math.round(sampleTokens * file.size / observed));
      return { tokens: estimated, method: 'text-extrapolated',
        detail: `First 10 MiB sampled; ${Math.round(file.size / (1024 * 1024))} MiB total (estimated)` };
    }

    // No Office/ZIP extraction. Bytes describe the file, not exact context.
    return {
      tokens: 0, metadataOnly: true, method: 'metadata-size',
      detail: `${Math.round(file.size / 1024)} KiB`
    };
  }

  const LOCAL_FILE_SELECTION_WINDOW_MS = 15 * 60 * 1000;
  // Only in RAM. File references are discarded at Wipe/reset and never
  // serialized. They can be safely resumed after a suspended async read.
  const pausedFileJobs = new Map();
  function cancelPausedFileJobs(chatKey = null) {
    for (const [key, job] of pausedFileJobs) {
      if (chatKey === null || job.chatKey === chatKey) pausedFileJobs.delete(key);
    }
  }
  function resumePausedFileJobs() {
    if (isWatchdogPaused()) return;
    for (const [key, job] of pausedFileJobs) {
      if (resetEpoch(job.chatKey) !== job.epoch || corruptLedgerKeys.has(job.chatKey)) {
        pausedFileJobs.delete(key);
        continue;
      }
      const reading = loadState(job.chatKey).files[job.fileKey];
      if (!reading || reading.status !== 'reading' || reading.messageId !== job.messageId ||
          reading.name !== job.file.name || reading.size !== job.file.size) {
        pausedFileJobs.delete(key);
        continue;
      }
      // Keep the File available for retry until the reading commit succeeds.
      // An already prepared result never requires a second file read.
      Promise.resolve(rememberSentFile(job.file, job.source, job.chatKey,
        job.messageId, committed => {
          if (committed && pausedFileJobs.get(key) === job) pausedFileJobs.delete(key);
        }, job.result)).catch(() => {
          console.warn('[Context Watchdog] deferred file resumption failed');
        });
    }
  }


  // Only a composer attachment card is evidence that the selected file was
  // still in the draft at submission. The editor text is not evidence.
  function hasFileCard(scope, expected, composer = null) {
    for (const node of scope.querySelectorAll(
      '[title], [aria-label], [data-testid*="attachment"], [data-testid*="file"]')) {
      if (!isVisibleChatElement(node)) continue;
      if (node.closest?.('[contenteditable="true"], textarea')) continue;
      // Cards in a different form cannot confirm this composer's draft.
      if (composer && node.closest?.('form') && node.closest('form') !== composer) continue;
      const labels = [node.getAttribute('title'), node.getAttribute('aria-label'),
        node.textContent?.length <= 180 ? node.textContent : ''];
      if (labels.some(label => normalizeFileName(label) === expected)) return true;
    }
    return false;
  }

  // A file chip can be mounted beside (not inside) the composer form. Only
  // its OWN visible #composer-background may serve as the legacy fallback.
  // This never classifies a page as a chat or bypasses UUID/epoch checks.
  function composerContainsFile(composer, filename) {
    const expected = normalizeFileName(filename);
    if (!expected || !isVisibleChatElement(composer)) return false;
    if (hasFileCard(composer, expected)) return true;
    const background = composer.closest('#composer-background');
    return !!background && isVisibleChatElement(background) &&
      hasFileCard(background, expected, composer);
  }

  function submittedLocalFiles(composer) {
    if (isWatchdogPaused()) return;
    const now = Date.now();
    for (let i = pendingLocalFiles.length - 1; i >= 0; i--) {
      const item = pendingLocalFiles[i];
      if (item.used || item.chatKey !== currentChatKey ||
          now - item.selectedAt > LOCAL_FILE_SELECTION_WINDOW_MS ||
          now - item.selectedAt < 0) {
        pendingLocalFiles.splice(i, 1);
        continue;
      }
      // After a canceled upload, the card is no longer in the composer.
      if (!composerContainsFile(composer, item.file.name)) {
        pendingLocalFiles.splice(i, 1);
        continue;
      }
      item.submittedAt = now;
    }
  }

  // Browser file inputs represent a *draft*, not a sent message. Keep File
  // objects in RAM and wait for a confirmed user message UUID with a card.
  function stageLocalFile(file, source) {
    if (isWatchdogPaused()) return;
    if (!file?.name) return;
    const chatKey = currentChatKey;
    const identity = `${getFileKey(file)}|${chatKey || 'new-chat'}`;
    if (pendingLocalFiles.some(p => p.identity === identity && !p.used)) return;
    // A newly selected draft must never attach to an already-present user
    // UUID just because a historical card has the same filename and size.
    // Include both persisted messages and mounted but not yet saved UUIDs.
    const existingMessageIds = new Set(Object.keys(loadState(chatKey).messages));
    for (const id of structuralMessageIds(collectMessageNodes().nodes)) {
      existingMessageIds.add(id);
    }
    pendingLocalFiles.push({
      file, source, chatKey, identity, used: false, existingMessageIds,
      selectedAt: Date.now(), submittedAt: 0,
      boundMessageId: null, boundEpoch: null
    });
    // Bounded memory; no timers and no persistent draft attachment records.
    while (pendingLocalFiles.length > 16) pendingLocalFiles.shift();
  }

  // Retry a completed estimate's *storage write*, never the file read.
  // A separate queue survives unrelated successful ledger saves.
  function retryPendingFileResults(chatKey) {
    if (isWatchdogPaused()) return;
    for (const [jobKey, job] of pendingFileResults) {
      if (job.chatKey !== chatKey) continue;
      if (resetEpoch(chatKey) !== job.epoch || corruptLedgerKeys.has(chatKey)) {
        pendingFileResults.delete(jobKey);
        continue;
      }
      const latest = loadState(chatKey);
      const reading = latest.files[job.fileKey];
      if (!reading || reading.status !== 'reading' ||
          reading.messageId !== job.messageId ||
          reading.name !== job.name || reading.size !== job.size) {
        pendingFileResults.delete(jobKey);
        continue;
      }
      latest.files[job.fileKey] = { ...reading, ...job.result };
      if (saveState(latest)) {
        pendingFileResults.delete(jobKey);
        if (![...pendingFileResults.values()].some(item => item.chatKey === chatKey)) {
          storageFailures.delete(chatKey);
          setStorageWarningShown(false);
        }
        if (currentChatKey === chatKey) render(latest);
      }
    }
  }

  // Called only after a DOM file card has an unambiguous user message UUID.
  // The captured chatKey, never the live global, owns the async result.
  async function rememberSentFile(file, source, chatKey, messageId, onReadingCommitted = () => {}, preparedResult = null) {
    if (isWatchdogPaused()) { onReadingCommitted(false); return; }
    if (!file?.name || !chatKey || !messageId) {
      onReadingCommitted(false);
      return;
    }
    const key = `sent-file:${hash32(`${messageId}|${getFileKey(file)}`)}`;
    const state = loadState(chatKey);
    if (corruptLedgerKeys.has(chatKey)) { onReadingCommitted(false); return; }
    const candidates = Object.keys(state.files).filter(k => {
      const entry = state.files[k];
      return entry?.messageId === messageId && entry?.metadataOnly &&
        normalizeFileName(entry.name) === normalizeFileName(file.name) &&
        fileSizesCompatible(entry.size, file.size);
    });
    // A filename/size match alone is ambiguous when there are two same-name
    // files in one message: do not arbitrarily remove one of them.
    const candidateKey = candidates.length === 1 ? candidates[0] : null;
    const prior = candidateKey && candidateKey !== key ? state.files[candidateKey] : {};
    const previous = { ...prior, ...(state.files[key] || {}) };
    if (previous.status === 'ready' && !previous.metadataOnly) { onReadingCommitted(true); return; }
    if (candidateKey && candidateKey !== key) delete state.files[candidateKey];
    state.files[key] = {
      ...previous, name: file.name, size: file.size,
      type: file.type || '', lastModified: file.lastModified || 0,
      source, messageId, metadataOnly: false, method: '',
      status: 'reading', tokens: previous.tokens || 0,
      addedAt: previous.addedAt || Date.now(), lastSeenAt: Date.now()
    };
    if (!saveState(state)) {
      onReadingCommitted(false);
      if (currentChatKey === chatKey) render(loadState());
      return;
    }
    onReadingCommitted(true);
    if (currentChatKey === chatKey) render(state);
    const startedEpoch = resetEpoch(chatKey);
    ledgerResetEpochs.set(chatKey, startedEpoch); // include background chats in cross-tab clear invalidation
    const stillReading = latest => resetEpoch(chatKey) === startedEpoch &&
      latest.files[key]?.status === 'reading';

    try {
      const result = preparedResult || await estimateFileTokens(file,
        () => !isWatchdogPaused() && resetEpoch(chatKey) === startedEpoch);
      if (resetEpoch(chatKey) !== startedEpoch) return;
      if (isWatchdogPaused() || result === null) {
        pausedFileJobs.set(`${chatKey}|${key}`, {
          file, fileKey: key, source, chatKey, messageId, epoch: startedEpoch, result
        });
        return;
      }
      const latest = loadState(chatKey); // NEVER load the chat now in the URL.
      if (corruptLedgerKeys.has(chatKey) || !stillReading(latest)) return;
      latest.files[key] = {
        ...(latest.files[key] || state.files[key]),
        tokens: Number(result.tokens) || 0,
        method: result.method || 'unknown', detail: result.detail || '',
        metadataOnly: Boolean(result.metadataOnly),
        status: result.method === 'error' ? 'error' : 'ready', lastSeenAt: Date.now()
      };
      const resultEntry = { ...latest.files[key] };
      if (saveState(latest)) {
        if (currentChatKey === chatKey) render(latest);
      } else if (resetEpoch(chatKey) === startedEpoch) {
        pendingFileResults.set(`${chatKey}|${key}`, {
          chatKey, fileKey: key, messageId, name: file.name, size: file.size,
          epoch: startedEpoch, result: resultEntry
        });
      }
    } catch (err) {
      if (resetEpoch(chatKey) !== startedEpoch) return;
      if (isWatchdogPaused()) {
        pausedFileJobs.set(`${chatKey}|${key}`, {
          file, fileKey: key, source, chatKey, messageId, epoch: startedEpoch,
          result: { tokens: 0, method: 'error', detail: 'Local file estimation failed',
            metadataOnly: false }
        });
        return;
      }
      const latest = loadState(chatKey);
      if (corruptLedgerKeys.has(chatKey) || !stillReading(latest)) return;
      latest.files[key] = {
        ...(latest.files[key] || state.files[key]), status: 'error',
        method: 'error', detail: 'Local file estimation failed', lastSeenAt: Date.now()
      };
      const errorEntry = { ...latest.files[key] };
      if (saveState(latest)) {
        if (currentChatKey === chatKey) render(latest);
      } else if (resetEpoch(chatKey) === startedEpoch) {
        pendingFileResults.set(`${chatKey}|${key}`, {
          chatKey, fileKey: key, messageId, name: file.name, size: file.size,
          epoch: startedEpoch, result: errorEntry
        });
      }
      console.warn('[Context Watchdog] local file estimate failed');
    }
  }

  function handleFiles(files, source) {
    for (const file of Array.from(files || [])) stageLocalFile(file, source);
  }

  function installFileWatchers() {
    // Capture before React removes the composer attachment chips. No polling.
    const composerOf = findChatComposerForTarget;
    document.addEventListener('click', event => {
      const button = event.target?.closest?.(COMPOSER_CONTROLS.send);
      if (button && !button.disabled) {
        const composer = composerOf(button);
        if (composer) submittedLocalFiles(composer);
      }
    }, true);
    document.addEventListener('submit', event => {
      const composer = composerOf(event.target);
      if (composer) submittedLocalFiles(composer);
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.repeat) return;
      const target = event.target;
      if (!target?.closest?.('#prompt-textarea, [contenteditable="true"]')) return;
      const composer = composerOf(target);
      if (composer) submittedLocalFiles(composer);
    }, true);
    document.addEventListener('change', (event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.type === 'file' && input.files?.length)
        handleFiles(input.files, 'file-input');
    }, true);
    document.addEventListener('drop', (event) => {
      if (event.dataTransfer?.files?.length) handleFiles(event.dataTransfer.files, 'drop');
    }, true);
    document.addEventListener('paste', (event) => {
      if (event.clipboardData?.files?.length) handleFiles(event.clipboardData.files, 'paste');
    }, true);
  }

export { retryPendingFileResults, resumePausedFileJobs, cancelPausedFileJobs, estimateFileTokens, LOCAL_FILE_SUBMISSION_WINDOW_MS, LOCAL_FILE_SELECTION_WINDOW_MS, isActiveSubmittedFile, composerContainsFile, submittedLocalFiles, stageLocalFile, rememberSentFile, handleFiles, installFileWatchers };
