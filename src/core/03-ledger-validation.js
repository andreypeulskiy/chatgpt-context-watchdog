import { emptyState } from './03-ledger-schema.js';

  function ledgerRecordObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function nonnegativeFiniteField(record, key, required = false) {
    if (!Object.hasOwn(record, key)) return !required;
    return typeof record[key] === 'number' &&
      Number.isFinite(record[key]) && record[key] >= 0;
  }

  function validMessageRecord(record) {
    return ledgerRecordObject(record) &&
      nonnegativeFiniteField(record, 'tokens', true) &&
      nonnegativeFiniteField(record, 'chars') &&
      (record.role === undefined || typeof record.role === 'string') &&
      (record.fingerprint === undefined || typeof record.fingerprint === 'string');
  }

  function validAttachmentRecord(record, image = false) {
    if (!ledgerRecordObject(record)) return false;
    for (const key of (image
      ? ['tokens', 'width', 'height', 'firstSeenAt', 'lastSeenAt']
      : ['tokens', 'size', 'durationSeconds', 'addedAt', 'historySeenAt'])) {
      if (!nonnegativeFiniteField(record, key)) return false;
    }
    return true;
  }

  function validRepairSnapshot(value) {
    return validMessageRecord(value);
  }

  // Decode only the established state:v2 fields. The same validation is used
  // for an ordinary load and for an intervening cross-tab write at commit.
  /** WATCHDOG_CONTRACT: validate the persisted shape before trusting its contents.
   * @param {string|null} chatKey
   * @param {string|null} raw
   * @param {(raw: string) => unknown} [parse] Optional JSON parser supplied by the storage boundary for profiling.
   * @returns {WatchdogLedgerV2}
   * @throws {Error} Invalid JSON or invalid top-level ledger structure
   */
  function decodeLedger(chatKey, raw, parse = JSON.parse) {
    if (!raw) return emptyState(chatKey);
    const parsed = parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        !parsed.messages || typeof parsed.messages !== 'object' || Array.isArray(parsed.messages) ||
        (parsed.files != null && (typeof parsed.files !== 'object' || Array.isArray(parsed.files))) ||
        (parsed.domImages != null && (typeof parsed.domImages !== 'object' || Array.isArray(parsed.domImages)))) {
      throw new Error('Unexpected state:v2 ledger structure');
    }
    if (!Object.values(parsed.messages).every(validMessageRecord) ||
        (parsed.attachmentLedgerVersion === 2 &&
          (!Object.values(parsed.files || {}).every(file => validAttachmentRecord(file)) ||
           !Object.values(parsed.domImages || {}).every(image => validAttachmentRecord(image, true)))) ||
        (parsed.repairHistory !== undefined &&
          (!Array.isArray(parsed.repairHistory) || !parsed.repairHistory.every(item =>
            ledgerRecordObject(item) && typeof item.id === 'string' &&
            validRepairSnapshot(item.before) && validRepairSnapshot(item.after))))) {
      throw new Error('Corrupt state:v2 nested ledger record');
    }
    return {
      ...emptyState(chatKey),
      messages: parsed.messages,
      repairHistory: Array.isArray(parsed.repairHistory) ? parsed.repairHistory : [],
      files: parsed.attachmentLedgerVersion === 2 ? (parsed.files || {}) : {},
      domImages: parsed.attachmentLedgerVersion === 2 ? (parsed.domImages || {}) : {},
      updatedAt: parsed.updatedAt || 0
    };
  }

export { ledgerRecordObject, nonnegativeFiniteField, validMessageRecord, validAttachmentRecord, validRepairSnapshot, decodeLedger };
