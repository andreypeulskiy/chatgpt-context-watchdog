import { currentChatKey, settings } from '../runtime/01-runtime-capture-state.js';
import { ui } from '../runtime/01-runtime-ui-state.js';
import { saveSettings } from '../storage/03-storage-io.js';
import { fitPanelDialogToPanel } from './15-panel-dialog-geometry.js';
import { refreshBadgeSiteIcon } from './12-panel-site-icon.js';

  // Appearance never influences estimates, the write-once ledger or collection.
  // ChatGPT's own page theme is preferred over the operating system theme.
  function systemIsDark() {
    return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  }

  function chatGptTheme() {
    const hostRoot = document.querySelector('#__next, #root');
    for (const node of [document.documentElement, document.body, hostRoot]) {
      if (!node) continue;
      for (const attr of ['data-theme', 'data-color-mode', 'data-mode']) {
        const value = (node.getAttribute(attr) || '').toLowerCase();
        if (value === 'dark' || value === 'light') return value;
      }
      if (node.classList.contains('dark')) return 'dark';
      if (node.classList.contains('light')) return 'light';
    }
    // CSS color-scheme can identify a page preference when no marker exists.
    // 'light dark' is ambiguous and must not be treated as a light preference.
    for (const node of [document.documentElement, document.body, hostRoot]) {
      if (!node) continue;
      const scheme = getComputedStyle(node).colorScheme.trim().toLowerCase();
      if (scheme === 'dark' || scheme === 'only dark') return 'dark';
      if (scheme === 'light' || scheme === 'only light') return 'light';
    }
    // Some ChatGPT builds express appearance in background tokens instead.
    // Ignore transparent layers; OS is only the last fallback.
    for (const node of [hostRoot, document.body, document.documentElement]) {
      if (!node) continue;
      const bg = getComputedStyle(node).backgroundColor;
      const rgb = bg.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, ]+([\d.]+))?\)$/);
      if (!rgb || (rgb[4] !== undefined && Number(rgb[4]) < .8)) continue;
      const lum = Number(rgb[1]) * .2126 + Number(rgb[2]) * .7152 + Number(rgb[3]) * .0722;
      return lum < 145 ? 'dark' : 'light';
    }
    return systemIsDark() ? 'dark' : 'light';
  }

  function resolvedViewPalette() {
    if (settings.viewTheme === 'light' || settings.viewTheme === 'dark') return settings.viewTheme;
    if (settings.viewTheme === 'system') return systemIsDark() ? 'dark' : 'light';
    return chatGptTheme();
  }

  function applyAppearance() {
    if (!ui?.root) return;
    ui.root.dataset.cwStyle = settings.viewStyle;
    ui.root.dataset.cwPalette = resolvedViewPalette();
  }

  // Only theme markers and direct host-root replacement are observed.
  // ChatGPT may replace #__next/#root during SPA navigation; an observer bound
  // solely to the previous element would then silently stop following its theme.
  let pageThemeObserver = null;
  let observedThemeBody = null;
  let observedThemeHost = null;
  let observedThemeParent = null;
  const THEME_ATTRIBUTES = ['class', 'style', 'data-theme', 'data-color-mode', 'data-mode'];
  function refreshPageThemeTargets() {
    const body = document.body;
    const host = document.querySelector('#__next, #root');
    const parent = host?.parentElement || null;
    if (observedThemeBody === body && observedThemeHost === host &&
        observedThemeParent === parent) return false;
    pageThemeObserver.disconnect();
    observedThemeBody = body;
    observedThemeHost = host;
    observedThemeParent = parent;
    const themeNodes = new Set([document.documentElement, body, host]);
    // childList, not subtree: no observation of streamed messages or chat content.
    const rootParents = new Set([document.documentElement, body, parent]);
    for (const node of new Set([...themeNodes, ...rootParents])) {
      if (!node) continue;
      const attributes = themeNodes.has(node);
      pageThemeObserver.observe(node, {
        attributes,
        ...(attributes ? { attributeFilter: THEME_ATTRIBUTES } : {}),
        childList: rootParents.has(node)
      });
    }
    return true;
  }
  function watchPageTheme() {
    if (pageThemeObserver) return;
    pageThemeObserver = new MutationObserver(records => {
      const rootChanged = refreshPageThemeTargets();
      if (settings.viewTheme === 'chatgpt' &&
          (rootChanged || records.some(record => record.type === 'attributes'))) {
        applyAppearance();
      }
    });
    refreshPageThemeTargets();
  }

  function syncViewControls() {
    if (!ui?.settingsDialog) return;
    for (const button of ui.settingsDialog.querySelectorAll('[data-cw-view-style], [data-cw-view-theme], [data-cw-view-logo]')) {
      const value = button.dataset.cwViewStyle || button.dataset.cwViewTheme || button.dataset.cwViewLogo;
      const selected = button.hasAttribute('data-cw-view-style') ? settings.viewStyle === value :
        button.hasAttribute('data-cw-view-logo') ? settings.logoPreference === value : settings.viewTheme === value;
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  function changeViewPreference(field, value) {
    const key = field === 'style' ? 'viewStyle' : field === 'logo' ? 'logoPreference' : 'viewTheme';
    const allowed = field === 'style' ? ['soft', 'sharp'] :
      field === 'logo' ? ['openai', 'watchdog'] : ['light', 'dark', 'system', 'chatgpt'];
    if (!allowed.includes(value) || settings[key] === value) return;
    const previous = settings[key];
    settings[key] = value;
    if (!saveSettings()) {
      settings[key] = previous;
      syncViewControls();
      return;
    }
    // The OPEN Appearance dialog updates in place, not after closing/reopening.
    applyAppearance();
    if (field === 'logo') refreshBadgeSiteIcon(true);
    syncViewControls();
    // Refit on any style/theme change, including content-height reductions.
    if (ui?.settingsDialog?.open) {
      fitPanelDialogToPanel();
      requestAnimationFrame(fitPanelDialogToPanel);
    }
  }

  // All three status indicators (mini badge, Budget tab, Overall forecast)
  // use the same *displayed*, integer-rounded Normal-budget percentages.
  // Exactly 100% is still within budget; optimistic > 100% takes priority.
  // The midpoint is only the badge's neutral numeric value, not a threshold.
  // No budget toast or panel auto-open: these visual indicators are sufficient.
  function budgetStatus(s, budgets, hasContext = true) {
    if (!currentChatKey) return { level: 'pending', label: 'WAIT · chat UUID', color: '#64748b' };
    if (!hasContext) return { level: 'pending', label: 'WAIT · first message', color: '#64748b' };
    if (percentOf(s.optimistic, budgets.normal) > 100) {
      return { level: 'critical', label: 'RED · prepare HANDOFF', color: '#ef4444' };
    }
    if (percentOf(s.pessimistic, budgets.normal) > 100) {
      return { level: 'caution', label: 'YELLOW · caution', color: '#ca8a04' };
    }
    return { level: 'ok', label: 'OK · within budget', color: 'var(--cw-accent)' };
  }

  function percentOf(value, budget) {
    if (!budget) return 0;
    // Multiply first to avoid 100.49999999999999 at an exact 100.5%.
    return Math.round(value * 100 / budget);
  }

  function compactK(n) {
    const k = n / 1000;
    if (k < 10) return k.toFixed(1).replace(/\.0$/, '');
    if (k < 100) return k.toFixed(0);
    return Math.round(k).toString();
  }

export { systemIsDark, chatGptTheme, resolvedViewPalette, applyAppearance, pageThemeObserver, watchPageTheme, syncViewControls, changeViewPreference, budgetStatus, percentOf, compactK };
