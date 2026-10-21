#!/usr/bin/env python3
"""Test current bundle remount safety with in-memory test-only hooks."""
from playwright.sync_api import sync_playwright
from support.current import SCRIPT
from support.esbuild_hooks import instrument_bundle

CHAT = '11111111-1111-4111-8111-111111111111'
MSG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
HTML = f'''<!doctype html><html><body><main>
<section data-chatgpt-search-unit-key="unit1:user" data-chatgpt-search-message-ids="{MSG}">
<div class="whitespace-pre-wrap"> finished message for remount checks. Text. Text. Text.</div></section>
</main><form data-chatgpt-composer><button data-testid="send-button">Send</button></form></body></html>'''
INIT = '''() => {
  const data = new Map();
  Object.defineProperty(window, 'localStorage', {configurable:true, value:{
    getItem:k=>data.get(String(k))??null, setItem:(k,v)=>data.set(String(k),String(v)),
    removeItem:k=>data.delete(String(k)), key:i=>[...data.keys()][i]??null,
    get length(){return data.size}
  }});
  const added = new Set();
  const add = window.addEventListener.bind(window), remove=window.removeEventListener.bind(window);
  window.addEventListener = function(type, fn, ...args) {
    if (type==='resize') added.add(fn);
    return add(type,fn,...args);
  };
  window.removeEventListener = function(type,fn,...args) {
    if (type==='resize') added.delete(fn);
    return remove(type,fn,...args);
  };
  window.__resizeCount = () => added.size;
}'''
# Instrument only an in-memory copy of the actual bundled userscript.
INJECTED = instrument_bundle(SCRIPT, """
  window.__watchdogTestHooks = {
    ensureUI,
    settle: settlePanelConfirmation,
    current: () => ui
  };""", route=f"{{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}}")

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox','--disable-dev-shm-usage'])
    for width in (1200,390,320):
        page=browser.new_page(viewport={'width':width, 'height':850})
        page.set_default_timeout(8000)
        errors=[]
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.set_content(HTML)
        page.evaluate(INIT)
        page.add_script_tag(content=INJECTED)
        assert page.evaluate('window.__resizeCount()')==1
        page.locator('.cw-logo-hit').click()
        page.locator('.cw-settings-btn').click()
        page.locator('.cw-reset-chat').click()
        assert page.locator('.cw-confirm-dialog').evaluate('(e)=>e.open')
        # Removing the instance must invalidate the pending confirmation and
        # remove its global resize callback before replacing the root.
        for i in range(3):
            page.evaluate('''() => {
              const old=window.__watchdogTestHooks.current().root;
              old.remove();
              const next=window.__watchdogTestHooks.ensureUI();
              if (next.root===old || !next.root.isConnected) throw Error('Remount failed');
              window.__watchdogTestHooks.settle(true); // Old confirmation must NOT execute.
            }''')
            assert page.evaluate('window.__resizeCount()')==1, 'Old root retained a resize listener'
            page.evaluate('window.dispatchEvent(new Event("resize"))')
            page.locator('.cw-logo-hit').click()
            assert page.locator('.cw-panel').is_visible()
            page.locator('.cw-settings-btn').click()
            assert page.locator('.cw-settings-dialog').evaluate('(e)=>e.open')
            page.locator('.cw-close-settings').click()
        assert not errors, errors
        page.close()
        print(f'PASS remount, stale confirmation and resize at {width}px')
    browser.close()
