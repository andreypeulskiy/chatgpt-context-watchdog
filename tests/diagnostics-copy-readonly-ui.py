#!/usr/bin/env python3
"""Stable/Dev: Copy diagnostics snapshots Stop/Send without scanning or saving.
No artificial polling, network calls, or modifications to the source chat.
"""
from playwright.sync_api import sync_playwright
from support.current import SCRIPT

CHAT = '11111111-1111-4111-8111-111111111111'
MSG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
HTML = f'''<!doctype html><html><body><main>
<section data-chatgpt-search-unit-key="unit0:user" data-chatgpt-search-message-ids="{MSG}">
<div class="whitespace-pre-wrap">A confirmed completed message for diagnostics testing.</div>
</section><form data-chatgpt-composer>
<button data-testid="send-button">Send</button>
<button data-testid="stop-button" style="display:none">Stop</button>
</form></main></body></html>'''
INIT = '''() => {
 const mem=new Map();window.__writes=0;window.__copied=null;
 Object.defineProperty(window,'localStorage',{configurable:true,value:{
  getItem:k=>mem.get(String(k))??null,
  setItem(k,v){window.__writes++;mem.set(String(k),String(v))},
  removeItem:k=>mem.delete(String(k)),
  key:i=>[...mem.keys()][i]??null,
  get length(){return mem.size}
 }});
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
  writeText:async text=>{window.__copied=text}
 }});
}'''
INJECTED = SCRIPT.replace('(() => {', f'''(() => {{
const location={{pathname:'/c/{CHAT}',href:'https://chatgpt.com/c/{CHAT}',origin:'https://chatgpt.com'}};''', 1)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                args=['--no-sandbox','--disable-dev-shm-usage'])
    for width in (390, 1200):
        page = browser.new_page(viewport={'width':width,'height':800})
        page.set_default_timeout(10000)
        errors = []
        page.on('pageerror', lambda err: errors.append(str(err)))
        page.set_content(HTML)
        page.evaluate(INIT)
        page.add_script_tag(content=INJECTED)
        page.locator('.cw-logo-hit').click()
        page.locator('.cw-settings-btn').click()
        page.locator('[data-cw-tools="diagnostics"]').click()
        panel=page.locator('#cw-tools-diagnostics')
        assert panel.is_visible()
        assert 'Send yes' in panel.locator('.cw-diagnostics-line').inner_text()
        # Change the controls and click in the same synchronous task. The
        # coordinator has not yet processed any mutation observer callback.
        result = page.evaluate('''() => {
          const send=document.querySelector('[data-testid="send-button"]');
          const stop=document.querySelector('[data-testid="stop-button"]');
          send.style.display='none';stop.style.display='';
          const before=window.__writes;
          let collections=0;
          const orig=Document.prototype.querySelectorAll;
          Document.prototype.querySelectorAll=function(sel){
            if(String(sel).includes('data-chatgpt-search-unit-key') ||
               String(sel).includes('data-message-id')) collections++;
            return orig.call(this,sel);
          };
          document.querySelector('.cw-copy-diagnostics').click();
          Document.prototype.querySelectorAll=orig;
          return {before,after:window.__writes,collections,report:
            document.querySelector('.cw-diagnostics-line').textContent,
            copied:window.__copied};
        }''')
        assert result['collections']==0, result
        assert result['after']==result['before'], result
        assert 'Stop yes · Send no' in result['report'], result
        assert result['copied']==result['report'],result
        assert not errors,errors
        print(f'PASS Diagnostics read-only copy, active Stop/Send, {width}px',flush=True)
        page.close()
    browser.close()
