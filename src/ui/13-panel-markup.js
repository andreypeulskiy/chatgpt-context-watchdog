import { APP, HANDOFF_MAX_CHARS } from '../runtime/01-runtime-configuration.js';
  // Actual inputs are not created or populated until their section is opened.
  // The markup strings have no listeners or DOM nodes until first disclosure.
  const LAZY_ESTIMATION_MARKUP = Object.freeze({
    text: `<div class="cw-config-form">
              <div class="cw-advanced-hint" title="Only newly captured text and newly parsed files are estimated with these ratios; saved UUID counts are unchanged">New captures only · write-once</div>
              <label><span class="cw-field-caption" title="Added to newly recorded message token counts; previous UUID counts stay unchanged">Message overhead (tokens)</span> <input class="cw-message-overhead" type="number"></label>
              <label><span class="cw-field-caption" title="Estimated Cyrillic characters per token for newly captured text">Cyrillic chars/token</span> <input class="cw-prose-cyrillic-ratio" type="number"></label>
              <label><span class="cw-field-caption" title="Estimated Latin characters per token for newly captured text">Latin chars/token</span> <input class="cw-prose-latin-ratio" type="number"></label>
              <label><span class="cw-field-caption" title="Estimated digits per token for newly captured text">Digit chars/token</span> <input class="cw-prose-digits-ratio" type="number"></label>
              <label><span class="cw-field-caption" title="Estimated punctuation characters per token">Punctuation chars/token</span> <input class="cw-prose-punctuation-ratio" type="number"></label>
              <label><span class="cw-field-caption" title="Estimated remaining characters per token">Other chars/token</span> <input class="cw-prose-other-ratio" type="number"></label>
              <label><span class="cw-field-caption" title="Minimum word-count-based token estimate multiplier">Word-count floor</span> <input class="cw-prose-word-floor" type="number"></label>
              <label><span class="cw-field-caption" title="Estimated characters per token for code snippets">Code chars/token</span> <input class="cw-code-ratio" type="number"></label>
              <div class="cw-settings-actions cw-unified-actions">
                <button type="button" class="cw-save-text-estimation">Save</button>
                <button type="button" class="cw-reset-text-estimation">Restore defaults</button>
              </div>
            </div>`,
    attachment: `<div class="cw-config-form">
              <details class="cw-disclosure cw-attachment-core" open><summary>Main file &amp; image settings</summary>
              <label><span class="cw-field-caption" title="Assumed token cost for one image, not its byte size">Image estimate (tokens)</span> <input class="cw-image-average" type="number"></label>
              <label class="cw-local-limit-label"><span class="cw-field-caption" title="Maximum file size for local parsing. Larger files use metadata only. Recommended: 75 MiB.">Local file parsing limit (MiB)</span>
                <span class="cw-input-with-indicator"><input class="cw-local-file-limit" type="number" title="Maximum file size for local parsing. Larger files use metadata only. Recommended: 75 MiB."><span class="cw-limit-warning" role="img" aria-label="Outside recommended range" title="Outside recommended range (70–80 MiB)" hidden><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4.4a2 2 0 0 1 3.4 0l8 13.8a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3z"/><path d="M12 9v5M12 17.5h.01"/></svg></span></span>
              </label>
              <label><span class="cw-field-caption" title="Used for historical attachments with unknown size">History fallback (tokens)</span><input class="cw-historical-file-fallback" type="number"></label>
              </details>
              <div class="cw-metadata-section"></div>
              <div class="cw-settings-actions cw-unified-actions">
                <button type="button" class="cw-save-attachments">Save</button>
                <button type="button" class="cw-reset-attachments">Restore defaults</button>
              </div>
            </div>`,
    coefficients: `<div class="cw-config-form">

                <div class="cw-advanced-caption">File context contribution (%)</div>
                <label><span class="cw-field-caption" title="Estimated share of locally parsed file content included in the optimistic scenario; also used for historical fallback and auto-paste minimum">Files · Optimistic (%)</span> <input class="cw-file-opt" type="number"></label>
                <label><span class="cw-field-caption" title="Estimated share of locally parsed file content included in the pessimistic scenario; also used for historical fallback and auto-paste minimum">Files · Pessimistic (%)</span> <input class="cw-file-pess" type="number"></label>
                <div class="cw-advanced-caption">Image context contribution (%)</div>
                <label><span class="cw-field-caption" title="Share of image estimate counted in optimistic scenario">Images · Optimistic (%)</span> <input class="cw-image-opt" type="number"></label>
                <label><span class="cw-field-caption" title="Share of image estimate counted in pessimistic scenario">Images · Pessimistic (%)</span> <input class="cw-image-pess" type="number"></label>
                <div class="cw-advanced-caption">Automatic pasted-text minimum</div>
                <label><span class="cw-field-caption" title="Minimum inferred characters for an unread automatically pasted document">Pasted minimum (chars)</span> <input class="cw-pasted-min-chars" type="number"></label>
                <label><span class="cw-field-caption" title="Assumed Latin characters per token for unread pasted text">Pasted Latin chars/token</span> <input class="cw-pasted-english-ratio" type="number"></label>
                <label><span class="cw-field-caption" title="Assumed Cyrillic characters per token for unread pasted text">Pasted Cyrillic chars/token</span> <input class="cw-pasted-cyrillic-ratio" type="number"></label>
                <div class="cw-settings-actions cw-unified-actions">
                  <button type="button" class="cw-save-attachment-coefficients">Save</button>
                  <button type="button" class="cw-reset-attachment-advanced">Restore defaults</button>
                </div>
            </div>`
  });

  // Parameter labels and numeric bounds come from the shared registry.
  function metadataControlsMarkup(specs) {
    const input = spec => `<label><span class="cw-field-caption" title="${spec.hint}">${spec.label}</span> <input class="cw-${spec.field.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}" type="number"></label>`;
    return `<details class="cw-disclosure cw-metadata-only"><summary>Metadata-only estimation</summary>
      <div class="cw-advanced-hint">Calibration for unread files of known size. Original formula and default outcomes are retained.</div>
      <div class="cw-advanced-caption">Formula</div>
      ${specs.slice(0, 6).map(input).join('')}
      <div class="cw-advanced-caption">File types</div>
      ${specs.slice(6).map(input).join('')}
    </details>`;
  }

  // UI-only lazy templates: no DOM nodes, listeners, or rendering while hidden.
  const LAZY_VIEW_MARKUP = Object.freeze({
    context: "\n          <div class=\"cw-context-summary\" aria-label=\"Total context estimate\">\n            <div class=\"cw-context-primary-row\"><span class=\"cw-context-primary-label\">Total context estimate</span><strong class=\"cw-context-range\">--</strong></div>\n            <div class=\"cw-context-note\"><span>Heuristic midpoint of optimistic</span> <span>and pessimistic estimates</span></div>\n            <div class=\"cw-data-row\"><span>Messages</span><strong class=\"cw-context-messages\">--</strong></div>\n          </div>\n          <div class=\"cw-context-text-only\">\n            <span class=\"cw-card-caption\">Text only</span>\n            <strong class=\"cw-data-tokens\">--</strong>\n            <div class=\"cw-context-characters\"><strong class=\"cw-data-chars\">--</strong> characters</div>\n          </div>\n          <div class=\"cw-data-attachment\">\n            <div class=\"cw-data-row\"><span>Files attached</span><strong class=\"cw-data-files\">--</strong></div>\n            <div class=\"cw-data-row cw-file-accounting-row\"><span>File accounting</span><strong class=\"cw-data-quality\">--</strong></div>\n            <div class=\"cw-data-row cw-file-accounting-continuation\"><strong class=\"cw-data-quality-extra\">--</strong></div>\n            <div class=\"cw-data-row cw-data-images-row\"><span>Images attached</span><strong class=\"cw-data-images\">none</strong></div>\n          </div>\n          <div class=\"cw-estimation-settings\">\n            <div class=\"cw-mini-nav\" role=\"group\" aria-label=\"Context estimation settings\">\n              <button type=\"button\" class=\"cw-mini-tab\" data-cw-mini=\"text\" aria-expanded=\"false\" aria-controls=\"cw-mini-text\">Text estimation</button>\n              <button type=\"button\" class=\"cw-mini-tab\" data-cw-mini=\"attachment\" aria-expanded=\"false\" aria-controls=\"cw-mini-attachment\">Files &amp; images</button>\n              <button type=\"button\" class=\"cw-mini-tab\" data-cw-mini=\"coefficients\" aria-expanded=\"false\" aria-controls=\"cw-mini-coefficients\">Attachment weights</button>\n            </div>\n            <div id=\"cw-mini-text\" class=\"cw-text-settings-details cw-mini-pane\" hidden></div>\n            <div id=\"cw-mini-attachment\" class=\"cw-attachment-settings cw-mini-pane\" hidden></div>\n            <div id=\"cw-mini-coefficients\" class=\"cw-advanced-attachments cw-mini-pane\" hidden></div>\n          </div>\n        ",
    budget: "\n          <div class=\"cw-budget-unavailable cw-context-note\" hidden>No context estimate yet</div>\n          <div class=\"cw-forecast-heading\"><strong>Budget status</strong><span class=\"cw-forecast-status cw-status\">--</span></div>\n          <div class=\"cw-forecast-cards\">\n            <div><strong class=\"cw-card-value cw-forecast-opt\">--</strong><div class=\"cw-context-note\">Optimistic</div></div>\n            <div><strong class=\"cw-card-value cw-forecast-pess\">--</strong><div class=\"cw-context-note\">Pessimistic</div></div>\n          </div>\n          <div class=\"cw-budget-navigation\">\n            <div class=\"cw-mini-nav cw-budget-mini-nav\" aria-label=\"Budget sections\" role=\"tablist\">\n              <button type=\"button\" id=\"cw-budget-limits-tab\" role=\"tab\" class=\"cw-mini-tab cw-mini-active\" data-cw-budget=\"limits\" aria-selected=\"true\" tabindex=\"0\" aria-controls=\"cw-budget-limits\">Token budget &amp; limits</button>\n              <button type=\"button\" id=\"cw-budget-history-tab\" role=\"tab\" class=\"cw-mini-tab\" data-cw-budget=\"history\" aria-selected=\"false\" tabindex=\"-1\" aria-controls=\"cw-budget-history\">History &amp; calibration</button>\n            </div>\n            <div id=\"cw-budget-limits\" class=\"cw-budget-limits cw-mini-pane\" role=\"tabpanel\" aria-labelledby=\"cw-budget-limits-tab\">\n              <div class=\"cw-forecast-group\">\n                <div class=\"cw-forecast-group-title\">Optimistic use</div>\n                <div class=\"cw-progress-grid\">\n                  <div><div class=\"cw-progress-track\"><div class=\"cw-progress-fill cw-progress-opt-c\"></div><strong class=\"cw-progress-percent cw-percent-opt-c\" data-cw-on-fill=\"false\">--</strong></div><div class=\"cw-context-note\">Conservative</div></div>\n                  <div><div class=\"cw-progress-track\"><div class=\"cw-progress-fill cw-progress-opt-n\"></div><strong class=\"cw-progress-percent cw-percent-opt-n\" data-cw-on-fill=\"false\">--</strong></div><div class=\"cw-context-note\">Normal</div></div>\n                  <div><div class=\"cw-progress-track\"><div class=\"cw-progress-fill cw-progress-opt-o\"></div><strong class=\"cw-progress-percent cw-percent-opt-o\" data-cw-on-fill=\"false\">--</strong></div><div class=\"cw-context-note\">Generous</div></div>\n                </div>\n              </div>\n              <div class=\"cw-forecast-group\">\n                <div class=\"cw-forecast-group-title\">Pessimistic use</div>\n                <div class=\"cw-progress-grid\">\n                  <div><div class=\"cw-progress-track\"><div class=\"cw-progress-fill cw-progress-pess-c\"></div><strong class=\"cw-progress-percent cw-percent-pess-c\" data-cw-on-fill=\"false\">--</strong></div><div class=\"cw-context-note\">Conservative</div></div>\n                  <div><div class=\"cw-progress-track\"><div class=\"cw-progress-fill cw-progress-pess-n\"></div><strong class=\"cw-progress-percent cw-percent-pess-n\" data-cw-on-fill=\"false\">--</strong></div><div class=\"cw-context-note\">Normal</div></div>\n                  <div><div class=\"cw-progress-track\"><div class=\"cw-progress-fill cw-progress-pess-o\"></div><strong class=\"cw-progress-percent cw-percent-pess-o\" data-cw-on-fill=\"false\">--</strong></div><div class=\"cw-context-note\">Generous</div></div>\n                </div>\n              </div>\n              <details class=\"cw-disclosure cw-budget-editor\"><summary>Edit token budgets</summary>\n                <div id=\"cw-budget-options\" class=\"cw-budget-settings\"></div>\n              </details>\n            </div>\n            <div id=\"cw-budget-history\" class=\"cw-history-details cw-mini-pane\" role=\"tabpanel\" aria-labelledby=\"cw-budget-history-tab\" hidden></div>\n          </div>\n        ",
    details: "\n          <div class=\"cw-details-header\"><span>Details</span><button type=\"button\" class=\"cw-copy-details\" title=\"Copy Details figures as plain text\">Copy</button></div>\n          <div class=\"cw-details-report\">\n            <div class=\"cw-detail-group\"></div>\n            <div class=\"cw-detail-group\"></div>\n            <div class=\"cw-detail-group\"></div>\n            <div class=\"cw-detail-group\"></div>\n            <div class=\"cw-detail-group\"></div>\n          </div>\n        "
  });
  const LAZY_SECTION_MARKUP = Object.freeze({
    historyBody: "\n          <div class=\"cw-history-line\">\n            <div class=\"cw-history\"></div>\n            <div class=\"cw-history-note\">Averages across recorded samples.</div>\n          </div>\n        ",
    budgetForm: "\n            <div class=\"cw-config-form\">\n              <label>Conservative budget <input class=\"cw-budget-c\" type=\"number\"></label>\n              <label>Normal budget <input class=\"cw-budget-n\" type=\"number\"></label>\n              <label>Generous budget <input class=\"cw-budget-o\" type=\"number\"></label>\n              <div class=\"cw-threshold-info\">Current token budgets; recording a chat limit recalibrates and saves these numbers.</div>\n              <div class=\"cw-settings-actions cw-unified-actions\">\n                <button type=\"button\" class=\"cw-save-budget\">Save</button>\n                <button type=\"button\" class=\"cw-reset-budget\">Restore defaults</button>\n              </div>\n            </div>\n          ",
    technicalForm: `
          <details class="cw-disclosure cw-handoff-editor">
            <summary class="cw-handoff-summary">HANDOFF prompt <span class="cw-handoff-unsaved" role="status" hidden>Unsaved changes</span></summary>
            <div class="cw-handoff-content">
              <textarea id="cw-handoff-prompt-input" class="cw-handoff-prompt" aria-label="Global HANDOFF prompt" maxlength="${HANDOFF_MAX_CHARS}" rows="8" spellcheck="false"></textarea>
              <div class="cw-handoff-count">Characters: <span class="cw-handoff-counter">0 / ${HANDOFF_MAX_CHARS}</span></div>
              <div class="cw-settings-actions cw-unified-actions">
                <button type="button" class="cw-save-handoff">Save</button>
                <button type="button" class="cw-restore-handoff">Restore default</button>
              </div>
            </div>
          </details>
          <label>Hidden context · optimistic <input class="cw-hidden-optimistic" type="number"></label>
          <label>Hidden context · pessimistic <input class="cw-hidden-pessimistic" type="number"></label>
          <label>History prior strength <input class="cw-history-prior-strength" type="number"></label>
          <div class="cw-settings-actions cw-unified-actions"><button type="button" class="cw-save-settings">Save</button><button type="button" class="cw-reset-settings">Restore defaults</button></div>
        `,
    diagnostics: "\n            <details class=\"cw-disclosure cw-recent-errors\"><summary>Recent errors</summary><div class=\"cw-recent-errors-list\">No errors recorded. All good.</div></details>\n            <div class=\"cw-diagnostics-line\">Expand to load current diagnostics.</div>\n            <div class=\"cw-settings-actions\">\n              <button type=\"button\" class=\"cw-rescan\" title=\"Read-only audit of rendered messages\">Run Audit</button>\n              <button type=\"button\" class=\"cw-copy-diagnostics\">Copy diagnostics</button>\n              <button type=\"button\" class=\"cw-export-ids\" title=\"Read-only TSV file with known UUIDs\">Export IDs (.tsv)</button>\n              <button type=\"button\" class=\"cw-repair-short\" title=\"Repair only twice-confirmed short records\" disabled hidden>Repair confirmed (0)</button>\n              <button type=\"button\" class=\"cw-undo-repair\" title=\"Undo last explicit repair\" disabled hidden>Undo repair</button>\n            </div>\n          ",
    performance: "\n            <div class=\"cw-performance-line\">Profiling is disabled.</div>\n            <div class=\"cw-settings-actions\">\n              <button type=\"button\" class=\"cw-performance-toggle\">Enable profiling</button>\n              <button type=\"button\" class=\"cw-performance-copy\">Copy metrics</button>\n              <button type=\"button\" class=\"cw-performance-reset\">Reset counters</button>\n            </div>\n          ",
    aboutHelp: "\n            <details class=\"cw-disclosure cw-about-section\" open><summary>Main window</summary>\n              <dl>\n                <dt>Mini badge and open panel</dt><dd>After a confirmed estimate, the closed badge shows an approximate midpoint and budget status; empty chats show no estimate. Drag the badge to move it. When the panel opens, the badge shows only its icon. The panel opens below, then above, then left—never right—and shifts left near the viewport edge. Click the badge to close, even when pinned; Pin prevents outside-click closing. Yellow: pessimistic Normal use exceeds 100%. Red: optimistic use exceeds 100% and takes priority.</dd>\n                <dt>Context / Budget forecast / Details</dt><dd>Context shows local text and attachment estimates; Budget compares both estimates with three editable budgets and calibration history; Details lists per-chat estimates and counts and offers a copyable report.</dd>\n                <dt>Optimistic / Pessimistic</dt><dd>Lower and upper heuristic context estimates; their midpoint is not a measured model token count.</dd>\n                <dt>Conservative / Normal / Generous · Budget use</dt><dd>Three adjustable token budgets. Usage (%) is the estimate divided by each budget; above 100% means that threshold is exceeded.</dd>\n              </dl>\n            </details>\n            <details class=\"cw-disclosure cw-about-section\"><summary>Context · estimation</summary>\n              <dl>\n                <dt>Text estimation</dt><dd>Character/token ratios, word-count floor and Message overhead affect new captures or local text parsing. Existing message UUID estimates are write-once.</dd>\n                <dt>Files &amp; images</dt><dd>Parsed files use locally read content; metadata-only files use file details; unread content may use a size-based estimate.</dd>\n                <dt>History fallback (tokens)</dt><dd>Used for historical files with neither readable content nor known size. Pasted text has a separate minimum.</dd>\n                <dt>Image estimate (tokens)</dt><dd>Assumed token cost per image, not its physical size or resolution.</dd>\n                <dt>Local file parsing limit (MiB)</dt><dd>0 disables local reading of new text files and uses metadata-only; 1–256 MiB enable reading (75 default).</dd>\n                <dt>Automatically pasted text</dt><dd>Unread automatically pasted text can receive a minimum estimate.</dd>\n                <dt>Attachment weights</dt><dd>Single optimistic/pessimistic contribution pair for locally parsed files, historical fallback and auto-paste minimum; independent metadata-only size estimation, image and pasted-text settings. Metadata-only parameters are editable in Stable and Dev and share Save / Restore defaults with Files & images.</dd>\n              </dl>\n            </details>\n            <details class=\"cw-disclosure cw-about-section\"><summary>Budget forecast</summary>\n              <dl>\n                <dt>History &amp; calibration</dt><dd>Shows recorded limit samples, average message text, optimistic/pessimistic context estimates (tokens), and calibration weight. Recording a chat limit updates editable budgets; missing averages show none.</dd>\n                <dt>Token budget &amp; limits</dt><dd>Shows both estimates against Conservative, Normal and Generous budgets. Percentages may exceed 100%; Edit token budgets changes thresholds. Bars show estimated use, not ChatGPT-reported limits.</dd>\n              </dl>\n            </details>\n            <details class=\"cw-disclosure cw-about-section\"><summary>Appearance</summary>\n              <dl>\n                <dt>Style · Sharp / Soft</dt><dd>Angular or rounded Watchdog styling, including Settings.</dd>\n                <dt>Theme · Light / Dark / System / ChatGPT</dt><dd>Choose Light/Dark, follow the OS (System) or ChatGPT theme (fallback: System). Default: Soft + ChatGPT. Choices save immediately.</dd>\n                <dt>Logo · ChatGPT / Watchdog</dt><dd>ChatGPT (default) uses a same-origin cache-only favicon with no network fallback. Missing or invalid artwork silently switches the saved choice to Watchdog. Selecting ChatGPT makes one new cache-only attempt. Watchdog avoids cache lookup and appears beside the panel title; its SVG data is never saved. Service Worker details: see Privacy & limitations.</dd>\n              </dl>\n            </details>\n            <details class=\"cw-disclosure cw-about-section\"><summary>Settings &amp; tools</summary>\n              <dl>\n                <dt>Technical · Hidden context</dt><dd>Optional optimistic and pessimistic allowances for context the page cannot reveal.</dd>\n                <dt>History prior strength</dt><dd>Higher values reduce the influence of samples when the next calibration is recorded.</dd>\n                <dt>HANDOFF</dt><dd>Inserts the saved next-chat prompt when the composer is empty; otherwise copies it without changing the draft. Never sends automatically. Edit in Technical; only Save applies changes.</dd>\n                <dt>Record chat limit</dt><dd>At a practical limit, records this chat’s estimate and updates editable budgets. Repeating replaces its sample; the chat stays open.</dd>\n                <dt>Performance</dt><dd>Optional in-memory counters and timings, off by default. Resetting them does not affect the ledger.</dd>\n              </dl>\n            </details>\n            <details class=\"cw-disclosure cw-about-section\"><summary>Diagnostics &amp; reset</summary>\n              <dl>\n                <dt>Run Audit</dt><dd>Read-only comparison of currently rendered messages with saved UUID records.</dd>\n                <dt>Repair confirmed / Undo repair</dt><dd>Repair requires two consistent audits, a final recheck and confirmation. Undo restores the latest repair if unchanged. Both affect Watchdog records only.</dd>\n                <dt>Copy diagnostics / Export IDs (.tsv)</dt><dd>Copies diagnostics or downloads UUID data; the export contains no message text.</dd>\n                <dt>Reset position</dt><dd>Restores the badge’s default position without changing estimates or budgets.</dd>\n                <dt>Reset this chat</dt><dd>After confirmation, clears this chat’s ledger. Visible messages can be recaptured; unseen history may be missing.</dd>\n                <dt>Clear Watchdog data</dt><dd>After confirmation, clears Watchdog settings, chat ledgers and calibration without reloading. The badge stays in place; its position is saved with fresh defaults. Visible finished messages may be collected again. ChatGPT conversations and unrelated site data are untouched.</dd>\n              </dl>\n            </details>"
  });
  const LAZY_APPEARANCE_MARKUP = `
    <div class="cw-view-setting-row">
      <span class="cw-view-label">Style</span>
      <div class="cw-view-options" role="group" aria-label="Watchdog style">
        <button type="button" data-cw-view-style="sharp" data-cw-label="Sharp" aria-pressed="false" data-cw-tip="Angular edges and a left-beveled badge."><span>Sharp</span></button>
        <span class="cw-view-separator" aria-hidden="true">·</span>
        <button type="button" data-cw-view-style="soft" data-cw-label="Soft" aria-pressed="false" data-cw-tip="Rounded edges and a rounded badge."><span>Soft</span></button>
      </div>
    </div>
    <div class="cw-view-setting-row">
      <span class="cw-view-label">Theme</span>
      <div class="cw-view-options" role="group" aria-label="Watchdog colors">
        <button type="button" data-cw-view-theme="light" data-cw-label="Light" aria-pressed="false" data-cw-tip="Light Watchdog colors."><span>Light</span></button>
        <span class="cw-view-separator" aria-hidden="true">·</span>
        <button type="button" data-cw-view-theme="dark" data-cw-label="Dark" aria-pressed="false" data-cw-tip="Dark Watchdog colors."><span>Dark</span></button>
        <span class="cw-view-separator" aria-hidden="true">·</span>
        <button type="button" data-cw-view-theme="system" data-cw-label="System" aria-pressed="false" data-cw-tip="Follow your device's color theme."><span>System</span></button>
        <span class="cw-view-separator" aria-hidden="true">·</span>
        <button type="button" data-cw-view-theme="chatgpt" data-cw-label="ChatGPT" aria-pressed="false" data-cw-tip="Follow ChatGPT's page theme; use System when unavailable."><span>ChatGPT</span></button>
      </div>
    </div>
    <div class="cw-view-setting-row">
      <span class="cw-view-label">Logo</span>
      <div class="cw-view-options" role="group" aria-label="Badge logo source">
        <button type="button" data-cw-view-logo="openai" data-cw-label="ChatGPT" aria-pressed="false" data-cw-tip="ChatGPT logo uses cached favicon only. Switches to Watchdog if unavailable."><span>ChatGPT</span></button>
        <span class="cw-view-separator" aria-hidden="true">·</span>
        <button type="button" data-cw-view-logo="watchdog" data-cw-label="Watchdog" aria-pressed="false" data-cw-tip="Use the original Watchdog logo; no cache lookup."><span>Watchdog</span></button>
      </div>
    </div>
  `;

  const LAZY_DIALOG_MARKUP = Object.freeze({
    confirm: `<dialog class="cw-settings-dialog cw-confirm-dialog" aria-labelledby="cw-confirm-heading" aria-describedby="cw-confirm-description">
          <div class="cw-dialog-header">
            <strong id="cw-confirm-heading">Confirm action</strong>
            <button type="button" class="cw-close-confirm" aria-label="Close confirmation">✕</button>
          </div>
          <div class="cw-limit-content">
            <p id="cw-confirm-description" class="cw-confirm-description"></p>
            <div class="cw-limit-actions">
              <button type="button" class="cw-cancel-confirm">Cancel</button>
              <button type="button" class="cw-confirm-ok">OK</button>
            </div>
          </div>
        </dialog>`,
    settings: "        <dialog class=\"cw-settings-dialog\" aria-labelledby=\"cw-settings-heading\">\n        <div class=\"cw-dialog-header\">\n          <strong id=\"cw-settings-heading\">Settings &amp; tools</strong>\n          <div class=\"cw-dialog-message\" role=\"status\" aria-live=\"polite\" aria-atomic=\"true\" hidden></div>\n          <button type=\"button\" class=\"cw-close-settings\" aria-label=\"Close settings\">✕</button>\n        </div>\n        <div class=\"cw-dialog-content\">\n          <div class=\"cw-maintenance cw-reset-line\">\n            <button type=\"button\" class=\"cw-reset-position\">Reset badge</button>\n            <button type=\"button\" class=\"cw-reset-chat\">Reset chat</button>\n            <button type=\"button\" class=\"cw-clear-watchdog-data\">Wipe Watchdog data</button>\n          </div>\n          <div class=\"cw-mini-nav cw-tools-nav\" aria-label=\"Settings and tools categories\" role=\"tablist\">\n            <button type=\"button\" id=\"cw-tools-view-tab\" role=\"tab\" class=\"cw-mini-tab\" data-cw-tools=\"view\" aria-selected=\"true\" tabindex=\"0\" aria-controls=\"cw-tools-view\">Appearance</button>\n            <button type=\"button\" id=\"cw-tools-technical-tab\" role=\"tab\" class=\"cw-mini-tab\" data-cw-tools=\"technical\" aria-selected=\"false\" tabindex=\"-1\" aria-controls=\"cw-tools-technical\">Technical</button>\n            <button type=\"button\" id=\"cw-tools-diagnostics-tab\" role=\"tab\" class=\"cw-mini-tab\" data-cw-tools=\"diagnostics\" aria-selected=\"false\" tabindex=\"-1\" aria-controls=\"cw-tools-diagnostics\">Diagnostics</button>\n            <button type=\"button\" id=\"cw-tools-performance-tab\" role=\"tab\" class=\"cw-mini-tab\" data-cw-tools=\"performance\" aria-selected=\"false\" tabindex=\"-1\" aria-controls=\"cw-tools-performance\">Performance</button>\n          </div>\n          <div id=\"cw-tools-view\" class=\"cw-view-preferences cw-mini-pane\" role=\"tabpanel\" aria-labelledby=\"cw-tools-view-tab\" hidden></div>\n          <div id=\"cw-tools-technical\" class=\"cw-settings cw-mini-pane\" role=\"tabpanel\" aria-labelledby=\"cw-tools-technical-tab\" hidden></div>\n          <div id=\"cw-tools-diagnostics\" class=\"cw-diagnostics-tools cw-mini-pane\" role=\"tabpanel\" aria-labelledby=\"cw-tools-diagnostics-tab\" hidden></div>\n          <div id=\"cw-tools-performance\" class=\"cw-performance-details cw-mini-pane\" role=\"tabpanel\" aria-labelledby=\"cw-tools-performance-tab\" hidden></div>\n        </div>\n        </dialog>",
    limit: `<dialog class="cw-settings-dialog cw-limit-dialog" aria-labelledby="cw-limit-heading" aria-describedby="cw-limit-description">
          <div class="cw-dialog-header">
            <strong id="cw-limit-heading">Record Chat Limit</strong>
            <button type="button" class="cw-close-limit" aria-label="Close Record Chat Limit">✕</button>
          </div>
          <div class="cw-limit-content">
            <p id="cw-limit-description">Record this chat only when it has reached a practical context or length limit.</p>
            <div class="cw-limit-estimates" aria-label="Current local context estimates">
              <div><span>Seen text</span><strong class="cw-limit-tokens">—</strong></div>
              <div><span>Optimistic context</span><strong class="cw-limit-optimistic">—</strong></div>
              <div><span>Pessimistic context</span><strong class="cw-limit-pessimistic">—</strong></div>
            </div>
            <p class="cw-limit-consequence">This saves a calibration sample and recalibrates Conservative, Normal and Generous token budgets. It does not close or change your ChatGPT conversation.</p>
            <p class="cw-limit-replacement" hidden>A sample for this chat already exists. Recording again will replace it.</p>
            <div class="cw-limit-actions">
              <button type="button" class="cw-cancel-limit">Cancel</button>
              <button type="button" class="cw-confirm-limit">Record limit</button>
            </div>
          </div>
        </dialog>`,
    about: "        <dialog class=\"cw-settings-dialog cw-about-dialog\" aria-labelledby=\"cw-about-heading\">\n          <div class=\"cw-dialog-header\">\n            <strong id=\"cw-about-heading\">About Context Watchdog</strong>\n            <button type=\"button\" class=\"cw-close-about\" aria-label=\"Close About\">✕</button>\n          </div>\n          <div class=\"cw-about-product\">ChatGPT Context Watchdog (Local)</div>\n          <div class=\"cw-about-version\">Version __WATCHDOG_VERSION__ · Designed &amp; maintained by f0rset1 · Developed with ChatGPT</div>\n          <p>Estimates captured chat text and attachments against editable token budgets.</p>\n          <details class=\"cw-disclosure cw-about-section\"><summary>Privacy &amp; limitations</summary>\n            <p><strong>Local-only.</strong> Reads accessible page content and stores numeric estimates, message identifiers, settings and limited attachment metadata in site-local browser storage. Full message text and attachment contents are not saved in the ledger; a customized HANDOFF template is stored when saved. No chat data is sent over the network. The ChatGPT logo may request a same-origin favicon using <code>fetch</code> with <code>cache: &quot;only-if-cached&quot;</code>; a cache miss never triggers a network retry and switches to Watchdog. A controlling Service Worker blocks this lookup and also switches to Watchdog. DevTools may show a disk-cache hit in Network (0 transferred bytes).</p>\n            <p><strong>Estimates, not measurements.</strong> Hidden instructions, retrieval, compaction and actual remaining context are inaccessible.</p>\n          </details>\n          <details class=\"cw-disclosure cw-about-terms\"><summary>Terms &amp; actions explained</summary>\n            <div class=\"cw-about-glossary\" aria-label=\"Terms and actions explained\"></div>\n          </details>\n          <details class=\"cw-disclosure cw-about-section cw-about-credit-section\" open><summary>Credits</summary>\n            <div class=\"cw-about-credit\">Tampermonkey userscript · Inspired by ideas from Pushpak1203&#39;s ChatGPT-Token_Counter.</div>\n          </details>\n        </dialog>"
  });

  const UI_MARKUP = `
      <button class="cw-chip" type="button" title="Estimated context" aria-label="Open Watchdog panel" aria-controls="${APP}-panel" aria-expanded="false">
        <span class="cw-logo-hit"><span class="cw-site-icon cw-brand-mark" aria-hidden="true"></span></span>
        <span class="cw-storage-indicator" hidden aria-label="Storage error">!</span>
        <span class="cw-range"><span class="cw-average cw-metric">≈ --k</span><span class="cw-paused-label" hidden>paused</span><span class="cw-budget-tab-mark cw-chip-status" data-level="pending" aria-hidden="true">
            <span class="cw-status-pending">·</span>
            <svg class="cw-status-ok" viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.7 2.7L16 9.5"/></svg>
            <svg class="cw-status-caution" viewBox="0 0 24 24" focusable="false"><path d="M10.3 4.4a2 2 0 0 1 3.4 0l8 13.8a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3z"/><path d="M12 9v5M12 17.5h.01"/></svg>
            <svg class="cw-status-critical" viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v6M12 17.2h.01"/></svg>
          </span></span>
      </button>
      <div class="cw-panel-frame">
      <div id="${APP}-panel" class="cw-panel" hidden>
        <div class="cw-panel-main">
        <div class="cw-title">
          <div class="cw-title-info">
            <strong>Context Watchdog<span class="cw-brand-mark" aria-hidden="true" hidden></span></strong>
            <span class="cw-local-row">
              <span class="cw-pause-control" title="Pause Watchdog">
                <button type="button" class="cw-pause-toggle" aria-label="Pause Watchdog" title="Pause Watchdog" data-cw-playing="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                    <circle cx="12" cy="12" r="9"/>
                    <path class="cw-pause-bars" d="M9.5 8.5v7m5-7v7"/>
                    <path class="cw-play-triangle" d="m10 8 6 4-6 4z"/>
                  </svg>
                </button>
              </span>
              <span class="cw-local-separator" aria-hidden="true"></span>
              <span class="cw-local" data-cw-tip="No chat-data traffic. ChatGPT logo uses a same-origin cache-only favicon lookup; see About.">LOCAL · NO NETWORK</span>
            </span>
          </div>
          <div class="cw-toolbar" role="group" aria-label="Watchdog actions">
            <button type="button" class="cw-tool-button cw-pin-panel" aria-label="Pin panel" aria-pressed="false" aria-describedby="cw-tip-pin">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 3h8l-1 2v4l3 3v2H6v-2l3-3V5L8 3z"/><path d="M12 14v8"/></svg>
              <span class="cw-tool-tip" id="cw-tip-pin" role="tooltip">Pin panel · Keep open when clicking outside</span>
            </button>
            <button type="button" class="cw-tool-button cw-handoff-details" aria-label="HANDOFF" aria-describedby="cw-tip-handoff">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8m-4-4 4 4-4 4"/></svg>
              <span class="cw-tool-tip" id="cw-tip-handoff" role="tooltip">HANDOFF · Prepare next-chat prompt</span>
            </button>
            <button type="button" class="cw-tool-button cw-end-chat" aria-label="Record chat limit" aria-describedby="cw-tip-limit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v18l-7-5-7 5z"/><path d="m9 10 2 2 4-4"/></svg>
              <span class="cw-tool-tip" id="cw-tip-limit" role="tooltip">Record chat limit · Save calibration sample</span>
            </button>
            <button type="button" class="cw-tool-button cw-settings-btn" aria-label="Settings" aria-describedby="cw-tip-settings">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12.00,3.85 L13.95,2.19 L15.83,2.76 L16.53,5.22 L17.76,6.24 L20.31,6.44 L21.24,8.17 L19.99,10.41 L20.15,12.00 L21.81,13.95 L21.24,15.83 L18.78,16.53 L17.76,17.76 L17.56,20.31 L15.83,21.24 L13.59,19.99 L12.00,20.15 L10.05,21.81 L8.17,21.24 L7.47,18.78 L6.24,17.76 L3.69,17.56 L2.76,15.83 L4.01,13.59 L3.85,12.00 L2.19,10.05 L2.76,8.17 L5.22,7.47 L6.24,6.24 L6.44,3.69 L8.17,2.76 L10.41,4.01 Z"/><circle cx="12" cy="12" r="3"/></svg>
              <span class="cw-tool-tip" id="cw-tip-settings" role="tooltip">Settings · Technical controls and diagnostics</span>
            </button>
            <button type="button" class="cw-tool-button cw-about-btn" aria-label="About Context Watchdog" aria-describedby="cw-tip-about">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.3h.01"/></svg>
              <span class="cw-tool-tip" id="cw-tip-about" role="tooltip">About · Version, limitations and help</span>
            </button>
          </div>
          <div class="cw-notice-lane" aria-label="Watchdog notifications">
            <div class="cw-toast" role="status" aria-live="polite" aria-atomic="true" hidden></div>
          </div>
        </div>
        <div class="cw-tabs" role="tablist" aria-label="Watchdog view">
          <button type="button" role="tab" class="cw-tab-context" aria-controls="cw-context-view" aria-selected="true">Context</button>
          <button type="button" role="tab" class="cw-tab-budget" aria-controls="cw-budget-view" aria-selected="false"><span>Budget forecast</span><span class="cw-budget-tab-mark cw-budget-tab-status" data-level="pending" aria-hidden="true">
            <span class="cw-status-pending">·</span>
            <svg class="cw-status-ok" viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.7 2.7L16 9.5"/></svg>
            <svg class="cw-status-caution" viewBox="0 0 24 24" focusable="false"><path d="M10.3 4.4a2 2 0 0 1 3.4 0l8 13.8a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3z"/><path d="M12 9v5M12 17.5h.01"/></svg>
            <svg class="cw-status-critical" viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v6M12 17.2h.01"/></svg>
          </span></button>
          <button type="button" role="tab" class="cw-tab-details" aria-controls="cw-details-view" aria-selected="false">Details</button>
        </div>
        <div class="cw-storage-warning" role="alert" hidden></div>

        <section id="cw-context-view" class="cw-view-context" role="tabpanel" aria-label="Context">
</section>

        <section id="cw-budget-view" class="cw-view-budget" role="tabpanel" aria-label="Budget forecast" hidden>
</section>

        <section id="cw-details-view" class="cw-view-details" role="tabpanel" aria-label="Details" hidden>
</section>


        </div>
      </div>
      <div class="cw-settings-scrim" aria-hidden="true" hidden></div>
      </div>
    `;

export { metadataControlsMarkup, LAZY_ESTIMATION_MARKUP, LAZY_VIEW_MARKUP, LAZY_SECTION_MARKUP, LAZY_APPEARANCE_MARKUP, LAZY_DIALOG_MARKUP, UI_MARKUP };
