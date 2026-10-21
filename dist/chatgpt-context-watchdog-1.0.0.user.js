// ==UserScript==
// @name         ChatGPT Context Watchdog (Local)
// @namespace    local.chatgpt.context.watchdog
// @version      1.0.0
// @author       f0rset1
// @description  Local-only context size watchdog for ChatGPT. One guarded, same-origin cache-only favicon lookup; no chat-data network traffic.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
  ChatGPT Context Watchdog (Local)

  Community attribution:
  Inspired by the architecture and ideas of:
  "ChatGPT-Token_Counter" by Pushpak1203
  https://github.com/Pushpak1203/ChatGPT-Token_Counter

  Design constraints:
  - Chromium; one self-contained, local-only Tampermonkey userscript
  - DOM observation and bounded one-shot checks; no network interception,
    server downloads or periodic polling; one favicon cache-only lookup is allowed
  - Per-chat UUID-keyed state:v2 ledger; ordinary capture does not overwrite
    known messages; explicit Edit/Regenerate and confirmed Repair are exceptions
  - SPA route and DOM ownership checks prevent cross-chat/ghost capture
  - Read-only Audit; Repair and Undo require explicit confirmation
  - User attachments, heuristic image estimates and large-paste fallback
  - Local context budgets, calibration and HANDOFF without model internals

  Scope and limitations:
  First-seen, confirmed-complete messages may be backfilled on load or scroll.
  Partially hydrated messages are deferred; ordinary scans skip known UUIDs.
  Explicit edits/regenerations can update a known UUID after completion.
  Audit may remeasure observed messages for comparison but never edits the ledger.
  The estimates use observable locally recorded chat text and accessible user
  attachments; they are not the model's actual context utilization.
  Forecasts are heuristic, and ambiguous message UUIDs are deferred.
  The script cannot inspect hidden system context, actual Project retrieval,
  internal compaction or the model's true remaining context window.
