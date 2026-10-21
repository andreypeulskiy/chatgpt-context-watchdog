import { ui } from '../runtime/01-runtime-ui-state.js';
import { clamp } from './12-panel-clamp.js';

  // The panel frame owns overlay coordinates. Its panel remains scrollable;
  // the scrim and dialogs are siblings, so they cannot be clipped by scrolling.
  let panelDialogBaseline = null;
  let panelDialogFitQueued = false;

  function queuePanelDialogFit() {
    if (panelDialogFitQueued) return;
    panelDialogFitQueued = true;
    requestAnimationFrame(() => {
      panelDialogFitQueued = false;
      fitPanelDialogToPanel();
    });
  }

  function capturePanelDialogBaseline() {
    const rect = ui.panel.getBoundingClientRect();
    panelDialogBaseline = {
      height: rect.height, width: rect.width,
      viewportWidth: document.documentElement.clientWidth || window.innerWidth,
      viewportHeight: document.documentElement.clientHeight || window.innerHeight,
      inlineHeight: ui.panel.style.height
    };
    // Freeze the unchanged backdrop at exactly its current size. No shrink or
    // expansion while a dialog is open; resume natural height on close.
    ui.panel.style.height = `${rect.height}px`;
  }

  function fitPanelDialogToPanel() {
    if (!ui || ui.panel.hidden) return;
    const dialog = ui.confirmDialog?.open ? ui.confirmDialog :
      (ui.settingsDialog?.open ? ui.settingsDialog :
      (ui.aboutDialog?.open ? ui.aboutDialog :
      (ui.limitDialog?.open ? ui.limitDialog : null)));
    if (!dialog) return;
    const panelRect = ui.panel.getBoundingClientRect();
    const frameRect = ui.panelFrame.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const margin = 8;
    const available = Math.max(1, viewportHeight - margin * 2);
    const width = Math.max(1, Math.min(viewportWidth - margin * 2, panelRect.width - 18));
    dialog.style.width = `${width}px`;

    // The last in-flow element stays intrinsic when the dialog itself scrolls.
    // Do not reuse its previous height or scrollHeight as a persistent floor.
    const style = getComputedStyle(dialog);
    const lastChild = dialog.lastElementChild;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const borderBottom = parseFloat(style.borderBottomWidth) || 0;
    const naturalHeight = lastChild
      ? lastChild.offsetTop + lastChild.offsetHeight + paddingBottom + borderBottom
      : dialog.scrollHeight;
    let target = Math.min(available, Math.max(1, Math.ceil(naturalHeight + 2)));
    dialog.style.height = `${target}px`;
    const overflow = dialog.scrollHeight - dialog.clientHeight;
    if (overflow > 0 && target < available) {
      target = Math.min(available, target + Math.ceil(overflow) + 1);
      dialog.style.height = `${target}px`;
    }

    // Prefer opening BELOW the preserved Watchdog header. Its blurred
    // brand line remains visible through the panel-scoped scrim, while
    // its controls stay inert and cannot switch dialogs underneath.
    // If space is tight, prioritize fitting the dialog into the viewport.
    const headerRect = ui.panel.querySelector('.cw-title')?.getBoundingClientRect();
    const preferredTop = Math.max(panelRect.top + 9, (headerRect?.bottom ?? panelRect.top + 44) + 8);
    const x = clamp(panelRect.left + 9, margin, Math.max(margin, viewportWidth - width - margin));
    const y = clamp(preferredTop, margin, Math.max(margin, viewportHeight - target - margin));
    dialog.style.left = `${x - frameRect.left}px`;
    dialog.style.top = `${y - frameRect.top}px`;
    dialog.style.transform = 'none';

    // Scrim fills the frame automatically; only the shared shape is copied.
    ui.settingsScrim.style.borderRadius = getComputedStyle(ui.panel).borderRadius;
  }

  // Every panel-scoped dialog (not individual Settings tabs) uses one
  // lifecycle-scoped, local observer. It notices text changes, disclosure
  // toggles, hidden panes and lazy-loaded help without polling or page-wide
  // DOM monitoring. No network activity, ledger writes or retained chat data.
  const dialogObservers = new WeakMap();
  function disposePanelDialogObservers(root) {
    for (const dialog of root.querySelectorAll('dialog')) {
      const observers = dialogObservers.get(dialog);
      if (!observers) continue;
      for (const observer of observers) observer.disconnect();
      dialogObservers.delete(dialog);
    }
    panelDialogBaseline = null;
  }

  function observePanelDialogLayout(dialog) {
    if (dialog.dataset.cwLayoutObserved === '1') return;
    dialog.dataset.cwLayoutObserved = '1';
    const observer = new MutationObserver(() => {
      if (dialog.open) queuePanelDialogFit();
    });
    const owned = [observer];
    dialogObservers.set(dialog, owned);
    observer.observe(dialog, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['hidden', 'open', 'class']
    });
    // A content-size observer also catches reflow from CSS or browser zoom.
    const observed = dialog.querySelector('.cw-dialog-content') ||
      dialog.querySelector('.cw-about-glossary');
    if (observed && typeof ResizeObserver === 'function') {
      const resizeObserver = new ResizeObserver(() => {
        if (dialog.open) queuePanelDialogFit();
      });
      resizeObserver.observe(observed);
      owned.push(resizeObserver);
    }
  }


  // Live mutable binding: write access from a different ES module.
  function setPanelDialogBaseline(value) { return (panelDialogBaseline = value); }

export { disposePanelDialogObservers, panelDialogBaseline, panelDialogFitQueued, queuePanelDialogFit, capturePanelDialogBaseline, fitPanelDialogToPanel, observePanelDialogLayout, setPanelDialogBaseline };
