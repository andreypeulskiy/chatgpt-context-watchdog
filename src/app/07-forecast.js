import { calculateContextEstimate } from '../core/context-estimate.js';
import { settings } from '../runtime/01-runtime-capture-state.js';
import { isAutoPasteName, metadataFileContextEstimate } from '../attachments/05-attachment-helpers.js';
import { effectiveImageStats } from '../chatgpt/09-dom-image-accounting.js';

  function autoPasteMinimumEstimate(file) {
    // Visible automatic pasted-text document without readable content.
    // A local full-text parse always wins; never add both estimates.
    if (!file || (!file.autoPaste && !(
      file.source === 'dom-history' && isAutoPasteName(file.name)
    ))) return null;
    if ((Number(file.tokens) || 0) > 0 && !file.metadataOnly) return null;

    // Content language is unknown; these are broad *context-load scenarios*,
    // NOT a guaranteed token count for the complete pasted document.
    const minChars = settings.pastedMinChars;
    const englishEquivalent = Math.ceil(minChars / settings.pastedEnglishCharsPerToken);
    const cyrillicEquivalent = Math.ceil(minChars / settings.pastedCyrillicCharsPerToken);
    const optimistic = Math.ceil(englishEquivalent * (settings.fileOptimisticPct / 100));
    return {
      chars: minChars,
      optimistic,
      pessimistic: Math.max(optimistic,
        Math.ceil(cyrillicEquivalent * (settings.filePessimisticPct / 100)))
    };
  }

  function fileForecast(files, capturedImages = null) {
    let optimistic = 0;
    let pessimistic = 0;
    let knownTokens = 0;
    let fileCount = 0;
    let parsedFiles = 0;
    let metadataFiles = 0;
    let reactMetadataFiles = 0;
    let unparsedFiles = 0;
    let unknownSizeFiles = 0;
    let autoPasteMinimumFiles = 0;
    let autoPasteMinimumChars = 0;
    let sampledTextFiles = 0;
    let fullyReadTextFiles = 0;
    let totalBytes = 0;

    for (const key in (files || {})) {
      const file = files[key];
      if (!file) continue;
      if (file.method === 'image-average') {
        // The same pass also collects image-upload identities when requested.
        // Only own keys count here, matching Object.entries() in the original
        // image collector; regular fileForecast() retains its old interface.
        if (capturedImages && Object.hasOwn(files, key)) {
          capturedImages.count++;
          const id = file.messageId || `unbound-file:${key}`;
          const byMessage = capturedImages.byMessage;
          byMessage.set(id, (byMessage.get(id) || 0) + 1);
        }
        continue;
      }

      const t = Number(file.tokens) || 0;
      const size = Number(file.size) || 0;

      // Images are accounted separately via effectiveImageStats().
      fileCount++;
      if (file.metadataSource === 'react-props') reactMetadataFiles++;
      if (file.method === 'text-extrapolated') sampledTextFiles++;
      if (file.method === 'text') fullyReadTextFiles++;
      if (size > 0) totalBytes += size;
      else unknownSizeFiles++;

      // A fully read, whitespace-only text file is a *known* zero-token
      // result, not an unknown binary to estimate again from byte size.
      // Text-extrapolated zero samples remain uncertain beyond the sample.
      if ((t > 0 || file.method === 'text') && !file.metadataOnly) {
        knownTokens += t;
        parsedFiles++;

        optimistic += t * (settings.fileOptimisticPct / 100);
        pessimistic += t * (settings.filePessimisticPct / 100);
        continue;
      }

      if (file.metadataOnly || file.method === 'metadata-size') {
        metadataFiles++;
      } else {
        unparsedFiles++;
      }

      // Historical cards and locally captured but unparsed binaries never get
      // opened here. Their visible byte size only widens the current-context
      // range through a capped metadata heuristic.
      const meta = metadataFileContextEstimate(file, settings);
      const pasteMinimum = autoPasteMinimumEstimate(file);
      // Historical cards with unknown size use the same configurable file
      // contribution percentages. Pasted text has an independent text floor.
      if (file.source === 'dom-history' && size <= 0 && !pasteMinimum) {
        const baseTokens = settings.historicalFileFallbackTokens;
        meta.optimistic = Math.ceil(baseTokens * (settings.fileOptimisticPct / 100));
        meta.pessimistic = Math.ceil(baseTokens * (settings.filePessimisticPct / 100));
      }
      if (pasteMinimum) {
        autoPasteMinimumFiles++;
        autoPasteMinimumChars += pasteMinimum.chars;
      }
      // A lower-bound text estimate replaces, never adds to, a metadata
      // estimate for this same file. A known file size may imply a higher cap.
      optimistic += Math.max(meta.optimistic, pasteMinimum?.optimistic || 0);
      pessimistic += Math.max(meta.pessimistic, pasteMinimum?.pessimistic || 0);
    }

    return {
      fileOptimistic: Math.ceil(optimistic),
      filePessimistic: Math.ceil(pessimistic),
      knownTokens,
      fileCount,
      parsedFiles,
      metadataFiles,
      reactMetadataFiles,
      unparsedFiles,
      unknownSizeFiles,
      autoPasteMinimumFiles,
      autoPasteMinimumChars,
      sampledTextFiles,
      fullyReadTextFiles,
      totalBytes
    };
  }

  function estimateCurrentContext(state, chatTokens) {
    const capturedImages = { count: 0, byMessage: new Map() };
    const files = fileForecast(state.files || {}, capturedImages);
    return calculateContextEstimate(state, chatTokens,
      files, effectiveImageStats(state, capturedImages), settings);
  }

export { autoPasteMinimumEstimate, fileForecast, estimateCurrentContext };
