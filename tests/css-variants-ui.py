#!/usr/bin/env python3
"""Exercise actual Stable/Dev layouts and visible non-overflow, not pixel tokens."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
from support.current import VERSION
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main></main><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form></body></html>'''
BASE=ROOT/f'dist/chatgpt-context-watchdog-{VERSION}.user.js'
DEV=ROOT/f'dist/chatgpt-context-watchdog-{VERSION}.dev.user.js'
assert BASE.is_file() and DEV.is_file()

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 stable_panel_widths={}
 for mode,file in (('Stable',BASE),('Dev',DEV)):
  content=file.read_text()
  injected=content.replace('(() => {',f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
  for width in (320,390,500,1200):
   page=browser.new_page(viewport={'width':width,'height':850})
   errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
   page.set_content(HTML)
   # Use a non-empty saved chat fixture, otherwise the Budget cards are
   # hidden and scrollWidth==clientWidth checks are vacuous.
   seed={'chatKey':'chat:'+CHAT,'messages':{
     'msg:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa':{'role':'user','tokens':80000,'chars':160000}},
     'files':{},'domImages':{},'attachmentLedgerVersion':2,'repairHistory':[],'updatedAt':0}
   key='cgpt-context-watchdog:state:v2:chat%3A'+CHAT
   page.evaluate('''items=>{const m=new Map(items);Object.defineProperty(window,'localStorage',{
     configurable:true,value:{getItem:k=>m.get(String(k))??null,
       setItem:(k,v)=>m.set(String(k),String(v)),removeItem:k=>m.delete(String(k)),
       key:i=>[...m.keys()][i]??null,get length(){return m.size}}
   });}''',[(key,json.dumps(seed))])
   page.add_script_tag(content=injected)
   # The closed badge must remain visible, independently of right-margin tokens.
   chip_bounds=page.locator('.cw-chip').bounding_box()
   assert chip_bounds and chip_bounds['x']>=-1 and chip_bounds['x']+chip_bounds['width']<=width+1,(mode,width,chip_bounds)
   page.locator('.cw-logo-hit').click()
   for palette in ('light','dark'):
    for shape in ('soft','sharp'):
     page.locator('[id$="-root"]').evaluate('(e,p)=>{e.dataset.cwPalette=p[0];e.dataset.cwStyle=p[1]}',[palette,shape])
     data=page.evaluate('''() => {
      const root=document.querySelector('[id$="-root"]'),panel=root.querySelector('.cw-panel');
      const pr=panel.getBoundingClientRect(),r=el=>el.getBoundingClientRect();
      const tab=root.querySelector('.cw-tabs button'),title=root.querySelector('.cw-title-info strong');
      return {width:pr.width, maxHeight:parseFloat(getComputedStyle(panel).maxHeight),
         panelTop:pr.top,panelBottom:pr.bottom,chipTop:r(root.querySelector('.cw-chip')).top,
         panelVisible:pr.width>0&&pr.height>0,
         titleVisible:r(title).width>0&&parseFloat(getComputedStyle(title).fontSize)>=8,
         tabVisible:r(tab).width>0&&parseFloat(getComputedStyle(tab).fontSize)>=8};
     }''')
     assert data['panelVisible'] and data['titleVisible'] and data['tabVisible'],(mode,width,palette,shape,data)
     if mode=='Stable':
      stable_panel_widths[width]=data['width']
     else:
      assert data['width']<=stable_panel_widths[width]+4,(mode,width,data)
      if width==320: assert data['width']<stable_panel_widths[width]-8,(mode,width,data)
     assert 0 < data['maxHeight'] <= 850-data['panelTop']+1,(mode,width,data)
     if 0<=data['chipTop']-data['panelBottom']<=24:
      assert data['maxHeight']<=data['chipTop']-data['panelTop']+1,(mode,width,data)
     # Check a populated visible state. Comparing scrollWidth only with the
     # region's own clientWidth would miss a too-wide region spilling outside
     # the panel, so compare with its actual parent viewport as well.
     for tab,region in (('.cw-tab-context','.cw-tabs'),
                        ('.cw-tab-budget','.cw-forecast-cards'),
                        ('.cw-tab-details','.cw-details-report')):
      page.locator(tab).click()
      state=page.locator(region).evaluate('''e=>{
       const panel=e.closest('.cw-panel'),pr=panel.getBoundingClientRect(),er=e.getBoundingClientRect();
       return {visible:er.width>0&&er.height>0,inside:er.left>=pr.left-1&&er.right<=pr.right+1,
         overflow:e.scrollWidth-e.clientWidth,panelOverflow:panel.scrollWidth-panel.clientWidth};
      }''')
      assert state['visible'] and state['inside'] and state['overflow']<=1 and state['panelOverflow']<=1,(mode,width,palette,shape,tab,region,state)
   assert not errors,errors
   page.close()
   print(f'PASS Stage3 {mode} {width}px · palettes/shapes · viewport contracts',flush=True)
 browser.close()
