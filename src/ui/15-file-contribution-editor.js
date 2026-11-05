import { settings } from '../runtime/01-runtime-capture-state.js';
import {
  PERCENT_FIELDS, MAX_EXTENSION_RULES, normalizedExtension,
  parseContributionPercent
} from '../core/file-contribution-rules.js';

// The editable rows are temporary DOM drafts. Nothing is persisted until the
// parent Files & images Save button validates every field and saves settings.
function bindFileContributionEditor(root) {
  const rows = root.querySelector('.cw-file-rule-rows');
  const extensionInput = root.querySelector('.cw-file-rule-extension');
  const addButton = root.querySelector('.cw-file-rule-add');
  if (!rows || !extensionInput || !addButton) throw new Error('Missing file contribution editor');
  let dirty = false;

  function addRow(ext, rule) {
    const row = document.createElement('div');
    row.className = 'cw-file-rule-row';
    row.dataset.extension = ext;
    const name = document.createElement('span');
    name.className = 'cw-file-rule-name';
    name.textContent = `.${ext}`;
    row.append(name);
    for (const kind of ['parsed', 'metadata']) {
      const pair = document.createElement('div');
      pair.className = 'cw-file-rule-pair';
      for (const edge of ['Min', 'Max']) {
        if (edge === 'Max') {
          const dash = document.createElement('span');
          dash.textContent = '–';
          dash.setAttribute('aria-hidden', 'true');
          pair.append(dash);
        }
        const field = `${kind}${edge}`;
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.max = '100';
        input.step = '0.01';
        input.value = String(rule[field]);
        input.dataset.field = field;
        input.setAttribute('aria-label', `.${ext} ${kind} ${edge.toLowerCase()} percentage`);
        pair.append(input);
      }
      row.append(pair);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'cw-file-rule-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove .${ext} rule`);
    row.append(remove);
    rows.append(row);
  }

  function sync(force = false) {
    if (!force && dirty) return;
    rows.replaceChildren();
    for (const [ext, rule] of Object.entries(settings.fileContributionByExt || {}).sort(
      ([a], [b]) => a.localeCompare(b))) addRow(ext, rule);
    extensionInput.value = '';
    dirty = false;
  }

  function read() {
    const result = {};
    for (const row of rows.querySelectorAll('.cw-file-rule-row')) {
      const ext = normalizedExtension(row.dataset.extension);
      if (!ext || Object.hasOwn(result, ext)) return null;
      const rule = {};
      for (const field of PERCENT_FIELDS) {
        const input = row.querySelector(`[data-field="${field}"]`);
        const value = input ? parseContributionPercent(input.value) : null;
        if (value === null) return null;
        rule[field] = value;
      }
      if (rule.parsedMin > rule.parsedMax || rule.metadataMin > rule.metadataMax) return null;
      Object.defineProperty(result, ext, {value: rule, enumerable: true, configurable: true, writable: true});
    }
    return result;
  }

  rows.addEventListener('input', () => { dirty = true; });
  rows.addEventListener('click', event => {
    const remove = event.target.closest?.('.cw-file-rule-remove');
    if (!remove || !rows.contains(remove)) return;
    remove.closest('.cw-file-rule-row')?.remove();
    dirty = true;
  });
  addButton.addEventListener('click', () => {
    const ext = normalizedExtension(extensionInput.value);
    if (!ext || rows.children.length >= MAX_EXTENSION_RULES ||
        [...rows.children].some(row => row.dataset.extension === ext)) {
      extensionInput.setCustomValidity('Enter a unique extension (1–16 letters or digits).');
      extensionInput.reportValidity();
      return;
    }
    extensionInput.setCustomValidity('');
    // A newly added rule starts at current general estimates, never at an
    // arbitrary JSON-specific weight. It remains unsaved until Save.
    addRow(ext, {
      parsedMin: Number(root.querySelector('.cw-file-opt').value),
      parsedMax: Number(root.querySelector('.cw-file-pess').value),
      metadataMin: Number(root.querySelector('.cw-metadata-file-opt').value),
      metadataMax: Number(root.querySelector('.cw-metadata-file-pess').value)
    });
    extensionInput.value = '';
    dirty = true;
  });
  extensionInput.addEventListener('input', () => extensionInput.setCustomValidity(''));
  sync(true);
  return {sync, read};
}

export { bindFileContributionEditor };
