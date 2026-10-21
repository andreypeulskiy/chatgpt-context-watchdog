import { settings } from '../runtime/01-runtime-capture-state.js';
import { APP } from '../runtime/01-runtime-configuration.js';
import { activePanelView, setUi, ui } from '../runtime/01-runtime-ui-state.js';
import { resolvedViewPalette } from './08-theme-budgets.js';
import { applySavedBadgePosition } from './12-panel-position.js';
import { disposePanelDialogObservers } from './15-panel-dialog-geometry.js';
import { resetPanelDialogsForRemount } from './15-panel-dialog-lifecycle.js';
import { captureHandoffDraftForRemount } from './15-panel-handoff-settings.js';
import { UI_MARKUP } from './13-panel-markup.js';
import { UI_CSS } from './13-panel-styles.js';
import { createWatchdogLogo } from './12-watchdog-logo.js';
import { collectUiFields, installUiHints, prepareUiControls } from './14-panel-components.js';
import { setPanelView } from './14-panel-view-coordinator.js';
import { bindUiEvents } from './15-panel-settings-events.js';
import { mountPanelDialog } from './15-panel-dialog-mount.js';
import { discardUnsavedSettingsInputs, syncGroupInputs } from './15-panel-settings-controls.js';
import { bindPanelDialogHooks, bindBudgetFieldRefresh } from './15-panel-dialog-hooks.js';

  function ensureUI() {
    if (ui && document.documentElement.contains(ui.root)) return ui;

    if (ui) {
      // The former root was removed by the host: its dialogs and subscriptions
      // cannot remain tied to the newly mounted panel.
      captureHandoffDraftForRemount();
      disposePanelDialogObservers(ui.root);
      resetPanelDialogsForRemount();
    }
    const root = document.createElement('div');
    root.id = `${APP}-root`;
    root.dataset.cwStyle = settings.viewStyle;
    root.dataset.cwPalette = resolvedViewPalette();
    root.innerHTML = UI_MARKUP;
    root.querySelector('.cw-title-info .cw-brand-mark').replaceChildren(createWatchdogLogo(root.ownerDocument));
    if (!document.getElementById(`${APP}-style`)) {
      const style = document.createElement('style');
      style.id = `${APP}-style`;
      style.textContent = UI_CSS;
      document.documentElement.appendChild(style);
    }
    document.body.appendChild(root);
    applySavedBadgePosition(root);

    setUi({ root, ...collectUiFields(root) });

    bindPanelDialogHooks(mountPanelDialog, discardUnsavedSettingsInputs);
    bindBudgetFieldRefresh(() => syncGroupInputs('budget', true));
    bindUiEvents(root);
    installUiHints(root);
    prepareUiControls(root);
    setPanelView(activePanelView, false);
    return ui;
  }

export { ensureUI };
