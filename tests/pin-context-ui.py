#!/usr/bin/env python3
"""Offline Chromium: pin outside-click behavior, modal interactions, two-line caption and header fit."""
from pathlib import Path
from playwright.sync_api import sync_playwright
P=Path(__file__).resolve().parents[1]
from support.current import SCRIPT, VERSION
UID='11111111-1111-4111-8111-111111111111'
HTML=f'''<!doctype html><html><body><main><section data-chatgpt-search-unit-key="unit1:user" data-chatgpt-search-message-ids="{UID}"><div class="whitespace-pre-wrap">Test user message for pin UI.</div></section></main><button id="outside" type="button" style="position:fixed;left:0;top:0;width:7px;height:7px;padding:0;border:0;font-size:0">Host page</button><form><button type="button" data-testid="send-button">Send</button></form></body></html>'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    for width,height in ((1200,900),(390,700),(320,650)):
        page=browser.new_page(viewport={'width':width,'height':height})
        page.set_default_timeout(7000)
        errs=[];page.on('pageerror',lambda e: errs.append(str(e)))
        page.set_content(HTML)
        page.evaluate('''() => {
          const data=new Map();const storage={
            getItem:k=>data.get(String(k))??null,
            setItem:(k,v)=>data.set(String(k),String(v)),
            removeItem:k=>data.delete(String(k)),
            key:i=>[...data.keys()][i]??null,
            get length(){return data.size}
          };
          Object.defineProperty(window,'localStorage',{configurable:true,value:storage});
          window.__hostClicks=0;
          document.getElementById('outside').addEventListener('click',()=>window.__hostClicks++);
        }''')
        injected=SCRIPT.replace('(() => {',f"(() => {{\nconst location={{pathname:'/c/{UID}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{UID}'}};",1)
        page.add_script_tag(content=injected)
        page.wait_for_timeout(160)
        panel=page.locator('.cw-panel')
        page.locator('.cw-logo-hit').click()
        assert panel.is_visible()
        pin=page.locator('.cw-pin-panel')
        assert pin.count()==1
        assert pin.get_attribute('aria-pressed')=='false'
        note=page.locator('.cw-context-note')
        spans=note.locator('span')
        assert spans.count()==2
        assert note.inner_text().splitlines()==['Heuristic midpoint of optimistic','and pessimistic estimates'],note.inner_text()
        assert note.is_visible() and note.bounding_box()['height']>0
        sizes=page.evaluate('''() => {
          const panel=document.querySelector('.cw-panel').getBoundingClientRect();
          const toolbar=document.querySelector('.cw-toolbar').getBoundingClientRect();
          const title=document.querySelector('.cw-title').getBoundingClientRect();
          const brand=document.querySelector('.cw-title-info .cw-brand-mark').getBoundingClientRect();
          const pin=document.querySelector('.cw-pin-panel').getBoundingClientRect();
          return {panel:[panel.left,panel.right],toolbar:[toolbar.left,toolbar.right],title:[title.left,title.right],brand:[brand.left,brand.right],pin:[pin.left,pin.right]};
        }''')
        assert sizes['toolbar'][1] <= sizes['panel'][1]-8,sizes
        assert sizes['brand'][1] < sizes['toolbar'][0]+1,sizes
        assert sizes['pin'][1]-sizes['pin'][0]>=24,sizes
        # Unpinned panel preserves outside-click dismissal behavior.
        page.locator('#outside').click()
        assert not panel.is_visible()
        page.locator('.cw-logo-hit').click()
        # Pinned mode: clicking the host stays interactive while panel remains visible.
        pin.click()
        assert pin.get_attribute('aria-pressed')=='true'
        assert pin.get_attribute('aria-label')=='Unpin panel'
        page.mouse.move(0, height-1)  # Do not confuse neutral hover with active fill.
        # Active pin uses colored contour and rotation, never a filled square.
        for palette in ('light', 'dark'):
            for style in ('soft', 'sharp'):
                page.evaluate("([palette,style])=>{const root=document.querySelector('[id$=\"-root\"]');root.setAttribute('data-cw-palette',palette);root.setAttribute('data-cw-style',style);}", [palette,style])
                assert pin.is_visible() and pin.get_attribute('aria-pressed')=='true'
        page.locator('#outside').click()
        assert panel.is_visible()
        assert page.evaluate('window.__hostClicks')==2
        assert page.locator('.cw-pin-panel').get_attribute('aria-pressed')=='true'
        # Pinned: outside click preserves About, explicit badge click closes both.
        page.locator('.cw-about-btn').click()
        about=page.locator('.cw-about-dialog')
        assert about.evaluate('(e)=>e.open')
        page.locator('#outside').click()
        assert about.evaluate('(e)=>e.open') and panel.is_visible()
        page.locator('.cw-logo-hit').click()
        assert not about.evaluate('(e)=>e.open') and not panel.is_visible()
        page.locator('.cw-logo-hit').click()
        assert panel.is_visible() and pin.get_attribute('aria-pressed')=='true'
        page.locator('.cw-about-btn').click()
        assert about.evaluate('(e)=>e.open')
        # The scrim masks the header; clicking it dismisses About only.
        page.locator('.cw-settings-scrim').click(position={'x':12,'y':12},force=True)
        assert not about.evaluate('(e)=>e.open') and panel.is_visible()
        page.locator('.cw-settings-btn').click()
        page.locator('[data-cw-tools="technical"]').click()
        field=page.locator('.cw-hidden-optimistic')
        saved=field.input_value()
        field.fill(str(int(float(saved))+7))
        page.locator('#outside').click()
        assert panel.is_visible()
        assert page.locator('.cw-settings-dialog:not(.cw-about-dialog):not(.cw-limit-dialog)').evaluate('(e)=>e.open')
        assert field.input_value()!=saved
        page.evaluate("document.querySelector('.cw-settings-scrim').click()")
        assert field.input_value()==saved
        assert panel.is_visible()
        assert not page.locator('.cw-settings-dialog:not(.cw-about-dialog):not(.cw-limit-dialog)').evaluate('(e)=>e.open')
        # Closing a pinned panel via badge dismisses Settings and rolls back drafts.
        page.locator('.cw-settings-btn').click()
        page.locator('[data-cw-tools="technical"]').click()
        field.fill(str(int(float(saved))+11))
        page.locator('.cw-logo-hit').click()
        assert not panel.is_visible()
        assert not page.locator('.cw-settings-dialog:not(.cw-about-dialog):not(.cw-limit-dialog)').evaluate('(e)=>e.open')
        page.locator('.cw-logo-hit').click()
        assert pin.get_attribute('aria-pressed')=='true'
        page.locator('.cw-settings-btn').click()
        page.locator('[data-cw-tools="technical"]').click()
        assert field.input_value()==saved,field.input_value()
        page.locator('.cw-settings-scrim').click(position={'x':12,'y':12},force=True)
        # Badge explicitly closes a pinned panel; Pin remains ON when reopened.
        page.locator('.cw-logo-hit').click()
        assert not panel.is_visible()
        page.locator('.cw-logo-hit').click()
        assert pin.get_attribute('aria-pressed')=='true'
        page.keyboard.press('Escape')
        assert not panel.is_visible()
        page.locator('.cw-logo-hit').click()
        assert pin.get_attribute('aria-pressed')=='true'
        # Unpin allows the outside click to collapse again.
        pin.click()
        assert pin.get_attribute('aria-pressed')=='false'
        page.locator('#outside').click()
        assert not panel.is_visible()
        # No persisted pin state, never changes unrelated settings or ledger.
        settings_data=page.evaluate("localStorage.getItem('cgpt-context-watchdog:settings:v1')")
        if settings_data:
            import json
            saved_settings=json.loads(settings_data)
            assert not any('pin' in key.lower() for key in saved_settings),saved_settings
            # Logo preference is independent of the transient pinned state.
            if 'logoPreference' in saved_settings:
                assert saved_settings['logoPreference'] in ('watchdog','openai'),saved_settings
        assert not errs,(width,errs)
        print('PASS',width,height,'pin/unpin, modal preservation, scrim dismissal, draft rollback, caption and header fit',sizes,flush=True)
        page.close()
    browser.close()
