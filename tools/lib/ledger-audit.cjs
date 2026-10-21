'use strict';

/**
 * Internal forensic audit of the current Watchdog ledger schema.
 * Pure, read-only inspection of a parsed JSON snapshot.
 * No browser APIs, no storage writes, no text/token re-estimation.
 * Outputs intentionally exclude UUIDs, filenames, URLs, and fingerprints.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MESSAGE_ID = new RegExp(`^msg:${UUID}$`, 'i');
const CHAT_ID = new RegExp(`^chat:${UUID}$`, 'i');
const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const validCount = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const validSize = x => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function auditLedger(raw, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const maxFindings = Number.isSafeInteger(options.maxFindings) && options.maxFindings > 0
    ? Math.min(1000, options.maxFindings) : 100;
  const findings = [];
  let findingEvents = 0;
  const findingCounts = { critical: 0, warning: 0, info: 0 };
  const add = (severity, code, scope, detail, occurrences = 1) => {
    findingCounts[severity] += occurrences;
    findingEvents++;
    if (findings.length < maxFindings) findings.push({ severity, code, scope, detail, occurrences });
  };
  const empty = {
    textMessages: 0, textTokens: 0, textChars: 0, userMessages: 0, assistantMessages: 0,
    files: 0, localParsedFiles: 0, imageFileRecords: 0, filesUnknownSize: 0,
    domImageRecords: 0, stableImageSlots: 0, unsupportedImageKeys: 0,
    effectiveImages: 0, repairHistoryEntries: 0
  };
  const summary = { ...empty };

  if (!isRecord(raw)) {
    add('critical', 'INVALID_ROOT', 'ledger', 'Expected a JSON object.');
    return finish();
  }
  if (!isRecord(raw.messages)) add('critical', 'INVALID_MESSAGES', 'messages', 'Expected a messages object.');
  if (raw.files != null && !isRecord(raw.files)) add('critical', 'INVALID_FILES', 'files', 'Expected a files object.');
  if (raw.domImages != null && !isRecord(raw.domImages)) add('critical', 'INVALID_DOM_IMAGES', 'domImages', 'Expected a domImages object.');
  if (raw.repairHistory != null && !Array.isArray(raw.repairHistory)) {
    add('warning', 'INVALID_REPAIR_HISTORY', 'repairHistory', 'Repair history is not an array.');
  }
  if (raw.chatKey != null && (typeof raw.chatKey !== 'string' || !CHAT_ID.test(raw.chatKey))) {
    add('warning', 'BAD_CHAT_KEY', 'ledger', 'Persisted chatKey is not a standard chat UUID.');
  }
  if (options.expectedChatKey && raw.chatKey !== options.expectedChatKey) {
    add('critical', 'CHAT_KEY_MISMATCH', 'ledger', 'Stored chatKey differs from the expected key.');
  }
  if (raw.attachmentLedgerVersion != null && raw.attachmentLedgerVersion !== 2) {
    add('warning', 'ATTACHMENT_VERSION', 'ledger',
      'Current runtime ignores saved files/domImages when attachmentLedgerVersion is not 2.');
  }
  if (raw.updatedAt != null && !validCount(raw.updatedAt)) {
    add('warning', 'INVALID_UPDATED_AT', 'ledger', 'updatedAt is not a non-negative finite number.');
  }
  if (Array.isArray(raw.repairHistory)) {
    summary.repairHistoryEntries = raw.repairHistory.length;
    if (raw.repairHistory.length > 20) add('warning', 'REPAIR_HISTORY_OVERFLOW', 'repairHistory',
      'More than 20 repair records; the current ledger retains at most 20.');
    for (let r = 0; r < raw.repairHistory.length; r++) {
      const entry = raw.repairHistory[r];
      if (!isRecord(entry) || !MESSAGE_ID.test(String(entry.id)) ||
          !isRecord(entry.before) || !isRecord(entry.after)) {
        add('warning', 'INVALID_REPAIR_ENTRY', `repairHistory[#${r + 1}]`,
          'Repair entry lacks a valid message ID or before/after snapshots.');
      }
    }
    const last = raw.repairHistory.at(-1);
    if (isRecord(last) && MESSAGE_ID.test(String(last.id)) &&
        isRecord(last.after) && isRecord(raw.messages)) {
      const current = raw.messages[last.id];
      if (JSON.stringify(current) !== JSON.stringify(last.after)) {
        add('info', 'UNDO_SNAPSHOT_NOT_CURRENT', 'repairHistory',
          'Latest repair does not match the stored message, so current Undo would refuse.');
      }
    }
  }

  const messages = isRecord(raw.messages) ? raw.messages : {};
  const files = raw.attachmentLedgerVersion === 2 && isRecord(raw.files) ? raw.files : {};
  const domImages = raw.attachmentLedgerVersion === 2 && isRecord(raw.domImages) ? raw.domImages : {};

  let i = 0;
  const normalizedIds = new Set();
  for (const [id, item] of Object.entries(messages)) {
    const scope = `messages[#${++i}]`;
    summary.textMessages++;
    if (!MESSAGE_ID.test(id)) add('warning', 'NON_UUID_MESSAGE_ID', scope, 'Message key is not msg:<UUID>.');
    else {
      const canonical = id.toLowerCase();
      if (normalizedIds.has(canonical)) add('warning', 'CASE_VARIANT_MESSAGE_ID', scope,
        'The same UUID appears with different key casing.');
      normalizedIds.add(canonical);
    }
    if (!isRecord(item)) {
      add('critical', 'INVALID_MESSAGE', scope, 'Message record must be an object.');
      continue;
    }
    if (item.role === 'user') summary.userMessages++;
    else if (item.role === 'assistant') summary.assistantMessages++;
    else add('warning', 'INVALID_MESSAGE_ROLE', scope, 'Role is neither user nor assistant.');
    if (!validCount(item.tokens)) add('critical', 'INVALID_MESSAGE_TOKENS', scope, 'Token count is not a finite non-negative number.');
    else summary.textTokens += item.tokens;
    if (!validCount(item.chars)) add('critical', 'INVALID_MESSAGE_CHARS', scope, 'Character count is not a finite non-negative number.');
    else summary.textChars += item.chars;
    if (typeof item.fingerprint !== 'string') add('warning', 'MISSING_FINGERPRINT', scope, 'Fingerprint is missing or not a string.');
    if (validCount(item.chars) && item.chars >= 40 && item.tokens === 0) {
      add('warning', 'SUSPICIOUS_ZERO_TOKENS', scope, 'Substantial stored text has zero estimated tokens.');
    }
  }
  if (!Number.isSafeInteger(summary.textTokens)) {
    add('warning', 'TEXT_TOTAL_PRECISION', 'messages', 'Summed message tokens exceed safe integer precision.');
  }

  const captured = new Map();
  const fileIdsByMessage = new Map();
  const fileNameSizeByMessage = new Map();
  i = 0;
  for (const [, file] of Object.entries(files)) {
    const scope = `files[#${++i}]`;
    summary.files++;
    if (!isRecord(file)) {
      add('critical', 'INVALID_FILE', scope, 'File record must be an object.');
      continue;
    }
    if (file.messageId != null && !MESSAGE_ID.test(String(file.messageId))) {
      add('warning', 'BAD_FILE_MESSAGE_ID', scope, 'File messageId is not msg:<UUID>.');
    } else if (file.messageId && !own(messages, file.messageId)) {
      add('info', 'FILE_MESSAGE_NOT_SAVED', scope,
        'Related message is not in stored text ledger; may be pending hydration or history-only.');
    }
    if (file.size == null || file.size === 0) summary.filesUnknownSize++;
    else if (!validSize(file.size)) add('warning', 'INVALID_FILE_SIZE', scope, 'File byte size is invalid.');
    if (file.tokens != null && !validCount(file.tokens)) {
      add('critical', 'INVALID_FILE_TOKENS', scope, 'File tokens are not a finite non-negative number.');
    }
    if (file.metadataOnly === true && (Number(file.tokens) || 0) > 0) {
      add('warning', 'METADATA_HAS_PARSED_TOKENS', scope,
        'metadataOnly is true but a positive token count is stored; inspect without auto-repair.');
    }
    if ((Number(file.tokens) || 0) > 0 && !file.metadataOnly && file.method !== 'image-average') {
      summary.localParsedFiles++;
    }
    if (file.method === 'image-average') {
      summary.imageFileRecords++;
      const group = file.messageId || `unbound-file-${i}`;
      captured.set(group, (captured.get(group) || 0) + 1);
    }
    if (file.status === 'reading' && validCount(file.lastSeenAt || file.addedAt) &&
        now - (file.lastSeenAt || file.addedAt) > 15 * 60 * 1000) {
      add('warning', 'STALE_READING_FILE', scope,
        'File remains in reading state for more than 15 minutes; no cleanup suggested.');
    }
    if (file.messageId && file.fileId && typeof file.fileId === 'string') {
      const label = JSON.stringify([file.messageId, file.fileId]);
      const previous = fileIdsByMessage.get(label);
      if (previous) add('warning', 'DUPLICATE_FILE_ID', scope,
        'Same message has multiple file records with the same fileId.');
      fileIdsByMessage.set(label, true);
    }
    if (file.messageId && typeof file.name === 'string' && validSize(file.size) && file.size > 0 &&
        file.method !== 'image-average') {
      const label = JSON.stringify([file.messageId, file.name.toLowerCase(), file.size]);
      const total = (fileNameSizeByMessage.get(label) || 0) + 1;
      fileNameSizeByMessage.set(label, total);
      if (total === 2) add('info', 'SAME_NAME_SIZE_FILES', scope,
        'Several records share name and size in one message; may be separate uploads, not proof of duplicate.');
    }
  }

  const effectiveDom = new Map();
  i = 0;
  for (const [key, image] of Object.entries(domImages)) {
    summary.domImageRecords++;
    const scope = `domImages[#${++i}]`;
    if (!isRecord(image)) {
      add('critical', 'INVALID_DOM_IMAGE', scope, 'Image record must be an object.');
      continue;
    }
    if (image.messageId != null && !MESSAGE_ID.test(String(image.messageId))) {
      add('warning', 'BAD_IMAGE_MESSAGE_ID', scope, 'Image messageId is not msg:<UUID>.');
    }
    if (image.width != null && !validCount(image.width)) {
      add('warning', 'INVALID_IMAGE_WIDTH', scope, 'Image width is not valid.');
    }
    if (image.height != null && !validCount(image.height)) {
      add('warning', 'INVALID_IMAGE_HEIGHT', scope, 'Image height is not valid.');
    }
    if (image.tokens != null && !validCount(image.tokens)) {
      add('warning', 'INVALID_IMAGE_TOKENS', scope, 'Stored image tokens are invalid (the runtime uses a configured average).');
    }
    if (!key.startsWith('dom-user-image-slot:')) {
      summary.unsupportedImageKeys++;
      add('warning', 'UNSUPPORTED_IMAGE_KEY', scope,
        'DOM image key does not use the current per-message slot scheme and is excluded from counts.');
      continue;
    }
    summary.stableImageSlots++;
    const group = image.messageId == null ? `unbound-dom:${key}` : String(image.messageId);
    effectiveDom.set(group, (effectiveDom.get(group) || 0) + 1);
  }
  for (const key of new Set([...captured.keys(), ...effectiveDom.keys()])) {
    summary.effectiveImages += Math.max(captured.get(key) || 0, effectiveDom.get(key) || 0);
  }

  return finish();

  function finish() {
    return {
      auditVersion: 1,
      readOnly: true,
      containsMessageText: false,
      summary,
      findingCounts,
      suppressedFindings: Math.max(0, findingEvents - findings.length),
      findings,
      limitations: [
        'A snapshot alone cannot prove which chat DOM was mounted or detect races between tabs.',
        'Unknown file sizes and missing related messages may be normal; no automatic repair is performed.',
        'Unknown DOM-image key formats are excluded from counts but never modified by this audit.',
        'Full context-window occupancy cannot be calculated from this ledger without current settings and server-side context behavior.'
      ]
    };
  }
}

module.exports = { auditLedger };
