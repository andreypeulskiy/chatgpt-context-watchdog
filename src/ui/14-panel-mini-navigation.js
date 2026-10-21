import { prepareUiControls } from './14-panel-components.js';
import { fitPanelDialogToPanel } from './15-panel-dialog-geometry.js';

  // One keyboard contract for every ARIA tablist (main panel and budget).
  function bindTabKeyboardNavigation(buttons, activate) {
    for (const [index, button] of buttons.entries()) {
      button.addEventListener('keydown', event => {
        const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : move ? (index + move + buttons.length) % buttons.length : -1;
        if (next < 0) return;
        event.preventDefault();
        activate(buttons[next]);
        buttons[next].focus();
      });
    }
  }

  // Context sections and Settings categories can collapse; ARIA tablists cannot.
  function bindMiniNavigation(nav, attribute, entries, insideDialog = false, onOpen = null, options = {}) {
    const buttons = [...nav.querySelectorAll('button')];
    const isTablist = options.mode === 'tabs';
    const activate = button => {
      const selected = button.getAttribute(attribute);
      const pane = entries[selected].pane;
      // Clicking the selected Settings category is a no-op: avoid reloading
      // diagnostics and keep lazy pane state. Context sections may collapse.
      if (insideDialog && !pane.hidden) return;
      const opening = isTablist || pane.hidden;
      for (const entry of Object.values(entries)) entry.pane.hidden = true;
      for (const link of buttons) {
        const active = opening && link === button;
        link.classList.toggle('cw-mini-active', active);
        if (isTablist) {
          link.setAttribute('aria-selected', String(active));
          link.tabIndex = active ? 0 : -1;
        } else {
          link.setAttribute('aria-expanded', String(active));
        }
      }
      if (opening) {
        pane.hidden = false;
        entries[selected].mount();
        onOpen?.(selected);
      }
      if (insideDialog) {
        fitPanelDialogToPanel();
        requestAnimationFrame(fitPanelDialogToPanel);
      }
    };
    for (const button of buttons) button.addEventListener('click', () => activate(button));
    if (isTablist) {
      for (const button of buttons) {
        button.tabIndex = button.getAttribute('aria-selected') === 'true' ? 0 : -1;
      }
      bindTabKeyboardNavigation(buttons, activate);
    }
    prepareUiControls(nav);
  }

export { bindMiniNavigation, bindTabKeyboardNavigation };
