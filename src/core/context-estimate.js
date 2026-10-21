// Pure scenario math: no DOM, storage, or live runtime state.
  function calculateContextEstimate(state, chatTokens, ff, imageStats, config) {
    const imageOptimistic = Math.ceil(imageStats.tokens * (config.imageOptimisticPct / 100));
    const imagePessimistic = Math.ceil(imageStats.tokens * (config.imagePessimisticPct / 100));

    const optimistic =
      chatTokens +
      ff.fileOptimistic +
      imageOptimistic +
      config.hiddenOptimistic;

    const pessimistic =
      chatTokens +
      ff.filePessimistic +
      imagePessimistic +
      config.hiddenPessimistic;

    return {
      optimistic: Math.max(chatTokens, Math.ceil(optimistic)),
      pessimistic: Math.max(chatTokens, Math.ceil(pessimistic)),
      fileOptimistic: ff.fileOptimistic,
      filePessimistic: ff.filePessimistic,
      imageOptimistic,
      imagePessimistic,
      knownTokens: ff.knownTokens + imageStats.tokens,
      knownFiles:
        ff.fileCount + imageStats.effective,
      knownFileTokens: ff.knownTokens,
      knownFileCount: ff.fileCount,
      parsedFiles: ff.parsedFiles,
      metadataFiles: ff.metadataFiles,
      reactMetadataFiles: ff.reactMetadataFiles,
      unparsedFiles: ff.unparsedFiles,
      unknownSizeFiles: ff.unknownSizeFiles,
      autoPasteMinimumFiles: ff.autoPasteMinimumFiles,
      autoPasteMinimumChars: ff.autoPasteMinimumChars,
      sampledTextFiles: ff.sampledTextFiles,
      fullyReadTextFiles: ff.fullyReadTextFiles,
      totalFileBytes: ff.totalBytes,
      knownImageTokens: imageStats.tokens,
      knownImages: imageStats.effective,
      capturedImages: imageStats.captured,
      historicalImages: imageStats.historical
    };
  }

export { calculateContextEstimate };
