#!/usr/bin/env python3
"""Chromium DOM regression: persisted image caching with live MutationObserver/load.
Ephemeral QA hooks in a synthetic page; no permanent hooks in product bytes.
"""
import json
from pathlib import Path
from urllib.parse import quote
from playwright.sync_api import sync_playwright
from support.current import VERSION

ROOT=Path(__file__).resolve().parents[1]
CHAT='11111111-1111-4111-8111-111111111111'
MSG='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
KEY='cgpt-context-watchdog:state:v2:chat%3A'+CHAT
TEXT='An old complete user message with images already saved in our local conversation ledger. '*4

def imgdata(w,h,c):
    return 'data:image/svg+xml,'+quote(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}"><rect width="100%" height="100%" fill="{c}"/></svg>')

HTML=f'''<!doctype html><html><body><main>
<section id="user-turn" data-chatgpt-search-unit-key="unit:user" data-chatgpt-search-message-ids="{MSG}">
<div class="whitespace-pre-wrap">{TEXT}</div><img id="photo" alt="uploaded photo" src="{imgdata(500,400,'red')}"></section></main>
<form data-chatgpt-composer><button type="button" data-testid="send-button">Send</button></form></body></html>'''
INIT='''() => {
  const data=new Map();
  Object.defineProperty(window,'localStorage',{configurable:true,value:{
    getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),
    removeItem:k=>data.delete(k),key:i=>[...data.keys()][i]??null,
    get length(){return data.size}
  }});
  window.__imgQueries=0;
  const orig=Element.prototype.querySelectorAll;
  Element.prototype.querySelectorAll=function(s){
    if(s==='img' && this.id==='user-turn') window.__imgQueries++;
    return orig.call(this,s);
  };
}'''
HOOKS='''
  window.__imageCacheQA={
    scan:()=>loadModule('src/app/11-message-scan.js').scanMessages({backfill:true,reason:'image QA'}),
    status:()=>({queries:window.__imgQueries,
      ledger:JSON.parse(localStorage.getItem('cgpt-context-watchdog:state:v2:chat%3A11111111-1111-4111-8111-111111111111')||'null')})
  };
'''

def inject(source):
    marker="  loadModule('src/main.js');"
    assert source.count(marker)==1, 'QA hook requires the isolated-module build'
    script=source.replace(marker,HOOKS+marker,1)
    opening='\n(() => {\n'
    assert script.count(opening)==1
    return script.replace(opening,opening+f"const location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};\n",1)

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    for suffix,label in [('', 'Stable'),('.dev','Dev')]:
        source=(ROOT/f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text()
        page=browser.new_page(viewport={'width':990,'height':800})
        page.set_default_timeout(10000)
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(HTML)
        page.evaluate(INIT)
        page.add_script_tag(content=inject(source))
        page.wait_for_function('''key=>{
          const s=JSON.parse(localStorage.getItem(key)||'null');
          return !!s && Object.keys(s.domImages||{}).length===1;
        }''',arg=KEY)
        page.wait_for_function("() => document.querySelector('#photo').naturalWidth===500")
        # A direct scan after load certifies any previously incomplete dimensions.
        result=page.evaluate('''() => {
          window.__imageCacheQA.scan();
          const before=window.__imgQueries;
          for(let i=0;i<12;i++) window.__imageCacheQA.scan();
          return {before,after:window.__imgQueries};
        }''')
        assert result['after']==result['before'],(label,'repeated DOM traversal',result)
        print('PASS',label,'12 clean full scans without image querySelectorAll',flush=True)
        page.evaluate('''url => {
          document.querySelector('#photo').src=url;
        }''',imgdata(700,420,'green'))
        page.wait_for_function('''() => document.querySelector('#photo').naturalWidth===700''')
        page.wait_for_function('''start => window.__imgQueries>start''',arg=result['after'])
        page.evaluate('window.__imageCacheQA.scan()')
        state=page.evaluate('''()=>window.__imageCacheQA.status()''')
        assert len(state['ledger']['domImages'])==1,(label,state)
        print('PASS',label,'src change and image load cause rescan, retain one slot',flush=True)
        # srcset attribute invalidation, including same-node responsive sources.
        prior=state['queries']
        page.evaluate('''url => document.querySelector('#photo').setAttribute('srcset',url+' 1x')''', imgdata(640,440,'yellow'))
        page.wait_for_function('''start => window.__imgQueries>start''',arg=prior)
        page.evaluate('window.__imageCacheQA.scan()')
        assert len(page.evaluate('''()=>window.__imageCacheQA.status().ledger.domImages'''))==1
        print('PASS',label,'srcset mutation invalidates cached image',flush=True)
        before=page.evaluate('window.__imgQueries')
        page.evaluate('''url=>{
          const img=document.createElement('img');img.alt='second user image';img.src=url;
          document.querySelector('#user-turn').appendChild(img);
        }''',imgdata(540,300,'blue'))
        page.wait_for_function('''key => Object.keys(JSON.parse(localStorage.getItem(key)||'{}').domImages||{}).length===2''',arg=KEY)
        assert page.evaluate('window.__imgQueries')>before
        page.evaluate('''()=>document.querySelector('#user-turn img:last-child').remove()''')
        page.evaluate('window.__imageCacheQA.scan()')
        assert page.evaluate('''key=>Object.keys(JSON.parse(localStorage.getItem(key)).domImages).length''',KEY)==2
        print('PASS',label,'image insert/remove invalidation, historical slot preserved',flush=True)
        # Heavy observer disconnects during Pause. Resume must NOT reuse the
        # old inspected-turn cache, even if image attributes changed while off.
        page.locator('.cw-logo-hit').click()
        page.locator('.cw-pause-toggle').click()
        queries_before_pause=page.evaluate('window.__imgQueries')
        page.locator('#photo').evaluate("e=>e.setAttribute('alt','updated during Pause')")
        page.wait_for_timeout(180)
        assert page.evaluate('window.__imgQueries')==queries_before_pause
        page.locator('.cw-pause-toggle').click()
        page.wait_for_function('''start=>window.__imgQueries>start''',arg=queries_before_pause)
        print('PASS',label,'Pause/Resume invalidates cached turn',flush=True)
        assert not errors,(label,errors)
        page.close()
    browser.close()
