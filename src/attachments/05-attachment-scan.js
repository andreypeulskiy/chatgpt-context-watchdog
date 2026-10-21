import { isWatchdogPaused } from '../runtime/01-runtime-pause-state.js';
import { APP } from '../runtime/01-runtime-configuration.js';
import { dirtyFileTurns, inspectedFileTurns } from '../runtime/01-runtime-dom-state.js';
import { corruptLedgerKeys, resetEpoch } from '../runtime/01-runtime-ledger-state.js';
import { pendingLocalFiles } from '../runtime/01-runtime-ui-state.js';
import { perfEnd, perfStart } from '../runtime/02-profiling.js';
import { loadState } from '../storage/03-ledger-repository.js';
import { hash32 } from '../chatgpt/04-text-estimators.js';
import { fileSizesCompatible, isAutoPasteName, normalizeFileName } from './05-attachment-helpers.js';
import { fileMetadataFromElement } from './05-react-metadata.js';
import { isActiveSubmittedFile } from './05-attachment-submission.js';

  // Share one role/UUID pass across message, file and image capture.
  function forEachUserMessage(entries, visit) {
    for (const { el, role, id } of entries) {
      if (role === 'user' && id) visit(el, id);
    }
  }

  // Link only composer-confirmed files to an unambiguous, newly mounted user
  // UUID. This is RAM-only and safe while the assistant is still generating.
  function bindSubmittedFilesToMessage(entries, chatKey) {
    if (!pendingLocalFiles.some(item => isActiveSubmittedFile(item, chatKey) &&
        !item.boundMessageId)) return;
    const latest = entries.filter(({ role, id }) => role === 'user' && id).at(-1);
    if (!latest) return;
    const { el: turn, id: messageId } = latest;
    const candidates = pendingLocalFiles.filter(item =>
      !item.boundMessageId && isActiveSubmittedFile(item, chatKey) &&
      !item.existingMessageIds.has(messageId));
    if (!candidates.length) return;
    for (const element of turn.querySelectorAll?.(
      'a[download], a[href], button, [role="button"], [data-testid*="file"]'
    ) || []) {
      if (element.closest?.(`#${APP}-root`)) continue;
      const meta = fileMetadataFromElement(element, turn);
      if (!meta) continue;
      const item = candidates.find(file =>
        !file.boundMessageId &&
        normalizeFileName(file.file.name) === normalizeFileName(meta.name) &&
        fileSizesCompatible(file.file.size, meta.size));
      if (!item) continue;
      item.boundMessageId = messageId;
      item.boundEpoch = resetEpoch(chatKey);
    }
  }

  function submittedFileMatchesMessage(item, chatKey, messageId) {
    if (item.used || item.readingLaunchPending || !messageId) return false;
    if (item.boundMessageId) {
      return item.chatKey === chatKey && item.boundMessageId === messageId &&
        item.boundEpoch === resetEpoch(chatKey);
    }
    return isActiveSubmittedFile(item, chatKey) &&
      !item.existingMessageIds.has(messageId);
  }

  function scanConversationFiles(entries, state) {
    const perfStartedAt = perfStart();
    try {
      state.files = state.files || {};
      // The same first-seen UUID may arrive just as generation completes.
      bindSubmittedFilesToMessage(entries, state.chatKey);
      const inspected = [];
      // A locally selected file may need association with an already-mounted card.
      // Never skip that association, even without a new MutationObserver record.
      const hasPendingFiles = pendingLocalFiles.some(p =>
        !p.used && (p.boundMessageId
          ? p.chatKey === state.chatKey && p.boundEpoch === resetEpoch(state.chatKey)
          : isActiveSubmittedFile(p, state.chatKey)));
      forEachUserMessage(entries, (turn, messageId) => {
        if (!hasPendingFiles && !dirtyFileTurns.has(turn) &&
            inspectedFileTurns.get(turn) === `${state.chatKey}|${messageId}`) return;
        inspected.push({ turn, messageId });
      });
      // No changes to user cards since the last successful inspection: skip even
      // the file-name index, which can be sizeable in attachment-heavy chats.
      if (!inspected.length) return { changed: false, inspected, jobs: [] };
      const seenThisScan = new Set();
      const jobs = [];
      const scheduledFiles = new Set();
      // A sent draft can only belong to the latest user message in this
      // collection, not to newly revealed old history with the same card.
      const latestUserId = entries.filter(entry => entry.role === 'user' && entry.id)
        .at(-1)?.id || null;
      // Name index removes a full file-ledger traversal for each DOM card.
      const filesByName = new Map();
      for (const [key, file] of Object.entries(state.files)) {
        const name = normalizeFileName(file?.name);
        if (!filesByName.has(name)) filesByName.set(name, []);
        filesByName.get(name).push([key, file]);
      }
      let changed = false;

      for (const { turn, messageId } of inspected) {
        const candidates = Array.from(
          turn.querySelectorAll?.(
            'a[download], a[href], button, [role="button"], [data-testid*="file"]'
          ) || []
        );

        for (const element of candidates) {
          if (element.closest?.(`#${APP}-root`)) continue;
          const meta = fileMetadataFromElement(element, turn);
          if (!meta) continue;

          const autoPaste = isAutoPasteName(meta.name);
          // Only a *sent* user message can promote a locally selected file.
          const staged = pendingLocalFiles.find(p =>
            submittedFileMatchesMessage(p, state.chatKey, messageId) &&
            messageId === latestUserId &&
            normalizeFileName(p.file.name) === normalizeFileName(meta.name) &&
            fileSizesCompatible(p.file.size, meta.size));
          if (staged && state.chatKey && !corruptLedgerKeys.has(state.chatKey) &&
              !scheduledFiles.has(staged)) {
            // RC-2: do not consume the File or launch asynchronous reading
            // until the corresponding metadata has been durably committed.
            scheduledFiles.add(staged);
            jobs.push({ staged, chatKey: state.chatKey, messageId,
              epoch: resetEpoch(state.chatKey) });
          }
          const signature = `${messageId}|${meta.fileId || normalizeFileName(meta.name)}|${meta.size || 0}`;
          if (seenThisScan.has(signature)) continue;
          seenThisScan.add(signature);

          const normalizedName = normalizeFileName(meta.name);
          const matches = filesByName.get(normalizedName) || [];
          const existingKey = matches.find(([, file]) => {
            if (file.fileId && meta.fileId && file.fileId !== meta.fileId) return false;
            // A message can contain multiple same-name files. Message UUID
            // alone never proves file identity when their sizes disagree.
            if (file.messageId === messageId) {
              if (file.size && meta.size &&
                  file.metadataSource === 'react-props' &&
                  meta.metadataSource === 'react-props' &&
                  file.size !== meta.size) return false;
              if (!fileSizesCompatible(file.size, meta.size)) return false;
              return true;
            }
            // A user-selected local file becomes a card after sending.
            return !file.messageId && ['file-input', 'drop', 'paste'].includes(file.source) &&
              fileSizesCompatible(file.size, meta.size);
          })?.[0];
          if (existingKey) {
            const existing = state.files[existingKey];
            if (!existing.size && meta.size) { existing.size = meta.size; changed = true; }
            if (!existing.type && meta.type) { existing.type = meta.type; changed = true; }
            if (!existing.fileId && meta.fileId) { existing.fileId = meta.fileId; changed = true; }
            if (!existing.durationSeconds && meta.durationSeconds) {
              existing.durationSeconds = meta.durationSeconds; changed = true;
            }
            if (meta.metadataSource && existing.metadataSource !== meta.metadataSource) {
              existing.metadataSource = meta.metadataSource; changed = true;
            }
            if (existing.messageId !== messageId) { existing.messageId = messageId; changed = true; }
            if (autoPaste && !existing.autoPaste) { existing.autoPaste = true; changed = true; }
            if (!existing.historySeenAt) { existing.historySeenAt = Date.now(); changed = true; }
            continue;
          }

          const key = `dom-user-file:${hash32(signature)}`;
          if (!state.files[key]) {
            state.files[key] = {
              name: meta.name,
              size: meta.size || 0,
              type: meta.type || '',
              source: 'dom-history',
              messageId,
              ...(meta.fileId ? { fileId: meta.fileId } : {}),
              ...(meta.durationSeconds ? { durationSeconds: meta.durationSeconds } : {}),
              ...(meta.metadataSource ? { metadataSource: meta.metadataSource } : {}),
              ...(autoPaste ? { autoPaste: true } : {}),
              method: 'metadata-size',
              metadataOnly: true,
              status: 'ready',
              tokens: 0,
              addedAt: Date.now(),
              historySeenAt: Date.now()
            };
            if (!filesByName.has(normalizedName)) filesByName.set(normalizedName, []);
            filesByName.get(normalizedName).push([key, state.files[key]]);
            changed = true;
          }
        }
      }
      return { changed, inspected, jobs };
    } finally {
      perfEnd('files', perfStartedAt);
    }
  }

  // Only the coordinator calls this after saveState() has succeeded. The
  // retry snapshot may carry jobs, so an old draft never launches them early.
  function queueCommittedFileJobs(jobs, rememberSentFile) {
    for (const job of jobs || []) queueMicrotask(() => {
      const { staged, chatKey, messageId, epoch } = job;
      const index = pendingLocalFiles.indexOf(staged);
      if (index < 0 || staged.used || staged.chatKey !== chatKey ||
          resetEpoch(chatKey) !== epoch ||
          (staged.boundMessageId && staged.boundMessageId !== messageId) ||
          !submittedFileMatchesMessage(staged, chatKey, messageId) ||
          corruptLedgerKeys.has(chatKey)) return;
      if (isWatchdogPaused()) return;
      const committed = Object.values(loadState(chatKey).files || {}).some(entry =>
        entry.messageId === messageId && entry.metadataOnly &&
        normalizeFileName(entry.name) === normalizeFileName(staged.file.name) &&
        fileSizesCompatible(entry.size, staged.file.size));
      if (!committed) return;
      // Hand off the File only when its initial `reading` state is durable.
      // Keep the submitted File in RAM if storage rejects that commit: the next
      // scan must be able to retry without a second user upload.
      staged.readingLaunchPending = true;
      const onReadingCommitted = committed => {
        staged.readingLaunchPending = false;
        if (!committed) return;
        staged.used = true;
        const liveIndex = pendingLocalFiles.indexOf(staged);
        if (liveIndex >= 0) pendingLocalFiles.splice(liveIndex, 1);
      };
      try {
        Promise.resolve(rememberSentFile(
          staged.file, staged.source, chatKey, messageId, onReadingCommitted
        )).catch(err => {
          staged.readingLaunchPending = false;
          console.warn('[Context Watchdog] file reading launch failed');
        });
      } catch (err) {
        staged.readingLaunchPending = false;
        console.warn('[Context Watchdog] file reading launch failed');
      }
    });
  }

export { forEachUserMessage, bindSubmittedFilesToMessage, submittedFileMatchesMessage, scanConversationFiles, queueCommittedFileJobs };
