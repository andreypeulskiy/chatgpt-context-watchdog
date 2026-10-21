#!/usr/bin/env python3
"""End-to-end Record Chat Limit workflow: cancel/confirm/history/SPA/geometry."""
from pathlib import Path
from playwright.sync_api import sync_playwright
P=Path(__file__).resolve().parents[1]
from support.current import SCRIPT, VERSION
UUID='11111111-1111-4111-8111-111111111111'
OTHER='22222222-2222-4222-8222-222222222222'
HTML=f'''<html><body><main><section data-chatgpt-search-unit-key="unit1:user" data-chatgpt-search-message-ids="{UUID}"><div class="whitespace-pre-wrap">Hello Watchdog test for calibration sample.</div></section></main><form data-chatgpt-composer><button type="button" data-testid="send-button">Send</button></form></body></html>'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    for width,height in ((1200,1000),(450,560)):
        page=browser.new_page(viewport={'width':width,'height':height})
        page.set_default_timeout(5000)
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(HTML)
        # about:blank has opaque origin; a deterministic localStorage mock
        # exercises serialization without any browser network request.
        page.evaluate('''() => {
          const m=new Map(); const storage={
            getItem:k=>m.has(String(k))?m.get(String(k)):null,
            setItem:(k,v)=>{m.set(String(k),String(v))},
            removeItem:k=>m.delete(String(k)), clear:()=>m.clear(),
            key:i=>[...m.keys()][i]??null,
            get length(){return m.size}
          };
          Object.defineProperty(window,'localStorage',{configurable:true,value:storage});
        }''')
        injected=SCRIPT.replace('(() => {',f"(() => {{\nconst location=window.__wdTestLocation={{pathname:'/c/{UUID}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{UUID}'}};",1)
        # Override browser confirm to guarantee this button cannot open native modal.
        page.evaluate('() => { window.confirm = () => { throw new Error("native confirm called") } }')
        page.add_script_tag(content=injected)
        page.wait_for_timeout(160)
        page.locator('.cw-logo-hit').click()
        page.wait_for_timeout(90)
        root=page.locator('.cw-panel')
        snapshot=lambda:page.evaluate('''() => {const r=document.querySelector('.cw-panel').getBoundingClientRect();return [r.left,r.top,r.width,r.height]}''')
        before=snapshot()
        dialog=page.locator('.cw-limit-dialog')
        history=lambda:page.evaluate("JSON.parse(localStorage.getItem('cgpt-context-watchdog:ended-history:v2') || '[]')")
        def click_open():
            page.locator('.cw-end-chat').click()
            page.wait_for_timeout(120)
            assert dialog.evaluate('(d)=>d.open')
            assert page.locator('.cw-panel-main').evaluate('(d)=>d.inert')
            assert all(abs(a-b)<=5 for a,b in zip(before,snapshot())),(before,snapshot())
            assert page.locator('.cw-limit-optimistic').inner_text().startswith('≈')
            assert page.locator('.cw-limit-pessimistic').inner_text().startswith('≈')
            assert page.locator('.cw-limit-dialog').evaluate('(d)=>d.getBoundingClientRect().bottom')<height-6
        # Cancel button leaves history and budgets unchanged.
        assert len(history())==0
        page.locator('.cw-tab-context').click()
        before=snapshot()
        print('opening cancel',width,flush=True);click_open()
        page.locator('.cw-cancel-limit').click()
        assert not dialog.evaluate('(d)=>d.open')
        assert not page.locator('.cw-panel-main').evaluate('(d)=>d.inert')
        assert page.locator('.cw-end-chat').evaluate('(n)=>document.activeElement===n')
        assert len(history())==0
        # Escape and scrim also only cancel.
        print('opening escape',width,flush=True);click_open();page.keyboard.press('Escape')
        assert not dialog.evaluate('(d)=>d.open')
        print('opening scrim',width,flush=True);click_open();page.evaluate('() => document.querySelector(".cw-settings-scrim").click()')
        assert not dialog.evaluate('(d)=>d.open')
        assert root.is_visible(), 'Scrim dismisses only the dialog inside the panel'
        assert len(history())==0
        # Dialog keyboard stays local; explicit button records one sample.
        print('opening record',width,flush=True);click_open()
        page.locator('.cw-cancel-limit').focus();page.keyboard.press('Shift+Tab')
        assert page.evaluate("document.activeElement.closest('.cw-limit-dialog') !== null")
        page.locator('.cw-confirm-limit').click()
        page.wait_for_timeout(130)
        records=history()
        assert len(records)==1,records
        assert records[0]['chatKey']==f'chat:{UUID}',records
        assert not dialog.evaluate('(d)=>d.open')
        # Reopen is explicit about replacement; second save replaces, never duplicates.
        print('opening replace',width,flush=True);click_open()
        assert page.locator('.cw-limit-replacement').is_visible()
        page.locator('.cw-confirm-limit').click()
        assert len(history())==1
        # If browser SPA navigates while dialog open, button must not save wrong chat.
        print('opening SPA',width,flush=True);click_open()
        page.evaluate(f"window.__wdTestLocation.pathname='/c/{OTHER}'")
        page.locator('.cw-confirm-limit').click()
        assert not dialog.evaluate('(d)=>d.open')
        assert len(history())==1
        assert not errors,(width,errors)
        print('PASS',width,height,'cancel/escape/scrim/record/replacement/SPA/focus/geometry')
        page.close()
    browser.close()
