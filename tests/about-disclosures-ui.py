#!/usr/bin/env python3
"""Shared disclosure class and session-persistent About state in Stable and Dev."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
VERSION = re.search(r'^// @version\s+(\S+)$', (ROOT/'src/userscript-header.txt').read_text(), re.M).group(1)
CHAT = '11111111-1111-4111-8111-111111111111'
HTML = '''<!doctype html><html><body><main></main>
<form data-chatgpt-composer><textarea id="prompt-textarea"></textarea>
<button type="button" data-testid="send-button">Send</button></form></body></html>'''

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                args=['--no-sandbox', '--disable-dev-shm-usage'])
    for suffix in ('', '.dev'):
        page = browser.new_page(viewport={'width': 800, 'height': 800})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(8000)
        page.set_content(HTML)
        page.evaluate('''() => {
          const data = new Map();
          Object.defineProperty(window,'localStorage',{configurable:true,value:{
            getItem:k=>data.get(String(k))??null,
            setItem:(k,v)=>data.set(String(k),String(v)),
            removeItem:k=>data.delete(String(k)),
            key:i=>[...data.keys()][i]??null,
            get length(){return data.size}
          }});
        }''')
        code = (ROOT/f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text()
        code = code.replace('(() => {', f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};", 1)
        page.add_script_tag(content=code)
        page.locator('.cw-logo-hit').click()
        page.locator('.cw-about-btn').click()
        about = page.locator('.cw-about-dialog')
        terms = about.locator('.cw-about-terms')
        main = terms.locator(':scope > .cw-about-glossary > .cw-about-section').first
        credits = about.locator('.cw-about-credit-section')
        privacy = about.locator('.cw-about-section').first
        assert about.evaluate('(e)=>e.open')
        assert not terms.evaluate('(e)=>e.open')
        assert main.evaluate('(e)=>e.open')
        assert credits.evaluate('(e)=>e.open')
        assert not privacy.evaluate('(e)=>e.open')
        assert all(about.locator('details').evaluate_all('(elements)=>elements.map(e=>e.classList.contains("cw-disclosure"))'))
        terms.locator(':scope > summary').click()
        main.locator(':scope > summary').click()
        assert not main.evaluate('(e)=>e.open')
        privacy.locator(':scope > summary').click()
        credits.locator(':scope > summary').click()
        terms.locator(':scope > summary').click()
        page.locator('.cw-close-about').click()
        page.locator('.cw-about-btn').click()
        assert not terms.evaluate('(e)=>e.open'), 'Terms must retain closed state'
        assert not main.evaluate('(e)=>e.open'), 'Main window must retain user-collapsed state'
        assert privacy.evaluate('(e)=>e.open'), 'Privacy state must persist'
        assert not credits.evaluate('(e)=>e.open'), 'Credits state must persist'
        terms.locator(':scope > summary').click()
        assert not main.evaluate('(e)=>e.open'), 'Opening Terms must not force nested Main open'
        page.locator('.cw-close-about').click()
        page.locator('.cw-tab-context').click()
        page.locator('[data-cw-mini="attachment"]').click()
        for cls in ('.cw-attachment-core', '.cw-metadata-only'):
            section = page.locator(cls)
            assert section.count() == 1
            assert section.evaluate('(e)=>e.classList.contains("cw-disclosure")')
            tip = section.locator(':scope > summary').get_attribute('data-cw-tip')
            assert tip and 'HANDOFF' not in tip and 'Expand or collapse' in tip, (cls,tip)
        page.locator('.cw-tab-budget').click()
        budget = page.locator('.cw-budget-editor')
        assert budget.evaluate('(e)=>e.classList.contains("cw-disclosure")')
        page.locator('.cw-settings-btn').click()
        page.locator('[data-cw-tools="technical"]').click()
        handoff = page.locator('.cw-handoff-editor')
        assert handoff.evaluate('(e)=>e.classList.contains("cw-disclosure")')
        assert 'HANDOFF editor' in handoff.locator(':scope > summary').get_attribute('data-cw-tip')
        assert not errors, errors
        print('PASS shared disclosures and About state', 'Dev' if suffix else 'Stable', flush=True)
        page.close()
    browser.close()
