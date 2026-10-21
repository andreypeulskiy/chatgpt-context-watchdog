import { settings } from '../runtime/01-runtime-capture-state.js';
import { activePanelView, setActivePanelView, ui } from '../runtime/01-runtime-ui-state.js';
import { effectiveBudgets } from '../storage/03-calibration-store.js';
import { METADATA_SETTING_SPECS } from '../runtime/01-runtime-configuration.js';
import { loadState } from '../storage/03-ledger-repository.js';
import { stats } from '../app/11-ledger-statistics.js';
import { LAZY_ESTIMATION_MARKUP, LAZY_SECTION_MARKUP, LAZY_VIEW_MARKUP, metadataControlsMarkup } from './13-panel-markup.js';
import { bindMiniNavigation } from './14-panel-mini-navigation.js';
import { SETTING_GROUPS, bindSettingsGroup, syncGroupInputs } from './15-panel-settings-controls.js';
import { buildDetailGroups, copyableDetailText, hasConfirmedContext, render, renderHistory, showToast } from './16-panel-rendering.js';
import { PANEL_VIEWS, refreshUiFields, prepareUiControls } from './14-panel-components.js';

  function mountEstimationSection(kind, details) {
    if (details.dataset.mounted === 'true') return;
    details.insertAdjacentHTML('beforeend', LAZY_ESTIMATION_MARKUP[kind]);
    details.dataset.mounted = 'true';
    if (kind === 'attachment') {
      details.querySelector('.cw-metadata-section').innerHTML = metadataControlsMarkup(METADATA_SETTING_SPECS);
    }
    refreshUiFields();
    bindSettingsGroup(kind);
    prepareUiControls(details);
  }

  function setPanelView(next, refresh = true) {
    if (!ui) return;
    setActivePanelView(PANEL_VIEWS.includes(next) ? next : 'context');
    if (!ui.panel.hidden) mountPanelView(activePanelView);
    for (const name of PANEL_VIEWS) {
      const active = name === activePanelView;
      ui[`${name}View`].hidden = !active;
      ui[`${name}Tab`].setAttribute('aria-selected', String(active));
      ui[`${name}Tab`].tabIndex = active ? 0 : -1;
    }
    // Diagnostics and Performance live in the Settings dialog, never in a tab.
    if (refresh) {
      render(loadState());
    }
  }

  function mountPanelView(name) {
    const section = ui[`${name}View`];
    if (!section || section.dataset.mounted === 'true') return;
    section.insertAdjacentHTML('beforeend', LAZY_VIEW_MARKUP[name]);
    section.dataset.mounted = 'true';
    refreshUiFields();
    if (name === 'context') {
      bindMiniNavigation(section.querySelector('.cw-mini-nav'), 'data-cw-mini', {
        text: { pane: ui.textSettingsDetails, mount: () => mountEstimationSection('text', ui.textSettingsDetails) },
        attachment: { pane: ui.attachmentSettings, mount: () => mountEstimationSection('attachment', ui.attachmentSettings) },
        coefficients: { pane: ui.advancedAttachments, mount: () => mountEstimationSection('coefficients', ui.advancedAttachments) }
      }, false, selected => { if (SETTING_GROUPS[selected]) syncGroupInputs(selected); });
    } else if (name === 'budget') {
      const nav = section.querySelector('.cw-budget-mini-nav');
      const limits = section.querySelector('.cw-budget-limits');
      const history = section.querySelector('.cw-history-details');
      const editor = section.querySelector('.cw-budget-editor');
      // Same tab navigation contract as the main panel. History mounts on demand.
      // Selecting these tabs never changes the forecasting computation.
      bindMiniNavigation(nav, 'data-cw-budget', {
        limits: { pane: limits, mount: () => {} },
        history: { pane: history, mount: () => {
          if (history.dataset.mounted !== 'true') {
            history.insertAdjacentHTML('beforeend', LAZY_SECTION_MARKUP.historyBody);
            history.dataset.mounted = 'true';
            refreshUiFields();
          }
        } }
      }, false, selected => { if (selected === 'history') renderHistory(effectiveBudgets()); }, { mode: 'tabs' });
      editor.addEventListener('toggle', () => {
        if (editor.open && editor.dataset.mounted !== 'true') {
          editor.querySelector('.cw-budget-settings').insertAdjacentHTML('beforeend', LAZY_SECTION_MARKUP.budgetForm);
          editor.dataset.mounted = 'true';
          refreshUiFields();
          bindSettingsGroup('budget');
          prepareUiControls(editor);
        }
        if (editor.open) syncGroupInputs('budget');
      });
      prepareUiControls(section);
    } else if (name === 'details') {
      ui.copyDetails.addEventListener('click', async () => {
        const state = loadState();
        const lines = copyableDetailText(
          buildDetailGroups(stats(state), effectiveBudgets(), hasConfirmedContext(state)));
        try {
          await navigator.clipboard.writeText(lines);
          showToast('Details copied.');
        } catch {
          showToast('Clipboard unavailable. Select Details text to copy.');
        }
      });
    }
    prepareUiControls(section);
  }

export { setPanelView, mountPanelView };
