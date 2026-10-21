#!/usr/bin/env python3
"""Uniform panel-local dialog keyboard/native cancel: no mutation on dismissal."""
from playwright.sync_api import sync_playwright
from support.current import SCRIPT

CHAT = '11111111-1111-4111-8111-111111111111'
MSG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
HTML = f'''<!doctype html><html><body><main>
<section data-chatgpt-search-unit-key="unit1:user" data-chatgpt-search-message-ids="{MSG}">
<div class="whitespace-pre-wrap">This is a test message that creates a confirmed chat.</div>
</section></main>
<form data-chatgpt-composer><button type="button" data-testid="send-button">Send</button></form></body></html>'''
INIT = '''() => {
 const m=new Map([['other-app:keep','outside-value']]);
 Object.defineProperty(window,'localStorage',{configurable:true,value:{
 getItem:k=>m.get(String(k))??null,
 setItem:(k,v)=>m.set(String(k),String(v)),
 removeItem:k=>m.delete(String(k)),
 key:i=>[...m.keys()][i]??null,
 get length(){return m.size}
 }});
 window.confirm=()=>{throw Error('native browser confirmation invoked')};
}'''
INJECTED=SCRIPT.replace('(() => {',
 f"(() => {{\nconst location={{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};", 1)

with sync_playwright() as p:
 browser = p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
       args=['--no-sandbox','--disable-dev-shm-usage'])
 for width in (1200, 390):
  page=browser.new_page(viewport={'width':width,'height':800})
  page.set_default_timeout(6500)
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(HTML)
  page.evaluate(INIT)
  page.add_script_tag(content=INJECTED)
  page.locator('.cw-logo-hit').click()
  main=page.locator('.cw-panel-main')
  def native_cancel(selector):
   dlg=page.locator(selector)
   assert dlg.evaluate('(e)=>e.open'),selector
   # This event must be prevented and redirected through the exact local close path.
   assert dlg.evaluate('e=>{const ev=new Event("cancel",{cancelable:true});e.dispatchEvent(ev);return ev.defaultPrevented;}'),selector
   assert not dlg.evaluate('(e)=>e.open'),selector
   assert not main.evaluate('(e)=>e.inert'),selector
  # Standard dialogs: native cancel and Escape share the same semantics.
  page.locator('.cw-settings-btn').click()
  native_cancel('.cw-settings-dialog:not(.cw-about-dialog):not(.cw-limit-dialog):not(.cw-confirm-dialog)')
  assert page.locator('.cw-settings-btn').evaluate('e=>e===document.activeElement')
  page.locator('.cw-about-btn').click()
  native_cancel('.cw-about-dialog')
  assert page.locator('.cw-about-btn').evaluate('e=>e===document.activeElement')
  page.locator('.cw-end-chat').click()
  before=page.evaluate("localStorage.getItem('cgpt-context-watchdog:ended-history:v2')")
  native_cancel('.cw-limit-dialog')
  assert page.locator('.cw-end-chat').evaluate('e=>e===document.activeElement')
  assert page.evaluate("localStorage.getItem('cgpt-context-watchdog:ended-history:v2')")==before
  page.locator('.cw-settings-btn').click()
  settings=page.locator('.cw-settings-dialog:not(.cw-about-dialog):not(.cw-limit-dialog):not(.cw-confirm-dialog)')
  page.locator('.cw-clear-watchdog-data').click()
  confirm=page.locator('.cw-confirm-dialog')
  assert confirm.evaluate('e=>e.open') and settings.evaluate('e=>e.inert')
  stored=page.evaluate('''() => Array.from({length:localStorage.length},(_,i)=>{
    const k=localStorage.key(i);return [k,localStorage.getItem(k)]})''')
  assert confirm.evaluate('e=>{const ev=new Event("cancel",{cancelable:true});e.dispatchEvent(ev);return ev.defaultPrevented;}')
  assert not confirm.evaluate('e=>e.open')
  assert settings.evaluate('e=>e.open&&!e.inert')
  assert page.evaluate('''() => Array.from({length:localStorage.length},(_,i)=>{
    const k=localStorage.key(i);return [k,localStorage.getItem(k)]})''')==stored
  # Confirm can be opened again after cancellation; explicit OK is the only write path.
  page.locator('.cw-clear-watchdog-data').click()
  assert confirm.evaluate('e=>e.open')
  confirm.locator('.cw-cancel-confirm').press('Escape')
  assert not confirm.evaluate('e=>e.open')
  assert settings.evaluate('e=>e.open&&!e.inert')
  settings.locator('.cw-close-settings').click()
  assert not errors,(width,errors)
  print('PASS',width,'unified cancel/Escape, focus, no side effects, reopen')
  page.close()
 browser.close()
