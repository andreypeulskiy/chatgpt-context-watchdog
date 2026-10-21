#!/usr/bin/env python3
"""Single offline Chromium smoke: DOM → Capture → Commit → Reopen.

No HTTP server or network. Reopen uses a new page with the previous
localStorage bytes restored, since network origins are blocked in CI.
"""
import json
from playwright.sync_api import sync_playwright
from support.current import SCRIPT

CHAT = '11111111-1111-4111-8111-111111111111'
MSG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
TEXT = 'A completed user message with a real UUID, long enough for a stable history capture. ' * 4
HTML = f'''<!doctype html><html><body><main><section data-chatgpt-search-unit-key="unit1:user"
data-chatgpt-search-message-ids="{MSG}"><div class="whitespace-pre-wrap">{TEXT}</div></section></main>
<form data-chatgpt-composer><button type="button" data-testid="send-button">Send</button></form></body></html>'''
KEY = 'cgpt-context-watchdog:state:v2:' + f'chat%3A{CHAT}'
INJECTED = SCRIPT.replace('(() => {', f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};", 1)
INIT = '''initial => {
    const data=new Map(initial);
    const storage={
      getItem:k=>data.get(String(k))??null,
      setItem:(k,v)=>data.set(String(k),String(v)),
      removeItem:k=>data.delete(String(k)),
      key:i=>[...data.keys()][i]??null,
      get length(){return data.size}
    };
    Object.defineProperty(window,'localStorage',{configurable:true,value:storage});
}'''

def boot(browser, data, html=HTML):
    page = browser.new_page(viewport={'width': 990, 'height': 800})
    page.set_default_timeout(8000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(html)
    page.evaluate(INIT, data)
    page.add_script_tag(content=INJECTED)
    return page, errors

def snapshot(page):
    return page.evaluate('''key => ({
        bytes:Array.from({length:localStorage.length}, (_,i)=>[localStorage.key(i),localStorage.getItem(localStorage.key(i))]),
        state:JSON.parse(localStorage.getItem(key)||'null')
    })''', KEY)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
        args=['--no-sandbox','--disable-dev-shm-usage'])
    page, errors = boot(browser, [])
    page.wait_for_function('''key => !!JSON.parse(localStorage.getItem(key)||'null')?.messages?.['msg:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']''', arg=KEY, timeout=8000)
    first = snapshot(page)
    state = first['state']
    if not state or not state.get('messages'):
        print('CAPTURE DIAGNOSTICS:', json.dumps({
            'keys':[row[0] for row in first['bytes']],
            'state': state,
            'errors': errors,
        }),flush=True)
    assert state and state.get('messages'), 'DOM capture did not reach ledger'
    target = 'msg:' + MSG
    assert target in state['messages'], f'Expected captured UUID {target}'
    saved = state['messages'][target]
    assert any(k==KEY for k,v in first['bytes']), 'The first commit was not captured as stored bytes'
    page.close()

    # If the old bytes were ignored, this changed DOM text would yield different saved tokens.
    changed_html = HTML.replace(TEXT, 'A different, much shorter DOM text after reopen.')
    reopened, againErrors = boot(browser, first['bytes'], changed_html)
    # Deliberately allow a full rescan interval: waiting only for the preloaded
    # record would be a false PASS and would not test write-once on the new DOM.
    reopened.wait_for_timeout(1100)
    second = snapshot(reopened)['state']
    assert second and target in second['messages'], 'Durable snapshot not loaded on reopen'
    assert second['messages'][target] == saved, 'Reopen mutated an existing write-once record'
    assert len(second['messages']) == len(state['messages']) == 1, 'Reopen duplicated a message'
    assert not errors and not againErrors, (errors, againErrors)
    print('PASS DOM → Capture → Commit → Reopen; browser DOM, persisted bytes replayed offline',flush=True)
    reopened.close()
    browser.close()
