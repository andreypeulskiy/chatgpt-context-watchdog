#!/usr/bin/env python3
"""SITE-ICON-CACHE-001: TEST-ONLY Chromium contract for cache-only favicon.

This is deliberately NOT a Watchdog implementation. Only synthetic SVG data,
served from 127.0.0.1, is used. No requests to ChatGPT or external services.

Default mode: actual Chromium DOM/JS with mocked cache responses (14 checks).
Optional --http-cache mode: actual Chromium HTTP cache against a local-only
127.0.0.1 fixture; requires browser permission to access loopback.
Both modes use synthetic shapes; no ChatGPT/OpenAI logo data is bundled.
"""
import collections
import sys
import os
import shutil
import contextlib
import http.server
import threading
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

SVG_NS = 'http://www.w3.org/2000/svg'
SYNTHETIC_SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">'
                 '<path d="M1 1 L19 1 L10 19 Z"/></svg>')
# Fixture only: the real OpenAI/ChatGPT graphic is intentionally not bundled.

# A PROTOTYPE contract, not product source. Whitelist-copy instead of placing
# arbitrary SVG/XML strings into the live document with innerHTML.
JS_CONTRACT = r"""
(() => {
  'use strict';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_BYTES = 16 * 1024;
  const SAFE_ROOT = new Set(['xmlns', 'viewBox', 'width', 'height', 'fill']);
  const SAFE_PATH = new Set(['d', 'fill']);
  function sanitize(input, doc = document) {
    if (typeof input !== 'string' || input.length === 0 || input.length > MAX_BYTES) return null;
    const parsed = new DOMParser().parseFromString(input, 'image/svg+xml');
    if (parsed.querySelector('parsererror') || parsed.documentElement?.localName !== 'svg' ||
        parsed.documentElement.namespaceURI !== SVG_NS) return null;
    // Reject processing instructions or a DTD (no external entity expansion).
    if ([...parsed.childNodes].some(n => n.nodeType !== Node.ELEMENT_NODE)) return null;
    const src = parsed.documentElement;
    for (const attr of src.attributes) if (!SAFE_ROOT.has(attr.name)) return null;
    if (src.children.length !== 1 || src.firstElementChild.localName !== 'path' ||
        src.firstElementChild.namespaceURI !== SVG_NS) return null;
    const path = src.firstElementChild;
    if ([...path.attributes].some(a => !SAFE_PATH.has(a.name))) return null;
    const d = path.getAttribute('d') || '';
    if (!d || d.length > 15000 || !/^[MmLlHhVvCcSsQqTtAaZz0-9 .,+\-eE\s]+$/.test(d)) return null;
    const vb = (src.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (vb.length !== 4 || vb.some(n => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0 ||
        vb[2] > 512 || vb[3] > 512) return null;
    const fill = path.getAttribute('fill') || '';
    if (fill && !/^(currentColor|none|#[0-9a-fA-F]{3,8})$/.test(fill)) return null;
    const out = doc.createElementNS(SVG_NS, 'svg');
    out.setAttribute('viewBox', vb.join(' '));
    out.setAttribute('width', '18');
    out.setAttribute('height', '18');
    out.setAttribute('aria-hidden', 'true');
    out.setAttribute('fill', 'currentColor');
    const child = doc.createElementNS(SVG_NS, 'path');
    child.setAttribute('d', d);
    if (fill) child.setAttribute('fill', fill);
    out.appendChild(child);
    return out;
  }
  async function loadCached(path, testing = null) {
    // Dependency injection is ONLY for synthetic fixture tests.
    // In a real page, use the real origin, SW controller and fetch.
    const base = testing?.origin ?? location.origin;
    const url = new URL(path, base + '/');
    if (url.origin !== base || !['http:', 'https:'].includes(url.protocol))
      return {result: 'reject-origin'};
    const swControlled = testing ? testing.swControlled : !!navigator.serviceWorker?.controller;
    if (swControlled) return {result: 'reject-service-worker'};
    const browserFetch = testing?.fetcher || fetch;
    let response;
    try {
      response = await browserFetch(url.href, {
        mode: 'same-origin', cache: 'only-if-cached', credentials: 'same-origin',
        redirect: 'error'
      });
    } catch (error) { return {result: 'fetch-error'}; }
    if (!response.ok) return {result: 'cache-miss', status: response.status};
    const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (mime !== 'image/svg+xml') return {result: 'reject-mime'};
    const text = await response.text();
    if (text.length > MAX_BYTES) return {result: 'reject-size'};
    const cloned = sanitize(text);
    if (!cloned) return {result: 'reject-svg'};
    return {result: 'cache-hit', size: text.length, svg: cloned.outerHTML};
  }
  window.__siteIconCache001 = {loadCached, sanitize};
})();
"""

