from pathlib import Path
import json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
from support.current import VERSION
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><head><meta charset="utf-8"></head><body><main></main><button id="outside">Outside</button><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form></body></html>'''
STATE='''() => { const q=s=>document.querySelector(s); const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom,r:r.right}};const root=q('[id$="-root"]'), panel=q('.cw-panel'),frame=q('.cw-panel-frame'),scrim=q('.cw-settings-scrim');const dialog=[...root.querySelectorAll('dialog')].find(d=>d.open&&!d.inert);const openDialogs=[...root.querySelectorAll('dialog')].filter(d=>d.open).map(d=>d.className);return {root:rect(root),chip:rect(q('.cw-chip')),panel:rect(panel),frame:rect(frame),scrim:rect(scrim),dialog:rect(dialog),dialogOpen:!!dialog,dialogParent:dialog?.parentElement?.className,openDialogs, scrimHidden:scrim.hidden,framePos:getComputedStyle(frame).position,panelPos:getComputedStyle(panel).position,dialogPos:dialog?getComputedStyle(dialog).position:null,scrimPos:getComputedStyle(scrim).position,panelOverflow:getComputedStyle(panel).overflowY, scrimCss:{width:getComputedStyle(scrim).width,height:getComputedStyle(scrim).height}, panelHeight:panel.style.height,panelTop:panel.style.top,panelLeft:panel.style.left,frameTop:frame.style.top,frameLeft:frame.style.left};}'''
def frame(page):page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
def assert_near(a,b,context,tol=3): assert abs(a-b)<=tol,(context,a,b)
def verify_relation(s,what):
 assert s['panelPos']=='relative' and s['framePos']=='absolute' and s['scrimPos']=='absolute', (what,s)
 if s['dialogOpen']:
  assert s['dialogParent']=='cw-panel-frame', (what,s)
  assert s['dialogPos']=='absolute', (what,s)
  assert_near(s['panel']['x'],s['scrim']['x'],what+' scrim x')
  assert_near(s['panel']['y'],s['scrim']['y'],what+' scrim y')
  assert_near(s['panel']['w'],s['scrim']['w'],what+' scrim w')
  assert_near(s['panel']['h'],s['scrim']['h'],what+' scrim h')

def run(browser,variant,width,height):
 page=browser.new_page(viewport={'width':width,'height':height})
 page.set_default_timeout(8500)
 errors=[]
 page.on('pageerror',lambda err:errors.append(str(err)))
 page.set_content(HTML)
 suffix='.dev' if variant=='Dev' else ''
 script=(ROOT/'dist'/f'chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text()
 location=f"const location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};"
 page.add_script_tag(content=script.replace('(() => {','(() => {\n'+location,1))
 # Near bottom so panel opens above, far from left viewport edge on desktop.
 x=400 if width>=1000 else 24; y=height-210
 page.locator('[id$="-root"]').evaluate('(r,p)=>{r.style.left=p[0]+"px";r.style.top=p[1]+"px";r.style.right="auto";r.style.bottom="auto"}',[x,y])
 page.locator('.cw-logo-hit').click()
 page.locator('.cw-settings-btn').click()
 frame(page)
 a=page.evaluate(STATE)
 verify_relation(a,'initial')
 assert a['dialogOpen'] and not a['scrimHidden'],(variant,width,a)
 # Drag with Settings open; all elements must follow during movement, without recompute.
 chip=page.locator('.cw-chip').bounding_box()
 sx,sy=chip['x']+11,chip['y']+11
 page.mouse.move(sx,sy);page.mouse.down();page.mouse.move(sx+24,sy-20,steps=6)
 during=page.evaluate(STATE)
 dx=during['chip']['x']-a['chip']['x'];dy=during['chip']['y']-a['chip']['y']
 assert dx>10 and dy<-10,(variant,width,'drag did not move',a,during)
 for key in ['panel','scrim','dialog']:
  assert_near(during[key]['x']-a[key]['x'],dx, key+' drag dx')
  assert_near(during[key]['y']-a[key]['y'],dy, key+' drag dy')
 verify_relation(during,'mid drag')
 page.mouse.up();frame(page)
 after=page.evaluate(STATE)
 verify_relation(after,'after drag')
 assert after['dialogOpen']
 assert_near(after['dialog']['x']-after['frame']['x'],float(page.locator('.cw-settings-dialog').evaluate('(e)=>parseFloat(e.style.left)')),'local dialog x')
 # Dialog is allowed to extend beyond panel but stays independently scrollable.
 page.locator('[data-cw-tools="technical"]').click();frame(page)
 technical=page.evaluate(STATE);verify_relation(technical,'Technical pane')
 # Settings-specific nested destructive confirmation, no click on OK.
 page.locator('.cw-reset-chat').click();frame(page)
 nested=page.evaluate(STATE)
 assert len(nested['openDialogs'])==2,nested
 assert 'cw-confirm-dialog' in nested['dialogParent'] or nested['dialogParent']=='cw-panel-frame',nested
 verify_relation(nested,'nested confirm')
 page.locator('.cw-cancel-confirm').click();frame(page)
 assert not page.locator('.cw-confirm-dialog').evaluate('(e)=>e.open')
 assert page.locator('.cw-settings-dialog:not(.cw-confirm-dialog)').evaluate('(e)=>e.open')
 # Viewport resize with dialog still open.
 page.set_viewport_size({'width':width,'height':height-90});frame(page)
 resized=page.evaluate(STATE);verify_relation(resized,'resized')
 assert resized['panel']['y']>=-1 and resized['panel']['b']<=height-90+2,(variant,width,'panel escaped viewport',resized)
 # Re-focus closure and next dialog.
 page.locator('.cw-close-settings').click();frame(page)
 assert page.locator('.cw-settings-scrim').evaluate('(e)=>e.hidden')
 page.locator('.cw-about-btn').click();frame(page)
 about=page.evaluate(STATE);verify_relation(about,'About')
 page.locator('.cw-close-about').click()
 page.locator('.cw-logo-hit').click(); assert page.locator('.cw-panel').evaluate('(e)=>e.hidden')
 page.locator('.cw-logo-hit').click();frame(page)
 reopened=page.evaluate(STATE)
 assert not page.locator('.cw-panel').evaluate('(e)=>e.hidden')
 assert_near(reopened['panel']['x'],reopened['frame']['x'],'reopened')
 assert not errors,(variant,width,errors)
 print(json.dumps({'result':'PASS','variant':variant,'viewport':f'{width}x{height}','dragDelta':(round(dx,2),round(dy,2)),'mid_drag_follow':['panel','scrim','dialog'],'nestedConfirm':True,'resize':True,'reopen':True},ensure_ascii=False),flush=True)
 page.close()

with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 try:
  for variant in ('Stable','Dev'):
   for width,height in ((1200,900),(390,800),(320,780)):
    run(browser,variant,width,height)
 finally:browser.close()
