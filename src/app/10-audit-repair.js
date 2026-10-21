import { currentChatKey, lastAudit, priorRepairCandidates, setLastAudit, setLastScanReason, setPriorRepairCandidates } from '../runtime/01-runtime-capture-state.js';
import { MESSAGE_KEY_RE } from '../runtime/01-runtime-configuration.js';
import { runtime } from '../runtime/01-runtime-session-state.js';
import { saveState } from '../storage/03-ledger-commit.js';
import { getChatKey } from '../storage/03-ledger-foundation.js';
import { loadState } from '../storage/03-ledger-repository.js';
import { getCanonicalMessageMetrics } from '../chatgpt/04-text-estimators.js';
import { collectMessageNodes } from '../chatgpt/09-dom-collection.js';
import { getComposerMode, rememberCollected } from '../chatgpt/09-dom-composer-state.js';
import { identifiedMessages, trustedCollectedMessageId } from '../chatgpt/09-dom-message-identity.js';
import { searchUnitInfo } from '../chatgpt/09-dom-unit-identity.js';
import { messageBusy } from '../chatgpt/11-message-hydration.js';
import { setSessionPhase } from './11-route-inspection.js';
import { routeDomHasChanged, synchronizeChatRoute } from './11-route-navigation.js';
import { clearAuditConfirmation } from './10-audit-confirmation.js';

  function repairCandidate(id, old, measured, role) {
    if (!old || old.role !== role || !['user', 'assistant'].includes(role)) return null;
    if (!String(measured.fingerprint).startsWith('v3:')) return null;
    if (!['unit-markdown', 'unit-user-text', 'unit-user'].includes(measured.parts.source)) return null;
    const oldChars = Number(old.chars) || 0;
    if (oldChars > 64 || measured.chars < Math.max(160, oldChars * 3)) return null;
    return {
      id, role, oldChars, oldTokens: Number(old.tokens) || 0,
      oldFingerprint: old.fingerprint || '',
      newChars: measured.chars,
      newTokens: measured.tokens,
      newFingerprint: measured.fingerprint,
      source: measured.parts.source
    };
  }

  function repairSignature(c) {
    return JSON.stringify([c.id, c.role, c.oldChars, c.oldTokens,
      c.oldFingerprint, c.newChars, c.newTokens, c.newFingerprint, c.source]);
  }

  // Manual repair is intentionally separate from the write-once capture path.
  // Two consecutive, identical read-only Audits + a confirmation are needed.
  // We re-read the *same* message unit once more just before applying changes.
  // These commands never display UI. The caller owns the dialog and message.
  // Both entry points revalidate route, audit generation, DOM and ledger AFTER OK.
  function prepareShortRecordRepair() {
    const candidates = lastAudit?.eligibleRepairs || [];
    if (!candidates.length || lastAudit.routeUnverified ||
        getChatKey() !== currentChatKey || getComposerMode() !== 'ready' ||
        (runtime.route && !routeDomHasChanged())) {
      return { status: 'not-ready' };
    }
    const summary = candidates.map(c =>
      `${c.role} …${c.id.slice(-10)}: ${c.oldChars} → ${c.newChars} chars, ` +
      `${c.oldTokens} → ${c.newTokens} tokens`
    ).join('\n');
    return { status: 'ready', candidates, chatKey: currentChatKey,
      message: `Repair ${candidates.length} confirmed incomplete stored message(s)?\n\n${summary}\n\n` +
        'Only these saved records will be changed. Their old values will be retained for Undo. ' +
        'Audit is otherwise read-only.' };
  }

  function applyConfirmedShortRecordRepair(prepared) {
    const candidates = prepared?.candidates;
    if (!candidates?.length || prepared.chatKey !== currentChatKey ||
        lastAudit?.eligibleRepairs !== candidates || lastAudit.routeUnverified ||
        getChatKey() !== currentChatKey || getComposerMode() !== 'ready' ||
        (runtime.route && !routeDomHasChanged())) {
      return { status: 'stale' };
    }
    const state = loadState();
    const collected = collectMessageNodes();
    const byId = new Map();
    const candidateIds = new Set(candidates.map(c => c.id));
    for (const { el: node, role, id } of identifiedMessages(collected.nodes)) {
      // The DOM can acquire conflicting copies while confirmation is open.
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
    if (!changes.length) return { status: 'changed' };
    const at = Date.now();
    for (const { candidate: c, old } of changes) {
      const updated = { ...old, role: c.role, chars: c.newChars,
        tokens: c.newTokens, fingerprint: c.newFingerprint };
      state.messages[c.id] = updated;
      state.repairHistory.push({ id: c.id, at, before: old, after: updated });
      if (state.repairHistory.length > 20) state.repairHistory.shift();
    }
    if (!saveState(state)) return { status: 'storage-failed' };
    clearAuditConfirmation();
    return { status: 'repaired', count: changes.length, state };
  }

  function prepareUndoLastAuditRepair() {
    if (getChatKey() !== currentChatKey || !currentChatKey) return { status: 'stale' };
    const state = loadState();
    const item = state.repairHistory.at(-1);
    if (!item) return { status: 'none' };
    if (JSON.stringify(state.messages[item.id]) !== JSON.stringify(item.after)) {
      return { status: 'changed' };
    }
    return { status: 'ready', item, chatKey: currentChatKey,
      message: `Undo last repair for …${item.id.slice(-10)}? Restore ${item.before.chars} characters?` };
  }

  function applyUndoLastAuditRepair(prepared) {
    if (!prepared || prepared.chatKey !== currentChatKey ||
        getChatKey() !== currentChatKey || !currentChatKey) return { status: 'stale' };
    const freshState = loadState();
    const freshItem = freshState.repairHistory.at(-1);
    if (!freshItem || JSON.stringify(freshItem) !== JSON.stringify(prepared.item) ||
        JSON.stringify(freshState.messages[freshItem.id]) !== JSON.stringify(freshItem.after)) {
      return { status: 'changed' };
    }
    freshState.messages[freshItem.id] = freshItem.before;
    freshState.repairHistory.pop();
    if (!saveState(freshState)) return { status: 'storage-failed' };
    clearAuditConfirmation();
    return { status: 'undone', state: freshState };
  }

  // Read-only snapshot of every UUID persisted for the current chat.
  // A DOM-only list can never recover virtualized messages; the saved ledger
  // is the primary source. Does not scan text, tokenize, or mutate storage.
  function messageIdExport() {
    const chatKey = getChatKey();
    if (!chatKey) return null;
    const state = loadState(chatKey);
    const rows = new Map();
    let storedCount = 0;
    let invalidSavedKeys = 0;
    const idPattern = MESSAGE_KEY_RE;
    for (const [key, record] of Object.entries(state.messages || {})) {
      const matched = idPattern.exec(key);
      if (!matched) { invalidSavedKeys++; continue; }
      storedCount++;
      const uuid = matched[1].toLowerCase();
      rows.set(`msg:${uuid}`, {
        uuid, role: record?.role || 'unknown',
        chars: Number(record?.chars) || 0, tokens: Number(record?.tokens) || 0,
        fingerprint: String(record?.fingerprint || ''), stored: true,
        storedOrder: storedCount, visible: false, domOrder: '', ambiguous: false
      });
    }

    // Never attribute the outgoing chat's DOM to a newly opened chat.
    const routeUnverified = !!runtime.route || chatKey !== currentChatKey;
    let rawVisible = 0;
    let noIdVisible = 0;
    let ambiguousVisible = 0;
    if (!routeUnverified) {
      const collected = collectMessageNodes();
      rawVisible = collected.nodes.length;
      for (const { index, role, id } of identifiedMessages(collected.nodes)) {
        if (!id) { noIdVisible++; continue; }
        const matched = idPattern.exec(id);
        if (!matched) { noIdVisible++; continue; }
        const key = `msg:${matched[1].toLowerCase()}`;
        const ambiguous = collected.ambiguousIds.has(key);
        if (ambiguous) ambiguousVisible++;
        let row = rows.get(key);
        if (!row) {
          row = {
            uuid: matched[1].toLowerCase(), role: role || 'unknown',
            chars: '', tokens: '', fingerprint: '', stored: false, storedOrder: '',
            visible: false, domOrder: '', ambiguous: false
          };
          rows.set(key, row);
        }
        row.visible = true;
        row.domOrder = index + 1;
        row.ambiguous = row.ambiguous || ambiguous;
      }
    }

    const records = [...rows.values()];
    const visibleCount = records.filter(x => x.visible).length;
    const visibleOnlyCount = records.filter(x => x.visible && !x.stored).length;
    const lines = [
      `# Watchdog UUID diagnostic (read-only; state:v2)`,
      `# Chat: ${chatKey}`,
      `# Exported: ${new Date().toISOString()}`,
      `# Saved UUIDs: ${storedCount}; visible UUIDs: ${visibleCount}; visible but not saved: ${visibleOnlyCount}`,
      `# Current DOM: ${routeUnverified ? 'NOT VERIFIED (visible flags omitted)' : 'verified against current route'}; DOM units: ${rawVisible}; no UUID: ${noIdVisible}; ambiguous: ${ambiguousVisible}`,
      `# Invalid saved keys: ${invalidSavedKeys}`,
      `# Stored order is insertion order, NOT chronological chat order. DOM order applies only to currently rendered units.`,
      `# The export includes no message text or file contents.`,
      'stored_order\tuuid\trole\tchars\ttokens\tfingerprint\tin_dom\tdom_order\tstatus'
    ];
    for (const row of records) {
      const status = row.ambiguous ? 'ambiguous-visible' :
        row.stored && row.visible ? 'saved+visible' :
        row.stored ? 'saved' : 'visible-only';
      lines.push([
        row.storedOrder, row.uuid, row.role, row.chars, row.tokens, row.fingerprint,
        row.visible ? 'yes' : 'no', row.domOrder, status
      ].join('\t'));
    }
    return { chatKey, storedCount, visibleCount, visibleOnlyCount,
      routeUnverified, tsv: lines.join('\n') + '\n' };
  }

  // The capture, Audit, and explicit Repair paths all use the SAME measured
  // canonical representation. This read-only comparison describes *why* an
  // already stored record differs, without exposing or persisting message text.
  // Missing fingerprints cannot establish a hash mismatch; compare
  // available strings directly, without interpreting historical formats.
  function compareStoredMessageMetrics(stored, observed) {
    const oldChars = Number(stored.chars) || 0;
    const oldTokens = Number(stored.tokens) || 0;
    const fingerprint = String(stored.fingerprint || '');
    const fingerprintStatus = !fingerprint ? 'unavailable' :
      fingerprint === observed.fingerprint ? 'same' : 'changed';
    const charsChanged = oldChars !== observed.chars;
    const tokensChanged = oldTokens !== observed.tokens;
    const hashChanged = fingerprintStatus === 'changed';
    return {
      oldChars, oldTokens, charsChanged, tokensChanged, hashChanged,
      fingerprintStatus,
      different: charsChanged || tokensChanged || hashChanged
    };
  }

  // Manual-only integrity audit of CURRENTLY RENDERED turns. It never
  // changes localStorage or the write-once message ledger. This is a separate
  // verification path, not a fallback used by the automatic completion path.
  function auditVisibleMessages() {
    // Audit never commits, so it must be available even if another chat's
    // controls are still mounted, the current reply streams, or the composer
    // is temporarily absent. Unlike the auto-commit path, it cannot corrupt
    // message history. Mark a route whose DOM is still unverified explicitly.
    synchronizeChatRoute();
    if (!currentChatKey) {
      return null;
    }
    const routeUnverified = !!runtime.route && !routeDomHasChanged();
    // Refresh *diagnostic* composer indicators when this DOM belongs to the
    // current chat. Do not invoke onConversationEvent(): Audit must not cause
    // automatic commits or change runtime.work.completion.
    if (!routeUnverified) setSessionPhase(getComposerMode(), false);
    const state = loadState();
    const collected = collectMessageNodes();
    rememberCollected(collected);
    const result = {
      at: Date.now(), visible: collected.nodes.length,
      routeUnverified, // results are observational, never persisted
      raw: collected.rawCount, collapsed: collected.collapsed,
      verified: 0, missing: 0, storedShort: 0,
      domShort: 0, different: 0, roleChanged: 0,
      noStableId: 0, duplicateIds: 0, ambiguous: 0, unhydrated: 0,
      scopeCounts: { 'unit-user-text': 0, 'unit-user': 0,
        'unit-markdown': 0, 'unit-assistant': 0, fallback: 0 },
      contentRoots: 0, examples: [], eligibleRepairs: [],
      repairCandidates: 0, repairRepeatNeeded: 0,
      differenceReasons: { chars: 0, tokens: 0, fingerprint: 0, hashOnly: 0 }
    };
    const seen = new Set();
    const newRepairCandidates = new Map();
    result.unitRoles = { user: 0, assistant: 0, realIds: 0 };
    const sample = (kind, id, stored, measured, comparison = null) => {
      if (result.examples.length >= 6) return;
      result.examples.push({
        kind, idSuffix: String(id).slice(-10),
        storedChars: stored ? Number(stored.chars) || 0 : null,
        domChars: measured?.chars ?? null,
        storedTokens: stored ? Number(stored.tokens) || 0 : null,
        domTokens: measured?.tokens ?? null,
        fingerprintStatus: comparison?.fingerprintStatus || 'n/a',
        reasons: comparison ? [
          ...(comparison.charsChanged ? ['chars'] : []),
          ...(comparison.tokensChanged ? ['tokens'] : []),
          ...(comparison.hashChanged ? ['fingerprint'] : [])
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
        if (id?.startsWith('msg:')) result.unitRoles.realIds++;

      }
      if (!id) { result.noStableId++; sample('no-id', role); continue; }
      if (seen.has(id)) {
        result.duplicateIds++;
        sample('duplicate-id', id);
        continue;
      }
      seen.add(id);
      if (collected.ambiguousIds.has(id)) {
        result.ambiguous++;
        sample('ambiguous-dom', id);
        continue;
      }
      const existing = state.messages[id];
      const measured = getCanonicalMessageMetrics(el, role);
      result.contentRoots += measured.parts.roots;
      result.scopeCounts[measured.parts.source] =
        (result.scopeCounts[measured.parts.source] || 0) + 1;
      // Tiny or empty DOM fragments on reload are not evidence of either a
      // missing stored message or a changed saved answer.
      if (!measured.chars || (existing && Number(existing.chars) >= 80 && measured.chars < 40)) {
        result.unhydrated++;
        sample('unhydrated', id, existing, measured);
        continue;
      }
      if (!existing) {
        result.missing++;
        sample('missing', id, null, measured);
        continue;
      }
      const comparison = compareStoredMessageMetrics(existing, measured);
      const { oldChars } = comparison;
      if (['user', 'assistant'].includes(existing.role) &&
          ['user', 'assistant'].includes(role) && existing.role !== role) {
        result.roleChanged++;
        sample('role', id, existing, measured);
      }
      if (oldChars <= 64 && measured.chars >= Math.max(160, oldChars * 3)) {
        result.storedShort++;
        sample('stored-short', id, existing, measured, comparison);
        const candidate = !routeUnverified && runtime.phase === 'ready' &&
          !messageBusy(el) &&
          repairCandidate(id, existing, measured, role);
        if (candidate) {
          newRepairCandidates.set(id, candidate);
          if (priorRepairCandidates.has(id) &&
              repairSignature(priorRepairCandidates.get(id)) === repairSignature(candidate)) {
            result.eligibleRepairs.push(candidate);
          } else {
            result.repairRepeatNeeded++;
          }
        }
      } else if (oldChars >= 80 && measured.chars <= Math.max(24, oldChars * 0.35)) {
        result.domShort++;
        sample('dom-short', id, existing, measured, comparison);
      } else if (comparison.different) {
        result.different++;
        if (comparison.charsChanged) result.differenceReasons.chars++;
        if (comparison.tokensChanged) result.differenceReasons.tokens++;
        if (comparison.hashChanged) result.differenceReasons.fingerprint++;
        if (comparison.hashChanged && !comparison.charsChanged && !comparison.tokensChanged) {
          result.differenceReasons.hashOnly++;
        }
        sample('different', id, existing, measured, comparison);
      } else {
        result.verified++;
      }
    }
    result.repairCandidates = newRepairCandidates.size;
    setPriorRepairCandidates(newRepairCandidates);
    setLastAudit(result);
    setLastScanReason('manual Audit (read-only)');
    return result;
  }

export { clearAuditConfirmation, repairCandidate, repairSignature,
  prepareShortRecordRepair, applyConfirmedShortRecordRepair,
  prepareUndoLastAuditRepair, applyUndoLastAuditRepair,
  messageIdExport, compareStoredMessageMetrics, auditVisibleMessages };
