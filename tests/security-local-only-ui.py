#!/usr/bin/env python3
""" synthetic private chat must never be persisted verbatim or transmitted.

This exercises the actual Stable installer in Chromium, not a mock of the
Watchdog code. It does not attempt to classify ChatGPT's own network traffic.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
from support.current import SCRIPT
CHAT = '11111111-1111-4111-8111-111111111111'
MSG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
SECRET = 'SENSITIVE-CHAT-TEXT-NEVER-PERSIST-745839'
ALT = 'SENSITIVE-IMAGE-DESCRIPTION-NEVER-PERSIST-248119'
TITLE = 'SENSITIVE-CHAT-TITLE-NEVER-PERSIST-845130'
PNG = ('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
       'AAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==')
TEXT = (SECRET + ' a user message long enough for capture and UUID association. ') * 5
HTML = (f'<!doctype html><html><head><title>{TITLE}</title></head><body>'
        f'<main><section data-chatgpt-search-unit-key="unit1:user" '
        f'data-chatgpt-search-message-ids="{MSG}">'
        f'<div class="whitespace-pre-wrap">{TEXT}</div>'
        f'<img alt="{ALT}" src="data:image/png;base64,{PNG}" width="12" height="12">'
        f'</section></main><form data-chatgpt-composer>'
        '<button type="button" data-testid="send-button">Send</button>'
        '</form></body></html>')
SCRIPT = SCRIPT.replace('(() => {',
    f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};", 1)
MOCK_STORAGE = '''() => {
  const data=new Map();
  const storage={
    getItem:k=>data.get(String(k))??null,
    setItem:(k,v)=>data.set(String(k),String(v)),
    removeItem:k=>data.delete(String(k)),
    key:i=>[...data.keys()][i]??null,
    get length(){return data.size}
  };
  Object.defineProperty(window,'localStorage',{configurable:true,value:storage});
}'''

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
        args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': 1200, 'height': 850})
    errors = []
    outgoing = []
    logs = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: outgoing.append(request.url))
    page.on('console', lambda message: logs.append(message.text))
    page.set_content(HTML)
    page.evaluate(MOCK_STORAGE)
    page.add_script_tag(content=SCRIPT)
    page.wait_for_function('''key => !!JSON.parse(localStorage.getItem(key)||'null')?.messages?.['msg:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']''', arg='cgpt-context-watchdog:state:v2:chat%3A'+CHAT, timeout=8000)
    stored = page.evaluate('''() => Array.from({length:localStorage.length}, (_,i) =>
        [localStorage.key(i), localStorage.getItem(localStorage.key(i))])''')
    key = 'cgpt-context-watchdog:state:v2:chat%3A' + CHAT
    ledger = next((json.loads(raw) for name, raw in stored if name == key), None)
    assert ledger and ('msg:' + MSG) in ledger.get('messages', {}), (
        'Private message fixture was not actually captured', stored, errors)
    message = ledger['messages']['msg:' + MSG]
    assert message['tokens'] > 0 and 'fingerprint' in message, message
    serialized = json.dumps(stored, ensure_ascii=False)
    for secret in (SECRET, ALT, TITLE):
        assert secret not in serialized, f'Private content persisted: {secret}'
        assert secret not in '\n'.join(logs), f'Private content logged: {secret}'
    assert all('srcHint' not in obj and 'alt' not in obj
               for obj in ledger.get('domImages', {}).values()), ledger.get('domImages')
    assert not outgoing, f'Unexpected userscript network request: {outgoing}'
    assert not errors, errors
    print('PASS private chat: stored metrics/identities only, no message/title/alt text, no outbound requests')
    browser.close()
