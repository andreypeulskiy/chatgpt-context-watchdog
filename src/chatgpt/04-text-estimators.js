import { settings } from '../runtime/01-runtime-capture-state.js';
import { DOM_SELECTORS } from '../runtime/01-runtime-configuration.js';
import { inferRole, searchUnitInfo } from './09-dom-unit-identity.js';

  function normalizeText(text) {
    return (text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function hash32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // Exact ASCII punctuation category from the previous regex estimator.
  // A lookup avoids five full-string regex scans and temporary match arrays.
  const PROSE_ASCII_PUNCTUATION = new Uint8Array(128);
  for (const char of '.,!?;:\'"()[]{}<>@#$%^&*_=+~`|\\/-') {
    PROSE_ASCII_PUNCTUATION[char.charCodeAt(0)] = 1;
  }

  function estimateProseTokens(text) {
    if (!text) return 0;

    // One UTF-16 code-unit pass: matches the former regex buckets and /\S+/g
    // word boundaries, including Unicode whitespace and surrogate pairs.
    // No changes to the weighting settings, rounding or stored ledger values.
    let cyr = 0, latin = 0, digits = 0, punctuation = 0, other = 0;
    let words = 0, insideWord = false;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      // ECMAScript /\s/ includes these codepoints (and /\S/ excludes them).
      const space = (code >= 9 && code <= 13) || code === 32 ||
        code === 0x00A0 || code === 0x1680 ||
        (code >= 0x2000 && code <= 0x200A) ||
        code === 0x2028 || code === 0x2029 || code === 0x202F ||
        code === 0x205F || code === 0x3000 || code === 0xFEFF;
      if (space) {
        insideWord = false;
        continue;
      }
      if (!insideWord) {
        words++;
        insideWord = true;
      }
      if (code >= 0x0400 && code <= 0x052F) cyr++;
      else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) latin++;
      else if (code >= 48 && code <= 57) digits++;
      else if (code === 0x2013 || code === 0x2014 ||
          (code < 128 && PROSE_ASCII_PUNCTUATION[code])) punctuation++;
      else other++;
    }
    const charEstimate =
      cyr / settings.proseCyrillicCharsPerToken +
      latin / settings.proseLatinCharsPerToken +
      digits / settings.proseDigitsCharsPerToken +
      punctuation / settings.prosePunctuationCharsPerToken +
      other / settings.proseOtherCharsPerToken;
    return Math.ceil(Math.max(charEstimate, words * settings.proseMinTokensPerWord));
  }

  function estimateCodeTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / settings.codeCharsPerToken);
  }

  // Measure *content roots*, never arbitrarily measure either the
  // entire keyed turn or an individual MarkdownRoot based on fragmentation.
  // The same keyed answer must produce identical text when rendered as one
  // MarkdownRoot and as several sibling MarkdownRoots. This runs only for
  // newly committed turns and on explicit manual Audit (not on F5/scroll).
  // Do not infer a user message from late/toolbar whitespace or another chat.
  // and rich user prompts can also contain MarkdownRoot elements.
  // Each source node represents ONE role, never an entire user+assistant turn.
  function canonicalTextRoots(messageEl, role) {
    const info = searchUnitInfo(messageEl);
    const scope = info?.unit || messageEl;
    const roots = selector => {
      const found = [
        ...(scope.matches?.(selector) ? [scope] : []),
        ...scope.querySelectorAll(selector)
      ].filter(el => !el.hidden && !el.closest?.('[hidden], [inert], [aria-hidden="true"]'));
      return found.filter(el => !found.some(other => other !== el && other.contains(el)));
    };
    if (role === 'user') {
      const text = roots(DOM_SELECTORS.userText).filter(el =>
        !el.closest?.('pre, code, form, [contenteditable="true"]'));
      if (text.length) return { roots: text, source: 'unit-user-text', scope };
      // User text can occur inside a button in the newer ChatGPT layout.
      return { roots: [scope], source: 'unit-user', scope };
    }
    if (role === 'assistant') {
      const text = roots(DOM_SELECTORS.markdown);
      if (text.length) return { roots: text, source: 'unit-markdown', scope };
      return { roots: [scope], source: 'unit-assistant', scope };
    }
    return { roots: [], source: 'fallback', scope };
  }

  function getMessageParts(messageEl, role = inferRole(messageEl)) {
    const selection = canonicalTextRoots(messageEl, role);
    const prose = [];
    const code = [];
    for (const root of selection.roots) {
      const clone = root.cloneNode(true);
      // textContent includes *hidden* subtree text, unlike what the user
      // reads. Remove hidden copies, controls and non-content UI first.
      const preservePromptButtons = selection.source === 'unit-user';
      clone.querySelectorAll(
        (preservePromptButtons ? '' : 'button, [role="button"], ') +
        'svg, [hidden], [inert], ' +
        '[aria-hidden="true"], [data-testid*="copy"], ' +
        '[data-testid*="feedback"], [contenteditable="true"], ' +
        '[style*="display:none"], [style*="display: none"], ' +
        '[style*="visibility:hidden"], [style*="visibility: hidden"]'
      ).forEach(el => el.remove());
      if (preservePromptButtons) {
        clone.querySelectorAll('button, [role="button"]').forEach(button => {
          const label = (button.getAttribute('aria-label') ||
            button.getAttribute('title') || '').toLowerCase();
          if (/^(copy|edit|delete|share|retry|regenerate|копировать|изменить|редактировать|удалить|поделиться|ещё действия)/i.test(label)) button.remove();
        });
      }
      // If the text root itself is hidden, do not count the subtree.
      if (clone.hidden || clone.getAttribute?.('aria-hidden') === 'true') continue;
      // Process pre first, then remaining inline code; nested code is counted once.
      for (const selector of ['pre', 'code']) {
        for (const block of clone.querySelectorAll(selector)) {
          const text = normalizeText(block.textContent);
          if (text) code.push(text);
          block.remove();
        }
      }
      const text = normalizeText(clone.textContent);
      if (text) prose.push(text);
    }
    return {
      prose: normalizeText(prose.join('\n')),
      code: normalizeText(code.join('\n')),
      source: selection.source,
      roots: selection.roots.length
    };
  }

  // Canonical content-root representation used for new message captures.
  // Fingerprints are compared only where both sides are available.
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
    return estimateProseTokens(parts.prose) +
      estimateCodeTokens(parts.code) + settings.messageOverhead;
  }

export { normalizeText, hash32, PROSE_ASCII_PUNCTUATION, estimateProseTokens, estimateCodeTokens, canonicalTextRoots, getMessageParts, getCanonicalMessageMetrics, estimateMessagePartsTokens };
