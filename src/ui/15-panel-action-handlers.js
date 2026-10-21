import { pendingTransientPromotions } from '../runtime/01-runtime-ledger-state.js';
import { isWatchdogPaused, requestRunStateSync } from '../runtime/01-runtime-pause-state.js';
import { cancelPausedFileJobs } from '../attachments/06-attachment-reading.js';
import { completedRevisions, currentChatKey, lastUiSignals, perf, revisionTargets, setFailedScanDraft, setLastBackfillDeferred, setLastCommit, setLastScanReason, setLastUiSignals, setSettings, setTransientState, settings } from '../runtime/01-runtime-capture-state.js';
import { APP } from '../runtime/01-runtime-configuration.js';
import { deferredConversationFrame, setCalibrationHistoryCorrupt, setDeferredConversationFrame, setDirtyFileTurns, setHistoryCache, setHistorySummaryCache, setInspectedFileTurns, setInspectedImageTurns, setDirtyImageTurns } from '../runtime/01-runtime-dom-state.js';
import { corruptLedgerKeys, invalidateLedgerJobs, invalidateLedgerReadSnapshots, ledgerResetEpochs, pendingFileResults, setStorageWarningShown, storageFailures } from '../runtime/01-runtime-ledger-state.js';
import { hydrationCandidates, hydrationCheckTimer, setHydrationCheckTimer } from '../runtime/01-runtime-session-state.js';
import { pendingLocalFiles, ui } from '../runtime/01-runtime-ui-state.js';
import { resetPerformance } from '../runtime/02-profiling.js';
import { clearUiErrors } from '../runtime/01-runtime-error-journal.js';
import { emptyState } from '../core/03-ledger-schema.js';
import { reportStorageFailure, stateKey } from '../storage/03-ledger-foundation.js';
import { loadState } from '../storage/03-ledger-repository.js';
import { loadSettings } from '../storage/03-settings-store.js';
import { saveSettings } from '../storage/03-storage-io.js';
import { applyAppearance, changeViewPreference, syncViewControls } from './08-theme-budgets.js';
import { refreshBadgeSiteIcon } from './12-panel-site-icon.js';
import { clearAuditConfirmation } from '../app/10-audit-repair.js';
import { downloadMessageIds, repairConfirmedShortRecords, runAudit, undoLastAuditRepair } from './15-panel-audit-actions.js';
import { stats } from '../app/11-ledger-statistics.js';
import { scanMessages } from '../app/11-message-scan.js';
import { requestBackfill, requestInitialInspection, setCompletionPending } from '../app/11-route-inspection.js';
import { LAZY_APPEARANCE_MARKUP, LAZY_SECTION_MARKUP } from './13-panel-markup.js';
import { fitPanelDialogToPanel } from './15-panel-dialog-geometry.js';
import { placePanel, restoreDefaultBadgeAnchor } from './12-panel-position.js';
import { closeAboutDialog, closeLimitDialog, closeSettingsDialog, confirmChatLimitDialog, bindPanelDialogDismissal, requestPanelConfirmation, settlePanelConfirmation } from './15-panel-dialog-lifecycle.js';
import { SETTING_GROUPS, bindSettingsGroup, discardUnsavedSettingsInputs, syncGroupInputs } from './15-panel-settings-controls.js';
import { bindHandoffEditor, syncHandoffEditor } from './15-panel-handoff-settings.js';
import { render, renderDiagnostics, renderPerformance, renderRunState, showToast, showUnexpectedError } from './16-panel-rendering.js';
import { readComposerControlsForDiagnostics } from '../chatgpt/09-dom-composer-state.js';
import { refreshUiFields, prepareUiControls } from './14-panel-components.js';
import { bindMiniNavigation } from './14-panel-mini-navigation.js';

  function bindPanelDialogActions(kind) {
    if (kind === 'settings') {
      ui.closeSettings.addEventListener('click', closeSettingsDialog);
      bindPanelDialogDismissal(ui.settingsDialog, closeSettingsDialog);
      bindMiniNavigation(ui.settingsDialog.querySelector('.cw-tools-nav'), 'data-cw-tools', {
        view: { pane: ui.settingsDialog.querySelector('#cw-tools-view'), mount: () => {
          const pane = ui.settingsDialog.querySelector('#cw-tools-view');
          if (pane.dataset.mounted === 'true') return;
          pane.innerHTML = LAZY_APPEARANCE_MARKUP;
          pane.dataset.mounted = 'true';
          for (const button of pane.querySelectorAll('[data-cw-view-style], [data-cw-view-theme], [data-cw-view-logo]')) {
            button.addEventListener('click', () => changeViewPreference(
              button.hasAttribute('data-cw-view-style') ? 'style' :
                button.hasAttribute('data-cw-view-logo') ? 'logo' : 'theme',
              button.dataset.cwViewStyle || button.dataset.cwViewTheme || button.dataset.cwViewLogo));
          }
          syncViewControls();
          prepareUiControls(pane);
        } },
        technical: { pane: ui.settingsDialog.querySelector('#cw-tools-technical'), mount: () => {
          const pane = ui.settingsDialog.querySelector('#cw-tools-technical');
          if (pane.dataset.mounted === 'true') return;
          pane.insertAdjacentHTML('beforeend', LAZY_SECTION_MARKUP.technicalForm);
          pane.dataset.mounted = 'true';
          refreshUiFields();
          bindSettingsGroup('technical');
          bindHandoffEditor();
          prepareUiControls(pane);
        } },
        diagnostics: { pane: ui.diagnosticsDetails, mount: () => {
          mountPanelSubsection('diagnostics');
          const state = loadState();
          renderDiagnostics(stats(state), state);
          renderRunState(); // Lazy controls must inherit the active Pause state.
        } },
        performance: { pane: ui.performanceDetails, mount: () => {
          mountPanelSubsection('performance');
          renderPerformance();
        } }
      }, true, selected => { if (SETTING_GROUPS[selected]) syncGroupInputs(selected); }, { mode: 'tabs' });
      // Initialize Appearance only once. Reopening this mounted dialog retains
      // its chosen category; lazily created panes keep their controls/drafts.
      ui.settingsDialog.querySelector('[data-cw-tools="view"]').click();
      // Maintenance actions are bound once with the Settings dialog.
          ui.resetPosition.addEventListener('click', () => {
      settings.badgePosition = null;
      if (!saveSettings()) { setSettings(loadSettings()); return; }

      restoreDefaultBadgeAnchor(ui.root, !ui.panel.hidden);
      if (!ui.panel.hidden) {
        placePanel();
        fitPanelDialogToPanel();
      }

      showToast('Badge position reset.');
    });
    ui.resetChat.addEventListener('click', () => {
      requestPanelConfirmation(
        'Reset local counts for this chat? The Watchdog will then collect already finished messages as they reappear in the DOM (including on scroll). Unseen messages cannot be recovered.',
        () => {
      if (currentChatKey) {
        try {
          localStorage.removeItem(stateKey());
          // The per-chat epoch below rejects old drafts, including null baselines.
          pendingTransientPromotions.delete(currentChatKey);
          invalidateLedgerJobs(currentChatKey);
          cancelPausedFileJobs(currentChatKey);
          setFailedScanDraft(null);
          revisionTargets.clear();
          completedRevisions.clear();
          corruptLedgerKeys.delete(currentChatKey);
          storageFailures.delete(currentChatKey);
          setStorageWarningShown(false);
        } catch (err) {
          reportStorageFailure(currentChatKey, 'RESET FAILED: localStorage could not remove this entry.', err);
          render(loadState());
          return;
        }
      } else setTransientState(emptyState(null));
      pendingLocalFiles.length = 0; // A reset cannot keep an outgoing draft association.
      clearAuditConfirmation(); // Prevent pre-reset results from being shown.
      hydrationCandidates.clear();
      setInspectedFileTurns(new WeakMap()); // Reset must rediscover visible file cards.
      setInspectedImageTurns(new WeakMap()); // The old image slots were deleted.
      setLastBackfillDeferred(0);
      requestInitialInspection();
      requestBackfill();
      if (!isWatchdogPaused()) scanMessages({ backfill: true, reason: 'state reset / visible-message backfill' });
      showToast('Chat reset. Finished messages are collected again when visible.');
        });
    });
    ui.clearWatchdogData.addEventListener('click', () => {
      requestPanelConfirmation(
        'Permanently delete ALL Context Watchdog local data on this site?\n' +
        'This includes every chat ledger, calibration history, settings and panel position.\n' +
        'ChatGPT conversations and unrelated site data will not be deleted.\n' +
        'Visible finished messages may be indexed again without reloading ChatGPT.',
        () => {
      // A single live UI coordinate is the only old value retained across Wipe.
      // This does not copy ledger, settings or other application RAM data.
      const rect = ui.chip.getBoundingClientRect();
      const badgePosition = { left: Math.round(rect.left), top: Math.round(rect.top) };
      try {
        const owned = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(`${APP}:`)) owned.push(key);
        }
        for (const key of owned) localStorage.removeItem(key);
        // Do not announce success if a storage implementation silently
        // retained any owned key. There must be a fully cleared boundary.
        for (let i = 0; i < localStorage.length; i++) {
          if (localStorage.key(i)?.startsWith(`${APP}:`))
            throw new Error('Watchdog storage still contains owned keys');
        }
      } catch (err) {
        showUnexpectedError('Wipe', err, 'Wipe incomplete');
        return;
      }
      clearUiErrors(); // The previous session's volatile error references are wiped too.
      // Wipe old application RAM after the durable deletion boundary. Epochs
      // remain as tombstones so old async callbacks cannot recreate ledgers.
      const invalidatedChats = new Set([
        ...ledgerResetEpochs.keys(), currentChatKey,
        ...pendingTransientPromotions.keys(),
        ...[...pendingFileResults.values()].map(job => job.chatKey)
      ]);
      for (const chatKey of invalidatedChats) invalidateLedgerJobs(chatKey);
      pendingFileResults.clear();
      cancelPausedFileJobs();
      invalidateLedgerReadSnapshots();
      pendingTransientPromotions.clear();
      pendingLocalFiles.length = 0;
      revisionTargets.clear();
      completedRevisions.clear();
      setFailedScanDraft(null);
      setTransientState(emptyState(null));
      setLastCommit(null);
      setLastUiSignals({ stop: false, send: false, actions: null });
      setLastScanReason('Watchdog data wiped');
      setLastBackfillDeferred(0);
      hydrationCandidates.clear();
      if (hydrationCheckTimer) clearTimeout(hydrationCheckTimer);
      setHydrationCheckTimer(0);
      if (deferredConversationFrame) cancelAnimationFrame(deferredConversationFrame);
      setDeferredConversationFrame(0);
      setInspectedFileTurns(new WeakMap());
      setInspectedImageTurns(new WeakMap());
      setDirtyFileTurns(new WeakSet());
      setDirtyImageTurns(new WeakSet());
      clearAuditConfirmation();
      corruptLedgerKeys.clear();
      storageFailures.clear();
      setStorageWarningShown(false);
      setHistoryCache(null);
      setHistorySummaryCache(null);
      setCalibrationHistoryCorrupt(false);
      // Recreate defaults from clean storage, not from the previous RAM object.
      setSettings(loadSettings());
      settings.badgePosition = badgePosition;
      const badgePositionSaved = saveSettings();
      requestRunStateSync(); // One new post-Wipe settings record.
      resetPerformance();
      perf.enabled = false;
      requestInitialInspection();
      requestBackfill();
      setCompletionPending(false);
      // Do not rebuild the UI or touch left/top, active tabs, scroll or dialogs.
      // Confirm was closed by settlePanelConfirmation(); Settings stays open.
      applyAppearance();
      // Retry the cache-only icon display after Wipe, but if saving the new
      // position failed, do not let a later favicon fallback recreate settings.
      refreshBadgeSiteIcon(true, badgePositionSaved);
      syncViewControls();
      discardUnsavedSettingsInputs();
      syncHandoffEditor(true);
      renderPerformance();
      render(loadState());
      showToast(badgePositionSaved ? 'Watchdog data cleared.' :
        'Watchdog data cleared; could not save the current badge position.');
        });
    });
    } else if (kind === 'about') {
      ui.closeAbout.addEventListener('click', closeAboutDialog);
      bindPanelDialogDismissal(ui.aboutDialog, closeAboutDialog);
      // Lightweight, independently collapsible help categories. Mount once
      // before the dialog opens so the initial content fit is accurate.
      ui.aboutGlossary.insertAdjacentHTML('beforeend', LAZY_SECTION_MARKUP.aboutHelp);
      ui.aboutGlossary.dataset.mounted = 'true';
      // Native <details> preserves each About section's open state.
    } else if (kind === 'confirm') {
      ui.closeConfirm.addEventListener('click', () => settlePanelConfirmation(false));
      ui.cancelConfirm.addEventListener('click', () => settlePanelConfirmation(false));
      ui.confirmOk.addEventListener('click', () => settlePanelConfirmation(true));
      bindPanelDialogDismissal(ui.confirmDialog, () => settlePanelConfirmation(false));
      ui.confirmDialog.addEventListener('close', () => settlePanelConfirmation(false));
    } else {
      ui.closeLimit.addEventListener('click', closeLimitDialog);
      ui.cancelLimit.addEventListener('click', closeLimitDialog);
      bindPanelDialogDismissal(ui.limitDialog, closeLimitDialog);
      ui.confirmLimit.addEventListener('click', confirmChatLimitDialog);
    }
  }

  function mountPanelSubsection(kind) {
    const details = kind === 'diagnostics' ? ui.diagnosticsDetails : ui.performanceDetails;
    if (details.dataset.mounted === 'true') return;
    details.insertAdjacentHTML('beforeend', LAZY_SECTION_MARKUP[kind]);
    details.dataset.mounted = 'true';
    refreshUiFields();
    if (kind === 'diagnostics') {
          ui.copyDiagnostics.addEventListener('click', async () => {
      // Copy is read-only. Refresh only the lightweight Stop/Send snapshot;
      // never run the conversation coordinator or trigger ledger captures.
      const state = loadState();
      const controls = readComposerControlsForDiagnostics();
      renderDiagnostics(stats(state), state, {
        ...lastUiSignals,
        ...controls,
        actions: controls.stop || controls.send ? null : lastUiSignals.actions
      });
      try {
        await navigator.clipboard.writeText(ui.diagnosticsLine.textContent || '');
        showToast('Diagnostics copied.');
      } catch {
        showToast('Clipboard unavailable. Select diagnostics text to copy.');
      }
    });
    ui.exportIds.addEventListener('click', downloadMessageIds);
    ui.repairShort.addEventListener('click', repairConfirmedShortRecords);
    ui.undoRepair.addEventListener('click', undoLastAuditRepair);
    ui.rescan.addEventListener('click', () => {
      const audit = runAudit();
      if (!audit) return;
      const state = loadState();
      renderDiagnostics(stats(state), state);
      // Audit is read-only; geometry may grow only when the report gains height.
      if (audit.routeUnverified) {
        showToast('Audit completed read-only: chat DOM still switching; results are provisional.');
        return;
      }
      const issues = audit.missing + audit.storedShort + audit.domShort +
        audit.different + audit.roleChanged + audit.noStableId +
        audit.duplicateIds + audit.ambiguous + audit.unhydrated;
      showToast(issues
        ? `Audit: ${issues} possible issues, ${audit.verified} verified. See Diagnostics.`
        : `Audit: ${audit.verified} verified, no detected issues in rendered messages.`);
    });
    } else {
          ui.performanceToggle.addEventListener('click', () => {
      perf.enabled = !perf.enabled;
      // The shared dialog fitter follows the content in both directions.
      renderPerformance();
      fitPanelDialogToPanel();
      showToast(perf.enabled ? 'Profiling enabled.' : 'Profiling paused.');
    });
    ui.performanceCopy.addEventListener('click', async () => {
      renderPerformance();
      try {
        await navigator.clipboard.writeText(ui.performanceLine.textContent || '');
        showToast('Metrics copied.');
      } catch {
        showToast('Clipboard unavailable. Select Performance text to copy.');
      }
    });
    ui.performanceReset.addEventListener('click', () => {
      resetPerformance();
      renderPerformance();
      // The shared dialog observer refits only if the content height changes.
      showToast('Counters reset.');
    });
    }
    prepareUiControls(details);
  }

export { bindPanelDialogActions, mountPanelSubsection };
