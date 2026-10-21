import { setSettings, settings } from '../runtime/01-runtime-capture-state.js';
import { DEFAULTS, METADATA_SETTING_SPECS } from '../runtime/01-runtime-configuration.js';
import { NUMERIC_SETTING_SPECS, numericStep, normalizeNumericSetting } from '../runtime/01-numeric-settings.js';
import { ui } from '../runtime/01-runtime-ui-state.js';
import { loadState } from '../storage/03-ledger-repository.js';
import { loadSettings } from '../storage/03-settings-store.js';
import { saveSettings } from '../storage/03-storage-io.js';
import { requestPanelConfirmation } from './15-panel-dialog-lifecycle.js';
import { render, showToast } from './16-panel-rendering.js';

  const SETTING_GROUPS = Object.freeze({
    text: {
      label: 'Text token estimation',
      fields: [
        ['messageOverhead', 'messageOverhead'],
        ['proseCyrillicRatio', 'proseCyrillicCharsPerToken'],
        ['proseLatinRatio', 'proseLatinCharsPerToken'],
        ['proseDigitsRatio', 'proseDigitsCharsPerToken'],
        ['prosePunctuationRatio', 'prosePunctuationCharsPerToken'],
        ['proseOtherRatio', 'proseOtherCharsPerToken'],
        ['proseWordFloor', 'proseMinTokensPerWord'],
        ['codeRatio', 'codeCharsPerToken']
      ], save: 'saveTextEstimation', reset: 'resetTextEstimation'
    },
    attachment: {
      label: 'Files & images',
      fields: [
        ['historicalFileFallback', 'historicalFileFallbackTokens'],
        ['imageAverage', 'averageImageTokens'],
        ['localFileLimit', 'localFileParsingLimitMiB'],
        ...METADATA_SETTING_SPECS.map(spec => [spec.field, spec.key])
      ], save: 'saveAttachments', reset: 'resetAttachments'
    },
    coefficients: {
      label: 'Attachment estimation coefficients',
      fields: [
        ['fileOpt', 'fileOptimisticPct'],
        ['filePess', 'filePessimisticPct'],
        ['imageOpt', 'imageOptimisticPct'],
        ['imagePess', 'imagePessimisticPct'],
        ['pastedMinChars', 'pastedMinChars'],
        ['pastedEnglishRatio', 'pastedEnglishCharsPerToken'],
        ['pastedCyrillicRatio', 'pastedCyrillicCharsPerToken']
      ], save: 'saveAttachmentCoefficients', reset: 'resetAttachmentAdvanced'
    },
    budget: {
      label: 'Budget settings',
      fields: [
        ['budgetC', 'conservativeBudget'],
        ['budgetN', 'normalBudget'],
        ['budgetO', 'optimisticBudget']
      ], save: 'saveBudget', reset: 'resetBudget'
    },
    technical: {
      label: 'Technical settings',
      fields: [
        ['hiddenOptimistic', 'hiddenOptimistic'],
        ['hiddenPessimistic', 'hiddenPessimistic'],
        ['historyPriorStrength', 'historyPriorStrength']
      ], save: 'saveSettings', reset: 'resetSettings'
    }
  });

  function validateSettingsGroup(group, updates) {
    if (group === 'attachment') {
      return updates.metadataOnlyOptimisticBase <= updates.metadataOnlyPessimisticBase &&
        updates.metadataOnlyOptimisticSizeFactor <= updates.metadataOnlyPessimisticSizeFactor &&
        updates.metadataOnlyOptimisticMax <= updates.metadataOnlyPessimisticMax;
    }
    if (group === 'budget') {
      return updates.conservativeBudget <= updates.normalBudget &&
        updates.normalBudget <= updates.optimisticBudget;
    }
    if (group === 'technical') return updates.hiddenOptimistic <= updates.hiddenPessimistic;
    if (group === 'coefficients') {
      return updates.fileOptimisticPct <= updates.filePessimisticPct &&
        updates.imageOptimisticPct <= updates.imagePessimisticPct;
    }
    return true;
  }

  // An edited value survives blur, a tab switch and an external storage event.
  function syncGroupInputs(group, force = false) {
    if (!ui) return;
    for (const [field, key] of SETTING_GROUPS[group].fields) {
      const input = ui[field];
      if (!input) continue; // Group DOM has never been created.
      if (!force && (input.dataset.dirty === '1' || input === document.activeElement)) continue;
      input.value = String(settings[key]);
      if (force) delete input.dataset.dirty;
    }
    if (group === 'attachment' && ui.localFileLimit) updateLimitWarning();
  }
  // Draft edits in lazy-mounted forms are never ledger changes. Leaving the
  // interface discards unsaved inputs and clears their dirty flags, while
  // preserving settings saved explicitly with Save (or autosaved in View).
  function discardUnsavedSettingsInputs() {
    for (const group of Object.keys(SETTING_GROUPS)) syncGroupInputs(group, true);
  }


  function updateLimitWarning() {
    if (!ui?.localFileLimit) return;
    const value = Number(ui.localFileLimit.value);
    ui.limitWarning.hidden = !ui.localFileLimit.value.trim() ||
      !Number.isFinite(value) || (value <= 80);
    if (!ui.limitWarning.hidden) {
      const message = 'Above recommended range (70–80 MiB): local parsing may use more memory';
      ui.limitWarning.title = message;
      ui.limitWarning.setAttribute('aria-label', message);
      ui.localFileLimit.dataset.cwTip = message;
    } else {
      ui.localFileLimit.dataset.cwTip = 'Maximum file size for local parsing. Larger files use metadata only. Recommended: 75 MiB.';
    }
  }

  function bindSettingsGroup(group) {
    const definition = SETTING_GROUPS[group];
    const controls = definition.fields.map(([field]) => ui[field]);
    if (controls.some(node => !node)) throw new Error(`Missing ${group} setting input`);
    for (const [field, key] of definition.fields) {
      const input = ui[field];
      const spec = NUMERIC_SETTING_SPECS[key];
      if (!spec) throw new Error(`Missing numeric specification: ${key}`);
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(numericStep(key));
      input.addEventListener('input', () => {
        input.dataset.dirty = '1';
        if (group === 'attachment' && input === ui.localFileLimit) updateLimitWarning();
      });
      input.addEventListener('blur', () => {
        if (input.dataset.dirty !== '1') return;
        const raw = input.value.trim();
        if (!raw) return; // Invalid/empty input remains visible for Save validation.
        const normalized = normalizeNumericSetting(key, Number(raw));
        if (normalized !== null) input.value = String(normalized);
        if (group === 'attachment' && input === ui.localFileLimit) updateLimitWarning();
      });
    }
    ui[definition.save].addEventListener('click', () => {
      const updates = {};
      for (const [field, key] of definition.fields) {
        const input = ui[field];
        if (input.dataset.dirty !== '1') {
          // Preserve stored values, including off-grid calibration and legacy settings.
          updates[key] = settings[key];
          continue;
        }
        const raw = input.value.trim();
        const normalized = raw ? normalizeNumericSetting(key, Number(raw)) : null;
        if (normalized === null) {
          showToast(`${definition.label}: invalid value or range.`);
          return;
        }
        updates[key] = normalized;
      }
      if (!validateSettingsGroup(group, updates)) {
        showToast(`${definition.label}: values must be in the correct order.`);
        return;
      }
      if (group === 'budget') {
        Object.assign(updates, {
          budgetCalibrationBase: {
            conservativeBudget: updates.conservativeBudget,
            normalBudget: updates.normalBudget,
            optimisticBudget: updates.optimisticBudget
          },
          budgetCalibrationWeight: 0
        });
      }
      if (saveConfiguredValues(updates, `${definition.label} saved.`)) syncGroupInputs(group, true);
    });
    ui[definition.reset].addEventListener('click', () => {
      requestPanelConfirmation(`Restore defaults for ${definition.label}? Only this group will be reset.`, () => {
      const updates = Object.fromEntries(definition.fields.map(([,key]) => [key, DEFAULTS[key]]));
      if (group === 'budget') {
        updates.budgetCalibrationBase = {
          conservativeBudget: DEFAULTS.conservativeBudget,
          normalBudget: DEFAULTS.normalBudget,
          optimisticBudget: DEFAULTS.optimisticBudget
        };
        updates.budgetCalibrationWeight = 0;
      }
      if (saveConfiguredValues(updates, `${definition.label}: defaults restored.`))
        syncGroupInputs(group, true);
      });
    });
    syncGroupInputs(group, true);
  }

  function saveConfiguredValues(values, successText) {
    Object.assign(settings, values);
    if (!saveSettings()) { setSettings(loadSettings()); render(loadState()); return false; }
    // Saving settings must not write the per-chat ledger just to manage
    // obsolete one-shot budget notifications.
    render(loadState());
    showToast(successText);
    return true;
  }

export { SETTING_GROUPS, validateSettingsGroup, syncGroupInputs, discardUnsavedSettingsInputs, updateLimitWarning, bindSettingsGroup, saveConfiguredValues };
