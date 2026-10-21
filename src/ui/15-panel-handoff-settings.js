import { settings } from '../runtime/01-runtime-capture-state.js';
import { HANDOFF_PROMPT, HANDOFF_MAX_CHARS, isValidHandoffPrompt } from '../runtime/01-runtime-configuration.js';
import { ui } from '../runtime/01-runtime-ui-state.js';
import { saveSettings } from '../storage/03-storage-io.js';
import { requestPanelConfirmation } from './15-panel-dialog-lifecycle.js';
import { showToast } from './16-panel-rendering.js';

// A host SPA may replace the Watchdog root without a page reload. The HANDOFF
// draft is session-only: preserve it across that replacement, never in storage.
let detachedDraft = null;

function captureHandoffDraftForRemount() {
  const nodes = handoffEditorNodes();
  detachedDraft = nodes?.field?.dataset.dirty === 'true' ? nodes.field.value : null;
}

function handoffEditorNodes() {
  const dialog = ui?.settingsDialog;
  return dialog && {
    field: dialog.querySelector('.cw-handoff-prompt'),
    counter: dialog.querySelector('.cw-handoff-counter'),
    warning: dialog.querySelector('.cw-handoff-unsaved')
  };
}

// Never replace a draft because the section was collapsed, another tab was
// selected, or an external settings update arrived while it was being edited.
function syncHandoffEditor(resetDraft = false) {
  const nodes = handoffEditorNodes();
  if (!nodes?.field) return;
  if (resetDraft) detachedDraft = null; // Explicit Wipe abandons pending drafts.
  const active = settings.handoffPrompt || HANDOFF_PROMPT;
  // An untouched editor follows storage changes from other tabs. Only an
  // actual local draft survives tab switches, dialog closure and storage events.
  if (resetDraft || nodes.field.dataset.initialized !== 'true' || nodes.field.dataset.dirty !== 'true') {
    nodes.field.value = active;
    nodes.field.dataset.initialized = 'true';
  }
  const changed = nodes.field.value !== active;
  nodes.field.dataset.dirty = String(changed);
  nodes.counter.textContent = `${nodes.field.value.length} / ${HANDOFF_MAX_CHARS}`;
  nodes.warning.hidden = !changed;
}

function bindHandoffEditor() {
  const dialog = ui?.settingsDialog;
  const nodes = handoffEditorNodes();
  if (!nodes?.field || nodes.field.dataset.bound === 'true') return;
  nodes.field.dataset.bound = 'true';
  nodes.field.addEventListener('input', () => {
    nodes.field.dataset.dirty = 'true';
    syncHandoffEditor();
  });
  dialog.querySelector('.cw-save-handoff').addEventListener('click', () => {
    const next = nodes.field.value;
    if (!isValidHandoffPrompt(next)) {
      showToast(`HANDOFF prompt: enter 1–${HANDOFF_MAX_CHARS} characters.`);
      return;
    }
    const previous = settings.handoffPrompt;
    settings.handoffPrompt = next;
    if (!saveSettings()) {
      settings.handoffPrompt = previous;
      syncHandoffEditor();
      showToast('HANDOFF prompt was not saved.');
      return;
    }
    syncHandoffEditor();
    showToast('HANDOFF saved.');
  });
  dialog.querySelector('.cw-restore-handoff').addEventListener('click', () => {
    requestPanelConfirmation('Restore the original HANDOFF prompt in the editor? The active prompt will not change until Save.', () => {
      nodes.field.value = HANDOFF_PROMPT;
      nodes.field.dataset.dirty = 'true';
      syncHandoffEditor();
    });
  });
  if (detachedDraft !== null) {
    nodes.field.value = detachedDraft;
    nodes.field.dataset.initialized = 'true';
    nodes.field.dataset.dirty = 'true';
    detachedDraft = null;
    syncHandoffEditor();
  } else syncHandoffEditor(true);
}

export { HANDOFF_MAX_CHARS, bindHandoffEditor, syncHandoffEditor, captureHandoffDraftForRemount };
