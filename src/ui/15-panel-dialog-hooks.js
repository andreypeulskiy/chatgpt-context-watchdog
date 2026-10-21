// Explicit dependencies supplied by the UI owner; dialogs never import their factories.
let mountDialog = null;
let discardDrafts = null;
let refreshBudget = null;

function bindPanelDialogHooks(mount, discard) {
  mountDialog = mount;
  discardDrafts = discard;
}
function ensurePanelDialogMounted(kind) {
  if (!mountDialog) throw new Error('Watchdog dialog factory was not initialized');
  mountDialog(kind);
}
function discardPanelDrafts() { discardDrafts?.(); }
function bindBudgetFieldRefresh(callback) { refreshBudget = callback; }
function refreshBudgetInputs() { refreshBudget?.(); }

export { bindPanelDialogHooks, ensurePanelDialogMounted, discardPanelDrafts, bindBudgetFieldRefresh, refreshBudgetInputs };
