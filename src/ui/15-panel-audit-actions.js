import { isWatchdogPaused } from '../runtime/01-runtime-pause-state.js';
// UI presentation of Audit actions; no persistence or repair decisions here.
import { currentChatKey } from '../runtime/01-runtime-capture-state.js';
import { loadState } from '../storage/03-ledger-repository.js';
import { prepareShortRecordRepair, applyConfirmedShortRecordRepair,
  prepareUndoLastAuditRepair, applyUndoLastAuditRepair,
  messageIdExport, auditVisibleMessages } from '../app/10-audit-repair.js';
import { requestPanelConfirmation } from './15-panel-dialog-lifecycle.js';
import { render, showToast, showUnexpectedError } from './16-panel-rendering.js';

function repairConfirmedShortRecords() {
  if (isWatchdogPaused()) { showToast('Resume Watchdog before repairing records.'); return 0; }
  const prepared = prepareShortRecordRepair();
  if (prepared.status !== 'ready') {
    showToast('Run Audit twice on a ready chat to confirm incomplete stored records.');
    return 0;
  }
  requestPanelConfirmation(prepared.message, () => {
    if (isWatchdogPaused()) { showToast('Resume Watchdog before repairing records.'); return; }
    const result = applyConfirmedShortRecordRepair(prepared);
    if (result.status === 'repaired') {
      render(result.state);
      showToast(`Repaired ${result.count} confirmed message(s); Undo is available.`);
    } else if (result.status === 'stale') {
      showToast('Chat or audit changed. Run Audit again before repairing.');
    } else if (result.status === 'changed') {
      showToast('Nothing repaired: DOM or stored values changed. Run Audit again.');
    } else render(loadState());
  });
  return 0;
}

function undoLastAuditRepair() {
  if (isWatchdogPaused()) { showToast('Resume Watchdog before Undo repair.'); return false; }
  const prepared = prepareUndoLastAuditRepair();
  if (prepared.status !== 'ready') {
    if (prepared.status === 'none') showToast('No Audit repair to undo.');
    else if (prepared.status === 'changed')
      showToast('Undo refused: the saved message changed after the repair.');
    return false;
  }
  requestPanelConfirmation(prepared.message, () => {
    if (isWatchdogPaused()) { showToast('Resume Watchdog before Undo repair.'); return; }
    const result = applyUndoLastAuditRepair(prepared);
    if (result.status === 'undone') {
      render(result.state);
      showToast('Last repair undone.');
    } else if (result.status === 'changed' || result.status === 'stale') {
      showToast('Undo refused: saved records changed.');
    } else render(loadState());
  });
  return false;
}

function downloadMessageIds() {
  const snapshot = messageIdExport();
  if (!snapshot) {
    showToast('Open a chat with a UUID before exporting message IDs.');
    return;
  }
  const blob = new Blob(['\uFEFF', snapshot.tsv], {
    type: 'text/tab-separated-values;charset=utf-8'
  });
  let url = null;
  let link = null;
  try {
    url = URL.createObjectURL(blob);
    link = document.createElement('a');
    link.href = url;
    link.download = `watchdog-ids-${snapshot.chatKey.slice(5)}.tsv`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    showToast(`Exported ${snapshot.storedCount} saved UUIDs; ${snapshot.visibleCount} visible, ${snapshot.visibleOnlyCount} visible-only.${snapshot.routeUnverified ? ' DOM unverified.' : ''}`);
  } catch (err) {
    showUnexpectedError('Export IDs', err);
  } finally {
    link?.remove();
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function runAudit() {
  if (isWatchdogPaused()) { showToast('Resume Watchdog before Audit.'); return null; }
  const result = auditVisibleMessages();
  if (!result) showToast('Audit requires an open chat with a UUID.');
  else render(loadState());
  return result;
}
export { repairConfirmedShortRecords, undoLastAuditRepair, downloadMessageIds, runAudit };
