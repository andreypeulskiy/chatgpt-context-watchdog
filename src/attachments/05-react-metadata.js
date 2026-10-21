import { extractAutoPasteCardName, extractDocumentFileName, isImageFile, normalizeFileName, parseDisplayedFileSize } from './05-attachment-helpers.js';

  // Optional, local-only React adapter. No fetch interception, extra requests,
  // DOM mutation or references to React objects survive this call. React Fiber
  // is a private interface: failure must always fall back to DOM metadata.
  // Only a specific visible file card, inside a UUID-identified user turn,
  // may supply metadata; never search globally for a matching filename.
  function reactAttachmentMetadata(element, turn, expectedName = '') {
    try {
      if (!turn?.contains?.(element)) return null;
      const anchors = [];
      const expected = normalizeFileName(expectedName);
      if (element.getAttribute?.('title')) anchors.push(element);
      for (const child of Array.from(element.querySelectorAll?.('[title]') || []).slice(0, 12)) {
        if (!expected || normalizeFileName(child.getAttribute('title')) === expected) {
          anchors.push(child);
        }
      }
      // A file card can be represented by a button without a named child.
      if (!anchors.length) anchors.push(element);
      const visited = new Set();
      for (const anchor of anchors) {
        let node = anchor;
        for (let level = 0; node && level < 10; level++, node = node.parentElement) {
          const fiberKey = Object.keys(node).find(k => k.startsWith('__reactFiber$'));
          let fiber = fiberKey ? node[fiberKey] : null;
          for (let i = 0; fiber && i < 100; i++, fiber = fiber.return) {
            if (visited.has(fiber)) break;
            visited.add(fiber);
            const value = fiber.memoizedProps?.attachment;
            if (!value || typeof value !== 'object' || typeof value.name !== 'string') continue;
            const name = value.name.trim();
            if (!name || (expected && normalizeFileName(name) !== expected)) continue;
            // Without an expected name, only accept objects linked to visible
            // card text, not unrelated attachments in an ancestor component.
            const visible = String(element.getAttribute?.('title') || '') === name ||
              (String(element.textContent || '').length <= 500 &&
                String(element.textContent || '').includes(name));
            if (!expected && !visible) continue;
            const size = Number(value.sizeBytes);
            const width = Number(value.width);
            const height = Number(value.height);
            const duration = Number(value.durationSeconds);
            const id = value.fileId ?? value.id;
            return {
              name,
              size: Number.isSafeInteger(size) && size > 0 ? size : 0,
              type: typeof value.mimeType === 'string' ? value.mimeType.slice(0, 128) : '',
              fileId: typeof id === 'string' && /^file_[a-z0-9_-]{8,100}$/i.test(id) ? id : '',
              width: Number.isFinite(width) && width > 0 ? width : 0,
              height: Number.isFinite(height) && height > 0 ? height : 0,
              durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 0,
              metadataSource: 'react-props'
            };
          }
          if (node === turn) break;
        }
      }
    } catch { /* React internals may change or contain inaccessible objects. */ }
    return null;
  }

  function fileMetadataFromElement(element, turn) {
    const sources = [
      element.getAttribute?.('download'),
      element.getAttribute?.('title'),
      element.getAttribute?.('aria-label'),
      element.textContent
    ];

    let name = '';
    for (const source of sources) {
      name = extractDocumentFileName(source);
      if (name) break;
    }
    if (!name) {
      for (const source of sources) {
        name = extractAutoPasteCardName(source);
        if (name) break;
      }
    }
    const react = reactAttachmentMetadata(element, turn, name);
    if (!name && !react) return null;
    if (!name && react) name = react.name;
    // Images are separately accounted for through DOM dimensions/File API.
    // Never count a React image attachment again as a document file.
    if (isImageFile({ name, type: react?.type || '' })) return null;

    let size = react?.size || 0;
    let node = element;

    for (let depth = 0; !size && node && depth < 5; depth++, node = node.parentElement) {
      const value = node.textContent || '';
      if (value.length <= 800) {
        size = parseDisplayedFileSize(value);
        if (size) break;
      }
      if (node === turn) break;
    }

    return { name, size, ...(react ? {
      type: react.type, fileId: react.fileId,
      durationSeconds: react.durationSeconds, metadataSource: react.metadataSource
    } : {}) };
  }

export { reactAttachmentMetadata, fileMetadataFromElement };
