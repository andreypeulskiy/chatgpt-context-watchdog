#!/usr/bin/env python3
"""Action styles are independent from hint registration across lazy UI sections."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
VERSION=re.search(r'^// @version\s+(\S+)$',(ROOT/'src/userscript-header.txt').read_text(),re.M).group(1)
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main><section data-chatgpt-search-unit-key="test:user" data-chatgpt-search-message-ids="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"><div class="whitespace-pre-wrap">Text for one user message</div></section><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form></main></body></html>'''

def check(page,name,tone):
    el=page.locator('.'+name)
    el.wait_for(state='attached')
    assert el.count()==1,(name,el.count())
    info=el.evaluate("e=>({classes:[...e.classList],color:getComputedStyle(e).color,tip:e.dataset.cwTip||null})")
    assert tone in info['classes'],(name,tone,info)
    assert ('cw-danger-action' in info['classes']) == (tone=='cw-danger-action'),(name,info)
    assert info['tip'],(name,info)
    return info

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
        args=['--no-sandbox','--disable-dev-shm-usage'])
    for suffix in ('','.dev'):
        page=browser.new_page(viewport={'width':1000,'height':850})
        page.set_default_timeout(8000)
        errors=[]
        page.on('pageerror',lambda exc:errors.append(str(exc)))
        page.set_content(HTML)
        page.evaluate('''() => {
          const db=new Map();
          Object.defineProperty(window,'localStorage',{configurable:true,value:{
            getItem:k=>db.get(String(k))??null,setItem:(k,v)=>db.set(String(k),String(v)),
            removeItem:k=>db.delete(String(k)),key:i=>[...db.keys()][i]??null,
            get length(){return db.size;}
          }});
        }''')
        code=(ROOT/f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text()
        code=code.replace('(() => {',f"(() => {{\nconst location={{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
        page.add_script_tag(content=code)
        page.locator('.cw-logo-hit').click()
        page.locator('[data-cw-mini="text"]').click()
        check(page,'cw-save-text-estimation','cw-text-action')
        check(page,'cw-reset-text-estimation','cw-text-action')
        page.locator('[data-cw-mini="attachment"]').click()
        check(page,'cw-save-attachments','cw-text-action')
        check(page,'cw-reset-attachments','cw-text-action')
        page.locator('[data-cw-mini="coefficients"]').click()
        check(page,'cw-save-attachment-coefficients','cw-text-action')
        check(page,'cw-reset-attachment-advanced','cw-text-action')
        page.locator('.cw-tab-budget').click()
        page.locator('.cw-budget-editor > summary').click()
        check(page,'cw-save-budget','cw-text-action')
        check(page,'cw-reset-budget','cw-text-action')
        page.locator('.cw-tab-details').click()
        check(page,'cw-copy-details','cw-text-action')
        page.locator('.cw-settings-btn').click()
        ordinary=check(page,'cw-reset-position','cw-text-action')
        danger=check(page,'cw-reset-chat','cw-danger-action')
        # Dangerous actions must be distinguishable from ordinary actions, not
        # frozen to a specific light-palette RGB value.
        assert danger['color']!=ordinary['color'],(ordinary,danger)
        for palette in ('light','dark'):
            page.locator('[id$="-root"]').evaluate('(r,p)=>r.dataset.cwPalette=p',palette)
            tone=page.locator('.cw-reset-chat').evaluate('e=>getComputedStyle(e).color')
            calm=page.locator('.cw-reset-position').evaluate('e=>getComputedStyle(e).color')
            assert tone!=calm,(palette,tone,calm)
        check(page,'cw-clear-watchdog-data','cw-danger-action')
        page.locator('[data-cw-tools="technical"]').click()
        check(page,'cw-save-settings','cw-text-action')
        check(page,'cw-reset-settings','cw-text-action')
        page.locator('[data-cw-tools="diagnostics"]').click()
        for name,tone in [('cw-rescan','cw-text-action'),('cw-copy-diagnostics','cw-text-action'),
                          ('cw-export-ids','cw-text-action'),('cw-repair-short','cw-danger-action'),
                          ('cw-undo-repair','cw-text-action')]:
            check(page,name,tone)
        page.locator('[data-cw-tools="performance"]').click()
        for name in ['cw-performance-toggle','cw-performance-copy','cw-performance-reset']:
            check(page,name,'cw-text-action')
        page.locator('[data-cw-tools="technical"]').click()
        page.locator('[data-cw-tools="diagnostics"]').click()
        check(page,'cw-repair-short','cw-danger-action')
        assert not page.locator('.cw-close-settings').evaluate('e=>e.classList.contains("cw-text-action")||e.classList.contains("cw-danger-action")')
        assert not errors,errors
        print('PASS', 'Dev' if suffix else 'Stable', 'action style and tooltip classes across lazy sections',flush=True)
        page.close()
    browser.close()