SW_SCRIPT = """
self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (new URL(e.request.url).pathname === '/favicon.mock.svg') {
    e.respondWith((async () => {
      // Intentional local-only SW hazard fixture, not part of Watchdog.
      await fetch('/sw-beacon?controlled=1', {cache: 'no-store'});
      return new Response('<svg/>', {headers: {'Content-Type': 'image/svg+xml'}});
    })());
  }
});
"""

class Handler(http.server.BaseHTTPRequestHandler):
    counters = collections.Counter()
    lock = threading.Lock()

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        path = urlsplit(self.path).path
        with self.lock:
            self.counters[path] += 1
        if path == '/favicon.mock.svg':
            content = SYNTHETIC_SVG.encode()
            mime = 'image/svg+xml'
            policy = 'public, max-age=3600'
        elif path == '/fake.svg':
            content = SYNTHETIC_SVG.encode()
            mime = 'text/plain'
            policy = 'public, max-age=3600'
        elif path == '/sw.js':
            content = SW_SCRIPT.encode()
            mime = 'application/javascript'
            policy = 'no-store'
        elif path == '/sw-beacon':
            content = b'beacon'
            mime = 'text/plain'
            policy = 'no-store'
        elif path == '/':
            content = b'<!doctype html><html><head><title>cache fixture</title></head><body>fixture</body></html>'
            mime = 'text/html'
            policy = 'no-store'
        else:
            content = b'not found'
            mime = 'text/plain'
            policy = 'no-store'
        self.send_response(200 if path in ('/', '/favicon.mock.svg', '/fake.svg', '/sw.js', '/sw-beacon') else 404)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', policy)
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def counter(path):
    with Handler.lock:
        return Handler.counters[path]


def assess(outcome, expected, label):
    assert outcome == expected, f'{label}: expected {expected!r}, got {outcome!r}'
    print(f'PASS SITE-ICON-CACHE-001/{assess.count:02d} {label}', flush=True)
    assess.count += 1
assess.count = 1


def evaluate(page, path):
    return page.evaluate('p => window.__siteIconCache001.loadCached(p)', path)


def check_svg_guards(page):
    valid = page.evaluate('(s) => window.__siteIconCache001.sanitize(s)?.outerHTML ?? null', SYNTHETIC_SVG)
    assert valid and '<path' in valid and 'width="18"' in valid
    assert '<script' not in valid and '<use' not in valid
    assess(True, True, 'safe synthetic SVG is rebuilt with allowlisted DOM nodes')

    cases = [
      ('script', SYNTHETIC_SVG.replace('</svg>', '<script>alert(1)</script></svg>')),
      ('external use', SYNTHETIC_SVG.replace('<path', '<use href="https://example.invalid/a.svg#icon"/><path')),
      ('embedded image', SYNTHETIC_SVG.replace('<path', '<image href="https://example.invalid/logo.svg"/><path')),
      ('foreignObject', SYNTHETIC_SVG.replace('<path', '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject><path')),
      ('event handler', SYNTHETIC_SVG.replace('<path', '<path onclick="alert(1)"')),
      ('css url', SYNTHETIC_SVG.replace('<path', '<path fill="url(https://example.invalid/a)"')),
      ('bad XML', SYNTHETIC_SVG.replace('</svg>', '')),
      ('oversized', SYNTHETIC_SVG + ' ' * 20000),
      ('XML processing instruction', '<?xml-stylesheet href="https://example.invalid/evil.css"?>' + SYNTHETIC_SVG),
    ]
    results = page.evaluate('''cases => cases.map(([label, input]) => ({label, accepted: !!window.__siteIconCache001.sanitize(input)}))''', cases)
    failures = [r['label'] for r in results if r['accepted']]
    assert not failures, f'Unsafe SVG accepted: {failures}'
    assess(len(results), 9, 'nine malformed/active/external SVG variants are rejected')


def launch_browser(pw):
    """Use locally installed Chromium, or WATCHDOG_BROWSER_CHANNEL=msedge."""
    options = {'headless': True}
    channel = os.environ.get('WATCHDOG_BROWSER_CHANNEL')
    if channel:
        options['channel'] = channel
    else:
        executable = os.environ.get('WATCHDOG_BROWSER_EXE') or shutil.which('chromium') or shutil.which('chromium-browser')
        if executable:
            options['executable_path'] = executable
    if sys.platform.startswith('linux'):
        options['args'] = ['--no-sandbox']
    return pw.chromium.launch(**options)


