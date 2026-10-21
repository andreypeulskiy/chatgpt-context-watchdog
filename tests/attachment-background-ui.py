#!/usr/bin/env python3
"""Current Stable/Dev userscript: sibling file chips in active composer-background.
Hooks only in ephemeral injected bundle; no production test interface.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
from support.current import VERSION
from support.esbuild_hooks import instrument_bundle

ROOT=Path(__file__).resolve().parents[1]
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main>
<div id="composer-background">
<form data-chatgpt-composer>
<div contenteditable="true" role="textbox" style="min-height:30px;width:260px"></div>
<button data-testid="send-button" type="button">Send</button>
</form>
<span id="chip" title="review.txt">review.txt</span>
</div></main></body></html>'''
HOOKS='''
  window.__fileQA={
    pending:()=>pendingLocalFiles,
    choose:()=>stageLocalFile(new File(['contents'],'review.txt', {type:'text/plain'}),'file-input'),
    paused:()=>isWatchdogPaused()
  };'''
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
   args=['--no-sandbox','--disable-dev-shm-usage'])
 for suffix in ('','.dev'):
  source=(ROOT/f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text()
  route=f"{{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}}"
  bundle=instrument_bundle(source,HOOKS,route=route)
  for scenario in ('sibling','removed','hidden','other-form','paused','generic'):
   page=browser.new_page(viewport={'width':390,'height':840})
   errors=[];page.on('pageerror',lambda exc:errors.append(str(exc)))
   page.set_content(HTML)
   if scenario=='generic':
    page.locator('form').evaluate("e=>e.removeAttribute('data-chatgpt-composer')")
   if scenario=='other-form':
    page.locator('#chip').evaluate("e=>{const form=document.createElement('form');e.parentNode.insertBefore(form,e);form.appendChild(e)}")
   if scenario=='removed':page.locator('#chip').evaluate('e=>e.remove()')
   if scenario=='hidden':page.locator('#chip').evaluate("e=>e.style.display='none'")
   page.evaluate("""() => {const data=new Map();
     Object.defineProperty(window,'localStorage',{configurable:true,value:{
       getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),
       removeItem:k=>data.delete(k),key:i=>[...data.keys()][i]??null,
       get length(){return data.size}
     }});
   }""")
   page.add_script_tag(content=bundle)
   page.wait_for_function("() => document.querySelector('.cw-pause-toggle')?.disabled===false")
   page.evaluate('window.__fileQA.choose()')
   assert page.evaluate('window.__fileQA.pending().length')==1
   if scenario=='paused':
    page.locator('.cw-logo-hit').click()
    page.locator('.cw-pause-toggle').click()
    assert page.evaluate('window.__fileQA.paused()')
   page.locator('form button').first.click()
   state=page.evaluate('''() => window.__fileQA.pending().map(p=>({submitted:p.submittedAt>0}))''')
   if scenario=='paused':assert state==[{'submitted':False}],(scenario,state)
   elif scenario in ('sibling','generic'):assert state==[{'submitted':True}],(scenario,state)
   else:assert state==[],(scenario,state)
   assert not errors,errors
   print('PASS',suffix or 'stable',scenario,'active-background file submission',flush=True)
   page.close()
 browser.close()
