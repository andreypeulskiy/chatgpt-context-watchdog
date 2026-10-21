#!/usr/bin/env python3
"""SITE-ICON-001: synthetic DOM contract for an inline site-sourced logo.

Default: exercise the structural prototype and current product integration.
--product: exercise only the product integration and lifecycle contract.

No real ChatGPT path data or image is stored here; paths are synthetic shapes.
Does not modify production sources, stored state, or decide missing-icon fallback.
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SVG_NS = "http://www.w3.org/2000/svg"
# These deliberately do NOT resemble the ChatGPT logo.
SHAPE_A = "M1 1 L18 1 L10 18 Z"
SHAPE_B = "M2 2 L17 2 L9 17 Z"

# A test-only implementation of the agreed *structural* discovery contract.
# It is NOT imported by Watchdog and is NOT evidence of production integration.
PROTOTYPE = r"""
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  window.__siteIcon001 = function discoverAndClone(doc = document) {
    const triggers = [...doc.querySelectorAll('button[data-app-shell-sidebar-trigger="true"]')];
    if (triggers.length !== 1) return null;
    const candidates = [...triggers[0].querySelectorAll('svg')].filter(svg => {
      if (svg.getAttribute('viewBox') !== '0 0 20 20') return false;
      if (svg.children.length !== 1) return false;
      if (svg.querySelectorAll('path').length !== 1 || svg.querySelector('use')) return false;
      const path = svg.firstElementChild;
      return path.localName === 'path' && path.namespaceURI === NS &&
        Boolean(path.getAttribute('d')?.trim());
    });
    if (candidates.length !== 1) return null;
    const source = candidates[0];
    const dst = doc.createElementNS(NS, 'svg');
    dst.setAttribute('viewBox', '0 0 20 20');
    dst.setAttribute('width', '18');
    dst.setAttribute('height', '18');
    dst.setAttribute('fill', 'currentColor');
    dst.setAttribute('aria-hidden', 'true');
    dst.setAttribute('focusable', 'false');
    const path = doc.createElementNS(NS, 'path');
    // Read-only access to site DOM; copy only drawing path data, never attributes.
    path.setAttribute('d', source.firstElementChild.getAttribute('d'));
    dst.append(path);
    return dst;
  };
})();
"""

def page_html():
    return '<!doctype html><html><body><div id="site"></div><div id="watchdog"></div></body></html>'


def logo(shape=SHAPE_A, opacity="1", extras="", path_extras=""):
    return (f'<svg class="Icon-X4VkKC" viewBox="0 0 20 20" width="20" height="20" '
            f'style="opacity:{opacity}" data-no-autosize="true" {extras}>'
            f'<path d="{shape}" {path_extras}></path></svg>')


def other_icons():
    return ('<svg viewBox="0 0 16 16" style="opacity:0"><use href="/cdn/icons.svg#sidebar-16"></use></svg>'
            '<svg viewBox="0 0 20 20" style="opacity:0"><use href="/cdn/icons.svg#sidebar-hidden-light-20"></use></svg>')


def button(content):
    return f'<button type="button" data-app-shell-sidebar-trigger="true" aria-controls="app-shell-sidebar">{content}</button>'


def mount(page, html):
    page.locator('#site').evaluate('(node, html) => { node.innerHTML = html; }', html)


def clone(page):
    return page.evaluate('''() => {
      const icon = window.__siteIcon001();
      if (!icon) return null;
      const source = document.querySelector('button[data-app-shell-sidebar-trigger="true"] svg path');
      return {
        outer: icon.outerHTML,
        node: icon.localName,
        namespace: icon.namespaceURI,
        childCount: icon.children.length,
        pathCount: icon.querySelectorAll('path').length,
        useCount: icon.querySelectorAll('use').length,
        d: icon.querySelector('path')?.getAttribute('d'),
        viewBox: icon.getAttribute('viewBox'),
        width: icon.getAttribute('width'),
        height: icon.getAttribute('height'),
        fill: icon.getAttribute('fill'),
        connected: icon.isConnected,
        sameNode: icon === source,
        classAttr: icon.getAttribute('class'),
      };
    }''')


def fixture_cases(page):
    count = 0
    def passed(message):
        nonlocal count
        count += 1
        print(f'PASS SITE-ICON-001/{count:02d} {message}', flush=True)

    mount(page, button(logo() + other_icons()))
    original = page.locator('#site svg').first.evaluate('(node) => node.outerHTML')
    result = clone(page)
    assert result is not None
    assert result['namespace'] == SVG_NS
    assert result['node'] == 'svg' and result['childCount'] == 1
    assert result['pathCount'] == 1 and result['useCount'] == 0
    assert result['d'] == SHAPE_A
    assert result['viewBox'] == '0 0 20 20'
    assert (result['width'], result['height'], result['fill']) == ('18', '18', 'currentColor')
    assert result['classAttr'] is None and result['connected'] is False
    assert page.locator('#site svg').first.evaluate('(node) => node.outerHTML') == original
    passed('three SVG: only inline path is selected; clone is detached and source stays untouched')

    # Don't require opacity=1: on hover the logo can become invisible on the site.
    mount(page, button(logo(opacity="0") + other_icons()))
    assert clone(page)['d'] == SHAPE_A
    passed('opacity 0 on logo does not break structural detection')

    mount(page, button(other_icons()))
    assert clone(page) is None
    passed('only external <use> icons: no candidate')

    mount(page, button(logo() + logo(SHAPE_B) + other_icons()))
    assert clone(page) is None
    passed('two structurally matching SVGs: reject ambiguity')

    mount(page, button(logo()) + button(logo(SHAPE_B)))
    assert clone(page) is None
    passed('two sidebar triggers: reject ambiguity')

    mount(page, button('<svg viewBox="0 0 16 16"><path d="M1 1 L5 5"></path></svg>'))
    assert clone(page) is None
    passed('wrong viewBox: reject')

    mount(page, button('<svg viewBox="0 0 20 20"><path d="M1 1"></path><use href="#other"></use></svg>'))
    assert clone(page) is None
    passed('mixed path/use: reject')

    mount(page, button('<svg viewBox="0 0 20 20"><path></path></svg>'))
    assert clone(page) is None
    passed('empty path d: reject')

    mount(page, '')
    assert clone(page) is None
    mount(page, button(logo() + other_icons()))
    assert clone(page)['d'] == SHAPE_A
    passed('late-mounted button: a subsequent attempt finds the icon')

    mount(page, button(logo() + other_icons()))
    page.evaluate('''() => {
      window.__siteIcon001Previous = window.__siteIcon001();
      document.querySelector('#watchdog').append(window.__siteIcon001Previous);
    }''')
    mount(page, button(logo(SHAPE_B) + other_icons()))
    assert clone(page)['d'] == SHAPE_B
    assert page.locator('#watchdog svg path').get_attribute('d') == SHAPE_A
    passed('React-like remount: reacquires new source, old clone independent')

    mount(page, button(logo(
        extras='data-danger="example" class="injected-class" tabindex="17"',
        path_extras='data-extra="danger" onclick="window.__siteIcon001Poisoned=true"'
    ) + other_icons()))
    before = page.locator('#site svg').first.evaluate('(node) => node.outerHTML')
    page.evaluate('''() => {
      const badge = document.querySelector('#watchdog');
      badge.replaceChildren(window.__siteIcon001());
    }''')
    after = page.locator('#site svg').first.evaluate('(node) => node.outerHTML')
    result_outer = page.locator('#watchdog svg').evaluate('(node) => node.outerHTML')
    assert before == after
    assert 'data-danger' not in result_outer and 'data-extra' not in result_outer
    assert 'onclick' not in result_outer and 'injected-class' not in result_outer
    assert 'tabindex' not in result_outer and 'href' not in result_outer
    assert page.evaluate('window.__siteIcon001Poisoned === undefined')
    assert page.locator('#watchdog svg path').get_attribute('d') == SHAPE_A
    passed('sanitized clone: no source classes, events, extra attributes or mutation')

    # Selection is deliberately limited to the sidebar trigger. Watchdog's own SVG
    # (and any other path-based icons on the page) must not be considered.
    mount(page, button(other_icons()))
    page.locator('#watchdog').evaluate('(node) => node.innerHTML = `<svg viewBox="0 0 20 20"><path d="M1 1"/></svg>`')
    assert clone(page) is None
    passed('scope isolation: SVGs outside the sidebar trigger are ignored')
    return count


def product_case(page):
    # Before any valid site match, only the existing Watchdog brand is shown.
    mount(page, '')
    version_line = next(line for line in (ROOT / 'src/userscript-header.txt').read_text().splitlines()
                        if line.startswith('// @version'))
    version = version_line.split()[-1]
    bundle = ROOT / 'dist' / f'chatgpt-context-watchdog-{version}.user.js'
    assert bundle.exists(), 'Stable build not present'
    page.add_script_tag(content=bundle.read_text(encoding='utf-8'))
    page.locator('.cw-logo-hit').wait_for(timeout=3000)
    assert page.locator('.cw-chip .cw-site-icon.cw-brand-mark:not(.cw-has-site-logo)').count() == 1
    assert page.locator('.cw-logo-hit svg').count() == 0
    print('PASS SITE-ICON-001/product initial fallback before first source', flush=True)
    mount(page, button(logo() + other_icons()))
    page.wait_for_function('''d => document.querySelector('.cw-site-icon svg path')?.getAttribute('d') === d''', arg=SHAPE_A)
    seen = page.locator('.cw-logo-hit svg path').count()
    assert seen == 1, ('PRODUCT RED (feature not implemented): badge should contain '
                       f'exactly one site-sourced inline SVG path; observed {seen}')
    got = page.locator('.cw-logo-hit svg path').first.get_attribute('d')
    assert got == SHAPE_A, f'PRODUCT RED: badge graphic differs from site DOM ({got!r})'
    print('PASS SITE-ICON-001/product Watchdog uses site-sourced inline SVG', flush=True)
    chip = page.locator('.cw-chip')
    chip.evaluate("e => e.dataset.cwTip = 'Open Watchdog panel'")
    chip.hover()
    page.wait_for_timeout(620)
    tip = page.locator('.cw-floating-tip')
    assert tip.is_visible() and tip.locator('.cw-tip-logo svg path').get_attribute('d') == SHAPE_A
    print('PASS SITE-ICON-001/product site SVG matches tooltip', flush=True)


    # React may temporarily remove the sidebar trigger; keep the previously
    # validated SVG instead of visibly switching back to the brand mask.
    mount(page, '')
    page.wait_for_timeout(100)
    assert page.locator('.cw-chip .cw-site-icon.cw-has-site-logo svg path').get_attribute('d') == SHAPE_A
    assert tip.locator('.cw-tip-logo svg path').get_attribute('d') == SHAPE_A
    print('PASS SITE-ICON-001/product sticky site icon through trigger gap', flush=True)

    # Late mounts and React-style replacements update the badge without polling.
    mount(page, button(logo(SHAPE_B) + other_icons()))
    page.wait_for_function('''d => document.querySelector('.cw-site-icon svg path')?.getAttribute('d') === d''', arg=SHAPE_B)
    assert page.locator('.cw-chip .cw-site-icon svg path').get_attribute('d') == SHAPE_B
    assert tip.locator('.cw-tip-logo svg path').get_attribute('d') == SHAPE_B
    mount(page, button(logo() + other_icons()))
    page.wait_for_function('''d => document.querySelector('.cw-site-icon svg path')?.getAttribute('d') === d''', arg=SHAPE_A)
    print('PASS SITE-ICON-001/product delayed mount and React remount', flush=True)

    # Ambiguity must not replace an icon already acquired from a valid source.
    mount(page, button(logo() + logo(SHAPE_B) + other_icons()))
    page.wait_for_timeout(100)
    assert page.locator('.cw-chip .cw-site-icon.cw-has-site-logo svg path').get_attribute('d') == SHAPE_A
    print('PASS SITE-ICON-001/product ambiguous DOM does not override known icon', flush=True)

    # Tooltip must follow the sticky icon, never the initial fallback.
    chip = page.locator('.cw-chip')
    chip.evaluate("e => e.dataset.cwTip = 'Open Watchdog panel'")
    chip.hover()
    page.wait_for_timeout(650)
    tip = page.locator('.cw-floating-tip')
    assert tip.is_visible() and tip.locator('.cw-tip-logo svg path').get_attribute('d') == SHAPE_A
    print('PASS SITE-ICON-001/product sticky tooltip mirrors badge', flush=True)


def main():
    product = '--product' in sys.argv[1:]
    requests = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        try:
            page = browser.new_page(viewport={'width': 390, 'height': 740})
            page.route('**/*', lambda route: (requests.append(route.request.url), route.abort()))
            page.set_content(page_html())
            if not product:
                page.add_script_tag(content=PROTOTYPE)
                fixture_cases(page)
            # Page DOM discovery is not an accepted favicon source.
            assert not requests, f'Unexpected network requests: {requests}'
            print('PASS SITE-ICON-001/network zero additional requests', flush=True)
        finally:
            browser.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'FAIL SITE-ICON-001: {error}', file=sys.stderr, flush=True)
        raise
