#!/usr/bin/env python3
"""Release-bundle integration: streaming must not commit; ready must commit.

Runs the actual installed userscript (offline or esbuild) in Chromium, not the
classic 1.x projection or a test-only module registry.
"""
import json
from playwright.sync_api import sync_playwright
from support.current import SCRIPT

CHAT = '22222222-2222-4222-8222-222222222222'
MSG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
TEXT = 'The completed assistant reply must be captured after streaming finishes. ' * 5
KEY = 'cgpt-context-watchdog:state:v2:' + f'chat%3A{CHAT}'
HTML = f'''<!doctype html><html><body>
<main><section data-chatgpt-search-unit-key="unit2:assistant"
 data-chatgpt-search-message-ids="{MSG}">
 <div class="whitespace-pre-wrap">{TEXT}</div></section></main>
<form data-chatgpt-composer><button type="button" data-testid="stop-button">Stop</button></form>
</body></html>'''
INJECTED = SCRIPT.replace('(() => {',
    f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};", 1)
INIT = '''() => {
    const data=new Map();
    Object.defineProperty(window,'localStorage',{configurable:true,value:{
      getItem:k=>data.get(String(k))??null,
      setItem:(k,v)=>data.set(String(k),String(v)),
      removeItem:k=>data.delete(String(k)),
      key:i=>[...data.keys()][i]??null,
      get length(){return data.size}
    }});
}'''
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
        args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width':990,'height':800})
    page.set_default_timeout(8000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(HTML)
    page.evaluate(INIT)
    page.add_script_tag(content=INJECTED)
    page.wait_for_timeout(900)
    initial = page.evaluate('key=>JSON.parse(localStorage.getItem(key)||"null")', KEY)
    assert not initial or not initial.get('messages', {}).get('msg:'+MSG), \
      'Streaming assistant message was prematurely committed'
    page.evaluate('''() => {
       const composer=document.querySelector('form[data-chatgpt-composer]');
       composer.querySelector('button').outerHTML = '<button type="button" data-testid="send-button">Send</button>';
       const finished=document.createElement('button');
       finished.dataset.testid='copy-turn-action-button';
       finished.textContent='Copy';
       document.querySelector('main').appendChild(finished);
    }''')
    page.wait_for_function('''key => {
      const saved=JSON.parse(localStorage.getItem(key)||'null');
      return !!saved?.messages?.['msg:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
    }''', arg=KEY, timeout=8000)
    state=page.evaluate('key=>JSON.parse(localStorage.getItem(key))', KEY)
    record=state['messages']['msg:'+MSG]
    assert record['role']=='assistant' and record['tokens']>0 and record['chars']>=len(TEXT.strip()), record
    assert not errors, errors
    print('PASS installed bundle: generating → ready → assistant commit, no pageerror',flush=True)
    page.close();browser.close()