*/
(() => {
  // src/runtime/01-runtime-configuration.js
  var APP = "cgpt-context-watchdog";
  var SETTINGS_KEY = `${APP}:settings:v1`;
  var STATE_PREFIX = `${APP}:state:v2:`;
  var HISTORY_KEY = `${APP}:ended-history:v2`;
  var RECOMMENDED_LOCAL_FILE_MIB = 75;
  var MAX_LOCAL_FILE_MIB = 256;
  var DOM_SELECTORS = Object.freeze({
    markdown: '[class*="MarkdownRoot-"]',
    userText: ".whitespace-pre-wrap",
    searchUnit: "[data-chatgpt-search-unit-key]",
    searchMessageIds: "[data-chatgpt-search-message-ids]"
  });
  var UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  var UUID_ANYWHERE_RE = new RegExp(UUID_SOURCE, "gi");
  var UUID_ONLY_RE = new RegExp(`^${UUID_SOURCE}$`, "i");
  var MESSAGE_KEY_RE = new RegExp(`^msg:(${UUID_SOURCE})$`, "i");
  var CHAT_PATH_RE = new RegExp(`(?:^|/)c/(${UUID_SOURCE})(?:/|$)`, "i");
  var HANDOFF_MAX_CHARS = 4e3;
  var HANDOFF_PROMPT = `Create a concise, self-contained handoff for continuing this conversation in a new chat. Use the conversation's language.

In short bullets, capture the goal or topic, current state, key facts, decisions and their reasons, user preferences and constraints, confirmed results, and open questions. Prioritize the latest user corrections and requests. Preserve exact names, values, paths, and links when relevant, and note any files or sources the new chat will need.

Use only the context available to you. Flag gaps and uncertainty, and omit repetition and irrelevant details. End with a ready-to-paste request for the next step.`;
  function isValidHandoffPrompt(value) {
    return typeof value === "string" && value.trim().length > 0 && value.length <= HANDOFF_MAX_CHARS;
  }
  var METADATA_SETTING_SPECS = Object.freeze([
    Object.freeze({ key: "metadataOnlyOptimisticBase", default: 300, min: 50, max: 3e3, integer: true, label: "Optimistic base (tokens)", hint: "Starting optimistic token allowance before file-size and type adjustments.", field: "metadataOptBase" }),
    Object.freeze({ key: "metadataOnlyOptimisticSizeFactor", default: 1200, min: 100, max: 6e3, integer: true, label: "Optimistic size factor", hint: "Optimistic size contribution per log2(1 + file size in MiB), before file-type weighting.", field: "metadataOptSize" }),
    Object.freeze({ key: "metadataOnlyOptimisticMax", default: 1e4, min: 1e3, max: 3e4, integer: true, label: "Optimistic maximum", hint: "Upper limit for the optimistic metadata-only token estimate, after file-type weighting.", field: "metadataOptMax" }),
    Object.freeze({ key: "metadataOnlyPessimisticBase", default: 2e3, min: 200, max: 12e3, integer: true, label: "Pessimistic base (tokens)", hint: "Starting pessimistic token allowance before file-size and type adjustments.", field: "metadataPessBase" }),
    Object.freeze({ key: "metadataOnlyPessimisticSizeFactor", default: 9e3, min: 500, max: 3e4, integer: true, label: "Pessimistic size factor", hint: "Pessimistic size contribution per log2(1 + file size in MiB), before file-type weighting.", field: "metadataPessSize" }),
    Object.freeze({ key: "metadataOnlyPessimisticMax", default: 5e4, min: 5e3, max: 15e4, integer: true, label: "Pessimistic maximum", hint: "Upper limit for the pessimistic metadata-only token estimate, after file-type weighting.", field: "metadataPessMax" }),
    Object.freeze({ key: "metadataOnlyTypeFactorSpreadsheet", default: 1.15, min: 0.25, max: 2, integer: false, label: "Spreadsheets", hint: "Scales both estimates for CSV, TSV, XLS, XLSX and ODS files when content is not read.", field: "metadataSpreadsheet" }),
    Object.freeze({ key: "metadataOnlyTypeFactorTextCode", default: 1, min: 0.25, max: 2, integer: false, label: "Text / code", hint: "Scales both estimates for text and code files when content is not read.", field: "metadataTextCode" }),
    Object.freeze({ key: "metadataOnlyTypeFactorPdf", default: 1, min: 0.25, max: 2, integer: false, label: "PDF", hint: "Scales both estimates for PDF files when content is not read.", field: "metadataPdf" }),
    Object.freeze({ key: "metadataOnlyTypeFactorDocument", default: 0.85, min: 0.25, max: 2, integer: false, label: "Documents", hint: "Scales both estimates for DOC, DOCX, ODT and RTF files when content is not read.", field: "metadataDocument" }),
    Object.freeze({ key: "metadataOnlyTypeFactorPresentation", default: 0.8, min: 0.25, max: 2, integer: false, label: "Presentations", hint: "Scales both estimates for PPT, PPTX and ODP files when content is not read.", field: "metadataPresentation" }),
    Object.freeze({ key: "metadataOnlyTypeFactorArchive", default: 0.5, min: 0.25, max: 2, integer: false, label: "Archives", hint: "Scales both estimates for ZIP, 7z, RAR, GZ and TAR files when content is not read.", field: "metadataArchive" }),
    Object.freeze({ key: "metadataOnlyTypeFactorOther", default: 0.65, min: 0.25, max: 2, integer: false, label: "Other", hint: "Scales both estimates for file types outside the other six groups.", field: "metadataOther" })
  ]);
  var DEFAULTS = {
    conservativeBudget: 8e4,
    normalBudget: 12e4,
    optimisticBudget: 18e4,
    messageOverhead: 8,
    hiddenOptimistic: 4e3,
    hiddenPessimistic: 16e3,
    averageImageTokens: 2e3,
    historicalFileFallbackTokens: 1e3,
    localFileParsingLimitMiB: RECOMMENDED_LOCAL_FILE_MIB,
    historyPriorStrength: 4,
    ...Object.fromEntries(METADATA_SETTING_SPECS.map((spec) => [spec.key, spec.default])),
    budgetCalibrationBase: null,
    // pre-calibration anchor; current displayed budgets remain editable
    budgetCalibrationWeight: 0,
    // weight actually applied at last sample, not live recomputation
    // Single file contribution interval; no time-based file ageing.
    fileOptimisticPct: 25,
    filePessimisticPct: 75,
    imageOptimisticPct: 20,
    imagePessimisticPct: 80,
    pastedMinChars: 1e4,
    pastedEnglishCharsPerToken: 4,
    pastedCyrillicCharsPerToken: 2.75,
    // Source-text and code estimators: existing heuristics are retained.
    proseCyrillicCharsPerToken: 2.38,
    proseLatinCharsPerToken: 3.45,
    proseDigitsCharsPerToken: 2.6,
    prosePunctuationCharsPerToken: 1.5,
    proseOtherCharsPerToken: 1,
    proseMinTokensPerWord: 1.45,
    codeCharsPerToken: 2.3,
    handoffPrompt: HANDOFF_PROMPT,
    badgePosition: null,
    viewStyle: "soft",
    viewTheme: "chatgpt",
    logoPreference: "openai",
    watchdogPaused: false
  };
  var IMAGE_EXTS = /* @__PURE__ */ new Set([
    "png",
    "jpg",
    "jpeg",
    "webp",
    "gif",
    "bmp",
    "avif",
    "heic",
    "heif",
    "tif",
    "tiff"
  ]);
  var TEXT_EXTS = /* @__PURE__ */ new Set([
    "txt",
    "md",
    "markdown",
    "csv",
    "tsv",
    "json",
    "jsonl",
    "xml",
    "html",
    "htm",
    "js",
    "mjs",
    "cjs",
    "ts",
    "tsx",
    "jsx",
    "py",
    "rb",
    "php",
    "java",
    "kt",
    "kts",
    "c",
    "cc",
    "cpp",
    "cxx",
    "h",
    "hpp",
    "cs",
    "go",
    "rs",
    "swift",
    "scala",
    "sh",
    "bash",
    "zsh",
    "fish",
    "ps1",
    "sql",
    "yaml",
    "yml",
    "toml",
    "ini",
    "cfg",
    "conf",
    "log",
    "tex",
    "r",
    "lua",
    "dart",
    "vue",
    "svelte",
    "css",
    "scss",
    "less"
  ]);
  var DOCUMENT_EXTS = /* @__PURE__ */ new Set([
    ...TEXT_EXTS,
    "pdf",
    "doc",
    "docx",
    "odt",
    "rtf",
    "xls",
    "xlsx",
    "ods",
    "ppt",
    "pptx",
    "odp",
    "zip",
    "7z",
    "rar",
    "gz",
    "tar"
  ]);
  var FILE_SIZE_UNITS = {
    B: 1,
    KB: 1e3,
    MB: 1e3 ** 2,
    GB: 1e3 ** 3,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3
  };

  // src/runtime/01-runtime-capture-state.js
  var perf = {
    enabled: false,
    mutationBatches: 0,
    mutations: 0,
    queuedEvents: 0,
    processedEvents: 0,
    noChangeScans: 0,
    duplicateTextMutations: 0,
    timings: /* @__PURE__ */ Object.create(null)
  };
  var settings = { ...DEFAULTS };
  var currentChatKey = null;
  function initializeCaptureState(initialSettings, initialChatKey) {
    settings = initialSettings;
    currentChatKey = initialChatKey;
  }
  var transientState = null;
  var lastUiSignals = { stop: false, send: false, actions: null };
  var lastCommit = null;
  var revisionTargets = /* @__PURE__ */ new Map();
  var completedRevisions = /* @__PURE__ */ new Map();
  var revisionGeneration = 0;
  var failedScanDraft = null;
  var lastScanReason = "startup";
  var lastAudit = null;
  var priorRepairCandidates = /* @__PURE__ */ new Map();
  var lastBackfillDeferred = 0;
  function setSettings(value) {
    return settings = value;
  }
  function setTransientState(value) {
    return transientState = value;
  }
  function setCurrentChatKey(value) {
    return currentChatKey = value;
  }
  function setLastUiSignals(value) {
    return lastUiSignals = value;
  }
  function setLastCommit(value) {
    return lastCommit = value;
  }
  function setFailedScanDraft(value) {
    return failedScanDraft = value;
  }
  function setLastBackfillDeferred(value) {
    return lastBackfillDeferred = value;
  }
  function setLastScanReason(value) {
    return lastScanReason = value;
  }
  function setRevisionGeneration(value) {
    return revisionGeneration = value;
  }
  function setLastAudit(value) {
    return lastAudit = value;
  }
  function setPriorRepairCandidates(value) {
    return priorRepairCandidates = value;
  }

  // src/runtime/01-runtime-dom-state.js
  var inspectedFileTurns = /* @__PURE__ */ new WeakMap();
  var dirtyFileTurns = /* @__PURE__ */ new WeakSet();
  var inspectedImageTurns = /* @__PURE__ */ new WeakMap();
  var dirtyImageTurns = /* @__PURE__ */ new WeakSet();
  var watchedImageNodes = /* @__PURE__ */ new WeakSet();
  var requestImageRescan = null;
  var mutationCheckQueued = false;
  var booted = false;
  var historyCache = null;
  var calibrationHistoryCorrupt = false;
  var historySummaryCache = null;
  var deferredConversationFrame = 0;
  function setHistorySummaryCache(value) {
    return historySummaryCache = value;
  }
  function setHistoryCache(value) {
    return historyCache = value;
  }
  function setCalibrationHistoryCorrupt(value) {
    return calibrationHistoryCorrupt = value;
  }
  function setDeferredConversationFrame(value) {
    return deferredConversationFrame = value;
  }
  function setInspectedFileTurns(value) {
    return inspectedFileTurns = value;
  }
  function setDirtyFileTurns(value) {
    return dirtyFileTurns = value;
  }
  function setInspectedImageTurns(value) {
    return inspectedImageTurns = value;
  }
  function setDirtyImageTurns(value) {
    return dirtyImageTurns = value;
  }
  function setImageRescanRequester(value) {
    requestImageRescan = value;
  }
  function notifyImageRescan() {
    requestImageRescan?.();
  }
  function setMutationCheckQueued(value) {
    return mutationCheckQueued = value;
  }
  function setBooted(value) {
    return booted = value;
  }

  // src/runtime/01-runtime-ledger-state.js
  var corruptLedgerKeys = /* @__PURE__ */ new Set();
  var storageFailures = /* @__PURE__ */ new Map();
  var ledgerReadSnapshots = /* @__PURE__ */ new WeakMap();
  function invalidateLedgerReadSnapshots() {
    ledgerReadSnapshots = /* @__PURE__ */ new WeakMap();
  }
  var ledgerResetEpochs = /* @__PURE__ */ new Map();
  var pendingTransientPromotions = /* @__PURE__ */ new Map();
  var pendingFileResults = /* @__PURE__ */ new Map();
  function resetEpoch(chatKey) {
    return ledgerResetEpochs.get(chatKey) || 0;
  }
  function invalidateLedgerJobs(chatKey) {
    if (chatKey) {
      ledgerResetEpochs.set(chatKey, resetEpoch(chatKey) + 1);
      for (const [key, job] of pendingFileResults)
        if (job.chatKey === chatKey) pendingFileResults.delete(key);
    }
  }
  var storageWarningShown = false;
  var storageFailureNotifier = null;
  function setStorageFailureNotifier(notifier) {
    storageFailureNotifier = notifier;
  }
  function notifyStorageFailure(message) {
    storageFailureNotifier?.(message, 12e3);
  }
  function setStorageWarningShown(value) {
    return storageWarningShown = value;
  }

  // src/runtime/01-runtime-session-state.js
  var runtime = {
    phase: "unknown",
    work: { initial: true, backfill: false, completion: false },
    route: null
    // { beforeIds, beforeNodes: WeakMap, outgoingKnownIds, gate }
  };
  var hydrationCandidates = /* @__PURE__ */ new Map();
  var hydrationCheckTimer = 0;
  function setHydrationCheckTimer(value) {
    return hydrationCheckTimer = value;
  }

  // src/runtime/01-runtime-pause-state.js
  var chatAvailable = false;
  var syncRunState = null;
  function isWatchdogPaused() {
    return settings.watchdogPaused === true || !chatAvailable;
  }
  function isChatAvailable() {
    return chatAvailable;
  }
  function setChatAvailable(available) {
    const next = !!available;
    if (next === chatAvailable) return false;
    chatAvailable = next;
    return true;
  }
  function setRunStateSynchronizer(fn) {
    syncRunState = fn;
  }
  function requestRunStateSync() {
    syncRunState?.();
  }

  // src/chatgpt/09-chat-availability.js
  var CHAT_FORM = "form[data-chatgpt-composer]";
  var CHAT_TEXTBOX = '[contenteditable="true"][role="textbox"]';
  function isVisibleChatElement(el) {
    return !!el?.isConnected && !el.closest('[hidden], [inert], [aria-hidden="true"]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility === "visible";
  }
  function isAvailableChatForm(form) {
    if (!isVisibleChatElement(form)) return false;
    if (form.matches(CHAT_FORM)) return true;
    for (const editor of form.querySelectorAll("#prompt-textarea")) {
      if (isVisibleChatElement(editor)) return true;
    }
    if (!isVisibleChatElement(form.closest("main"))) return false;
    for (const textbox of form.querySelectorAll(CHAT_TEXTBOX)) {
      if (isVisibleChatElement(textbox)) return true;
    }
    return false;
  }
  function findChatComposerForTarget(node) {
    const form = node?.closest?.("form");
    return isAvailableChatForm(form) ? form : null;
  }
  function findAvailableChatComposer() {
    for (const main of document.querySelectorAll("main")) {
      if (!isVisibleChatElement(main)) continue;
      for (const form of main.querySelectorAll("form")) {
        if (isAvailableChatForm(form)) return form;
      }
    }
    for (const form of document.querySelectorAll(CHAT_FORM)) {
      if (isAvailableChatForm(form)) return form;
    }
    for (const editor of document.querySelectorAll("#prompt-textarea")) {
      const form = editor.closest("form");
      if (isVisibleChatElement(editor) && isAvailableChatForm(form)) return form;
    }
    return null;
  }
  function mutationMayChangeChatAvailability(mutation, currentComposer, checkedSubtrees = null) {
    const target = mutation.target;
    if (mutation.type === "attributes") {
      if (!(target instanceof Element)) return false;
      if (target.matches('main, form, [role="textbox"], [contenteditable]')) return true;
      if (currentComposer) return target.contains(currentComposer);
      if (checkedSubtrees?.has(target)) return checkedSubtrees.get(target);
      const containsCandidate = !!target.querySelector(
        'main, form, [role="textbox"][contenteditable], #prompt-textarea'
      );
      checkedSubtrees?.set(target, containsCandidate);
      return containsCandidate;
    }
    if (mutation.type !== "childList") return false;
    if (currentComposer && !currentComposer.isConnected) return true;
    for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
      if (!(node instanceof Element)) continue;
      if (node.matches('main, form, [role="textbox"], [contenteditable]') || node.childElementCount > 0 && node.querySelector('main, form, [role="textbox"][contenteditable]')) return true;
      if (currentComposer && node.contains(currentComposer)) return true;
    }
    return false;
  }

  // src/runtime/01-runtime-ui-state.js
  var pendingLocalFiles = [];
  var activePanelView = "context";
  var outsidePanelHandlerBound = false;
  var panelPinned = false;
  var ui = null;
  var observer = null;
  var ensureUiInitialized = null;
  function setUiInitializer(initializer) {
    ensureUiInitialized = initializer;
  }
  function ensureUiReady() {
    if (!ensureUiInitialized) throw new Error("Watchdog UI has not been initialized");
    return ensureUiInitialized();
  }
  function setActivePanelView(value) {
    return activePanelView = value;
  }
  function setUi(value) {
    return ui = value;
  }
  function setPanelPinned(value) {
    return panelPinned = value;
  }
  function setOutsidePanelHandlerBound(value) {
    return outsidePanelHandlerBound = value;
  }
  function setObserver(value) {
    return observer = value;
  }

  // src/runtime/02-profiling.js
  function resetPerformance() {
    perf.mutationBatches = perf.mutations = 0;
    perf.queuedEvents = perf.processedEvents = perf.noChangeScans = 0;
    perf.duplicateTextMutations = 0;
    perf.timings = /* @__PURE__ */ Object.create(null);
  }
  function perfStart() {
    return perf.enabled ? performance.now() : null;
  }
  function perfEnd(key, started) {
    if (started === null) return;
    const ms = performance.now() - started;
    const timing = perf.timings[key] || (perf.timings[key] = { count: 0, total: 0, max: 0 });
    timing.count++;
    timing.total += ms;
    timing.max = Math.max(timing.max, ms);
    const recent = timing.recent || (timing.recent = []);
    if (recent.length === 64) recent.shift();
    recent.push(ms);
  }
  function measuredStorageRead(key) {
    if (!perf.enabled) return localStorage.getItem(key);
    const started = performance.now();
    try {
      return localStorage.getItem(key);
    } finally {
      perfEnd("storageRead", started);
    }
  }
  var collectorState = {
    name: "none",
    visible: 0,
    raw: 0,
    collapsed: 0,
    ambiguous: 0,
    noLayout: 0
  };

  // src/storage/03-ledger-foundation.js
  function getChatKey() {
    const match = location.pathname.match(CHAT_PATH_RE);
    return match ? `chat:${match[1].toLowerCase()}` : null;
  }
  function stateKey(chatKey = currentChatKey) {
    return STATE_PREFIX + encodeURIComponent(chatKey);
  }
  function storageProblem(chatKey = currentChatKey) {
    if (chatKey && corruptLedgerKeys.has(chatKey)) return "CORRUPT LEDGER \u2014 read-only. Export/backup the raw localStorage entry before resetting.";
    if (calibrationHistoryCorrupt) return "CORRUPT CALIBRATION HISTORY \u2014 raw bytes preserved; recording blocked.";
    if (storageFailures.has(SETTINGS_KEY)) return storageFailures.get(SETTINGS_KEY);
    return chatKey ? storageFailures.get(chatKey) || "" : "";
  }
  function reportStorageFailure(chatKey, reason, err = null) {
    if (chatKey) storageFailures.set(chatKey, reason);
    if (err) console.warn("[Context Watchdog] storage problem:", err);
    if (!storageWarningShown) {
      setStorageWarningShown(true);
      notifyStorageFailure(reason);
    }
  }

  // src/core/03-ledger-schema.js
  function emptyState(chatKey) {
    return {
      chatKey,
      messages: {},
      repairHistory: [],
      // compact reversible snapshots for explicit Audit repairs
      attachmentLedgerVersion: 2,
      files: {},
      domImages: {},
      updatedAt: 0
    };
  }

  // src/core/03-ledger-validation.js
  function ledgerRecordObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function nonnegativeFiniteField(record, key, required = false) {
    if (!Object.hasOwn(record, key)) return !required;
    return typeof record[key] === "number" && Number.isFinite(record[key]) && record[key] >= 0;
  }
  function validMessageRecord(record) {
    return ledgerRecordObject(record) && nonnegativeFiniteField(record, "tokens", true) && nonnegativeFiniteField(record, "chars") && (record.role === void 0 || typeof record.role === "string") && (record.fingerprint === void 0 || typeof record.fingerprint === "string");
  }
  function validAttachmentRecord(record, image = false) {
    if (!ledgerRecordObject(record)) return false;
    for (const key of image ? ["tokens", "width", "height", "firstSeenAt", "lastSeenAt"] : ["tokens", "size", "durationSeconds", "addedAt", "historySeenAt"]) {
      if (!nonnegativeFiniteField(record, key)) return false;
    }
    return true;
  }
  function validRepairSnapshot(value) {
    return validMessageRecord(value);
  }
  function decodeLedger(chatKey, raw, parse = JSON.parse) {
    if (!raw) return emptyState(chatKey);
    const parsed = parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !parsed.messages || typeof parsed.messages !== "object" || Array.isArray(parsed.messages) || parsed.files != null && (typeof parsed.files !== "object" || Array.isArray(parsed.files)) || parsed.domImages != null && (typeof parsed.domImages !== "object" || Array.isArray(parsed.domImages))) {
      throw new Error("Unexpected state:v2 ledger structure");
    }
    if (!Object.values(parsed.messages).every(validMessageRecord) || parsed.attachmentLedgerVersion === 2 && (!Object.values(parsed.files || {}).every((file) => validAttachmentRecord(file)) || !Object.values(parsed.domImages || {}).every((image) => validAttachmentRecord(image, true))) || parsed.repairHistory !== void 0 && (!Array.isArray(parsed.repairHistory) || !parsed.repairHistory.every((item) => ledgerRecordObject(item) && typeof item.id === "string" && validRepairSnapshot(item.before) && validRepairSnapshot(item.after)))) {
      throw new Error("Corrupt state:v2 nested ledger record");
    }
    return {
      ...emptyState(chatKey),
      messages: parsed.messages,
      repairHistory: Array.isArray(parsed.repairHistory) ? parsed.repairHistory : [],
      files: parsed.attachmentLedgerVersion === 2 ? parsed.files || {} : {},
      domImages: parsed.attachmentLedgerVersion === 2 ? parsed.domImages || {} : {},
      updatedAt: parsed.updatedAt || 0
    };
  }

  // src/storage/03-ledger-repository.js
  function loadState(chatKey = currentChatKey) {
    const perfStartedAt = perfStart();
    try {
      if (!chatKey) {
        if (!transientState) setTransientState(emptyState(null));
        return transientState;
      }
      if (corruptLedgerKeys.has(chatKey)) return emptyState(chatKey);
      try {
        const raw = measuredStorageRead(stateKey(chatKey));
        const state = decodeLedger(chatKey, raw, (text) => {
          const parsingStarted = perfStart();
          try {
            return JSON.parse(text);
          } finally {
            perfEnd("ledgerParse", parsingStarted);
          }
        });
        ledgerReadSnapshots.set(state, { raw, epoch: resetEpoch(chatKey) });
        return state;
      } catch (err) {
        corruptLedgerKeys.add(chatKey);
        reportStorageFailure(chatKey, "CORRUPT LEDGER: writes blocked. Back up the original storage entry.", err);
        return emptyState(chatKey);
      }
    } finally {
      perfEnd("ledgerLoad", perfStartedAt);
    }
  }

  // src/runtime/01-numeric-settings.js
  var NUMERIC_SETTING_SPECS = Object.freeze({
    conservativeBudget: { min: 1e4, max: 1e9, integer: true },
    normalBudget: { min: 1e4, max: 1e9, integer: true },
    optimisticBudget: { min: 1e4, max: 1e9, integer: true },
    messageOverhead: { min: 0, max: 1e5, integer: true },
    hiddenOptimistic: { min: 0, max: 1e8, integer: true },
    hiddenPessimistic: { min: 0, max: 1e8, integer: true },
    historyPriorStrength: { min: 1, max: 1e6, integer: true },
    budgetCalibrationWeight: { min: 0, max: 1, integer: false },
    averageImageTokens: { min: 100, max: 1e6, integer: true },
    historicalFileFallbackTokens: { min: 0, max: 1e7, integer: true },
    localFileParsingLimitMiB: { min: 0, max: MAX_LOCAL_FILE_MIB, integer: true },
    fileOptimisticPct: { min: 0, max: 100, integer: true },
    filePessimisticPct: { min: 0, max: 100, integer: true },
    imageOptimisticPct: { min: 0, max: 100, integer: true },
    imagePessimisticPct: { min: 0, max: 100, integer: true },
    pastedMinChars: { min: 0, max: 1e7, integer: true },
    pastedEnglishCharsPerToken: { min: 0.25, max: 20, integer: false },
    pastedCyrillicCharsPerToken: { min: 0.25, max: 20, integer: false },
    proseCyrillicCharsPerToken: { min: 0.25, max: 20, integer: false },
    proseLatinCharsPerToken: { min: 0.25, max: 20, integer: false },
    proseDigitsCharsPerToken: { min: 0.25, max: 20, integer: false },
    prosePunctuationCharsPerToken: { min: 0.25, max: 20, integer: false },
    proseOtherCharsPerToken: { min: 0.25, max: 20, integer: false },
    proseMinTokensPerWord: { min: 0, max: 10, integer: false },
    codeCharsPerToken: { min: 0.25, max: 20, integer: false },
    ...Object.fromEntries(METADATA_SETTING_SPECS.map((spec) => [
      spec.key,
      { min: spec.min, max: spec.max, integer: spec.integer }
    ]))
  });
  function numericStep(key) {
    const spec = NUMERIC_SETTING_SPECS[key];
    const fallback = DEFAULTS[key];
    if (!spec || !Number.isFinite(fallback)) throw new Error("Unknown numeric setting: " + key);
    const magnitude = fallback === 0 ? 0 : 10 ** (Math.floor(Math.log10(Math.abs(fallback))) - 2);
    return Number(Math.max(spec.integer ? 1 : 0.01, magnitude).toPrecision(12));
  }
  function normalizeNumericSetting(key, value) {
    const spec = NUMERIC_SETTING_SPECS[key];
    if (!spec || !Number.isFinite(value) || value < spec.min || value > spec.max) return null;
    const step = numericStep(key);
    const base = DEFAULTS[key];
    const lo = Math.ceil((spec.min - base) / step - 1e-9);
    const hi = Math.floor((spec.max - base) / step + 1e-9);
    const ticks = Math.min(hi, Math.max(lo, Math.round((value - base) / step + 1e-10)));
    const digits = (String(step).split(".")[1] || "").length;
    return Number((base + ticks * step).toFixed(digits));
  }

  // src/storage/03-settings-store.js
  function loadSettings() {
    try {
      const raw = JSON.parse(measuredStorageRead(SETTINGS_KEY) || "{}");
      const parsed = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      const number = (key, fallback = DEFAULTS[key]) => {
        const spec = NUMERIC_SETTING_SPECS[key];
        if (!spec) throw new Error("Missing numeric specification: " + key);
        const source = parsed[key];
        if (source === void 0 || source === null || source === "") return fallback;
        const n = Number(source);
        if (!Number.isFinite(n) || n < spec.min || n > spec.max) return fallback;
        return spec.integer ? Math.round(n) : n;
      };
      const normal = number("normalBudget");
      const result = {
        ...DEFAULTS,
        conservativeBudget: number(
          "conservativeBudget",
          Math.max(1e4, Math.round(normal * 2 / 3))
        ),
        normalBudget: normal,
        optimisticBudget: number(
          "optimisticBudget",
          Math.min(1e9, Math.round(normal * 1.5))
        ),
        messageOverhead: number("messageOverhead"),
        hiddenOptimistic: number("hiddenOptimistic"),
        hiddenPessimistic: number("hiddenPessimistic"),
        historyPriorStrength: number("historyPriorStrength"),
        budgetCalibrationWeight: number("budgetCalibrationWeight"),
        averageImageTokens: number("averageImageTokens"),
        historicalFileFallbackTokens: number("historicalFileFallbackTokens"),
        localFileParsingLimitMiB: number("localFileParsingLimitMiB"),
        pastedMinChars: number("pastedMinChars"),
        pastedEnglishCharsPerToken: number("pastedEnglishCharsPerToken"),
        pastedCyrillicCharsPerToken: number("pastedCyrillicCharsPerToken"),
        proseCyrillicCharsPerToken: number("proseCyrillicCharsPerToken"),
        proseLatinCharsPerToken: number("proseLatinCharsPerToken"),
        proseDigitsCharsPerToken: number("proseDigitsCharsPerToken"),
        prosePunctuationCharsPerToken: number("prosePunctuationCharsPerToken"),
        proseOtherCharsPerToken: number("proseOtherCharsPerToken"),
        proseMinTokensPerWord: number("proseMinTokensPerWord"),
        codeCharsPerToken: number("codeCharsPerToken"),
        badgePosition: parsed.badgePosition && Number.isFinite(parsed.badgePosition.left) && Number.isFinite(parsed.badgePosition.top) ? { left: parsed.badgePosition.left, top: parsed.badgePosition.top } : null,
        handoffPrompt: isValidHandoffPrompt(parsed.handoffPrompt) ? parsed.handoffPrompt : DEFAULTS.handoffPrompt,
        viewStyle: ["soft", "sharp"].includes(parsed.viewStyle) ? parsed.viewStyle : DEFAULTS.viewStyle,
        viewTheme: ["light", "dark", "system", "chatgpt"].includes(parsed.viewTheme) ? parsed.viewTheme : DEFAULTS.viewTheme,
        logoPreference: ["openai", "watchdog"].includes(parsed.logoPreference) ? parsed.logoPreference : DEFAULTS.logoPreference,
        watchdogPaused: typeof parsed.watchdogPaused === "boolean" ? parsed.watchdogPaused : false
      };
      for (const spec of METADATA_SETTING_SPECS) {
        result[spec.key] = number(spec.key);
      }
      if (result.metadataOnlyOptimisticBase > result.metadataOnlyPessimisticBase || result.metadataOnlyOptimisticSizeFactor > result.metadataOnlyPessimisticSizeFactor || result.metadataOnlyOptimisticMax > result.metadataOnlyPessimisticMax) {
        for (const spec of METADATA_SETTING_SPECS) result[spec.key] = DEFAULTS[spec.key];
      }
      const anchor = parsed.budgetCalibrationBase;
      if (anchor && typeof anchor === "object" && !Array.isArray(anchor)) {
        const c = Number(anchor.conservativeBudget);
        const n = Number(anchor.normalBudget);
        const o = Number(anchor.optimisticBudget);
        if ([c, n, o].every((x) => Number.isInteger(x) && x >= 1e4 && x <= 1e9) && c <= n && n <= o) {
          result.budgetCalibrationBase = {
            conservativeBudget: c,
            normalBudget: n,
            optimisticBudget: o
          };
        }
      }
      for (const key of [
        "fileOptimisticPct",
        "filePessimisticPct",
        "imageOptimisticPct",
        "imagePessimisticPct"
      ]) result[key] = number(key);
      if (!(result.conservativeBudget <= result.normalBudget && result.normalBudget <= result.optimisticBudget)) {
        result.conservativeBudget = DEFAULTS.conservativeBudget;
        result.normalBudget = DEFAULTS.normalBudget;
        result.optimisticBudget = DEFAULTS.optimisticBudget;
        result.budgetCalibrationBase = null;
        result.budgetCalibrationWeight = 0;
      }
      if (result.hiddenPessimistic < result.hiddenOptimistic) {
        result.hiddenOptimistic = DEFAULTS.hiddenOptimistic;
        result.hiddenPessimistic = DEFAULTS.hiddenPessimistic;
      }
      if (result.fileOptimisticPct > result.filePessimisticPct) {
        result.fileOptimisticPct = DEFAULTS.fileOptimisticPct;
        result.filePessimisticPct = DEFAULTS.filePessimisticPct;
      }
      if (result.imageOptimisticPct > result.imagePessimisticPct) {
        result.imageOptimisticPct = DEFAULTS.imageOptimisticPct;
        result.imagePessimisticPct = DEFAULTS.imagePessimisticPct;
      }
      return result;
    } catch {
      return { ...DEFAULTS };
    }
  }

  // src/core/03-ledger-merge.js
  function reconcileLedger(baseRaw, liveRaw, draft, parse = JSON.parse) {
    if (baseRaw && !liveRaw) throw new Error("Ledger was reset in another tab");
    const base = decodeLedger(draft.chatKey, baseRaw, parse);
    const live = decodeLedger(draft.chatKey, liveRaw, parse);
    if (Object.keys(base.messages).some((id) => !Object.hasOwn(live.messages, id))) {
      throw new Error("Previously saved message IDs disappeared (possible chat reset)");
    }
    const merged = { ...live };
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    for (const field of ["messages", "files", "domImages"]) {
      const before = base[field] || {};
      const after = draft[field] || {};
      const latest = live[field] || {};
      const result = { ...latest };
      for (const id of /* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (equal(after[id], before[id])) continue;
        if (!equal(latest[id], before[id]) && !equal(latest[id], after[id])) {
          throw new Error(`Concurrent ${field} change: ${id}`);
        }
        if (Object.hasOwn(after, id)) result[id] = after[id];
        else delete result[id];
      }
      merged[field] = result;
    }
    if (!equal(draft.repairHistory, base.repairHistory)) {
      if (!equal(live.repairHistory, base.repairHistory) && !equal(live.repairHistory, draft.repairHistory)) {
        throw new Error("Concurrent Audit repair history change");
      }
      merged.repairHistory = draft.repairHistory;
    }
    return merged;
  }

  // src/storage/03-storage-io.js
  function writeJson(key, value, chatKey, failure, onFailure = null, onSuccess = null) {
    const perfStartedAt = perfStart();
    try {
      try {
        let raw;
        const encodingStarted = perfStart();
        try {
          raw = JSON.stringify(value);
        } finally {
          perfEnd("storageEncode", encodingStarted);
        }
        const commitStarted = perfStart();
        try {
          localStorage.setItem(key, raw);
        } finally {
          perfEnd("storageCommit", commitStarted);
        }
        onSuccess?.(raw);
        return true;
      } catch (err) {
        onFailure?.();
        reportStorageFailure(chatKey, failure, err);
        return false;
      }
    } finally {
      perfEnd("storageWrite", perfStartedAt);
    }
  }
  function saveSettings() {
    return writeJson(
      SETTINGS_KEY,
      settings,
      SETTINGS_KEY,
      "STORAGE WRITE FAILED: settings were not saved.",
      null,
      () => storageFailures.delete(SETTINGS_KEY)
    );
  }

  // src/storage/03-ledger-commit.js
  function saveState(state) {
    if (!state.chatKey) {
      state.attachmentLedgerVersion = 2;
      state.updatedAt = Date.now();
      setTransientState(state);
      return true;
    }
    if (corruptLedgerKeys.has(state.chatKey)) {
      reportStorageFailure(state.chatKey, "CORRUPT LEDGER: writes blocked. Back up the original storage entry.");
      return false;
    }
    if (!ledgerReadSnapshots.has(state)) {
      reportStorageFailure(state.chatKey, "STORAGE CONFLICT: missing ledger baseline; reload before retrying.");
      return false;
    }
    const baseline = ledgerReadSnapshots.get(state);
    if (baseline.epoch !== resetEpoch(state.chatKey)) {
      reportStorageFailure(state.chatKey, "STORAGE CONFLICT: missing ledger baseline after chat reset; rescan before retrying.");
      return false;
    }
    const baseRaw = baseline.raw;
    let candidate = state;
    try {
      const liveRaw = measuredStorageRead(stateKey(state.chatKey));
      if (liveRaw !== baseRaw) candidate = reconcileLedger(baseRaw, liveRaw, state, (text) => {
        const parsingStarted = perfStart();
        try {
          return JSON.parse(text);
        } finally {
          perfEnd("ledgerParse", parsingStarted);
        }
      });
    } catch (err) {
      reportStorageFailure(
        state.chatKey,
        `STORAGE CONFLICT: ${String(err?.message || err)}. Reload or rescan before retrying.`,
        err
      );
      return false;
    }
    candidate.attachmentLedgerVersion = 2;
    candidate.updatedAt = Date.now();
    if (!writeJson(
      stateKey(state.chatKey),
      candidate,
      state.chatKey,
      "STORAGE WRITE FAILED: new counts were not saved.",
      null,
      (raw) => {
        ledgerReadSnapshots.set(state, { raw, epoch: resetEpoch(state.chatKey) });
      }
    )) return false;
    if (candidate !== state) Object.assign(state, candidate);
    else state.updatedAt = candidate.updatedAt;
    if (![...pendingFileResults.values()].some((job) => job.chatKey === state.chatKey)) {
      storageFailures.delete(state.chatKey);
      setStorageWarningShown(false);
    }
    return true;
  }

  // src/chatgpt/09-dom-unit-identity.js
  function searchUnitInfo(el) {
    const unit = el?.closest?.(DOM_SELECTORS.searchUnit) || (el?.matches?.(DOM_SELECTORS.searchUnit) ? el : null);
    if (!unit || !unit.closest?.("main")) return null;
    const key = unit.getAttribute("data-chatgpt-search-unit-key") || "";
    const role = /(?:^|:)(user|assistant)$/i.exec(key)?.[1]?.toLowerCase();
    if (!role) return null;
    return { unit, key, role };
  }
  function searchUnitRealMessageId(unit) {
    if (!unit) return null;
    const values = [unit.getAttribute("data-chatgpt-search-message-ids")];
    for (const node of unit.querySelectorAll(DOM_SELECTORS.searchMessageIds)) {
      if (node.closest(DOM_SELECTORS.searchUnit) === unit) {
        values.push(node.getAttribute("data-chatgpt-search-message-ids"));
      }
    }
    const uuids = /* @__PURE__ */ new Set();
    for (const value of values) {
      for (const match of String(value).matchAll(UUID_ANYWHERE_RE)) {
        uuids.add(match[0].toLowerCase());
      }
    }
    return uuids.size === 1 ? `msg:${[...uuids][0]}` : null;
  }
  function inferRole(el) {
    const unit = searchUnitInfo(el);
    if (unit) return unit.role;
    const role = el.getAttribute?.("data-message-author-role") || el.getAttribute?.("data-message-role") || el.closest?.("[data-message-author-role]")?.getAttribute("data-message-author-role") || el.closest?.("[data-message-role]")?.getAttribute("data-message-role");
    return role === "user" || role === "assistant" ? role : null;
  }

  // src/chatgpt/04-text-estimators.js
  function normalizeText(text) {
    return (text || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }
  function hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
  var PROSE_ASCII_PUNCTUATION = new Uint8Array(128);
  for (const char of ".,!?;:'\"()[]{}<>@#$%^&*_=+~`|\\/-") {
    PROSE_ASCII_PUNCTUATION[char.charCodeAt(0)] = 1;
  }
  function estimateProseTokens(text) {
    if (!text) return 0;
    let cyr = 0, latin = 0, digits = 0, punctuation = 0, other = 0;
    let words = 0, insideWord = false;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const space = code >= 9 && code <= 13 || code === 32 || code === 160 || code === 5760 || code >= 8192 && code <= 8202 || code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288 || code === 65279;
      if (space) {
        insideWord = false;
        continue;
      }
      if (!insideWord) {
        words++;
        insideWord = true;
      }
      if (code >= 1024 && code <= 1327) cyr++;
      else if (code >= 65 && code <= 90 || code >= 97 && code <= 122) latin++;
      else if (code >= 48 && code <= 57) digits++;
      else if (code === 8211 || code === 8212 || code < 128 && PROSE_ASCII_PUNCTUATION[code]) punctuation++;
      else other++;
    }
    const charEstimate = cyr / settings.proseCyrillicCharsPerToken + latin / settings.proseLatinCharsPerToken + digits / settings.proseDigitsCharsPerToken + punctuation / settings.prosePunctuationCharsPerToken + other / settings.proseOtherCharsPerToken;
    return Math.ceil(Math.max(charEstimate, words * settings.proseMinTokensPerWord));
  }
  function estimateCodeTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / settings.codeCharsPerToken);
  }
  function canonicalTextRoots(messageEl, role) {
    const info = searchUnitInfo(messageEl);
    const scope = info?.unit || messageEl;
    const roots = (selector) => {
      const found = [
        ...scope.matches?.(selector) ? [scope] : [],
        ...scope.querySelectorAll(selector)
      ].filter((el) => !el.hidden && !el.closest?.('[hidden], [inert], [aria-hidden="true"]'));
      return found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
    };
    if (role === "user") {
      const text = roots(DOM_SELECTORS.userText).filter((el) => !el.closest?.('pre, code, form, [contenteditable="true"]'));
      if (text.length) return { roots: text, source: "unit-user-text", scope };
      return { roots: [scope], source: "unit-user", scope };
    }
    if (role === "assistant") {
      const text = roots(DOM_SELECTORS.markdown);
      if (text.length) return { roots: text, source: "unit-markdown", scope };
      return { roots: [scope], source: "unit-assistant", scope };
    }
    return { roots: [], source: "fallback", scope };
  }
  function getMessageParts(messageEl, role = inferRole(messageEl)) {
    const selection = canonicalTextRoots(messageEl, role);
    const prose = [];
    const code = [];
    for (const root of selection.roots) {
      const clone = root.cloneNode(true);
      const preservePromptButtons = selection.source === "unit-user";
      clone.querySelectorAll(
        (preservePromptButtons ? "" : 'button, [role="button"], ') + 'svg, [hidden], [inert], [aria-hidden="true"], [data-testid*="copy"], [data-testid*="feedback"], [contenteditable="true"], [style*="display:none"], [style*="display: none"], [style*="visibility:hidden"], [style*="visibility: hidden"]'
      ).forEach((el) => el.remove());
      if (preservePromptButtons) {
        clone.querySelectorAll('button, [role="button"]').forEach((button) => {
          const label = (button.getAttribute("aria-label") || button.getAttribute("title") || "").toLowerCase();
          if (/^(copy|edit|delete|share|retry|regenerate|копировать|изменить|редактировать|удалить|поделиться|ещё действия)/i.test(label)) button.remove();
        });
      }
      if (clone.hidden || clone.getAttribute?.("aria-hidden") === "true") continue;
      for (const selector of ["pre", "code"]) {
        for (const block of clone.querySelectorAll(selector)) {
          const text2 = normalizeText(block.textContent);
          if (text2) code.push(text2);
          block.remove();
        }
      }
      const text = normalizeText(clone.textContent);
      if (text) prose.push(text);
    }
    return {
      prose: normalizeText(prose.join("\n")),
      code: normalizeText(code.join("\n")),
      source: selection.source,
      roots: selection.roots.length
    };
  }
  function getCanonicalMessageMetrics(messageEl, role) {
    const parts = getMessageParts(messageEl, role);
    return {
      parts,
      chars: parts.prose.length + parts.code.length,
      tokens: estimateMessagePartsTokens(parts),
      fingerprint: `v3:${hash32(JSON.stringify([role, parts.prose, parts.code]))}`
    };
  }
  function estimateMessagePartsTokens(parts) {
    return estimateProseTokens(parts.prose) + estimateCodeTokens(parts.code) + settings.messageOverhead;
  }

  // src/attachments/05-attachment-helpers.js
  function getFileKey(file) {
    return `${file.name}|${file.size}|${file.lastModified || 0}`;
  }
  function getFileExt(name) {
    const m = /\.([^.]+)$/.exec(name || "");
    return m ? m[1].toLowerCase() : "";
  }
  function isImageFile(file) {
    const ext = getFileExt(file?.name || "");
    return (file?.type || "").startsWith("image/") || IMAGE_EXTS.has(ext);
  }
  function isTextLikeExt(ext) {
    return TEXT_EXTS.has(ext);
  }
  function normalizeFileName(name) {
    return String(name || "").replace(/^\s*(?:download|file|attachment|файл|вложение)\s*[:\-–—]?\s*/i, "").trim().toLowerCase();
  }
  function isAutoPasteName(name) {
    return /^(?:вставленный\s+текст|pasted[\s_-]+(?:text|content))(?:\s*\((?:\d{8}-\d{6}|\d+)\))?(?:\.(?:txt|md))?$/iu.test(
      normalizeFileName(name)
    );
  }
  function extractAutoPasteCardName(value) {
    const label = String(value || "").replace(/\u00a0/g, " ").replace(/[·•]/g, " ").replace(/\s+/g, " ").trim();
    const name = label.replace(/\s+(?:документ|document)$/iu, "").trim();
    return isAutoPasteName(name) ? name : "";
  }
  function extractDocumentFileName(value) {
    const text = String(value || "");
    const matches = text.matchAll(
      /([^\n\r<>:"/\\|?*]{1,180}\.([A-Za-z0-9]{1,10}))/g
    );
    for (const match of matches) {
      const name = String(match[1] || "").replace(/^\s*(?:download|file|attachment|файл|вложение)\s*[:\-–—]?\s*/i, "").trim();
      const ext = getFileExt(name);
      if (DOCUMENT_EXTS.has(ext) && !IMAGE_EXTS.has(ext)) {
        return name;
      }
    }
    return "";
  }
  function parseDisplayedFileSize(value) {
    const text = String(value || "");
    const match = text.match(
      /(\d+(?:[.,]\d+)?)\s*(GiB|MiB|KiB|GB|MB|KB|B|ГБ|МБ|КБ|Б)(?=\s|$|[),;])/i
    );
    if (!match) return 0;
    const amount = Number(match[1].replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const unit = match[2].toUpperCase().replace(/К/g, "K").replace(/М/g, "M").replace(/Г/g, "G").replace(/Б/g, "B");
    const multiplier = FILE_SIZE_UNITS[unit] || 0;
    return multiplier ? Math.round(amount * multiplier) : 0;
  }
  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return "size unknown";
    if (n < 1e3) return `${Math.round(n)} B`;
    if (n < 1e3 ** 2) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)} KB`;
    if (n < 1e3 ** 3) return `${(n / 1e3 ** 2).toFixed(n >= 1e7 ? 0 : 1)} MB`;
    return `${(n / 1e3 ** 3).toFixed(1)} GB`;
  }
  function metadataTypeFactor(name, config = DEFAULTS) {
    const ext = getFileExt(name);
    if (["csv", "tsv", "xls", "xlsx", "ods"].includes(ext)) return config.metadataOnlyTypeFactorSpreadsheet;
    if (isTextLikeExt(ext)) return config.metadataOnlyTypeFactorTextCode;
    if (ext === "pdf") return config.metadataOnlyTypeFactorPdf;
    if (["doc", "docx", "odt", "rtf"].includes(ext)) return config.metadataOnlyTypeFactorDocument;
    if (["ppt", "pptx", "odp"].includes(ext)) return config.metadataOnlyTypeFactorPresentation;
    if (["zip", "7z", "rar", "gz", "tar"].includes(ext)) return config.metadataOnlyTypeFactorArchive;
    return config.metadataOnlyTypeFactorOther;
  }
  function metadataFileContextEstimate(file, config = DEFAULTS) {
    const bytes = Number(file?.size) || 0;
    if (bytes <= 0) return { optimistic: 0, pessimistic: 0 };
    const mib = Math.max(bytes / 1024 ** 2, 1e-3);
    const scale = Math.log2(1 + mib);
    const factor = metadataTypeFactor(file.name || "", config);
    const optimistic = Math.min(
      config.metadataOnlyOptimisticMax,
      (config.metadataOnlyOptimisticBase + scale * config.metadataOnlyOptimisticSizeFactor) * factor
    );
    const pessimistic = Math.min(
      config.metadataOnlyPessimisticMax,
      (config.metadataOnlyPessimisticBase + scale * config.metadataOnlyPessimisticSizeFactor) * factor
    );
    return {
      optimistic: Math.max(0, Math.ceil(optimistic)),
      pessimistic: Math.max(0, Math.ceil(pessimistic))
    };
  }
  function fileSizesCompatible(existingSize, observedSize) {
    const previous = Number(existingSize) || 0;
    const current = Number(observedSize) || 0;
    return !previous || !current || Math.abs(previous - current) <= Math.max(4096, current * 0.02);
  }

  // src/chatgpt/09-dom-message-identity.js
  function getStructuralMessageId(el, role = inferRole(el)) {
    if (role !== "user" && role !== "assistant") return null;
    const info = searchUnitInfo(el);
    if (info) return searchUnitRealMessageId(info.unit);
    const value = el.getAttribute?.("data-message-id");
    const uuid = typeof value === "string" && value.match(UUID_ONLY_RE);
    return uuid ? `msg:${uuid[0].toLowerCase()}` : null;
  }
  function* identifiedMessages(nodes) {
    for (const [index, el] of (nodes || []).entries()) {
      const role = inferRole(el);
      yield { el, index, role, id: getStructuralMessageId(el, role) };
    }
  }
  function structuralMessageIds(nodes) {
    const ids = /* @__PURE__ */ new Set();
    for (const { id } of identifiedMessages(nodes)) if (id) ids.add(id);
    return ids;
  }
  function trustedCollectedMessageId(id, collected) {
    return !!id && !collected.ambiguousIds.has(id);
  }
  function normalizeCollectedMessageEntries(collected) {
    const nodes = collected.nodes;
    return collected.identities ? nodes.map((el, index) => ({ el, index, ...collected.identities.get(el) })) : [...identifiedMessages(nodes)];
  }

  // src/chatgpt/09-dom-collection.js
  function domDocumentOrder(a, b) {
    if (a === b) return 0;
    const relation = a.compareDocumentPosition(b);
    return relation & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : relation & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
  }
  function hasMountedMessageLayout(el) {
    if (!el?.isConnected || el.closest?.('[hidden], [inert], [aria-hidden="true"]')) return false;
    const rect = el.getBoundingClientRect?.();
    return !!rect && rect.width > 0 && rect.height > 0;
  }
  function collectMessageNodes() {
    const perfStartedAt = perfStart();
    try {
      const units = [...document.querySelectorAll(`main ${DOM_SELECTORS.searchUnit}`)].filter((el) => /(?:^|:)(?:user|assistant)$/i.test(
        el.getAttribute("data-chatgpt-search-unit-key") || ""
      ));
      const raw = units.filter(hasMountedMessageLayout);
      let noLayout = units.length - raw.length;
      if (!raw.length) {
        const alternatives = [...document.querySelectorAll(
          "main [data-message-id][data-message-author-role], main [data-message-id][data-message-role]"
        )];
        raw.push(...alternatives.filter(hasMountedMessageLayout));
        noLayout += alternatives.length - raw.length;
      }
      const seenNodes = /* @__PURE__ */ new Set(), seenIds = /* @__PURE__ */ new Map(), ambiguousIds = /* @__PURE__ */ new Set();
      const identities = /* @__PURE__ */ new WeakMap();
      const nodes = [];
      for (const el of raw) {
        if (seenNodes.has(el)) continue;
        seenNodes.add(el);
        const info = el.hasAttribute("data-chatgpt-search-unit-key") ? searchUnitInfo(el) : null;
        const role = info?.role || inferRole(el);
        if (!role) continue;
        const id = info ? searchUnitRealMessageId(el) : getStructuralMessageId(el, role);
        if (!id) {
          identities.set(el, { role, id: null });
          nodes.push(el);
          continue;
        }
        const prior = seenIds.get(id);
        if (prior) {
          if (!prior.contains(el) && !el.contains(prior)) ambiguousIds.add(id);
          continue;
        }
        seenIds.set(id, el);
        identities.set(el, { role, id });
        nodes.push(el);
      }
      nodes.sort(domDocumentOrder);
      return {
        name: raw.length ? raw[0].hasAttribute("data-chatgpt-search-unit-key") ? "search-units" : "message-id" : "no-message-ids",
        nodes,
        identities,
        rawCount: raw.length,
        noLayout,
        collapsed: raw.length - nodes.length,
        ambiguousIds
      };
    } finally {
      perfEnd("collect", perfStartedAt);
    }
  }

  // src/chatgpt/09-dom-composer-state.js
  function visibleControl(el) {
    return !!el && !el.hidden && el.getAttribute("aria-hidden") !== "true" && el.getClientRects().length > 0;
  }
  var COMPOSER_CONTROLS = Object.freeze({
    stop: [
      'button[data-testid="stop-button"]',
      'button[aria-label="Stop streaming"]',
      'button[aria-label="Stop generating"]',
      'button[aria-label="Stop"]',
      'button[aria-label="\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044E"]',
      'button[aria-label="\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C"]'
    ].join(", "),
    send: [
      'button[data-testid="send-button"]',
      'button[data-testid="composer-submit-button"]',
      "button#composer-submit-button",
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send"]',
      'button[aria-label="\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435"]',
      'button[aria-label="\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C"]'
    ].join(", ")
  });
  function anyVisibleControl(selector) {
    for (const node of document.querySelectorAll(selector)) {
      if (visibleControl(node)) return true;
    }
    return false;
  }
  function readComposerControlsForDiagnostics() {
    return {
      stop: anyVisibleControl(COMPOSER_CONTROLS.stop),
      send: anyVisibleControl(COMPOSER_CONTROLS.send)
    };
  }
  function getComposerMode(getCollected = collectMessageNodes) {
    const stop = anyVisibleControl(COMPOSER_CONTROLS.stop);
    if (stop) {
      setLastUiSignals({ stop: true, send: false, actions: null });
      return "generating";
    }
    const send = anyVisibleControl(COMPOSER_CONTROLS.send);
    if (send) {
      setLastUiSignals({ stop: false, send: true, actions: null });
      return "ready";
    }
    const composerPresent = !!document.querySelector(
      "form[data-chatgpt-composer], #prompt-textarea"
    );
    const actions = composerPresent ? hasLastAssistantActions(getCollected()) : false;
    setLastUiSignals({ stop: false, send: false, actions });
    return composerPresent && actions ? "ready" : "unknown";
  }
  var FINISHED_ACTION_SELECTOR = [
    'button[data-testid="copy-turn-action-button"]',
    'button[aria-label="\u041A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C"]',
    'button[aria-label="Copy"]',
    'button[aria-label="\u041A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043E\u0442\u0432\u0435\u0442"]',
    'button[aria-label="Copy response"]',
    'button[aria-label="\u0421\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043E\u0442\u0432\u0435\u0442 \u0437\u0430\u043D\u043E\u0432\u043E"]',
    'button[aria-label="Regenerate"]',
    'button[aria-label="Regenerate response"]',
    'button[aria-label="\u041F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u0432\u0441\u043B\u0443\u0445"]',
    'button[aria-label="Read aloud"]'
  ].join(", ");
  function isFinishedActionNode(node) {
    if (!(node instanceof Element)) return false;
    return node.matches(FINISHED_ACTION_SELECTOR) || !!node.querySelector(FINISHED_ACTION_SELECTOR);
  }
  function hasLastAssistantActions(collected = null) {
    const nodes = (collected || collectMessageNodes()).nodes;
    if (!nodes.length) return false;
    const last = nodes[nodes.length - 1];
    if (inferRole(last) !== "assistant") return false;
    const outer = last.closest?.(
      '[data-testid^="conversation-turn-"], [data-virtualized-turn-content], [data-message-author-role="assistant"]'
    );
    if (outer && outer.querySelector(FINISHED_ACTION_SELECTOR)) return true;
    for (const button of document.querySelectorAll(
      `main ${FINISHED_ACTION_SELECTOR.replaceAll(", ", ", main ")}`
    )) {
      if (last.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) {
        return true;
      }
    }
    return false;
  }
  function rememberCollected(collected) {
    collectorState.name = collected.name;
    collectorState.visible = collected.nodes.length;
    collectorState.raw = collected.rawCount;
    collectorState.collapsed = collected.collapsed;
    collectorState.ambiguous = collected.ambiguousIds.size;
    collectorState.noLayout = collected.noLayout || 0;
  }

  // src/storage/03-calibration-store.js
  function loadHistory() {
    if (historyCache) return historyCache;
    setHistorySummaryCache(null);
    try {
      const parsed = JSON.parse(measuredStorageRead(HISTORY_KEY) || "[]");
      if (!Array.isArray(parsed) || !parsed.every(validCalibrationSample)) {
        throw new Error("Invalid calibration history samples");
      }
      setHistoryCache(parsed);
      setCalibrationHistoryCorrupt(false);
    } catch (err) {
      setHistoryCache([]);
      setCalibrationHistoryCorrupt(true);
      reportStorageFailure(
        null,
        "CORRUPT CALIBRATION HISTORY: raw bytes preserved; recording blocked.",
        err
      );
    }
    return historyCache;
  }
  function validCalibrationSample(sample) {
    if (!sample || typeof sample !== "object" || Array.isArray(sample) || typeof sample.chatKey !== "string" || !sample.chatKey) return false;
    for (const key of [
      "seen",
      "optimistic",
      "pessimistic",
      "knownAttachmentTokens",
      "knownImages",
      "turns",
      "savedAt"
    ]) {
      if (sample[key] !== void 0 && (typeof sample[key] !== "number" || !Number.isFinite(sample[key]) || sample[key] < 0)) return false;
    }
    return typeof sample.seen === "number" && typeof sample.pessimistic === "number";
  }
  function saveHistory(history2) {
    if (historyCache === null) loadHistory();
    if (calibrationHistoryCorrupt || !Array.isArray(history2) || !history2.every(validCalibrationSample)) {
      reportStorageFailure(
        null,
        "CALIBRATION HISTORY NOT SAVED: invalid stored or pending samples."
      );
      return false;
    }
    if (!writeJson(
      HISTORY_KEY,
      history2,
      currentChatKey,
      "STORAGE WRITE FAILED: limit calibration was not saved.",
      () => {
        setHistoryCache(null);
        setHistorySummaryCache(null);
      }
    )) return false;
    setHistoryCache(history2);
    setHistorySummaryCache(null);
    return true;
  }
  function historyStatsFor(history2, requireValid = false) {
    let n = 0;
    let seen = 0, optimistic = 0, pessimistic = 0;
    for (const sample of history2) {
      if (!validCalibrationSample(sample)) continue;
      if (requireValid && (!Number.isFinite(Number(sample.seen)) || !Number.isFinite(Number(sample.pessimistic)))) continue;
      n++;
      seen += Number(sample.seen) || 0;
      optimistic += Number(sample.optimistic) || 0;
      pessimistic += Number(sample.pessimistic) || 0;
    }
    if (!n) return { n: 0, avgSeen: 0, avgOptimistic: 0, avgPessimistic: 0 };
    return {
      n,
      avgSeen: Math.round(seen / n),
      avgOptimistic: Math.round(optimistic / n),
      avgPessimistic: Math.round(pessimistic / n)
    };
  }
  function historyStats() {
    if (historySummaryCache) return historySummaryCache;
    setHistorySummaryCache(historyStatsFor(loadHistory(), true));
    return historySummaryCache;
  }
  function currentBudgetValues() {
    return {
      conservativeBudget: settings.conservativeBudget,
      normalBudget: settings.normalBudget,
      optimisticBudget: settings.optimisticBudget
    };
  }
  function effectiveBudgets() {
    return {
      conservative: settings.conservativeBudget,
      normal: settings.normalBudget,
      optimistic: settings.optimisticBudget,
      // Samples are only needed by History and by explicit calibration.
      // Ordinary forecast/badge renders must not read calibration history.
      historyWeight: settings.budgetCalibrationWeight || 0
    };
  }
  function calibratedBudgets(base, hs) {
    if (!hs.n || hs.avgPessimistic <= 0) {
      return { ...base, weight: 0 };
    }
    const prior = Math.max(1, Number(settings.historyPriorStrength) || 4);
    const w = hs.n / (hs.n + prior);
    const normalBase = Math.max(1e4, base.normalBudget);
    const targetNormal = hs.avgPessimistic;
    const blend = (manual, target) => Math.round(manual * (1 - w) + target * w);
    const conservative = Math.max(1e4, Math.min(
      1e9,
      blend(base.conservativeBudget, targetNormal * base.conservativeBudget / normalBase)
    ));
    const normal = Math.max(conservative, Math.min(
      1e9,
      blend(base.normalBudget, targetNormal)
    ));
    const optimistic = Math.max(normal, Math.min(
      1e9,
      blend(base.optimisticBudget, targetNormal * base.optimisticBudget / normalBase)
    ));
    return {
      conservativeBudget: conservative,
      normalBudget: normal,
      optimisticBudget: optimistic,
      weight: w
    };
  }

  // src/ui/12-panel-clamp.js
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  // src/ui/15-panel-dialog-geometry.js
  var panelDialogBaseline = null;
  var panelDialogFitQueued = false;
  function queuePanelDialogFit() {
    if (panelDialogFitQueued) return;
    panelDialogFitQueued = true;
    requestAnimationFrame(() => {
      panelDialogFitQueued = false;
      fitPanelDialogToPanel();
    });
  }
  function capturePanelDialogBaseline() {
    const rect = ui.panel.getBoundingClientRect();
    panelDialogBaseline = {
      height: rect.height,
      width: rect.width,
      viewportWidth: document.documentElement.clientWidth || window.innerWidth,
      viewportHeight: document.documentElement.clientHeight || window.innerHeight,
      inlineHeight: ui.panel.style.height
    };
    ui.panel.style.height = `${rect.height}px`;
  }
  function fitPanelDialogToPanel() {
    if (!ui || ui.panel.hidden) return;
    const dialog = ui.confirmDialog?.open ? ui.confirmDialog : ui.settingsDialog?.open ? ui.settingsDialog : ui.aboutDialog?.open ? ui.aboutDialog : ui.limitDialog?.open ? ui.limitDialog : null;
    if (!dialog) return;
    const panelRect = ui.panel.getBoundingClientRect();
    const frameRect = ui.panelFrame.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const margin = 8;
    const available = Math.max(1, viewportHeight - margin * 2);
    const width = Math.max(1, Math.min(viewportWidth - margin * 2, panelRect.width - 18));
    dialog.style.width = `${width}px`;
    const style = getComputedStyle(dialog);
    const lastChild = dialog.lastElementChild;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const borderBottom = parseFloat(style.borderBottomWidth) || 0;
    const naturalHeight = lastChild ? lastChild.offsetTop + lastChild.offsetHeight + paddingBottom + borderBottom : dialog.scrollHeight;
    let target = Math.min(available, Math.max(1, Math.ceil(naturalHeight + 2)));
    dialog.style.height = `${target}px`;
    const overflow = dialog.scrollHeight - dialog.clientHeight;
    if (overflow > 0 && target < available) {
      target = Math.min(available, target + Math.ceil(overflow) + 1);
      dialog.style.height = `${target}px`;
    }
    const headerRect = ui.panel.querySelector(".cw-title")?.getBoundingClientRect();
    const preferredTop = Math.max(panelRect.top + 9, (headerRect?.bottom ?? panelRect.top + 44) + 8);
    const x = clamp(panelRect.left + 9, margin, Math.max(margin, viewportWidth - width - margin));
    const y = clamp(preferredTop, margin, Math.max(margin, viewportHeight - target - margin));
    dialog.style.left = `${x - frameRect.left}px`;
    dialog.style.top = `${y - frameRect.top}px`;
    dialog.style.transform = "none";
    ui.settingsScrim.style.borderRadius = getComputedStyle(ui.panel).borderRadius;
  }
  var dialogObservers = /* @__PURE__ */ new WeakMap();
  function disposePanelDialogObservers(root) {
    for (const dialog of root.querySelectorAll("dialog")) {
      const observers = dialogObservers.get(dialog);
      if (!observers) continue;
      for (const observer2 of observers) observer2.disconnect();
      dialogObservers.delete(dialog);
    }
    panelDialogBaseline = null;
  }
  function observePanelDialogLayout(dialog) {
    if (dialog.dataset.cwLayoutObserved === "1") return;
    dialog.dataset.cwLayoutObserved = "1";
    const observer2 = new MutationObserver(() => {
      if (dialog.open) queuePanelDialogFit();
    });
    const owned = [observer2];
    dialogObservers.set(dialog, owned);
    observer2.observe(dialog, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["hidden", "open", "class"]
    });
    const observed = dialog.querySelector(".cw-dialog-content") || dialog.querySelector(".cw-about-glossary");
    if (observed && typeof ResizeObserver === "function") {
      const resizeObserver = new ResizeObserver(() => {
        if (dialog.open) queuePanelDialogFit();
      });
      resizeObserver.observe(observed);
      owned.push(resizeObserver);
    }
  }
  function setPanelDialogBaseline(value) {
    return panelDialogBaseline = value;
  }

  // src/ui/12-watchdog-logo.js
  var SVG_NS = "http://www.w3.org/2000/svg";
  var WATCHDOG_PATHS = Object.freeze([
    "M218,98L205,111L192,130L180,155L173,176L167,201L163,232L164,281L167,301L172,321L179,341L190,363L192,372L192,392L187,422L187,443L189,459L196,483L212,513L232,535L247,546L258,552L261,564L266,574L278,587L283,590L284,593L285,607L274,644L268,675L266,695L266,722L271,758L279,786L292,815L304,834L304,842L302,851L290,877L245,934L237,947L226,971L223,986L223,998L225,1007L234,1026L254,1052L278,1076L296,1090L319,1105L303,1087L286,1061L278,1043L271,1018L269,1004L270,975L278,947L283,935L285,934L290,953L294,962L312,989L328,1005L356,1025L376,1036L406,1074L436,1104L460,1123L493,1144L525,1159L551,1167L534,1157L505,1135L476,1106L456,1081L441,1058L442,1056L471,1070L486,1075L498,1077L454,1043L431,1021L404,991L384,963L373,944L375,943L397,953L376,935L357,915L339,889L328,864L323,840L325,839L331,844L340,848L331,838L313,812L299,784L289,752L284,712L284,698L287,667L293,639L302,611L302,590L304,581L314,561L325,550L327,552L323,561L320,579L322,602L327,618L333,620L341,628L345,636L348,648L348,678L352,693L358,706L381,734L385,742L387,752L390,747L401,736L416,727L417,728L393,777L377,801L369,784L357,770L360,778L364,799L364,825L360,834L357,849L358,865L362,879L373,898L389,914L404,924L416,930L439,938L458,941L473,941L498,936L514,949L535,960L553,965L573,967L590,974L607,979L630,981L646,979L668,972L679,967L698,965L718,959L732,952L753,936L777,941L802,940L819,936L846,924L858,916L874,901L882,890L888,878L892,862L892,844L889,831L886,825L885,810L887,792L893,770L883,781L873,801L854,771L840,743L835,729L836,728L842,731L853,739L863,750L864,753L864,749L868,737L875,727L887,714L898,695L901,686L903,673L904,640L909,628L920,616L924,599L925,579L923,565L919,554L920,552L931,566L937,579L938,574L938,560L935,543L929,526L923,516L923,512L932,503L937,506L943,516L952,544L953,571L949,589L949,611L960,647L966,682L967,719L963,748L958,767L950,788L939,810L925,831L911,848L927,838L928,839L922,866L907,897L888,922L863,947L855,953L876,944L878,945L864,970L842,999L819,1024L801,1041L768,1068L755,1077L773,1073L792,1065L802,1059L804,1060L798,1071L786,1088L756,1121L747,1129L772,1115L800,1095L833,1063L847,1045L848,1049L831,1081L845,1071L861,1057L882,1034L890,1030L918,1010L938,990L951,972L959,956L964,941L964,935L966,934L973,948L980,971L982,995L979,1021L972,1044L964,1061L947,1087L931,1105L960,1086L978,1071L995,1054L1012,1033L1023,1014L1028,995L1027,979L1025,971L1016,950L1003,930L968,887L960,875L949,850L947,834L959,815L973,784L979,765L985,730L984,679L979,652L966,607L967,592L980,580L985,573L989,565L992,552L1005,545L1016,537L1033,520L1044,504L1055,481L1060,465L1063,447L1063,416L1058,388L1058,376L1062,360L1072,340L1082,308L1086,285L1088,242L1087,241L1086,218L1082,194L1075,168L1068,149L1056,125L1049,115L1032,97L1016,88L997,83L976,83L960,86L938,94L904,114L883,131L859,154L821,198L783,254L765,288L758,306L746,312L739,318L735,324L733,333L731,335L700,329L661,330L641,327L613,327L595,330L552,329L536,331L520,335L518,333L516,324L512,318L503,311L494,308L491,305L486,292L470,262L458,242L426,196L393,157L369,133L355,121L326,101L303,90L281,84L274,83L249,84L236,88Z",
    "M522,915L522,927L525,934L530,940L538,946L555,953L611,961L639,961L640,960L649,960L670,956L696,953L707,949L718,942L726,933L729,925L728,914L722,905L714,908L703,908L695,905L681,894L671,889L668,889L663,894L653,900L630,905L620,905L607,903L591,896L583,889L581,889L572,893L558,904L548,908L537,908L529,905Z M564,660L564,665L567,660L581,648L590,644L599,642L619,642L620,643L656,642L667,645L678,651L689,662L690,665L690,659L686,650L678,642L672,638L662,634L641,631L637,632L611,631L610,632L595,633L589,635L576,642L569,649Z M864,602L863,605L860,600L853,601L852,606L854,609L860,610L859,615L855,623L844,634L836,638L841,637L849,633L857,625L861,619L863,613Z M377,845L377,863L380,874L386,885L398,898L417,910L438,916L452,916L462,910L458,898L458,886L460,875L469,854L480,839L476,828L477,818L490,803L488,798L488,793L484,791L482,788L482,782L486,778L491,777L496,766L507,751L510,742L510,725L513,715L519,705L532,692L521,688L509,689L492,697L483,703L470,715L469,713L476,702L487,689L499,679L511,672L544,638L565,622L581,614L594,610L609,607L631,606L632,607L643,607L663,611L672,614L694,626L702,632L739,670L759,683L771,695L783,713L782,715L768,702L759,696L743,689L732,688L721,692L734,705L739,713L743,725L743,742L746,751L757,766L762,777L767,778L771,782L772,785L770,790L765,793L765,796L762,802L768,810L774,815L776,819L776,829L772,839L782,852L792,875L794,886L794,897L793,903L790,909L800,916L813,916L828,912L839,907L851,899L864,885L869,876L873,863L873,845L866,824L828,755L798,695L785,675L776,664L758,646L749,639L732,628L713,618L683,607L660,602L644,601L643,600L603,601L568,608L545,616L517,630L493,647L471,670L454,695L419,763L388,817L380,834Z M815,829L821,830L824,834L823,839L817,843L814,842L810,838L811,832Z M433,829L438,829L442,833L442,838L436,843L432,842L428,837L429,833Z M792,821L797,821L801,825L802,829L797,835L792,835L787,829L788,824Z M456,821L462,822L465,826L464,832L460,835L455,835L451,830L452,824Z M812,794L817,795L820,798L820,805L815,809L810,808L806,804L806,799Z M438,794L443,795L447,801L446,805L441,809L436,808L432,803L433,798Z M787,786L792,787L796,792L795,797L790,801L784,800L781,796L781,791Z M463,786L468,787L472,792L472,796L467,801L462,801L457,796L458,790Z M789,756L796,758L799,763L798,768L793,772L787,771L783,766L784,760Z M461,756L467,758L470,763L469,768L464,772L458,771L454,765L455,760Z M761,743L768,745L771,750L770,755L765,759L760,759L755,754L755,748Z M488,743L492,743L498,748L498,754L493,759L486,758L482,753L483,747Z M455,600L454,601L455,608L461,609L464,606L464,602L461,599Z M366,606L369,619L378,636L385,644L394,651L408,657L433,658L440,656L455,649L469,639L453,646L439,650L432,651L416,650L403,645L391,636L381,622L377,608L378,595L372,602Z M886,606L881,603L873,593L874,610L872,619L868,627L858,639L851,644L840,649L830,651L812,650L796,645L783,639L800,651L814,657L825,659L844,657L852,654L862,648L874,636L880,626Z M392,583L387,594L387,609L389,615L394,624L402,632L411,637L416,638L405,632L398,625L393,617L389,603L389,594Z M785,576L775,588L768,604L762,614L762,617L769,629L777,630L790,636L784,629L778,617L776,606L777,593L780,584Z M468,576L471,580L475,590L476,609L470,626L462,636L471,631L483,629L491,616L479,590Z M812,575L812,578L814,580L819,580L821,577L820,574L816,572Z M833,570L825,576L823,581L823,586L825,591L830,596L837,598L842,597L849,592L852,584L851,579L848,574L844,571Z M431,570L425,576L424,579L424,587L426,591L429,594L437,597L447,594L452,587L451,576L445,570L442,569Z M780,571L787,564L796,558L805,554L816,551L833,551L847,555L855,559L869,570L877,580L870,567L856,552L844,545L834,542L816,542L803,547L797,551L786,562Z M472,570L467,562L452,548L441,543L426,541L412,544L395,554L384,566L377,579L390,565L397,560L409,554L420,551L439,551L449,554L461,560L468,565Z M749,458L738,459L723,467L715,475L711,481L704,497L703,522L707,536L713,547L721,555L727,558L738,557L744,551L747,545L750,533L759,519L761,520L759,528L760,528L770,517L777,513L783,511L799,512L795,504L786,495L774,489L775,487L783,487L776,477L770,472L757,467L758,465L766,465L762,462Z M498,459L488,464L495,465L496,466L495,468L492,468L483,472L476,478L471,487L478,487L479,489L464,497L457,505L454,512L469,511L476,513L482,516L494,529L492,521L494,519L502,531L506,545L511,554L517,558L526,558L533,554L540,547L547,534L551,515L551,508L548,493L542,480L535,471L523,462L510,458Z M764,343L784,355L801,368L834,400L858,430L875,455L879,463L878,464L871,462L897,483L915,502L923,494L922,493L924,491L923,489L924,488L925,489L908,468L884,446L876,431L856,404L834,382L808,363L788,352Z M486,343L471,348L452,357L419,379L391,407L378,425L367,446L439,376L463,357L481,345Z M978,125L967,128L956,133L937,146L925,156L902,179L888,196L864,231L848,262L840,284L836,313L848,287L856,274L872,256L886,245L887,248L879,265L872,287L868,309L867,335L869,327L874,316L884,302L885,303L885,311L884,312L885,337L892,365L894,368L898,347L901,340L915,360L924,382L926,394L926,411L923,425L919,434L931,435L937,437L949,444L963,457L966,462L965,463L948,463L957,469L968,479L977,485L984,488L989,489L995,488L996,489L994,496L988,504L979,511L976,511L984,515L993,516L1001,514L1009,510L1018,502L1025,492L1033,472L1035,460L1035,440L1033,430L1032,429L1021,440L1010,448L1008,446L1016,434L1027,410L1030,396L1032,392L1035,371L1022,389L1007,404L991,415L990,413L1010,382L1026,350L1039,315L1048,274L1049,254L1050,253L1050,224L1049,223L1049,216L1048,222L1039,245L1028,265L1020,276L1019,273L1026,246L1029,225L1029,215L1030,214L1030,187L1026,163L1018,144L1009,133L1003,129L995,126Z M272,125L255,126L244,131L233,143L225,161L221,182L221,217L225,245L232,272L231,275L222,263L212,244L207,232L203,217L202,217L202,228L201,229L202,268L205,288L211,314L219,338L231,366L244,391L259,414L258,416L244,407L227,390L215,372L217,393L221,407L226,420L241,447L239,448L234,445L217,430L215,440L216,467L221,484L226,494L232,502L244,512L256,516L264,516L275,512L268,508L259,499L256,494L255,489L256,488L262,489L270,487L284,479L291,472L305,463L288,462L287,461L290,456L299,447L311,439L318,436L333,433L329,425L326,414L326,391L329,378L338,358L351,341L353,345L358,368L364,353L367,337L367,305L366,304L367,302L376,313L385,335L384,314L380,291L368,254L364,247L365,245L378,256L391,271L401,286L409,302L413,314L411,294L407,279L399,258L383,228L367,204L350,182L318,150L294,133L283,128Z",
    "M522,914L525,908L529,904L537,907L548,907L558,903L572,892L581,888L583,888L591,895L601,900L620,904L630,904L647,901L657,897L668,888L671,888L681,893L695,904L703,907L714,907L722,904L727,910L729,916L727,910L718,901L698,871L684,853L667,836L655,827L641,820L634,818L619,818L609,821L600,825L586,835L564,857L534,899L525,908Z M488,744L484,747L483,753L486,757L493,758L497,754L497,748L492,744Z M488,744L492,744L497,748L497,754L493,758L488,758L483,753L484,747Z M677,705L672,715L662,725L639,737L633,745L633,773L637,788L641,794L649,802L675,819L690,833L706,853L727,883L746,901L760,909L779,915L812,917L800,917L793,913L789,909L791,906L793,897L793,886L791,875L781,852L771,839L775,829L775,819L773,815L767,810L761,802L763,799L764,793L769,790L763,793L757,788L756,785L757,782L762,778L756,766L745,751L743,747L743,743L743,747L738,751L735,750L731,745L735,739L741,739L742,741L742,725L737,711L733,705L720,692L727,688L737,687L728,684L717,685L704,691L696,697Z M575,704L556,696L540,686L531,684L524,684L515,687L526,688L533,692L520,705L514,715L511,725L511,741L512,739L518,739L522,743L522,745L519,750L514,751L510,748L510,743L510,747L492,775L491,778L496,782L497,786L492,792L489,793L488,792L491,803L486,810L479,816L477,821L477,828L481,839L470,854L465,864L460,879L459,898L463,910L452,917L439,917L466,916L476,914L488,910L503,902L513,894L526,880L550,847L562,833L580,817L604,802L614,791L618,782L620,772L620,746L619,743L615,738L609,734L599,730L589,723L581,714Z M552,668L552,676L554,681L558,686L570,692L579,692L586,689L590,683L590,679L586,671L588,663L594,659L600,659L605,662L608,666L611,674L611,685L607,696L602,701L595,705L588,706L590,710L599,718L609,722L618,721L621,717L624,679L625,678L625,671L627,667L631,692L632,717L637,722L645,722L654,718L665,707L665,706L659,705L652,701L647,696L643,685L644,672L647,665L652,660L661,659L667,664L668,672L664,679L664,683L672,691L676,692L687,691L696,686L700,681L702,676L702,667L697,656L687,646L673,638L678,641L687,650L691,659L690,666L688,662L678,652L667,646L656,643L634,643L633,644L599,643L585,647L578,651L568,660L564,666L563,660L566,652L576,641L581,638L568,645L560,652L557,656Z M891,451L909,468L925,488L924,489L925,491L923,492L924,494L916,502L915,501L914,502L905,493L913,501L924,517L923,512L932,503L935,504L938,508L932,497L922,483L910,469Z"
  ]);
  function makePath(doc, geometry) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", geometry);
    return path;
  }
  function createWatchdogLogo(doc = document) {
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "cw-watchdog-svg");
    svg.setAttribute("viewBox", "0 0 1254 1254");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const ink = makePath(doc, WATCHDOG_PATHS[0]);
    ink.setAttribute("fill", "var(--cw-watchdog-ink, #080808)");
    ink.setAttribute("stroke", "var(--cw-watchdog-outline, #fff)");
    ink.setAttribute("stroke-width", "1.6");
    ink.setAttribute("stroke-linejoin", "round");
    ink.setAttribute("vector-effect", "non-scaling-stroke");
    ink.setAttribute("paint-order", "stroke fill");
    const white = makePath(doc, WATCHDOG_PATHS[1]);
    white.setAttribute("fill", "#fff");
    white.setAttribute("fill-rule", "evenodd");
    const gray = makePath(doc, WATCHDOG_PATHS[2]);
    gray.setAttribute("fill", "var(--cw-watchdog-gray, #3f3e3e)");
    gray.setAttribute("fill-rule", "evenodd");
    svg.append(ink, white, gray);
    return svg;
  }

  // src/ui/12-panel-site-icon.js
  var SVG_NS2 = "http://www.w3.org/2000/svg";
  var MAX_SVG_CHARS = 16384;
  var PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,+\-eE]+$/;
  var COLORS = /^(?:none|currentColor|black|white|#[0-9a-fA-F]{3,8})$/;
  var NUMERIC = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  var GEOMETRY = /* @__PURE__ */ new Set(["x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "stroke-width", "stroke-miterlimit", "opacity"]);
  var COMMON_ATTRS = /* @__PURE__ */ new Set(["fill", "fill-rule", "clip-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "opacity"]);
  var GRAPHICS = /* @__PURE__ */ new Set(["path", "g", "rect", "circle", "ellipse", "line", "polygon", "polyline"]);
  var OFFICIAL_FAVICON_CSS = /^\s*:root\s*\{\s*fill\s*:\s*#000\s*;\s*\}\s*@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{\s*:root\s*\{\s*fill\s*:\s*#fff\s*;\s*\}\s*\}\s*$/;
  function isKnownFaviconStyle(source) {
    const nodes = [...source.children];
    const attrs = [...source.attributes];
    if (nodes.length !== 2 || nodes[0].localName !== "style" || nodes[1].localName !== "path" || nodes[0].namespaceURI !== SVG_NS2 || nodes[1].namespaceURI !== SVG_NS2 || nodes[0].attributes.length !== 0 || nodes[1].attributes.length !== 1 || !nodes[1].hasAttribute("d") || attrs.length !== 5 || source.getAttribute("xmlns") !== SVG_NS2 || source.getAttribute("width") !== "180" || source.getAttribute("height") !== "180" || source.getAttribute("viewBox") !== "0 0 180 180" || source.getAttribute("fill") !== "none" || [...nodes[0].childNodes].some((node) => node.nodeType !== 3)) return false;
    return OFFICIAL_FAVICON_CSS.test(nodes[0].textContent || "");
  }
  var activeRoot = null;
  var activeHolder = null;
  var cachedFaviconSvg = null;
  var cacheAttempted = false;
  var cacheGeneration = 0;
  function safeGraphicAttribute(name, value) {
    if (name === "d") return value.length > 0 && value.length <= 15e3 && PATH_DATA.test(value);
    if (name === "points") return value.length <= 4096 && /^[0-9\s.,+\-eE]+$/.test(value);
    if (["fill", "stroke"].includes(name)) return COLORS.test(value);
    if (["fill-rule", "clip-rule"].includes(name)) return ["evenodd", "nonzero"].includes(value);
    if (["stroke-linejoin"].includes(name)) return ["round", "bevel", "miter"].includes(value);
    if (["stroke-linecap"].includes(name)) return ["round", "square", "butt"].includes(value);
    if (GEOMETRY.has(name)) return value.length < 32 && NUMERIC.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1e5;
    if (name === "transform") return value.length <= 160 && /^(?:(?:translate|scale|rotate|matrix)\([0-9\s.,+\-eE]+\)\s*)+$/.test(value);
    return false;
  }
  function setSafeSvgAttribute(element, name, value) {
    switch (name) {
      case "fill":
        element.setAttribute("fill", value);
        return;
      case "fill-rule":
        element.setAttribute("fill-rule", value);
        return;
      case "clip-rule":
        element.setAttribute("clip-rule", value);
        return;
      case "stroke":
        element.setAttribute("stroke", value);
        return;
      case "stroke-width":
        element.setAttribute("stroke-width", value);
        return;
      case "stroke-linecap":
        element.setAttribute("stroke-linecap", value);
        return;
      case "stroke-linejoin":
        element.setAttribute("stroke-linejoin", value);
        return;
      case "stroke-miterlimit":
        element.setAttribute("stroke-miterlimit", value);
        return;
      case "opacity":
        element.setAttribute("opacity", value);
        return;
      case "d":
        element.setAttribute("d", value);
        return;
      case "points":
        element.setAttribute("points", value);
        return;
      case "transform":
        element.setAttribute("transform", value);
        return;
      case "x":
        element.setAttribute("x", value);
        return;
      case "y":
        element.setAttribute("y", value);
        return;
      case "x1":
        element.setAttribute("x1", value);
        return;
      case "x2":
        element.setAttribute("x2", value);
        return;
      case "y1":
        element.setAttribute("y1", value);
        return;
      case "y2":
        element.setAttribute("y2", value);
        return;
      case "cx":
        element.setAttribute("cx", value);
        return;
      case "cy":
        element.setAttribute("cy", value);
        return;
      case "r":
        element.setAttribute("r", value);
        return;
      case "rx":
        element.setAttribute("rx", value);
        return;
      case "ry":
        element.setAttribute("ry", value);
        return;
      case "width":
        element.setAttribute("width", value);
        return;
      case "height":
        element.setAttribute("height", value);
        return;
      default:
        throw new Error("Non-whitelisted SVG attribute");
    }
  }
  function parseCachedFavicon(svgText, doc = document) {
    if (typeof svgText !== "string" || !svgText.length || svgText.length > MAX_SVG_CHARS) return null;
    const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
    if (parsed.querySelector("parsererror") || parsed.doctype || [...parsed.childNodes].some((node) => node.nodeType !== 1 && node.nodeType !== 8) || parsed.documentElement?.localName !== "svg" || parsed.documentElement.namespaceURI !== SVG_NS2) return null;
    const source = parsed.documentElement;
    const styled = [...source.children].some((node) => node.localName === "style");
    if (styled && !isKnownFaviconStyle(source)) return null;
    const box = source.getAttribute("viewBox");
    const vb = box?.trim().split(/[\s,]+/).map(Number);
    if (!vb || vb.length !== 4 || vb.some((n) => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0 || vb[2] > 2048 || vb[3] > 2048) return null;
    const out = doc.createElementNS(SVG_NS2, "svg");
    out.setAttribute("viewBox", vb.join(" "));
    out.setAttribute("width", "18");
    out.setAttribute("height", "18");
    out.setAttribute("fill", "currentColor");
    out.setAttribute("focusable", "false");
    out.setAttribute("aria-hidden", "true");
    const rootAllowed = /* @__PURE__ */ new Set(["xmlns", "viewBox", "width", "height", ...COMMON_ATTRS]);
    for (const attr of source.attributes) {
      if (!rootAllowed.has(attr.name) || attr.name !== "xmlns" && attr.name !== "viewBox" && !safeGraphicAttribute(attr.name, attr.value) || attr.name === "xmlns" && attr.value !== SVG_NS2) return null;
    }
    let count = 0;
    function copyNodes(from, to, depth) {
      if (depth > 6) return false;
      for (const child of from.childNodes) {
        if (child.nodeType === 3 && !child.textContent.trim()) continue;
        if (child.nodeType === 8) continue;
        if (styled && from === source && child.localName === "style") continue;
        if (child.nodeType !== 1 || child.namespaceURI !== SVG_NS2 || !GRAPHICS.has(child.localName)) return false;
        if (++count > 32) return false;
        const element = doc.createElementNS(SVG_NS2, child.localName);
        for (const attr of child.attributes) {
          const name = attr.name;
          if (!(COMMON_ATTRS.has(name) || name === "d" || name === "points" || name === "transform" || GEOMETRY.has(name)) || !safeGraphicAttribute(name, attr.value)) return false;
          setSafeSvgAttribute(element, name, attr.value);
        }
        if (child.localName === "path" && !element.hasAttribute("d") || ["polygon", "polyline"].includes(child.localName) && !element.hasAttribute("points")) return false;
        if (!copyNodes(child, element, depth + 1)) return false;
        to.appendChild(element);
      }
      return true;
    }
    if (!copyNodes(source, out, 0) || !count) return null;
    return out;
  }
  function cachedFaviconUrl(doc) {
    if (location.protocol !== "https:") return null;
    const assetSvgPath = /^\/cdn\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.svg$/;
    const urls = [...doc.querySelectorAll('head link[rel~="icon"]')].filter((el) => !el.type || el.type === "image/svg+xml").map((el) => {
      try {
        const href = el.getAttribute("href") || "";
        if (href.includes("%") || href.includes("\\") || /(?:^|\/)\.{1,2}(?:\/|$)/.test(href)) return null;
        const url = new URL(href, location.href);
        if (url.origin !== location.origin || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !assetSvgPath.test(url.pathname)) return null;
        return url.href;
      } catch {
        return null;
      }
    }).filter(Boolean);
    const unique = [...new Set(urls)];
    return unique.length === 1 ? unique[0] : null;
  }
  async function readCachedFavicon(doc) {
    const url = cachedFaviconUrl(doc);
    if (!url || navigator.serviceWorker?.controller) return null;
    try {
      const response = await window.fetch(url, {
        mode: "same-origin",
        cache: "only-if-cached",
        credentials: "same-origin",
        redirect: "error"
      });
      if (!response.ok || (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "image/svg+xml") return null;
      const length = Number(response.headers.get("content-length"));
      if (Number.isFinite(length) && length > MAX_SVG_CHARS) return null;
      return parseCachedFavicon(await response.text(), doc);
    } catch {
      return null;
    }
  }
  function showBadgeLogo() {
    if (!activeRoot?.isConnected || !activeHolder?.isConnected) return;
    const panelBrand = activeRoot.querySelector(".cw-title-info .cw-brand-mark");
    if (panelBrand) panelBrand.hidden = settings.logoPreference !== "watchdog";
    const graphic = settings.logoPreference === "openai" && cachedFaviconSvg;
    if (graphic) {
      const current = activeHolder.firstElementChild;
      if (current?.isEqualNode(graphic) && activeHolder.classList.contains("cw-has-site-logo")) return;
      activeHolder.replaceChildren(graphic.cloneNode(true));
      activeHolder.classList.add("cw-has-site-logo");
    } else {
      if (!activeHolder.classList.contains("cw-has-site-logo") && activeHolder.firstElementChild?.classList.contains("cw-watchdog-svg")) return;
      activeHolder.replaceChildren(createWatchdogLogo(activeHolder.ownerDocument));
      activeHolder.classList.remove("cw-has-site-logo");
    }
    const tip = activeRoot.querySelector(".cw-floating-tip");
    const tipLogo = tip?.hidden ? null : tip?.querySelector(".cw-tip-logo");
    if (tipLogo) {
      const copy = activeHolder.cloneNode(true);
      copy.classList.add("cw-tip-logo");
      tipLogo.replaceWith(copy);
    }
  }
  function switchToWatchdogAfterCacheFailure(persistPreference = true) {
    if (settings.logoPreference !== "openai") return;
    settings.logoPreference = "watchdog";
    if (persistPreference) saveSettings();
    for (const button of activeRoot?.querySelectorAll("[data-cw-view-logo]") || []) {
      button.setAttribute("aria-pressed", String(button.dataset.cwViewLogo === "watchdog"));
    }
    showBadgeLogo();
  }
  function refreshBadgeSiteIcon(retryCache = false, persistCacheFallback = true) {
    if (!activeRoot?.isConnected || !activeHolder?.isConnected) return;
    if (retryCache) {
      ++cacheGeneration;
      cacheAttempted = false;
      cachedFaviconSvg = null;
    }
    showBadgeLogo();
    if (settings.logoPreference !== "openai" || cacheAttempted) return;
    cacheAttempted = true;
    const generation = ++cacheGeneration;
    void readCachedFavicon(activeRoot.ownerDocument).then((svg) => {
      if (generation !== cacheGeneration || settings.logoPreference !== "openai") return;
      if (svg) {
        cachedFaviconSvg = svg;
        showBadgeLogo();
      } else {
        switchToWatchdogAfterCacheFailure(persistCacheFallback);
      }
    });
  }
  function installBadgeSiteIcon(root, holder) {
    activeRoot = root;
    activeHolder = holder;
    refreshBadgeSiteIcon();
  }

  // src/ui/08-theme-budgets.js
  function systemIsDark() {
    return !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  }
  function chatGptTheme() {
    const hostRoot = document.querySelector("#__next, #root");
    for (const node of [document.documentElement, document.body, hostRoot]) {
      if (!node) continue;
      for (const attr of ["data-theme", "data-color-mode", "data-mode"]) {
        const value = (node.getAttribute(attr) || "").toLowerCase();
        if (value === "dark" || value === "light") return value;
      }
      if (node.classList.contains("dark")) return "dark";
      if (node.classList.contains("light")) return "light";
    }
    for (const node of [document.documentElement, document.body, hostRoot]) {
      if (!node) continue;
      const scheme = getComputedStyle(node).colorScheme.trim().toLowerCase();
      if (scheme === "dark" || scheme === "only dark") return "dark";
      if (scheme === "light" || scheme === "only light") return "light";
    }
    for (const node of [hostRoot, document.body, document.documentElement]) {
      if (!node) continue;
      const bg = getComputedStyle(node).backgroundColor;
      const rgb = bg.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, ]+([\d.]+))?\)$/);
      if (!rgb || rgb[4] !== void 0 && Number(rgb[4]) < 0.8) continue;
      const lum = Number(rgb[1]) * 0.2126 + Number(rgb[2]) * 0.7152 + Number(rgb[3]) * 0.0722;
      return lum < 145 ? "dark" : "light";
    }
    return systemIsDark() ? "dark" : "light";
  }
  function resolvedViewPalette() {
    if (settings.viewTheme === "light" || settings.viewTheme === "dark") return settings.viewTheme;
    if (settings.viewTheme === "system") return systemIsDark() ? "dark" : "light";
    return chatGptTheme();
  }
  function applyAppearance() {
    if (!ui?.root) return;
    ui.root.dataset.cwStyle = settings.viewStyle;
    ui.root.dataset.cwPalette = resolvedViewPalette();
  }
  var pageThemeObserver = null;
  var observedThemeBody = null;
  var observedThemeHost = null;
  var observedThemeParent = null;
  var THEME_ATTRIBUTES = ["class", "style", "data-theme", "data-color-mode", "data-mode"];
  function refreshPageThemeTargets() {
    const body = document.body;
    const host = document.querySelector("#__next, #root");
    const parent = host?.parentElement || null;
    if (observedThemeBody === body && observedThemeHost === host && observedThemeParent === parent) return false;
    pageThemeObserver.disconnect();
    observedThemeBody = body;
    observedThemeHost = host;
    observedThemeParent = parent;
    const themeNodes = /* @__PURE__ */ new Set([document.documentElement, body, host]);
    const rootParents = /* @__PURE__ */ new Set([document.documentElement, body, parent]);
    for (const node of /* @__PURE__ */ new Set([...themeNodes, ...rootParents])) {
      if (!node) continue;
      const attributes = themeNodes.has(node);
      pageThemeObserver.observe(node, {
        attributes,
        ...attributes ? { attributeFilter: THEME_ATTRIBUTES } : {},
        childList: rootParents.has(node)
      });
    }
    return true;
  }
  function watchPageTheme() {
    if (pageThemeObserver) return;
    pageThemeObserver = new MutationObserver((records) => {
      const rootChanged = refreshPageThemeTargets();
      if (settings.viewTheme === "chatgpt" && (rootChanged || records.some((record) => record.type === "attributes"))) {
        applyAppearance();
      }
    });
    refreshPageThemeTargets();
  }
  function syncViewControls() {
    if (!ui?.settingsDialog) return;
    for (const button of ui.settingsDialog.querySelectorAll("[data-cw-view-style], [data-cw-view-theme], [data-cw-view-logo]")) {
      const value = button.dataset.cwViewStyle || button.dataset.cwViewTheme || button.dataset.cwViewLogo;
      const selected = button.hasAttribute("data-cw-view-style") ? settings.viewStyle === value : button.hasAttribute("data-cw-view-logo") ? settings.logoPreference === value : settings.viewTheme === value;
      button.setAttribute("aria-pressed", String(selected));
    }
  }
  function changeViewPreference(field, value) {
    const key = field === "style" ? "viewStyle" : field === "logo" ? "logoPreference" : "viewTheme";
    const allowed = field === "style" ? ["soft", "sharp"] : field === "logo" ? ["openai", "watchdog"] : ["light", "dark", "system", "chatgpt"];
    if (!allowed.includes(value) || settings[key] === value) return;
    const previous = settings[key];
    settings[key] = value;
    if (!saveSettings()) {
      settings[key] = previous;
      syncViewControls();
      return;
    }
    applyAppearance();
    if (field === "logo") refreshBadgeSiteIcon(true);
    syncViewControls();
    if (ui?.settingsDialog?.open) {
      fitPanelDialogToPanel();
      requestAnimationFrame(fitPanelDialogToPanel);
    }
  }
  function budgetStatus(s, budgets, hasContext = true) {
    if (!currentChatKey) return { level: "pending", label: "WAIT \xB7 chat UUID", color: "#64748b" };
    if (!hasContext) return { level: "pending", label: "WAIT \xB7 first message", color: "#64748b" };
    if (percentOf(s.optimistic, budgets.normal) > 100) {
      return { level: "critical", label: "RED \xB7 prepare HANDOFF", color: "#ef4444" };
    }
    if (percentOf(s.pessimistic, budgets.normal) > 100) {
      return { level: "caution", label: "YELLOW \xB7 caution", color: "#ca8a04" };
    }
    return { level: "ok", label: "OK \xB7 within budget", color: "var(--cw-accent)" };
  }
  function percentOf(value, budget) {
    if (!budget) return 0;
    return Math.round(value * 100 / budget);
  }
  function compactK(n) {
    const k = n / 1e3;
    if (k < 10) return k.toFixed(1).replace(/\.0$/, "");
    if (k < 100) return k.toFixed(0);
    return Math.round(k).toString();
  }

  // src/core/context-estimate.js
  function calculateContextEstimate(state, chatTokens, ff, imageStats, config) {
    const imageOptimistic = Math.ceil(imageStats.tokens * (config.imageOptimisticPct / 100));
    const imagePessimistic = Math.ceil(imageStats.tokens * (config.imagePessimisticPct / 100));
    const optimistic = chatTokens + ff.fileOptimistic + imageOptimistic + config.hiddenOptimistic;
    const pessimistic = chatTokens + ff.filePessimistic + imagePessimistic + config.hiddenPessimistic;
    return {
      optimistic: Math.max(chatTokens, Math.ceil(optimistic)),
      pessimistic: Math.max(chatTokens, Math.ceil(pessimistic)),
      fileOptimistic: ff.fileOptimistic,
      filePessimistic: ff.filePessimistic,
      imageOptimistic,
      imagePessimistic,
      knownTokens: ff.knownTokens + imageStats.tokens,
      knownFiles: ff.fileCount + imageStats.effective,
      knownFileTokens: ff.knownTokens,
      knownFileCount: ff.fileCount,
      parsedFiles: ff.parsedFiles,
      metadataFiles: ff.metadataFiles,
      reactMetadataFiles: ff.reactMetadataFiles,
      unparsedFiles: ff.unparsedFiles,
      unknownSizeFiles: ff.unknownSizeFiles,
      autoPasteMinimumFiles: ff.autoPasteMinimumFiles,
      autoPasteMinimumChars: ff.autoPasteMinimumChars,
      sampledTextFiles: ff.sampledTextFiles,
      fullyReadTextFiles: ff.fullyReadTextFiles,
      totalFileBytes: ff.totalBytes,
      knownImageTokens: imageStats.tokens,
      knownImages: imageStats.effective,
      capturedImages: imageStats.captured,
      historicalImages: imageStats.historical
    };
  }

  // src/attachments/05-react-metadata.js
  function reactAttachmentMetadata(element, turn, expectedName = "") {
    try {
      if (!turn?.contains?.(element)) return null;
      const anchors = [];
      const expected = normalizeFileName(expectedName);
      if (element.getAttribute?.("title")) anchors.push(element);
      for (const child of Array.from(element.querySelectorAll?.("[title]") || []).slice(0, 12)) {
        if (!expected || normalizeFileName(child.getAttribute("title")) === expected) {
          anchors.push(child);
        }
      }
      if (!anchors.length) anchors.push(element);
      const visited = /* @__PURE__ */ new Set();
      for (const anchor of anchors) {
        let node = anchor;
        for (let level = 0; node && level < 10; level++, node = node.parentElement) {
          const fiberKey = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
          let fiber = fiberKey ? node[fiberKey] : null;
          for (let i = 0; fiber && i < 100; i++, fiber = fiber.return) {
            if (visited.has(fiber)) break;
            visited.add(fiber);
            const value = fiber.memoizedProps?.attachment;
            if (!value || typeof value !== "object" || typeof value.name !== "string") continue;
            const name = value.name.trim();
            if (!name || expected && normalizeFileName(name) !== expected) continue;
            const visible = String(element.getAttribute?.("title") || "") === name || String(element.textContent || "").length <= 500 && String(element.textContent || "").includes(name);
            if (!expected && !visible) continue;
            const size = Number(value.sizeBytes);
            const width = Number(value.width);
            const height = Number(value.height);
            const duration = Number(value.durationSeconds);
            const id = value.fileId ?? value.id;
            return {
              name,
              size: Number.isSafeInteger(size) && size > 0 ? size : 0,
              type: typeof value.mimeType === "string" ? value.mimeType.slice(0, 128) : "",
              fileId: typeof id === "string" && /^file_[a-z0-9_-]{8,100}$/i.test(id) ? id : "",
              width: Number.isFinite(width) && width > 0 ? width : 0,
              height: Number.isFinite(height) && height > 0 ? height : 0,
              durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 0,
              metadataSource: "react-props"
            };
          }
          if (node === turn) break;
        }
      }
    } catch {
    }
    return null;
  }
  function fileMetadataFromElement(element, turn) {
    const sources = [
      element.getAttribute?.("download"),
      element.getAttribute?.("title"),
      element.getAttribute?.("aria-label"),
      element.textContent
    ];
    let name = "";
    for (const source of sources) {
      name = extractDocumentFileName(source);
      if (name) break;
    }
    if (!name) {
      for (const source of sources) {
        name = extractAutoPasteCardName(source);
        if (name) break;
      }
    }
    const react = reactAttachmentMetadata(element, turn, name);
    if (!name && !react) return null;
    if (!name && react) name = react.name;
    if (isImageFile({ name, type: react?.type || "" })) return null;
    let size = react?.size || 0;
    let node = element;
    for (let depth = 0; !size && node && depth < 5; depth++, node = node.parentElement) {
      const value = node.textContent || "";
      if (value.length <= 800) {
        size = parseDisplayedFileSize(value);
        if (size) break;
      }
      if (node === turn) break;
    }
    return { name, size, ...react ? {
      type: react.type,
      fileId: react.fileId,
      durationSeconds: react.durationSeconds,
      metadataSource: react.metadataSource
    } : {} };
  }

  // src/attachments/05-attachment-submission.js
  var LOCAL_FILE_SUBMISSION_WINDOW_MS = 2 * 60 * 1e3;
  function isActiveSubmittedFile(item, chatKey, now = Date.now()) {
    return !item.used && !!item.submittedAt && now - item.submittedAt >= 0 && now - item.submittedAt <= LOCAL_FILE_SUBMISSION_WINDOW_MS && (item.chatKey === chatKey || item.chatKey === null && chatKey === currentChatKey);
  }

  // src/attachments/05-attachment-scan.js
  function forEachUserMessage(entries, visit) {
    for (const { el, role, id } of entries) {
      if (role === "user" && id) visit(el, id);
    }
  }
  function bindSubmittedFilesToMessage(entries, chatKey) {
    if (!pendingLocalFiles.some((item) => isActiveSubmittedFile(item, chatKey) && !item.boundMessageId)) return;
    const latest = entries.filter(({ role, id }) => role === "user" && id).at(-1);
    if (!latest) return;
    const { el: turn, id: messageId } = latest;
    const candidates = pendingLocalFiles.filter((item) => !item.boundMessageId && isActiveSubmittedFile(item, chatKey) && !item.existingMessageIds.has(messageId));
    if (!candidates.length) return;
    for (const element of turn.querySelectorAll?.(
      'a[download], a[href], button, [role="button"], [data-testid*="file"]'
    ) || []) {
      if (element.closest?.(`#${APP}-root`)) continue;
      const meta = fileMetadataFromElement(element, turn);
      if (!meta) continue;
      const item = candidates.find((file) => !file.boundMessageId && normalizeFileName(file.file.name) === normalizeFileName(meta.name) && fileSizesCompatible(file.file.size, meta.size));
      if (!item) continue;
      item.boundMessageId = messageId;
      item.boundEpoch = resetEpoch(chatKey);
    }
  }
  function submittedFileMatchesMessage(item, chatKey, messageId) {
    if (item.used || item.readingLaunchPending || !messageId) return false;
    if (item.boundMessageId) {
      return item.chatKey === chatKey && item.boundMessageId === messageId && item.boundEpoch === resetEpoch(chatKey);
    }
    return isActiveSubmittedFile(item, chatKey) && !item.existingMessageIds.has(messageId);
  }
  function scanConversationFiles(entries, state) {
    const perfStartedAt = perfStart();
    try {
      state.files = state.files || {};
      bindSubmittedFilesToMessage(entries, state.chatKey);
      const inspected = [];
      const hasPendingFiles = pendingLocalFiles.some((p) => !p.used && (p.boundMessageId ? p.chatKey === state.chatKey && p.boundEpoch === resetEpoch(state.chatKey) : isActiveSubmittedFile(p, state.chatKey)));
      forEachUserMessage(entries, (turn, messageId) => {
        if (!hasPendingFiles && !dirtyFileTurns.has(turn) && inspectedFileTurns.get(turn) === `${state.chatKey}|${messageId}`) return;
        inspected.push({ turn, messageId });
      });
      if (!inspected.length) return { changed: false, inspected, jobs: [] };
      const seenThisScan = /* @__PURE__ */ new Set();
      const jobs = [];
      const scheduledFiles = /* @__PURE__ */ new Set();
      const latestUserId = entries.filter((entry) => entry.role === "user" && entry.id).at(-1)?.id || null;
      const filesByName = /* @__PURE__ */ new Map();
      for (const [key, file] of Object.entries(state.files)) {
        const name = normalizeFileName(file?.name);
        if (!filesByName.has(name)) filesByName.set(name, []);
        filesByName.get(name).push([key, file]);
      }
      let changed = false;
      for (const { turn, messageId } of inspected) {
        const candidates = Array.from(
          turn.querySelectorAll?.(
            'a[download], a[href], button, [role="button"], [data-testid*="file"]'
          ) || []
        );
        for (const element of candidates) {
          if (element.closest?.(`#${APP}-root`)) continue;
          const meta = fileMetadataFromElement(element, turn);
          if (!meta) continue;
          const autoPaste = isAutoPasteName(meta.name);
          const staged = pendingLocalFiles.find((p) => submittedFileMatchesMessage(p, state.chatKey, messageId) && messageId === latestUserId && normalizeFileName(p.file.name) === normalizeFileName(meta.name) && fileSizesCompatible(p.file.size, meta.size));
          if (staged && state.chatKey && !corruptLedgerKeys.has(state.chatKey) && !scheduledFiles.has(staged)) {
            scheduledFiles.add(staged);
            jobs.push({
              staged,
              chatKey: state.chatKey,
              messageId,
              epoch: resetEpoch(state.chatKey)
            });
          }
          const signature = `${messageId}|${meta.fileId || normalizeFileName(meta.name)}|${meta.size || 0}`;
          if (seenThisScan.has(signature)) continue;
          seenThisScan.add(signature);
          const normalizedName = normalizeFileName(meta.name);
          const matches = filesByName.get(normalizedName) || [];
          const existingKey = matches.find(([, file]) => {
            if (file.fileId && meta.fileId && file.fileId !== meta.fileId) return false;
            if (file.messageId === messageId) {
              if (file.size && meta.size && file.metadataSource === "react-props" && meta.metadataSource === "react-props" && file.size !== meta.size) return false;
              if (!fileSizesCompatible(file.size, meta.size)) return false;
              return true;
            }
            return !file.messageId && ["file-input", "drop", "paste"].includes(file.source) && fileSizesCompatible(file.size, meta.size);
          })?.[0];
          if (existingKey) {
            const existing = state.files[existingKey];
            if (!existing.size && meta.size) {
              existing.size = meta.size;
              changed = true;
            }
            if (!existing.type && meta.type) {
              existing.type = meta.type;
              changed = true;
            }
            if (!existing.fileId && meta.fileId) {
              existing.fileId = meta.fileId;
              changed = true;
            }
            if (!existing.durationSeconds && meta.durationSeconds) {
              existing.durationSeconds = meta.durationSeconds;
              changed = true;
            }
            if (meta.metadataSource && existing.metadataSource !== meta.metadataSource) {
              existing.metadataSource = meta.metadataSource;
              changed = true;
            }
            if (existing.messageId !== messageId) {
              existing.messageId = messageId;
              changed = true;
            }
            if (autoPaste && !existing.autoPaste) {
              existing.autoPaste = true;
              changed = true;
            }
            if (!existing.historySeenAt) {
              existing.historySeenAt = Date.now();
              changed = true;
            }
            continue;
          }
          const key = `dom-user-file:${hash32(signature)}`;
          if (!state.files[key]) {
            state.files[key] = {
              name: meta.name,
              size: meta.size || 0,
              type: meta.type || "",
              source: "dom-history",
              messageId,
              ...meta.fileId ? { fileId: meta.fileId } : {},
              ...meta.durationSeconds ? { durationSeconds: meta.durationSeconds } : {},
              ...meta.metadataSource ? { metadataSource: meta.metadataSource } : {},
              ...autoPaste ? { autoPaste: true } : {},
              method: "metadata-size",
              metadataOnly: true,
              status: "ready",
              tokens: 0,
              addedAt: Date.now(),
              historySeenAt: Date.now()
            };
            if (!filesByName.has(normalizedName)) filesByName.set(normalizedName, []);
            filesByName.get(normalizedName).push([key, state.files[key]]);
            changed = true;
          }
        }
      }
      return { changed, inspected, jobs };
    } finally {
      perfEnd("files", perfStartedAt);
    }
  }
  function queueCommittedFileJobs(jobs, rememberSentFile2) {
    for (const job of jobs || []) queueMicrotask(() => {
      const { staged, chatKey, messageId, epoch } = job;
      const index = pendingLocalFiles.indexOf(staged);
      if (index < 0 || staged.used || staged.chatKey !== chatKey || resetEpoch(chatKey) !== epoch || staged.boundMessageId && staged.boundMessageId !== messageId || !submittedFileMatchesMessage(staged, chatKey, messageId) || corruptLedgerKeys.has(chatKey)) return;
      if (isWatchdogPaused()) return;
      const committed = Object.values(loadState(chatKey).files || {}).some((entry) => entry.messageId === messageId && entry.metadataOnly && normalizeFileName(entry.name) === normalizeFileName(staged.file.name) && fileSizesCompatible(entry.size, staged.file.size));
      if (!committed) return;
      staged.readingLaunchPending = true;
      const onReadingCommitted = (committed2) => {
        staged.readingLaunchPending = false;
        if (!committed2) return;
        staged.used = true;
        const liveIndex = pendingLocalFiles.indexOf(staged);
        if (liveIndex >= 0) pendingLocalFiles.splice(liveIndex, 1);
      };
      try {
        Promise.resolve(rememberSentFile2(
          staged.file,
          staged.source,
          chatKey,
          messageId,
          onReadingCommitted
        )).catch((err) => {
          staged.readingLaunchPending = false;
          console.warn("[Context Watchdog] file reading launch failed");
        });
      } catch (err) {
        staged.readingLaunchPending = false;
        console.warn("[Context Watchdog] file reading launch failed");
      }
    });
  }

  // src/chatgpt/09-dom-image-accounting.js
  function isLikelyConversationImage(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    if (img.closest(`#${APP}-root`)) return false;
    const src = img.currentSrc || img.getAttribute("src") || "";
    if (!src) return false;
    const w = img.naturalWidth || img.clientWidth || Number(img.getAttribute("width")) || 0;
    const h = img.naturalHeight || img.clientHeight || Number(img.getAttribute("height")) || 0;
    if (w && h && w < 96 && h < 96) return false;
    const alt = (img.getAttribute("alt") || "").toLowerCase();
    if (/avatar|profile|logo|icon/.test(alt) && w < 160 && h < 160) return false;
    return true;
  }
  var USER_IMAGE_TURN_SELECTOR = '[data-chatgpt-search-unit-key$=":user"], [data-chatgpt-search-unit-key="user"], [data-message-id][data-message-author-role="user"], [data-message-id][data-message-role="user"]';
  function onDomImageLoad(event) {
    const turn = event.currentTarget?.closest?.(USER_IMAGE_TURN_SELECTOR);
    if (!turn) return;
    dirtyImageTurns.add(turn);
    notifyImageRescan();
  }
  function scanConversationImages(entries, state, inspected = []) {
    const perfStartedAt = perfStart();
    try {
      state.domImages = state.domImages || {};
      let changed = false;
      forEachUserMessage(entries, (turn, messageId) => {
        const epoch = resetEpoch(state.chatKey);
        const prev = inspectedImageTurns.get(turn);
        if (!dirtyImageTurns.has(turn) && prev?.chatKey === state.chatKey && prev.messageId === messageId && prev.epoch === epoch && prev.keys.every((key) => state.domImages[key])) {
          const now = Date.now();
          for (const key of prev.keys) state.domImages[key].lastSeenAt = now;
          return;
        }
        const imgs = Array.from(turn.querySelectorAll?.("img") || []);
        const keys = [];
        let cacheable = true;
        let slot = 0;
        for (const img of imgs) {
          if (img instanceof HTMLImageElement && !watchedImageNodes.has(img)) {
            img.addEventListener?.("load", onDomImageLoad);
            watchedImageNodes.add(img);
          }
          if (!isLikelyConversationImage(img)) continue;
          if (!img.naturalWidth || !img.naturalHeight) cacheable = false;
          const w = img.naturalWidth || img.clientWidth || 0;
          const h = img.naturalHeight || img.clientHeight || 0;
          const key = `dom-user-image-slot:${hash32(`${messageId}
${slot++}`)}`;
          keys.push(key);
          if (!state.domImages[key]) {
            state.domImages[key] = {
              messageId,
              width: w,
              height: h,
              tokens: Math.max(1, Math.round(settings.averageImageTokens)),
              firstSeenAt: Date.now(),
              lastSeenAt: Date.now()
            };
            changed = true;
          } else {
            state.domImages[key].lastSeenAt = Date.now();
            if ((!state.domImages[key].width || !state.domImages[key].height) && w && h) {
              state.domImages[key].width = w;
              state.domImages[key].height = h;
              changed = true;
            }
          }
        }
        if (cacheable) inspected.push({ turn, messageId, chatKey: state.chatKey, epoch, keys });
      });
      return changed;
    } finally {
      perfEnd("images", perfStartedAt);
    }
  }
  function effectiveImageStats(state, capturedImages = null) {
    const capturedByMessage = capturedImages?.byMessage || /* @__PURE__ */ new Map();
    const domByMessage = /* @__PURE__ */ new Map();
    let captured = capturedImages ? capturedImages.count : 0;
    let historical = 0;
    if (!capturedImages) for (const [key, file] of Object.entries(state.files || {})) {
      if (file?.method !== "image-average") continue;
      captured++;
      const id = file.messageId || `unbound-file:${key}`;
      capturedByMessage.set(id, (capturedByMessage.get(id) || 0) + 1);
    }
    for (const [key, image] of Object.entries(state.domImages || {})) {
      if (!key.startsWith("dom-user-image-slot:") || !image) continue;
      historical++;
      const id = image.messageId || `unbound-dom:${key}`;
      domByMessage.set(id, (domByMessage.get(id) || 0) + 1);
    }
    let effective = 0;
    for (const id of /* @__PURE__ */ new Set([...capturedByMessage.keys(), ...domByMessage.keys()])) {
      effective += Math.max(capturedByMessage.get(id) || 0, domByMessage.get(id) || 0);
    }
    return {
      captured,
      historical,
      effective,
      tokens: effective * settings.averageImageTokens
    };
  }

  // src/app/07-forecast.js
  function autoPasteMinimumEstimate(file) {
    if (!file || !file.autoPaste && !(file.source === "dom-history" && isAutoPasteName(file.name))) return null;
    if ((Number(file.tokens) || 0) > 0 && !file.metadataOnly) return null;
    const minChars = settings.pastedMinChars;
    const englishEquivalent = Math.ceil(minChars / settings.pastedEnglishCharsPerToken);
    const cyrillicEquivalent = Math.ceil(minChars / settings.pastedCyrillicCharsPerToken);
    const optimistic = Math.ceil(englishEquivalent * (settings.fileOptimisticPct / 100));
    return {
      chars: minChars,
      optimistic,
      pessimistic: Math.max(
        optimistic,
        Math.ceil(cyrillicEquivalent * (settings.filePessimisticPct / 100))
      )
    };
  }
  function fileForecast(files, capturedImages = null) {
    let optimistic = 0;
    let pessimistic = 0;
    let knownTokens = 0;
    let fileCount = 0;
    let parsedFiles = 0;
    let metadataFiles = 0;
    let reactMetadataFiles = 0;
    let unparsedFiles = 0;
    let unknownSizeFiles = 0;
    let autoPasteMinimumFiles = 0;
    let autoPasteMinimumChars = 0;
    let sampledTextFiles = 0;
    let fullyReadTextFiles = 0;
    let totalBytes = 0;
    for (const key in files || {}) {
      const file = files[key];
      if (!file) continue;
      if (file.method === "image-average") {
        if (capturedImages && Object.hasOwn(files, key)) {
          capturedImages.count++;
          const id = file.messageId || `unbound-file:${key}`;
          const byMessage = capturedImages.byMessage;
          byMessage.set(id, (byMessage.get(id) || 0) + 1);
        }
        continue;
      }
      const t = Number(file.tokens) || 0;
      const size = Number(file.size) || 0;
      fileCount++;
      if (file.metadataSource === "react-props") reactMetadataFiles++;
      if (file.method === "text-extrapolated") sampledTextFiles++;
      if (file.method === "text") fullyReadTextFiles++;
      if (size > 0) totalBytes += size;
      else unknownSizeFiles++;
      if ((t > 0 || file.method === "text") && !file.metadataOnly) {
        knownTokens += t;
        parsedFiles++;
        optimistic += t * (settings.fileOptimisticPct / 100);
        pessimistic += t * (settings.filePessimisticPct / 100);
        continue;
      }
      if (file.metadataOnly || file.method === "metadata-size") {
        metadataFiles++;
      } else {
        unparsedFiles++;
      }
      const meta = metadataFileContextEstimate(file, settings);
      const pasteMinimum = autoPasteMinimumEstimate(file);
      if (file.source === "dom-history" && size <= 0 && !pasteMinimum) {
        const baseTokens = settings.historicalFileFallbackTokens;
        meta.optimistic = Math.ceil(baseTokens * (settings.fileOptimisticPct / 100));
        meta.pessimistic = Math.ceil(baseTokens * (settings.filePessimisticPct / 100));
      }
      if (pasteMinimum) {
        autoPasteMinimumFiles++;
        autoPasteMinimumChars += pasteMinimum.chars;
      }
      optimistic += Math.max(meta.optimistic, pasteMinimum?.optimistic || 0);
      pessimistic += Math.max(meta.pessimistic, pasteMinimum?.pessimistic || 0);
    }
    return {
      fileOptimistic: Math.ceil(optimistic),
      filePessimistic: Math.ceil(pessimistic),
      knownTokens,
      fileCount,
      parsedFiles,
      metadataFiles,
      reactMetadataFiles,
      unparsedFiles,
      unknownSizeFiles,
      autoPasteMinimumFiles,
      autoPasteMinimumChars,
      sampledTextFiles,
      fullyReadTextFiles,
      totalBytes
    };
  }
  function estimateCurrentContext(state, chatTokens) {
    const capturedImages = { count: 0, byMessage: /* @__PURE__ */ new Map() };
    const files = fileForecast(state.files || {}, capturedImages);
    return calculateContextEstimate(
      state,
      chatTokens,
      files,
      effectiveImageStats(state, capturedImages),
      settings
    );
  }

  // src/app/11-ledger-statistics.js
  function stats(state = loadState()) {
    const perfStartedAt = perfStart();
    try {
      let tokens = 0;
      let chars = 0;
      let turns = 0;
      let userTurns = 0;
      let assistantTurns = 0;
      let otherTurns = 0;
      let uuidMessages = 0;
      for (const id in state.messages || {}) {
        const item = state.messages[id];
        tokens += Number(item?.tokens) || 0;
        chars += Number(item?.chars) || 0;
        turns++;
        if (item?.role === "user") userTurns++;
        else if (item?.role === "assistant") assistantTurns++;
        else otherTurns++;
        if (id.startsWith("msg:")) uuidMessages++;
      }
      const estimate = estimateCurrentContext(state, tokens);
      return {
        tokens,
        chars,
        turns,
        userTurns,
        assistantTurns,
        otherTurns,
        uuidMessages,
        ...estimate
      };
    } finally {
      perfEnd("stats", perfStartedAt);
    }
  }
  function formatScaledTokens(n, precision) {
    if (n < 1e3) return String(Math.round(n));
    if (n < 1e6) return `${(n / 1e3).toFixed(precision)}k`;
    return `${(n / 1e6).toFixed(2)}M`;
  }

  // src/app/11-route-inspection.js
  function setSessionPhase(phase) {
    if (runtime.phase === phase) return false;
    runtime.phase = phase;
    return true;
  }
  function setCompletionPending(pending) {
    runtime.work.completion = !!pending;
  }
  function requestInitialInspection() {
    runtime.work.initial = true;
  }
  function sessionDiagnosticsSnapshot() {
    const gate = runtime.route?.gate;
    return {
      phase: runtime.phase,
      completion: runtime.work.completion,
      initial: runtime.work.initial,
      routePending: !!runtime.route,
      gate: gate ? { ...gate } : null
    };
  }
  function requestBackfill() {
    runtime.work.backfill = true;
  }
  function startRouteTransition(beforeSnapshot, outgoingKnownIds, keepCompletion) {
    runtime.route = beforeSnapshot ? {
      ...beforeSnapshot,
      outgoingKnownIds,
      gate: null
    } : null;
    runtime.work.initial = true;
    runtime.work.backfill = false;
    runtime.work.completion = !!keepCompletion;
    setSessionPhase("switching", false);
  }
  function finishRouteTransition() {
    runtime.route = null;
  }
  function markInspectionDone(hasNodes) {
    if (hasNodes) runtime.work.initial = false;
    runtime.work.backfill = false;
  }
  function needsInspection() {
    return runtime.work.initial || runtime.work.backfill || runtime.work.completion || !!failedScanDraft || [...pendingFileResults.values()].some((job) => job.chatKey === currentChatKey) || [...completedRevisions].some(([id, generation]) => revisionTargets.get(id) === generation);
  }

  // src/ui/14-panel-components.js
  var PANEL_VIEWS = ["context", "budget", "details"];
  var UI_FIELDS = `
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
    return Object.fromEntries(UI_FIELDS.map((entry) => {
      const [field, override] = entry.split(":");
      const suffix = override || field.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
      const selector = field === "settingsDialog" ? ".cw-settings-dialog:not(.cw-about-dialog):not(.cw-limit-dialog):not(.cw-confirm-dialog)" : `.cw-${suffix}`;
      return [field, root.querySelector(selector)];
    }));
  }
  function refreshUiFields() {
    if (ui) Object.assign(ui, collectUiFields(ui.root));
  }
  var UI_HINTS = Object.freeze({
    "cw-tab-context": "Show text, files, images and their estimation settings.",
    "cw-tab-budget": "Show budget forecasts, usage percentages, limits and calibration.",
    "cw-tab-details": "Show and copy the detailed report for this chat.",
    "cw-pin-panel": "Keep the main panel open while clicking in ChatGPT. Click again to unpin.",
    "cw-mini-tab": "Open these settings without leaving the current view.",
    "cw-budget-editor": "Change Conservative, Normal and Generous budget limits.",
    "cw-copy-details": "Copy all figures from the detailed context report.",
    "cw-close-settings": "Close Settings; unsaved HANDOFF edits remain in this session, other drafts are discarded.",
    "cw-close-about": "Close the About window.",
    "cw-close-limit": "Cancel without recording a chat limit.",
    "cw-close-confirm": "Cancel this operation.",
    "cw-cancel-confirm": "Cancel this operation without changing data.",
    "cw-confirm-ok": "Confirm and carry out this operation.",
    "cw-cancel-limit": "Close the dialog without saving calibration.",
    "cw-confirm-limit": "Record this chat limit and recalibrate token budgets.",
    "cw-save-text-estimation": "Save the current text token estimation parameters.",
    "cw-reset-text-estimation": "Restore default text token coefficients and Message overhead.",
    "cw-save-attachments": "Save all Files & images settings, including metadata-only estimation.",
    "cw-reset-attachments": "Restore defaults for all Files & images settings.",
    "cw-save-attachment-coefficients": "Save file, image and pasted-text forecast weights.",
    "cw-reset-attachment-advanced": "Restore default attachment contribution coefficients.",
    "cw-save-budget": "Save Conservative, Normal and Generous budgets.",
    "cw-reset-budget": "Restore default token budgets; recorded samples remain for future calibration.",
    "cw-save-settings": "Save hidden-context allowances and strength for future calibration.",
    "cw-save-handoff": "Apply and save the edited HANDOFF prompt globally.",
    "cw-restore-handoff": "Restore the built-in HANDOFF text in the editor, without applying it until Save.",
    "cw-reset-settings": "Restore default technical parameters without clearing calibration history.",
    "cw-reset-position": "Restore the default mini-badge position.",
    "cw-reset-chat": "Reset Watchdog records for this chat only. Confirmation required.",
    "cw-clear-watchdog-data": "Delete every local Watchdog record and preference. Confirmation required.",
    "cw-rescan": "Read-only audit of messages currently visible in the chat.",
    "cw-copy-diagnostics": "Copy the latest diagnostics text to the clipboard.",
    "cw-export-ids": "Export known message UUIDs as a local TSV file.",
    "cw-repair-short": "Repair only confirmed incomplete ledger entries; requires confirmation.",
    "cw-undo-repair": "Undo the latest confirmed repair, if its records are unchanged.",
    "cw-performance-toggle": "Start or pause in-memory performance measurements.",
    "cw-performance-copy": "Copy the current in-memory performance metrics to the clipboard.",
    "cw-performance-reset": "Clear in-memory profiling counters, without modifying the ledger."
  });
  var DESTRUCTIVE_ACTIONS = /* @__PURE__ */ new Set(["cw-reset-chat", "cw-clear-watchdog-data", "cw-repair-short"]);
  var NORMAL_ACTIONS = /* @__PURE__ */ new Set([
    "cw-save-text-estimation",
    "cw-reset-text-estimation",
    "cw-save-attachments",
    "cw-reset-attachments",
    "cw-save-attachment-coefficients",
    "cw-reset-attachment-advanced",
    "cw-save-budget",
    "cw-reset-budget",
    "cw-save-settings",
    "cw-reset-settings",
    "cw-reset-position",
    "cw-copy-details",
    "cw-rescan",
    "cw-copy-diagnostics",
    "cw-export-ids",
    "cw-undo-repair",
    "cw-performance-toggle",
    "cw-performance-copy",
    "cw-performance-reset"
  ]);
  function setUiHint(node, text) {
    if (!node) return;
    if (node.dataset.cwTip !== text) node.dataset.cwTip = text;
    node.removeAttribute("title");
  }
  function registerUiHints(scope) {
    for (const node of scope.querySelectorAll("button, input, summary, .cw-field-caption")) {
      if (node.classList.contains("cw-tool-button") || node.classList.contains("cw-chip")) continue;
      const name = [...node.classList].find((cls) => UI_HINTS[cls]);
      let hint = node.getAttribute("title") || node.dataset.cwTip || (name ? UI_HINTS[name] : null);
      if (node.classList.contains("cw-mini-tab")) {
        const label = node.textContent.trim();
        if (label === "Text estimation") hint = "Estimate tokens in newly captured text and code.";
        else if (label === "Files & images") hint = "Configure file fallback, image size and parsing limits.";
        else if (label === "Attachment weights") hint = "Configure how files, images and pasted text affect forecasts.";
        else if (label === "Appearance") hint = "Change Watchdog style and theme immediately; preferences save automatically.";
        else if (label === "Technical") hint = "Edit hidden-context allowances, calibration strength and the global HANDOFF prompt.";
        else if (label === "Diagnostics") hint = "Audit, export and explicitly repair local Watchdog records.";
        else if (label === "Performance") hint = "View and control in-memory performance profiling.";
        else if (label === "Token budget & limits") hint = "View optimistic and pessimistic usage across all three budgets.";
        else if (label === "History & calibration") hint = "View recorded chat-limit samples and calibration summary.";
      }
      if (node.tagName === "INPUT" && !hint) {
        const label = node.closest("label");
        const caption = label?.querySelector(".cw-field-caption");
        hint = caption?.getAttribute("title") || caption?.dataset.cwTip || (label ? `Edit ${label.textContent.trim().replace(/\s+/g, " ")}.` : "Edit this numeric setting.");
      }
      if (node.tagName === "SUMMARY" && !hint) {
        hint = node.closest(".cw-handoff-editor") ? "Expand or collapse the global HANDOFF editor; unsaved text remains in this session." : `Expand or collapse ${node.textContent.trim()}.`;
      }
      if (!hint) continue;
      setUiHint(node, hint);
    }
  }
  function registerActionStyles(scope) {
    for (const node of scope.querySelectorAll("button")) {
      const dangerous = [...node.classList].some((name) => DESTRUCTIVE_ACTIONS.has(name));
      const normal = !dangerous && [...node.classList].some((name) => NORMAL_ACTIONS.has(name));
      node.classList.toggle("cw-danger-action", dangerous);
      node.classList.toggle("cw-text-action", normal);
    }
  }
  function prepareUiControls(scope) {
    registerActionStyles(scope);
    registerUiHints(scope);
  }
  function installUiHints(root) {
    const popup = document.createElement("div");
    popup.className = "cw-floating-tip";
    popup.setAttribute("role", "tooltip");
    popup.hidden = true;
    root.appendChild(popup);
    let target = null;
    let timer = 0;
    let suppressDraggedBadge = false;
    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = 0;
      target = null;
      popup.hidden = true;
    };
    const show = (node) => {
      if (!node?.isConnected || !node.getClientRects().length) return;
      if (node === ui?.chip && !ui.panel.hidden) return;
      popup.replaceChildren();
      if (node === ui?.chip && !ui.chip.style.borderColor) {
        popup.append("Click on ");
        const icon = ui.siteIcon.cloneNode(true);
        icon.classList.add("cw-tip-logo");
        popup.append(icon, " to open or close the panel");
      } else {
        popup.textContent = node.dataset.cwTip;
      }
      popup.hidden = false;
      const rect = node.getBoundingClientRect();
      const width = popup.getBoundingClientRect().width;
      const height = popup.getBoundingClientRect().height;
      const left = clamp(rect.left + rect.width / 2 - width / 2, 8, Math.max(8, window.innerWidth - width - 8));
      const top = rect.bottom + 7 + height <= window.innerHeight - 8 ? rect.bottom + 7 : Math.max(8, rect.top - height - 7);
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    };
    root.addEventListener("cw-badge-dragstart", () => {
      suppressDraggedBadge = true;
      hide();
    });
    root.addEventListener("mouseover", (event) => {
      const node = event.target.closest?.("[data-cw-tip]");
      if (!node || node === target || node === ui?.chip && suppressDraggedBadge) return;
      hide();
      target = node;
      timer = setTimeout(() => {
        timer = 0;
        if (target === node) show(node);
      }, 500);
    });
    root.addEventListener("mouseout", (event) => {
      if (suppressDraggedBadge && ui?.chip?.contains(event.target) && !ui.chip.contains(event.relatedTarget)) suppressDraggedBadge = false;
      if (target && !target.contains(event.relatedTarget)) hide();
    });
    root.addEventListener("focusin", (event) => {
      const node = event.target.closest?.("[data-cw-tip]");
      if (node?.matches(":focus-visible")) {
        hide();
        target = node;
        show(node);
      }
    });
    root.addEventListener("focusout", (event) => {
      if (target && target.contains(event.target)) hide();
    });
    root.addEventListener("click", hide, true);
  }

  // src/runtime/01-runtime-error-journal.js
  var MAX_RECENT_ERRORS = 15;
  var RECORDED_SOURCES = /* @__PURE__ */ new Set(["Wipe", "Export IDs", "UI"]);
  var ERROR_TYPES = /* @__PURE__ */ new Set([
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "QuotaExceededError",
    "NotAllowedError",
    "SecurityError",
    "InvalidStateError",
    "AbortError",
    "NotFoundError"
  ]);
  var ERROR_CONTEXT = Object.freeze({
    Wipe: "Watchdog data could not be fully cleared",
    "Export IDs": "Local UUID report could not be exported",
    UI: "Watchdog interface action could not be completed"
  });
  var recentErrors = [];
  var nextErrorNumber = 0;
  var errorRevision = 0;
  function recordUiError(source, error) {
    const safeSource = RECORDED_SOURCES.has(source) ? source : "UI";
    const name = error && typeof error.name === "string" ? error.name : "";
    const type = ERROR_TYPES.has(name) ? name : "UnknownError";
    const entry = Object.freeze({
      id: `E${String(++nextErrorNumber).padStart(2, "0")}`,
      at: Date.now(),
      source: safeSource,
      type,
      // A predefined explanation remains useful to copy without retaining any
      // arbitrary exception text that may contain a chat URL or user content.
      description: ERROR_CONTEXT[safeSource]
    });
    recentErrors.push(entry);
    if (recentErrors.length > MAX_RECENT_ERRORS) recentErrors.shift();
    errorRevision++;
    return entry.id;
  }
  function getRecentUiErrors() {
    return recentErrors.slice();
  }
  function getUiErrorRevision() {
    return errorRevision;
  }
  function clearUiErrors() {
    recentErrors.length = 0;
    errorRevision++;
  }

  // src/ui/16-panel-rendering.js
  function setTextIfChanged(node, value) {
    const next = String(value);
    if (node.textContent !== next) node.textContent = next;
  }
  function renderPerformance() {
    if (!ui || ui.performanceDetails?.hidden !== false || !ui.performanceLine || ui.panel.hidden) return;
    const time = (name) => {
      const t = perf.timings[name];
      if (!t) return "no samples";
      const sorted = [...t.recent || []].sort((a, b) => a - b);
      const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 0;
      return `${t.count} calls \xB7 avg ${(t.total / t.count).toFixed(2)} ms \xB7 p95(last ${sorted.length}) ${p95.toFixed(2)} ms \xB7 max ${t.max.toFixed(2)} ms`;
    };
    const lines = [
      `Profiling: ${perf.enabled ? "enabled" : "paused"} \xB7 RAM only`,
      `Mutation batches: ${perf.mutationBatches} \xB7 DOM records: ${perf.mutations}`,
      `Repeated text records coalesced: ${perf.duplicateTextMutations}`,
      `Observer callbacks: ${time("observerCallback")}`,
      `Stats calculations: ${time("stats")}`,
      `Queued events: ${perf.queuedEvents} \xB7 processed: ${perf.processedEvents}`,
      `Scans without changes: ${perf.noChangeScans}`,
      `Conversation scans: ${time("conversation")}`,
      `DOM collections: ${time("collect")}`,
      `File scans: ${time("files")}`,
      `Image scans: ${time("images")}`,
      `localStorage reads: ${time("storageRead")}`,
      `Ledger loads: ${time("ledgerLoad")}`,
      `Ledger JSON.parse: ${time("ledgerParse")}`,
      `JSON.stringify: ${time("storageEncode")}`,
      `Storage setItem: ${time("storageCommit")}`,
      `JSON saves (total): ${time("storageWrite")}`
    ];
    setTextIfChanged(ui.performanceLine, lines.join("\n"));
    setTextIfChanged(ui.performanceToggle, perf.enabled ? "Pause profiling" : "Enable profiling");
    setUiHint(ui.performanceToggle, perf.enabled ? "Pause in-memory performance measurements." : "Start in-memory performance measurements.");
  }
  function render(state = loadState(), metrics = null, budgets = null) {
    ensureUiReady();
    const s = metrics || stats(state);
    const eb = budgets || effectiveBudgets();
    const panelNeedsDerived = !ui.panel.hidden && !ui.settingsDialog?.open && !ui.aboutDialog?.open && !ui.limitDialog?.open && !ui.confirmDialog?.open;
    const needsDerived = !isWatchdogPaused() || panelNeedsDerived;
    const derived = needsDerived ? (() => {
      const confirmed = hasConfirmedContext(state);
      return { confirmed, status: budgetStatus(s, eb, confirmed) };
    })() : null;
    renderBadge(s, eb, state, derived);
    renderRunState();
    const problem = storageProblem();
    ui.storageWarning.hidden = !problem;
    ui.storageIndicator.hidden = !problem;
    ui.chip.style.borderColor = problem ? "#dc2626" : "";
    if (problem) setTextIfChanged(ui.storageWarning, problem);
    setUiHint(ui.chip, problem || "Click the Watchdog logo to open or close the panel");
    if (ui.panel.hidden) return;
    if (ui.settingsDialog?.open || ui.aboutDialog?.open || ui.limitDialog?.open || ui.confirmDialog?.open) {
      if (ui.settingsDialog?.open && ui.diagnosticsDetails?.hidden === false && ui.diagnosticsDetails.dataset.mounted === "true") renderDiagnostics(s, state);
      return;
    }
    updateBudgetTabStatus(s, eb, state, derived);
    if (activePanelView === "context") renderContext(s, state, derived);
    if (activePanelView === "budget") {
      renderBudgetForecast(s, eb, state, derived);
      renderBudgetStatus(s, eb, state, derived);
      if (ui.historyDetails?.hidden === false && ui.historyDetails.dataset.mounted === "true")
        renderHistory(eb);
    }
    if (activePanelView === "details") renderDetails(s, eb, state, derived);
  }
  function renderRunState() {
    if (!ui) return;
    const forced = !isChatAvailable();
    const paused = isWatchdogPaused();
    const tip = forced ? "Available in chats only" : paused ? "Resume Watchdog" : "Pause Watchdog";
    ui.pauseToggle.disabled = forced;
    ui.pauseToggle.dataset.cwPlaying = String(!paused);
    ui.pauseToggle.setAttribute("aria-label", tip);
    setUiHint(ui.pauseToggle, tip);
    setUiHint(ui.pauseControl, tip);
    for (const control of [ui.rescan, ui.endChat]) {
      if (control) control.disabled = paused;
    }
    for (const control of [ui.repairShort, ui.undoRepair]) {
      if (control) control.disabled = paused || control.hidden;
    }
    if (paused) {
      ui.average.hidden = true;
      ui.chipStatus.hidden = true;
      ui.pausedLabel.hidden = false;
      ui.chip.dataset.cwBadgeMode = "paused";
    } else if (ui.chip.dataset.cwBadgeMode === "paused") {
      ui.average.hidden = true;
      ui.chipStatus.hidden = true;
      ui.pausedLabel.hidden = true;
      ui.chip.dataset.cwBadgeMode = "minimal";
    }
  }
  function hasConfirmedContext(state) {
    if (!state || !currentChatKey || state.chatKey !== currentChatKey || runtime.route) return false;
    if (Object.keys(state.messages || {}).length > 0) return true;
    if (Object.values(state.files || {}).some((file) => !!file?.messageId)) return true;
    return Object.values(state.domImages || {}).some((image) => !!image?.messageId);
  }
  function renderBadge(s, eb, state = null, derived = null) {
    if (!ui) return;
    if (isWatchdogPaused()) {
      renderRunState();
      return;
    }
    const ownLedger = derived ? derived.confirmed : hasConfirmedContext(state);
    ui.pausedLabel.hidden = true;
    ui.average.hidden = !ownLedger;
    ui.chipStatus.hidden = !ownLedger;
    ui.chip.dataset.cwBadgeMode = ownLedger ? "normal" : "minimal";
    if (!ownLedger) return;
    const mean = (s.optimistic + s.pessimistic) / 2;
    setTextIfChanged(ui.average, `\u2248 ${compactK(mean)}k`);
    const level = (derived ? derived.status : budgetStatus(s, eb)).level;
    if (ui.chipStatus.dataset.level !== level) ui.chipStatus.dataset.level = level;
  }
  function formatDetailedTokens(n) {
    return formatScaledTokens(n, 1);
  }
  function formatFullNumber(n) {
    return Math.round(Number(n) || 0).toLocaleString("en-US");
  }
  function attachmentLabels(s) {
    const fileCount = s.knownFileCount || 0;
    const fileBytes = s.totalFileBytes || 0;
    const unknownSize = s.unknownSizeFiles || 0;
    const fileSizeText = fileBytes > 0 ? formatBytes(fileBytes) : "size unknown";
    const unknownSizeSuffix = fileBytes > 0 && unknownSize ? ` \xB7 +${unknownSize} unknown size` : "";
    const coverage = [
      `${s.parsedFiles || 0} parsed`,
      `${s.unparsedFiles || 0} unparsed`,
      `${s.autoPasteMinimumFiles || 0} auto-paste`,
      `${s.reactMetadataFiles || 0} React metadata`,
      `${s.metadataFiles || 0} metadata-only`
    ];
    return {
      files: fileCount ? `${fileCount} \xB7 ${fileSizeText}${unknownSizeSuffix}` : "none",
      coverage: coverage.slice(0, 3).join(" \xB7 "),
      coverageExtra: coverage.slice(3).join(" \xB7 ")
    };
  }
  function renderContext(s, state, derived = null) {
    setTextIfChanged(ui.dataChars, formatFullNumber(s.chars));
    setTextIfChanged(ui.dataTokens, `\u2248 ${formatDetailedTokens(s.tokens)}`);
    setTextIfChanged(ui.contextMessages, `${formatFullNumber(s.turns)} \xB7 user ${formatFullNumber(s.userTurns)} / AI ${formatFullNumber(s.assistantTurns)}`);
    setTextIfChanged(ui.contextRange, (derived ? derived.confirmed : hasConfirmedContext(state)) ? `\u2248 ${formatDetailedTokens((s.optimistic + s.pessimistic) / 2)} tokens` : "None");
    const labels = attachmentLabels(s);
    setTextIfChanged(ui.dataFiles, labels.files);
    setTextIfChanged(ui.dataQuality, labels.coverage);
    setTextIfChanged(ui.dataQualityExtra, labels.coverageExtra);
    const images = s.knownImages || 0;
    setTextIfChanged(ui.dataImages, images ? `${images} \xB7 \u2248 ${formatDetailedTokens(s.knownImageTokens || 0)} tokens` : "none");
  }
  function updateBudgetTabStatus(s, eb, state = loadState(), derived = null) {
    const status = derived ? derived.status : budgetStatus(s, eb, hasConfirmedContext(state));
    if (ui.budgetTabMark.dataset.level !== status.level) ui.budgetTabMark.dataset.level = status.level;
    const label = `Budget forecast: ${status.label}`;
    if (ui.budgetTab.getAttribute("aria-label") !== label) ui.budgetTab.setAttribute("aria-label", label);
  }
  function renderBudgetForecast(s, eb, state = loadState(), derived = null) {
    const available = derived ? derived.confirmed : hasConfirmedContext(state);
    ui.budgetUnavailable.hidden = available;
    ui.forecastHeading.hidden = !available;
    ui.forecastCards.hidden = !available;
    for (const group of ui.budgetView.querySelectorAll(".cw-forecast-group")) {
      group.hidden = !available;
    }
    if (!available) return;
    setTextIfChanged(ui.forecastOpt, `\u2248 ${formatDetailedTokens(s.optimistic)}`);
    setTextIfChanged(ui.forecastPess, `\u2248 ${formatDetailedTokens(s.pessimistic)}`);
    const variants = [
      ["Opt", s.optimistic],
      ["Pess", s.pessimistic]
    ];
    const budgets = [["C", eb.conservative], ["N", eb.normal], ["O", eb.optimistic]];
    for (const [variant, value] of variants) {
      for (const [key, budget] of budgets) {
        const pct = percentOf(value, budget);
        const label = ui[`percent${variant}${key}`];
        setTextIfChanged(label, `${pct}%`);
        const bar = ui[`progress${variant}${key}`];
        const fill = Math.max(0, Math.min(100, pct));
        const width = `${fill}%`;
        const color = pct > 100 ? "rgb(239, 68, 68)" : "";
        if (bar.style.width !== width) bar.style.width = width;
        if (bar.style.backgroundColor !== color) bar.style.backgroundColor = color;
        const onFill = fill >= 35;
        const labelLeft = onFill ? "0%" : width;
        const labelWidth = `${onFill ? fill : 100 - fill}%`;
        if (label.style.left !== labelLeft) label.style.left = labelLeft;
        if (label.style.width !== labelWidth) label.style.width = labelWidth;
        const ink = String(onFill);
        if (label.dataset.cwOnFill !== ink) label.dataset.cwOnFill = ink;
      }
    }
  }
  function buildDetailGroups(s, eb, showForecast = true) {
    const number = (n) => Number.isFinite(n) ? formatFullNumber(n) : "none";
    const estimate = (n) => Number.isFinite(n) ? `\u2248 ${number(n)} tokens` : "none";
    const range = (low, high) => Number.isFinite(low) && Number.isFinite(high) ? low === high ? number(low) : `${number(low)}\u2013${number(high)}` : "none";
    const rangeTokens = (low, high) => {
      const value = range(low, high);
      return value === "none" ? value : `${value} tokens`;
    };
    const budgetUsage = (budget) => showForecast && Number.isFinite(budget) && budget > 0 && Number.isFinite(s.optimistic) && Number.isFinite(s.pessimistic) ? `${range(s.optimistic, s.pessimistic)} / ${number(budget)} tokens` : "none";
    return [
      [
        `Messages: ${number(s.turns)} total`,
        `Roles: ${number(s.userTurns)} user \xB7 ${number(s.assistantTurns)} assistant \xB7 ${number(s.otherTurns)} other`,
        `Message length: ${number(s.chars)} characters`,
        `Messages with UUID: ${number(s.uuidMessages)}`
      ],
      [
        `Files: ${number(s.knownFileCount)}`,
        `Known size: ${s.totalFileBytes > 0 ? `${number(s.totalFileBytes)} bytes` : "none"}`,
        `Unknown size: ${number(s.unknownSizeFiles)} files`,
        `Parsed: ${number(s.parsedFiles)} \xB7 Metadata-only: ${number(s.metadataFiles)} \xB7 Unparsed: ${number(s.unparsedFiles)}`,
        `React metadata: ${number(s.reactMetadataFiles)} files`,
        `Auto-paste minimum: ${number(s.autoPasteMinimumFiles)} files`,
        `Auto-paste assumed text: ${number(s.autoPasteMinimumChars)} characters`,
        `Fully read: ${number(s.fullyReadTextFiles)} files`,
        `Sampled: ${number(s.sampledTextFiles)} files`,
        `Parsed file estimate: ${estimate(s.knownFileTokens)}`,
        "Parsed file estimate is weighted in the forecast; no age-based reduction."
      ],
      [
        `Effective images: ${number(s.knownImages)}`,
        `Locally captured: ${number(s.capturedImages)} images`,
        `Found in history: ${number(s.historicalImages)} images`,
        `Raw image estimate: ${estimate(s.knownImageTokens)}`,
        "Effective count is deduplicated. Tokens before weighting."
      ],
      [
        `Message text: ${estimate(s.tokens)}`,
        `Files: ${rangeTokens(s.fileOptimistic, s.filePessimistic)}`,
        `Images: ${rangeTokens(s.imageOptimistic, s.imagePessimistic)}`,
        `Hidden context: ${rangeTokens(settings.hiddenOptimistic, settings.hiddenPessimistic)}`,
        `Total context: ${showForecast ? rangeTokens(s.optimistic, s.pessimistic) : "none"}`,
        showForecast ? "Ranges: optimistic\u2013pessimistic." : "No context estimate yet."
      ],
      [
        `Conservative: ${budgetUsage(eb.conservative)}`,
        `Normal: ${budgetUsage(eb.normal)}`,
        `Generous: ${budgetUsage(eb.optimistic)}`,
        showForecast ? "Estimated usage / context budget." : "No context estimate yet."
      ]
    ];
  }
  function isDetailLegend(groupIndex, lineIndex, lineCount) {
    return groupIndex > 0 && lineIndex === lineCount - 1;
  }
  function copyableDetailText(groups) {
    return groups.map((lines, groupIndex) => lines.filter((lineText, lineIndex) => !isDetailLegend(groupIndex, lineIndex, lines.length)).join("\n")).join("\n\n");
  }
  function renderDetails(s, eb, state, derived = null) {
    const groups = buildDetailGroups(s, eb, derived ? derived.confirmed : hasConfirmedContext(state));
    while (ui.detailsReport.children.length < groups.length) {
      const group = document.createElement("div");
      group.className = "cw-detail-group";
      ui.detailsReport.appendChild(group);
    }
    while (ui.detailsReport.children.length > groups.length) ui.detailsReport.lastElementChild.remove();
    for (const [index, lines] of groups.entries()) {
      const container = ui.detailsReport.children[index];
      while (container.children.length < lines.length) container.appendChild(document.createElement("div"));
      while (container.children.length > lines.length) container.lastElementChild.remove();
      for (const [line, value] of lines.entries()) {
        const row = container.children[line];
        row.classList.toggle("cw-detail-legend", isDetailLegend(index, line, lines.length));
        setTextIfChanged(row, value);
      }
    }
  }
  function formatAuditExample(example) {
    const x = example;
    const reason = x.reasons?.length ? ` [reason ${x.reasons.join("+")}; chars \u0394${(x.domChars ?? 0) - (x.storedChars ?? 0)}; tokens ${x.storedTokens ?? "-"}\u2192${x.domTokens ?? "-"} (\u0394${(x.domTokens ?? 0) - (x.storedTokens ?? 0)}); hash ${x.fingerprintStatus}; DOM prose/code ${x.proseChars ?? "-"}/${x.codeChars ?? "-"}]` : "";
    const scope = x.scope ? ` [${x.scope}\xD7${x.roots}]` : "";
    return `${x.kind} ${x.idSuffix} ${x.storedChars ?? "-"}\u2192${x.domChars ?? "-"}${reason}${scope}`;
  }
  function formatAuditDiagnostics(audit) {
    if (!audit) return "AUDIT not run (click Audit; only rendered messages checked)";
    const scopes = audit.scopeCounts;
    const lines = [
      `AUDIT ${new Date(audit.at).toLocaleTimeString()} (${audit.visible} unique / ${audit.raw} raw DOM, read-only${audit.routeUnverified ? ", ROUTE UNVERIFIED" : ""}): ${audit.verified} verified, ${audit.missing} missing, ${audit.storedShort} short stored, ${audit.domShort} short DOM, ${audit.different} different, ${audit.roleChanged} role mismatch, ${audit.noStableId} no ID, ${audit.ambiguous} ambiguous, ${audit.collapsed} merged views, ${audit.unhydrated} unhydrated, ${audit.duplicateIds} duplicate after merge`,
      `Audit repair: ${audit.eligibleRepairs?.length || 0} confirmed, ${audit.repairRepeatNeeded || 0} need a repeat Audit; manual confirmation only`,
      `Audit units: user ${audit.unitRoles?.user || 0}, assistant ${audit.unitRoles?.assistant || 0}, real UUIDs ${audit.unitRoles?.realIds || 0}`,
      `Audit text scopes: unit-user ${scopes["unit-user"]}, unit-user-text ${scopes["unit-user-text"]}, unit-markdown ${scopes["unit-markdown"]}, unit-assistant ${scopes["unit-assistant"]}; fallback ${scopes.fallback} \xB7 content roots ${audit.contentRoots}`
    ];
    if (audit.different) {
      lines.push(`Audit different reasons: chars ${audit.differenceReasons.chars}, tokens ${audit.differenceReasons.tokens}, fingerprint ${audit.differenceReasons.fingerprint} (hash-only ${audit.differenceReasons.hashOnly}); categories can overlap`);
    }
    if (audit.examples.length) {
      lines.push(`Audit samples: ${audit.examples.map(formatAuditExample).join("; ")}`);
    }
    return lines.join("\n");
  }
  function renderRecentErrors() {
    if (!ui?.recentErrorsList) return;
    const target = ui.recentErrorsList;
    const revision = String(getUiErrorRevision());
    if (target.dataset.cwErrorRevision === revision) return;
    const entries = getRecentUiErrors();
    if (!entries.length) {
      target.textContent = "No errors recorded. All good.";
    } else {
      const lines = entries.slice().reverse().map((entry) => {
        const node = document.createElement("div");
        node.className = "cw-recent-error-entry";
        const time = new Date(entry.at).toLocaleTimeString();
        node.textContent = `${entry.id} \xB7 ${entry.source} \xB7 ${entry.type} \xB7 ${time} \xB7 ${entry.description}`;
        return node;
      });
      target.replaceChildren(...lines);
    }
    target.dataset.cwErrorRevision = revision;
  }
  function renderDiagnostics(s, state, signal = lastUiSignals) {
    renderRecentErrors();
    const yn = (value) => value === null ? "?" : value ? "yes" : "no";
    const error = storageProblem();
    const commitLine = lastCommit ? `last commit ${new Date(lastCommit.at).toLocaleTimeString()}: +${lastCommit.added} new, ${lastCommit.changed} changed, ${lastCommit.unchanged} unchanged (counted user ${lastCommit.user}, AI ${lastCommit.assistant}, other ${lastCommit.other}) \xB7 ${lastScanReason}` : "last commit: none";
    const auditLine = formatAuditDiagnostics(lastAudit);
    const eligible = lastAudit?.eligibleRepairs?.length || 0;
    ui.repairShort.hidden = eligible === 0;
    ui.repairShort.disabled = eligible === 0 || isWatchdogPaused();
    if (eligible) setTextIfChanged(ui.repairShort, `Repair confirmed (${eligible})`);
    const lastRepair = state.repairHistory?.at(-1);
    const canUndo = Boolean(lastRepair?.id && lastRepair.before && lastRepair.after && JSON.stringify(state.messages?.[lastRepair.id]) === JSON.stringify(lastRepair.after));
    ui.undoRepair.hidden = !canUndo;
    ui.undoRepair.disabled = !canUndo || isWatchdogPaused();
    const session = sessionDiagnosticsSnapshot();
    const gate = session.gate;
    setTextIfChanged(
      ui.diagnosticsLine,
      `${s.turns} stored (user ${s.userTurns}, AI ${s.assistantTurns}, other ${s.otherTurns}) \xB7 ${collectorState.visible} visible / ${collectorState.raw} raw
