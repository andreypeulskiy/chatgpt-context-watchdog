#!/usr/bin/env python3
"""HANDOFF's clean-vs-dirty synchronization across external settings updates."""
from playwright.sync_api import sync_playwright
from support.current import SCRIPT

CHAT='11111111-1111-4111-8111-111111111111'
MSG='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
HTML=f'''<!doctype html><html><body><main><section data-chatgpt-search-unit-key="unit1:user"
 data-chatgpt-search-message-ids="{MSG}"><div class="whitespace-pre-wrap">Message content.</div>
 </section></main><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea>
 <button data-testid="send-button">Send</button></form></body></html>'''
INIT='''() => {
 const values = new Map();
 Object.defineProperty(window, 'localStorage', {configurable:true, value:{
   getItem:k=>values.get(String(k))??null,
   setItem:(k,v)=>values.set(String(k),String(v)),
   removeItem:k=>values.delete(String(k)),
   key:i=>[...values.keys()][i]??null,
   get length(){return values.size}
 }});
 window.__externalHandoff = value => {
   const key='cgpt-context-watchdog:settings:v1';
   const oldValue=localStorage.getItem(key);
   const saved=oldValue ? JSON.parse(oldValue) : {};
   const next=JSON.stringify({...saved,handoffPrompt:value});
   localStorage.setItem(key,next);
   dispatchEvent(new StorageEvent('storage',{key,oldValue,newValue:next}));
 };
}'''
SCRIPT_INJECT=SCRIPT.replace('(() => {',
 f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};", 1)

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
  args=['--no-sandbox','--disable-dev-shm-usage'])
 for width in (390,1200):
  page=browser.new_page(viewport={'width':width,'height':850})
  page.set_default_timeout(9000)
  errors=[]
  page.on('pageerror',lambda err:errors.append(str(err)))
  page.set_content(HTML)
  page.evaluate(INIT)
  page.add_script_tag(content=SCRIPT_INJECT)
  page.locator('.cw-logo-hit').click()
  page.locator('.cw-settings-btn').click()
  settings=page.locator('.cw-settings-dialog:not(.cw-confirm-dialog):not(.cw-about-dialog):not(.cw-limit-dialog)')
  settings.locator('[data-cw-tools="technical"]').click()
  editor=settings.locator('.cw-handoff-editor')
  editor.locator('summary').click()
  field=editor.locator('.cw-handoff-prompt')
  warning=editor.locator('.cw-handoff-unsaved')
  assert not warning.is_visible()
  original=field.input_value()
  assert len(original)>1000
  assert field.get_attribute('maxlength')=='4000'

  page.evaluate('window.__externalHandoff("Other-tab prompt A")')
  assert field.input_value()=='Other-tab prompt A', 'Clean HANDOFF editor must follow external settings'
  assert not warning.is_visible()
  assert editor.locator('.cw-handoff-counter').inner_text()=='18 / 4000'

  field.fill('Unsaved local draft')
  assert warning.is_visible()
  page.evaluate('window.__externalHandoff("Other-tab prompt B")')
  assert field.input_value()=='Unsaved local draft', 'External storage must not overwrite a draft'
  assert warning.is_visible()
  settings.locator('[data-cw-tools="view"]').click()
  settings.locator('[data-cw-tools="technical"]').click()
  assert field.input_value()=='Unsaved local draft'
  settings.locator('.cw-close-settings').click()
  page.locator('.cw-handoff-details').click()
  assert page.locator('#prompt-textarea').input_value()=='Other-tab prompt B', 'Toolbar must use saved, not draft'
  page.locator('#prompt-textarea').fill('')
  page.locator('.cw-settings-btn').click()
  settings.locator('[data-cw-tools="technical"]').click()
  assert field.input_value()=='Unsaved local draft'
  assert warning.is_visible()

  editor.locator('.cw-save-handoff').click()
  assert not warning.is_visible()
  assert page.evaluate('JSON.parse(localStorage.getItem("cgpt-context-watchdog:settings:v1")).handoffPrompt')=='Unsaved local draft'
  page.evaluate('window.__externalHandoff("Other-tab prompt C")')
  assert field.input_value()=='Other-tab prompt C', 'After Save editor must become clean'
  assert not warning.is_visible()

  field.fill('Local draft to revert')
  assert warning.is_visible()
  field.fill('Other-tab prompt C')
  assert not warning.is_visible(), 'Typing the active value clears dirty state'
  page.evaluate('window.__externalHandoff("Other-tab prompt D")')
  assert field.input_value()=='Other-tab prompt D'
  assert not warning.is_visible()

  editor.locator('.cw-restore-handoff').click()
  page.locator('.cw-confirm-dialog .cw-confirm-ok').click()
  assert field.input_value()==original
  assert warning.is_visible()
  assert page.evaluate('JSON.parse(localStorage.getItem("cgpt-context-watchdog:settings:v1")).handoffPrompt')=='Other-tab prompt D'
  editor.locator('.cw-save-handoff').click()
  assert not warning.is_visible()
  assert page.evaluate('JSON.parse(localStorage.getItem("cgpt-context-watchdog:settings:v1")).handoffPrompt')==original

  # Host replaces the whole Watchdog root: preserve only the in-session draft,
  # while old event listeners and DOM nodes must not be reused.
  field.fill('Draft surviving host remount')
  assert warning.is_visible()
  page.evaluate('document.getElementById("cgpt-context-watchdog-root").remove()')
  page.wait_for_function('!!document.getElementById("cgpt-context-watchdog-root")')
  page.locator('.cw-logo-hit').click()
  page.locator('.cw-settings-btn').click()
  settings.locator('[data-cw-tools="technical"]').click()
  editor.locator('summary').click()
  assert field.input_value()=='Draft surviving host remount'
  assert warning.is_visible()
  # Repeat a root replacement while the current editor is clean.
  editor.locator('.cw-save-handoff').click()
  assert not warning.is_visible()
  page.evaluate('document.getElementById("cgpt-context-watchdog-root").remove()')
  page.wait_for_function('!!document.getElementById("cgpt-context-watchdog-root")')
  page.locator('.cw-logo-hit').click()
  page.locator('.cw-settings-btn').click()
  settings.locator('[data-cw-tools="technical"]').click()
  editor.locator('summary').click()
  assert field.input_value()=='Draft surviving host remount'
  assert not warning.is_visible()
  assert not errors,errors
  print(f'PASS HANDOFF clean/draft/external/save/restore at {width}px',flush=True)
  page.close()
 browser.close()
