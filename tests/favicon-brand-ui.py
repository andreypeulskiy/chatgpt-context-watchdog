#!/usr/bin/env python3
"""Strict cache-only favicon security and consistent Watchdog SVG across UI surfaces."""
import importlib.util
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('prior_logo_qa', ROOT / 'tests' / 'logo-tooltip-ui.py')
PRIOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PRIOR)

OFFICIAL = '''<!-- https://github.com/openai/openai icon -->
<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180" fill="none">
  <style>
    :root { fill: #000; }
    @media (prefers-color-scheme: dark) { :root { fill: #fff; } }
  </style>
  <path d="M20 20 L160 20 L90 160 Z"/>
</svg>'''


def color_contrast(a,b):
    """Computed foreground and outline contrast, independent of exact RGB tokens."""
    def lum(value):
        channels=[float(v) for v in re.findall(r'[\d.]+',value)[:3]]
        assert len(channels)==3,value
        linear=[v/255/12.92 if v/255<=.04045 else ((v/255+.055)/1.055)**2.4 for v in channels]
        return sum(v*w for v,w in zip(linear,(.2126,.7152,.0722)))
    light,dark=lum(a),lum(b)
    return (max(light,dark)+.05)/(min(light,dark)+.05)

def assert_no_side_effects(p, errors, requests):
    assert not errors, errors
    assert not requests, requests
    calls = p.evaluate('window.__cacheCalls')
    assert len(calls) == 1, calls
    assert calls[0]['options'] == {
        'mode': 'same-origin', 'cache': 'only-if-cached',
        'credentials': 'same-origin', 'redirect': 'error'
    }, calls


def check_official(browser, suffix):
    p, errors, requests = PRIOR.start(browser, suffix, svg=OFFICIAL)
    p.wait_for_function('document.querySelector(".cw-site-icon svg path")?.getAttribute("d") === "M20 20 L160 20 L90 160 Z"')
    doc = p.evaluate('''() => {
      const el = document.querySelector('.cw-site-icon svg');
      return {
        children: [...el.children].map(x => x.localName),
        fill: el.getAttribute('fill'),
        styleCount: document.querySelectorAll('.cw-site-icon svg style').length,
        rawXmlInStorage: Object.values(localStorage).some(s => typeof s === 'string' && s.includes('prefers-color-scheme'))
      };
    }''')
    assert doc['children'] == ['path'], doc
    assert doc['fill'] == 'currentColor' and doc['styleCount'] == 0, doc
    assert PRIOR.get_saved(p) in (None, 'openai')
    assert_no_side_effects(p, errors, requests)
    p.close()
    print(f'PASS favicon {suffix or "Stable"}: official styled SVG => sanitized path (no injected style, no network)', flush=True)

    # One-at-a-time hostile/unexpected constructs cannot broaden the gate.
    for name, hostile in {
        'css-import': OFFICIAL.replace(':root { fill: #000; }', '@import url(https://attacker.invalid/x.css); :root { fill: #000; }'),
        'css-url': OFFICIAL.replace('#fff', 'url(https://attacker.invalid/x)'),
        'css-extra-rule': OFFICIAL.replace('</style>', ' body { opacity: 0; } </style>'),
        'svg-script': OFFICIAL.replace('</svg>', '<script>alert(1)</script></svg>'),
        'path-handler': OFFICIAL.replace('<path d=', '<path onclick="alert(1)" d='),
        'style-handler': OFFICIAL.replace('<style>', '<style onload="alert(1)">'),
        'extra-path': OFFICIAL.replace('</svg>', '<path d="M0 0 L1 1"/></svg>'),
        'wrong-geometry': OFFICIAL.replace('viewBox="0 0 180 180"', 'viewBox="0 0 200 200"'),
        'foreign-tag': OFFICIAL.replace('</svg>', '<foreignObject/></svg>'),
    }.items():
        p, errors, requests = PRIOR.start(browser, suffix, svg=hostile)
        p.wait_for_function('''() => Array.from({length:localStorage.length},(_,i)=>localStorage.getItem(localStorage.key(i)))
          .some(s => s && s.includes('"logoPreference":"watchdog"'))''')
        assert p.locator('.cw-chip .cw-watchdog-svg path').count() == 3, name
        assert PRIOR.get_saved(p) == 'watchdog', name
        assert_no_side_effects(p, errors, requests)
        p.close()
    print(f'PASS favicon {suffix or "Stable"}: 9 malformed/hostile variants rejected, fallback persisted', flush=True)


def check_watchdog_art(browser, suffix):
    p, errors, requests = PRIOR.start(browser, suffix, result='miss')
    p.wait_for_function('''() => Array.from({length:localStorage.length},(_,i)=>localStorage.getItem(localStorage.key(i)))
      .some(s => s && s.includes('"logoPreference":"watchdog"'))''')
    p.locator('.cw-chip').hover()
    p.wait_for_timeout(790)
    result = p.evaluate('''() => {
      const root = document.querySelector('[id$="-root"]');
      const report = selector => {
        const node = root.querySelector(selector);
        const cs = getComputedStyle(node);
        const svg = node.querySelector('.cw-watchdog-svg');
        const paths = [...svg.querySelectorAll('path')];
        return {width:cs.width,height:cs.height,fill:paths.map(p=>getComputedStyle(p).fill),
          stroke:getComputedStyle(paths[0]).stroke,ds:paths.map(p=>p.getAttribute('d'))};
      };
      return {header:report('.cw-title-info .cw-brand-mark'),
        badge:report('.cw-chip .cw-brand-mark'),
        tooltip:report('.cw-floating-tip .cw-tip-logo')};
    }''')
    assert all(float(result[k]['width'][:-2])>0 and float(result[k]['height'][:-2])>0 for k in ('header','badge','tooltip')),result
    assert result['badge']['ds'] == result['header']['ds'] == result['tooltip']['ds']
    assert len(result['badge']['ds']) == 3
    assert color_contrast(result['tooltip']['fill'][0],result['tooltip']['stroke'])>=4.5, result
    assert_no_side_effects(p, errors, requests)
    p.close()
    print(f'PASS Watchdog SVG {suffix or "Stable"}: consistent visual mark on three surfaces; tooltip readable on dark popover', flush=True)


if __name__ == '__main__':
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox','--disable-dev-shm-usage'])
        try:
            for suffix in ('', '.dev'):
                check_official(browser, suffix)
                check_watchdog_art(browser, suffix)
        finally:
            browser.close()
