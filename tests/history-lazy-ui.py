#!/usr/bin/env python3
"""Stable/Dev: History is loaded once on demand, without ledger work on tab flips."""
import json
from playwright.sync_api import sync_playwright
from support.current import SCRIPT

CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main></main><form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form></body></html>'''
INJECTED=SCRIPT.replace('(() => {',f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
HISTORY='cgpt-context-watchdog:ended-history:v2'
SAMPLES=[{'chatKey':'chat:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','seen':200,'optimistic':300,'pessimistic':500}]

def run(browser,width):
    page=browser.new_page(viewport={'width':width,'height':800})
    page.set_default_timeout(7000)
    errors=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.set_content(HTML)
    page.evaluate('''([key,value])=>{
       const data=new Map([[key,value]]);
       const reads=[];
       Object.defineProperty(window,'__wdReads',{value:reads});
       Object.defineProperty(window,'localStorage',{configurable:true,value:{
          getItem:k=>{reads.push(String(k));return data.get(String(k))??null;},
          setItem:(k,v)=>data.set(String(k),String(v)),
          removeItem:k=>data.delete(String(k)),
          key:i=>[...data.keys()][i]??null,get length(){return data.size}
       }});
    }''',[HISTORY,json.dumps(SAMPLES)])
    page.add_script_tag(content=INJECTED)
    page.locator('.cw-logo-hit').click()
    page.locator('.cw-tab-budget').click()
    counts=lambda:page.evaluate('''key=>({history:window.__wdReads.filter(k=>k===key).length,
      ledger:window.__wdReads.filter(k=>k.includes(':state:')).length,
      all:window.__wdReads.length})''',HISTORY)
    before=counts()
    assert before['history']==0,('Eager History read',width,before)
    page.locator('[data-cw-budget="history"]').click()
    pane=page.locator('.cw-history-details')
    assert 'Recorded limit samples: 1' in pane.inner_text()
    after=counts()
    assert after['history']==1,('History should load exactly once',width,before,after)
    assert after['ledger']==before['ledger'],('History opening reloaded the ledger',width,before,after)
    for _ in range(3):
        page.locator('[data-cw-budget="limits"]').click()
        page.locator('[data-cw-budget="history"]').click()
    again=counts()
    assert again['history']==after['history'] and again['ledger']==after['ledger'],('Reopen should reuse caches',width,after,again)
    # External tab changes the history key: invalidate cache and repaint visible History.
    page.evaluate('''([key,value])=>{
       window.localStorage.setItem(key,value);
       window.dispatchEvent(new StorageEvent('storage',{key,newValue:value}));
    }''',[HISTORY,json.dumps(SAMPLES+[{**SAMPLES[0],'chatKey':'chat:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}])])
    # Wait for an observable repaint, not a hardcoded 100 ms on the CI host.
    # This cannot pass on the old fixture because only 1 sample is initially shown.
    page.wait_for_function('''()=>document.querySelector('.cw-history-details')?.textContent?.includes('Recorded limit samples: 2')''',timeout=4000)
    assert 'Recorded limit samples: 2' in pane.inner_text(),('External History update not rendered',width,pane.inner_text())
    assert counts()['history']==2,('Invalidation did not reload exactly once',width,counts())
    assert not errors,errors
    print(f'PASS History on-demand {width}px · no ledger reload · cached reopens · external update',flush=True)
    page.close()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
                              args=['--no-sandbox','--disable-dev-shm-usage'])
    for width in [390,1200]:run(browser,width)
    browser.close()
