// Storage operation only: merge a transient draft into the destination ledger.
// The application owns route changes, retries and session cleanup.
import { loadState } from './03-ledger-repository.js';
import { saveState } from './03-ledger-commit.js';

  function promoteTransientLedger(chatKey, source) {
  if (!source) return true;
  const hasData = ['messages', 'files', 'domImages'].some(field =>
    Object.keys(source[field] || {}).length) || (source.repairHistory || []).length;
  if (!hasData) return true;
  const destination = loadState(chatKey);
  for (const field of ['messages', 'files', 'domImages']) {
    destination[field] = { ...source[field], ...destination[field] };
  }
  destination.repairHistory = [
    ...(source.repairHistory || []), ...(destination.repairHistory || [])
  ];
  return saveState(destination);
  }

export { promoteTransientLedger };
