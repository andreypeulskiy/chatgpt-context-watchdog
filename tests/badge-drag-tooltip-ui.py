#!/usr/bin/env python3
"""Moving the badge must dismiss its tooltip at drag threshold and cancel pending hover."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from support.current import VERSION

ROOT = Path(__file__).resolve().parents[1]
CHAT = '11111111-1111-4111-8111-111111111111'
HTML = '''<!doctype html><html><body>
<main><section data-chatgpt-search-unit-key="test:user" data-chatgpt-search-message-ids="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"><div class="whitespace-pre-wrap">A complete chat message whose tokens appear on the badge.</div></section></main>
<form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form></body></html>'''


def run(browser, variant):
    page = browser.new_page(viewport={'width': 1200, 'height': 900})
    page.set_default_timeout(7000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(HTML)
    page.evaluate('''() => {
      const bytes = new Map();
      Object.defineProperty(window,'localStorage', {configurable:true,value: {
        getItem:k => bytes.get(String(k)) ?? null,
        setItem:(k,v) => bytes.set(String(k),String(v)),
        removeItem:k => bytes.delete(String(k)),
        key:i => [...bytes.keys()][i] ?? null,
        get length(){return bytes.size}
      }});
    }''')
    suffix = '.dev' if variant == 'Dev' else ''
    filepath = ROOT/'dist'/f'chatgpt-context-watchdog-{VERSION}{suffix}.user.js'
    code = filepath.read_text().replace('(() => {',
        f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};", 1)
    page.add_script_tag(content=code)
    page.locator('[id$="-root"]').evaluate('''r => {
      r.style.left='100px';r.style.top='90px';r.style.right='auto';r.style.bottom='auto';
    }''')
    chip = page.locator('.cw-chip')
    tip = page.locator('.cw-floating-tip')
    box = chip.bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2

    # Moving under the threshold must neither dismiss a live tooltip nor trigger a drag.
    page.mouse.move(x, y)
    page.wait_for_timeout(560)
    assert tip.is_visible(), f'{variant}: initial tooltip did not appear'
    page.mouse.down()
    page.mouse.move(x+2, y+1)
    assert tip.is_visible(), f'{variant}: tiny pointer move incorrectly dismissed tooltip'
    page.mouse.move(x+75, y+45, steps=5)
    assert not tip.is_visible(), f'{variant}: tooltip remains during a real drag'
    page.mouse.up()
    assert not tip.is_visible(), f'{variant}: tooltip reappeared at release'
    assert chip.bounding_box()['x'] > box['x']+35, f'{variant}: badge did not move'
    page.wait_for_timeout(640)
    assert not tip.is_visible(), f'{variant}: old hover reopened tooltip without a new hover'

    # Only leaving and re-entering the badge restores ordinary hover behavior.
    page.mouse.move(0, 0)
    page.mouse.move(x+74, y+44)
    page.wait_for_timeout(560)
    assert tip.is_visible(), f'{variant}: new hover should show tooltip again'

    # A drag started before the 500ms hint delay must cancel its queued timer.
    page.mouse.move(0, 0)
    page.mouse.move(x+74, y+44)
    page.wait_for_timeout(100)
    page.mouse.down()
    page.mouse.move(x+125, y+80, steps=5)
    assert not tip.is_visible(), f'{variant}: pending hover not dismissed at drag start'
    page.mouse.up()
    page.wait_for_timeout(600)
    assert not tip.is_visible(), f'{variant}: pending tooltip timer fired after drag'
    assert not errors, (variant,errors)
    page.close()
    print(f'PASS {variant}: badge hint closes on drag threshold, remains closed until hover exits, pending timer cancelled', flush=True)


with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    for variant in ('Stable','Dev'):
        run(browser, variant)
    browser.close()
