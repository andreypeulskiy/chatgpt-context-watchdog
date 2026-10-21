#!/usr/bin/env python3
"""Transient notices follow their own timer across panel/dialog lifecycles."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
VERSION = re.search(r'^// @version\s+(\S+)$', (ROOT/'src/userscript-header.txt').read_text(), re.M).group(1)
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main></main>
<form data-chatgpt-composer><textarea id="prompt-textarea"></textarea>
<button type="button" data-testid="send-button">Send</button></form></body></html>'''
INIT='''() => {
 const m=new Map(); window.__storageFail=false;
 Object.defineProperty(window,'localStorage',{configurable:true,value:{
  getItem:k=>m.get(String(k))??null,
  setItem:(k,v)=>{if(window.__storageFail && String(k).endsWith('settings:v1'))throw Error('quota');m.set(String(k),String(v))},
  removeItem:k=>m.delete(String(k)),
  key:i=>[...m.keys()][i]??null,
  get length(){return m.size}
 }});
}'''

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    for suffix in ('', '.dev'):
        for width in (390,1200):
            page=browser.new_page(viewport={'width':width,'height':820})
            page.set_default_timeout(10000)
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.set_content(HTML)
            page.evaluate(INIT)
            script=(ROOT/f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text()
            injected=script.replace('(() => {',
                f"(() => {{\nconst location={{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
            page.add_script_tag(content=injected)
            logo=page.locator('.cw-logo-hit')
            logo.click()
            toast=page.locator('.cw-toast')
            page.locator('.cw-handoff-details').click()
            assert toast.is_visible() and 'HANDOFF inserted.' in toast.inner_text(),('toast not shown',suffix,width)
            lane=page.locator('.cw-notice-lane')
            assert lane.evaluate('''e=>{
              const a=e.getBoundingClientRect(),p=e.closest('.cw-panel').getBoundingClientRect();
              const tabs=e.closest('.cw-panel').querySelector('.cw-tabs').getBoundingClientRect();
              return a.width>0 && a.left>=p.left-1 && a.right<=p.right+1
                && a.top>=p.top-1 && a.bottom<=tabs.top+1;
            }'''), 'Notice must fit above tabs without blocking navigation'
            # Panel dismissal hides the notice with the panel, but cannot end
            # its timer: a quick reopening shows the remaining live notice.
            logo.click()
            assert toast.is_hidden(),('notice must be invisible in hidden panel',suffix,width)
            logo.click()
            assert toast.is_visible() and 'HANDOFF inserted.' in toast.inner_text(),('live notice lost on reopen',suffix,width)
            page.locator('#prompt-textarea').evaluate("e=>e.value=''")
            page.locator('.cw-handoff-details').click()
            assert toast.is_visible()
            page.locator('.cw-about-btn').click()
            assert toast.is_visible(),('notice should remain beneath About scrim',suffix,width)
            assert page.locator('.cw-settings-scrim').evaluate('''e=>{
              const a=e.getBoundingClientRect(),b=document.querySelector('.cw-notice-lane').getBoundingClientRect();
              return !e.hidden && a.left<=b.left+1 && a.top<=b.top+1
                && a.right>=b.right-1 && a.bottom>=b.bottom-1;
            }'''), 'Dialog backdrop must cover notice as part of the panel'
            page.locator('.cw-close-about').click()
            assert toast.is_visible(),('notice should survive About dismissal',suffix,width)
            settingsBtn=page.locator('.cw-settings-btn')
            settingsBtn.click()
            settings=page.locator('.cw-settings-dialog:not(.cw-about-dialog):not(.cw-limit-dialog):not(.cw-confirm-dialog)')
            header=settings.locator('.cw-dialog-message')
            settings.locator('[data-cw-tools="performance"]').click()
            settings.locator('.cw-performance-toggle').click()
            assert header.is_visible() and header.inner_text()=='Profiling enabled.',('missing Settings status',suffix,width)
            settings.locator('.cw-performance-toggle').click()
            assert header.inner_text()=='Profiling paused.',('last notice not winning',suffix,width)
            settings.locator('.cw-clear-watchdog-data').click()
            confirm=page.locator('.cw-confirm-dialog')
            assert confirm.evaluate('e=>e.open') and header.is_visible(),('existing status should remain behind confirmation',suffix,width)
            assert toast.is_visible() and 'Profiling paused.' in toast.inner_text()
            confirm.locator('.cw-cancel-confirm').click()
            assert header.is_visible() and 'Profiling paused.' in header.inner_text(),('confirmation should not overwrite latest status',suffix,width)
            # Storage failures keep their inline warning and badge indicator
            # even when transient feedback is cleared by dialog changes.
            page.evaluate('window.__storageFail=true')
            settings.locator('[data-cw-tools="technical"]').click()
            settings.locator('.cw-save-settings').click()
            assert header.is_visible() and 'STORAGE WRITE FAILED' in header.get_attribute('title'),('storage notice',suffix,width)
            assert not page.locator('.cw-storage-indicator').evaluate('e=>e.hidden'),('persistent badge flag',suffix,width)
            assert page.locator('.cw-storage-warning').evaluate('e=>!e.hidden'),('persistent warning',suffix,width)
            settings.locator('.cw-clear-watchdog-data').click()
            assert toast.is_visible() and 'STORAGE WRITE FAILED' in toast.inner_text()
            confirm.locator('.cw-cancel-confirm').click()
            settings.locator('.cw-close-settings').click()
            assert not page.locator('.cw-storage-indicator').evaluate('e=>e.hidden')
            assert page.locator('.cw-storage-warning').is_visible()
            settingsBtn.click()
            settings.locator('[data-cw-tools="technical"]').click()
            page.evaluate('window.__storageFail=false')
            settings.locator('.cw-save-settings').click()
            assert header.is_visible() and 'saved.' in header.inner_text()
            assert page.locator('.cw-storage-indicator').is_hidden(),('stale settings error after retry',suffix,width)
            assert page.locator('.cw-storage-warning').is_hidden()
            # Last transient message expires on its own despite a panel close/reopen.
            assert toast.is_visible() and 'saved.' in toast.inner_text()
            settings.locator('.cw-close-settings').click()
            logo.click()
            assert toast.is_hidden(), 'Panel close hides but does not cancel notice'
            logo.click()
            assert toast.is_visible(), 'Quick reopen restores still-live notice'
            page.wait_for_function('document.querySelector(".cw-toast").hidden === true',timeout=6500)
            assert toast.is_hidden(), 'Transient notice must expire naturally'
            assert not errors,(suffix,width,errors)
            print('PASS', 'Dev' if suffix else 'Stable', width,'toast lifecycle, dialogue transitions, replacement, storage persistence',flush=True)
            page.close()
    browser.close()
