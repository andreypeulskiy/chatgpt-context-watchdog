#!/usr/bin/env python3
"""Verify circular geometry, target/cursor/blue icon, no background hover, drag and click."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
from support.current import VERSION
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main></main><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form></body></html>'''
STATE='''p => {
 const root=document.querySelector('[id$="-root"]'), chip=root.querySelector('.cw-chip'), logo=root.querySelector('.cw-logo-hit'), icon=root.querySelector('.cw-site-icon');
 const loc=chip.getBoundingClientRect(),i=icon.getBoundingClientRect(),a=document.elementFromPoint(p[0],p[1]);
 const cs=getComputedStyle(logo,'::before');
 return {open:!root.querySelector('.cw-panel').hidden,cursor:getComputedStyle(a).cursor,hover:logo.matches(':hover'),
  logoInk:(()=>{const path=icon.querySelector('.cw-watchdog-svg > path');return path?getComputedStyle(path).fill:null})(),iconWidth:i.width,iconHeight:i.height,
  x:i.left+i.width/2,y:i.top+i.height/2,badgeHeight:loc.height,
  pseudoW:parseFloat(cs.width),pseudoH:parseFloat(cs.height),clip:cs.clipPath,
  pseudobg:cs.backgroundColor,badgeBg:getComputedStyle(chip).backgroundColor,
  sharpBack:getComputedStyle(chip,'::after').backgroundColor};
}'''

def run(browser,variant,palette,shape):
 page=browser.new_page(viewport={'width':1200,'height':900})
 page.set_default_timeout(7000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(HTML)
 script=ROOT/'dist'/(f'chatgpt-context-watchdog-{VERSION}.dev.user.js' if variant=='Dev' else f'chatgpt-context-watchdog-{VERSION}.user.js')
 content=script.read_text().replace('(() => {',f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
 page.add_script_tag(content=content)
 page.locator('[id$="-root"]').evaluate('''(r,opt)=>{r.dataset.cwPalette=opt[0];r.dataset.cwStyle=opt[1];r.style.left='90px';r.style.top='90px';r.style.right='auto';r.style.bottom='auto'}''',[palette,shape])
 icon=page.locator('.cw-site-icon').bounding_box();x,y=icon['x']+icon['width']/2,icon['y']+icon['height']/2
 def move(px,py):
  page.mouse.move(px,py)
  page.wait_for_timeout(180)
  return page.evaluate(STATE,[px,py])
 # Out-of-target circle points keep a grab cursor, no halo and original icon.
 outside=move(x+55,y)
 radius=outside['pseudoW']/2
 assert outside['pseudoW'] > 0 and abs(outside['pseudoW']-outside['pseudoH']) <= .15*outside['pseudoW'],outside
 for dx,dy in ((radius*.8,radius*.8),(radius*.8,-radius*.8)):
  off=move(x+dx,y+dy)
  assert not off['hover'] and off['cursor']!='pointer',('outside circle',dx,dy,off)
  assert off['logoInk']==outside['logoInk'],off
  page.mouse.click(x+dx,y+dy)
  assert not page.evaluate(STATE,[x+dx,y+dy])['open'],('clicked outside circle',dx,dy)
 for dx,dy in ((0,0),(radius*.87,0),(-radius*.87,0),(0,radius*.87),(0,-radius*.87),(radius*.53,radius*.53)):
  on=move(x+dx,y+dy)
  assert on['hover'] and on['cursor']=='pointer',('inside circle',dx,dy,on)
  assert on['logoInk']!=outside['logoInk'],('logo failed to turn blue',on,outside)
  page.mouse.click(x+dx,y+dy)
  assert page.evaluate(STATE,[x+dx,y+dy])['open'],('did not open inside circle',dx,dy)
  page.mouse.click(x,y)
  assert not page.evaluate(STATE,[x,y])['open'],('did not close',dx,dy)
 assert not errors,errors
 print(f'PASS circular {variant} {palette}/{shape}: correct circular click region and hover feedback',flush=True)
 page.close()

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for variant in ('Stable','Dev'):
  for palette in ('light','dark'):
   for shape in ('soft','sharp'):
    run(browser,variant,palette,shape)
 browser.close()
