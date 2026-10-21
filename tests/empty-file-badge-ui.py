#!/usr/bin/env python3
"""Unknown empty chat, confirmed file-only attachment and compact badge behavior.

Runs the real offline userscript against controlled Chromium DOM and storage.
This is not a claim of native Edge/Tampermonkey integration coverage.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
import re
VERSION = re.search(r"^// @version\s+(\S+)$", (ROOT/"src/userscript-header.txt").read_text(), re.M).group(1)
CHAT = '11111111-1111-4111-8111-111111111111'
MSG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
STATE_KEY = 'cgpt-context-watchdog:state:v2:chat%3A' + CHAT
HTML = '''<!doctype html><html><body><main>
<form data-chatgpt-composer><textarea id="prompt-textarea"></textarea>
<button type="button" data-testid="send-button">Send</button></form>
</main></body></html>'''


def ledger(kind):
    state = {'chatKey': f'chat:{CHAT}', 'messages': {}, 'repairHistory': [],
             'attachmentLedgerVersion': 2, 'files': {}, 'domImages': {}, 'updatedAt': 0}
    if kind == 'file':
        state['files']['dom-user-file:test'] = {
            'name': 'sample.pdf', 'size': 1048576, 'status': 'ready', 'tokens': 0,
            'method': 'metadata-size', 'metadataOnly': True, 'source': 'dom-history',
            'messageId': MSG,
        }
    elif kind == 'unconfirmed':
        state['files']['unbound-file:test'] = {
            'name': 'unsent.pdf', 'size': 1048576, 'status': 'ready', 'tokens': 0,
            'method': 'metadata-size', 'metadataOnly': True, 'source': 'file-input'
        }
    elif kind == 'image':
        state['domImages']['dom-user-image-slot:test'] = {
            'messageId': MSG, 'tokens': 2000, 'width': 512, 'height': 512}
    return state


def launch(browser, build, route, case, shape):
    page = browser.new_page(viewport={'width': 900, 'height': 780})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(HTML)
    page.evaluate('''v => {
      window.__wdRoute = {pathname: v.path, origin:'https://chatgpt.com',
        href:'https://chatgpt.com' + v.path};
      const data=new Map();
      if (v.state) data.set(v.key,JSON.stringify(v.state));
      window.__wdStorage = {
        getItem:k=>data.get(String(k))??null,
        setItem:(k,v)=>data.set(String(k),String(v)),
        removeItem:k=>data.delete(String(k)),
        key:i=>[...data.keys()][i]??null,
        get length(){return data.size}
      };
      Object.defineProperty(window,'localStorage', {configurable:true,value:window.__wdStorage});
    }''', {'path': route, 'state': ledger(case) if case else None, 'key': STATE_KEY})
    code = build.read_text().replace('(() => {', '(() => {\nconst location = window.__wdRoute;', 1)
    page.add_script_tag(content=code)
    page.locator('[id$="-root"]').evaluate('(r,shape) => r.dataset.cwStyle = shape', shape)

    expect_normal = bool(route.startswith('/c/') and case in ('file', 'image'))
    expect_file = bool(route.startswith('/c/') and case == 'file')
    expect_mode = 'normal' if expect_normal else 'minimal'
    page.wait_for_function('''mode => document.querySelector('.cw-chip')?.dataset.cwBadgeMode===mode''', arg=expect_mode)
    badge = page.evaluate('''() => {
      const chip=document.querySelector('.cw-chip');
      const range=chip.querySelector('.cw-range');
      const box=chip.getBoundingClientRect();
      return { mode:chip.dataset.cwBadgeMode, width:box.width,height:box.height,
        range:getComputedStyle(range).display,
        paused:chip.querySelector('.cw-paused-label').hidden,
        avg:chip.querySelector('.cw-average').textContent.trim() };
    }''')
    if expect_normal:
        assert badge['range']!='none' and badge['avg'].startswith('≈ '), badge
    else:
        assert badge['range']=='none',badge
        assert badge['width']>0 and badge['height']>0 and badge['width']<=badge['height']*1.5,badge
    page.locator('.cw-logo-hit').click()
    assert page.locator('.cw-panel').is_visible()
    summary=page.locator('.cw-context-range').inner_text()
    if expect_normal:
        assert summary.startswith('≈ ') and summary.endswith(' tokens'),(case,summary)
    else:
        assert summary=='None',(case,summary)
    if expect_file:
        assert '1 ·' in page.locator('.cw-data-files').inner_text()
        assert page.locator('.cw-context-messages').inner_text().startswith('0 ·'),page.locator('.cw-context-messages').inner_text()
    # Both minimal and normal use the existing icon-only chip when panel opens.
    opened=page.locator('.cw-chip').bounding_box()
    assert opened['width']>0 and opened['height']>0 and opened['width']<=opened['height']*1.5,opened
    page.locator('.cw-logo-hit').click()
    assert page.locator('.cw-panel').is_hidden()
    if not expect_normal:
        closed=page.locator('.cw-chip').bounding_box()
        assert abs(closed['width']-opened['width'])<=max(5,opened['width']*.15),(opened,closed)
    assert not errors,errors
    print(f'PASS {build.name} route={route} case={case or "empty"} style={shape}',flush=True)
    page.close()


with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
        args=['--no-sandbox','--disable-dev-shm-usage'])
    for suffix in ('', '.dev'):
        build=ROOT / f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js'
        for case,route in ((None,'/'), (None,f'/c/{CHAT}'),
                ('unconfirmed',f'/c/{CHAT}'),('file',f'/c/{CHAT}'),
                ('image',f'/c/{CHAT}'),('file','/')):
            for shape in ('soft','sharp'):
                launch(browser,build,route,case,shape)
    browser.close()
