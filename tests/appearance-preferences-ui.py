#!/usr/bin/env python3
"""Appearance preferences: settings, OS theme, page theme, host-root replacement."""
from playwright.sync_api import sync_playwright
from support.current import SCRIPT, BUNDLE_KIND

CHAT = '11111111-1111-4111-8111-111111111111'
HTML = '''<!doctype html><html><body><div id="__next" data-theme="dark">
 <form data-chatgpt-composer><button type="button" data-testid="send-button">Send</button></form>
 </div></body></html>'''
INJECT = SCRIPT.replace('(() => {',
    f"(() => {{\nconst location={{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};", 1)
INIT = '''() => {
 const data = new Map();
 Object.defineProperty(window,'localStorage',{configurable:true,value:{
   getItem:k=>data.get(String(k))??null,
   setItem:(k,v)=>data.set(String(k),String(v)),
   removeItem:k=>data.delete(String(k)),
   key:i=>[...data.keys()][i]??null,
   get length(){return data.size}
 }});
 const listeners = [];
 let dark = false;
 const mq = {get matches(){return dark},addEventListener(type,fn){if(type==='change')listeners.push(fn)}};
 const realMatch = window.matchMedia.bind(window);
 window.matchMedia = query => query==='(prefers-color-scheme: dark)' ? mq : realMatch(query);
 window.__flipSystemTheme = value => {
   dark = value;
   for(const listener of listeners) listener({matches: dark});
 };
 window.__externalAppearance = changes => {
   const key='cgpt-context-watchdog:settings:v1';
   const oldValue=localStorage.getItem(key);
   const next=JSON.stringify({...JSON.parse(oldValue || '{}'),...changes});
   localStorage.setItem(key,next);
   dispatchEvent(new StorageEvent('storage',{key,oldValue,newValue:next}));
 };
}'''

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
   args=['--no-sandbox','--disable-dev-shm-usage'])
 for variant in (BUNDLE_KIND,):
  page=browser.new_page(viewport={'width':900,'height':780})
  page.set_default_timeout(5500)
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(HTML)
  page.evaluate(INIT)
  page.add_script_tag(content=INJECT)
  root=page.locator('#cgpt-context-watchdog-root')
  assert root.get_attribute('data-cw-palette')=='dark',variant
  assert root.get_attribute('data-cw-style')=='soft',variant
  page.locator('.cw-logo-hit').click()
  page.locator('.cw-settings-btn').click()
  settings=page.locator('.cw-settings-dialog:not(.cw-about-dialog):not(.cw-confirm-dialog):not(.cw-limit-dialog)')
  def selected(attr,value):
   assert settings.locator(f'[data-cw-view-{attr}="{value}"]').get_attribute('aria-pressed')=='true',(variant,attr,value)
  selected('style','soft');selected('theme','chatgpt')
  settings.locator('[data-cw-view-style="sharp"]').click()
  settings.locator('[data-cw-view-theme="light"]').click()
  assert root.get_attribute('data-cw-style')=='sharp'
  assert root.get_attribute('data-cw-palette')=='light'
  selected('style','sharp');selected('theme','light')
  saved=page.evaluate('JSON.parse(localStorage.getItem("cgpt-context-watchdog:settings:v1"))')
  assert (saved['viewStyle'],saved['viewTheme'])==('sharp','light'),(variant,saved)
  page.evaluate("document.getElementById('__next').setAttribute('data-theme','dark')")
  assert root.get_attribute('data-cw-palette')=='light','Fixed theme must ignore page markers'
  settings.locator('[data-cw-view-theme="system"]').click()
  assert root.get_attribute('data-cw-palette')=='light'
  page.evaluate('window.__flipSystemTheme(true)')
  assert root.get_attribute('data-cw-palette')=='dark',variant
  page.evaluate('window.__flipSystemTheme(false)')
  assert root.get_attribute('data-cw-palette')=='light',variant
  settings.locator('[data-cw-view-theme="chatgpt"]').click()
  assert root.get_attribute('data-cw-palette')=='dark'
  page.evaluate("document.getElementById('__next').setAttribute('data-theme','light')")
  page.wait_for_function("document.querySelector('#cgpt-context-watchdog-root').dataset.cwPalette==='light'")
  # Remount the ChatGPT host root without changing html/body attributes.
  # Theme observer must reattach to the new root, not to the detached old node.
  page.evaluate('''() => {
    const old=document.getElementById('__next');
    const replacement=document.createElement('div');
    replacement.id='__next';replacement.dataset.theme='dark';
    old.replaceWith(replacement);
  }''')
  page.wait_for_function("document.querySelector('#cgpt-context-watchdog-root').dataset.cwPalette==='dark'")
  page.evaluate("document.getElementById('__next').dataset.theme='light'")
  page.wait_for_function("document.querySelector('#cgpt-context-watchdog-root').dataset.cwPalette==='light'")
  page.evaluate('window.__externalAppearance({viewTheme:"dark",viewStyle:"soft"})')
  assert root.get_attribute('data-cw-style')=='soft'
  assert root.get_attribute('data-cw-palette')=='dark'
  selected('style','soft');selected('theme','dark')
  assert not errors,(variant,errors)
  print('PASS',variant,'preferences, storage, page/system changes, host remount, ARIA')
  page.close()
 browser.close()
