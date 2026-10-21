import { DEFAULTS, DOCUMENT_EXTS, FILE_SIZE_UNITS, IMAGE_EXTS, TEXT_EXTS } from '../runtime/01-runtime-configuration.js';

  function getFileKey(file) {
    return `${file.name}|${file.size}|${file.lastModified || 0}`;
  }

  function getFileExt(name) {
    const m = /\.([^.]+)$/.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function isImageFile(file) {
    const ext = getFileExt(file?.name || '');
    return (
      (file?.type || '').startsWith('image/') ||
      IMAGE_EXTS.has(ext)
    );
  }

  function isTextLikeExt(ext) {
    return TEXT_EXTS.has(ext);
  }

  function normalizeFileName(name) {
    return String(name || '')
      .replace(/^\s*(?:download|file|attachment|файл|вложение)\s*[:\-–—]?\s*/i, '')
      .trim()
      .toLowerCase();
  }

  // Recognize ChatGPT-created pasted-text labels with an optional numbered
  // suffix (N) or a timestamp suffix (YYYYMMDD-HHMMSS).
  // Do NOT apply this to arbitrary files or document types.
  function isAutoPasteName(name) {
    return /^(?:вставленный\s+текст|pasted[\s_-]+(?:text|content))(?:\s*\((?:\d{8}-\d{6}|\d+)\))?(?:\.(?:txt|md))?$/iu.test(
      normalizeFileName(name)
    );
  }

  // Some variants display "Вставленный текст · Документ" without extension.
  // Accept only a small, standalone card label, never a substring of a prompt.
  function extractAutoPasteCardName(value) {
    const label = String(value || '').replace(/\u00a0/g, ' ')
      .replace(/[·•]/g, ' ').replace(/\s+/g, ' ').trim();
    const name = label.replace(/\s+(?:документ|document)$/iu, '').trim();
    return isAutoPasteName(name) ? name : '';
  }

  function extractDocumentFileName(value) {
    const text = String(value || '');
    const matches = text.matchAll(
      /([^\n\r<>:"/\\|?*]{1,180}\.([A-Za-z0-9]{1,10}))/g
    );

    for (const match of matches) {
      const name = String(match[1] || '')
        .replace(/^\s*(?:download|file|attachment|файл|вложение)\s*[:\-–—]?\s*/i, '')
        .trim();
      const ext = getFileExt(name);

      if (DOCUMENT_EXTS.has(ext) && !IMAGE_EXTS.has(ext)) {
        return name;
      }
    }

    return '';
  }

  function parseDisplayedFileSize(value) {
    const text = String(value || '');
    const match = text.match(
      /(\d+(?:[.,]\d+)?)\s*(GiB|MiB|KiB|GB|MB|KB|B|ГБ|МБ|КБ|Б)(?=\s|$|[),;])/i
    );
    if (!match) return 0;

    const amount = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) return 0;

    const unit = match[2]
      .toUpperCase()
      .replace(/К/g, 'K')
      .replace(/М/g, 'M')
      .replace(/Г/g, 'G')
      .replace(/Б/g, 'B');
    const multiplier = FILE_SIZE_UNITS[unit] || 0;

    return multiplier ? Math.round(amount * multiplier) : 0;
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return 'size unknown';
    if (n < 1000) return `${Math.round(n)} B`;
    if (n < 1000 ** 2) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)} KB`;
    if (n < 1000 ** 3) return `${(n / 1000 ** 2).toFixed(n >= 10_000_000 ? 0 : 1)} MB`;
    return `${(n / 1000 ** 3).toFixed(1)} GB`;
  }

  function metadataTypeFactor(name, config = DEFAULTS) {
    const ext = getFileExt(name);

    if (['csv','tsv','xls','xlsx','ods'].includes(ext)) return config.metadataOnlyTypeFactorSpreadsheet;
    if (isTextLikeExt(ext)) return config.metadataOnlyTypeFactorTextCode;
    if (ext === 'pdf') return config.metadataOnlyTypeFactorPdf;
    if (['doc','docx','odt','rtf'].includes(ext)) return config.metadataOnlyTypeFactorDocument;
    if (['ppt','pptx','odp'].includes(ext)) return config.metadataOnlyTypeFactorPresentation;
    if (['zip','7z','rar','gz','tar'].includes(ext)) return config.metadataOnlyTypeFactorArchive;
    return config.metadataOnlyTypeFactorOther;
  }

  function metadataFileContextEstimate(file, config = DEFAULTS) {
    const bytes = Number(file?.size) || 0;
    if (bytes <= 0) return { optimistic: 0, pessimistic: 0 };

    // File byte size is not token count. For metadata-only files we use a
    // deliberately broad, logarithmic retrieval allowance: size matters, but
    // a huge compressed file cannot pretend to occupy the whole context.
    const mib = Math.max(bytes / (1024 ** 2), 0.001);
    const scale = Math.log2(1 + mib);
    const factor = metadataTypeFactor(file.name || '', config);

    const optimistic = Math.min(config.metadataOnlyOptimisticMax,
      (config.metadataOnlyOptimisticBase + scale * config.metadataOnlyOptimisticSizeFactor) * factor);
    const pessimistic = Math.min(config.metadataOnlyPessimisticMax,
      (config.metadataOnlyPessimisticBase + scale * config.metadataOnlyPessimisticSizeFactor) * factor);

    return {
      optimistic: Math.max(0, Math.ceil(optimistic)),
      pessimistic: Math.max(0, Math.ceil(pessimistic))
    };
  }

  function fileSizesCompatible(existingSize, observedSize) {
    const previous = Number(existingSize) || 0;
    const current = Number(observedSize) || 0;
    return !previous || !current ||
      Math.abs(previous - current) <= Math.max(4096, current * 0.02);
  }

export { getFileKey, getFileExt, isImageFile, isTextLikeExt, normalizeFileName, isAutoPasteName, extractAutoPasteCardName, extractDocumentFileName, parseDisplayedFileSize, formatBytes, metadataTypeFactor, metadataFileContextEstimate, fileSizesCompatible };
