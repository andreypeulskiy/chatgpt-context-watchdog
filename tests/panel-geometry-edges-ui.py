from pathlib import Path
from support.current import VERSION
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
CHAT='11111111-1111-4111-8111-111111111111'
HTML='<!doctype html><html><body><main></main><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button data-testid="send-button" type="button">Send</button></form></body></html>'
for variant in ('Stable','Dev'):
 script=(ROOT/'dist'/(f'chatgpt-context-watchdog-{VERSION}'+('.dev' if variant=='Dev' else '')+'.user.js')).read_text()
 loc=f"const location={{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};"
 script=script.replace('(() => {','(() => {\n'+loc,1)
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  for mode,x,y,viewport,stretch in [('below',35,55,(1200,900),0),('above',25,760,(1200,900),0),('left',900,450,(1200,900),780),('mobile-tight',14,170,(320,470),0)]:
   page=b.new_page(viewport={'width':viewport[0],'height':viewport[1]});page.set_default_timeout(8000)
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.set_content(HTML);page.add_script_tag(content=script)
   root=page.locator('[id$="-root"]')
   root.evaluate('(r,a)=>{r.style.left=a[0]+"px";r.style.top=a[1]+"px";r.style.right="auto";r.style.bottom="auto"}',[x,y])
   if stretch:
    page.locator('.cw-panel-main').evaluate('(e,h)=>e.style.minHeight=h+"px"',stretch)
   page.locator('.cw-logo-hit').click()
   s=page.evaluate('''() => {let p=document.querySelector('.cw-panel'),c=document.querySelector('.cw-chip'),f=document.querySelector('.cw-panel-frame');let box=e=>{let r=e.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom,r.width,r.height]};return {panel:box(p),chip:box(c),frame:box(f)}}''')
   assert s['panel'][0]>=-1 and s['panel'][1]>=-1,(variant,mode,s)
   assert (s['panel'][2]<=viewport[0]+1 or (variant=='Stable' and viewport[0]<350)) and s['panel'][3]<=viewport[1]+1,(variant,mode,s)
   if mode=='below':assert s['panel'][1]>=s['chip'][3]+3,(variant,mode,s)
   if mode=='above':assert s['panel'][3]<=s['chip'][1]-3,(variant,mode,s)
   if mode=='left':assert s['panel'][2]<=s['chip'][0]-3,(variant,mode,s)
   page.locator('.cw-settings-btn').click()
   data=page.evaluate('''() => {let p=document.querySelector('.cw-panel').getBoundingClientRect(), s=document.querySelector('.cw-settings-scrim').getBoundingClientRect(), d=document.querySelector('.cw-settings-dialog').getBoundingClientRect();return {panel:[p.x,p.y,p.width,p.height],scrim:[s.x,s.y,s.width,s.height],dialog:[d.x,d.y,d.right,d.bottom],parent:document.querySelector('.cw-settings-dialog').parentElement.className}}''')
   assert data['parent']=='cw-panel-frame'
   assert all(abs(a-b)<=3 for a,b in zip(data['panel'],data['scrim'])),(variant,mode,'dialog scrim diverged from panel',data)
   assert data['dialog'][0]>=7 and data['dialog'][1]>=7,(variant,mode,data)
   assert data['dialog'][2]<=viewport[0]-7 and data['dialog'][3]<=viewport[1]-7,(variant,mode,data)
   assert not errors,(variant,mode,errors)
   print('PASS',variant,mode,viewport,'panel',tuple(round(q) for q in s['panel'][:4]),'dialog',tuple(round(q) for q in data['dialog']),flush=True)
   page.close()
  b.close()
