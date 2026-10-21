import { settings } from '../runtime/01-runtime-capture-state.js';
import { activePanelView, ensureUiReady, ui } from '../runtime/01-runtime-ui-state.js';
import { loadState } from '../storage/03-ledger-repository.js';
import { saveSettings } from '../storage/03-storage-io.js';
import { mountPanelView } from './14-panel-view-coordinator.js';
import { clamp } from './12-panel-clamp.js';
import { placePanel, restoreDefaultBadgeAnchor } from './12-panel-position.js';
import { fitPanelDialogToPanel } from './15-panel-dialog-geometry.js';
import { render } from './16-panel-rendering.js';

  function saveBadgePosition(root) {
    const rect = root.querySelector('.cw-chip').getBoundingClientRect();

    settings.badgePosition = {
      left: Math.round(rect.left),
      top: Math.round(rect.top)
    };

    saveSettings();
  }

  let previousResizeHandler = null;
  function installBadgeDragging(root, chip) {
    // A React remount can remove the badge without a page reload. Its old
    // resize callback must not retain or reposition the detached DOM.
    if (previousResizeHandler) window.removeEventListener('resize', previousResizeHandler);

    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragging = false;
    let suppressNextClick = false;

    const dragThreshold = 4;

    chip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !event.isPrimary) return;

      const rect = chip.getBoundingClientRect();

      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      dragging = false;

      chip.setPointerCapture?.(pointerId);
    });

    chip.addEventListener('pointermove', (event) => {
      if (pointerId === null || event.pointerId !== pointerId) return;

      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      if (!dragging && Math.hypot(dx, dy) < dragThreshold) {
        return;
      }

      if (!dragging) {
        dragging = true;
        chip.classList.add('cw-dragging');
        // Hover may persist under pointer capture even as the badge moves.
        // Close its hint (and cancel any scheduled hover) at the threshold.
        chip.dispatchEvent(new Event('cw-badge-dragstart', { bubbles: true }));
      }

      event.preventDefault();

      const chipRect = chip.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - chipRect.width);
      const maxTop = Math.max(0, window.innerHeight - chipRect.height);

      const left = clamp(startLeft + dx, 0, maxLeft);
      const top = clamp(startTop + dy, 0, maxTop);

      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';
    });

    const finishDrag = (event) => {
      if (pointerId === null || event.pointerId !== pointerId) return;

      if (dragging) {
        suppressNextClick = true;
        saveBadgePosition(root);
        placePanel();
        if (ui?.confirmDialog?.open || ui?.settingsDialog?.open ||
            ui?.aboutDialog?.open || ui?.limitDialog?.open) fitPanelDialogToPanel();
      }

      chip.classList.remove('cw-dragging');
      chip.releasePointerCapture?.(pointerId);

      pointerId = null;
      dragging = false;
    };

    chip.addEventListener('pointerup', finishDrag);
    chip.addEventListener('pointercancel', finishDrag);

    chip.addEventListener(
      'click',
      (event) => {
        if (!suppressNextClick) return;

        suppressNextClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true
    );

    const resizeHandler = () => {
      if (!settings.badgePosition) {
        // Opening freezes the badge's left edge. On resize, recover the
        // stylesheet's current full-badge anchor before placing the panel.
        restoreDefaultBadgeAnchor(root, !ui?.panel?.hidden);
        placePanel();
        if (ui?.confirmDialog?.open || ui?.settingsDialog?.open ||
            ui?.aboutDialog?.open || ui?.limitDialog?.open) fitPanelDialogToPanel();
        return;
      }

      const rect = chip.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - rect.height);

      const left = clamp(rect.left, 0, maxLeft);
      const top = clamp(rect.top, 0, maxTop);

      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      placePanel();
      if (ui?.confirmDialog?.open || ui?.settingsDialog?.open ||
          ui?.aboutDialog?.open || ui?.limitDialog?.open) fitPanelDialogToPanel();
    };
    previousResizeHandler = resizeHandler;
    window.addEventListener('resize', resizeHandler);
  }

  function openPanel() {
    ensureUiReady();
    const opening = ui.panel.hidden;
    if (opening) {
      // Freeze the current icon position before the right-anchored badge shrinks.
      // Saved positions are already left-anchored; default badges are not.
      const rect = ui.chip.getBoundingClientRect();
      ui.root.style.left = `${rect.left}px`;
      ui.root.style.top = `${rect.top}px`;
      ui.root.style.right = 'auto';
      ui.root.style.bottom = 'auto';
      ui.root.dataset.cwPanelOpen = 'true';
      ui.chip.setAttribute('aria-label', 'Close Watchdog panel');
      ui.chip.setAttribute('aria-expanded', 'true');
    }
    ui.panel.hidden = false;
    // Opening a panel immediately dismisses an already visible badge hint.
    const tip = ui.root.querySelector('.cw-floating-tip');
    if (tip) tip.hidden = true;
    mountPanelView(activePanelView);
    render(loadState());
    if (opening) placePanel();
  }

export { saveBadgePosition, installBadgeDragging, openPanel };