def run_http_cache():
    Handler.counters.clear()
    with http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        host = f'http://127.0.0.1:{server.server_port}'
        browser_requests = []
        with sync_playwright() as pw:
            browser = launch_browser(pw)
            try:
                context = browser.new_context(service_workers='allow')
                page = context.new_page()
                page.on('request', lambda req: browser_requests.append(req.url))
                page.goto(host, wait_until='load')
                page.add_script_tag(content=JS_CONTRACT)
                assess(page.evaluate('!navigator.serviceWorker.controller'), True,
                       'clean context has no controlling Service Worker')

                # Explicitly warm the LOCAL fixture. This network request is setup only.
                before = counter('/favicon.mock.svg')
                status = page.evaluate("async () => (await fetch('/favicon.mock.svg')).status")
                assert status == 200 and counter('/favicon.mock.svg') == before + 1
                assess(True, True, 'synthetic favicon primed once from local test server')

                before = counter('/favicon.mock.svg')
                result = evaluate(page, '/favicon.mock.svg')
                assert result['result'] == 'cache-hit', result
                assert '<path' in result['svg'] and 'M1 1 L19 1 L10 19 Z' in result['svg']
                assess(True, True, 'only-if-cached returns a valid sanitized SVG')
                assess(counter('/favicon.mock.svg'), before,
                       'HTTP cache hit makes zero additional origin GET requests')

                miss_path = '/never-requested-001.svg'
                before = counter(miss_path)
                miss = evaluate(page, miss_path)
                assert miss['result'] == 'cache-miss', miss
                assert miss.get('status') == 504, miss
                assess(counter(miss_path), before,
                       'cold HTTP cache produces 504 without contacting local origin')

                # CacheStorage is a separate store and remains empty despite HTTP hit.
                in_storage = page.evaluate("async () => Boolean(await caches.match('/favicon.mock.svg'))")
                assess(in_storage, False, 'CacheStorage is independent of the browser HTTP cache')

                # Same-origin enforcement must block external URLs before fetch.
                before_reqs = len(browser_requests)
                outside = evaluate(page, 'https://example.invalid/favicon.svg')
                assess(outside['result'], 'reject-origin', 'external-origin URL rejected before fetch')
                assess(len(browser_requests), before_reqs,
                       'external-origin rejection emits zero requests')

                # MIME type guard: warm a safe fixture served under the WRONG MIME.
                assert page.evaluate("async () => (await fetch('/fake.svg')).status") == 200
                before = counter('/fake.svg')
                bad_mime = evaluate(page, '/fake.svg')
                assess(bad_mime['result'], 'reject-mime', 'cached non-SVG MIME type rejected')
                assess(counter('/fake.svg'), before,
                       'cached wrong-MIME response causes no additional HTTP request')

                check_svg_guards(page)
                context.close()

                # A separate context simulates a site-controlled page. This is the
                # critical guard: Service Workers can intercept cache-only fetches.
                controlled = browser.new_context(service_workers='allow')
                swpage = controlled.new_page()
                swpage.on('request', lambda req: browser_requests.append(req.url))
                swpage.goto(host, wait_until='load')
                swpage.add_script_tag(content=JS_CONTRACT)
                reg = swpage.evaluate("async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; return true; }")
                assert reg
                swpage.wait_for_function('Boolean(navigator.serviceWorker.controller)', timeout=10000)
                assess(swpage.evaluate('Boolean(navigator.serviceWorker.controller)'), True,
                       'real Chromium Service Worker takes control')
                before_sw_favicon = counter('/favicon.mock.svg')
                before_beacon = counter('/sw-beacon')
                blocked = evaluate(swpage, '/favicon.mock.svg')
                assess(blocked['result'], 'reject-service-worker',
                       'cache-only operation is blocked on SW-controlled page')
                assess((counter('/favicon.mock.svg'), counter('/sw-beacon')),
                       (before_sw_favicon, before_beacon),
                       'SW guard causes zero origin and SW-beacon GET requests')
                controlled.close()

                assert all(u.startswith(host) for u in browser_requests), [
                    u for u in browser_requests if not u.startswith(host)]
                assess(True, True, 'all Chromium fixture traffic stays on 127.0.0.1')
            finally:
                browser.close()
        server.shutdown()
    print(f'PASS SITE-ICON-CACHE-001: {assess.count - 1}/{assess.count - 1}; TEST-ONLY (no product integration)', flush=True)

