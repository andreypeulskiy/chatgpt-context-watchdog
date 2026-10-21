import { currentChatKey } from '../runtime/01-runtime-capture-state.js';
import { ui } from '../runtime/01-runtime-ui-state.js';
import { loadHistory } from '../storage/03-calibration-store.js';
import { saveEndedChatSample } from '../app/03-calibration-command.js';
import { getChatKey } from '../storage/03-ledger-foundation.js';
import { loadState } from '../storage/03-ledger-repository.js';
import { stats } from '../app/11-ledger-statistics.js';
import { placePanel } from './12-panel-position.js';
import { ensurePanelDialogMounted, discardPanelDrafts, refreshBudgetInputs } from './15-panel-dialog-hooks.js';
import { capturePanelDialogBaseline, fitPanelDialogToPanel, panelDialogBaseline, setPanelDialogBaseline } from './15-panel-dialog-geometry.js';
import { formatDetailedTokens, render, renderDiagnostics, setTextIfChanged, showToast } from './16-panel-rendering.js';

  let limitDialogChatKey = null;

  function openSettingsDialog() {
    ensurePanelDialogMounted('settings');
    if (ui.settingsDialog.open || ui.aboutDialog?.open || ui.limitDialog?.open || ui.confirmDialog?.open) return;
    // The mounted Settings dialog retains its selected category until remount.
    capturePanelDialogBaseline();
    // Only Watchdog's own main content becomes inert; the host page stays usable.
    ui.panelMain.inert = true;
    ui.panel.classList.add('cw-settings-open');
    ui.settingsScrim.hidden = false;
    ui.settingsDialog.show(); // Non-modal: ChatGPT itself remains unaffected.
    fitPanelDialogToPanel(); // Size the overlay independently of the preserved panel.
    if (ui.diagnosticsDetails?.hidden === false) {
      const state = loadState();
      renderDiagnostics(stats(state), state);
      fitPanelDialogToPanel();
    }
    ui.closeSettings.focus();
    // Chromium may finalize text metrics only after focus and the first paint.
    requestAnimationFrame(fitPanelDialogToPanel);
  }

  function closePanelDialog(dialog, trigger) {
    if (!dialog.open) return;
    dialog.close();
    ui.settingsScrim.hidden = true;
    ui.panelMain.inert = false;
    ui.panel.classList.remove('cw-settings-open');
    const baseline = panelDialogBaseline;
    setPanelDialogBaseline(null);
    ui.panel.style.height = baseline?.inlineHeight ?? '';
    if (!ui.panel.hidden) {
      render(loadState());
      const width = document.documentElement.clientWidth || window.innerWidth;
      const height = document.documentElement.clientHeight || window.innerHeight;
      if (baseline && (baseline.viewportWidth !== width || baseline.viewportHeight !== height)) {
        // A viewport resize while the dialog was open permits re-placement.
        placePanel();
      }
      // Otherwise the dialog left the panel coordinates untouched. Restoring
      // its height is sufficient; do not clamp a changing content height.
      if (trigger.isConnected) trigger.focus();
    }
  }

  function closeSettingsDialog() {
    if (!ui.settingsDialog?.open) return;
    if (ui.confirmDialog?.open) settlePanelConfirmation(false);
    discardPanelDrafts();
    closePanelDialog(ui.settingsDialog, ui.settingsBtn);
  }

  function openAboutDialog() {
    ensurePanelDialogMounted('about');
    if (ui.aboutDialog.open || ui.settingsDialog?.open || ui.limitDialog?.open || ui.confirmDialog?.open) return;
    // Keep the native disclosure states last chosen by the user.
    // Initial defaults live in markup; reopening About does not reset them.
    capturePanelDialogBaseline();
    ui.panelMain.inert = true;
    ui.panel.classList.add('cw-settings-open');
    ui.settingsScrim.hidden = false;
    ui.aboutDialog.show(); // Watchdog-local overlay: no browser-wide modal.
    fitPanelDialogToPanel();
    ui.closeAbout.focus();
    // Re-measure after the first layout/focus pass (e.g. Chromium text reflow).
    requestAnimationFrame(fitPanelDialogToPanel);
  }

  function closeAboutDialog() {
    closePanelDialog(ui.aboutDialog, ui.aboutBtn);
  }

  function openLimitDialog() {
    if (ui.settingsDialog?.open || ui.aboutDialog?.open || ui.limitDialog?.open || ui.confirmDialog?.open) return;
    if (!currentChatKey || getChatKey() !== currentChatKey) {
      showToast('Cannot record a chat limit until the current chat UUID is ready.');
      return;
    }
    ensurePanelDialogMounted('limit');
    limitDialogChatKey = currentChatKey;
    const s = stats(loadState());
    setTextIfChanged(ui.limitTokens, `≈ ${formatDetailedTokens(s.tokens)}`);
    setTextIfChanged(ui.limitOptimistic, `≈ ${formatDetailedTokens(s.optimistic)}`);
    setTextIfChanged(ui.limitPessimistic, `≈ ${formatDetailedTokens(s.pessimistic)}`);
    ui.limitReplacement.hidden = !loadHistory().some(x => x.chatKey === limitDialogChatKey);
    capturePanelDialogBaseline();
    ui.panelMain.inert = true;
    ui.panel.classList.add('cw-settings-open');
    ui.settingsScrim.hidden = false;
    ui.limitDialog.show(); // Local overlay only, never a browser-wide modal.
    fitPanelDialogToPanel();
    ui.cancelLimit.focus();
    requestAnimationFrame(fitPanelDialogToPanel);
  }

  function closeLimitDialog() {
    if (!ui.limitDialog?.open) return;
    closePanelDialog(ui.limitDialog, ui.endChat);
    limitDialogChatKey = null;
  }

  function confirmChatLimitDialog() {
    if (!ui.limitDialog?.open || !limitDialogChatKey) return;
    // SPA navigation can change while the dialog is open. Never calibrate
    // a different conversation from the one the user confirmed.
    if (currentChatKey !== limitDialogChatKey || getChatKey() !== limitDialogChatKey) {
      closeLimitDialog();
      showToast('Chat changed. No limit was recorded; reopen Record Chat Limit.');
      return;
    }
    closeLimitDialog();
    const result = saveEndedChatSample();
    if (result.status === 'saved') {
      // Even dirty fields reflect the newly persisted calibration.
      refreshBudgetInputs();
      render(result.state);
      showToast(`Chat limit #${result.count} saved; budgets updated.`);
    } else if (result.status === 'missing-chat') {
      showToast('Cannot save a chat sample before its UUID appears in the URL.');
    } else if (result.status === 'corrupt-history') {
      showToast('Calibration history is corrupt. Back up raw data before resetting.');
    } else if (result.status === 'corrupt-ledger') {
      showToast('Chat ledger is corrupt. Back up raw data before resetting.');
    } else {
      // Storage already reports the write failure; preserve UI refresh.
      render(loadState());
    }
  }


  // Only explicit OK executes a pending operation. All other closures cancel.
  let pendingConfirmation = null;

  function requestPanelConfirmation(message, onOk) {
    if (!ui || ui.panel.hidden || ui.confirmDialog?.open ||
        ui.aboutDialog?.open || ui.limitDialog?.open ||
        ui.settingsDialog?.inert || typeof onOk !== 'function') return false;
    ensurePanelDialogMounted('confirm');
    const parent = ui.settingsDialog?.open ? ui.settingsDialog : null;
    pendingConfirmation = {
      onOk, parent, origin: document.activeElement,
      chatKey: currentChatKey, routeKey: getChatKey()
    };
    ui.confirmDescription.textContent = message;
    if (parent) parent.inert = true;
    else {
      // Restore defaults also exists in Context and Budget (outside Settings).
      capturePanelDialogBaseline();
      ui.panelMain.inert = true;
      ui.panel.classList.add('cw-settings-open');
      ui.settingsScrim.hidden = false;
    }
    ui.confirmDialog.show(); // Same Watchdog-local dialog system as Settings.
    fitPanelDialogToPanel();
    ui.cancelConfirm.focus();
    requestAnimationFrame(fitPanelDialogToPanel);
    return true;
  }

  function settlePanelConfirmation(confirmed = false) {
    const pending = pendingConfirmation;
    if (!pending) return;
    pendingConfirmation = null; // A close event or double-click cannot repeat OK.
    if (pending.parent?.isConnected && pending.parent.open) {
      if (ui.confirmDialog?.open) ui.confirmDialog.close();
      pending.parent.inert = false;
      fitPanelDialogToPanel();
      if (pending.origin?.isConnected) pending.origin.focus();
    } else if (ui.confirmDialog?.open) {
      closePanelDialog(ui.confirmDialog, pending.origin || ui.settingsBtn);
    }
    if (!confirmed) return;
    if (currentChatKey !== pending.chatKey || getChatKey() !== pending.routeKey) {
      showToast('Chat changed. Action canceled.');
      return;
    }
    pending.onOk();
  }

  function resetPanelDialogsForRemount() {
    // A detached panel may contain a pending destructive confirmation.
    // Never execute an OK callback from a previous UI instance.
    pendingConfirmation = null;
    limitDialogChatKey = null;
    setPanelDialogBaseline(null);
  }

  // Keep keyboard navigation inside whichever panel-scoped dialog is open.
  function onPanelDialogKeydown(event, dialog, close) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll(
        'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), summary, [tabindex]:not([tabindex="-1"])'
      )].filter(node => node.getClientRects().length && !node.closest('[inert]'));
      if (!focusable.length) { event.preventDefault(); return; }
      const current = focusable.indexOf(document.activeElement);
      if (event.shiftKey && current <= 0) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && (current < 0 || current === focusable.length - 1)) {
        event.preventDefault();
        focusable[0].focus();
      }
    }
  }

  // Every panel-local dialog shares the same Escape/Tab and native cancel route.
  // The supplied close action owns cleanup, draft discard and focus restoration.
  function bindPanelDialogDismissal(dialog, close) {
    dialog.addEventListener('keydown', event => onPanelDialogKeydown(event, dialog, close));
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      close();
    });
  }

export { resetPanelDialogsForRemount, requestPanelConfirmation, settlePanelConfirmation, limitDialogChatKey, openSettingsDialog, closePanelDialog, closeSettingsDialog, openAboutDialog, closeAboutDialog, openLimitDialog, closeLimitDialog, confirmChatLimitDialog, bindPanelDialogDismissal };
