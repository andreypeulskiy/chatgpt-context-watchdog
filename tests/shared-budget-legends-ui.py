#!/usr/bin/env python3
"""Budget legends remain present, ordered, readable and non-overlapping."""
import json
from playwright.sync_api import sync_playwright
from support.current import SCRIPT

CHAT='11111111-1111-4111-8111-111111111111'
MSG='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
KEY='cgpt-context-watchdog:state:v2:chat%3A'+CHAT
HTML='''<!doctype html><html><body><main></main><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form></body></html>'''
INJECTED=SCRIPT.replace('(() => {',f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
INIT='''items=>{const data=new Map(items);Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>data.get(String(k))??null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),key:i=>[...data.keys()][i]??null,get length(){return data.size}}});}'''
OBS='''() => {
 const root=document.querySelector('[id$="-root"]');
 const cardLegends=[...root.querySelectorAll('.cw-forecast-cards .cw-context-note')];
 const barLegends=[...root.querySelectorAll('.cw-progress-grid .cw-context-note')];
 const bars=[...root.querySelectorAll('.cw-progress-grid > div')];
 return {cardLegends:cardLegends.map(el=>({text:el.textContent.trim(),width:el.getBoundingClientRect().width,
   top:el.getBoundingClientRect().top,prevBottom:el.previousElementSibling.getBoundingClientRect().bottom})),
  barLegends:barLegends.map(el=>({text:el.textContent.trim(),width:el.getBoundingClientRect().width,
   top:el.getBoundingClientRect().top,prevBottom:el.previousElementSibling.getBoundingClientRect().bottom})),
  barTracks:bars.map(el=>({first:el.firstElementChild.className,height:el.firstElementChild.getBoundingClientRect().height})),
  overflow:root.querySelector('.cw-progress-grid').scrollWidth-root.querySelector('.cw-progress-grid').clientWidth};
}'''

def check(browser,width):
 page=browser.new_page(viewport={'width':width,'height':850})
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(HTML)
 state={'chatKey':'chat:'+CHAT,'messages':{'msg:'+MSG:{'role':'user','tokens':80000,'chars':160000}},'files':{},'domImages':{},'attachmentLedgerVersion':2,'repairHistory':[],'updatedAt':0}
 page.evaluate(INIT,[(KEY,json.dumps(state))])
 page.add_script_tag(content=INJECTED)
 page.locator('.cw-logo-hit').click()
 page.locator('.cw-tab-budget').click()
 for palette in ('light','dark'):
  for shape in ('soft','sharp'):
   page.locator('[id$="-root"]').evaluate('(r,v)=>{r.dataset.cwPalette=v[0];r.dataset.cwStyle=v[1]}',[palette,shape])
   out=page.evaluate(OBS)
   assert [x['text'] for x in out['cardLegends']]==['Optimistic','Pessimistic'],out
   assert [x['text'] for x in out['barLegends']]==['Conservative','Normal','Generous']*2,out
   for label in out['cardLegends']+out['barLegends']:
    assert label['width']>0,(width,palette,shape,label)
    assert label['top']>=label['prevBottom']-3,(width,palette,shape,label)
   assert len(out['barTracks'])==6 and all('cw-progress-track' in b['first'] and b['height']>0 for b in out['barTracks']),out
   assert out['overflow']<=1,(width,palette,shape,out['overflow'])
 assert not errors,errors
 print(f'PASS Budget legend contents, no collisions or overflow {width}px · Light/Dark · Soft/Sharp',flush=True)
 page.close()

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for w in (320,390,1200):check(browser,w)
 browser.close()
