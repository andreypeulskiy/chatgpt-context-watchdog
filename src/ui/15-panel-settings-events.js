import { settings } from '../runtime/01-runtime-capture-state.js';
import { HANDOFF_PROMPT } from '../runtime/01-runtime-configuration.js';
import { isChatAvailable, requestRunStateSync } from '../runtime/01-runtime-pause-state.js';
import { saveSettings } from '../storage/03-storage-io.js';
import { outsidePanelHandlerBound, panelPinned, setOutsidePanelHandlerBound, setPanelPinned, ui } from '../runtime/01-runtime-ui-state.js';
import { installBadgeDragging, openPanel } from './12-panel-shell.js';
import { installBadgeSiteIcon } from './12-panel-site-icon.js';
import { PANEL_VIEWS } from './14-panel-components.js';
import { setPanelView } from './14-panel-view-coordinator.js';
import { bindTabKeyboardNavigation } from './14-panel-mini-navigation.js';
import { closeAboutDialog, closeLimitDialog, closeSettingsDialog, openAboutDialog, openLimitDialog, openSettingsDialog, settlePanelConfirmation } from './15-panel-dialog-lifecycle.js';
import { discardUnsavedSettingsInputs } from './15-panel-settings-controls.js';
import { copyFallback, insertIntoComposer, showToast } from './16-panel-rendering.js';
import { queueConversationEvent } from '../app/17-conversation-coordinator.js';

  function dismissOpenPanelDialog() {
    if (!ui) return;
    if (ui.confirmDialog?.open) settlePanelConfirmation(false);
    else if (ui.settingsDialog?.open) closeSettingsDialog();
    else if (ui.aboutDialog?.open) closeAboutDialog();
    else if (ui.limitDialog?.open) closeLimitDialog();
  }

  function dismissWatchdogPanel() {
    if (!ui || ui.panel.hidden) return;
    dismissOpenPanelDialog();
    // Dismissing the entire panel also closes Settings beneath confirmation.
    if (ui.settingsDialog?.open) closeSettingsDialog();
    // Other forms (Context/Budget) also lose their uncommitted drafts.
    discardUnsavedSettingsInputs();
    // A transient notice expires on its own timer, even while the panel is hidden.
    ui.panel.hidden = true;
    delete ui.root.dataset.cwPanelOpen;
    ui.chip.setAttribute('aria-label', 'Open Watchdog panel');
    ui.chip.setAttribute('aria-expanded', 'false');
    // Expand at the same icon anchor, except when dragged near the right edge
    // where the full badge must be kept inside the viewport.
    const badge = ui.chip.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - badge.width);
    if (badge.left > maxLeft) ui.root.style.left = `${maxLeft}px`;
  }

  // The badge remains draggable everywhere, but only the circular logo zone
  // toggles on pointer clicks. Pointer capture can retarget `click` to the
  // button, so use coordinates instead of event.target. The radius matches
  // the same 32px circle in Soft and Sharp; keyboard clicks stay valid.
  function isBadgeLogoActivation(event) {
    if (event.detail === 0) return true;
    const icon = ui.siteIcon.getBoundingClientRect();
    const hitDiameter = parseFloat(getComputedStyle(ui.siteIcon.parentElement, '::before').width);
    const dx = event.clientX - (icon.left + icon.width / 2);
    const dy = event.clientY - (icon.top + icon.height / 2);
    return Math.hypot(dx, dy) <= hitDiameter / 2;
  }

  // Pin is session-only; remounts must display the existing pin state.
  function syncPanelPinControl() {
    ui.pinBtn.setAttribute('aria-pressed', String(panelPinned));
    ui.pinBtn.setAttribute('aria-label', panelPinned ? 'Unpin panel' : 'Pin panel');
    ui.pinBtn.querySelector('.cw-tool-tip').textContent = panelPinned
      ? 'Unpin panel · Close when clicking outside'
      : 'Pin panel · Keep open when clicking outside';
  }

  // UI wiring is kept separate from markup/style construction.
  function bindUiEvents(root) {
    // Site DOM is read-only; the existing Watchdog header emblem is fallback.
    installBadgeSiteIcon(root, ui.siteIcon);

    installBadgeDragging(root, ui.chip);
    const panelTabs = PANEL_VIEWS.map(name => ui[`${name}Tab`]);
    for (const [index, tab] of panelTabs.entries()) {
      tab.addEventListener('click', () => setPanelView(PANEL_VIEWS[index]));
    }
    bindTabKeyboardNavigation(panelTabs, tab => setPanelView(PANEL_VIEWS[panelTabs.indexOf(tab)]));

    ui.chip.addEventListener('click', (event) => {
      if (!isBadgeLogoActivation(event)) return;
      if (!ui.panel.hidden) {
        // Badge activation is an explicit panel toggle, even when pinned.
        // Pin guards automatic outside dismissal, not user-requested closing.
        dismissWatchdogPanel();
        return;
      }
      openPanel();
      queueConversationEvent();
    });
    ui.pauseToggle.addEventListener('click', () => {
      if (!isChatAvailable()) return;
      const wasPaused = settings.watchdogPaused === true;
      settings.watchdogPaused = !wasPaused;
      if (!saveSettings()) {
        settings.watchdogPaused = wasPaused;
        showToast('Could not save Watchdog pause preference.');
        return;
      }
      requestRunStateSync();
    });
    syncPanelPinControl();
    ui.pinBtn.addEventListener('click', () => {
      setPanelPinned(!panelPinned);
      syncPanelPinControl();
    });
    ui.aboutBtn.addEventListener('click', openAboutDialog);
    // The scrim belongs to the panel: clicking outside the dialog but
    // within the panel dismisses only the dialog, regardless of pin state.
    // It intercepts the blurred header so its underlying action buttons
    // cannot open another dialog or trigger unrelated actions.
    ui.settingsScrim.addEventListener('click', dismissOpenPanelDialog);

    // Only clicks outside the whole Watchdog auto-dismiss an unpinned panel.
    // Pin protects BOTH the panel and its currently open local dialog.
    // Keep document clicks unmodified for the host ChatGPT page.
    if (!outsidePanelHandlerBound) {
      setOutsidePanelHandlerBound(true);
      document.addEventListener('pointerdown', (event) => {
        if (!ui || ui.panel.hidden || ui.root.contains(event.target)) return;
        if (!panelPinned) dismissWatchdogPanel();
      }, true);
      document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !ui || ui.panel.hidden) return;
        // A dialog's own key handler closes that dialog first. Without one,
        // Escape is an explicit panel dismissal even when pinned.
        if (ui.settingsDialog?.open || ui.aboutDialog?.open || ui.limitDialog?.open) return;
        event.preventDefault();
        dismissWatchdogPanel();
        // An Escape dismissal should never strand keyboard focus in hidden UI.
        ui.chip.focus();
      });
    }

    ui.settingsBtn.addEventListener('click', openSettingsDialog);

    ui.endChat.addEventListener('click', openLimitDialog);

    ui.detailHandoff.addEventListener('click', () => {
      const prompt = settings.handoffPrompt || HANDOFF_PROMPT;
      const result = insertIntoComposer(prompt);
      if (result === 'inserted') {
        showToast('HANDOFF inserted. Review before sending.');
      } else {
        copyFallback(prompt, result);
      }
    });

  }

export { dismissOpenPanelDialog, dismissWatchdogPanel, bindUiEvents };