def run_offline():
    """Synthetic browser exercise, with NO actual HTTP requests."""
    with sync_playwright() as pw:
        browser = launch_browser(pw)
        try:
            context = browser.new_context()
            page = context.new_page()
            seen_requests = []
            page.on('request', lambda req: seen_requests.append(req.url))
            page.set_content('<!doctype html><html><body><h1>Offline cache contract fixture</h1></body></html>')
            page.add_script_tag(content=JS_CONTRACT)
            page.evaluate("""svg => {
              const f = window.__mockCache001 = {
                origin: 'https://fixture.invalid', entries: new Map(), requests: [],
                swControlled: false, throwOnFetch: false
              };
              f.entries.set('https://fixture.invalid/favicon.mock.svg', {body: svg, mime: 'image/svg+xml'});
              f.entries.set('https://fixture.invalid/fake.svg', {body: svg, mime: 'text/plain'});
              f.entries.set('https://fixture.invalid/giant.svg', {
                body: svg + ' '.repeat(17000), mime: 'image/svg+xml'
              });
              f.fetcher = async (url, options) => {
                f.requests.push({url, options});
                if (f.throwOnFetch) throw Error('Synthetic fetch failure');
                const hit = f.entries.get(url);
                if (!hit) return new Response('', {status: 504});
                return new Response(hit.body, {status: 200, headers: {'Content-Type': hit.mime}});
              };
              window.__loadMockCache001 = path => window.__siteIconCache001.loadCached(path, {
                origin: f.origin, swControlled: f.swControlled, fetcher: f.fetcher
              });
            }""", SYNTHETIC_SVG)
            assess(True, True, 'Chromium initialized synthetic contract without HTTP')
            result = page.evaluate("() => window.__loadMockCache001('/favicon.mock.svg')")
            assert result['result'] == 'cache-hit', result
            assert '<path' in result['svg'] and 'M1 1 L19 1 L10 19 Z' in result['svg']
            assess(True, True, 'synthetic cache hit returns sanitized independent SVG clone')

            calls = page.evaluate('window.__mockCache001.requests')
            assert len(calls) == 1
            opts = calls[0]['options']
            assert opts == {'mode':'same-origin','cache':'only-if-cached','credentials':'same-origin','redirect':'error'}, opts
            assess(True, True, 'only-if-cached request has restrictive options')

            before = page.evaluate('window.__mockCache001.requests.length')
            miss = page.evaluate("() => window.__loadMockCache001('/never-stored.svg')")
            assert miss['result'] == 'cache-miss' and miss.get('status') == 504, miss
            assess(page.evaluate('window.__mockCache001.requests.length') - before, 1,
                   'synthetic cache miss 504 triggers only one attempt without retry')

            before = page.evaluate('window.__mockCache001.requests.length')
            bad_origin = page.evaluate("() => window.__loadMockCache001('https://example.invalid/favicon.svg')")
            assess(bad_origin['result'], 'reject-origin', 'foreign origin rejected before fetch')
            assess(page.evaluate('window.__mockCache001.requests.length'), before,
                   'cross-origin URL causes no fetch call')

            bad_mime = page.evaluate("() => window.__loadMockCache001('/fake.svg')")
            assess(bad_mime['result'], 'reject-mime', 'wrong MIME type is rejected')
            giant = page.evaluate("() => window.__loadMockCache001('/giant.svg')")
            assess(giant['result'], 'reject-size', 'oversized SVG is rejected')
            check_svg_guards(page)

            page.evaluate('window.__mockCache001.swControlled = true')
            before = page.evaluate('window.__mockCache001.requests.length')
            sw = page.evaluate("() => window.__loadMockCache001('/favicon.mock.svg')")
            assess(sw['result'], 'reject-service-worker', 'SW-controlled state skips operation')
            assess(page.evaluate('window.__mockCache001.requests.length'), before,
                   'SW guard prevents any fetch attempt')

            page.evaluate('''() => {
              window.__mockCache001.swControlled = false;
              window.__mockCache001.throwOnFetch = true;
            }''')
            error = page.evaluate("() => window.__loadMockCache001('/favicon.mock.svg')")
            assess(error['result'], 'fetch-error', 'cache API failure does not retry over network')

            assess(len(seen_requests), 0, 'Chromium synthetic exercise made no actual requests')
            context.close()
        finally:
            browser.close()
    print(f'PASS SITE-ICON-CACHE-001: {assess.count-1}/{assess.count-1} '
          '(synthetic policy only, NOT real HTTP-cache validation)', flush=True)


if __name__ == '__main__':
    if '--http-cache' in sys.argv:
        # Requires a browser installation permitting 127.0.0.1 navigation.
        run_http_cache()
    else:
        run_offline()
