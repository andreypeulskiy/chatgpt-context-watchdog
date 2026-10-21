import { currentChatKey, lastAudit, lastBackfillDeferred, lastCommit, perf, lastScanReason, lastUiSignals, revisionTargets, settings } from '../runtime/01-runtime-capture-state.js';
import { hydrationCandidates, runtime } from '../runtime/01-runtime-session-state.js';
import { isChatAvailable, isWatchdogPaused } from '../runtime/01-runtime-pause-state.js';
import { activePanelView, ensureUiReady, ui } from '../runtime/01-runtime-ui-state.js';
import { collectorState } from '../runtime/02-profiling.js';
import { effectiveBudgets, historyStats } from '../storage/03-calibration-store.js';
import { storageProblem } from '../storage/03-ledger-foundation.js';
import { loadState } from '../storage/03-ledger-repository.js';
import { formatBytes } from '../attachments/05-attachment-helpers.js';
import { budgetStatus, compactK, percentOf } from './08-theme-budgets.js';
import { formatScaledTokens, stats } from '../app/11-ledger-statistics.js';
import { sessionDiagnosticsSnapshot } from '../app/11-route-inspection.js';
import { setUiHint } from './14-panel-components.js';
import { recordUiError, getRecentUiErrors, getUiErrorRevision } from '../runtime/01-runtime-error-journal.js';

  function setTextIfChanged(node, value) {
    const next = String(value);
    if (node.textContent !== next) node.textContent = next;
  }

  function renderPerformance() {
    if (!ui || ui.performanceDetails?.hidden !== false || !ui.performanceLine || ui.panel.hidden) return;
    const time = (name) => {
      const t = perf.timings[name];
      if (!t) return 'no samples';
      const sorted = [...(t.recent || [])].sort((a, b) => a - b);
      const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 0;
      return `${t.count} calls · avg ${(t.total / t.count).toFixed(2)} ms · ` +
        `p95(last ${sorted.length}) ${p95.toFixed(2)} ms · max ${t.max.toFixed(2)} ms`;
    };
    const lines = [
      `Profiling: ${perf.enabled ? 'enabled' : 'paused'} · RAM only`,
      `Mutation batches: ${perf.mutationBatches} · DOM records: ${perf.mutations}`,
      `Repeated text records coalesced: ${perf.duplicateTextMutations}`,
      `Observer callbacks: ${time('observerCallback')}`,
      `Stats calculations: ${time('stats')}`,
      `Queued events: ${perf.queuedEvents} · processed: ${perf.processedEvents}`,
      `Scans without changes: ${perf.noChangeScans}`,
      `Conversation scans: ${time('conversation')}`,
      `DOM collections: ${time('collect')}`,
      `File scans: ${time('files')}`,
      `Image scans: ${time('images')}`,
      `localStorage reads: ${time('storageRead')}`,
      `Ledger loads: ${time('ledgerLoad')}`,
      `Ledger JSON.parse: ${time('ledgerParse')}`,
      `JSON.stringify: ${time('storageEncode')}`,
      `Storage setItem: ${time('storageCommit')}`,
      `JSON saves (total): ${time('storageWrite')}`
    ];
    setTextIfChanged(ui.performanceLine, lines.join('\n'));
    setTextIfChanged(ui.performanceToggle, perf.enabled ? 'Pause profiling' : 'Enable profiling');
    setUiHint(ui.performanceToggle, perf.enabled
      ? 'Pause in-memory performance measurements.'
      : 'Start in-memory performance measurements.');
  }

  function render(state = loadState(), metrics = null, budgets = null) {
    ensureUiReady();
    const s = metrics || stats(state);
    const eb = budgets || effectiveBudgets();
    // The badge needs derived values while running; a visible, uninert
    // panel also needs them. Skip both checks when paused and the panel is
    // hidden (or blocked by a dialog). Never cache these values across events.
    const panelNeedsDerived = !ui.panel.hidden &&
      !ui.settingsDialog?.open && !ui.aboutDialog?.open &&
      !ui.limitDialog?.open && !ui.confirmDialog?.open;
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
    ui.chip.style.borderColor = problem ? '#dc2626' : '';
    if (problem) setTextIfChanged(ui.storageWarning, problem);
    setUiHint(ui.chip, problem || 'Click the Watchdog logo to open or close the panel');
    if (ui.panel.hidden) return;
    if (ui.settingsDialog?.open || ui.aboutDialog?.open || ui.limitDialog?.open || ui.confirmDialog?.open) {
      if (ui.settingsDialog?.open && ui.diagnosticsDetails?.hidden === false &&
          ui.diagnosticsDetails.dataset.mounted === 'true') renderDiagnostics(s, state);
      return; // Underlying panel is inert; its display work is deferred.
    }
    updateBudgetTabStatus(s, eb, state, derived);
    if (activePanelView === 'context') renderContext(s, state, derived);
    if (activePanelView === 'budget') {
      renderBudgetForecast(s, eb, state, derived);
      renderBudgetStatus(s, eb, state, derived);
      if (ui.historyDetails?.hidden === false && ui.historyDetails.dataset.mounted === 'true')
        renderHistory(eb);
    }
    if (activePanelView === 'details') renderDetails(s, eb, state, derived);
  }

  function renderRunState() {
    if (!ui) return;
    const forced = !isChatAvailable();
    const paused = isWatchdogPaused();
    const tip = forced ? 'Available in chats only' :
      paused ? 'Resume Watchdog' : 'Pause Watchdog';
    ui.pauseToggle.disabled = forced;
    ui.pauseToggle.dataset.cwPlaying = String(!paused);
    ui.pauseToggle.setAttribute('aria-label', tip);
    setUiHint(ui.pauseToggle, tip);
    // The outer hit area keeps the hint available if the button is disabled.
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
      ui.chip.dataset.cwBadgeMode = 'paused';
    } else if (ui.chip.dataset.cwBadgeMode === 'paused') {
      // Do not retain the previous chat's number while awaiting route proof.
      ui.average.hidden = true;
      ui.chipStatus.hidden = true;
      ui.pausedLabel.hidden = true;
      ui.chip.dataset.cwBadgeMode = 'minimal';
    }
  }

  function hasConfirmedContext(state) {
    // Route identity and a committed user-message attachment are required.
    // Selecting a file in the composer is not proof that it was sent.
    if (!state || !currentChatKey || state.chatKey !== currentChatKey || runtime.route) return false;
    if (Object.keys(state.messages || {}).length > 0) return true;
    if (Object.values(state.files || {}).some(file => !!file?.messageId)) return true;
    return Object.values(state.domImages || {}).some(image => !!image?.messageId);
  }

  function renderBadge(s, eb, state = null, derived = null) {
    if (!ui) return;
    if (isWatchdogPaused()) { renderRunState(); return; }
    const ownLedger = derived ? derived.confirmed : hasConfirmedContext(state);
    ui.pausedLabel.hidden = true;
    ui.average.hidden = !ownLedger;
    ui.chipStatus.hidden = !ownLedger;
    ui.chip.dataset.cwBadgeMode = ownLedger ? 'normal' : 'minimal';
    if (!ownLedger) return;
    const mean = (s.optimistic + s.pessimistic) / 2;
    setTextIfChanged(ui.average, `≈ ${compactK(mean)}k`);
    const level = (derived ? derived.status : budgetStatus(s, eb)).level;
    if (ui.chipStatus.dataset.level !== level) ui.chipStatus.dataset.level = level;
  }

  // Display precision only. Budget estimation and stored token values are untouched.
  function formatDetailedTokens(n) {
    return formatScaledTokens(n, 1);
  }

  function formatFullNumber(n) {
    return Math.round(Number(n) || 0).toLocaleString('en-US');
  }

  function attachmentLabels(s) {
    const fileCount = s.knownFileCount || 0;
    const fileBytes = s.totalFileBytes || 0;
    const unknownSize = s.unknownSizeFiles || 0;
    const fileSizeText = fileBytes > 0 ? formatBytes(fileBytes) : 'size unknown';
    const unknownSizeSuffix = fileBytes > 0 && unknownSize ? ` · +${unknownSize} unknown size` : '';
    const coverage = [
      `${s.parsedFiles || 0} parsed`,
      `${s.unparsedFiles || 0} unparsed`,
      `${s.autoPasteMinimumFiles || 0} auto-paste`,
      `${s.reactMetadataFiles || 0} React metadata`,
      `${s.metadataFiles || 0} metadata-only`
    ];
    return {
      files: fileCount ? `${fileCount} · ${fileSizeText}${unknownSizeSuffix}` : 'none',
      coverage: coverage.slice(0, 3).join(' · '),
      coverageExtra: coverage.slice(3).join(' · ')
    };
  }

  function renderContext(s, state, derived = null) {
    setTextIfChanged(ui.dataChars, formatFullNumber(s.chars));
    setTextIfChanged(ui.dataTokens, `≈ ${formatDetailedTokens(s.tokens)}`);
    setTextIfChanged(ui.contextMessages, `${formatFullNumber(s.turns)} · user ${formatFullNumber(s.userTurns)} / AI ${formatFullNumber(s.assistantTurns)}`);
    setTextIfChanged(ui.contextRange, (derived ? derived.confirmed : hasConfirmedContext(state))
      ? `≈ ${formatDetailedTokens((s.optimistic + s.pessimistic) / 2)} tokens` : 'None');
    const labels = attachmentLabels(s);
    setTextIfChanged(ui.dataFiles, labels.files);
    setTextIfChanged(ui.dataQuality, labels.coverage);
    setTextIfChanged(ui.dataQualityExtra, labels.coverageExtra);
    const images = s.knownImages || 0;
    setTextIfChanged(ui.dataImages, images
      ? `${images} · ≈ ${formatDetailedTokens(s.knownImageTokens || 0)} tokens`
      : 'none');
  }

  function updateBudgetTabStatus(s, eb, state = loadState(), derived = null) {
    const status = derived ? derived.status : budgetStatus(s, eb, hasConfirmedContext(state));
    if (ui.budgetTabMark.dataset.level !== status.level) ui.budgetTabMark.dataset.level = status.level;
    const label = `Budget forecast: ${status.label}`;
    if (ui.budgetTab.getAttribute('aria-label') !== label) ui.budgetTab.setAttribute('aria-label', label);
  }

  function renderBudgetForecast(s, eb, state = loadState(), derived = null) {
    // A hidden-context allowance is not a measured chat forecast.
    // Keep budget editing available, but suppress every estimate until
    // the current chat has confirmed messages or sent attachments.
    const available = derived ? derived.confirmed : hasConfirmedContext(state);
    ui.budgetUnavailable.hidden = available;
    ui.forecastHeading.hidden = !available;
    ui.forecastCards.hidden = !available;
    for (const group of ui.budgetView.querySelectorAll('.cw-forecast-group')) {
      group.hidden = !available;
    }
    if (!available) return;
    setTextIfChanged(ui.forecastOpt, `≈ ${formatDetailedTokens(s.optimistic)}`);
    setTextIfChanged(ui.forecastPess, `≈ ${formatDetailedTokens(s.pessimistic)}`);
    const variants = [
      ['Opt', s.optimistic], ['Pess', s.pessimistic]
    ];
    const budgets = [['C', eb.conservative], ['N', eb.normal], ['O', eb.optimistic]];
    for (const [variant, value] of variants) {
      for (const [key, budget] of budgets) {
        const pct = percentOf(value, budget);
        const label = ui[`percent${variant}${key}`];
        setTextIfChanged(label, `${pct}%`);
        const bar = ui[`progress${variant}${key}`];
        const fill = Math.max(0, Math.min(100, pct));
        const width = `${fill}%`;
        const color = pct > 100 ? 'rgb(239, 68, 68)' : '';
        if (bar.style.width !== width) bar.style.width = width;
        if (bar.style.backgroundColor !== color) bar.style.backgroundColor = color;
        // Keep the number legible when the colored segment is too narrow.
        // The indicator's magnitude and saturation are unchanged.
        const onFill = fill >= 35;
        const labelLeft = onFill ? '0%' : width;
        const labelWidth = `${onFill ? fill : 100 - fill}%`;
        if (label.style.left !== labelLeft) label.style.left = labelLeft;
        if (label.style.width !== labelWidth) label.style.width = labelWidth;
        const ink = String(onFill);
        if (label.dataset.cwOnFill !== ink) label.dataset.cwOnFill = ink;
      }
    }
  }

  // Five text-only groups: metrics are copied; their explanatory legends remain on screen.
  // A group label is not copied, but is retained in DOM for readability.
  function buildDetailGroups(s, eb, showForecast = true) {
    const number = n => Number.isFinite(n) ? formatFullNumber(n) : 'none';
    const estimate = n => Number.isFinite(n) ? `≈ ${number(n)} tokens` : 'none';
    const range = (low, high) => Number.isFinite(low) && Number.isFinite(high)
      ? (low === high ? number(low) : `${number(low)}–${number(high)}`)
      : 'none';
    const rangeTokens = (low, high) => {
      const value = range(low, high);
      return value === 'none' ? value : `${value} tokens`;
    };
    const budgetUsage = budget => showForecast && Number.isFinite(budget) && budget > 0 &&
      Number.isFinite(s.optimistic) && Number.isFinite(s.pessimistic)
      ? `${range(s.optimistic, s.pessimistic)} / ${number(budget)} tokens`
      : 'none';
    return [
      [
        `Messages: ${number(s.turns)} total`,
        `Roles: ${number(s.userTurns)} user · ${number(s.assistantTurns)} assistant · ${number(s.otherTurns)} other`,
        `Message length: ${number(s.chars)} characters`,
        `Messages with UUID: ${number(s.uuidMessages)}`
      ],
      [
        `Files: ${number(s.knownFileCount)}`,
        `Known size: ${s.totalFileBytes > 0 ? `${number(s.totalFileBytes)} bytes` : 'none'}`,
        `Unknown size: ${number(s.unknownSizeFiles)} files`,
        `Parsed: ${number(s.parsedFiles)} · Metadata-only: ${number(s.metadataFiles)} · Unparsed: ${number(s.unparsedFiles)}`,
        `React metadata: ${number(s.reactMetadataFiles)} files`,
        `Auto-paste minimum: ${number(s.autoPasteMinimumFiles)} files`,
        `Auto-paste assumed text: ${number(s.autoPasteMinimumChars)} characters`,
        `Fully read: ${number(s.fullyReadTextFiles)} files`,
        `Sampled: ${number(s.sampledTextFiles)} files`,
        `Parsed file estimate: ${estimate(s.knownFileTokens)}`,
        'Parsed file estimate is weighted in the forecast; no age-based reduction.'
      ],
      [
        `Effective images: ${number(s.knownImages)}`,
        `Locally captured: ${number(s.capturedImages)} images`,
        `Found in history: ${number(s.historicalImages)} images`,
        `Raw image estimate: ${estimate(s.knownImageTokens)}`,
        'Effective count is deduplicated. Tokens before weighting.'
      ],
      [
        `Message text: ${estimate(s.tokens)}`,
        `Files: ${rangeTokens(s.fileOptimistic, s.filePessimistic)}`,
        `Images: ${rangeTokens(s.imageOptimistic, s.imagePessimistic)}`,
        `Hidden context: ${rangeTokens(settings.hiddenOptimistic, settings.hiddenPessimistic)}`,
        `Total context: ${showForecast ? rangeTokens(s.optimistic, s.pessimistic) : 'none'}`,
        showForecast ? 'Ranges: optimistic–pessimistic.' : 'No context estimate yet.'
      ],
      [
        `Conservative: ${budgetUsage(eb.conservative)}`,
        `Normal: ${budgetUsage(eb.normal)}`,
        `Generous: ${budgetUsage(eb.optimistic)}`,
        showForecast ? 'Estimated usage / context budget.' : 'No context estimate yet.'
      ]
    ];
  }

  function isDetailLegend(groupIndex, lineIndex, lineCount) {
    return groupIndex > 0 && lineIndex === lineCount - 1;
  }

  function copyableDetailText(groups) {
    return groups.map((lines, groupIndex) => lines.filter((lineText, lineIndex) =>
      !isDetailLegend(groupIndex, lineIndex, lines.length)).join('\n')).join('\n\n');
  }

  function renderDetails(s, eb, state, derived = null) {
    const groups = buildDetailGroups(s, eb, derived ? derived.confirmed : hasConfirmedContext(state));
    while (ui.detailsReport.children.length < groups.length) {
      const group = document.createElement('div');
      group.className = 'cw-detail-group';
      ui.detailsReport.appendChild(group);
    }
    while (ui.detailsReport.children.length > groups.length) ui.detailsReport.lastElementChild.remove();
    for (const [index, lines] of groups.entries()) {
      const container = ui.detailsReport.children[index];
      while (container.children.length < lines.length) container.appendChild(document.createElement('div'));
      while (container.children.length > lines.length) container.lastElementChild.remove();
      for (const [line, value] of lines.entries()) {
        const row = container.children[line];
        // The final row of each diagnostic group is a muted explanation.
        row.classList.toggle('cw-detail-legend', isDetailLegend(index, line, lines.length));
        setTextIfChanged(row, value);
      }
    }
  }

  function formatAuditExample(example) {
    const x = example;
    const reason = x.reasons?.length
      ? ` [reason ${x.reasons.join('+')}; chars Δ${(x.domChars ?? 0) - (x.storedChars ?? 0)}; ` +
        `tokens ${x.storedTokens ?? '-'}→${x.domTokens ?? '-'} ` +
        `(Δ${(x.domTokens ?? 0) - (x.storedTokens ?? 0)}); hash ${x.fingerprintStatus}; ` +
        `DOM prose/code ${x.proseChars ?? '-'}/${x.codeChars ?? '-'}]`
      : '';
    const scope = x.scope ? ` [${x.scope}×${x.roots}]` : '';
    return `${x.kind} ${x.idSuffix} ${x.storedChars ?? '-'}→${x.domChars ?? '-'}${reason}${scope}`;
  }

  // Text-only rendering: keep the Audit diagnostics output stable.
  function formatAuditDiagnostics(audit) {
    if (!audit) return 'AUDIT not run (click Audit; only rendered messages checked)';
    const scopes = audit.scopeCounts;
    const lines = [
      `AUDIT ${new Date(audit.at).toLocaleTimeString()} (${audit.visible} unique / ${audit.raw} raw DOM, read-only${audit.routeUnverified ? ', ROUTE UNVERIFIED' : ''}): ` +
        `${audit.verified} verified, ${audit.missing} missing, ` +
        `${audit.storedShort} short stored, ${audit.domShort} short DOM, ` +
        `${audit.different} different, ${audit.roleChanged} role mismatch, ` +
        `${audit.noStableId} no ID, ${audit.ambiguous} ambiguous, ` +
        `${audit.collapsed} merged views, ` +
        `${audit.unhydrated} unhydrated, ${audit.duplicateIds} duplicate after merge`,
      `Audit repair: ${audit.eligibleRepairs?.length || 0} confirmed, ${audit.repairRepeatNeeded || 0} need a repeat Audit; manual confirmation only`,
      `Audit units: user ${audit.unitRoles?.user || 0}, assistant ${audit.unitRoles?.assistant || 0}, real UUIDs ${audit.unitRoles?.realIds || 0}`,
      `Audit text scopes: unit-user ${scopes['unit-user']}, unit-user-text ${scopes['unit-user-text']}, unit-markdown ${scopes['unit-markdown']}, unit-assistant ${scopes['unit-assistant']}; ` +
        `fallback ${scopes.fallback} · content roots ${audit.contentRoots}`
    ];
    if (audit.different) {
      lines.push(`Audit different reasons: chars ${audit.differenceReasons.chars}, tokens ${audit.differenceReasons.tokens}, fingerprint ${audit.differenceReasons.fingerprint} (hash-only ${audit.differenceReasons.hashOnly}); categories can overlap`);
    }
    if (audit.examples.length) {
      lines.push(`Audit samples: ${audit.examples.map(formatAuditExample).join('; ')}`);
    }
    return lines.join('\n');
  }

  function renderRecentErrors() {
    if (!ui?.recentErrorsList) return;
    const target = ui.recentErrorsList;
    const revision = String(getUiErrorRevision());
    if (target.dataset.cwErrorRevision === revision) return;
    const entries = getRecentUiErrors();
    if (!entries.length) {
      target.textContent = 'No errors recorded. All good.';
    } else {
      const lines = entries.slice().reverse().map(entry => {
        const node = document.createElement('div');
        node.className = 'cw-recent-error-entry';
        const time = new Date(entry.at).toLocaleTimeString();
        // All fields are bounded data from our own in-memory journal. No
        // dynamic HTML, raw error message or host-page data enters this DOM.
        node.textContent = `${entry.id} · ${entry.source} · ${entry.type} · ${time} · ${entry.description}`;
        return node;
      });
      target.replaceChildren(...lines);
    }
    target.dataset.cwErrorRevision = revision;
  }

  function renderDiagnostics(s, state, signal = lastUiSignals) {
    renderRecentErrors();
    const yn = value => value === null ? '?' : value ? 'yes' : 'no';
    const error = storageProblem();
    const commitLine = lastCommit
      ? `last commit ${new Date(lastCommit.at).toLocaleTimeString()}: +${lastCommit.added} new, ${lastCommit.changed} changed, ` +
        `${lastCommit.unchanged} unchanged` +
        ` (counted user ${lastCommit.user}, AI ${lastCommit.assistant}, other ${lastCommit.other}) · ${lastScanReason}`
      : 'last commit: none';
    const auditLine = formatAuditDiagnostics(lastAudit);
    const eligible = lastAudit?.eligibleRepairs?.length || 0;
    ui.repairShort.hidden = eligible === 0;
    ui.repairShort.disabled = eligible === 0 || isWatchdogPaused();
    if (eligible) setTextIfChanged(ui.repairShort, `Repair confirmed (${eligible})`);
    // Show Undo only when a real, still-reversible repair exists for this chat.
    // A disabled action should not appear on first run or after Undo.
    const lastRepair = state.repairHistory?.at(-1);
    const canUndo = Boolean(lastRepair?.id && lastRepair.before && lastRepair.after &&
      JSON.stringify(state.messages?.[lastRepair.id]) === JSON.stringify(lastRepair.after));
    ui.undoRepair.hidden = !canUndo;
    ui.undoRepair.disabled = !canUndo || isWatchdogPaused();
    const session = sessionDiagnosticsSnapshot();
    const gate = session.gate;
    setTextIfChanged(
      ui.diagnosticsLine,
      `${s.turns} stored (user ${s.userTurns}, AI ${s.assistantTurns}, other ${s.otherTurns}) · ${collectorState.visible} visible / ${collectorState.raw} raw` +
      `\nCollector: ${collectorState.collapsed} merged, ${collectorState.ambiguous} ambiguous IDs, ${collectorState.noLayout} no-layout skipped` +
      `\n${collectorState.name} · ${session.phase} · pending ${yn(session.completion)} · initial ${yn(session.initial)}` +
      `\nStop ${yn(signal.stop)} · Send ${yn(signal.send)} · actions ${yn(signal.actions)}` +
      `\nIDs: UUID ${s.uuidMessages}, unambiguous-only; unsupported IDs skipped` +
      `\nAuto-paste: ${s.autoPasteMinimumFiles || 0} inferred minimums (≥${s.autoPasteMinimumChars || 0} chars total; text not read)` +
      `\nUser-only attachments: ${s.knownFileCount || 0} files` +
      (error ? `\nSTORAGE ERROR: ${error}` : '') +
      (session.routePending && gate ?
        `\nRoute gate: ${gate.reason}; UUIDs ${gate.visible}, destination-known ${gate.destinationKnown}, outgoing-only ${gate.outgoingOnly}, old nodes ${gate.outgoingMounted}, shared ${gate.shared}` : '') +
      `\n${commitLine} · first-seen backfill, write-once, revision targets ${revisionTargets.size}, deferred ${lastBackfillDeferred}, hydration pending ${hydrationCandidates.size}` +
      `\n${auditLine}` +
      `\n${currentChatKey || 'awaiting chat UUID'}`
    );
    // Shared Settings dialog layout observer refits on content changes.
    // Performance renders only when its own pane is selected.
  }

  function renderBudgetStatus(s, eb, state = loadState(), derived = null) {
    const status = derived ? derived.status : budgetStatus(s, eb, hasConfirmedContext(state));
    setTextIfChanged(ui.status, status.label);
    ui.status.style.color = status.color;
  }

  function renderHistory(eb) {
    const hs = historyStats();
    const average = value => hs.n && Number.isFinite(value)
      ? `${formatFullNumber(value)} tokens` : 'none';
    const weight = Number.isFinite(eb.historyWeight)
      ? eb.historyWeight.toFixed(2) : 'none';
    setTextIfChanged(ui.history, [
      `Recorded limit samples: ${hs.n}`,
      `Average message text: ${average(hs.avgSeen)}`,
      `Average optimistic context: ${average(hs.avgOptimistic)}`,
      `Average pessimistic context: ${average(hs.avgPessimistic)}`,
      `Calibration weight: ${weight}`
    ].join('\n'));
    ui.history.removeAttribute('title');
  }

  // One notification state and expiry shared by the fixed upper-right lane
  // and the Settings header. Later messages replace earlier ones, regardless
  // of the selected view or whether a Watchdog-local dialog is open.
  function clearTransientNotification() {
    clearTimeout(showToast._timer);
    showToast._timer = null;
    if (!ui) return;
    if (ui.toast) ui.toast.hidden = true;
    if (ui.dialogMessage) {
      ui.dialogMessage.hidden = true;
      ui.dialogMessage.removeAttribute('title');
    }
  }

  function showToast(text, ms = 4500, severity = null) {
    ensureUiReady();
    clearTimeout(showToast._timer);
    const currentUi = ui;
    // The lane is outside every tabpanel and belongs to the blurred panel
    // content, not to the overlay dialog or scrolling bottom edge.
    currentUi.toast.textContent = text;
    currentUi.toast.dataset.cwNoticeLevel = severity ||
      (/\b(error|failed|failure|unavailable|corrupt|refused|cannot|incomplete)\b|could not/i.test(text)
        ? 'error' : 'info');
    currentUi.toast.hidden = false;
    if (currentUi.dialogMessage) {
      const settingsVisible = Boolean(currentUi.settingsDialog?.open) &&
        !currentUi.confirmDialog?.open;
      if (settingsVisible) {
        const okAudit = /^Audit: (\d+) verified, no detected issues in rendered messages\.$/.exec(text);
        setTextIfChanged(currentUi.dialogMessage,
          okAudit ? `Audit OK · ${okAudit[1]} verified` : text);
        currentUi.dialogMessage.title = text;
        currentUi.dialogMessage.hidden = false;
      } else {
        currentUi.dialogMessage.hidden = true;
        currentUi.dialogMessage.removeAttribute('title');
      }
    }
    showToast._timer = setTimeout(() => {
      // A detached instance cannot clear notices on a newly remounted panel.
      if (ui !== currentUi) return;
      clearTransientNotification();
    }, ms);
  }

  // Only explicitly caught errors from Watchdog-owned actions are recorded.
  // References remain meaningful after the toast expires, until Wipe/reload.
  function showUnexpectedError(source, error, summary = 'Operation failed') {
    const reference = recordUiError(source, error);
    renderRecentErrors();
    showToast(`${summary} · ${reference}`, 4500, 'error');
    return reference;
  }

  // The composer belongs to ChatGPT. Never replace an existing draft or
  // editable attachment when preparing a HANDOFF. Return a reason so the
  // clipboard fallback can report accurately what happened.
  function insertIntoComposer(text) {
    const textarea =
      document.querySelector('textarea#prompt-textarea') ||
      document.querySelector('textarea[data-testid="prompt-textarea"]');

    if (textarea) {
      if (textarea.value.length > 0) return 'occupied';
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )?.set;

      if (setter) setter.call(textarea, text);
      else textarea.value = text;

      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      textarea.focus();
      return 'inserted';
    }

    const editable =
      document.querySelector('#prompt-textarea[contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"][data-testid="prompt-textarea"]') ||
      document.querySelector('form [contenteditable="true"]');

    if (editable) {
      // Contenteditables may contain empty <p><br></p> wrappers. Text,
      // embedded media or attachment nodes, however, must be preserved.
      if (editable.textContent?.length || editable.querySelector(
        'img, video, audio, canvas, [contenteditable="false"], [data-type="image"], [data-type="file"], [data-testid*="attachment"]'
      )) return 'occupied';

      editable.focus();
      const range = document.createRange();
      range.selectNodeContents(editable);
      range.deleteContents();

      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (i) editable.appendChild(document.createElement('br'));
        editable.appendChild(document.createTextNode(line));
      });

      editable.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: text
        })
      );

      return 'inserted';
    }

    return 'missing';
  }

  async function copyFallback(text, reason = 'missing') {
    const draftPresent = reason === 'occupied';
    try {
      await navigator.clipboard.writeText(text);
      showToast(draftPresent
        ? 'Your draft was left untouched. HANDOFF prompt copied to clipboard.'
        : 'Composer not detected. HANDOFF prompt copied to clipboard instead.');
    } catch {
      showToast(draftPresent
        ? 'Draft left untouched; clipboard write failed. Allow clipboard access and try again.'
        : 'Composer not detected and clipboard write failed. Open the panel after the composer appears.');
    }
  }

export { hasConfirmedContext, setTextIfChanged, renderPerformance, render, renderBadge, renderRunState, formatDetailedTokens, formatFullNumber, attachmentLabels, renderContext, updateBudgetTabStatus, renderBudgetForecast, buildDetailGroups, copyableDetailText, renderDetails, formatAuditExample, formatAuditDiagnostics, renderDiagnostics, renderRecentErrors, showUnexpectedError, renderBudgetStatus, renderHistory, clearTransientNotification, showToast, insertIntoComposer, copyFallback };
