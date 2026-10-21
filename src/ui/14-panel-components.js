import { ui } from '../runtime/01-runtime-ui-state.js';
import { clamp } from './12-panel-clamp.js';

  const PANEL_VIEWS = ['context', 'budget', 'details'];

  const UI_FIELDS = `
    chip siteIcon average pausedLabel:paused-label chipStatus:chip-status pauseToggle:pause-toggle pauseControl:pause-control panelFrame:panel-frame panel panelMain:panel-main settingsScrim:settings-scrim contextTab:tab-context budgetTab:tab-budget detailsTab:tab-details
    contextView:view-context budgetView:view-budget detailsView:view-details budgetTabMark:budget-tab-status
    dataChars dataTokens dataFiles dataQuality dataQualityExtra dataImagesRow dataImages contextMessages:context-messages contextRange:context-range
    forecastHeading forecastCards budgetUnavailable forecastOpt forecastPess status percentOptC percentOptN percentOptO
    percentPessC percentPessN percentPessO progressOptC progressOptN progressOptO
    progressPessC progressPessN progressPessO detailsReport copyDetails
    storageWarning storageIndicator historyDetails:history-details diagnosticsDetails:diagnostics-tools
    diagnosticsLine recentErrorsList:recent-errors-list copyDiagnostics exportIds
    repairShort undoRepair history
    performanceDetails performanceLine performanceToggle performanceCopy performanceReset
    confirmDialog:confirm-dialog confirmDescription:confirm-description closeConfirm cancelConfirm confirmOk
    toast pinBtn:pin-panel detailHandoff:handoff-details endChat rescan
    settingsBtn settingsDialog:settings-dialog closeSettings aboutBtn aboutDialog:about-dialog closeAbout aboutGlossary:about-glossary limitDialog:limit-dialog closeLimit cancelLimit confirmLimit limitTokens limitOptimistic limitPessimistic limitReplacement budgetC budgetN budgetO saveBudget
    attachmentSettings:attachment-settings historicalFileFallback:historical-file-fallback imageAverage
    localFileLimit:local-file-limit limitWarning:limit-warning saveAttachments
    metadataOptBase:metadata-opt-base metadataOptSize:metadata-opt-size metadataOptMax:metadata-opt-max
    metadataPessBase:metadata-pess-base metadataPessSize:metadata-pess-size metadataPessMax:metadata-pess-max
    metadataSpreadsheet:metadata-spreadsheet metadataTextCode:metadata-text-code metadataPdf:metadata-pdf
    metadataDocument:metadata-document metadataPresentation:metadata-presentation metadataArchive:metadata-archive metadataOther:metadata-other
    advancedAttachments:advanced-attachments fileOpt:file-opt filePess:file-pess imageOpt:image-opt imagePess:image-pess
    pastedMinChars:pasted-min-chars pastedEnglishRatio:pasted-english-ratio pastedCyrillicRatio:pasted-cyrillic-ratio
    saveAttachmentCoefficients:save-attachment-coefficients resetAttachmentAdvanced:reset-attachment-advanced resetAttachments
    textSettingsDetails:text-settings-details proseCyrillicRatio:prose-cyrillic-ratio proseLatinRatio:prose-latin-ratio
    proseDigitsRatio:prose-digits-ratio prosePunctuationRatio:prose-punctuation-ratio
    proseOtherRatio:prose-other-ratio proseWordFloor:prose-word-floor codeRatio:code-ratio
    saveTextEstimation:save-text-estimation resetTextEstimation:reset-text-estimation resetBudget resetSettings clearWatchdogData
    messageOverhead hiddenOptimistic hiddenPessimistic
    historyPriorStrength saveSettings resetPosition resetChat dialogMessage:dialog-message
  `.trim().split(/\s+/);

  function collectUiFields(root) {
    return Object.fromEntries(UI_FIELDS.map(entry => {
      const [field, override] = entry.split(':');
      const suffix = override || field.replace(/[A-Z]/g, ch => `-${ch.toLowerCase()}`);
      const selector = field === 'settingsDialog'
        ? '.cw-settings-dialog:not(.cw-about-dialog):not(.cw-limit-dialog):not(.cw-confirm-dialog)' : `.cw-${suffix}`;
      return [field, root.querySelector(selector)];
    }));
  }

  function refreshUiFields() {
    if (ui) Object.assign(ui, collectUiFields(ui.root));
  }

  // Only the shell and badge exist at startup. Each view is mounted once on use.
  // Mini-navigation only selects visible UI; it never gates message collection.
  // Each pane is created and bound at most once, and its drafts remain in memory.
  const UI_HINTS = Object.freeze({
    'cw-tab-context': 'Show text, files, images and their estimation settings.',
    'cw-tab-budget': 'Show budget forecasts, usage percentages, limits and calibration.',
    'cw-tab-details': 'Show and copy the detailed report for this chat.',
    'cw-pin-panel': 'Keep the main panel open while clicking in ChatGPT. Click again to unpin.',
    'cw-mini-tab': 'Open these settings without leaving the current view.',
    'cw-budget-editor': 'Change Conservative, Normal and Generous budget limits.',
    'cw-copy-details': 'Copy all figures from the detailed context report.',
    'cw-close-settings': 'Close Settings; unsaved HANDOFF edits remain in this session, other drafts are discarded.',
    'cw-close-about': 'Close the About window.',
    'cw-close-limit': 'Cancel without recording a chat limit.',
    'cw-close-confirm': 'Cancel this operation.',
    'cw-cancel-confirm': 'Cancel this operation without changing data.',
    'cw-confirm-ok': 'Confirm and carry out this operation.',
    'cw-cancel-limit': 'Close the dialog without saving calibration.',
    'cw-confirm-limit': 'Record this chat limit and recalibrate token budgets.',
    'cw-save-text-estimation': 'Save the current text token estimation parameters.',
    'cw-reset-text-estimation': 'Restore default text token coefficients and Message overhead.',
    'cw-save-attachments': 'Save all Files & images settings, including metadata-only estimation.',
    'cw-reset-attachments': 'Restore defaults for all Files & images settings.',
    'cw-save-attachment-coefficients': 'Save file, image and pasted-text forecast weights.',
    'cw-reset-attachment-advanced': 'Restore default attachment contribution coefficients.',
    'cw-save-budget': 'Save Conservative, Normal and Generous budgets.',
    'cw-reset-budget': 'Restore default token budgets; recorded samples remain for future calibration.',
    'cw-save-settings': 'Save hidden-context allowances and strength for future calibration.',
    'cw-save-handoff': 'Apply and save the edited HANDOFF prompt globally.',
    'cw-restore-handoff': 'Restore the built-in HANDOFF text in the editor, without applying it until Save.',
    'cw-reset-settings': 'Restore default technical parameters without clearing calibration history.',
    'cw-reset-position': 'Restore the default mini-badge position.',
    'cw-reset-chat': 'Reset Watchdog records for this chat only. Confirmation required.',
    'cw-clear-watchdog-data': 'Delete every local Watchdog record and preference. Confirmation required.',
    'cw-rescan': 'Read-only audit of messages currently visible in the chat.',
    'cw-copy-diagnostics': 'Copy the latest diagnostics text to the clipboard.',
    'cw-export-ids': 'Export known message UUIDs as a local TSV file.',
    'cw-repair-short': 'Repair only confirmed incomplete ledger entries; requires confirmation.',
    'cw-undo-repair': 'Undo the latest confirmed repair, if its records are unchanged.',
    'cw-performance-toggle': 'Start or pause in-memory performance measurements.',
    'cw-performance-copy': 'Copy the current in-memory performance metrics to the clipboard.',
    'cw-performance-reset': 'Clear in-memory profiling counters, without modifying the ledger.'
  });
  const DESTRUCTIVE_ACTIONS = new Set(['cw-reset-chat', 'cw-clear-watchdog-data', 'cw-repair-short']);
  const NORMAL_ACTIONS = new Set([
    'cw-save-text-estimation','cw-reset-text-estimation','cw-save-attachments',
    'cw-reset-attachments','cw-save-attachment-coefficients','cw-reset-attachment-advanced',
    'cw-save-budget','cw-reset-budget','cw-save-settings','cw-reset-settings',
    'cw-reset-position','cw-copy-details','cw-rescan','cw-copy-diagnostics',
    'cw-export-ids','cw-undo-repair','cw-performance-toggle','cw-performance-copy','cw-performance-reset'
  ]);
  // One tooltip data path for static and state-dependent controls.
  // Never leave a native title competing with the shared floating tooltip.
  function setUiHint(node, text) {
    if (!node) return;
    if (node.dataset.cwTip !== text) node.dataset.cwTip = text;
    node.removeAttribute('title');
  }

  function registerUiHints(scope) {
    for (const node of scope.querySelectorAll('button, input, summary, .cw-field-caption')) {
      if (node.classList.contains('cw-tool-button') || node.classList.contains('cw-chip')) continue;
      const name = [...node.classList].find(cls => UI_HINTS[cls]);
      let hint = node.getAttribute('title') || node.dataset.cwTip || (name ? UI_HINTS[name] : null);
      if (node.classList.contains('cw-mini-tab')) {
        const label = node.textContent.trim();
        if (label === 'Text estimation') hint = 'Estimate tokens in newly captured text and code.';
        else if (label === 'Files & images') hint = 'Configure file fallback, image size and parsing limits.';
        else if (label === 'Attachment weights') hint = 'Configure how files, images and pasted text affect forecasts.';
        else if (label === 'Appearance') hint = 'Change Watchdog style and theme immediately; preferences save automatically.';
        else if (label === 'Technical') hint = 'Edit hidden-context allowances, calibration strength and the global HANDOFF prompt.';
        else if (label === 'Diagnostics') hint = 'Audit, export and explicitly repair local Watchdog records.';
        else if (label === 'Performance') hint = 'View and control in-memory performance profiling.';
        else if (label === 'Token budget & limits') hint = 'View optimistic and pessimistic usage across all three budgets.';
        else if (label === 'History & calibration') hint = 'View recorded chat-limit samples and calibration summary.';
      }
      if (node.tagName === 'INPUT' && !hint) {
        const label = node.closest('label');
        const caption = label?.querySelector('.cw-field-caption');
        hint = caption?.getAttribute('title') || caption?.dataset.cwTip || (label ? `Edit ${label.textContent.trim().replace(/\s+/g, ' ')}.` : 'Edit this numeric setting.');
      }
      if (node.tagName === 'SUMMARY' && !hint) {
        hint = node.closest('.cw-handoff-editor')
          ? 'Expand or collapse the global HANDOFF editor; unsaved text remains in this session.'
          : `Expand or collapse ${node.textContent.trim()}.`;
      }
      if (!hint) continue;
      setUiHint(node, hint);
    }
  }

  // Action appearance is independent of tooltip text and registration.
  // Every lazily mounted pane is prepared through prepareUiControls().
  function registerActionStyles(scope) {
    for (const node of scope.querySelectorAll('button')) {
      const dangerous = [...node.classList].some(name => DESTRUCTIVE_ACTIONS.has(name));
      const normal = !dangerous && [...node.classList].some(name => NORMAL_ACTIONS.has(name));
      node.classList.toggle('cw-danger-action', dangerous);
      node.classList.toggle('cw-text-action', normal);
    }
  }

  function prepareUiControls(scope) {
    registerActionStyles(scope);
    registerUiHints(scope);
  }

  function installUiHints(root) {
    const popup = document.createElement('div');
    popup.className = 'cw-floating-tip';
    popup.setAttribute('role', 'tooltip');
    popup.hidden = true;
    root.appendChild(popup);
    let target = null;
    let timer = 0;
    // Do not recreate a hover tip merely because the pointer remains over the
    // badge at the end of a captured drag. A new hover must start after exit.
    let suppressDraggedBadge = false;
    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = 0; target = null; popup.hidden = true;
    };
    const show = node => {
      if (!node?.isConnected || !node.getClientRects().length) return;
      if (node === ui?.chip && !ui.panel.hidden) return;
      // The badge hint clones the currently displayed safe icon, whether the
      // site-provided SVG or the locally embedded Watchdog brand mask.
      popup.replaceChildren();
      if (node === ui?.chip && !ui.chip.style.borderColor) {
        popup.append('Click on ');
        const icon = ui.siteIcon.cloneNode(true);
        icon.classList.add('cw-tip-logo');
        popup.append(icon, ' to open or close the panel');
      } else {
        popup.textContent = node.dataset.cwTip;
      }
      popup.hidden = false;
      const rect = node.getBoundingClientRect();
      const width = popup.getBoundingClientRect().width;
      const height = popup.getBoundingClientRect().height;
      const left = clamp(rect.left + rect.width / 2 - width / 2, 8, Math.max(8, window.innerWidth - width - 8));
      const top = rect.bottom + 7 + height <= window.innerHeight - 8
        ? rect.bottom + 7 : Math.max(8, rect.top - height - 7);
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    };
    root.addEventListener('cw-badge-dragstart', () => {
      suppressDraggedBadge = true;
      hide(); // Also cancels a badge hint still waiting on its 500ms timer.
    });
    root.addEventListener('mouseover', event => {
      const node = event.target.closest?.('[data-cw-tip]');
      if (!node || node === target || (node === ui?.chip && suppressDraggedBadge)) return;
      hide();
      target = node;
      timer = setTimeout(() => { timer = 0; if (target === node) show(node); }, 500);
    });
    root.addEventListener('mouseout', event => {
      if (suppressDraggedBadge && ui?.chip?.contains(event.target) &&
          !ui.chip.contains(event.relatedTarget)) suppressDraggedBadge = false;
      if (target && !target.contains(event.relatedTarget)) hide();
    });
    root.addEventListener('focusin', event => {
      const node = event.target.closest?.('[data-cw-tip]');
      if (node?.matches(':focus-visible')) { hide(); target = node; show(node); }
    });
    root.addEventListener('focusout', event => {
      if (target && target.contains(event.target)) hide();
    });
    root.addEventListener('click', hide, true);
  }

export { PANEL_VIEWS, UI_FIELDS, collectUiFields, refreshUiFields, UI_HINTS, DESTRUCTIVE_ACTIONS, NORMAL_ACTIONS, setUiHint, registerUiHints, registerActionStyles, prepareUiControls, installUiHints };
