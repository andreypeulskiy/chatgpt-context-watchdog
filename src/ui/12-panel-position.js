import { settings } from '../runtime/01-runtime-capture-state.js';
import { ui } from '../runtime/01-runtime-ui-state.js';
import { clamp } from './12-panel-clamp.js';

  function applySavedBadgePosition(root) {
    const pos = settings.badgePosition;
    if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) {
      return;
    }

    // Saved positions may have been recorded while the open badge contained
    // only the icon. Clamp against the actual FULL badge dimensions on mount,
    // not a fixed 40px approximation that can leave its metric offscreen.
    const badgeRect = root.querySelector('.cw-chip').getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - badgeRect.width);
    const maxTop = Math.max(0, window.innerHeight - badgeRect.height);

    const left = clamp(pos.left, 0, maxLeft);
    const top = clamp(pos.top, 0, maxTop);

    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  }

  // Reset and default-position resize must use the FULL badge's CSS anchor,
  // even when the open panel has temporarily hidden its numeric range.
  // Temporarily measure with the default stylesheet, restoring inline styles
  // synchronously before a paint; no cloned controls or extra listeners.
  function restoreDefaultBadgeAnchor(root, panelOpen) {
    const props = ['left', 'top', 'right', 'bottom'];
    const original = props.map(prop => root.style[prop]);
    const wasCompact = root.dataset.cwPanelOpen === 'true';
    for (const prop of props) root.style[prop] = '';
    if (wasCompact) delete root.dataset.cwPanelOpen;
    const rect = root.querySelector('.cw-chip').getBoundingClientRect();
    if (wasCompact) root.dataset.cwPanelOpen = 'true';
    for (let i = 0; i < props.length; i++) root.style[props[i]] = original[i];

    if (panelOpen) {
      // Freezing the full-width left edge means opening/closing preserves
      // the actual mark position instead of moving it with the badge width.
      root.style.left = `${rect.left}px`;
      root.style.top = `${rect.top}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';
    } else {
      // Closed default badge uses its original CSS right/bottom anchors,
      // including Dev's responsive rules (not hardcoded mobile offsets).
      for (const prop of props) root.style[prop] = '';
    }
  }

  // The chosen side belongs to the current panel DOM, never to persisted data.
  const panelPlacements = new WeakMap();

  function placePanel() {
    if (!ui || ui.panel.hidden) return;

    const gap = 4;
    const edge = 8;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const chipRect = ui.chip.getBoundingClientRect();
    const rootRect = ui.root.getBoundingClientRect();

    // Priority: below -> above -> left. Never place the panel to the right.
    // Measure without the height cap from a previous placement.
    ui.panel.style.maxHeight = '';
    const panelRect = ui.panel.getBoundingClientRect();
    const left = clamp(chipRect.left, edge,
      Math.max(edge, viewportWidth - panelRect.width - edge));
    const spaceBelow = Math.max(0, viewportHeight - edge - chipRect.bottom - gap);
    const spaceAbove = Math.max(0, chipRect.top - edge - gap);
    const spaceLeft = chipRect.left - gap - edge;

    if (panelRect.height > spaceBelow && panelRect.height > spaceAbove &&
        spaceLeft >= panelRect.width) {
      // Only if neither vertical direction fits, use the existing diagonal
      // placement on the LEFT. Constrain its top so the panel remains visible.
      ui.panelFrame.style.left = `${chipRect.left - gap - panelRect.width - rootRect.left}px`;
      ui.panelFrame.style.top = `${clamp(chipRect.top + 14, edge,
        Math.max(edge, viewportHeight - panelRect.height - edge)) - rootRect.top}px`;
      panelPlacements.set(ui.panel, 'left');
      constrainPanel();
      return;
    }

    // Vertical preference also applies when both directions fit. If neither
    // direction nor the left side fits, use the larger vertical space and
    // scroll the panel contents rather than opening to the right.
    const below = panelRect.height <= spaceBelow ||
      (panelRect.height > spaceAbove && spaceBelow >= spaceAbove);
    const available = below ? spaceBelow : spaceAbove;
    if (panelRect.height > available) ui.panel.style.maxHeight = `${available}px`;
    const panelHeight = ui.panel.getBoundingClientRect().height;
    ui.panelFrame.style.left = `${left - rootRect.left}px`;
    ui.panelFrame.style.top = `${(below
      ? chipRect.bottom + gap
      : chipRect.top - gap - panelHeight) - rootRect.top}px`;
    panelPlacements.set(ui.panel, below ? 'below' : 'above');
    constrainPanel();
  }

  function constrainPanel() {
    // Content updates must not change the chosen left/top or badge side.
    // Only the viewport and badge position determine the scrolling budget.
    if (!ui || ui.panel.hidden) return;
    const side = panelPlacements.get(ui.panel);
    if (!side) return;
    const edge = 8;
    const gap = 4;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const panelTop = ui.panel.getBoundingClientRect().top;
    const lowerBoundary = side === 'above'
      ? Math.min(viewportHeight - edge, ui.chip.getBoundingClientRect().top - gap)
      : viewportHeight - edge;
    ui.panel.style.maxHeight = `${Math.max(1, lowerBoundary - panelTop)}px`;
  }

export { applySavedBadgePosition, restoreDefaultBadgeAnchor, placePanel, constrainPanel };
