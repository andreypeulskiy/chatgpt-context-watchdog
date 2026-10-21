import { APP } from '../runtime/01-runtime-configuration.js';

  // Static presentation assets are not rebuilt every time the UI remounts.
  const UI_CSS = `
      #${APP}-root {
        position: fixed; right: 18px; bottom: 155px;
        z-index: 2147483000; font: 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #e5e7eb;
      }
      #${APP}-root * { box-sizing: border-box; }
      #${APP}-root button, #${APP}-root input { font: inherit; }
      .cw-chip {
        display: flex; align-items: center; gap: 4px;
        height: 34px; border: 1px solid var(--cw-chip-border); border-radius: calc(999px * var(--cw-radius-scale)); padding: 6px 8px;
        background: rgba(255,255,255,.88); color: #111827; box-shadow: 0 3px 12px rgba(0,0,0,.10);
        cursor: grab; user-select: none; touch-action: none;
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        transition: background .15s ease, border-color .15s ease; opacity: 1;
      }
      .cw-metric {
        font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.015em;
        opacity: 1; color: #111827; -webkit-text-fill-color: currentColor !important;
        -webkit-text-stroke: 0 transparent !important;
        text-shadow: none !important;
      }
      /* The mark keeps the original 32px circular hit area in both
         styles. Clipping controls hover; no visible background halo is drawn. */
      .cw-logo-hit {
        display: grid; place-items: center; position: relative;
        width: 18px; height: 18px; flex: 0 0 18px; cursor: pointer;
      }
      .cw-logo-hit::before {
        content: ''; position: absolute; width: 32px;
        height: 32px; left: 50%; top: 50%;
        transform: translate(-50%,-50%); border-radius: 50%;
        clip-path: circle(50%); background: transparent; cursor: pointer;
      }
      .cw-chip.cw-dragging .cw-logo-hit::before { cursor: grabbing; }
      .cw-site-icon {
        width: 18px; height: 18px; display: block;
        flex: 0 0 18px; opacity: .92;
        position: relative; pointer-events: none;
        transition: color .12s ease;
      }
      /* One hover/focus color trigger for both marks; the Watchdog white details stay white. */
      #${APP}-root .cw-chip .cw-logo-hit:hover .cw-brand-mark,
      #${APP}-root .cw-chip:focus-visible .cw-brand-mark {
        color: var(--cw-accent);
        --cw-watchdog-ink: currentColor;
        --cw-watchdog-gray: currentColor;
      }
      /* Only Dark Watchdog gets a colored outer contour; Light has no added rim. */
      #${APP}-root[data-cw-palette="dark"] .cw-chip .cw-logo-hit:hover .cw-brand-mark,
      #${APP}-root[data-cw-palette="dark"] .cw-chip:focus-visible .cw-brand-mark {
        --cw-watchdog-outline: currentColor;
      }
      #${APP}-root .cw-chip:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 2px; }
      .cw-chip.cw-dragging { cursor: grabbing; }
      .cw-range { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
      .cw-chip .cw-chip-status { width: 13px; height: 13px; flex: 0 0 13px; }
      .cw-chip .cw-chip-status svg { width: 13px; height: 13px; }
      .cw-chip .cw-metric { display: inline-block; transform: translateY(-1px); }
      /* Empty, unconfirmed chats use the same icon-only badge as an open panel. */
      #${APP}-root .cw-chip[data-cw-badge-mode="minimal"] .cw-range { display: none !important; }
      /* With the panel open, the full badge contracts to its original mark and padding. */
      #${APP}-root[data-cw-panel-open="true"] .cw-chip .cw-range,
      #${APP}-root[data-cw-panel-open="true"] .cw-chip .cw-storage-indicator { display: none !important; }
      .cw-panel-frame { position: absolute; left: 0; top: 0; }
      .cw-panel {
        position: relative; width: 350px; max-height: calc(100vh - 16px);
        overflow: auto; margin: 0; border: 1px solid rgba(17,24,39,.16);
        border-radius: calc(14px * var(--cw-radius-scale)); padding: 12px 14px 12px; background: rgba(255,255,255,.80);
        color: #111827; box-shadow: 0 12px 40px rgba(0,0,0,.16); backdrop-filter: blur(10px);
      }
      /* Two compact header rows: actions + local status. Notifications are
         absolutely overlaid on the status text and cannot grow the header. */
      .cw-title {
        position: relative; z-index: 2; /* Header tooltips must paint above the tabs. */
        display: grid; grid-template-columns: minmax(0,1fr) 133px;
        grid-template-rows: auto auto; align-items: center;
        column-gap: 6px; row-gap: 0; margin-bottom: 5px;
      }
      .cw-title-info { display: contents; }
      .cw-title-info strong { grid-column: 1; grid-row: 1; min-width: 0; justify-self: start; white-space: nowrap; }
      .cw-local-row { grid-column: 1; grid-row: 2; display: flex; align-items: center; gap: 6px; min-height: 14px; align-self: start; transform: translateY(-2px); }
      .cw-pause-control { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; flex: 0 0 15px; }
      #${APP}-root .cw-pause-toggle {
        width: 15px; height: 15px; padding: 0; margin: 0; border: 0;
        background: transparent; color: var(--cw-accent); display: inline-flex;
        align-items: center; justify-content: center; cursor: pointer;
      }
      #${APP}-root .cw-pause-toggle svg { width: 14px; height: 14px; display: block; }
      #${APP}-root .cw-pause-toggle[data-cw-playing="true"] .cw-play-triangle { display: none; }
      #${APP}-root .cw-pause-toggle[data-cw-playing="false"] .cw-pause-bars { display: none; }
      #${APP}-root .cw-pause-toggle:disabled { opacity: .30; cursor: default; }
      #${APP}-root .cw-pause-toggle:focus-visible { outline: 1px solid var(--cw-accent); outline-offset: 2px; border-radius: 50%; }
      .cw-local-separator { height: 11px; width: 1px; background: currentColor; opacity: .3; flex: 0 0 1px; }
      #${APP}-root .cw-paused-label { font-size: 11px; font-weight: 400; color: #808995; letter-spacing: .01em; }
      #${APP}-root .cw-average[hidden], #${APP}-root .cw-chip-status[hidden],
      #${APP}-root .cw-paused-label[hidden] { display: none !important; }
      #${APP}-root .cw-title-info strong { position: relative; align-self: flex-start; }
      #${APP}-root .cw-brand-mark {
        position: absolute; left: calc(100% + 5px); top: 50%;
        transform: translateY(-50%); display: block; width: 24px; height: 24px;
        opacity: 1; pointer-events: none;
      }
      /* One SVG geometry is cloned into three sizes; palette affects only its paths. */
      #${APP}-root .cw-brand-mark > .cw-watchdog-svg {
        display: block; width: 100%; height: 100%; overflow: visible;
      }
      #${APP}-root .cw-brand-mark > .cw-watchdog-svg > path {
        transition: fill .12s ease, stroke .12s ease;
      }
      #${APP}-root .cw-chip .cw-site-icon.cw-brand-mark {
        position: relative; left: auto; top: auto; transform: translate(-1px, -1px);
        width: 21px; height: 21px; display: block;
      }
      /* The site logo is a sanitized inline SVG copied from the host DOM. */
      #${APP}-root .cw-chip .cw-site-icon.cw-has-site-logo,
      #${APP}-root[data-cw-palette="dark"] .cw-chip .cw-site-icon.cw-has-site-logo {
        background: none;
        opacity: .92;
      }
      #${APP}-root .cw-site-icon > svg { display: block; width: 100%; height: 100%; }
      #${APP}-root .cw-site-icon.cw-has-site-logo > svg { fill: currentColor; }
      .cw-local { font-size: 10px; letter-spacing: .05em; color: var(--cw-accent); white-space: nowrap; }
      /* Always-visible header actions: no external icons, no native title tooltip. */
      .cw-toolbar { grid-column: 2; grid-row: 1; display: flex; align-items: center; flex: 0 0 auto; transform: translateY(-3px); }
      .cw-tool-button {
        position: relative; display: grid; place-items: center;
        padding: 0; border: 1px solid rgba(100,116,139,.28); border-radius: calc(8px * var(--cw-radius-scale));
        background: transparent; color: inherit; cursor: pointer;
      }
      .cw-tool-button:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 2px; }
       .cw-tool-button svg { display: block; width: 17px; height: 17px; pointer-events: none; }
      /* The Settings gear is a symmetrical 24x24 SVG; never allow flex or font scaling to flatten it. */
      .cw-settings-btn svg { width: 16px; height: 16px; min-width: 16px; min-height: 16px; flex: none; aspect-ratio: 1 / 1; }
      .cw-tool-tip {
        position: absolute; z-index: 3; top: calc(100% + 7px); right: 0;
        max-width: min(205px, calc(100vw - 48px)); border: 1px solid rgba(100,116,139,.35);
        box-shadow: 0 4px 14px rgba(0,0,0,.16);
        font: 500 11px/1.4 system-ui, sans-serif; text-align: left;
        opacity: 0; visibility: hidden;
      }
      /* Shared visual tooltip surface, geometry and typography remain independent. */
      .cw-tool-tip, #${APP}-root .cw-floating-tip {
        pointer-events: none; width: max-content; white-space: normal;
        padding: 6px 9px; border-radius: calc(7px * var(--cw-radius-scale));
        background: rgba(17,24,39,.88); color: #f9fafb;
        backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      }
      /* A hover tooltip appears after exactly 500 ms; mouse-out cancels it immediately. */
      @media (hover: hover) {
        .cw-tool-button:hover .cw-tool-tip {
          visibility: visible; opacity: 1;
          transition: opacity .12s ease .5s, visibility 0s linear .5s;
        }
      }
      .cw-tool-button:focus-visible .cw-tool-tip { visibility: visible; opacity: 1; transition: none; }
      @media (hover: none) { .cw-tool-tip { display: none; } }
      /* Match the other detail rows: one line, same 13px font for label
         and value. Compact captions fit without title/ellipsis tooltips. */
      .cw-context-note { margin: 5px 0 8px; font-size: 11px; line-height: 1.45; }
      .cw-settings-actions { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 5px; }
      .cw-config-form { margin-top: 7px; }
      .cw-config-form label, .cw-settings label {
        display: grid; grid-template-columns: minmax(0, 1fr) 113px;
        gap: 9px; align-items: center; margin-top: 6px;
      }
      .cw-config-form input, .cw-settings input {
        width: 100%; border: 0; border-bottom: 1px solid rgba(100,116,139,.30); border-radius: 0 0 4px 4px;
        padding: 5px 7px; color: inherit;
        background: linear-gradient(to bottom, rgba(100,116,139,.01), rgba(100,116,139,0));
        box-shadow: inset 0 2px 4px -3px rgba(17,24,39,.16);
        font-variant-numeric: normal;
      }
      .cw-config-form input:focus-visible, .cw-settings input:focus-visible {
        outline: 0; border-bottom-color: var(--cw-accent);
      }
      .cw-input-with-indicator { position: relative; display: block; width: 100%; min-width: 0; }
      /* Consistent spin-button-free number inputs, scoped to the Watchdog only.
         Native keyboard ArrowUp/ArrowDown behavior and validation are retained. */
      #${APP}-root input[type="number"] { appearance: textfield; -moz-appearance: textfield; }
      #${APP}-root input[type="number"]::-webkit-outer-spin-button,
      #${APP}-root input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; appearance: none; margin: 0; }
      .cw-input-with-indicator input { width: 100%; min-width: 0; padding-right: 28px; }
      .cw-limit-warning { position: absolute; top: 50%; right: 8px; transform: translateY(-50%); display: grid; place-items: center; width: 15px; height: 15px; color: #ca8a04; pointer-events: none; }
      .cw-config-form button, .cw-settings button {
        border: 1px solid rgba(255,255,255,.15); border-radius: calc(9px * var(--cw-radius-scale)); padding: 6px 8px;
        background: rgba(17,24,39,.06); color: #111827; cursor: pointer;
      }
      .cw-config-form button:hover, .cw-settings button:hover { background: rgba(17,24,39,.11); }
      .cw-budget-settings, .cw-attachment-settings { margin-top: 8px; }
      .cw-estimation-settings { border-top: 1px solid rgba(100,116,139,.22); margin-top: 12px; padding-top: 9px; }
      /* Labels do not wrap even at 300px; shortened labels have full title help. */
      .cw-estimation-settings .cw-config-form label {
        grid-template-columns: minmax(0,1fr) 85px; gap: 6px; font: 400 10.5px/1.5 system-ui, sans-serif;
      }
      .cw-estimation-settings .cw-field-caption {
        display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
      }
      .cw-estimation-settings .cw-config-form input { min-width: 0; }
      .cw-estimation-settings .cw-advanced-caption { font-size: 10.5px; }
      .cw-estimation-settings .cw-settings-actions button { white-space: normal; }
      /* Manual destructive action, separate from per-chat reset. */
      /* Shared unobtrusive Save / Restore defaults actions for five groups. */
      #${APP}-root .cw-unified-actions { display: flex; align-items: center; flex-wrap: nowrap; gap: 13px; margin-top: 7px; }
      #${APP}-root .cw-unified-actions button {
        padding: 2px 0; border: 0; border-radius: 0; box-shadow: none;
        background: transparent; color: var(--cw-accent); font: 550 11px/1.35 system-ui, sans-serif;
        cursor: pointer; white-space: nowrap; min-width: 0;
      }
      #${APP}-root .cw-unified-actions button:hover { background: transparent; text-decoration: underline; }
      #${APP}-root .cw-unified-actions button:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 2px; }
            .cw-advanced-caption { font-weight: 600; color: var(--cw-muted); margin: 9px 0 4px; }
      .cw-advanced-hint { font-size: 10px; line-height: 1.5; color: var(--cw-muted); margin-top: 8px; }
            /* Independent Watchdog-only overlays. The main panel keeps its size,
         coordinates and content; only the panel-sized scrim is lightly blurred. */
      .cw-settings-scrim {
        position: absolute; inset: 0; z-index: 8;
        background: rgba(15,23,42,.08);
        backdrop-filter: blur(1.5px); -webkit-backdrop-filter: blur(1.5px);
      }
      .cw-settings-dialog {
        position: absolute; z-index: 9; top: 8px; left: 8px;
        transform: none; width: min(332px, calc(100vw - 16px));
        max-height: calc(100vh - 16px); overflow: auto; margin: 0;
        padding: 12px 14px; border-radius: calc(13px * var(--cw-radius-scale));
        border: 1px solid rgba(100,116,139,.30); background: #fff; color: #111827;
        box-shadow: 0 12px 35px rgba(0,0,0,.28);
        font: 400 11px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .cw-dialog-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 9px; position: sticky; top: -12px; z-index: 1; background: inherit; }
      .cw-dialog-header strong { font-weight: var(--cw-weight-dialog-heading); flex: 0 0 auto; }
      /* Operation feedback belongs to the header row, not the scrollable body.
         The status itself never resizes the dialog; real Diagnostics rows may. */
      .cw-dialog-header .cw-dialog-message {
        flex: 1 1 0; min-width: 0; margin: 0; padding: 0; border: 0;
        background: transparent; color: #475569; text-align: right;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        font: 500 10px/1.4 system-ui, sans-serif;
      }
      .cw-dialog-header .cw-dialog-message[hidden] { display: none; }
      /* Compact local confirmation: same non-modal layer as About/Settings. */
      .cw-limit-dialog .cw-limit-content { font-size: 11px; line-height: 1.5; }
      .cw-limit-dialog p { margin: 0 0 10px; }
      .cw-confirm-description { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 10px; }
      .cw-limit-estimates { border-top: 1px solid rgba(100,116,139,.22); border-bottom: 1px solid rgba(100,116,139,.22); padding: 7px 0; margin-bottom: 11px; }
      .cw-limit-estimates > div { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 3px 0; }
      .cw-limit-estimates span { color: var(--cw-muted); }
      .cw-limit-estimates strong { font-variant-numeric: tabular-nums; white-space: nowrap; }
      .cw-limit-consequence { color: #4b5563; }
      .cw-limit-replacement { color: #b45309; font-weight: 550; }
      .cw-limit-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 13px; }
      #${APP}-root .cw-limit-actions button { cursor: pointer; padding: 7px 10px; border: 1px solid rgba(100,116,139,.30); border-radius: calc(7px * var(--cw-radius-scale)); font: 600 11px/1.3 system-ui,sans-serif; background: transparent; color: inherit; }
      #${APP}-root .cw-limit-actions .cw-confirm-limit,
      #${APP}-root .cw-limit-actions .cw-confirm-ok { background: var(--cw-accent); border-color: var(--cw-accent); color: #fff; }
      #${APP}-root .cw-limit-actions .cw-confirm-limit:hover,
      #${APP}-root .cw-limit-actions .cw-confirm-ok:hover { box-shadow: inset 0 0 0 1px rgba(0,0,0,.22); }
      /* Confirmations only: actions are text, with original button semantics. */
      #${APP}-root .cw-confirm-dialog .cw-limit-actions button {
        appearance: none; border: 0; border-radius: 0; padding: 7px 5px;
        background: transparent; box-shadow: none;
      }
      #${APP}-root .cw-confirm-dialog .cw-cancel-confirm { color: var(--cw-accent); }
      #${APP}-root .cw-confirm-dialog .cw-confirm-ok { color: #b91c1c; }
      #${APP}-root .cw-confirm-dialog .cw-limit-actions button:hover {
        background: transparent; text-decoration: underline;
      }
      #${APP}-root[data-cw-palette="dark"] .cw-confirm-dialog .cw-confirm-ok { color: #fca5a5; }
      #${APP}-root[data-cw-palette="dark"] .cw-limit-consequence { color: var(--cw-muted); }
      #${APP}-root[data-cw-palette="dark"] .cw-limit-replacement { color: #fbbf24; }
      /* About shares the panel-scoped window, but not Settings controls. */
      .cw-about-dialog { font-size: 11px; line-height: 1.5; }
      .cw-about-product { font-weight: 650; font-size: 12px; }
      .cw-about-version { color: var(--cw-muted); font-size: var(--cw-type-caption); margin: 1px 0 10px; }
      .cw-about-dialog p { margin: 0 0 9px; }
      .cw-about-dialog p strong { font-weight: var(--cw-weight-dialog-heading); }
      /* Native disclosures share the same interaction and focus treatment.
         Specialized classes control only section-specific spacing and typography. */
      .cw-disclosure > summary { cursor: pointer; user-select: none; line-height: 1.55; color: var(--cw-muted); }
      .cw-disclosure > summary:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 2px; border-radius: 3px; }
      .cw-about-section, .cw-about-terms { border-top: 1px solid rgba(100,116,139,.22); padding: 7px 0 5px; }
      .cw-about-section > summary, .cw-about-terms > summary { font-weight: 600; }
      .cw-about-glossary { margin-top: 6px; padding-left: 6px; }
      .cw-about-section > dl, .cw-about-section > p, .cw-about-section > .cw-about-credit { margin-top: 8px; }
      .cw-about-section > dl { margin-bottom: 2px; }
      .cw-about-section dt { font-weight: 600; color: inherit; margin: 7px 0 1px; }
      .cw-about-section dd { margin: 0; color: #4b5563; overflow-wrap: anywhere; }
      .cw-about-credit { color: var(--cw-muted); font-size: var(--cw-type-caption); line-height: 1.45; }
      .cw-about-credit-section { padding-bottom: 3px; }
      #${APP}-root .cw-close-settings, #${APP}-root .cw-close-about, #${APP}-root .cw-close-limit, #${APP}-root .cw-close-confirm {
        appearance: none; width: 27px; height: 27px; flex: 0 0 auto;
        display: grid; place-items: center; border: 0;
        border-radius: calc(7px * var(--cw-radius-scale)); background: transparent; color: inherit; cursor: pointer;
        font: 500 14px/1 system-ui, sans-serif;
      }
      #${APP}-root .cw-close-settings:hover, #${APP}-root .cw-close-about:hover, #${APP}-root .cw-close-limit:hover, #${APP}-root .cw-close-confirm:hover { background: rgba(100,116,139,.10); }
      .cw-settings-dialog .cw-settings { margin: 0; padding: 0; border: 0; }
      .cw-maintenance { border-bottom: 1px solid rgba(100,116,139,.22); padding-bottom: 8px; margin-bottom: 9px; }
      .cw-settings-dialog .cw-settings-actions { margin-top: 8px; }

      .cw-handoff-editor, .cw-attachment-core, .cw-metadata-only { margin-top: 11px; padding-top: 8px; border-top: 1px solid rgba(100,116,139,.22); }
      /* HANDOFF is the first Technical block: its separator belongs below it. */
      .cw-settings-dialog .cw-handoff-editor:first-child {
        margin-top: 0; padding-top: 0; border-top: 0;
        margin-bottom: 11px; padding-bottom: 8px; border-bottom: 1px solid rgba(100,116,139,.22);
      }
      .cw-handoff-editor > summary, .cw-attachment-core > summary, .cw-metadata-only > summary { font-size: 12px; font-weight: 600; }
      .cw-handoff-unsaved { margin-left: 8px; font-size: 10px; font-weight: 400; color: #b45309; }
      #${APP}-root[data-cw-palette="dark"] .cw-handoff-unsaved { color: #fbbf24; }
      .cw-handoff-content { margin-top: 7px; }
      #${APP}-root .cw-handoff-prompt {
        display: block; width: 100%; min-height: 116px; max-height: 290px;
        padding: 7px; font: 400 11px/1.4 system-ui,sans-serif; color: inherit;
        background: rgba(100,116,139,.04); border: 1px solid rgba(100,116,139,.30);
        border-radius: calc(4px * var(--cw-radius-scale)); resize: vertical;
      }
      #${APP}-root[data-cw-palette="dark"] .cw-handoff-prompt {
        background: rgba(0,0,0,.11); border-color: rgba(161,161,170,.40);
      }
      #${APP}-root .cw-handoff-prompt:focus-visible { outline: 1px solid var(--cw-accent); outline-offset: 1px; }
      #${APP}-root .cw-handoff-count { margin-top: 4px; font: 400 10px/1.4 system-ui,sans-serif; color: var(--cw-muted); }

      .cw-settings-dialog .cw-settings-actions button { min-width: 0; }
      .cw-dialog-message { margin-bottom: 7px; padding: 7px 9px; border-radius: calc(7px * var(--cw-radius-scale)); background: rgba(100,116,139,.12); }
      .cw-settings-dialog .cw-settings-actions button { font-size: 11px; }
      .cw-threshold-info { color: var(--cw-muted); font-size: var(--cw-type-diagnostic); }
      .cw-threshold-info { margin-top: 7px; }
      /* Diagnostics actions are blue text links, not filled or outlined buttons.
         Keep <button> semantics for keyboard activation and focus. */
      #${APP}-root .cw-diagnostics-tools .cw-settings-actions button {
        appearance: none; border: 0; border-radius: 0;
        background: transparent; padding: 3px 1px; color: var(--cw-accent);
        font: 550 11px/1.5 system-ui, sans-serif; cursor: pointer; text-align: left;
      }
      #${APP}-root .cw-diagnostics-tools .cw-settings-actions button:hover,
      #${APP}-root .cw-diagnostics-tools .cw-settings-actions button:focus-visible {
        background: transparent; text-decoration: underline;
      }
      #${APP}-root .cw-diagnostics-tools .cw-settings-actions button:focus-visible {
        outline: 2px solid var(--cw-accent); outline-offset: 2px; border-radius: calc(2px * var(--cw-radius-scale));
      }
      .cw-diagnostics-line, .cw-history-line {
        margin-top: 5px; font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere; line-height: 1.6;
      }
      .cw-diagnostics-line { white-space: pre-line; }
      .cw-history-line { white-space: normal; }
      .cw-history { white-space: pre-line; }
      .cw-history-note { color: var(--cw-muted); font-size: var(--cw-type-caption); font-weight: var(--cw-weight-body); }
      .cw-history-line > div + div { margin-top: 5px; }
      .cw-performance-details { border-top: 1px solid rgba(100,116,139,.22); margin-top: 9px; padding-top: 7px; }
      .cw-performance-line { margin-top: 5px; white-space: pre-line; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; line-height: 1.6; }
      .cw-reset-chat { color: #b91c1c !important; }
      /* Right-anchored, no reserved height. A short notice leaves the local
         status readable; longer notices may cover its TEXT, never Pause/Start. */
      .cw-notice-lane {
        position: absolute; left: 21px; right: 0; bottom: 0;
        min-width: 0; height: 19px; display: flex;
        justify-content: flex-end; align-items: center; pointer-events: none;
        z-index: 1;
      }
      .cw-toast {
        min-width: 0; max-width: 100%; width: max-content;
        padding: 1px 7px; margin: 0;
        border: 1px solid var(--cw-toast-border);
        border-radius: calc(6px * var(--cw-radius-scale));
        background: var(--cw-toast-bg); color: var(--cw-toast-ink);
        box-shadow: none; font: 500 var(--cw-type-caption)/1.3 system-ui, sans-serif;
        white-space: nowrap; overflow: hidden; text-overflow: clip;
        text-align: right; pointer-events: none;
      }
      #${APP}-root .cw-toast[data-cw-notice-level="error"] {
        border-color: var(--cw-toast-error-border);
        background: var(--cw-toast-error-bg); color: var(--cw-toast-error-ink);
      }
      .cw-recent-errors { margin: 4px 0 8px; }
      .cw-recent-errors-list {
        font-size: var(--cw-type-diagnostic); color: var(--cw-muted);
        line-height: 1.55; padding: 3px 0 2px;
        user-select: text; -webkit-user-select: text; cursor: text;
      }
      .cw-recent-error-entry + .cw-recent-error-entry { margin-top: 4px; }
      #${APP}-root[data-cw-palette="dark"] .cw-config-form button, #${APP}-root[data-cw-palette="dark"] .cw-settings button { background: rgba(255,255,255,.08); color: #f3f4f6; }
      #${APP}-root[data-cw-palette="dark"] .cw-config-form button:hover, #${APP}-root[data-cw-palette="dark"] .cw-settings button:hover, #${APP}-root[data-cw-palette="dark"] .cw-tool-button:hover { background: rgba(255,255,255,.13); }
      /* Keep Save / Restore defaults as text actions in dark mode too. */
      #${APP}-root[data-cw-palette="dark"] .cw-unified-actions button,
      #${APP}-root[data-cw-palette="dark"] .cw-unified-actions button:hover {
        background: transparent; color: var(--cw-accent);
      }
      #${APP}-root[data-cw-palette="dark"] .cw-config-form input, #${APP}-root[data-cw-palette="dark"] .cw-settings input {
        background: linear-gradient(to bottom, rgba(0,0,0,.06), rgba(0,0,0,0));
        box-shadow: inset 0 2px 4px -3px rgba(0,0,0,.17);
        border-bottom-color: rgba(161,161,170,.40);
      }
      #${APP}-root[data-cw-palette="dark"] .cw-config-form input:focus-visible,
      #${APP}-root[data-cw-palette="dark"] .cw-settings input:focus-visible { border-bottom-color: var(--cw-accent); }
      #${APP}-root[data-cw-palette="dark"] .cw-dialog-header .cw-dialog-message { color: #cbd5e1; }
      #${APP}-root[data-cw-palette="dark"] .cw-about-section dd { color: var(--cw-muted); }
      #${APP}-root[data-cw-palette="dark"] .cw-diagnostics-tools .cw-settings-actions button { color: var(--cw-accent); }
      #${APP}-root [hidden] { display: none !important; }
      .cw-storage-indicator {
        display: inline-grid; place-items: center; background: #dc2626;
        color: white; border-radius: 50%; width: 15px;
        height: 15px; font-size: 11px; font-weight: 800;
      }
      .cw-tabs button {
        cursor: pointer; min-width: 0;
        display: inline-flex; align-items: center; justify-content: center; gap: 4px;
        white-space: nowrap;
      }
      /* Small outlined status pictograms to the right of the unbroken tab title. */
      .cw-budget-tab-mark {
        display: inline-flex; width: 14px; height: 14px; flex: 0 0 14px;
        align-items: center; justify-content: center; line-height: 1;
      }
      .cw-budget-tab-mark svg { display: none; width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
      .cw-budget-tab-mark .cw-status-pending { display: none; font-weight: 700; }
      .cw-budget-tab-mark[data-level="pending"] { color: #64748b; }
      .cw-budget-tab-mark[data-level="ok"] { color: var(--cw-accent); }
      .cw-budget-tab-mark[data-level="caution"] { color: #ca8a04; }
      .cw-budget-tab-mark[data-level="critical"] { color: #ef4444; }
      .cw-budget-tab-mark[data-level="pending"] .cw-status-pending,
      .cw-budget-tab-mark[data-level="ok"] .cw-status-ok,
      .cw-budget-tab-mark[data-level="caution"] .cw-status-caution,
      .cw-budget-tab-mark[data-level="critical"] .cw-status-critical { display: block; }
      /* Context: the detected data and locally estimated visible text. */
      .cw-forecast-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .cw-forecast-cards > div { min-width: 0; }
      .cw-card-caption { display: block; font-size: var(--cw-type-diagnostic); color: var(--cw-muted); margin-bottom: 3px; }
      .cw-card-value { display: block; font: 600 13px/1.45 system-ui, sans-serif; font-variant-numeric: tabular-nums; }
      .cw-context-summary { border-top: 1px solid rgba(100,116,139,.22); margin-top: 10px; padding-top: 7px; }
      .cw-context-note { margin-top: 5px; color: var(--cw-muted); font: 400 11px/1.45 system-ui,sans-serif; }
      /* Semantic hierarchy: total context is primary, text only secondary. */
      #${APP}-root .cw-context-summary {
        border-top: 0; margin-top: 0; padding-top: 0;
        padding-bottom: 5px; border-bottom: 1px solid rgba(100,116,139,.22);
      }
      #${APP}-root .cw-context-primary-row {
        display: flex; justify-content: space-between; align-items: baseline;
        gap: 8px; min-width: 0; white-space: nowrap;
      }
      #${APP}-root .cw-context-primary-label {
        color: var(--cw-muted); white-space: nowrap;
      }
      #${APP}-root .cw-context-range {
        font: 600 13px/1.45 system-ui,sans-serif;
        white-space: nowrap;
      }
      #${APP}-root .cw-context-summary .cw-data-row { margin-top: 3px; }
      #${APP}-root .cw-context-text-only {
        display: flex; justify-content: space-between; align-items: baseline;
        flex-wrap: wrap; gap: 2px 8px; font-size: 12px;
      }
      #${APP}-root .cw-context-text-only .cw-card-caption { margin: 0; }
      #${APP}-root .cw-context-characters { flex: 1 0 100%; text-align: right; color: var(--cw-muted); }
      .cw-data-attachment { border-top: 1px solid rgba(100,116,139,.22); margin-top: var(--cw-space-block); padding-top: var(--cw-space-block); }
      .cw-data-row { display: flex; justify-content: space-between; align-items: baseline; gap: 7px; font-size: 11px; margin: 4px 0; }
      .cw-data-row > span { color: var(--cw-muted); flex: 0 0 auto; }
      .cw-data-row > strong { text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
      /* Stable two-line file accounting; all five counters remain visible. */
      .cw-file-accounting-row, .cw-file-accounting-continuation { white-space: nowrap; }
      #${APP}-root .cw-data-row.cw-file-accounting-row > strong,
      #${APP}-root .cw-data-row.cw-file-accounting-continuation > strong { font-size: 10px; overflow-wrap: normal; }
      .cw-file-accounting-continuation { justify-content: flex-end; margin-top: 0; }
      /* Budget: only the status signal is colored on the tab itself. */
      .cw-forecast-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 7px; margin-bottom: var(--cw-space-block); }
            .cw-forecast-status { text-align: right; }
      .cw-forecast-cards { margin-bottom: var(--cw-space-block); }
      /* Budget value legends use the same Context typography. */
      .cw-forecast-group { margin: var(--cw-space-row) 0; }
      .cw-forecast-group-title { margin-bottom: 3px; }
      .cw-progress-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
      /* Budget track legends use the same Context typography. */
      .cw-progress-track {
        position: relative; background: rgba(100,116,139,.17); height: 9px;
        border-radius: calc(99px * var(--cw-radius-scale)); overflow: hidden;
        /* A softer outside shadow than the primary tabs; no inner bevel. */
        box-shadow: 3px -1px 6px -5px rgba(15,23,42,.16),
                    0 1px 4px -3px rgba(15,23,42,.08);
      }
      #${APP}-root[data-cw-palette="dark"] .cw-progress-track {
        box-shadow: 3px -1px 6px -5px rgba(0,0,0,.32),
                    0 1px 4px -3px rgba(0,0,0,.18);
      }
      .cw-progress-fill { position: absolute; inset: 0 auto 0 0; background: var(--cw-accent); width: 0; height: 100%; border-radius: inherit; opacity: .8; }
      /* One legible percentage inside either the filled or unfilled segment. */
      #${APP}-root .cw-progress-percent {
        position: absolute; z-index: 1; top: 0; left: 0; width: 100%; height: 100%;
        display: flex; align-items: center; justify-content: center;
        padding: 0; font: 600 9px/1 system-ui,sans-serif;
        font-variant-numeric: tabular-nums; white-space: nowrap;
        color: #111827; pointer-events: none;
      }
      #${APP}-root .cw-progress-percent[data-cw-on-fill="true"] { color: #fff; }
      #${APP}-root[data-cw-palette="dark"] .cw-progress-percent[data-cw-on-fill="false"] { color: #f4f4f5; }
      /* Details: diagnostics typography, plain lines without section headings. */
      .cw-details-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--cw-space-row); font-size: 11px; font-weight: 600; }
      /* Match the primary Context label, not the compact Copy action. */
      #${APP}-root .cw-details-header > span {
        font-size: var(--cw-type-label); font-weight: var(--cw-weight-label);
        line-height: 1.4; color: var(--cw-muted);
      }
      .cw-copy-details { appearance: none; border: 0; background: transparent; color: var(--cw-accent); padding: 2px 1px; font: 550 11px/1.5 system-ui, sans-serif; cursor: pointer; }
      .cw-copy-details:hover, .cw-copy-details:focus-visible { text-decoration: underline; }
      .cw-copy-details:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 2px; }
      .cw-details-report { font: 400 11px/1.6 system-ui, sans-serif; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
      .cw-detail-group { border-top: 1px solid rgba(100,116,139,.22); padding: var(--cw-space-row) 0; }
      .cw-detail-group > div { margin: 0; }
      .cw-detail-group > .cw-detail-legend { color: var(--cw-muted); font-weight: var(--cw-weight-body); font-size: var(--cw-type-caption); }
      .cw-storage-warning {
        border: 1px solid #dc2626; color: #b91c1c; background: rgba(220,38,38,.08);
        padding: 8px; border-radius: calc(9px * var(--cw-radius-scale)); margin: 7px 0;
        font-size: 11px; overflow-wrap: anywhere;
      }
      #${APP}-root[data-cw-palette="dark"] .cw-storage-warning { color: #fca5a5; }

      /* Primary tabs use a lightweight browser-inspired contour. */
      #${APP}-root .cw-tabs {
        display: grid; grid-template-columns: .84fr 1.62fr .78fr; margin: 1px 0 6px;
      }
      #${APP}-root .cw-tabs button { padding: 7px 5px 6px;
        font: 500 11px/1.2 system-ui, sans-serif;
      }
      #${APP}-root .cw-tabs button[aria-selected="true"] { font-weight: 650; }
      #${APP}-root .cw-tabs button:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: -3px; }
      /* Mini tabs: no headings or secondary expansion arrows; no blue nav links. */
      #${APP}-root .cw-estimation-settings { margin-top: 7px; padding-top: 6px; }
      #${APP}-root .cw-mini-nav { display: flex; gap: 7px; align-items: center; flex-wrap: nowrap; white-space: nowrap; }
      #${APP}-root .cw-estimation-settings .cw-mini-nav { gap: 7px; justify-content: flex-start; }
      #${APP}-root .cw-mini-nav .cw-mini-tab {
        appearance: none; border: 0; background: transparent; color: var(--cw-muted);
        padding: 4px 1px 5px; margin: 0;
        font: 500 10.2px/1.35 system-ui, sans-serif; white-space: nowrap;
        cursor: pointer; min-width: 0;
      }
      #${APP}-root .cw-mini-nav .cw-mini-tab:hover { color: inherit; background: transparent; }
      #${APP}-root .cw-mini-nav .cw-mini-tab.cw-mini-active {
        color: inherit; font-weight: 650; border-bottom-color: currentColor;
      }
      #${APP}-root .cw-mini-tab:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 1px; }
      #${APP}-root .cw-mini-pane { border-top: 1px solid rgba(100,116,139,.20); margin-top: 6px; padding-top: 6px; }
      /* Context estimation tabs already separate the content above them.
         Do not draw a second separator before the first item inside a pane. */
      #${APP}-root .cw-estimation-settings .cw-mini-pane { border-top: 0; padding-top: 0; }
      #${APP}-root .cw-attachment-settings .cw-config-form > .cw-attachment-core:first-child {
        margin-top: 0; padding-top: 0; border-top: 0;
      }
      #${APP}-root .cw-estimation-settings .cw-mini-pane .cw-config-form { margin-top: 0; }
      #${APP}-root .cw-budget-navigation { border-top: 1px solid rgba(100,116,139,.22); margin-top: var(--cw-space-section); padding-top: var(--cw-space-block); }
      #${APP}-root .cw-budget-navigation .cw-mini-pane { margin-top: var(--cw-space-block); }
      #${APP}-root .cw-budget-mini-nav { gap: 6px; }
      #${APP}-root .cw-budget-mini-nav .cw-mini-tab { padding-left: 3px; padding-right: 3px; }
      #${APP}-root .cw-budget-editor { border-top: 1px solid rgba(100,116,139,.17); margin: var(--cw-space-block) 0 0; padding-top: var(--cw-space-block); }
      #${APP}-root .cw-budget-editor > summary { font: 600 11px/1.5 system-ui,sans-serif; }
      #${APP}-root .cw-budget-editor .cw-config-form { margin-top: var(--cw-space-block); }
      #${APP}-root .cw-budget-navigation .cw-forecast-group:last-of-type { margin-bottom: var(--cw-space-section); }
      #${APP}-root .cw-tools-nav { margin-bottom: 1px; }
      #${APP}-root .cw-settings-dialog .cw-mini-pane .cw-settings-actions { margin-top: 6px; }
      /* Destructive and safe actions look like text, never pill buttons. */
      #${APP}-root button.cw-text-action,
      #${APP}-root button.cw-danger-action {
        appearance: none; border: 0; border-radius: 0; background: transparent;
        padding: 2px 0; box-shadow: none; font: 550 11px/1.4 system-ui, sans-serif;
        cursor: pointer; white-space: nowrap; text-align: left;
      }
      #${APP}-root button.cw-text-action { color: var(--cw-accent) !important; }
      #${APP}-root button.cw-danger-action { color: #b91c1c !important; }
      #${APP}-root button.cw-text-action:hover,
      #${APP}-root button.cw-danger-action:hover { background: transparent; text-decoration: underline; }
      #${APP}-root button.cw-text-action:focus-visible,
      #${APP}-root button.cw-danger-action:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 2px; }
      #${APP}-root button.cw-text-action:disabled,
      #${APP}-root button.cw-danger-action:disabled { opacity: .45; cursor: not-allowed; }
      #${APP}-root .cw-reset-line {
        display: flex; flex-wrap: nowrap; align-items: baseline; gap: 8px;
        white-space: nowrap;
      }
      /* Watchdog-local dialogs size independently; scroll only at viewport limit. */
      #${APP}-root .cw-settings-dialog { transform: none; }
      #${APP}-root .cw-floating-tip {
        position: fixed; z-index: 20;
        max-width: min(245px, calc(100vw - 16px));
        border: 1px solid rgba(100,116,139,.38); box-shadow: 0 4px 14px rgba(0,0,0,.2);
        font: 500 11px/1.35 system-ui,sans-serif;
      }
      #${APP}-root .cw-floating-tip .cw-tip-logo {
        display: inline-block; width: 18px; height: 18px; vertical-align: -5px;
        position: relative; left: auto; top: auto; transform: none;
        filter: none;
      }
      /* Tooltip is dark in both palettes; static Watchdog mark keeps a white rim. */
      #${APP}-root .cw-floating-tip .cw-tip-logo.cw-brand-mark:not(.cw-has-site-logo) {
        --cw-watchdog-outline: #fff;
      }
      #${APP}-root .cw-floating-tip .cw-tip-logo.cw-has-site-logo,
      #${APP}-root[data-cw-palette="dark"] .cw-floating-tip .cw-tip-logo.cw-has-site-logo {
        background: none;
        color: inherit; opacity: 1;
      }
      #${APP}-root[data-cw-palette="dark"] .cw-mini-nav .cw-mini-tab { color: var(--cw-muted); }
      #${APP}-root[data-cw-palette="dark"] button.cw-danger-action { color: #fca5a5 !important; }


      /* One set of component styles for both modes. Palette owns colors;
         Soft/Sharp differ only in corner treatment and Sharp's bevel shape. */
      #${APP}-root {
        --cw-ink: #111827;
        --cw-muted: #6b7280;
        --cw-accent: #2563eb;
        --cw-watchdog-ink: #080808;
        --cw-watchdog-gray: #3f3e3e;
        --cw-watchdog-outline: transparent;
        --cw-panel-surface: rgba(255,255,255,.80);
        --cw-panel-border: rgba(17,24,39,.16);
        --cw-panel-shadow: 0 12px 40px rgba(0,0,0,.16);
        --cw-dialog-surface: #fff;
        --cw-dialog-border: rgba(100,116,139,.30);
        --cw-dialog-shadow: 0 12px 35px rgba(0,0,0,.28);
        --cw-chip-surface: rgba(255,255,255,.88);
        --cw-chip-border: rgba(100,116,139,.16);
        --cw-scrim: rgba(15,23,42,.08);
        --cw-radius-scale: 1;
        --cw-toast-bg: #eaf3ff;
        --cw-toast-border: #b6d6ff;
        --cw-toast-ink: #2159a4;
        --cw-toast-error-bg: #fce8e8;
        --cw-toast-error-border: #e5aaaa;
        --cw-toast-error-ink: #922b2b;
        /* Shared vertical rhythm across Context, Budget forecast and Details. */
        --cw-space-row: 5px;
        --cw-space-block: 6px;
        --cw-space-section: 8px;
        color-scheme: light;
      }
      #${APP}-root[data-cw-palette="dark"] {
        --cw-ink: #f3f4f6;
        --cw-muted: #a1a1aa;
        --cw-accent: #4f93e6;
        --cw-watchdog-outline: #fff;
        --cw-panel-surface: rgba(18,18,18,.80);
        --cw-panel-border: rgba(255,255,255,.16);
        --cw-panel-shadow: 0 12px 40px rgba(0,0,0,.35);
        --cw-dialog-surface: #18181b;
        --cw-dialog-border: rgba(255,255,255,.18);
        --cw-dialog-shadow: 0 12px 35px rgba(0,0,0,.35);
        --cw-chip-surface: rgba(17,24,39,.90);
        --cw-chip-border: rgba(161,161,170,.22);
        --cw-scrim: rgba(0,0,0,.10);
        --cw-toast-bg: #173452;
        --cw-toast-border: #376492;
        --cw-toast-ink: #c8e4ff;
        --cw-toast-error-bg: #512929;
        --cw-toast-error-border: #8d4949;
        --cw-toast-error-ink: #ffe1e1;
        color-scheme: dark;
      }
      #${APP}-root[data-cw-style="sharp"] { --cw-radius-scale: 0; }
      #${APP}-root .cw-panel {
        background: var(--cw-panel-surface); color: var(--cw-ink);
        border-color: var(--cw-panel-border); box-shadow: var(--cw-panel-shadow);
      }
      #${APP}-root .cw-settings-dialog {
        background: var(--cw-dialog-surface); color: var(--cw-ink);
        border-color: var(--cw-dialog-border); box-shadow: var(--cw-dialog-shadow);
      }
      #${APP}-root .cw-settings-scrim { background: var(--cw-scrim); }
      #${APP}-root .cw-chip { background: var(--cw-chip-surface); color: var(--cw-ink); }
      #${APP}-root .cw-chip .cw-metric { color: var(--cw-ink); }
      /* Appearance choices are borderless and separated by middle dots.
         The hidden bold text grid layer reserves each option's maximum width,
         so changing which word is bold never shifts the other controls. */
      #${APP}-root .cw-view-preferences { margin-top: 9px; }
      #${APP}-root .cw-view-setting-row {
        display: grid; grid-template-columns: 62px minmax(0,1fr);
        align-items: center; column-gap: 4px; margin: 10px 0;
      }
      #${APP}-root .cw-view-label {
        font: 400 11px/1.4 system-ui,sans-serif; color: var(--cw-muted);
      }
      #${APP}-root .cw-view-options {
        display: flex; align-items: center; gap: 5px; min-width: 0;
      }
      #${APP}-root .cw-view-options button {
        appearance: none; display: inline-grid; align-items: center;
        flex: 0 0 auto; margin: 0; padding: 3px 0;
        border: 0; border-radius: 0; background: transparent;
        color: var(--cw-muted); font: 400 12px/1.4 system-ui,sans-serif;
        cursor: pointer; white-space: nowrap;
      }
      #${APP}-root .cw-view-options button::before,
      #${APP}-root .cw-view-options button > span { grid-area: 1 / 1; }
      #${APP}-root .cw-view-options button::before {
        content: attr(data-cw-label); font-weight: 700; visibility: hidden;
      }
      #${APP}-root .cw-view-options button:hover { background: transparent; color: var(--cw-ink); }
      #${APP}-root .cw-view-options button[aria-pressed="true"] {
        background: transparent; color: var(--cw-ink);
      }
      #${APP}-root .cw-view-options button[aria-pressed="true"] > span { font-weight: 700; }
      #${APP}-root .cw-view-options button:focus-visible {
        outline: 1px solid var(--cw-muted); outline-offset: 2px;
      }
      #${APP}-root .cw-view-separator {
        flex: 0 0 auto; color: var(--cw-ink);
        font: 500 12px/1.4 system-ui,sans-serif; user-select: none;
      }
      #${APP}-root .cw-tools-nav { gap: 9px; }

      /* Shared component geometry: Soft rounds corners via --cw-radius-scale. */
      #${APP}-root .cw-toolbar .cw-tool-button {
        color: #111827; border: 1px solid transparent; border-radius: calc(10px * var(--cw-radius-scale));
        background: transparent; box-shadow: none;
      }
      #${APP}-root .cw-toolbar .cw-tool-button:hover {
        background: rgba(100,116,139,.095); border-color: transparent;
      }
      /* Browser-inspired, softly rounded top-level tabs, never isolated pills. */
      #${APP}-root .cw-tabs {
        gap: 2px; padding: 0 1px;
        border-bottom: 1px solid rgba(100,116,139,.23);
      }
      #${APP}-root .cw-tabs button {
        clip-path: none; margin-bottom: 0; min-height: 33px;
        border: 1px solid rgba(100,116,139,.10);
        border-radius: calc(12px * var(--cw-radius-scale)) calc(12px * var(--cw-radius-scale)) calc(3px * var(--cw-radius-scale)) calc(3px * var(--cw-radius-scale));
        background: rgba(100,116,139,.04); color: #8a929f;
        box-shadow: none;
      }
      #${APP}-root .cw-tabs button[aria-selected="true"] {
        position: relative; z-index: 1; margin-bottom: -1px;
        padding-bottom: 7px; border-radius: calc(12px * var(--cw-radius-scale)) calc(12px * var(--cw-radius-scale)) 0 0;
        border: 1px solid rgba(100,116,139,.19); border-bottom-color: transparent;
        background: rgba(255,255,255,.75); color: #111827;
        box-shadow: 4px -1px 8px -6px rgba(15,23,42,.24),
                    0 -2px 5px -5px rgba(15,23,42,.12);
      }
      #${APP}-root .cw-tabs button:hover:not([aria-selected="true"]) {
        color: #4b5563; background: rgba(100,116,139,.075);
      }
      /* Always-visible mini-tab underlines: small rounded end curls. */
      #${APP}-root .cw-mini-nav .cw-mini-tab {
        position: relative; padding-bottom: 2px;
        border-bottom: 0; border-radius: 0;
      }
      #${APP}-root .cw-mini-nav .cw-mini-tab::after {
        content: ''; position: absolute; left: -2px; right: -2px; bottom: 0;
        height: 4px; border: 1.5px solid rgba(100,116,139,.29);
        border-top: 0; border-radius: 0 0 calc(5px * var(--cw-radius-scale)) calc(5px * var(--cw-radius-scale));
        pointer-events: none;
      }
      #${APP}-root .cw-mini-nav .cw-mini-tab.cw-mini-active::after {
        border-color: rgba(17,24,39,.80); border-top: 0;
      }
      #${APP}-root[data-cw-palette="dark"] .cw-toolbar .cw-tool-button { color: #f3f4f6; }
      #${APP}-root[data-cw-palette="dark"] .cw-tabs button {
          color: #96969f; background: rgba(255,255,255,.035);
          border-color: rgba(255,255,255,.065);
        }
      #${APP}-root[data-cw-palette="dark"] .cw-tabs button[aria-selected="true"] {
          color: #f3f4f6; background: rgba(255,255,255,.14);
          border: 1px solid rgba(255,255,255,.16); border-bottom-color: transparent;
          box-shadow: 4px -1px 9px -6px rgba(0,0,0,.50),
                      0 -2px 5px -5px rgba(0,0,0,.30);
        }
      #${APP}-root[data-cw-palette="dark"] .cw-tabs button:hover:not([aria-selected="true"]) {
          color: #d4d4d8; background: rgba(255,255,255,.075);
        }
      #${APP}-root[data-cw-palette="dark"] .cw-mini-nav .cw-mini-tab::after {
          border-color: rgba(161,161,170,.45); border-top: 0;
        }
      #${APP}-root[data-cw-palette="dark"] .cw-mini-nav .cw-mini-tab.cw-mini-active::after {
          border-color: rgba(244,244,245,.9); border-top: 0;
        }
      /* Sharp changes shape, not dimensions, palette, typography, hit areas,
         padding or hover. Every other component inherits the shared rules. */
      #${APP}-root[data-cw-style="sharp"], #${APP}-root[data-cw-style="sharp"] *,
      #${APP}-root[data-cw-style="sharp"] *::before, #${APP}-root[data-cw-style="sharp"] *::after {
        border-radius: 0 !important;
      }
      #${APP}-root[data-cw-style="sharp"] .cw-tabs button {
        clip-path: polygon(7px 0, 100% 0, 100% 100%, 0 100%);
      }
      /* The beveled surface is decorative. Keep the native rectangular
         button hit area and the shared focus outline. */
      #${APP}-root[data-cw-style="sharp"] .cw-chip {
        position: relative; isolation: isolate;
        border-color: transparent; background: transparent;
        box-shadow: none; backdrop-filter: none; -webkit-backdrop-filter: none;
      }
      #${APP}-root[data-cw-style="sharp"] .cw-chip::before,
      #${APP}-root[data-cw-style="sharp"] .cw-chip::after {
        content: ''; position: absolute; pointer-events: none;
      }
      #${APP}-root[data-cw-style="sharp"] .cw-chip::before {
        inset: 0; z-index: -2; background: var(--cw-chip-border);
        clip-path: polygon(7px 0, 100% 0, 100% 100%, 0 100%);
      }
      #${APP}-root[data-cw-style="sharp"] .cw-chip::after {
        inset: 1px; z-index: -1; background: var(--cw-chip-surface);
        clip-path: polygon(6px 0, 100% 0, 100% 100%, 0 100%);
      }
      /* Semantic typography shared by Stable and Dev. Dev responsive rules
         are injected separately by the Dev build only. */
      #${APP}-root {
        --cw-type-title: 16px;
        --cw-type-key: 15px;
        --cw-type-badge: 14px;
        --cw-type-value: 12px;
        --cw-type-label: 13px;
        --cw-type-body: 12px;
        --cw-type-caption: 10px;
        --cw-type-nav: 11px;
        --cw-type-tab: 12px;
        --cw-type-diagnostic: 11px;
        --cw-weight-key: 700;
        --cw-weight-heading: 600;
        --cw-weight-value: 600;
        --cw-weight-label: 500;
        --cw-weight-body: 400;
        --cw-weight-dialog-heading: 650;
      }
      /* Context and Budget share a key-value role; badge keeps a separate compact role. */
      #${APP}-root .cw-chip .cw-metric,
      #${APP}-root .cw-context-range,
      #${APP}-root .cw-forecast-cards .cw-forecast-opt,
      #${APP}-root .cw-forecast-cards .cw-forecast-pess {
        font-family: inherit;
        font-size: var(--cw-type-key);
        font-weight: var(--cw-weight-key);
        line-height: 1.35;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0;
      }
      /* Compact spacing keeps five header actions aligned. */
      #${APP}-root .cw-toolbar { gap: 1px; }
      #${APP}-root .cw-toolbar .cw-tool-button { width: 26px; height: 30px; }
      #${APP}-root .cw-toolbar .cw-pin-panel[aria-pressed="true"] { color: var(--cw-accent); background: transparent; }
      #${APP}-root .cw-toolbar .cw-pin-panel svg { transform: rotate(-32deg); transform-origin: center; transition: transform .15s ease; }
      #${APP}-root .cw-toolbar .cw-pin-panel[aria-pressed="true"] svg { transform: none; }
      /* Badge typography is independent of key context estimates. */
      #${APP}-root .cw-chip .cw-metric { font-size: var(--cw-type-badge); font-weight: var(--cw-weight-body); }
      /* Secondary values use the same 13px size as labels; labels retain
         their muted color, while values use regular weight to keep the three
         context estimates and badge as the only strong numeric accents. */
      #${APP}-root .cw-context-text-only .cw-data-tokens,
      #${APP}-root .cw-data-row > strong,
      #${APP}-root .cw-limit-estimates strong {
        font-family: inherit;
        font-size: var(--cw-type-label);
        font-weight: var(--cw-weight-body);
        font-variant-numeric: tabular-nums;
        letter-spacing: 0;
      }
      #${APP}-root .cw-context-characters strong {
        font-family: inherit;
        font-size: var(--cw-type-caption);
        font-weight: var(--cw-weight-body);
        font-variant-numeric: tabular-nums;
      }
      /* Common primary labels and section headings. */
      #${APP}-root .cw-context-primary-label,
      #${APP}-root .cw-context-text-only .cw-card-caption,
      #${APP}-root .cw-data-row > span,
      #${APP}-root .cw-limit-estimates span {
        font-size: var(--cw-type-label);
        font-weight: var(--cw-weight-label);
        line-height: 1.4;
      }
      #${APP}-root .cw-advanced-caption,
      #${APP}-root .cw-about-section dt,
      #${APP}-root .cw-forecast-heading > strong,
      #${APP}-root .cw-forecast-group-title,
      #${APP}-root .cw-about-product,
      #${APP}-root .cw-about-section > summary,
      #${APP}-root .cw-about-terms > summary {
        font-family: inherit;
        font-size: var(--cw-type-label);
        font-weight: var(--cw-weight-heading);
        line-height: 1.4;
      }
      #${APP}-root .cw-forecast-status {
        font-size: var(--cw-type-label);
        font-weight: var(--cw-weight-value);
      }
      /* Budget labels follow the Context panel's muted hierarchy. Only ink changes
         for Edit token budgets; its original 11px type and disclosure remain. */
      #${APP}-root .cw-forecast-heading > strong,
      #${APP}-root .cw-forecast-group-title,
      #${APP}-root .cw-budget-editor > summary { color: var(--cw-muted); }
      #${APP}-root .cw-forecast-heading { flex-wrap: wrap; row-gap: 2px; }
      /* Captions are close to their numbers, never a separate visual block. */
      #${APP}-root .cw-context-summary .cw-context-note,
      #${APP}-root .cw-forecast-cards .cw-context-note,
      #${APP}-root .cw-progress-grid .cw-context-note {
        font-family: inherit;
        font-size: var(--cw-type-caption);
        font-weight: var(--cw-weight-body);
        line-height: 1.35;
        margin: 2px 0 3px;
      }
      #${APP}-root .cw-context-summary .cw-context-note > span { display: block; }
      #${APP}-root .cw-context-characters,
      #${APP}-root .cw-about-version,
      #${APP}-root .cw-about-credit,
      #${APP}-root .cw-advanced-hint,
      #${APP}-root .cw-dialog-header .cw-dialog-message {
        font-family: inherit;
        font-size: var(--cw-type-caption);
        font-weight: var(--cw-weight-body);
        line-height: 1.4;
      }
      #${APP}-root .cw-context-text-only { margin-top: 5px; }
      /* Primary UI labels: 13px; numeric settings: 12px; supporting body: 12px.
         Navigation tabs: 12px (11px narrow); action links and dense reports: 11px. */
      #${APP}-root .cw-about-dialog,
      #${APP}-root .cw-limit-dialog .cw-limit-content,
      #${APP}-root .cw-settings-dialog {
        font-size: var(--cw-type-body);
        line-height: 1.5;
      }
      #${APP}-root .cw-config-form label,
      #${APP}-root .cw-settings label { font-size: var(--cw-type-body); }
      #${APP}-root .cw-config-form input[type="number"],
      #${APP}-root .cw-settings input[type="number"] {
        font-family: inherit;
        font-size: var(--cw-type-value);
        padding-top: 3px; padding-bottom: 3px;
        font-weight: var(--cw-weight-body);
        font-variant-numeric: normal;
      }
      #${APP}-root .cw-tools-nav .cw-mini-tab,
      #${APP}-root .cw-budget-mini-nav .cw-mini-tab,
      #${APP}-root .cw-copy-details,
      #${APP}-root .cw-settings-dialog .cw-settings-actions button,
      #${APP}-root .cw-limit-actions button {
        font-family: inherit;
        font-size: var(--cw-type-nav);
      }
      /* Primary/mini tabs have their own 12px role; links stay at 11px. */
      #${APP}-root .cw-tabs button,
      #${APP}-root .cw-mini-nav .cw-mini-tab {
        font-size: var(--cw-type-tab);
        font-family: inherit;
      }
      #${APP}-root .cw-details-report,
      #${APP}-root .cw-diagnostics-line,
      #${APP}-root .cw-history-line,
      #${APP}-root .cw-performance-line {
        font-family: inherit;
        font-size: var(--cw-type-diagnostic);
        line-height: 1.55;
        font-variant-numeric: tabular-nums;
      }
      #${APP}-root .cw-title-info strong { font-size: var(--cw-type-title); font-weight: var(--cw-weight-key); }
    `;

export { UI_CSS };
