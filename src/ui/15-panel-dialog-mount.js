import { ui } from '../runtime/01-runtime-ui-state.js';
import { LAZY_DIALOG_MARKUP } from './13-panel-markup.js';
import { refreshUiFields, prepareUiControls } from './14-panel-components.js';
import { observePanelDialogLayout } from './15-panel-dialog-geometry.js';
import { bindPanelDialogActions } from './15-panel-action-handlers.js';

function mountPanelDialog(kind) {
  const field = kind === 'settings' ? 'settingsDialog' :
    kind === 'about' ? 'aboutDialog' : kind === 'limit' ? 'limitDialog' : 'confirmDialog';
  if (ui[field]) return;
  ui.panelFrame.insertAdjacentHTML('beforeend', LAZY_DIALOG_MARKUP[kind]);
  refreshUiFields();
  observePanelDialogLayout(ui[field]);
  bindPanelDialogActions(kind);
  prepareUiControls(ui[field]);
}

export { mountPanelDialog };