Collector: ${collectorState.collapsed} merged, ${collectorState.ambiguous} ambiguous IDs, ${collectorState.noLayout} no-layout skipped
${collectorState.name} \xB7 ${session.phase} \xB7 pending ${yn(session.completion)} \xB7 initial ${yn(session.initial)}
Stop ${yn(signal.stop)} \xB7 Send ${yn(signal.send)} \xB7 actions ${yn(signal.actions)}
IDs: UUID ${s.uuidMessages}, unambiguous-only; unsupported IDs skipped
Auto-paste: ${s.autoPasteMinimumFiles || 0} inferred minimums (\u2265${s.autoPasteMinimumChars || 0} chars total; text not read)
User-only attachments: ${s.knownFileCount || 0} files` + (error ? `
STORAGE ERROR: ${error}` : "") + (session.routePending && gate ? `
Route gate: ${gate.reason}; UUIDs ${gate.visible}, destination-known ${gate.destinationKnown}, outgoing-only ${gate.outgoingOnly}, old nodes ${gate.outgoingMounted}, shared ${gate.shared}` : "") + `
${commitLine} \xB7 first-seen backfill, write-once, revision targets ${revisionTargets.size}, deferred ${lastBackfillDeferred}, hydration pending ${hydrationCandidates.size}
${auditLine}
${currentChatKey || "awaiting chat UUID"}`
    );
  }
  function renderBudgetStatus(s, eb, state = loadState(), derived = null) {
    const status = derived ? derived.status : budgetStatus(s, eb, hasConfirmedContext(state));
    setTextIfChanged(ui.status, status.label);
    ui.status.style.color = status.color;
  }
  function renderHistory(eb) {
    const hs = historyStats();
    const average = (value) => hs.n && Number.isFinite(value) ? `${formatFullNumber(value)} tokens` : "none";
    const weight = Number.isFinite(eb.historyWeight) ? eb.historyWeight.toFixed(2) : "none";
    setTextIfChanged(ui.history, [
      `Recorded limit samples: ${hs.n}`,
      `Average message text: ${average(hs.avgSeen)}`,
      `Average optimistic context: ${average(hs.avgOptimistic)}`,
      `Average pessimistic context: ${average(hs.avgPessimistic)}`,
      `Calibration weight: ${weight}`
    ].join("\n"));
    ui.history.removeAttribute("title");
  }
  function clearTransientNotification() {
    clearTimeout(showToast._timer);
    showToast._timer = null;
    if (!ui) return;
    if (ui.toast) ui.toast.hidden = true;
    if (ui.dialogMessage) {
      ui.dialogMessage.hidden = true;
      ui.dialogMessage.removeAttribute("title");
    }
  }
  function showToast(text, ms = 4500, severity = null) {
    ensureUiReady();
    clearTimeout(showToast._timer);
    const currentUi = ui;
    currentUi.toast.textContent = text;
    currentUi.toast.dataset.cwNoticeLevel = severity || (/\b(error|failed|failure|unavailable|corrupt|refused|cannot|incomplete)\b|could not/i.test(text) ? "error" : "info");
    currentUi.toast.hidden = false;
    if (currentUi.dialogMessage) {
      const settingsVisible = Boolean(currentUi.settingsDialog?.open) && !currentUi.confirmDialog?.open;
      if (settingsVisible) {
        const okAudit = /^Audit: (\d+) verified, no detected issues in rendered messages\.$/.exec(text);
        setTextIfChanged(
          currentUi.dialogMessage,
          okAudit ? `Audit OK \xB7 ${okAudit[1]} verified` : text
        );
        currentUi.dialogMessage.title = text;
        currentUi.dialogMessage.hidden = false;
      } else {
        currentUi.dialogMessage.hidden = true;
        currentUi.dialogMessage.removeAttribute("title");
      }
    }
    showToast._timer = setTimeout(() => {
      if (ui !== currentUi) return;
      clearTransientNotification();
    }, ms);
  }
  function showUnexpectedError(source, error, summary = "Operation failed") {
    const reference = recordUiError(source, error);
    renderRecentErrors();
    showToast(`${summary} \xB7 ${reference}`, 4500, "error");
    return reference;
  }
  function insertIntoComposer(text) {
    const textarea = document.querySelector("textarea#prompt-textarea") || document.querySelector('textarea[data-testid="prompt-textarea"]');
    if (textarea) {
      if (textarea.value.length > 0) return "occupied";
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )?.set;
      if (setter) setter.call(textarea, text);
      else textarea.value = text;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
      textarea.focus();
      return "inserted";
    }
    const editable = document.querySelector('#prompt-textarea[contenteditable="true"]') || document.querySelector('[contenteditable="true"][data-testid="prompt-textarea"]') || document.querySelector('form [contenteditable="true"]');
    if (editable) {
      if (editable.textContent?.length || editable.querySelector(
        'img, video, audio, canvas, [contenteditable="false"], [data-type="image"], [data-type="file"], [data-testid*="attachment"]'
      )) return "occupied";
      editable.focus();
      const range = document.createRange();
      range.selectNodeContents(editable);
      range.deleteContents();
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (i) editable.appendChild(document.createElement("br"));
        editable.appendChild(document.createTextNode(line));
      });
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text
        })
      );
      return "inserted";
    }
    return "missing";
  }
  async function copyFallback(text, reason = "missing") {
    const draftPresent = reason === "occupied";
    try {
      await navigator.clipboard.writeText(text);
      showToast(draftPresent ? "Your draft was left untouched. HANDOFF prompt copied to clipboard." : "Composer not detected. HANDOFF prompt copied to clipboard instead.");
    } catch {
      showToast(draftPresent ? "Draft left untouched; clipboard write failed. Allow clipboard access and try again." : "Composer not detected and clipboard write failed. Open the panel after the composer appears.");
    }
  }

  // src/attachments/06-attachment-reading.js
  async function estimateFileTokens(file, canContinue = () => true) {
    const ext = getFileExt(file.name);
    if (isImageFile(file)) {
      return {
        tokens: Math.max(1, Math.round(settings.averageImageTokens)),
        method: "image-average",
        detail: `${Math.round(file.size / 1024)} KiB`
      };
    }
    if (isTextLikeExt(ext) || (file.type || "").startsWith("text/")) {
      const parsingLimitMiB = Math.min(
        MAX_LOCAL_FILE_MIB,
        Math.max(0, Number(settings.localFileParsingLimitMiB ?? RECOMMENDED_LOCAL_FILE_MIB))
      );
      if (parsingLimitMiB === 0 || file.size > parsingLimitMiB * 1024 * 1024) {
        return {
          tokens: 0,
          method: "too-large",
          metadataOnly: true,
          detail: `>${parsingLimitMiB} MiB local limit`
        };
      }
      const sampleBytes = 10 * 1024 * 1024;
      if (file.size <= sampleBytes) {
        const text = await file.text();
        if (!canContinue()) return null;
        return { tokens: estimateProseTokens(text), method: "text" };
      }
      const bytes = await file.slice(0, sampleBytes).arrayBuffer();
      if (!canContinue()) return null;
      const sample = new TextDecoder("utf-8").decode(bytes, { stream: true });
      const observed = bytes.byteLength;
      if (!observed) return {
        tokens: 0,
        method: "text-extrapolated",
        detail: "Empty text sample"
      };
      const sampleTokens = estimateProseTokens(sample);
      const estimated = Math.max(0, Math.round(sampleTokens * file.size / observed));
      return {
        tokens: estimated,
        method: "text-extrapolated",
        detail: `First 10 MiB sampled; ${Math.round(file.size / (1024 * 1024))} MiB total (estimated)`
      };
    }
    return {
      tokens: 0,
      metadataOnly: true,
      method: "metadata-size",
      detail: `${Math.round(file.size / 1024)} KiB`
    };
  }
  var LOCAL_FILE_SELECTION_WINDOW_MS = 15 * 60 * 1e3;
  var pausedFileJobs = /* @__PURE__ */ new Map();
  function cancelPausedFileJobs(chatKey = null) {
    for (const [key, job] of pausedFileJobs) {
      if (chatKey === null || job.chatKey === chatKey) pausedFileJobs.delete(key);
    }
  }
  function resumePausedFileJobs() {
    if (isWatchdogPaused()) return;
    for (const [key, job] of pausedFileJobs) {
      if (resetEpoch(job.chatKey) !== job.epoch || corruptLedgerKeys.has(job.chatKey)) {
        pausedFileJobs.delete(key);
        continue;
      }
      const reading = loadState(job.chatKey).files[job.fileKey];
      if (!reading || reading.status !== "reading" || reading.messageId !== job.messageId || reading.name !== job.file.name || reading.size !== job.file.size) {
        pausedFileJobs.delete(key);
        continue;
      }
      Promise.resolve(rememberSentFile(
        job.file,
        job.source,
        job.chatKey,
        job.messageId,
        (committed) => {
          if (committed && pausedFileJobs.get(key) === job) pausedFileJobs.delete(key);
        },
        job.result
      )).catch(() => {
        console.warn("[Context Watchdog] deferred file resumption failed");
      });
    }
  }
  function hasFileCard(scope, expected, composer = null) {
    for (const node of scope.querySelectorAll(
      '[title], [aria-label], [data-testid*="attachment"], [data-testid*="file"]'
    )) {
      if (!isVisibleChatElement(node)) continue;
      if (node.closest?.('[contenteditable="true"], textarea')) continue;
      if (composer && node.closest?.("form") && node.closest("form") !== composer) continue;
      const labels = [
        node.getAttribute("title"),
        node.getAttribute("aria-label"),
        node.textContent?.length <= 180 ? node.textContent : ""
      ];
      if (labels.some((label) => normalizeFileName(label) === expected)) return true;
    }
    return false;
  }
  function composerContainsFile(composer, filename) {
    const expected = normalizeFileName(filename);
    if (!expected || !isVisibleChatElement(composer)) return false;
    if (hasFileCard(composer, expected)) return true;
    const background = composer.closest("#composer-background");
    return !!background && isVisibleChatElement(background) && hasFileCard(background, expected, composer);
  }
  function submittedLocalFiles(composer) {
    if (isWatchdogPaused()) return;
    const now = Date.now();
    for (let i = pendingLocalFiles.length - 1; i >= 0; i--) {
      const item = pendingLocalFiles[i];
      if (item.used || item.chatKey !== currentChatKey || now - item.selectedAt > LOCAL_FILE_SELECTION_WINDOW_MS || now - item.selectedAt < 0) {
        pendingLocalFiles.splice(i, 1);
        continue;
      }
      if (!composerContainsFile(composer, item.file.name)) {
        pendingLocalFiles.splice(i, 1);
        continue;
      }
      item.submittedAt = now;
    }
  }
  function stageLocalFile(file, source) {
    if (isWatchdogPaused()) return;
    if (!file?.name) return;
    const chatKey = currentChatKey;
    const identity = `${getFileKey(file)}|${chatKey || "new-chat"}`;
    if (pendingLocalFiles.some((p) => p.identity === identity && !p.used)) return;
    const existingMessageIds = new Set(Object.keys(loadState(chatKey).messages));
    for (const id of structuralMessageIds(collectMessageNodes().nodes)) {
      existingMessageIds.add(id);
    }
    pendingLocalFiles.push({
      file,
      source,
      chatKey,
      identity,
      used: false,
      existingMessageIds,
      selectedAt: Date.now(),
      submittedAt: 0,
      boundMessageId: null,
      boundEpoch: null
    });
    while (pendingLocalFiles.length > 16) pendingLocalFiles.shift();
  }
  function retryPendingFileResults(chatKey) {
    if (isWatchdogPaused()) return;
    for (const [jobKey, job] of pendingFileResults) {
      if (job.chatKey !== chatKey) continue;
      if (resetEpoch(chatKey) !== job.epoch || corruptLedgerKeys.has(chatKey)) {
        pendingFileResults.delete(jobKey);
        continue;
      }
      const latest = loadState(chatKey);
      const reading = latest.files[job.fileKey];
      if (!reading || reading.status !== "reading" || reading.messageId !== job.messageId || reading.name !== job.name || reading.size !== job.size) {
        pendingFileResults.delete(jobKey);
        continue;
      }
      latest.files[job.fileKey] = { ...reading, ...job.result };
      if (saveState(latest)) {
        pendingFileResults.delete(jobKey);
        if (![...pendingFileResults.values()].some((item) => item.chatKey === chatKey)) {
          storageFailures.delete(chatKey);
          setStorageWarningShown(false);
        }
        if (currentChatKey === chatKey) render(latest);
      }
    }
  }
  async function rememberSentFile(file, source, chatKey, messageId, onReadingCommitted = () => {
  }, preparedResult = null) {
    if (isWatchdogPaused()) {
      onReadingCommitted(false);
      return;
    }
    if (!file?.name || !chatKey || !messageId) {
      onReadingCommitted(false);
      return;
    }
    const key = `sent-file:${hash32(`${messageId}|${getFileKey(file)}`)}`;
    const state = loadState(chatKey);
    if (corruptLedgerKeys.has(chatKey)) {
      onReadingCommitted(false);
      return;
    }
    const candidates = Object.keys(state.files).filter((k) => {
      const entry = state.files[k];
      return entry?.messageId === messageId && entry?.metadataOnly && normalizeFileName(entry.name) === normalizeFileName(file.name) && fileSizesCompatible(entry.size, file.size);
    });
    const candidateKey = candidates.length === 1 ? candidates[0] : null;
    const prior = candidateKey && candidateKey !== key ? state.files[candidateKey] : {};
    const previous = { ...prior, ...state.files[key] || {} };
    if (previous.status === "ready" && !previous.metadataOnly) {
      onReadingCommitted(true);
      return;
    }
    if (candidateKey && candidateKey !== key) delete state.files[candidateKey];
    state.files[key] = {
      ...previous,
      name: file.name,
      size: file.size,
      type: file.type || "",
      lastModified: file.lastModified || 0,
      source,
      messageId,
      metadataOnly: false,
      method: "",
      status: "reading",
      tokens: previous.tokens || 0,
      addedAt: previous.addedAt || Date.now(),
      lastSeenAt: Date.now()
    };
    if (!saveState(state)) {
      onReadingCommitted(false);
      if (currentChatKey === chatKey) render(loadState());
      return;
    }
    onReadingCommitted(true);
    if (currentChatKey === chatKey) render(state);
    const startedEpoch = resetEpoch(chatKey);
    ledgerResetEpochs.set(chatKey, startedEpoch);
    const stillReading = (latest) => resetEpoch(chatKey) === startedEpoch && latest.files[key]?.status === "reading";
    try {
      const result = preparedResult || await estimateFileTokens(
        file,
        () => !isWatchdogPaused() && resetEpoch(chatKey) === startedEpoch
      );
      if (resetEpoch(chatKey) !== startedEpoch) return;
      if (isWatchdogPaused() || result === null) {
        pausedFileJobs.set(`${chatKey}|${key}`, {
          file,
          fileKey: key,
          source,
          chatKey,
          messageId,
          epoch: startedEpoch,
          result
        });
        return;
      }
      const latest = loadState(chatKey);
      if (corruptLedgerKeys.has(chatKey) || !stillReading(latest)) return;
      latest.files[key] = {
        ...latest.files[key] || state.files[key],
        tokens: Number(result.tokens) || 0,
        method: result.method || "unknown",
        detail: result.detail || "",
        metadataOnly: Boolean(result.metadataOnly),
        status: result.method === "error" ? "error" : "ready",
        lastSeenAt: Date.now()
      };
      const resultEntry = { ...latest.files[key] };
      if (saveState(latest)) {
        if (currentChatKey === chatKey) render(latest);
      } else if (resetEpoch(chatKey) === startedEpoch) {
        pendingFileResults.set(`${chatKey}|${key}`, {
          chatKey,
          fileKey: key,
          messageId,
          name: file.name,
          size: file.size,
          epoch: startedEpoch,
          result: resultEntry
        });
      }
    } catch (err) {
      if (resetEpoch(chatKey) !== startedEpoch) return;
      if (isWatchdogPaused()) {
        pausedFileJobs.set(`${chatKey}|${key}`, {
          file,
          fileKey: key,
          source,
          chatKey,
          messageId,
          epoch: startedEpoch,
          result: {
            tokens: 0,
            method: "error",
            detail: "Local file estimation failed",
            metadataOnly: false
          }
        });
        return;
      }
      const latest = loadState(chatKey);
      if (corruptLedgerKeys.has(chatKey) || !stillReading(latest)) return;
      latest.files[key] = {
        ...latest.files[key] || state.files[key],
        status: "error",
        method: "error",
        detail: "Local file estimation failed",
        lastSeenAt: Date.now()
      };
      const errorEntry = { ...latest.files[key] };
      if (saveState(latest)) {
        if (currentChatKey === chatKey) render(latest);
      } else if (resetEpoch(chatKey) === startedEpoch) {
        pendingFileResults.set(`${chatKey}|${key}`, {
          chatKey,
          fileKey: key,
          messageId,
          name: file.name,
          size: file.size,
          epoch: startedEpoch,
          result: errorEntry
        });
      }
      console.warn("[Context Watchdog] local file estimate failed");
    }
  }
  function handleFiles(files, source) {
    for (const file of Array.from(files || [])) stageLocalFile(file, source);
  }
  function installFileWatchers() {
    const composerOf = findChatComposerForTarget;
    document.addEventListener("click", (event) => {
      const button = event.target?.closest?.(COMPOSER_CONTROLS.send);
      if (button && !button.disabled) {
        const composer = composerOf(button);
        if (composer) submittedLocalFiles(composer);
      }
    }, true);
    document.addEventListener("submit", (event) => {
      const composer = composerOf(event.target);
      if (composer) submittedLocalFiles(composer);
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.repeat) return;
      const target = event.target;
      if (!target?.closest?.('#prompt-textarea, [contenteditable="true"]')) return;
      const composer = composerOf(target);
      if (composer) submittedLocalFiles(composer);
    }, true);
    document.addEventListener("change", (event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.type === "file" && input.files?.length)
        handleFiles(input.files, "file-input");
    }, true);
    document.addEventListener("drop", (event) => {
      if (event.dataTransfer?.files?.length) handleFiles(event.dataTransfer.files, "drop");
    }, true);
    document.addEventListener("paste", (event) => {
      if (event.clipboardData?.files?.length) handleFiles(event.clipboardData.files, "paste");
    }, true);
  }

  // src/chatgpt/09-dom-revision-controls.js
  function markRevisionFromClick(event) {
    if (isWatchdogPaused()) return;
    const button = event.target?.closest?.('button, [role="button"]');
    if (!button || button.closest?.(`#${APP}-root`)) return;
    const label = (button.getAttribute("aria-label") || button.getAttribute("title") || button.textContent || "").trim();
    if (/^(?:cancel|отмена)(?:\s|$)/i.test(label)) {
      revisionTargets.clear();
      completedRevisions.clear();
      return;
    }
    if (!/^(?:edit(?:\s+message)?|редактировать(?:\s+сообщение)?|regenerate(?:\s+(?:response|answer))?|сгенерировать\s+ответ\s+заново)(?:\s|$)/i.test(label)) {
      return;
    }
    const entries = [...identifiedMessages(collectMessageNodes().nodes)];
    const actionTurn = button.closest?.(
      '[data-message-id], [data-turn-key], [data-testid^="conversation-turn-"]'
    );
    const matched = actionTurn && entries.find(
      ({ el }) => actionTurn.contains(el) || el.contains(actionTurn)
    );
    const lastAssistant = entries.findLast(({ role }) => role === "assistant");
    const targets = new Set([matched?.id, lastAssistant?.id].filter(Boolean));
    if (!targets.size) return;
    const generation = setRevisionGeneration(revisionGeneration + 1);
    for (const id of targets) {
      revisionTargets.set(id, generation);
      completedRevisions.delete(id);
    }
  }

  // src/storage/03-chat-transition.js
  function promoteTransientLedger(chatKey, source) {
    if (!source) return true;
    const hasData = ["messages", "files", "domImages"].some((field) => Object.keys(source[field] || {}).length) || (source.repairHistory || []).length;
    if (!hasData) return true;
    const destination = loadState(chatKey);
    for (const field of ["messages", "files", "domImages"]) {
      destination[field] = { ...source[field], ...destination[field] };
    }
    destination.repairHistory = [
      ...source.repairHistory || [],
      ...destination.repairHistory || []
    ];
    return saveState(destination);
  }

  // src/app/10-audit-confirmation.js
  function clearAuditConfirmation() {
    setLastAudit(null);
    priorRepairCandidates.clear();
  }

  // src/app/11-chat-transition.js
  function retryTransientPromotion(chatKey = currentChatKey) {
    const pending = pendingTransientPromotions.get(chatKey);
    if (!pending) return true;
    if (pending.epoch !== (ledgerResetEpochs.get(chatKey) || 0)) {
      pendingTransientPromotions.delete(chatKey);
      return false;
    }
    if (!promoteTransientLedger(chatKey, pending.draft)) return false;
    pendingTransientPromotions.delete(chatKey);
    return true;
  }
  function changeChatKey(next = getChatKey()) {
    if (next === currentChatKey) return false;
    if (deferredConversationFrame) {
      cancelAnimationFrame(deferredConversationFrame);
      setDeferredConversationFrame(0);
    }
    if (next && !currentChatKey && transientState) {
      const draft = transientState;
      pendingTransientPromotions.set(next, {
        draft,
        epoch: ledgerResetEpochs.get(next) || 0
      });
      retryTransientPromotion(next);
    }
    if (next && !currentChatKey) {
      for (const item of pendingLocalFiles) if (item.chatKey === null) item.chatKey = next;
    }
    if (currentChatKey) pendingLocalFiles.length = 0;
    setTransientState(null);
    setCurrentChatKey(next);
    setLastUiSignals({ stop: false, send: false, actions: null });
    setLastCommit(null);
    clearAuditConfirmation();
    revisionTargets.clear();
    completedRevisions.clear();
    setFailedScanDraft(null);
    hydrationCandidates.clear();
    if (hydrationCheckTimer) clearTimeout(hydrationCheckTimer);
    setHydrationCheckTimer(0);
    setInspectedFileTurns(/* @__PURE__ */ new WeakMap());
    setInspectedImageTurns(/* @__PURE__ */ new WeakMap());
    setLastBackfillDeferred(0);
    runtime.route = null;
    runtime.work.backfill = false;
    setLastScanReason("navigation");
    return true;
  }

  // src/app/11-route-navigation.js
  function snapshotRouteDom() {
    const beforeIds = /* @__PURE__ */ new Set();
    const beforeNodes = /* @__PURE__ */ new WeakMap();
    for (const { el, id } of identifiedMessages(collectMessageNodes().nodes)) {
      beforeNodes.set(el, id || null);
      if (id) beforeIds.add(id);
    }
    return { beforeIds, beforeNodes };
  }
  function routeDomHasChanged(collected = null) {
    if (!runtime.route) return true;
    const { beforeIds, beforeNodes, outgoingKnownIds } = runtime.route;
    const nodes = (collected || collectMessageNodes()).nodes;
    const currentIds = /* @__PURE__ */ new Set();
    let outgoingMounted = 0;
    for (const { el, id } of identifiedMessages(nodes)) {
      if (id) currentIds.add(id);
      if (beforeNodes.has(el) && beforeNodes.get(el) === (id || null)) outgoingMounted++;
    }
    const destinationMessages = loadState().messages;
    let destinationKnown = 0;
    let outgoingOnly = 0;
    let shared = 0;
    for (const id of currentIds) {
      const inDestination = !!destinationMessages[id];
      const inOutgoing = !!outgoingKnownIds?.has(id);
      if (inDestination) destinationKnown++;
      if (inOutgoing && inDestination) shared++;
      else if (inOutgoing) outgoingOnly++;
    }
    const checkpoint = (reason) => {
      runtime.route.gate = {
        reason,
        visible: currentIds.size,
        destinationKnown,
        outgoingOnly,
        outgoingMounted,
        shared
      };
      return reason === "confirmed";
    };
    if (!currentIds.size) return checkpoint("awaiting DOM UUIDs");
    if (outgoingOnly) return checkpoint("outgoing-only IDs still visible");
    if (outgoingMounted) return checkpoint("outgoing DOM nodes still mounted");
    if (destinationKnown) return checkpoint("confirmed");
    if ([...currentIds].some((id) => !beforeIds.has(id) && !outgoingKnownIds?.has(id))) {
      return checkpoint("confirmed");
    }
    return checkpoint("waiting for fresh destination UUIDs");
  }
  function synchronizeChatRoute() {
    const next = getChatKey();
    if (next === currentChatKey) return false;
    const promotingNewChat = !currentChatKey && !!next;
    const keepCompletion = promotingNewChat && runtime.work.completion;
    const beforeSnapshot = promotingNewChat ? null : snapshotRouteDom();
    const outgoingKnownIds = !promotingNewChat && currentChatKey ? new Set(Object.keys(loadState(currentChatKey).messages || {})) : null;
    if (!changeChatKey(next)) return false;
    startRouteTransition(beforeSnapshot, outgoingKnownIds, keepCompletion);
    render(loadState());
    return true;
  }
  function routeVerifiedOrWait(collected = null) {
    if (runtime.route && !routeDomHasChanged(collected)) {
      if (setSessionPhase(runtime.route.gate?.visible ? "switching" : "awaiting-uuid"))
        render(loadState());
      return false;
    }
    return true;
  }

  // src/core/11-message-completion-context.js
  function captureCompletionContext(entries) {
    const laterUser = new Array(entries.length).fill(false);
    let foundUser = false, lastAssistantIndex = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
      laterUser[i] = foundUser;
      if (entries[i].role === "user") foundUser = true;
      if (lastAssistantIndex < 0 && entries[i].role === "assistant") lastAssistantIndex = i;
    }
    return { laterUser, lastAssistantIndex };
  }

  // src/chatgpt/11-message-hydration.js
  function assistantHasOwnActions(el) {
    const turn = el.closest?.('[data-turn-key], [data-testid^="conversation-turn-"]');
    return !!turn?.querySelector?.(FINISHED_ACTION_SELECTOR);
  }
  function scheduleHydrationRecheck(delay = 420) {
    if (hydrationCheckTimer) return;
    const chatKey = currentChatKey;
    setHydrationCheckTimer(setTimeout(() => {
      setHydrationCheckTimer(0);
      if (document.hidden || currentChatKey !== chatKey || !hydrationCandidates.size) return;
      requestBackfill();
      if (!isWatchdogPaused()) queueConversationEvent();
    }, delay));
  }
  function stableHydration(id, metrics) {
    const previous = hydrationCandidates.get(id);
    const snapshot = `${metrics.chars}:${metrics.fingerprint}`;
    if (!previous || previous.snapshot !== snapshot) {
      hydrationCandidates.set(id, { snapshot, seenAt: Date.now() });
      scheduleHydrationRecheck();
      return false;
    }
    const elapsed = Date.now() - previous.seenAt;
    if (elapsed < 400) scheduleHydrationRecheck(Math.max(30, 410 - elapsed));
    return elapsed >= 400;
  }
  function messageBusy(el, withSkeleton = false) {
    return !!(el.hidden || el.closest?.('[hidden], [inert], [aria-busy="true"]') || el.querySelector?.(withSkeleton ? '[aria-busy="true"], [data-state="loading"], [data-testid*="skeleton"]' : '[aria-busy="true"], [data-state="loading"]'));
  }
  function mayBackfillMessage(el, role, id, metrics, laterUserPresent) {
    if (role !== "user" && role !== "assistant") return false;
    const structural = getStructuralMessageId(el, role);
    if (!structural?.startsWith("msg:")) return false;
    if (metrics.parts.source === "fallback") return false;
    if (messageBusy(el, true)) return false;
    const content = metrics.parts.prose + "\n" + metrics.parts.code;
    if (!normalizeText(content) || /^(?:loading|загрузка|загружаем|подождите|please wait)[.…! ]*$/i.test(content.trim())) return false;
    if (role === "user") {
      if (metrics.chars >= 24) {
        hydrationCandidates.delete(id);
        return true;
      }
      return stableHydration(id, metrics);
    }
    const finalActions = assistantHasOwnActions(el);
    if (!finalActions && !laterUserPresent) return false;
    const needsSecondObservation = metrics.chars < 64 || !finalActions;
    if (!needsSecondObservation) {
      hydrationCandidates.delete(id);
      return true;
    }
    return stableHydration(id, metrics);
  }

  // src/app/11-message-ledger-commit.js
  function commitCapturedMessage(state, id, role, measured, commit) {
    const prev = state.messages[id];
    if (prev && !revisionTargets.has(id)) {
      commit.unchanged++;
      return false;
    }
    if (prev && prev.fingerprint === measured.fingerprint && prev.chars === measured.chars && prev.role === role) {
      commit.unchanged++;
      return false;
    }
    state.messages[id] = {
      role,
      tokens: measured.tokens,
      chars: measured.chars,
      fingerprint: measured.fingerprint
    };
    hydrationCandidates.delete(id);
    if (prev) commit.changed++;
    else commit.added++;
    if (role === "user") commit.user++;
    else if (role === "assistant") commit.assistant++;
    else commit.other++;
    return true;
  }

  // src/app/11-message-capture.js
  function captureMessages(entries, collected, state, mode, commitCompleted, commit, capturedRevisions = /* @__PURE__ */ new Map()) {
    let changed = false;
    const { laterUser, lastAssistantIndex } = captureCompletionContext(entries);
    for (const { index, el, role, id: directId } of entries) {
      if (!trustedCollectedMessageId(directId, collected)) {
        if (!directId) setLastBackfillDeferred(lastBackfillDeferred + 1) - 1;
        continue;
      }
      if (directId && state.messages[directId] && !revisionTargets.has(directId)) {
        commit.unchanged++;
        continue;
      }
      const revision = revisionTargets.get(directId);
      const revisionReady = revision !== void 0 && mode === "ready" && (commitCompleted || completedRevisions.get(directId) === revision);
      if (revision !== void 0 && !revisionReady) {
        setLastBackfillDeferred(lastBackfillDeferred + 1) - 1;
        continue;
      }
      const measured = getCanonicalMessageMetrics(el, role);
      if (!measured.chars) continue;
      const id = directId;
      const explicitlyFinished = mode === "ready" && commitCompleted && (role === "user" || role === "assistant" && index === lastAssistantIndex);
      if (!explicitlyFinished && !revisionTargets.has(id)) {
        if (!mayBackfillMessage(el, role, id, measured, laterUser[index])) {
          setLastBackfillDeferred(lastBackfillDeferred + 1) - 1;
          continue;
        }
      }
      if (commitCapturedMessage(state, id, role, measured, commit)) {
        changed = true;
        if (revisionReady) capturedRevisions.set(id, revision);
      }
    }
    return changed;
  }

  // src/app/11-message-scan.js
  function scanMessages({
    commitCompleted = false,
    backfill = false,
    reason = "inspection",
    collected: inspectedNodes = null,
    inspectedMode = null
  } = {}) {
    if (isWatchdogPaused()) return { status: "paused" };
    const perfStartedAt = perfStart();
    try {
      if (synchronizeChatRoute()) return { status: "deferred" };
      if (!routeVerifiedOrWait(inspectedNodes)) return { status: "deferred" };
      finishRouteTransition();
      if (!currentChatKey) {
        setSessionPhase("awaiting-uuid", false);
        render(loadState());
        return { status: "deferred" };
      }
      const mode = inspectedMode || getComposerMode(
        inspectedNodes ? () => inspectedNodes : collectMessageNodes
      );
      setSessionPhase(mode, false);
      if (mode === "generating") {
        render(loadState());
        return { status: "deferred" };
      }
      retryPendingFileResults(currentChatKey);
      if (failedScanDraft) {
        const pending = failedScanDraft;
        if (pending.chatKey !== currentChatKey || pending.epoch !== resetEpoch(currentChatKey)) {
          for (const [id, generation] of pending.revisions) {
            if (revisionTargets.get(id) === generation) {
              revisionTargets.delete(id);
              completedRevisions.delete(id);
            }
          }
          setFailedScanDraft(null);
        } else if (!saveState(pending.state)) {
          setLastCommit({ ...pending.commit, added: 0, changed: 0, failed: true });
          setLastScanReason("retry \xB7 STORAGE WRITE FAILED");
          render(loadState());
          return { status: "failed" };
        } else {
          for (const [id, generation] of pending.revisions) {
            if (revisionTargets.get(id) === generation) {
              revisionTargets.delete(id);
              completedRevisions.delete(id);
            }
          }
          queueCommittedFileJobs(pending.fileJobs, rememberSentFile);
          setFailedScanDraft(null);
        }
      }
      const collected = inspectedNodes || collectMessageNodes();
      const nodes = collected.nodes;
      rememberCollected(collected);
      markInspectionDone(nodes.length > 0);
      const commit = {
        added: 0,
        changed: 0,
        unchanged: 0,
        user: 0,
        assistant: 0,
        other: 0,
        at: Date.now()
      };
      if (!commitCompleted && !backfill || mode !== "ready" && mode !== "unknown") {
        setLastScanReason(reason);
        setLastCommit(commit);
        render(loadState());
        return { status: "unchanged" };
      }
      const state = loadState();
      if (commitCompleted && mode === "ready") {
        for (const [id, generation] of revisionTargets) {
          completedRevisions.set(id, generation);
        }
      }
      setLastBackfillDeferred(0);
      const entries = normalizeCollectedMessageEntries(collected);
      const trustedEntries = entries.filter((entry) => trustedCollectedMessageId(entry.id, collected));
      let changed = false;
      const imageInspected = [];
      if (scanConversationImages(trustedEntries, state, imageInspected)) changed = true;
      const fileScan = scanConversationFiles(trustedEntries, state);
      if (fileScan.changed) changed = true;
      const capturedRevisions = /* @__PURE__ */ new Map();
      if (captureMessages(entries, collected, state, mode, commitCompleted, commit, capturedRevisions)) {
        changed = true;
      }
      const persisted = !changed || saveState(state);
      if (perf.enabled && persisted && !changed) perf.noChangeScans++;
      if (persisted) {
        for (const entry of imageInspected) {
          inspectedImageTurns.set(entry.turn, entry);
          dirtyImageTurns.delete(entry.turn);
        }
        for (const { turn, messageId } of fileScan.inspected) {
          inspectedFileTurns.set(turn, `${state.chatKey}|${messageId}`);
          dirtyFileTurns.delete(turn);
        }
      }
      if (!persisted) {
        setFailedScanDraft({
          chatKey: state.chatKey,
          state,
          epoch: resetEpoch(state.chatKey),
          revisions: [...capturedRevisions],
          fileJobs: fileScan.jobs,
          commit: { ...commit }
        });
        setLastCommit({ ...commit, added: 0, changed: 0, failed: true });
        setLastScanReason(`${reason} \xB7 STORAGE WRITE FAILED`);
        render(loadState());
        return { status: "failed" };
      }
      for (const [id, generation] of capturedRevisions) {
        if (revisionTargets.get(id) === generation) {
          revisionTargets.delete(id);
          completedRevisions.delete(id);
        }
      }
      queueCommittedFileJobs(fileScan.jobs, rememberSentFile);
      setLastCommit(commit);
      setLastScanReason(reason);
      const metrics = stats(state);
      const budgets = effectiveBudgets();
      render(state, metrics, budgets);
      return { status: changed ? "persisted" : "unchanged" };
    } finally {
      perfEnd("conversation", perfStartedAt);
    }
  }

  // src/app/17-conversation-coordinator.js
  function updateVisibleSessionPhase(phase) {
    if (setSessionPhase(phase)) render(loadState());
  }
  function onConversationEvent() {
    if (isWatchdogPaused()) return;
    if (perf.enabled) perf.processedEvents++;
    if (currentChatKey) retryTransientPromotion(currentChatKey);
    if (document.hidden) {
      if (!pendingLocalFiles.some((item) => isActiveSubmittedFile(item, currentChatKey) && !item.boundMessageId)) return;
      if (synchronizeChatRoute() || !currentChatKey) return;
      const snapshot = collectMessageNodes();
      if (!routeVerifiedOrWait(snapshot)) return;
      bindSubmittedFilesToMessage(normalizeCollectedMessageEntries(snapshot).filter(
        (entry) => trustedCollectedMessageId(entry.id, snapshot)
      ), currentChatKey);
      return;
    }
    if (synchronizeChatRoute()) return;
    if (!currentChatKey) {
      const mode2 = getComposerMode();
      if (mode2 === "generating") setCompletionPending(true);
      updateVisibleSessionPhase(mode2);
      return;
    }
    let collected = null;
    const getCollected = () => collected || (collected = collectMessageNodes());
    if (!routeVerifiedOrWait(runtime.route ? getCollected() : null)) return;
    if (runtime.route) finishRouteTransition();
    const mode = getComposerMode(getCollected);
    if (mode === "generating") {
      setCompletionPending(true);
      updateVisibleSessionPhase("generating");
      if (pendingLocalFiles.some((item) => isActiveSubmittedFile(item, currentChatKey) && !item.boundMessageId)) {
        const snapshot = getCollected();
        bindSubmittedFilesToMessage(normalizeCollectedMessageEntries(snapshot).filter(
          (entry) => trustedCollectedMessageId(entry.id, snapshot)
        ), currentChatKey);
      }
      return;
    }
    if (mode === "ready" && needsInspection()) {
      const completing = runtime.work.completion;
      if (completing) {
        const actions = hasLastAssistantActions(getCollected());
        lastUiSignals.actions = actions;
        if (!actions) {
          updateVisibleSessionPhase("finishing");
          return;
        }
      }
      const wasBackfill = runtime.work.backfill;
      setCompletionPending(false);
      setSessionPhase("ready", false);
      scanMessages({
        commitCompleted: completing,
        backfill: true,
        reason: completing ? "response finished + unseen history" : wasBackfill ? "DOM mount/scroll backfill" : "initial/navigation backfill",
        collected,
        inspectedMode: mode
      });
      return;
    }
    if (mode === "unknown" && (runtime.work.initial || runtime.work.backfill)) {
      setSessionPhase("unknown", false);
      scanMessages({
        commitCompleted: false,
        backfill: true,
        reason: "DOM backfill (composer unknown; per-message finality)",
        collected,
        inspectedMode: mode
      });
      return;
    }
    updateVisibleSessionPhase(mode);
  }
  function queueConversationEvent(priority = "urgent") {
    if (isWatchdogPaused()) return;
    if (priority === "background" && !runtime.work.completion && !runtime.route && !runtime.work.initial && !mutationCheckQueued) {
      if (!deferredConversationFrame) {
        setDeferredConversationFrame(requestAnimationFrame(() => {
          setDeferredConversationFrame(0);
          queueConversationEvent();
        }));
      }
      return;
    }
    if (deferredConversationFrame) {
      cancelAnimationFrame(deferredConversationFrame);
      setDeferredConversationFrame(0);
    }
    if (mutationCheckQueued) return;
    setMutationCheckQueued(true);
    if (perf.enabled) perf.queuedEvents++;
    queueMicrotask(() => {
      setMutationCheckQueued(false);
      if (!isWatchdogPaused()) onConversationEvent();
    });
  }

  // src/app/03-calibration-command.js
  function saveEndedChatSample() {
    if (isWatchdogPaused()) return { status: "paused" };
    if (!currentChatKey) {
      return { status: "missing-chat" };
    }
    const state = loadState();
    if (corruptLedgerKeys.has(currentChatKey)) return { status: "corrupt-ledger" };
    const s = stats(state);
    const history2 = [...loadHistory()];
    if (calibrationHistoryCorrupt) {
      return { status: "corrupt-history" };
    }
    const key = currentChatKey;
    const sample = {
      chatKey: key,
      savedAt: Date.now(),
      seen: Math.round(s.tokens),
      optimistic: Math.round(s.optimistic),
      pessimistic: Math.round(s.pessimistic),
      knownAttachmentTokens: Math.round(s.knownTokens || 0),
      knownImages: Math.round(s.knownImages || 0),
      turns: Math.round(s.turns || 0)
    };
    const existingIndex = history2.findIndex((x) => x.chatKey === key);
    if (existingIndex >= 0) {
      history2[existingIndex] = sample;
    } else {
      history2.push(sample);
    }
    const base = settings.budgetCalibrationBase || currentBudgetValues();
    const valid = history2.filter((x) => Number.isFinite(Number(x.seen)) && Number.isFinite(Number(x.pessimistic)));
    const hs = historyStatsFor(valid);
    const budgets = calibratedBudgets(base, hs);
    const previousHistory = [...loadHistory()];
    const previousSettings = { ...settings };
    if (!saveHistory(history2)) return { status: "storage-failed" };
    Object.assign(settings, {
      budgetCalibrationBase: base,
      conservativeBudget: budgets.conservativeBudget,
      normalBudget: budgets.normalBudget,
      optimisticBudget: budgets.optimisticBudget,
      budgetCalibrationWeight: budgets.weight
    });
    if (!saveSettings()) {
      setSettings(previousSettings);
      saveHistory(previousHistory);
      return { status: "storage-failed" };
    }
    return { status: "saved", state, count: hs.n };
  }

  // src/ui/12-panel-position.js
  function applySavedBadgePosition(root) {
    const pos = settings.badgePosition;
    if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) {
      return;
    }
    const badgeRect = root.querySelector(".cw-chip").getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - badgeRect.width);
    const maxTop = Math.max(0, window.innerHeight - badgeRect.height);
    const left = clamp(pos.left, 0, maxLeft);
    const top = clamp(pos.top, 0, maxTop);
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
  }
  function restoreDefaultBadgeAnchor(root, panelOpen) {
    const props = ["left", "top", "right", "bottom"];
    const original = props.map((prop) => root.style[prop]);
    const wasCompact = root.dataset.cwPanelOpen === "true";
    for (const prop of props) root.style[prop] = "";
    if (wasCompact) delete root.dataset.cwPanelOpen;
    const rect = root.querySelector(".cw-chip").getBoundingClientRect();
    if (wasCompact) root.dataset.cwPanelOpen = "true";
    for (let i = 0; i < props.length; i++) root.style[props[i]] = original[i];
    if (panelOpen) {
      root.style.left = `${rect.left}px`;
      root.style.top = `${rect.top}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
    } else {
      for (const prop of props) root.style[prop] = "";
    }
  }
  var panelPlacements = /* @__PURE__ */ new WeakMap();
  function placePanel() {
    if (!ui || ui.panel.hidden) return;
    const gap = 4;
    const edge = 8;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const chipRect = ui.chip.getBoundingClientRect();
    const rootRect = ui.root.getBoundingClientRect();
    ui.panel.style.maxHeight = "";
    const panelRect = ui.panel.getBoundingClientRect();
    const left = clamp(
      chipRect.left,
      edge,
      Math.max(edge, viewportWidth - panelRect.width - edge)
    );
    const spaceBelow = Math.max(0, viewportHeight - edge - chipRect.bottom - gap);
    const spaceAbove = Math.max(0, chipRect.top - edge - gap);
    const spaceLeft = chipRect.left - gap - edge;
    if (panelRect.height > spaceBelow && panelRect.height > spaceAbove && spaceLeft >= panelRect.width) {
      ui.panelFrame.style.left = `${chipRect.left - gap - panelRect.width - rootRect.left}px`;
      ui.panelFrame.style.top = `${clamp(
        chipRect.top + 14,
        edge,
        Math.max(edge, viewportHeight - panelRect.height - edge)
      ) - rootRect.top}px`;
      panelPlacements.set(ui.panel, "left");
      constrainPanel();
      return;
    }
    const below = panelRect.height <= spaceBelow || panelRect.height > spaceAbove && spaceBelow >= spaceAbove;
    const available = below ? spaceBelow : spaceAbove;
    if (panelRect.height > available) ui.panel.style.maxHeight = `${available}px`;
    const panelHeight = ui.panel.getBoundingClientRect().height;
    ui.panelFrame.style.left = `${left - rootRect.left}px`;
    ui.panelFrame.style.top = `${(below ? chipRect.bottom + gap : chipRect.top - gap - panelHeight) - rootRect.top}px`;
    panelPlacements.set(ui.panel, below ? "below" : "above");
    constrainPanel();
  }
  function constrainPanel() {
    if (!ui || ui.panel.hidden) return;
    const side = panelPlacements.get(ui.panel);
    if (!side) return;
    const edge = 8;
    const gap = 4;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const panelTop = ui.panel.getBoundingClientRect().top;
    const lowerBoundary = side === "above" ? Math.min(viewportHeight - edge, ui.chip.getBoundingClientRect().top - gap) : viewportHeight - edge;
    ui.panel.style.maxHeight = `${Math.max(1, lowerBoundary - panelTop)}px`;
  }

  // src/ui/15-panel-dialog-hooks.js
  var mountDialog = null;
  var discardDrafts = null;
  var refreshBudget = null;
  function bindPanelDialogHooks(mount, discard) {
    mountDialog = mount;
    discardDrafts = discard;
  }
  function ensurePanelDialogMounted(kind) {
    if (!mountDialog) throw new Error("Watchdog dialog factory was not initialized");
    mountDialog(kind);
  }
  function discardPanelDrafts() {
    discardDrafts?.();
  }
  function bindBudgetFieldRefresh(callback) {
    refreshBudget = callback;
  }
  function refreshBudgetInputs() {
    refreshBudget?.();
  }

  // src/ui/15-panel-dialog-lifecycle.js
  var limitDialogChatKey = null;
  function openSettingsDialog() {
    ensurePanelDialogMounted("settings");
    if (ui.settingsDialog.open || ui.aboutDialog?.open || ui.limitDialog?.open || ui.confirmDialog?.open) return;
    capturePanelDialogBaseline();
    ui.panelMain.inert = true;
    ui.panel.classList.add("cw-settings-open");
    ui.settingsScrim.hidden = false;
    ui.settingsDialog.show();
    fitPanelDialogToPanel();
    if (ui.diagnosticsDetails?.hidden === false) {
      const state = loadState();
      renderDiagnostics(stats(state), state);
      fitPanelDialogToPanel();
    }
    ui.closeSettings.focus();
    requestAnimationFrame(fitPanelDialogToPanel);
  }
  function closePanelDialog(dialog, trigger) {
    if (!dialog.open) return;
    dialog.close();
    ui.settingsScrim.hidden = true;
    ui.panelMain.inert = false;
    ui.panel.classList.remove("cw-settings-open");
    const baseline = panelDialogBaseline;
    setPanelDialogBaseline(null);
    ui.panel.style.height = baseline?.inlineHeight ?? "";
    if (!ui.panel.hidden) {
      render(loadState());
      const width = document.documentElement.clientWidth || window.innerWidth;
      const height = document.documentElement.clientHeight || window.innerHeight;
      if (baseline && (baseline.viewportWidth !== width || baseline.viewportHeight !== height)) {
        placePanel();
      }
      if (trigger.isConnected) trigger.focus();
    }
  }
  function closeSettingsDialog() {
    if (!ui.settingsDialog?.open) return;
    if (ui.confirmDialog?.open) settlePanelConfirmation(false);
    discardPanelDrafts();
    closePanelDialog(ui.settingsDialog, ui.settingsBtn);
  }
  function openAboutDialog() {
    ensurePanelDialogMounted("about");
    if (ui.aboutDialog.open || ui.settingsDialog?.open || ui.limitDialog?.open || ui.confirmDialog?.open) return;
    capturePanelDialogBaseline();
    ui.panelMain.inert = true;
    ui.panel.classList.add("cw-settings-open");
    ui.settingsScrim.hidden = false;
    ui.aboutDialog.show();
    fitPanelDialogToPanel();
    ui.closeAbout.focus();
    requestAnimationFrame(fitPanelDialogToPanel);
  }
  function closeAboutDialog() {
    closePanelDialog(ui.aboutDialog, ui.aboutBtn);
  }
  function openLimitDialog() {
    if (ui.settingsDialog?.open || ui.aboutDialog?.open || ui.limitDialog?.open || ui.confirmDialog?.open) return;
    if (!currentChatKey || getChatKey() !== currentChatKey) {
      showToast("Cannot record a chat limit until the current chat UUID is ready.");
      return;
    }
    ensurePanelDialogMounted("limit");
    limitDialogChatKey = currentChatKey;
    const s = stats(loadState());
    setTextIfChanged(ui.limitTokens, `\u2248 ${formatDetailedTokens(s.tokens)}`);
    setTextIfChanged(ui.limitOptimistic, `\u2248 ${formatDetailedTokens(s.optimistic)}`);
    setTextIfChanged(ui.limitPessimistic, `\u2248 ${formatDetailedTokens(s.pessimistic)}`);
    ui.limitReplacement.hidden = !loadHistory().some((x) => x.chatKey === limitDialogChatKey);
    capturePanelDialogBaseline();
    ui.panelMain.inert = true;
    ui.panel.classList.add("cw-settings-open");
    ui.settingsScrim.hidden = false;
    ui.limitDialog.show();
    fitPanelDialogToPanel();
    ui.cancelLimit.focus();
    requestAnimationFrame(fitPanelDialogToPanel);
  }
  function closeLimitDialog() {
    if (!ui.limitDialog?.open) return;
    closePanelDialog(ui.limitDialog, ui.endChat);
    limitDialogChatKey = null;
  }
  function confirmChatLimitDialog() {
    if (!ui.limitDialog?.open || !limitDialogChatKey) return;
    if (currentChatKey !== limitDialogChatKey || getChatKey() !== limitDialogChatKey) {
      closeLimitDialog();
      showToast("Chat changed. No limit was recorded; reopen Record Chat Limit.");
      return;
    }
    closeLimitDialog();
    const result = saveEndedChatSample();
    if (result.status === "saved") {
      refreshBudgetInputs();
      render(result.state);
      showToast(`Chat limit #${result.count} saved; budgets updated.`);
    } else if (result.status === "missing-chat") {
      showToast("Cannot save a chat sample before its UUID appears in the URL.");
    } else if (result.status === "corrupt-history") {
      showToast("Calibration history is corrupt. Back up raw data before resetting.");
    } else if (result.status === "corrupt-ledger") {
      showToast("Chat ledger is corrupt. Back up raw data before resetting.");
    } else {
      render(loadState());
    }
  }
  var pendingConfirmation = null;
  function requestPanelConfirmation(message, onOk) {
    if (!ui || ui.panel.hidden || ui.confirmDialog?.open || ui.aboutDialog?.open || ui.limitDialog?.open || ui.settingsDialog?.inert || typeof onOk !== "function") return false;
    ensurePanelDialogMounted("confirm");
    const parent = ui.settingsDialog?.open ? ui.settingsDialog : null;
    pendingConfirmation = {
      onOk,
      parent,
      origin: document.activeElement,
      chatKey: currentChatKey,
      routeKey: getChatKey()
    };
    ui.confirmDescription.textContent = message;
    if (parent) parent.inert = true;
    else {
      capturePanelDialogBaseline();
      ui.panelMain.inert = true;
      ui.panel.classList.add("cw-settings-open");
      ui.settingsScrim.hidden = false;
    }
    ui.confirmDialog.show();
    fitPanelDialogToPanel();
    ui.cancelConfirm.focus();
    requestAnimationFrame(fitPanelDialogToPanel);
    return true;
  }
  function settlePanelConfirmation(confirmed = false) {
    const pending = pendingConfirmation;
    if (!pending) return;
    pendingConfirmation = null;
    if (pending.parent?.isConnected && pending.parent.open) {
      if (ui.confirmDialog?.open) ui.confirmDialog.close();
      pending.parent.inert = false;
      fitPanelDialogToPanel();
      if (pending.origin?.isConnected) pending.origin.focus();
    } else if (ui.confirmDialog?.open) {
      closePanelDialog(ui.confirmDialog, pending.origin || ui.settingsBtn);
    }
    if (!confirmed) return;
    if (currentChatKey !== pending.chatKey || getChatKey() !== pending.routeKey) {
      showToast("Chat changed. Action canceled.");
      return;
    }
    pending.onOk();
  }
  function resetPanelDialogsForRemount() {
    pendingConfirmation = null;
    limitDialogChatKey = null;
    setPanelDialogBaseline(null);
  }
  function onPanelDialogKeydown(event, dialog, close) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      const focusable = [...dialog.querySelectorAll(
        'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), summary, [tabindex]:not([tabindex="-1"])'
      )].filter((node) => node.getClientRects().length && !node.closest("[inert]"));
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const current = focusable.indexOf(document.activeElement);
      if (event.shiftKey && current <= 0) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && (current < 0 || current === focusable.length - 1)) {
        event.preventDefault();
        focusable[0].focus();
      }
    }
  }
  function bindPanelDialogDismissal(dialog, close) {
    dialog.addEventListener("keydown", (event) => onPanelDialogKeydown(event, dialog, close));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
  }

  // src/ui/15-panel-settings-controls.js
  var SETTING_GROUPS = Object.freeze({
    text: {
      label: "Text token estimation",
      fields: [
        ["messageOverhead", "messageOverhead"],
        ["proseCyrillicRatio", "proseCyrillicCharsPerToken"],
        ["proseLatinRatio", "proseLatinCharsPerToken"],
        ["proseDigitsRatio", "proseDigitsCharsPerToken"],
        ["prosePunctuationRatio", "prosePunctuationCharsPerToken"],
        ["proseOtherRatio", "proseOtherCharsPerToken"],
        ["proseWordFloor", "proseMinTokensPerWord"],
        ["codeRatio", "codeCharsPerToken"]
      ],
      save: "saveTextEstimation",
      reset: "resetTextEstimation"
    },
    attachment: {
      label: "Files & images",
      fields: [
        ["historicalFileFallback", "historicalFileFallbackTokens"],
        ["imageAverage", "averageImageTokens"],
        ["localFileLimit", "localFileParsingLimitMiB"],
        ...METADATA_SETTING_SPECS.map((spec) => [spec.field, spec.key])
      ],
      save: "saveAttachments",
      reset: "resetAttachments"
    },
    coefficients: {
      label: "Attachment estimation coefficients",
      fields: [
        ["fileOpt", "fileOptimisticPct"],
        ["filePess", "filePessimisticPct"],
        ["imageOpt", "imageOptimisticPct"],
        ["imagePess", "imagePessimisticPct"],
        ["pastedMinChars", "pastedMinChars"],
        ["pastedEnglishRatio", "pastedEnglishCharsPerToken"],
        ["pastedCyrillicRatio", "pastedCyrillicCharsPerToken"]
      ],
      save: "saveAttachmentCoefficients",
      reset: "resetAttachmentAdvanced"
    },
    budget: {
      label: "Budget settings",
      fields: [
        ["budgetC", "conservativeBudget"],
        ["budgetN", "normalBudget"],
        ["budgetO", "optimisticBudget"]
      ],
      save: "saveBudget",
      reset: "resetBudget"
    },
    technical: {
      label: "Technical settings",
      fields: [
        ["hiddenOptimistic", "hiddenOptimistic"],
        ["hiddenPessimistic", "hiddenPessimistic"],
        ["historyPriorStrength", "historyPriorStrength"]
      ],
      save: "saveSettings",
      reset: "resetSettings"
    }
  });
  function validateSettingsGroup(group, updates) {
    if (group === "attachment") {
      return updates.metadataOnlyOptimisticBase <= updates.metadataOnlyPessimisticBase && updates.metadataOnlyOptimisticSizeFactor <= updates.metadataOnlyPessimisticSizeFactor && updates.metadataOnlyOptimisticMax <= updates.metadataOnlyPessimisticMax;
    }
    if (group === "budget") {
      return updates.conservativeBudget <= updates.normalBudget && updates.normalBudget <= updates.optimisticBudget;
    }
    if (group === "technical") return updates.hiddenOptimistic <= updates.hiddenPessimistic;
    if (group === "coefficients") {
      return updates.fileOptimisticPct <= updates.filePessimisticPct && updates.imageOptimisticPct <= updates.imagePessimisticPct;
    }
    return true;
  }
  function syncGroupInputs(group, force = false) {
    if (!ui) return;
    for (const [field, key] of SETTING_GROUPS[group].fields) {
      const input = ui[field];
      if (!input) continue;
      if (!force && (input.dataset.dirty === "1" || input === document.activeElement)) continue;
      input.value = String(settings[key]);
      if (force) delete input.dataset.dirty;
    }
    if (group === "attachment" && ui.localFileLimit) updateLimitWarning();
  }
  function discardUnsavedSettingsInputs() {
    for (const group of Object.keys(SETTING_GROUPS)) syncGroupInputs(group, true);
  }
  function updateLimitWarning() {
    if (!ui?.localFileLimit) return;
    const value = Number(ui.localFileLimit.value);
    ui.limitWarning.hidden = !ui.localFileLimit.value.trim() || !Number.isFinite(value) || value <= 80;
    if (!ui.limitWarning.hidden) {
      const message = "Above recommended range (70\u201380 MiB): local parsing may use more memory";
      ui.limitWarning.title = message;
      ui.limitWarning.setAttribute("aria-label", message);
      ui.localFileLimit.dataset.cwTip = message;
    } else {
      ui.localFileLimit.dataset.cwTip = "Maximum file size for local parsing. Larger files use metadata only. Recommended: 75 MiB.";
    }
  }
  function bindSettingsGroup(group) {
    const definition = SETTING_GROUPS[group];
    const controls = definition.fields.map(([field]) => ui[field]);
    if (controls.some((node) => !node)) throw new Error(`Missing ${group} setting input`);
    for (const [field, key] of definition.fields) {
      const input = ui[field];
      const spec = NUMERIC_SETTING_SPECS[key];
      if (!spec) throw new Error(`Missing numeric specification: ${key}`);
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(numericStep(key));
      input.addEventListener("input", () => {
        input.dataset.dirty = "1";
        if (group === "attachment" && input === ui.localFileLimit) updateLimitWarning();
      });
      input.addEventListener("blur", () => {
        if (input.dataset.dirty !== "1") return;
        const raw = input.value.trim();
        if (!raw) return;
        const normalized = normalizeNumericSetting(key, Number(raw));
        if (normalized !== null) input.value = String(normalized);
        if (group === "attachment" && input === ui.localFileLimit) updateLimitWarning();
      });
    }
    ui[definition.save].addEventListener("click", () => {
      const updates = {};
      for (const [field, key] of definition.fields) {
        const input = ui[field];
        if (input.dataset.dirty !== "1") {
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
      if (group === "budget") {
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
    ui[definition.reset].addEventListener("click", () => {
      requestPanelConfirmation(`Restore defaults for ${definition.label}? Only this group will be reset.`, () => {
        const updates = Object.fromEntries(definition.fields.map(([, key]) => [key, DEFAULTS[key]]));
        if (group === "budget") {
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
    if (!saveSettings()) {
      setSettings(loadSettings());
      render(loadState());
      return false;
    }
    render(loadState());
    showToast(successText);
    return true;
  }

  // src/ui/15-panel-handoff-settings.js
  var detachedDraft = null;
  function captureHandoffDraftForRemount() {
    const nodes = handoffEditorNodes();
    detachedDraft = nodes?.field?.dataset.dirty === "true" ? nodes.field.value : null;
  }
  function handoffEditorNodes() {
    const dialog = ui?.settingsDialog;
    return dialog && {
      field: dialog.querySelector(".cw-handoff-prompt"),
      counter: dialog.querySelector(".cw-handoff-counter"),
      warning: dialog.querySelector(".cw-handoff-unsaved")
    };
  }
  function syncHandoffEditor(resetDraft = false) {
    const nodes = handoffEditorNodes();
    if (!nodes?.field) return;
    if (resetDraft) detachedDraft = null;
    const active = settings.handoffPrompt || HANDOFF_PROMPT;
    if (resetDraft || nodes.field.dataset.initialized !== "true" || nodes.field.dataset.dirty !== "true") {
      nodes.field.value = active;
      nodes.field.dataset.initialized = "true";
    }
    const changed = nodes.field.value !== active;
    nodes.field.dataset.dirty = String(changed);
    nodes.counter.textContent = `${nodes.field.value.length} / ${HANDOFF_MAX_CHARS}`;
    nodes.warning.hidden = !changed;
  }
  function bindHandoffEditor() {
    const dialog = ui?.settingsDialog;
    const nodes = handoffEditorNodes();
    if (!nodes?.field || nodes.field.dataset.bound === "true") return;
    nodes.field.dataset.bound = "true";
    nodes.field.addEventListener("input", () => {
      nodes.field.dataset.dirty = "true";
      syncHandoffEditor();
    });
    dialog.querySelector(".cw-save-handoff").addEventListener("click", () => {
      const next = nodes.field.value;
      if (!isValidHandoffPrompt(next)) {
        showToast(`HANDOFF prompt: enter 1\u2013${HANDOFF_MAX_CHARS} characters.`);
        return;
      }
      const previous = settings.handoffPrompt;
      settings.handoffPrompt = next;
      if (!saveSettings()) {
        settings.handoffPrompt = previous;
        syncHandoffEditor();
        showToast("HANDOFF prompt was not saved.");
        return;
      }
      syncHandoffEditor();
      showToast("HANDOFF saved.");
    });
    dialog.querySelector(".cw-restore-handoff").addEventListener("click", () => {
      requestPanelConfirmation("Restore the original HANDOFF prompt in the editor? The active prompt will not change until Save.", () => {
        nodes.field.value = HANDOFF_PROMPT;
        nodes.field.dataset.dirty = "true";
        syncHandoffEditor();
      });
    });
    if (detachedDraft !== null) {
      nodes.field.value = detachedDraft;
      nodes.field.dataset.initialized = "true";
      nodes.field.dataset.dirty = "true";
      detachedDraft = null;
      syncHandoffEditor();
    } else syncHandoffEditor(true);
  }

  // src/ui/13-panel-markup.js
  var LAZY_ESTIMATION_MARKUP = Object.freeze({
    text: `<div class="cw-config-form">
              <div class="cw-advanced-hint" title="Only newly captured text and newly parsed files are estimated with these ratios; saved UUID counts are unchanged">New captures only \xB7 write-once</div>
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
                <span class="cw-input-with-indicator"><input class="cw-local-file-limit" type="number" title="Maximum file size for local parsing. Larger files use metadata only. Recommended: 75 MiB."><span class="cw-limit-warning" role="img" aria-label="Outside recommended range" title="Outside recommended range (70\u201380 MiB)" hidden><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4.4a2 2 0 0 1 3.4 0l8 13.8a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3z"/><path d="M12 9v5M12 17.5h.01"/></svg></span></span>
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
                <label><span class="cw-field-caption" title="Estimated share of locally parsed file content included in the optimistic scenario; also used for historical fallback and auto-paste minimum">Files \xB7 Optimistic (%)</span> <input class="cw-file-opt" type="number"></label>
                <label><span class="cw-field-caption" title="Estimated share of locally parsed file content included in the pessimistic scenario; also used for historical fallback and auto-paste minimum">Files \xB7 Pessimistic (%)</span> <input class="cw-file-pess" type="number"></label>
                <div class="cw-advanced-caption">Image context contribution (%)</div>
                <label><span class="cw-field-caption" title="Share of image estimate counted in optimistic scenario">Images \xB7 Optimistic (%)</span> <input class="cw-image-opt" type="number"></label>
                <label><span class="cw-field-caption" title="Share of image estimate counted in pessimistic scenario">Images \xB7 Pessimistic (%)</span> <input class="cw-image-pess" type="number"></label>
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
  function metadataControlsMarkup(specs) {
    const input = (spec) => `<label><span class="cw-field-caption" title="${spec.hint}">${spec.label}</span> <input class="cw-${spec.field.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}" type="number"></label>`;
    return `<details class="cw-disclosure cw-metadata-only"><summary>Metadata-only estimation</summary>
      <div class="cw-advanced-hint">Calibration for unread files of known size. Original formula and default outcomes are retained.</div>
      <div class="cw-advanced-caption">Formula</div>
      ${specs.slice(0, 6).map(input).join("")}
      <div class="cw-advanced-caption">File types</div>
      ${specs.slice(6).map(input).join("")}
    </details>`;
  }
  var LAZY_VIEW_MARKUP = Object.freeze({
    context: '\n          <div class="cw-context-summary" aria-label="Total context estimate">\n            <div class="cw-context-primary-row"><span class="cw-context-primary-label">Total context estimate</span><strong class="cw-context-range">--</strong></div>\n            <div class="cw-context-note"><span>Heuristic midpoint of optimistic</span> <span>and pessimistic estimates</span></div>\n            <div class="cw-data-row"><span>Messages</span><strong class="cw-context-messages">--</strong></div>\n          </div>\n          <div class="cw-context-text-only">\n            <span class="cw-card-caption">Text only</span>\n            <strong class="cw-data-tokens">--</strong>\n            <div class="cw-context-characters"><strong class="cw-data-chars">--</strong> characters</div>\n          </div>\n          <div class="cw-data-attachment">\n            <div class="cw-data-row"><span>Files attached</span><strong class="cw-data-files">--</strong></div>\n            <div class="cw-data-row cw-file-accounting-row"><span>File accounting</span><strong class="cw-data-quality">--</strong></div>\n            <div class="cw-data-row cw-file-accounting-continuation"><strong class="cw-data-quality-extra">--</strong></div>\n            <div class="cw-data-row cw-data-images-row"><span>Images attached</span><strong class="cw-data-images">none</strong></div>\n          </div>\n          <div class="cw-estimation-settings">\n            <div class="cw-mini-nav" role="group" aria-label="Context estimation settings">\n              <button type="button" class="cw-mini-tab" data-cw-mini="text" aria-expanded="false" aria-controls="cw-mini-text">Text estimation</button>\n              <button type="button" class="cw-mini-tab" data-cw-mini="attachment" aria-expanded="false" aria-controls="cw-mini-attachment">Files &amp; images</button>\n              <button type="button" class="cw-mini-tab" data-cw-mini="coefficients" aria-expanded="false" aria-controls="cw-mini-coefficients">Attachment weights</button>\n            </div>\n            <div id="cw-mini-text" class="cw-text-settings-details cw-mini-pane" hidden></div>\n            <div id="cw-mini-attachment" class="cw-attachment-settings cw-mini-pane" hidden></div>\n            <div id="cw-mini-coefficients" class="cw-advanced-attachments cw-mini-pane" hidden></div>\n          </div>\n        ',
    budget: '\n          <div class="cw-budget-unavailable cw-context-note" hidden>No context estimate yet</div>\n          <div class="cw-forecast-heading"><strong>Budget status</strong><span class="cw-forecast-status cw-status">--</span></div>\n          <div class="cw-forecast-cards">\n            <div><strong class="cw-card-value cw-forecast-opt">--</strong><div class="cw-context-note">Optimistic</div></div>\n            <div><strong class="cw-card-value cw-forecast-pess">--</strong><div class="cw-context-note">Pessimistic</div></div>\n          </div>\n          <div class="cw-budget-navigation">\n            <div class="cw-mini-nav cw-budget-mini-nav" aria-label="Budget sections" role="tablist">\n              <button type="button" id="cw-budget-limits-tab" role="tab" class="cw-mini-tab cw-mini-active" data-cw-budget="limits" aria-selected="true" tabindex="0" aria-controls="cw-budget-limits">Token budget &amp; limits</button>\n              <button type="button" id="cw-budget-history-tab" role="tab" class="cw-mini-tab" data-cw-budget="history" aria-selected="false" tabindex="-1" aria-controls="cw-budget-history">History &amp; calibration</button>\n            </div>\n            <div id="cw-budget-limits" class="cw-budget-limits cw-mini-pane" role="tabpanel" aria-labelledby="cw-budget-limits-tab">\n              <div class="cw-forecast-group">\n                <div class="cw-forecast-group-title">Optimistic use</div>\n                <div class="cw-progress-grid">\n                  <div><div class="cw-progress-track"><div class="cw-progress-fill cw-progress-opt-c"></div><strong class="cw-progress-percent cw-percent-opt-c" data-cw-on-fill="false">--</strong></div><div class="cw-context-note">Conservative</div></div>\n                  <div><div class="cw-progress-track"><div class="cw-progress-fill cw-progress-opt-n"></div><strong class="cw-progress-percent cw-percent-opt-n" data-cw-on-fill="false">--</strong></div><div class="cw-context-note">Normal</div></div>\n                  <div><div class="cw-progress-track"><div class="cw-progress-fill cw-progress-opt-o"></div><strong class="cw-progress-percent cw-percent-opt-o" data-cw-on-fill="false">--</strong></div><div class="cw-context-note">Generous</div></div>\n                </div>\n              </div>\n              <div class="cw-forecast-group">\n                <div class="cw-forecast-group-title">Pessimistic use</div>\n                <div class="cw-progress-grid">\n                  <div><div class="cw-progress-track"><div class="cw-progress-fill cw-progress-pess-c"></div><strong class="cw-progress-percent cw-percent-pess-c" data-cw-on-fill="false">--</strong></div><div class="cw-context-note">Conservative</div></div>\n                  <div><div class="cw-progress-track"><div class="cw-progress-fill cw-progress-pess-n"></div><strong class="cw-progress-percent cw-percent-pess-n" data-cw-on-fill="false">--</strong></div><div class="cw-context-note">Normal</div></div>\n                  <div><div class="cw-progress-track"><div class="cw-progress-fill cw-progress-pess-o"></div><strong class="cw-progress-percent cw-percent-pess-o" data-cw-on-fill="false">--</strong></div><div class="cw-context-note">Generous</div></div>\n                </div>\n              </div>\n              <details class="cw-disclosure cw-budget-editor"><summary>Edit token budgets</summary>\n                <div id="cw-budget-options" class="cw-budget-settings"></div>\n              </details>\n            </div>\n            <div id="cw-budget-history" class="cw-history-details cw-mini-pane" role="tabpanel" aria-labelledby="cw-budget-history-tab" hidden></div>\n          </div>\n        ',
    details: '\n          <div class="cw-details-header"><span>Details</span><button type="button" class="cw-copy-details" title="Copy Details figures as plain text">Copy</button></div>\n          <div class="cw-details-report">\n            <div class="cw-detail-group"></div>\n            <div class="cw-detail-group"></div>\n            <div class="cw-detail-group"></div>\n            <div class="cw-detail-group"></div>\n            <div class="cw-detail-group"></div>\n          </div>\n        '
  });
  var LAZY_SECTION_MARKUP = Object.freeze({
    historyBody: '\n          <div class="cw-history-line">\n            <div class="cw-history"></div>\n            <div class="cw-history-note">Averages across recorded samples.</div>\n          </div>\n        ',
    budgetForm: '\n            <div class="cw-config-form">\n              <label>Conservative budget <input class="cw-budget-c" type="number"></label>\n              <label>Normal budget <input class="cw-budget-n" type="number"></label>\n              <label>Generous budget <input class="cw-budget-o" type="number"></label>\n              <div class="cw-threshold-info">Current token budgets; recording a chat limit recalibrates and saves these numbers.</div>\n              <div class="cw-settings-actions cw-unified-actions">\n                <button type="button" class="cw-save-budget">Save</button>\n                <button type="button" class="cw-reset-budget">Restore defaults</button>\n              </div>\n            </div>\n          ',
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
          <label>Hidden context \xB7 optimistic <input class="cw-hidden-optimistic" type="number"></label>
          <label>Hidden context \xB7 pessimistic <input class="cw-hidden-pessimistic" type="number"></label>
          <label>History prior strength <input class="cw-history-prior-strength" type="number"></label>
          <div class="cw-settings-actions cw-unified-actions"><button type="button" class="cw-save-settings">Save</button><button type="button" class="cw-reset-settings">Restore defaults</button></div>
        `,
    diagnostics: '\n            <details class="cw-disclosure cw-recent-errors"><summary>Recent errors</summary><div class="cw-recent-errors-list">No errors recorded. All good.</div></details>\n            <div class="cw-diagnostics-line">Expand to load current diagnostics.</div>\n            <div class="cw-settings-actions">\n              <button type="button" class="cw-rescan" title="Read-only audit of rendered messages">Run Audit</button>\n              <button type="button" class="cw-copy-diagnostics">Copy diagnostics</button>\n              <button type="button" class="cw-export-ids" title="Read-only TSV file with known UUIDs">Export IDs (.tsv)</button>\n              <button type="button" class="cw-repair-short" title="Repair only twice-confirmed short records" disabled hidden>Repair confirmed (0)</button>\n              <button type="button" class="cw-undo-repair" title="Undo last explicit repair" disabled hidden>Undo repair</button>\n            </div>\n          ',
    performance: '\n            <div class="cw-performance-line">Profiling is disabled.</div>\n            <div class="cw-settings-actions">\n              <button type="button" class="cw-performance-toggle">Enable profiling</button>\n              <button type="button" class="cw-performance-copy">Copy metrics</button>\n              <button type="button" class="cw-performance-reset">Reset counters</button>\n            </div>\n          ',
    aboutHelp: '\n            <details class="cw-disclosure cw-about-section" open><summary>Main window</summary>\n              <dl>\n                <dt>Mini badge and open panel</dt><dd>After a confirmed estimate, the closed badge shows an approximate midpoint and budget status; empty chats show no estimate. Drag the badge to move it. When the panel opens, the badge shows only its icon. The panel opens below, then above, then left\u2014never right\u2014and shifts left near the viewport edge. Click the badge to close, even when pinned; Pin prevents outside-click closing. Yellow: pessimistic Normal use exceeds 100%. Red: optimistic use exceeds 100% and takes priority.</dd>\n                <dt>Context / Budget forecast / Details</dt><dd>Context shows local text and attachment estimates; Budget compares both estimates with three editable budgets and calibration history; Details lists per-chat estimates and counts and offers a copyable report.</dd>\n                <dt>Optimistic / Pessimistic</dt><dd>Lower and upper heuristic context estimates; their midpoint is not a measured model token count.</dd>\n                <dt>Conservative / Normal / Generous \xB7 Budget use</dt><dd>Three adjustable token budgets. Usage (%) is the estimate divided by each budget; above 100% means that threshold is exceeded.</dd>\n              </dl>\n            </details>\n            <details class="cw-disclosure cw-about-section"><summary>Context \xB7 estimation</summary>\n              <dl>\n                <dt>Text estimation</dt><dd>Character/token ratios, word-count floor and Message overhead affect new captures or local text parsing. Existing message UUID estimates are write-once.</dd>\n                <dt>Files &amp; images</dt><dd>Parsed files use locally read content; metadata-only files use file details; unread content may use a size-based estimate.</dd>\n                <dt>History fallback (tokens)</dt><dd>Used for historical files with neither readable content nor known size. Pasted text has a separate minimum.</dd>\n                <dt>Image estimate (tokens)</dt><dd>Assumed token cost per image, not its physical size or resolution.</dd>\n                <dt>Local file parsing limit (MiB)</dt><dd>0 disables local reading of new text files and uses metadata-only; 1\u2013256 MiB enable reading (75 default).</dd>\n                <dt>Automatically pasted text</dt><dd>Unread automatically pasted text can receive a minimum estimate.</dd>\n                <dt>Attachment weights</dt><dd>Single optimistic/pessimistic contribution pair for locally parsed files, historical fallback and auto-paste minimum; independent metadata-only size estimation, image and pasted-text settings. Metadata-only parameters are editable in Stable and Dev and share Save / Restore defaults with Files & images.</dd>\n              </dl>\n            </details>\n            <details class="cw-disclosure cw-about-section"><summary>Budget forecast</summary>\n              <dl>\n                <dt>History &amp; calibration</dt><dd>Shows recorded limit samples, average message text, optimistic/pessimistic context estimates (tokens), and calibration weight. Recording a chat limit updates editable budgets; missing averages show none.</dd>\n                <dt>Token budget &amp; limits</dt><dd>Shows both estimates against Conservative, Normal and Generous budgets. Percentages may exceed 100%; Edit token budgets changes thresholds. Bars show estimated use, not ChatGPT-reported limits.</dd>\n              </dl>\n            </details>\n            <details class="cw-disclosure cw-about-section"><summary>Appearance</summary>\n              <dl>\n                <dt>Style \xB7 Sharp / Soft</dt><dd>Angular or rounded Watchdog styling, including Settings.</dd>\n                <dt>Theme \xB7 Light / Dark / System / ChatGPT</dt><dd>Choose Light/Dark, follow the OS (System) or ChatGPT theme (fallback: System). Default: Soft + ChatGPT. Choices save immediately.</dd>\n                <dt>Logo \xB7 ChatGPT / Watchdog</dt><dd>ChatGPT (default) uses a same-origin cache-only favicon with no network fallback. Missing or invalid artwork silently switches the saved choice to Watchdog. Selecting ChatGPT makes one new cache-only attempt. Watchdog avoids cache lookup and appears beside the panel title; its SVG data is never saved. Service Worker details: see Privacy & limitations.</dd>\n              </dl>\n            </details>\n            <details class="cw-disclosure cw-about-section"><summary>Settings &amp; tools</summary>\n              <dl>\n                <dt>Technical \xB7 Hidden context</dt><dd>Optional optimistic and pessimistic allowances for context the page cannot reveal.</dd>\n                <dt>History prior strength</dt><dd>Higher values reduce the influence of samples when the next calibration is recorded.</dd>\n                <dt>HANDOFF</dt><dd>Inserts the saved next-chat prompt when the composer is empty; otherwise copies it without changing the draft. Never sends automatically. Edit in Technical; only Save applies changes.</dd>\n                <dt>Record chat limit</dt><dd>At a practical limit, records this chat\u2019s estimate and updates editable budgets. Repeating replaces its sample; the chat stays open.</dd>\n                <dt>Performance</dt><dd>Optional in-memory counters and timings, off by default. Resetting them does not affect the ledger.</dd>\n              </dl>\n            </details>\n            <details class="cw-disclosure cw-about-section"><summary>Diagnostics &amp; reset</summary>\n              <dl>\n                <dt>Run Audit</dt><dd>Read-only comparison of currently rendered messages with saved UUID records.</dd>\n                <dt>Repair confirmed / Undo repair</dt><dd>Repair requires two consistent audits, a final recheck and confirmation. Undo restores the latest repair if unchanged. Both affect Watchdog records only.</dd>\n                <dt>Copy diagnostics / Export IDs (.tsv)</dt><dd>Copies diagnostics or downloads UUID data; the export contains no message text.</dd>\n                <dt>Reset position</dt><dd>Restores the badge\u2019s default position without changing estimates or budgets.</dd>\n                <dt>Reset this chat</dt><dd>After confirmation, clears this chat\u2019s ledger. Visible messages can be recaptured; unseen history may be missing.</dd>\n                <dt>Clear Watchdog data</dt><dd>After confirmation, clears Watchdog settings, chat ledgers and calibration without reloading. The badge stays in place; its position is saved with fresh defaults. Visible finished messages may be collected again. ChatGPT conversations and unrelated site data are untouched.</dd>\n              </dl>\n            </details>'
  });
  var LAZY_APPEARANCE_MARKUP = `
    <div class="cw-view-setting-row">
      <span class="cw-view-label">Style</span>
      <div class="cw-view-options" role="group" aria-label="Watchdog style">
        <button type="button" data-cw-view-style="sharp" data-cw-label="Sharp" aria-pressed="false" data-cw-tip="Angular edges and a left-beveled badge."><span>Sharp</span></button>
        <span class="cw-view-separator" aria-hidden="true">\xB7</span>
        <button type="button" data-cw-view-style="soft" data-cw-label="Soft" aria-pressed="false" data-cw-tip="Rounded edges and a rounded badge."><span>Soft</span></button>
      </div>
    </div>
    <div class="cw-view-setting-row">
      <span class="cw-view-label">Theme</span>
      <div class="cw-view-options" role="group" aria-label="Watchdog colors">
        <button type="button" data-cw-view-theme="light" data-cw-label="Light" aria-pressed="false" data-cw-tip="Light Watchdog colors."><span>Light</span></button>
        <span class="cw-view-separator" aria-hidden="true">\xB7</span>
        <button type="button" data-cw-view-theme="dark" data-cw-label="Dark" aria-pressed="false" data-cw-tip="Dark Watchdog colors."><span>Dark</span></button>
        <span class="cw-view-separator" aria-hidden="true">\xB7</span>
        <button type="button" data-cw-view-theme="system" data-cw-label="System" aria-pressed="false" data-cw-tip="Follow your device's color theme."><span>System</span></button>
        <span class="cw-view-separator" aria-hidden="true">\xB7</span>
        <button type="button" data-cw-view-theme="chatgpt" data-cw-label="ChatGPT" aria-pressed="false" data-cw-tip="Follow ChatGPT's page theme; use System when unavailable."><span>ChatGPT</span></button>
      </div>
    </div>
    <div class="cw-view-setting-row">
      <span class="cw-view-label">Logo</span>
      <div class="cw-view-options" role="group" aria-label="Badge logo source">
        <button type="button" data-cw-view-logo="openai" data-cw-label="ChatGPT" aria-pressed="false" data-cw-tip="ChatGPT logo uses cached favicon only. Switches to Watchdog if unavailable."><span>ChatGPT</span></button>
        <span class="cw-view-separator" aria-hidden="true">\xB7</span>
        <button type="button" data-cw-view-logo="watchdog" data-cw-label="Watchdog" aria-pressed="false" data-cw-tip="Use the original Watchdog logo; no cache lookup."><span>Watchdog</span></button>
      </div>
    </div>
  `;
  var LAZY_DIALOG_MARKUP = Object.freeze({
    confirm: `<dialog class="cw-settings-dialog cw-confirm-dialog" aria-labelledby="cw-confirm-heading" aria-describedby="cw-confirm-description">
          <div class="cw-dialog-header">
            <strong id="cw-confirm-heading">Confirm action</strong>
            <button type="button" class="cw-close-confirm" aria-label="Close confirmation">\u2715</button>
          </div>
          <div class="cw-limit-content">
            <p id="cw-confirm-description" class="cw-confirm-description"></p>
            <div class="cw-limit-actions">
              <button type="button" class="cw-cancel-confirm">Cancel</button>
              <button type="button" class="cw-confirm-ok">OK</button>
            </div>
          </div>
        </dialog>`,
    settings: '        <dialog class="cw-settings-dialog" aria-labelledby="cw-settings-heading">\n        <div class="cw-dialog-header">\n          <strong id="cw-settings-heading">Settings &amp; tools</strong>\n          <div class="cw-dialog-message" role="status" aria-live="polite" aria-atomic="true" hidden></div>\n          <button type="button" class="cw-close-settings" aria-label="Close settings">\u2715</button>\n        </div>\n        <div class="cw-dialog-content">\n          <div class="cw-maintenance cw-reset-line">\n            <button type="button" class="cw-reset-position">Reset badge</button>\n            <button type="button" class="cw-reset-chat">Reset chat</button>\n            <button type="button" class="cw-clear-watchdog-data">Wipe Watchdog data</button>\n          </div>\n          <div class="cw-mini-nav cw-tools-nav" aria-label="Settings and tools categories" role="tablist">\n            <button type="button" id="cw-tools-view-tab" role="tab" class="cw-mini-tab" data-cw-tools="view" aria-selected="true" tabindex="0" aria-controls="cw-tools-view">Appearance</button>\n            <button type="button" id="cw-tools-technical-tab" role="tab" class="cw-mini-tab" data-cw-tools="technical" aria-selected="false" tabindex="-1" aria-controls="cw-tools-technical">Technical</button>\n            <button type="button" id="cw-tools-diagnostics-tab" role="tab" class="cw-mini-tab" data-cw-tools="diagnostics" aria-selected="false" tabindex="-1" aria-controls="cw-tools-diagnostics">Diagnostics</button>\n            <button type="button" id="cw-tools-performance-tab" role="tab" class="cw-mini-tab" data-cw-tools="performance" aria-selected="false" tabindex="-1" aria-controls="cw-tools-performance">Performance</button>\n          </div>\n          <div id="cw-tools-view" class="cw-view-preferences cw-mini-pane" role="tabpanel" aria-labelledby="cw-tools-view-tab" hidden></div>\n          <div id="cw-tools-technical" class="cw-settings cw-mini-pane" role="tabpanel" aria-labelledby="cw-tools-technical-tab" hidden></div>\n          <div id="cw-tools-diagnostics" class="cw-diagnostics-tools cw-mini-pane" role="tabpanel" aria-labelledby="cw-tools-diagnostics-tab" hidden></div>\n          <div id="cw-tools-performance" class="cw-performance-details cw-mini-pane" role="tabpanel" aria-labelledby="cw-tools-performance-tab" hidden></div>\n        </div>\n        </dialog>',
    limit: `<dialog class="cw-settings-dialog cw-limit-dialog" aria-labelledby="cw-limit-heading" aria-describedby="cw-limit-description">
          <div class="cw-dialog-header">
            <strong id="cw-limit-heading">Record Chat Limit</strong>
            <button type="button" class="cw-close-limit" aria-label="Close Record Chat Limit">\u2715</button>
          </div>
          <div class="cw-limit-content">
            <p id="cw-limit-description">Record this chat only when it has reached a practical context or length limit.</p>
            <div class="cw-limit-estimates" aria-label="Current local context estimates">
              <div><span>Seen text</span><strong class="cw-limit-tokens">\u2014</strong></div>
              <div><span>Optimistic context</span><strong class="cw-limit-optimistic">\u2014</strong></div>
              <div><span>Pessimistic context</span><strong class="cw-limit-pessimistic">\u2014</strong></div>
            </div>
            <p class="cw-limit-consequence">This saves a calibration sample and recalibrates Conservative, Normal and Generous token budgets. It does not close or change your ChatGPT conversation.</p>
            <p class="cw-limit-replacement" hidden>A sample for this chat already exists. Recording again will replace it.</p>
            <div class="cw-limit-actions">
              <button type="button" class="cw-cancel-limit">Cancel</button>
              <button type="button" class="cw-confirm-limit">Record limit</button>
            </div>
          </div>
        </dialog>`,
    about: '        <dialog class="cw-settings-dialog cw-about-dialog" aria-labelledby="cw-about-heading">\n          <div class="cw-dialog-header">\n            <strong id="cw-about-heading">About Context Watchdog</strong>\n            <button type="button" class="cw-close-about" aria-label="Close About">\u2715</button>\n          </div>\n          <div class="cw-about-product">ChatGPT Context Watchdog (Local)</div>\n          <div class="cw-about-version">Version 1.0.0 \xB7 Designed &amp; maintained by f0rset1 \xB7 Developed with ChatGPT</div>\n          <p>Estimates captured chat text and attachments against editable token budgets.</p>\n          <details class="cw-disclosure cw-about-section"><summary>Privacy &amp; limitations</summary>\n            <p><strong>Local-only.</strong> Reads accessible page content and stores numeric estimates, message identifiers, settings and limited attachment metadata in site-local browser storage. Full message text and attachment contents are not saved in the ledger; a customized HANDOFF template is stored when saved. No chat data is sent over the network. The ChatGPT logo may request a same-origin favicon using <code>fetch</code> with <code>cache: &quot;only-if-cached&quot;</code>; a cache miss never triggers a network retry and switches to Watchdog. A controlling Service Worker blocks this lookup and also switches to Watchdog. DevTools may show a disk-cache hit in Network (0 transferred bytes).</p>\n            <p><strong>Estimates, not measurements.</strong> Hidden instructions, retrieval, compaction and actual remaining context are inaccessible.</p>\n          </details>\n          <details class="cw-disclosure cw-about-terms"><summary>Terms &amp; actions explained</summary>\n            <div class="cw-about-glossary" aria-label="Terms and actions explained"></div>\n          </details>\n          <details class="cw-disclosure cw-about-section cw-about-credit-section" open><summary>Credits</summary>\n            <div class="cw-about-credit">Tampermonkey userscript \xB7 Inspired by ideas from Pushpak1203&#39;s ChatGPT-Token_Counter.</div>\n          </details>\n        </dialog>'
  });
  var UI_MARKUP = `
      <button class="cw-chip" type="button" title="Estimated context" aria-label="Open Watchdog panel" aria-controls="${APP}-panel" aria-expanded="false">
        <span class="cw-logo-hit"><span class="cw-site-icon cw-brand-mark" aria-hidden="true"></span></span>
        <span class="cw-storage-indicator" hidden aria-label="Storage error">!</span>
        <span class="cw-range"><span class="cw-average cw-metric">\u2248 --k</span><span class="cw-paused-label" hidden>paused</span><span class="cw-budget-tab-mark cw-chip-status" data-level="pending" aria-hidden="true">
            <span class="cw-status-pending">\xB7</span>
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
              <span class="cw-local" data-cw-tip="No chat-data traffic. ChatGPT logo uses a same-origin cache-only favicon lookup; see About.">LOCAL \xB7 NO NETWORK</span>
            </span>
          </div>
          <div class="cw-toolbar" role="group" aria-label="Watchdog actions">
            <button type="button" class="cw-tool-button cw-pin-panel" aria-label="Pin panel" aria-pressed="false" aria-describedby="cw-tip-pin">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 3h8l-1 2v4l3 3v2H6v-2l3-3V5L8 3z"/><path d="M12 14v8"/></svg>
              <span class="cw-tool-tip" id="cw-tip-pin" role="tooltip">Pin panel \xB7 Keep open when clicking outside</span>
            </button>
            <button type="button" class="cw-tool-button cw-handoff-details" aria-label="HANDOFF" aria-describedby="cw-tip-handoff">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8m-4-4 4 4-4 4"/></svg>
              <span class="cw-tool-tip" id="cw-tip-handoff" role="tooltip">HANDOFF \xB7 Prepare next-chat prompt</span>
            </button>
            <button type="button" class="cw-tool-button cw-end-chat" aria-label="Record chat limit" aria-describedby="cw-tip-limit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v18l-7-5-7 5z"/><path d="m9 10 2 2 4-4"/></svg>
              <span class="cw-tool-tip" id="cw-tip-limit" role="tooltip">Record chat limit \xB7 Save calibration sample</span>
            </button>
            <button type="button" class="cw-tool-button cw-settings-btn" aria-label="Settings" aria-describedby="cw-tip-settings">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12.00,3.85 L13.95,2.19 L15.83,2.76 L16.53,5.22 L17.76,6.24 L20.31,6.44 L21.24,8.17 L19.99,10.41 L20.15,12.00 L21.81,13.95 L21.24,15.83 L18.78,16.53 L17.76,17.76 L17.56,20.31 L15.83,21.24 L13.59,19.99 L12.00,20.15 L10.05,21.81 L8.17,21.24 L7.47,18.78 L6.24,17.76 L3.69,17.56 L2.76,15.83 L4.01,13.59 L3.85,12.00 L2.19,10.05 L2.76,8.17 L5.22,7.47 L6.24,6.24 L6.44,3.69 L8.17,2.76 L10.41,4.01 Z"/><circle cx="12" cy="12" r="3"/></svg>
              <span class="cw-tool-tip" id="cw-tip-settings" role="tooltip">Settings \xB7 Technical controls and diagnostics</span>
            </button>
            <button type="button" class="cw-tool-button cw-about-btn" aria-label="About Context Watchdog" aria-describedby="cw-tip-about">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.3h.01"/></svg>
              <span class="cw-tool-tip" id="cw-tip-about" role="tooltip">About \xB7 Version, limitations and help</span>
            </button>
          </div>
          <div class="cw-notice-lane" aria-label="Watchdog notifications">
            <div class="cw-toast" role="status" aria-live="polite" aria-atomic="true" hidden></div>
          </div>
        </div>
        <div class="cw-tabs" role="tablist" aria-label="Watchdog view">
          <button type="button" role="tab" class="cw-tab-context" aria-controls="cw-context-view" aria-selected="true">Context</button>
          <button type="button" role="tab" class="cw-tab-budget" aria-controls="cw-budget-view" aria-selected="false"><span>Budget forecast</span><span class="cw-budget-tab-mark cw-budget-tab-status" data-level="pending" aria-hidden="true">
            <span class="cw-status-pending">\xB7</span>
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

  // src/ui/13-panel-styles.js
  var UI_CSS = `
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

  // src/ui/14-panel-mini-navigation.js
  function bindTabKeyboardNavigation(buttons, activate) {
    for (const [index, button] of buttons.entries()) {
      button.addEventListener("keydown", (event) => {
        const move = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : move ? (index + move + buttons.length) % buttons.length : -1;
        if (next < 0) return;
        event.preventDefault();
        activate(buttons[next]);
        buttons[next].focus();
      });
    }
  }
  function bindMiniNavigation(nav, attribute, entries, insideDialog = false, onOpen = null, options = {}) {
    const buttons = [...nav.querySelectorAll("button")];
    const isTablist = options.mode === "tabs";
    const activate = (button) => {
      const selected = button.getAttribute(attribute);
      const pane = entries[selected].pane;
      if (insideDialog && !pane.hidden) return;
      const opening = isTablist || pane.hidden;
      for (const entry of Object.values(entries)) entry.pane.hidden = true;
      for (const link of buttons) {
        const active = opening && link === button;
        link.classList.toggle("cw-mini-active", active);
        if (isTablist) {
          link.setAttribute("aria-selected", String(active));
          link.tabIndex = active ? 0 : -1;
        } else {
          link.setAttribute("aria-expanded", String(active));
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
    for (const button of buttons) button.addEventListener("click", () => activate(button));
    if (isTablist) {
      for (const button of buttons) {
        button.tabIndex = button.getAttribute("aria-selected") === "true" ? 0 : -1;
      }
      bindTabKeyboardNavigation(buttons, activate);
    }
    prepareUiControls(nav);
  }

  // src/ui/14-panel-view-coordinator.js
  function mountEstimationSection(kind, details) {
    if (details.dataset.mounted === "true") return;
    details.insertAdjacentHTML("beforeend", LAZY_ESTIMATION_MARKUP[kind]);
    details.dataset.mounted = "true";
    if (kind === "attachment") {
      details.querySelector(".cw-metadata-section").innerHTML = metadataControlsMarkup(METADATA_SETTING_SPECS);
    }
    refreshUiFields();
    bindSettingsGroup(kind);
    prepareUiControls(details);
  }
  function setPanelView(next, refresh = true) {
    if (!ui) return;
    setActivePanelView(PANEL_VIEWS.includes(next) ? next : "context");
    if (!ui.panel.hidden) mountPanelView(activePanelView);
    for (const name of PANEL_VIEWS) {
      const active = name === activePanelView;
      ui[`${name}View`].hidden = !active;
      ui[`${name}Tab`].setAttribute("aria-selected", String(active));
      ui[`${name}Tab`].tabIndex = active ? 0 : -1;
    }
    if (refresh) {
      render(loadState());
    }
  }
  function mountPanelView(name) {
    const section = ui[`${name}View`];
    if (!section || section.dataset.mounted === "true") return;
    section.insertAdjacentHTML("beforeend", LAZY_VIEW_MARKUP[name]);
    section.dataset.mounted = "true";
    refreshUiFields();
    if (name === "context") {
      bindMiniNavigation(section.querySelector(".cw-mini-nav"), "data-cw-mini", {
        text: { pane: ui.textSettingsDetails, mount: () => mountEstimationSection("text", ui.textSettingsDetails) },
        attachment: { pane: ui.attachmentSettings, mount: () => mountEstimationSection("attachment", ui.attachmentSettings) },
        coefficients: { pane: ui.advancedAttachments, mount: () => mountEstimationSection("coefficients", ui.advancedAttachments) }
      }, false, (selected) => {
        if (SETTING_GROUPS[selected]) syncGroupInputs(selected);
      });
    } else if (name === "budget") {
      const nav = section.querySelector(".cw-budget-mini-nav");
      const limits = section.querySelector(".cw-budget-limits");
      const history2 = section.querySelector(".cw-history-details");
      const editor = section.querySelector(".cw-budget-editor");
      bindMiniNavigation(nav, "data-cw-budget", {
        limits: { pane: limits, mount: () => {
        } },
        history: { pane: history2, mount: () => {
          if (history2.dataset.mounted !== "true") {
            history2.insertAdjacentHTML("beforeend", LAZY_SECTION_MARKUP.historyBody);
            history2.dataset.mounted = "true";
            refreshUiFields();
          }
        } }
      }, false, (selected) => {
        if (selected === "history") renderHistory(effectiveBudgets());
      }, { mode: "tabs" });
      editor.addEventListener("toggle", () => {
        if (editor.open && editor.dataset.mounted !== "true") {
          editor.querySelector(".cw-budget-settings").insertAdjacentHTML("beforeend", LAZY_SECTION_MARKUP.budgetForm);
          editor.dataset.mounted = "true";
          refreshUiFields();
          bindSettingsGroup("budget");
          prepareUiControls(editor);
        }
        if (editor.open) syncGroupInputs("budget");
      });
      prepareUiControls(section);
    } else if (name === "details") {
      ui.copyDetails.addEventListener("click", async () => {
        const state = loadState();
        const lines = copyableDetailText(
          buildDetailGroups(stats(state), effectiveBudgets(), hasConfirmedContext(state))
        );
        try {
          await navigator.clipboard.writeText(lines);
          showToast("Details copied.");
        } catch {
          showToast("Clipboard unavailable. Select Details text to copy.");
        }
      });
    }
    prepareUiControls(section);
  }

  // src/ui/12-panel-shell.js
  function saveBadgePosition(root) {
    const rect = root.querySelector(".cw-chip").getBoundingClientRect();
    settings.badgePosition = {
      left: Math.round(rect.left),
      top: Math.round(rect.top)
    };
    saveSettings();
  }
  var previousResizeHandler = null;
  function installBadgeDragging(root, chip) {
    if (previousResizeHandler) window.removeEventListener("resize", previousResizeHandler);
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragging = false;
    let suppressNextClick = false;
    const dragThreshold = 4;
    chip.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const rect = chip.getBoundingClientRect();
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      dragging = false;
      chip.setPointerCapture?.(pointerId);
    });
    chip.addEventListener("pointermove", (event) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) < dragThreshold) {
        return;
      }
      if (!dragging) {
        dragging = true;
        chip.classList.add("cw-dragging");
        chip.dispatchEvent(new Event("cw-badge-dragstart", { bubbles: true }));
      }
      event.preventDefault();
      const chipRect = chip.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - chipRect.width);
      const maxTop = Math.max(0, window.innerHeight - chipRect.height);
      const left = clamp(startLeft + dx, 0, maxLeft);
      const top = clamp(startTop + dy, 0, maxTop);
      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
    });
    const finishDrag = (event) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      if (dragging) {
        suppressNextClick = true;
        saveBadgePosition(root);
        placePanel();
        if (ui?.confirmDialog?.open || ui?.settingsDialog?.open || ui?.aboutDialog?.open || ui?.limitDialog?.open) fitPanelDialogToPanel();
      }
      chip.classList.remove("cw-dragging");
      chip.releasePointerCapture?.(pointerId);
      pointerId = null;
      dragging = false;
    };
    chip.addEventListener("pointerup", finishDrag);
    chip.addEventListener("pointercancel", finishDrag);
    chip.addEventListener(
      "click",
      (event) => {
        if (!suppressNextClick) return;
        suppressNextClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true
    );
    const resizeHandler = () => {
      if (!settings.badgePosition) {
        restoreDefaultBadgeAnchor(root, !ui?.panel?.hidden);
        placePanel();
        if (ui?.confirmDialog?.open || ui?.settingsDialog?.open || ui?.aboutDialog?.open || ui?.limitDialog?.open) fitPanelDialogToPanel();
        return;
      }
      const rect = chip.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - rect.height);
      const left = clamp(rect.left, 0, maxLeft);
      const top = clamp(rect.top, 0, maxTop);
      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
      placePanel();
      if (ui?.confirmDialog?.open || ui?.settingsDialog?.open || ui?.aboutDialog?.open || ui?.limitDialog?.open) fitPanelDialogToPanel();
    };
    previousResizeHandler = resizeHandler;
    window.addEventListener("resize", resizeHandler);
  }
  function openPanel() {
    ensureUiReady();
    const opening = ui.panel.hidden;
    if (opening) {
      const rect = ui.chip.getBoundingClientRect();
      ui.root.style.left = `${rect.left}px`;
      ui.root.style.top = `${rect.top}px`;
      ui.root.style.right = "auto";
      ui.root.style.bottom = "auto";
      ui.root.dataset.cwPanelOpen = "true";
      ui.chip.setAttribute("aria-label", "Close Watchdog panel");
      ui.chip.setAttribute("aria-expanded", "true");
    }
    ui.panel.hidden = false;
    const tip = ui.root.querySelector(".cw-floating-tip");
    if (tip) tip.hidden = true;
    mountPanelView(activePanelView);
    render(loadState());
    if (opening) placePanel();
  }

  // src/ui/15-panel-settings-events.js
  function dismissOpenPanelDialog() {
    if (!ui) return;
    if (ui.confirmDialog?.open) settlePanelConfirmation(false);
    else if (ui.settingsDialog?.open) closeSettingsDialog();
    else if (ui.aboutDialog?.open) closeAboutDialog();
    else if (ui.limitDialog?.open) closeLimitDialog();
  }
  function dismissWatchdogPanel() {
    if (!ui || ui.panel.hidden) return;
    dismissOpenPanelDialog();
    if (ui.settingsDialog?.open) closeSettingsDialog();
    discardUnsavedSettingsInputs();
    ui.panel.hidden = true;
    delete ui.root.dataset.cwPanelOpen;
    ui.chip.setAttribute("aria-label", "Open Watchdog panel");
    ui.chip.setAttribute("aria-expanded", "false");
    const badge = ui.chip.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - badge.width);
    if (badge.left > maxLeft) ui.root.style.left = `${maxLeft}px`;
  }
  function isBadgeLogoActivation(event) {
    if (event.detail === 0) return true;
    const icon = ui.siteIcon.getBoundingClientRect();
    const hitDiameter = parseFloat(getComputedStyle(ui.siteIcon.parentElement, "::before").width);
    const dx = event.clientX - (icon.left + icon.width / 2);
    const dy = event.clientY - (icon.top + icon.height / 2);
    return Math.hypot(dx, dy) <= hitDiameter / 2;
  }
  function syncPanelPinControl() {
    ui.pinBtn.setAttribute("aria-pressed", String(panelPinned));
    ui.pinBtn.setAttribute("aria-label", panelPinned ? "Unpin panel" : "Pin panel");
    ui.pinBtn.querySelector(".cw-tool-tip").textContent = panelPinned ? "Unpin panel \xB7 Close when clicking outside" : "Pin panel \xB7 Keep open when clicking outside";
  }
  function bindUiEvents(root) {
    installBadgeSiteIcon(root, ui.siteIcon);
    installBadgeDragging(root, ui.chip);
    const panelTabs = PANEL_VIEWS.map((name) => ui[`${name}Tab`]);
    for (const [index, tab] of panelTabs.entries()) {
      tab.addEventListener("click", () => setPanelView(PANEL_VIEWS[index]));
    }
    bindTabKeyboardNavigation(panelTabs, (tab) => setPanelView(PANEL_VIEWS[panelTabs.indexOf(tab)]));
    ui.chip.addEventListener("click", (event) => {
      if (!isBadgeLogoActivation(event)) return;
      if (!ui.panel.hidden) {
        dismissWatchdogPanel();
        return;
      }
      openPanel();
      queueConversationEvent();
    });
    ui.pauseToggle.addEventListener("click", () => {
      if (!isChatAvailable()) return;
      const wasPaused = settings.watchdogPaused === true;
      settings.watchdogPaused = !wasPaused;
      if (!saveSettings()) {
        settings.watchdogPaused = wasPaused;
        showToast("Could not save Watchdog pause preference.");
        return;
      }
      requestRunStateSync();
    });
    syncPanelPinControl();
    ui.pinBtn.addEventListener("click", () => {
      setPanelPinned(!panelPinned);
      syncPanelPinControl();
    });
    ui.aboutBtn.addEventListener("click", openAboutDialog);
    ui.settingsScrim.addEventListener("click", dismissOpenPanelDialog);
    if (!outsidePanelHandlerBound) {
      setOutsidePanelHandlerBound(true);
      document.addEventListener("pointerdown", (event) => {
        if (!ui || ui.panel.hidden || ui.root.contains(event.target)) return;
        if (!panelPinned) dismissWatchdogPanel();
      }, true);
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !ui || ui.panel.hidden) return;
        if (ui.settingsDialog?.open || ui.aboutDialog?.open || ui.limitDialog?.open) return;
        event.preventDefault();
        dismissWatchdogPanel();
        ui.chip.focus();
      });
    }
    ui.settingsBtn.addEventListener("click", openSettingsDialog);
    ui.endChat.addEventListener("click", openLimitDialog);
    ui.detailHandoff.addEventListener("click", () => {
      const prompt = settings.handoffPrompt || HANDOFF_PROMPT;
      const result = insertIntoComposer(prompt);
      if (result === "inserted") {
        showToast("HANDOFF inserted. Review before sending.");
      } else {
        copyFallback(prompt, result);
      }
    });
  }

  // src/app/10-audit-repair.js
  function repairCandidate(id, old, measured, role) {
    if (!old || old.role !== role || !["user", "assistant"].includes(role)) return null;
    if (!String(measured.fingerprint).startsWith("v3:")) return null;
    if (!["unit-markdown", "unit-user-text", "unit-user"].includes(measured.parts.source)) return null;
    const oldChars = Number(old.chars) || 0;
    if (oldChars > 64 || measured.chars < Math.max(160, oldChars * 3)) return null;
    return {
      id,
      role,
      oldChars,
      oldTokens: Number(old.tokens) || 0,
      oldFingerprint: old.fingerprint || "",
      newChars: measured.chars,
      newTokens: measured.tokens,
      newFingerprint: measured.fingerprint,
      source: measured.parts.source
    };
  }
  function repairSignature(c) {
    return JSON.stringify([
      c.id,
      c.role,
      c.oldChars,
      c.oldTokens,
      c.oldFingerprint,
      c.newChars,
      c.newTokens,
      c.newFingerprint,
      c.source
    ]);
  }
  function prepareShortRecordRepair() {
    const candidates = lastAudit?.eligibleRepairs || [];
    if (!candidates.length || lastAudit.routeUnverified || getChatKey() !== currentChatKey || getComposerMode() !== "ready" || runtime.route && !routeDomHasChanged()) {
      return { status: "not-ready" };
    }
    const summary = candidates.map(
      (c) => `${c.role} \u2026${c.id.slice(-10)}: ${c.oldChars} \u2192 ${c.newChars} chars, ${c.oldTokens} \u2192 ${c.newTokens} tokens`
    ).join("\n");
    return {
      status: "ready",
      candidates,
      chatKey: currentChatKey,
      message: `Repair ${candidates.length} confirmed incomplete stored message(s)?

${summary}

Only these saved records will be changed. Their old values will be retained for Undo. Audit is otherwise read-only.`
    };
  }
  function applyConfirmedShortRecordRepair(prepared) {
    const candidates = prepared?.candidates;
    if (!candidates?.length || prepared.chatKey !== currentChatKey || lastAudit?.eligibleRepairs !== candidates || lastAudit.routeUnverified || getChatKey() !== currentChatKey || getComposerMode() !== "ready" || runtime.route && !routeDomHasChanged()) {
      return { status: "stale" };
    }
    const state = loadState();
    const collected = collectMessageNodes();
    const byId = /* @__PURE__ */ new Map();
    const candidateIds = new Set(candidates.map((c) => c.id));
    for (const { el: node, role, id } of identifiedMessages(collected.nodes)) {
      if (trustedCollectedMessageId(id, collected) && candidateIds.has(id) && !byId.has(id)) {
        byId.set(id, { node, role });
      }
    }
    const changes = [];
    for (const candidate of candidates) {
      const entry = byId.get(candidate.id);
      const existing = state.messages[candidate.id];
      if (!entry || !existing || entry.role !== candidate.role) continue;
      const measured = getCanonicalMessageMetrics(entry.node, entry.role);
      const fresh = repairCandidate(candidate.id, existing, measured, entry.role);
      if (!fresh || repairSignature(fresh) !== repairSignature(candidate)) continue;
      if (messageBusy(entry.node)) continue;
      changes.push({ candidate: fresh, old: { ...existing } });
    }
    if (!changes.length) return { status: "changed" };
    const at = Date.now();
    for (const { candidate: c, old } of changes) {
      const updated = {
        ...old,
        role: c.role,
        chars: c.newChars,
        tokens: c.newTokens,
        fingerprint: c.newFingerprint
      };
      state.messages[c.id] = updated;
      state.repairHistory.push({ id: c.id, at, before: old, after: updated });
      if (state.repairHistory.length > 20) state.repairHistory.shift();
    }
    if (!saveState(state)) return { status: "storage-failed" };
    clearAuditConfirmation();
    return { status: "repaired", count: changes.length, state };
  }
  function prepareUndoLastAuditRepair() {
    if (getChatKey() !== currentChatKey || !currentChatKey) return { status: "stale" };
    const state = loadState();
    const item = state.repairHistory.at(-1);
    if (!item) return { status: "none" };
    if (JSON.stringify(state.messages[item.id]) !== JSON.stringify(item.after)) {
      return { status: "changed" };
    }
    return {
      status: "ready",
      item,
      chatKey: currentChatKey,
      message: `Undo last repair for \u2026${item.id.slice(-10)}? Restore ${item.before.chars} characters?`
    };
  }
  function applyUndoLastAuditRepair(prepared) {
    if (!prepared || prepared.chatKey !== currentChatKey || getChatKey() !== currentChatKey || !currentChatKey) return { status: "stale" };
    const freshState = loadState();
    const freshItem = freshState.repairHistory.at(-1);
    if (!freshItem || JSON.stringify(freshItem) !== JSON.stringify(prepared.item) || JSON.stringify(freshState.messages[freshItem.id]) !== JSON.stringify(freshItem.after)) {
      return { status: "changed" };
    }
    freshState.messages[freshItem.id] = freshItem.before;
    freshState.repairHistory.pop();
    if (!saveState(freshState)) return { status: "storage-failed" };
    clearAuditConfirmation();
    return { status: "undone", state: freshState };
  }
  function messageIdExport() {
    const chatKey = getChatKey();
    if (!chatKey) return null;
    const state = loadState(chatKey);
    const rows = /* @__PURE__ */ new Map();
    let storedCount = 0;
    let invalidSavedKeys = 0;
    const idPattern = MESSAGE_KEY_RE;
    for (const [key, record] of Object.entries(state.messages || {})) {
      const matched = idPattern.exec(key);
      if (!matched) {
        invalidSavedKeys++;
        continue;
      }
      storedCount++;
      const uuid = matched[1].toLowerCase();
      rows.set(`msg:${uuid}`, {
        uuid,
        role: record?.role || "unknown",
        chars: Number(record?.chars) || 0,
        tokens: Number(record?.tokens) || 0,
        fingerprint: String(record?.fingerprint || ""),
        stored: true,
        storedOrder: storedCount,
        visible: false,
        domOrder: "",
        ambiguous: false
      });
    }
    const routeUnverified = !!runtime.route || chatKey !== currentChatKey;
    let rawVisible = 0;
    let noIdVisible = 0;
    let ambiguousVisible = 0;
    if (!routeUnverified) {
      const collected = collectMessageNodes();
      rawVisible = collected.nodes.length;
      for (const { index, role, id } of identifiedMessages(collected.nodes)) {
        if (!id) {
          noIdVisible++;
          continue;
        }
        const matched = idPattern.exec(id);
        if (!matched) {
          noIdVisible++;
          continue;
        }
        const key = `msg:${matched[1].toLowerCase()}`;
        const ambiguous = collected.ambiguousIds.has(key);
        if (ambiguous) ambiguousVisible++;
        let row = rows.get(key);
        if (!row) {
          row = {
            uuid: matched[1].toLowerCase(),
            role: role || "unknown",
            chars: "",
            tokens: "",
            fingerprint: "",
            stored: false,
            storedOrder: "",
            visible: false,
            domOrder: "",
            ambiguous: false
          };
          rows.set(key, row);
        }
        row.visible = true;
        row.domOrder = index + 1;
        row.ambiguous = row.ambiguous || ambiguous;
      }
    }
    const records = [...rows.values()];
    const visibleCount = records.filter((x) => x.visible).length;
    const visibleOnlyCount = records.filter((x) => x.visible && !x.stored).length;
    const lines = [
      `# Watchdog UUID diagnostic (read-only; state:v2)`,
      `# Chat: ${chatKey}`,
      `# Exported: ${(/* @__PURE__ */ new Date()).toISOString()}`,
      `# Saved UUIDs: ${storedCount}; visible UUIDs: ${visibleCount}; visible but not saved: ${visibleOnlyCount}`,
      `# Current DOM: ${routeUnverified ? "NOT VERIFIED (visible flags omitted)" : "verified against current route"}; DOM units: ${rawVisible}; no UUID: ${noIdVisible}; ambiguous: ${ambiguousVisible}`,
      `# Invalid saved keys: ${invalidSavedKeys}`,
      `# Stored order is insertion order, NOT chronological chat order. DOM order applies only to currently rendered units.`,
      `# The export includes no message text or file contents.`,
      "stored_order	uuid	role	chars	tokens	fingerprint	in_dom	dom_order	status"
    ];
    for (const row of records) {
      const status = row.ambiguous ? "ambiguous-visible" : row.stored && row.visible ? "saved+visible" : row.stored ? "saved" : "visible-only";
      lines.push([
        row.storedOrder,
        row.uuid,
        row.role,
        row.chars,
        row.tokens,
        row.fingerprint,
        row.visible ? "yes" : "no",
        row.domOrder,
        status
      ].join("	"));
    }
    return {
      chatKey,
      storedCount,
      visibleCount,
      visibleOnlyCount,
      routeUnverified,
      tsv: lines.join("\n") + "\n"
    };
  }
  function compareStoredMessageMetrics(stored, observed) {
    const oldChars = Number(stored.chars) || 0;
    const oldTokens = Number(stored.tokens) || 0;
    const fingerprint = String(stored.fingerprint || "");
    const fingerprintStatus = !fingerprint ? "unavailable" : fingerprint === observed.fingerprint ? "same" : "changed";
    const charsChanged = oldChars !== observed.chars;
    const tokensChanged = oldTokens !== observed.tokens;
    const hashChanged = fingerprintStatus === "changed";
    return {
      oldChars,
      oldTokens,
      charsChanged,
      tokensChanged,
      hashChanged,
      fingerprintStatus,
      different: charsChanged || tokensChanged || hashChanged
    };
  }
  function auditVisibleMessages() {
    synchronizeChatRoute();
    if (!currentChatKey) {
      return null;
    }
    const routeUnverified = !!runtime.route && !routeDomHasChanged();
    if (!routeUnverified) setSessionPhase(getComposerMode(), false);
    const state = loadState();
    const collected = collectMessageNodes();
    rememberCollected(collected);
    const result = {
      at: Date.now(),
      visible: collected.nodes.length,
      routeUnverified,
      // results are observational, never persisted
      raw: collected.rawCount,
      collapsed: collected.collapsed,
      verified: 0,
      missing: 0,
      storedShort: 0,
      domShort: 0,
      different: 0,
      roleChanged: 0,
      noStableId: 0,
      duplicateIds: 0,
      ambiguous: 0,
      unhydrated: 0,
      scopeCounts: {
        "unit-user-text": 0,
        "unit-user": 0,
        "unit-markdown": 0,
        "unit-assistant": 0,
        fallback: 0
      },
      contentRoots: 0,
      examples: [],
      eligibleRepairs: [],
      repairCandidates: 0,
      repairRepeatNeeded: 0,
      differenceReasons: { chars: 0, tokens: 0, fingerprint: 0, hashOnly: 0 }
    };
    const seen = /* @__PURE__ */ new Set();
    const newRepairCandidates = /* @__PURE__ */ new Map();
    result.unitRoles = { user: 0, assistant: 0, realIds: 0 };
    const sample = (kind, id, stored, measured, comparison = null) => {
      if (result.examples.length >= 6) return;
      result.examples.push({
        kind,
        idSuffix: String(id).slice(-10),
        storedChars: stored ? Number(stored.chars) || 0 : null,
        domChars: measured?.chars ?? null,
        storedTokens: stored ? Number(stored.tokens) || 0 : null,
        domTokens: measured?.tokens ?? null,
        fingerprintStatus: comparison?.fingerprintStatus || "n/a",
        reasons: comparison ? [
          ...comparison.charsChanged ? ["chars"] : [],
          ...comparison.tokensChanged ? ["tokens"] : [],
          ...comparison.hashChanged ? ["fingerprint"] : []
        ] : [],
        proseChars: measured?.parts?.prose?.length ?? null,
        codeChars: measured?.parts?.code?.length ?? null,
        scope: measured?.parts?.source || null,
        roots: measured?.parts?.roots ?? null
      });
    };
    for (const { el, role, id } of identifiedMessages(collected.nodes)) {
      if (searchUnitInfo(el)) {
        result.unitRoles[role] = (result.unitRoles[role] || 0) + 1;
        if (id?.startsWith("msg:")) result.unitRoles.realIds++;
      }
      if (!id) {
        result.noStableId++;
        sample("no-id", role);
        continue;
      }
      if (seen.has(id)) {
        result.duplicateIds++;
        sample("duplicate-id", id);
        continue;
      }
      seen.add(id);
      if (collected.ambiguousIds.has(id)) {
        result.ambiguous++;
        sample("ambiguous-dom", id);
        continue;
      }
      const existing = state.messages[id];
      const measured = getCanonicalMessageMetrics(el, role);
      result.contentRoots += measured.parts.roots;
      result.scopeCounts[measured.parts.source] = (result.scopeCounts[measured.parts.source] || 0) + 1;
      if (!measured.chars || existing && Number(existing.chars) >= 80 && measured.chars < 40) {
        result.unhydrated++;
        sample("unhydrated", id, existing, measured);
        continue;
      }
      if (!existing) {
        result.missing++;
        sample("missing", id, null, measured);
        continue;
      }
      const comparison = compareStoredMessageMetrics(existing, measured);
      const { oldChars } = comparison;
      if (["user", "assistant"].includes(existing.role) && ["user", "assistant"].includes(role) && existing.role !== role) {
        result.roleChanged++;
        sample("role", id, existing, measured);
      }
      if (oldChars <= 64 && measured.chars >= Math.max(160, oldChars * 3)) {
        result.storedShort++;
        sample("stored-short", id, existing, measured, comparison);
        const candidate = !routeUnverified && runtime.phase === "ready" && !messageBusy(el) && repairCandidate(id, existing, measured, role);
        if (candidate) {
          newRepairCandidates.set(id, candidate);
          if (priorRepairCandidates.has(id) && repairSignature(priorRepairCandidates.get(id)) === repairSignature(candidate)) {
            result.eligibleRepairs.push(candidate);
          } else {
            result.repairRepeatNeeded++;
          }
        }
      } else if (oldChars >= 80 && measured.chars <= Math.max(24, oldChars * 0.35)) {
        result.domShort++;
        sample("dom-short", id, existing, measured, comparison);
      } else if (comparison.different) {
        result.different++;
        if (comparison.charsChanged) result.differenceReasons.chars++;
        if (comparison.tokensChanged) result.differenceReasons.tokens++;
        if (comparison.hashChanged) result.differenceReasons.fingerprint++;
        if (comparison.hashChanged && !comparison.charsChanged && !comparison.tokensChanged) {
          result.differenceReasons.hashOnly++;
        }
        sample("different", id, existing, measured, comparison);
      } else {
        result.verified++;
      }
    }
    result.repairCandidates = newRepairCandidates.size;
    setPriorRepairCandidates(newRepairCandidates);
    setLastAudit(result);
    setLastScanReason("manual Audit (read-only)");
    return result;
  }

  // src/ui/15-panel-audit-actions.js
  function repairConfirmedShortRecords() {
    if (isWatchdogPaused()) {
      showToast("Resume Watchdog before repairing records.");
      return 0;
    }
    const prepared = prepareShortRecordRepair();
    if (prepared.status !== "ready") {
      showToast("Run Audit twice on a ready chat to confirm incomplete stored records.");
      return 0;
    }
    requestPanelConfirmation(prepared.message, () => {
      if (isWatchdogPaused()) {
        showToast("Resume Watchdog before repairing records.");
        return;
      }
      const result = applyConfirmedShortRecordRepair(prepared);
      if (result.status === "repaired") {
        render(result.state);
        showToast(`Repaired ${result.count} confirmed message(s); Undo is available.`);
      } else if (result.status === "stale") {
        showToast("Chat or audit changed. Run Audit again before repairing.");
      } else if (result.status === "changed") {
        showToast("Nothing repaired: DOM or stored values changed. Run Audit again.");
      } else render(loadState());
    });
    return 0;
  }
  function undoLastAuditRepair() {
    if (isWatchdogPaused()) {
      showToast("Resume Watchdog before Undo repair.");
      return false;
    }
    const prepared = prepareUndoLastAuditRepair();
    if (prepared.status !== "ready") {
      if (prepared.status === "none") showToast("No Audit repair to undo.");
      else if (prepared.status === "changed")
        showToast("Undo refused: the saved message changed after the repair.");
      return false;
    }
    requestPanelConfirmation(prepared.message, () => {
      if (isWatchdogPaused()) {
        showToast("Resume Watchdog before Undo repair.");
        return;
      }
      const result = applyUndoLastAuditRepair(prepared);
      if (result.status === "undone") {
        render(result.state);
        showToast("Last repair undone.");
      } else if (result.status === "changed" || result.status === "stale") {
        showToast("Undo refused: saved records changed.");
      } else render(loadState());
    });
    return false;
  }
  function downloadMessageIds() {
    const snapshot = messageIdExport();
    if (!snapshot) {
      showToast("Open a chat with a UUID before exporting message IDs.");
      return;
    }
    const blob = new Blob(["\uFEFF", snapshot.tsv], {
      type: "text/tab-separated-values;charset=utf-8"
    });
    let url = null;
    let link = null;
    try {
      url = URL.createObjectURL(blob);
      link = document.createElement("a");
      link.href = url;
      link.download = `watchdog-ids-${snapshot.chatKey.slice(5)}.tsv`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      showToast(`Exported ${snapshot.storedCount} saved UUIDs; ${snapshot.visibleCount} visible, ${snapshot.visibleOnlyCount} visible-only.${snapshot.routeUnverified ? " DOM unverified." : ""}`);
    } catch (err) {
      showUnexpectedError("Export IDs", err);
    } finally {
      link?.remove();
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1e3);
    }
  }
  function runAudit() {
    if (isWatchdogPaused()) {
      showToast("Resume Watchdog before Audit.");
      return null;
    }
    const result = auditVisibleMessages();
    if (!result) showToast("Audit requires an open chat with a UUID.");
    else render(loadState());
    return result;
  }

  // src/ui/15-panel-action-handlers.js
  function bindPanelDialogActions(kind) {
    if (kind === "settings") {
      ui.closeSettings.addEventListener("click", closeSettingsDialog);
      bindPanelDialogDismissal(ui.settingsDialog, closeSettingsDialog);
      bindMiniNavigation(ui.settingsDialog.querySelector(".cw-tools-nav"), "data-cw-tools", {
        view: { pane: ui.settingsDialog.querySelector("#cw-tools-view"), mount: () => {
          const pane = ui.settingsDialog.querySelector("#cw-tools-view");
          if (pane.dataset.mounted === "true") return;
          pane.innerHTML = LAZY_APPEARANCE_MARKUP;
          pane.dataset.mounted = "true";
          for (const button of pane.querySelectorAll("[data-cw-view-style], [data-cw-view-theme], [data-cw-view-logo]")) {
            button.addEventListener("click", () => changeViewPreference(
              button.hasAttribute("data-cw-view-style") ? "style" : button.hasAttribute("data-cw-view-logo") ? "logo" : "theme",
              button.dataset.cwViewStyle || button.dataset.cwViewTheme || button.dataset.cwViewLogo
            ));
          }
          syncViewControls();
          prepareUiControls(pane);
        } },
        technical: { pane: ui.settingsDialog.querySelector("#cw-tools-technical"), mount: () => {
          const pane = ui.settingsDialog.querySelector("#cw-tools-technical");
          if (pane.dataset.mounted === "true") return;
          pane.insertAdjacentHTML("beforeend", LAZY_SECTION_MARKUP.technicalForm);
          pane.dataset.mounted = "true";
          refreshUiFields();
          bindSettingsGroup("technical");
          bindHandoffEditor();
          prepareUiControls(pane);
        } },
        diagnostics: { pane: ui.diagnosticsDetails, mount: () => {
          mountPanelSubsection("diagnostics");
          const state = loadState();
          renderDiagnostics(stats(state), state);
          renderRunState();
        } },
        performance: { pane: ui.performanceDetails, mount: () => {
          mountPanelSubsection("performance");
          renderPerformance();
        } }
      }, true, (selected) => {
        if (SETTING_GROUPS[selected]) syncGroupInputs(selected);
      }, { mode: "tabs" });
      ui.settingsDialog.querySelector('[data-cw-tools="view"]').click();
      ui.resetPosition.addEventListener("click", () => {
        settings.badgePosition = null;
        if (!saveSettings()) {
          setSettings(loadSettings());
          return;
        }
        restoreDefaultBadgeAnchor(ui.root, !ui.panel.hidden);
        if (!ui.panel.hidden) {
          placePanel();
          fitPanelDialogToPanel();
        }
        showToast("Badge position reset.");
      });
      ui.resetChat.addEventListener("click", () => {
        requestPanelConfirmation(
          "Reset local counts for this chat? The Watchdog will then collect already finished messages as they reappear in the DOM (including on scroll). Unseen messages cannot be recovered.",
          () => {
            if (currentChatKey) {
              try {
                localStorage.removeItem(stateKey());
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
                reportStorageFailure(currentChatKey, "RESET FAILED: localStorage could not remove this entry.", err);
                render(loadState());
                return;
              }
            } else setTransientState(emptyState(null));
            pendingLocalFiles.length = 0;
            clearAuditConfirmation();
            hydrationCandidates.clear();
            setInspectedFileTurns(/* @__PURE__ */ new WeakMap());
            setInspectedImageTurns(/* @__PURE__ */ new WeakMap());
            setLastBackfillDeferred(0);
            requestInitialInspection();
            requestBackfill();
            if (!isWatchdogPaused()) scanMessages({ backfill: true, reason: "state reset / visible-message backfill" });
            showToast("Chat reset. Finished messages are collected again when visible.");
          }
        );
      });
      ui.clearWatchdogData.addEventListener("click", () => {
        requestPanelConfirmation(
          "Permanently delete ALL Context Watchdog local data on this site?\nThis includes every chat ledger, calibration history, settings and panel position.\nChatGPT conversations and unrelated site data will not be deleted.\nVisible finished messages may be indexed again without reloading ChatGPT.",
          () => {
            const rect = ui.chip.getBoundingClientRect();
            const badgePosition = { left: Math.round(rect.left), top: Math.round(rect.top) };
            try {
              const owned = [];
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(`${APP}:`)) owned.push(key);
              }
              for (const key of owned) localStorage.removeItem(key);
              for (let i = 0; i < localStorage.length; i++) {
                if (localStorage.key(i)?.startsWith(`${APP}:`))
                  throw new Error("Watchdog storage still contains owned keys");
              }
            } catch (err) {
              showUnexpectedError("Wipe", err, "Wipe incomplete");
              return;
            }
            clearUiErrors();
            const invalidatedChats = /* @__PURE__ */ new Set([
              ...ledgerResetEpochs.keys(),
              currentChatKey,
              ...pendingTransientPromotions.keys(),
              ...[...pendingFileResults.values()].map((job) => job.chatKey)
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
            setLastScanReason("Watchdog data wiped");
            setLastBackfillDeferred(0);
            hydrationCandidates.clear();
            if (hydrationCheckTimer) clearTimeout(hydrationCheckTimer);
            setHydrationCheckTimer(0);
            if (deferredConversationFrame) cancelAnimationFrame(deferredConversationFrame);
            setDeferredConversationFrame(0);
            setInspectedFileTurns(/* @__PURE__ */ new WeakMap());
            setInspectedImageTurns(/* @__PURE__ */ new WeakMap());
            setDirtyFileTurns(/* @__PURE__ */ new WeakSet());
            setDirtyImageTurns(/* @__PURE__ */ new WeakSet());
            clearAuditConfirmation();
            corruptLedgerKeys.clear();
            storageFailures.clear();
            setStorageWarningShown(false);
            setHistoryCache(null);
            setHistorySummaryCache(null);
            setCalibrationHistoryCorrupt(false);
            setSettings(loadSettings());
            settings.badgePosition = badgePosition;
            const badgePositionSaved = saveSettings();
            requestRunStateSync();
            resetPerformance();
            perf.enabled = false;
            requestInitialInspection();
            requestBackfill();
            setCompletionPending(false);
            applyAppearance();
            refreshBadgeSiteIcon(true, badgePositionSaved);
            syncViewControls();
            discardUnsavedSettingsInputs();
            syncHandoffEditor(true);
            renderPerformance();
            render(loadState());
            showToast(badgePositionSaved ? "Watchdog data cleared." : "Watchdog data cleared; could not save the current badge position.");
          }
        );
      });
    } else if (kind === "about") {
      ui.closeAbout.addEventListener("click", closeAboutDialog);
      bindPanelDialogDismissal(ui.aboutDialog, closeAboutDialog);
      ui.aboutGlossary.insertAdjacentHTML("beforeend", LAZY_SECTION_MARKUP.aboutHelp);
      ui.aboutGlossary.dataset.mounted = "true";
    } else if (kind === "confirm") {
      ui.closeConfirm.addEventListener("click", () => settlePanelConfirmation(false));
      ui.cancelConfirm.addEventListener("click", () => settlePanelConfirmation(false));
      ui.confirmOk.addEventListener("click", () => settlePanelConfirmation(true));
      bindPanelDialogDismissal(ui.confirmDialog, () => settlePanelConfirmation(false));
      ui.confirmDialog.addEventListener("close", () => settlePanelConfirmation(false));
    } else {
      ui.closeLimit.addEventListener("click", closeLimitDialog);
      ui.cancelLimit.addEventListener("click", closeLimitDialog);
      bindPanelDialogDismissal(ui.limitDialog, closeLimitDialog);
      ui.confirmLimit.addEventListener("click", confirmChatLimitDialog);
    }
  }
  function mountPanelSubsection(kind) {
    const details = kind === "diagnostics" ? ui.diagnosticsDetails : ui.performanceDetails;
    if (details.dataset.mounted === "true") return;
    details.insertAdjacentHTML("beforeend", LAZY_SECTION_MARKUP[kind]);
    details.dataset.mounted = "true";
    refreshUiFields();
    if (kind === "diagnostics") {
      ui.copyDiagnostics.addEventListener("click", async () => {
        const state = loadState();
        const controls = readComposerControlsForDiagnostics();
        renderDiagnostics(stats(state), state, {
          ...lastUiSignals,
          ...controls,
          actions: controls.stop || controls.send ? null : lastUiSignals.actions
        });
        try {
          await navigator.clipboard.writeText(ui.diagnosticsLine.textContent || "");
          showToast("Diagnostics copied.");
        } catch {
          showToast("Clipboard unavailable. Select diagnostics text to copy.");
        }
      });
      ui.exportIds.addEventListener("click", downloadMessageIds);
      ui.repairShort.addEventListener("click", repairConfirmedShortRecords);
      ui.undoRepair.addEventListener("click", undoLastAuditRepair);
      ui.rescan.addEventListener("click", () => {
        const audit = runAudit();
        if (!audit) return;
        const state = loadState();
        renderDiagnostics(stats(state), state);
        if (audit.routeUnverified) {
          showToast("Audit completed read-only: chat DOM still switching; results are provisional.");
          return;
        }
        const issues = audit.missing + audit.storedShort + audit.domShort + audit.different + audit.roleChanged + audit.noStableId + audit.duplicateIds + audit.ambiguous + audit.unhydrated;
        showToast(issues ? `Audit: ${issues} possible issues, ${audit.verified} verified. See Diagnostics.` : `Audit: ${audit.verified} verified, no detected issues in rendered messages.`);
      });
    } else {
      ui.performanceToggle.addEventListener("click", () => {
        perf.enabled = !perf.enabled;
        renderPerformance();
        fitPanelDialogToPanel();
        showToast(perf.enabled ? "Profiling enabled." : "Profiling paused.");
      });
      ui.performanceCopy.addEventListener("click", async () => {
        renderPerformance();
        try {
          await navigator.clipboard.writeText(ui.performanceLine.textContent || "");
          showToast("Metrics copied.");
        } catch {
          showToast("Clipboard unavailable. Select Performance text to copy.");
        }
      });
      ui.performanceReset.addEventListener("click", () => {
        resetPerformance();
        renderPerformance();
        showToast("Counters reset.");
      });
    }
    prepareUiControls(details);
  }

  // src/ui/15-panel-dialog-mount.js
  function mountPanelDialog(kind) {
    const field = kind === "settings" ? "settingsDialog" : kind === "about" ? "aboutDialog" : kind === "limit" ? "limitDialog" : "confirmDialog";
    if (ui[field]) return;
    ui.panelFrame.insertAdjacentHTML("beforeend", LAZY_DIALOG_MARKUP[kind]);
    refreshUiFields();
    observePanelDialogLayout(ui[field]);
    bindPanelDialogActions(kind);
    prepareUiControls(ui[field]);
  }

  // src/ui/15-panel-ui-coordinator.js
  function ensureUI() {
    if (ui && document.documentElement.contains(ui.root)) return ui;
    if (ui) {
      captureHandoffDraftForRemount();
      disposePanelDialogObservers(ui.root);
      resetPanelDialogsForRemount();
    }
    const root = document.createElement("div");
    root.id = `${APP}-root`;
    root.dataset.cwStyle = settings.viewStyle;
    root.dataset.cwPalette = resolvedViewPalette();
    root.innerHTML = UI_MARKUP;
    root.querySelector(".cw-title-info .cw-brand-mark").replaceChildren(createWatchdogLogo(root.ownerDocument));
    if (!document.getElementById(`${APP}-style`)) {
      const style = document.createElement("style");
      style.id = `${APP}-style`;
      style.textContent = UI_CSS;
      document.documentElement.appendChild(style);
    }
    document.body.appendChild(root);
    applySavedBadgePosition(root);
    setUi({ root, ...collectUiFields(root) });
    bindPanelDialogHooks(mountPanelDialog, discardUnsavedSettingsInputs);
    bindBudgetFieldRefresh(() => syncGroupInputs("budget", true));
    bindUiEvents(root);
    installUiHints(root);
    prepareUiControls(root);
    setPanelView(activePanelView, false);
    return ui;
  }

  // src/app/17-spa-observer-startup.js
  var FILE_USER_TURN_SELECTOR = '[data-chatgpt-search-unit-key$=":user"], [data-chatgpt-search-unit-key="user"], [data-message-id][data-message-author-role="user"], [data-message-id][data-message-role="user"]';
  function markFileTurnDirty(mutation, batchTurnCache = null) {
    const target = mutation.target.nodeType === Node.TEXT_NODE ? mutation.target.parentElement : mutation.target;
    if (!(target instanceof Element)) return;
    let turn = batchTurnCache?.get(target);
    if (!turn) {
      const assistant = !!target.closest('[data-chatgpt-search-unit-key$=":assistant"], [data-chatgpt-search-unit-key="assistant"]');
      turn = { assistant, user: assistant ? null : target.closest(FILE_USER_TURN_SELECTOR) };
      batchTurnCache?.set(target, turn);
    }
    if (turn.assistant) return;
    if (turn.user) {
      dirtyFileTurns.add(turn.user);
      if (mutation.type !== "characterData") dirtyImageTurns.add(turn.user);
    }
    if (mutation.type !== "childList") return;
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches(FILE_USER_TURN_SELECTOR)) {
        dirtyFileTurns.add(node);
        dirtyImageTurns.add(node);
      } else if (node.querySelector(FILE_USER_TURN_SELECTOR)) {
        for (const nested of node.querySelectorAll(FILE_USER_TURN_SELECTOR)) {
          dirtyFileTurns.add(nested);
          dirtyImageTurns.add(nested);
        }
      }
    }
  }
  function mutationTouchesConversation(mutation, urgency = null) {
    const root = document.getElementById(`${APP}-root`);
    let target = mutation.target;
    if (target?.nodeType === Node.TEXT_NODE) target = target.parentElement;
    if (root && target instanceof Element && root.contains(target)) return false;
    if (mutation.type === "attributes" && ["aria-busy", "aria-hidden", "inert"].includes(mutation.attributeName) && target instanceof Element && (target.matches("main") || target.closest("main") || target.querySelector("main [data-chatgpt-search-unit-key], main [data-message-id]"))) {
      if (runtime.phase !== "generating") requestBackfill();
      if (urgency) urgency.value = true;
      return true;
    }
    if (target instanceof Element && target.closest("form[data-chatgpt-composer], #composer-background, #prompt-textarea")) {
      if (urgency) urgency.value = true;
      return true;
    }
    if (runtime.phase === "generating" && mutation.type === "characterData") return false;
    if (target instanceof Element && isFinishedActionNode(target)) {
      if (runtime.phase !== "generating") requestBackfill();
      if (urgency) urgency.value = true;
      return true;
    }
    for (const node of mutation.addedNodes || []) {
      if (!(node instanceof Element)) continue;
      if (root && root.contains(node)) continue;
      if (isFinishedActionNode(node)) {
        if (runtime.phase !== "generating") requestBackfill();
        if (urgency) urgency.value = true;
        return true;
      }
      if (node.matches?.("form[data-chatgpt-composer], #composer-background") || node.querySelector?.("form[data-chatgpt-composer], #composer-background")) {
        if (urgency) urgency.value = true;
        return true;
      }
    }
    if (runtime.phase === "generating") {
      if (!pendingLocalFiles.some((item) => isActiveSubmittedFile(item, currentChatKey) && !item.boundMessageId)) return false;
      if (target instanceof Element && (target.matches(FILE_USER_TURN_SELECTOR) || target.closest(FILE_USER_TURN_SELECTOR))) return true;
      for (const node of mutation.addedNodes || []) {
        if (node instanceof Element && (node.matches(FILE_USER_TURN_SELECTOR) || node.querySelector(FILE_USER_TURN_SELECTOR))) return true;
      }
      return false;
    }
    const needsContent = runtime.work.initial || runtime.work.completion && runtime.phase !== "generating";
    const contentSelector = "main [data-chatgpt-search-unit-key], main [data-turn-key], main [data-message-id], main [data-message-author-role]";
    const inMessage = target instanceof Element && (!!target.closest?.(contentSelector) || target.matches?.("main"));
    let mounted = false;
    for (const node of mutation.addedNodes || []) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.("main, [data-chatgpt-search-unit-key], [data-turn-key], [data-message-id]") || node.querySelector?.("[data-chatgpt-search-unit-key], [data-turn-key], [data-message-id]")) {
        mounted = true;
        break;
      }
    }
    if (inMessage || mounted) {
      requestBackfill();
      return true;
    }
    return !!(needsContent && target instanceof Element && target.closest?.("main"));
  }
  function installObserver() {
    if (isWatchdogPaused()) return;
    if (observer) observer.disconnect();
    setObserver(new MutationObserver((mutations) => {
      if (isWatchdogPaused()) return;
      const started = perfStart();
      try {
        let needsEvent = false, urgent = false, pageMutations = 0;
        const urgency = { value: false };
        const seenTextNodes = mutations.length > 1 ? /* @__PURE__ */ new WeakSet() : null;
        const batchTurnCache = mutations.length > 1 ? /* @__PURE__ */ new WeakMap() : null;
        for (const mutation of mutations) {
          if (ui?.root && (mutation.target === ui.root || ui.root.contains(mutation.target))) continue;
          pageMutations++;
          if (seenTextNodes && mutation.type === "characterData") {
            if (seenTextNodes.has(mutation.target)) {
              if (perf.enabled) perf.duplicateTextMutations++;
              continue;
            }
            seenTextNodes.add(mutation.target);
          }
          markFileTurnDirty(mutation, batchTurnCache);
          if (!document.hidden && !urgent) {
            urgency.value = false;
            if (mutationTouchesConversation(mutation, urgency)) needsEvent = true;
            if (urgency.value) urgent = true;
          } else if (document.hidden && mutation.type !== "characterData" && pendingLocalFiles.some((item) => isActiveSubmittedFile(item, currentChatKey) && !item.boundMessageId)) {
            let target = mutation.target;
            if (target?.nodeType === Node.TEXT_NODE) target = target.parentElement;
            if (target instanceof Element && (target.matches(FILE_USER_TURN_SELECTOR) || target.closest(FILE_USER_TURN_SELECTOR))) needsEvent = true;
            for (const node of mutation.addedNodes || []) {
              if (node instanceof Element && (node.matches(FILE_USER_TURN_SELECTOR) || node.querySelector(FILE_USER_TURN_SELECTOR))) needsEvent = true;
            }
          }
        }
        if (perf.enabled && pageMutations) {
          perf.mutationBatches++;
          perf.mutations += pageMutations;
        }
        if (needsEvent) queueConversationEvent(urgent ? "urgent" : "background");
      } finally {
        perfEnd("observerCallback", started);
      }
    }));
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "data-testid",
        "aria-label",
        "aria-busy",
        "aria-hidden",
        "inert",
        "hidden",
        "disabled",
        "class",
        "style",
        "data-state",
        "aria-disabled",
        "data-chatgpt-search-unit-key",
        "data-chatgpt-search-message-ids",
        "data-message-id",
        "data-message-author-role",
        "data-message-role",
        "title",
        "download",
        "href",
        "src",
        "srcset",
        "sizes",
        "width",
        "height",
        "alt",
        "media",
        "type"
      ]
    });
  }
  var availableComposer = null;
  var heavyObserving = false;
  var lastRoutePath = "";
  var availabilityObserver = null;
  var routeAvailabilityFrame = 0;
  function installAvailabilityObserver() {
    if (availabilityObserver) availabilityObserver.disconnect();
    availabilityObserver = new MutationObserver((mutations) => {
      if (ui && !ui.root.isConnected) {
        ensureUI();
        renderRunState();
      }
      const checkedSubtrees = mutations.length > 1 ? /* @__PURE__ */ new WeakMap() : null;
      if (!mutations.some((mutation) => {
        const target = mutation.target;
        if (ui?.root && (target === ui.root || ui.root.contains(target))) return false;
        return mutationMayChangeChatAvailability(mutation, availableComposer, checkedSubtrees);
      })) return;
      refreshChatAvailability();
    });
    availabilityObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "aria-hidden", "inert", "class", "style"]
    });
  }
  function refreshChatAvailability() {
    availableComposer = findAvailableChatComposer();
    if (setChatAvailable(!!availableComposer)) synchronizeRunState();
  }
  function synchronizeRunState() {
    if (isWatchdogPaused()) {
      if (heavyObserving) {
        observer?.disconnect();
        heavyObserving = false;
      }
      if (deferredConversationFrame) {
        cancelAnimationFrame(deferredConversationFrame);
        setDeferredConversationFrame(0);
      }
      if (hydrationCheckTimer) {
        clearTimeout(hydrationCheckTimer);
        setHydrationCheckTimer(0);
      }
    } else if (!heavyObserving) {
      const next = getChatKey();
      if (next !== currentChatKey) {
        const previousIds = currentChatKey ? new Set(Object.keys(loadState(currentChatKey).messages || {})) : /* @__PURE__ */ new Set();
        changeChatKey(next);
        if (next && previousIds.size) {
          startRouteTransition(
            { beforeIds: previousIds, beforeNodes: /* @__PURE__ */ new WeakMap() },
            previousIds,
            false
          );
        }
      }
      setInspectedImageTurns(/* @__PURE__ */ new WeakMap());
      installObserver();
      heavyObserving = true;
      requestInitialInspection();
      requestBackfill();
      resumePausedFileJobs();
      queueConversationEvent();
    }
    renderRunState();
  }
  function watchRouteChanges() {
    const onNavigation = () => {
      const pathChanged = location.pathname !== lastRoutePath;
      lastRoutePath = location.pathname;
      if (!pathChanged) return;
      if (!isWatchdogPaused()) synchronizeChatRoute();
      if (setChatAvailable(false)) synchronizeRunState();
      if (!routeAvailabilityFrame) {
        routeAvailabilityFrame = requestAnimationFrame(() => {
          routeAvailabilityFrame = 0;
          refreshChatAvailability();
        });
      }
    };
    for (const method of ["pushState", "replaceState"]) {
      const native = history[method];
      if (typeof native !== "function") continue;
      history[method] = function(...args) {
        const before = location.pathname;
        const result = native.apply(this, args);
        if (location.pathname !== before) onNavigation();
        return result;
      };
    }
    window.addEventListener("popstate", onNavigation);
    window.addEventListener("hashchange", onNavigation);
    window.navigation?.addEventListener?.("currententrychange", onNavigation);
  }
  function boot() {
    if (booted) return;
    setBooted(true);
    setStorageFailureNotifier(showToast);
    initializeCaptureState(loadSettings(), getChatKey());
    ensureUI();
    setRunStateSynchronizer(synchronizeRunState);
    setImageRescanRequester(() => {
      if (!isWatchdogPaused() && !document.hidden) {
        requestBackfill();
        queueConversationEvent("background");
      }
    });
    lastRoutePath = location.pathname;
    installAvailabilityObserver();
    refreshChatAvailability();
    synchronizeRunState();
    installFileWatchers();
    document.addEventListener("click", markRevisionFromClick, true);
    watchRouteChanges();
    if (!isWatchdogPaused()) queueConversationEvent();
    watchPageTheme();
    const themeMq = window.matchMedia?.("(prefers-color-scheme: dark)");
    themeMq?.addEventListener?.("change", applyAppearance);
    window.addEventListener("pageshow", () => {
      setInspectedImageTurns(/* @__PURE__ */ new WeakMap());
      refreshChatAvailability();
      if (!isWatchdogPaused()) queueConversationEvent();
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        setInspectedImageTurns(/* @__PURE__ */ new WeakMap());
        refreshChatAvailability();
        if (!isWatchdogPaused()) {
          requestBackfill();
          queueConversationEvent();
        }
      }
    });
    console.info("[Context Watchdog 1.0.0] first-seen backfill, role-qualified IDs, write-once; no polling/network APIs.");
  }
  var startupRegistered = false;
  function start() {
    if (startupRegistered) return;
    startupRegistered = true;
    setUiInitializer(ensureUI);
    window.addEventListener("storage", (event) => {
      if (event.key === null) {
        invalidateLedgerReadSnapshots();
        for (const key of /* @__PURE__ */ new Set([
          ...ledgerResetEpochs.keys(),
          ...corruptLedgerKeys,
          ...pendingTransientPromotions.keys(),
          ...[...pendingFileResults.values()].map((job) => job.chatKey),
          currentChatKey
        ])) invalidateLedgerJobs(key);
        pendingFileResults.clear();
        corruptLedgerKeys.clear();
        storageFailures.clear();
        setStorageWarningShown(false);
        pendingTransientPromotions.clear();
        pendingLocalFiles.length = 0;
        cancelPausedFileJobs();
        setFailedScanDraft(null);
        revisionTargets.clear();
        completedRevisions.clear();
      } else if (event.key.startsWith(STATE_PREFIX)) {
        try {
          const resetChat = decodeURIComponent(event.key.slice(STATE_PREFIX.length));
          if (resetChat && stateKey(resetChat) === event.key && (event.newValue === null || corruptLedgerKeys.has(resetChat))) {
            let validLiveLedger = false;
            let validationError = null;
            try {
              const liveRaw = localStorage.getItem(event.key);
              if (liveRaw === "") throw new Error("Empty ledger bytes");
              decodeLedger(resetChat, liveRaw);
              validLiveLedger = true;
            } catch (err) {
              validationError = err;
            }
            if (event.newValue === null || validLiveLedger) {
              pendingTransientPromotions.delete(resetChat);
              if (failedScanDraft?.chatKey === resetChat) setFailedScanDraft(null);
              if (resetChat === currentChatKey) {
                revisionTargets.clear();
                completedRevisions.clear();
                pendingLocalFiles.length = 0;
              }
              invalidateLedgerJobs(resetChat);
              cancelPausedFileJobs(resetChat);
            }
            if (validLiveLedger) {
              corruptLedgerKeys.delete(resetChat);
              storageFailures.delete(resetChat);
              if (!corruptLedgerKeys.size && !storageFailures.size) setStorageWarningShown(false);
            } else if (event.newValue === null) {
              corruptLedgerKeys.add(resetChat);
              reportStorageFailure(
                resetChat,
                "CORRUPT LEDGER: writes blocked. Back up the original storage entry.",
                validationError
              );
            }
          }
        } catch {
        }
      }
      if (event.key === null || currentChatKey && event.key === stateKey(currentChatKey)) {
        setInspectedFileTurns(/* @__PURE__ */ new WeakMap());
        setInspectedImageTurns(/* @__PURE__ */ new WeakMap());
        if (!isWatchdogPaused()) {
          requestBackfill();
          if (!document.hidden) queueConversationEvent();
        }
      }
      if (event.key === HISTORY_KEY || event.key === null) {
        setHistoryCache(null);
        setHistorySummaryCache(null);
        setCalibrationHistoryCorrupt(false);
        if (!document.hidden && !isWatchdogPaused()) render(loadState());
      }
      if (event.key === SETTINGS_KEY || event.key === null) {
        setSettings(loadSettings());
        synchronizeRunState();
        applyAppearance();
        syncViewControls();
        if (ui) {
          for (const group of Object.keys(SETTING_GROUPS)) syncGroupInputs(group);
          syncHandoffEditor();
          if (!document.hidden && !isWatchdogPaused()) render(loadState());
        }
      }
    });
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  }

  // src/main.js
  start();
})();
