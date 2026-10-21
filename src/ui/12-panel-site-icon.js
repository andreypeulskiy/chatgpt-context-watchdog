// ChatGPT badge artwork is read only from the same-origin HTTP-cache
// favicon response. On confirmed failure the saved preference changes to
// Watchdog. Only head link[rel~=icon] is consulted; no graphic DOM scanning,
// remote retry, persisted artwork or raw SVG.
import { settings } from '../runtime/01-runtime-capture-state.js';
import { saveSettings } from '../storage/03-storage-io.js';
import { createWatchdogLogo } from './12-watchdog-logo.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_SVG_CHARS = 16384;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,+\-eE]+$/;
const COLORS = /^(?:none|currentColor|black|white|#[0-9a-fA-F]{3,8})$/;
const NUMERIC = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const GEOMETRY = new Set(['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'stroke-miterlimit', 'opacity']);
const COMMON_ATTRS = new Set(['fill', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity']);
const GRAPHICS = new Set(['path', 'g', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline']);
// The current official favicon has a single root-level stylesheet and path.
// Match its harmless two-color theme rule exactly; do not copy CSS into the
// live page, and never accept arbitrary selectors, imports, URLs or elements.
const OFFICIAL_FAVICON_CSS = /^\s*:root\s*\{\s*fill\s*:\s*#000\s*;\s*\}\s*@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{\s*:root\s*\{\s*fill\s*:\s*#fff\s*;\s*\}\s*\}\s*$/;

function isKnownFaviconStyle(source) {
  const nodes = [...source.children];
  const attrs = [...source.attributes];
  if (nodes.length !== 2 || nodes[0].localName !== 'style' || nodes[1].localName !== 'path' ||
      nodes[0].namespaceURI !== SVG_NS || nodes[1].namespaceURI !== SVG_NS ||
      nodes[0].attributes.length !== 0 || nodes[1].attributes.length !== 1 ||
      !nodes[1].hasAttribute('d') ||
      attrs.length !== 5 || source.getAttribute('xmlns') !== SVG_NS ||
      source.getAttribute('width') !== '180' || source.getAttribute('height') !== '180' ||
      source.getAttribute('viewBox') !== '0 0 180 180' || source.getAttribute('fill') !== 'none' ||
      [...nodes[0].childNodes].some(node => node.nodeType !== 3)) return false;
  return OFFICIAL_FAVICON_CSS.test(nodes[0].textContent || '');
}

let activeRoot = null;
let activeHolder = null;
let cachedFaviconSvg = null;
let cacheAttempted = false;
let cacheGeneration = 0;

function safeGraphicAttribute(name, value) {
  if (name === 'd') return value.length > 0 && value.length <= 15000 && PATH_DATA.test(value);
  if (name === 'points') return value.length <= 4096 && /^[0-9\s.,+\-eE]+$/.test(value);
  if (['fill', 'stroke'].includes(name)) return COLORS.test(value);
  if (['fill-rule', 'clip-rule'].includes(name)) return ['evenodd', 'nonzero'].includes(value);
  if (['stroke-linejoin'].includes(name)) return ['round', 'bevel', 'miter'].includes(value);
  if (['stroke-linecap'].includes(name)) return ['round', 'square', 'butt'].includes(value);
  if (GEOMETRY.has(name)) return value.length < 32 && NUMERIC.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 100000;
  if (name === 'transform') return value.length <= 160 &&
    /^(?:(?:translate|scale|rotate|matrix)\([0-9\s.,+\-eE]+\)\s*)+$/.test(value);
  return false;
}

function setSafeSvgAttribute(element, name, value) {
  // Every setAttribute key is static for the source security gate.
  switch (name) {
    case 'fill': element.setAttribute('fill', value); return;
    case 'fill-rule': element.setAttribute('fill-rule', value); return;
    case 'clip-rule': element.setAttribute('clip-rule', value); return;
    case 'stroke': element.setAttribute('stroke', value); return;
    case 'stroke-width': element.setAttribute('stroke-width', value); return;
    case 'stroke-linecap': element.setAttribute('stroke-linecap', value); return;
    case 'stroke-linejoin': element.setAttribute('stroke-linejoin', value); return;
    case 'stroke-miterlimit': element.setAttribute('stroke-miterlimit', value); return;
    case 'opacity': element.setAttribute('opacity', value); return;
    case 'd': element.setAttribute('d', value); return;
    case 'points': element.setAttribute('points', value); return;
    case 'transform': element.setAttribute('transform', value); return;
    case 'x': element.setAttribute('x', value); return;
    case 'y': element.setAttribute('y', value); return;
    case 'x1': element.setAttribute('x1', value); return;
    case 'x2': element.setAttribute('x2', value); return;
    case 'y1': element.setAttribute('y1', value); return;
    case 'y2': element.setAttribute('y2', value); return;
    case 'cx': element.setAttribute('cx', value); return;
    case 'cy': element.setAttribute('cy', value); return;
    case 'r': element.setAttribute('r', value); return;
    case 'rx': element.setAttribute('rx', value); return;
    case 'ry': element.setAttribute('ry', value); return;
    case 'width': element.setAttribute('width', value); return;
    case 'height': element.setAttribute('height', value); return;
    default: throw new Error('Non-whitelisted SVG attribute');
  }
}

function parseCachedFavicon(svgText, doc = document) {
  if (typeof svgText !== 'string' || !svgText.length || svgText.length > MAX_SVG_CHARS) return null;
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (parsed.querySelector('parsererror') || parsed.doctype ||
      [...parsed.childNodes].some(node => node.nodeType !== 1 && node.nodeType !== 8) ||
      parsed.documentElement?.localName !== 'svg' || parsed.documentElement.namespaceURI !== SVG_NS) return null;
  const source = parsed.documentElement;
  const styled = [...source.children].some(node => node.localName === 'style');
  if (styled && !isKnownFaviconStyle(source)) return null;
  const box = source.getAttribute('viewBox');
  const vb = box?.trim().split(/[\s,]+/).map(Number);
  if (!vb || vb.length !== 4 || vb.some(n => !Number.isFinite(n)) ||
      vb[2] <= 0 || vb[3] <= 0 || vb[2] > 2048 || vb[3] > 2048) return null;
  const out = doc.createElementNS(SVG_NS, 'svg');
  out.setAttribute('viewBox', vb.join(' '));
  out.setAttribute('width', '18');
  out.setAttribute('height', '18');
  out.setAttribute('fill', 'currentColor');
  out.setAttribute('focusable', 'false');
  out.setAttribute('aria-hidden', 'true');
  const rootAllowed = new Set(['xmlns', 'viewBox', 'width', 'height', ...COMMON_ATTRS]);
  for (const attr of source.attributes) {
    if (!rootAllowed.has(attr.name) ||
        (attr.name !== 'xmlns' && attr.name !== 'viewBox' && !safeGraphicAttribute(attr.name, attr.value)) ||
        (attr.name === 'xmlns' && attr.value !== SVG_NS)) return null;
  }
  let count = 0;
  function copyNodes(from, to, depth) {
    if (depth > 6) return false;
    for (const child of from.childNodes) {
      if (child.nodeType === 3 && !child.textContent.trim()) continue;
      if (child.nodeType === 8) continue;
      // Only the exact, already-reviewed official theme CSS is ignored.
      // All other style elements are rejected by the structural gate above.
      if (styled && from === source && child.localName === 'style') continue;
      if (child.nodeType !== 1 || child.namespaceURI !== SVG_NS || !GRAPHICS.has(child.localName)) return false;
      if (++count > 32) return false;
      const element = doc.createElementNS(SVG_NS, child.localName);
      for (const attr of child.attributes) {
        const name = attr.name;
        if (!(COMMON_ATTRS.has(name) || name === 'd' || name === 'points' || name === 'transform' || GEOMETRY.has(name)) ||
            !safeGraphicAttribute(name, attr.value)) return false;
        setSafeSvgAttribute(element, name, attr.value);
      }
      if ((child.localName === 'path' && !element.hasAttribute('d')) ||
          (['polygon', 'polyline'].includes(child.localName) && !element.hasAttribute('points'))) return false;
      if (!copyNodes(child, element, depth + 1)) return false;
      to.appendChild(element);
    }
    return true;
  }
  if (!copyNodes(source, out, 0) || !count) return null;
  return out;
}

function cachedFaviconUrl(doc) {
  if (location.protocol !== 'https:') return null;
  // The site may change favicon names (theme, version or hash) at any time.
  // Accept a single safe .svg basename directly under /cdn/assets/ rather
  // than relying on a hard-coded "favicon.<hash>.svg" convention.
  // Encoded separators and path traversal are excluded by this allowlist.
  const assetSvgPath = /^\/cdn\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.svg$/;
  const urls = [...doc.querySelectorAll('head link[rel~="icon"]')]
    .filter(el => !el.type || el.type === 'image/svg+xml')
    .map(el => {
      try {
        const href = el.getAttribute('href') || '';
        // Reject escapes and dot segments *before* URL normalization: some
        // browsers decode %2E to '.' or collapse /../ in URL.pathname.
        if (href.includes('%') || href.includes('\\') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(href)) return null;
        const url = new URL(href, location.href);
        if (url.origin !== location.origin || url.protocol !== 'https:' ||
            url.username || url.password || url.search || url.hash ||
            !assetSvgPath.test(url.pathname)) return null;
        return url.href;
      } catch { return null; }
    }).filter(Boolean);
  const unique = [...new Set(urls)];
  return unique.length === 1 ? unique[0] : null;
}

async function readCachedFavicon(doc) {
  const url = cachedFaviconUrl(doc);
  if (!url || navigator.serviceWorker?.controller) return null;
  try {
    // The sole reviewed network API use: same-origin, HTTP-CACHE ONLY.
    // No ordinary fetch or retry on miss; an active Service Worker is blocked.
    const response = await window.fetch(url, {
      mode: 'same-origin', cache: 'only-if-cached', credentials: 'same-origin', redirect: 'error'
    });
    if (!response.ok || (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'image/svg+xml') return null;
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_SVG_CHARS) return null;
    return parseCachedFavicon(await response.text(), doc);
  } catch { return null; }
}

function showBadgeLogo() {
  if (!activeRoot?.isConnected || !activeHolder?.isConnected) return;
  // The panel brand follows the selected artwork, including an automatic
  // cache-failure fallback. Never infer it from the intermediate badge SVG.
  const panelBrand = activeRoot.querySelector('.cw-title-info .cw-brand-mark');
  if (panelBrand) panelBrand.hidden = settings.logoPreference !== 'watchdog';
  const graphic = settings.logoPreference === 'openai' && cachedFaviconSvg;
  if (graphic) {
    const current = activeHolder.firstElementChild;
    if (current?.isEqualNode(graphic) && activeHolder.classList.contains('cw-has-site-logo')) return;
    activeHolder.replaceChildren(graphic.cloneNode(true));
    activeHolder.classList.add('cw-has-site-logo');
  } else {
    if (!activeHolder.classList.contains('cw-has-site-logo') &&
        activeHolder.firstElementChild?.classList.contains('cw-watchdog-svg')) return;
    activeHolder.replaceChildren(createWatchdogLogo(activeHolder.ownerDocument));
    activeHolder.classList.remove('cw-has-site-logo');
  }
  const tip = activeRoot.querySelector('.cw-floating-tip');
  const tipLogo = tip?.hidden ? null : tip?.querySelector('.cw-tip-logo');
  if (tipLogo) {
    const copy = activeHolder.cloneNode(true);
    copy.classList.add('cw-tip-logo');
    tipLogo.replaceWith(copy);
  }
}

function switchToWatchdogAfterCacheFailure(persistPreference = true) {
  // The selected option must match the visible artwork, even when the panel
  // has not been opened. A failed settings write is handled by storage status.
  if (settings.logoPreference !== 'openai') return;
  settings.logoPreference = 'watchdog';
  // A failed post-Wipe settings save must not be undone by this async
  // cache-only fallback. Keep the icon and in-memory choice consistent, but
  // do not recreate a settings key after Wipe reported a failed save.
  if (persistPreference) saveSettings();
  for (const button of activeRoot?.querySelectorAll('[data-cw-view-logo]') || []) {
    button.setAttribute('aria-pressed', String(button.dataset.cwViewLogo === 'watchdog'));
  }
  showBadgeLogo();
}

function refreshBadgeSiteIcon(retryCache = false, persistCacheFallback = true) {
  if (!activeRoot?.isConnected || !activeHolder?.isConnected) return;
  if (retryCache) {
    // A manual choice invalidates any in-flight result. Re-selecting ChatGPT
    // makes exactly one fresh cache-only attempt, not a background retry.
    ++cacheGeneration;
    cacheAttempted = false;
    cachedFaviconSvg = null;
  }
  showBadgeLogo();
  if (settings.logoPreference !== 'openai' || cacheAttempted) return;
  cacheAttempted = true;
  const generation = ++cacheGeneration;
  void readCachedFavicon(activeRoot.ownerDocument).then(svg => {
    if (generation !== cacheGeneration || settings.logoPreference !== 'openai') return;
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

export { parseCachedFavicon, cachedFaviconUrl, readCachedFavicon, refreshBadgeSiteIcon, installBadgeSiteIcon };
