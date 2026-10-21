// RAM-only Audit confirmation state; no DOM, storage or UI dependencies.
import { priorRepairCandidates, setLastAudit } from '../runtime/01-runtime-capture-state.js';

function clearAuditConfirmation() {
  setLastAudit(null);
  priorRepairCandidates.clear();
}

export { clearAuditConfirmation };
