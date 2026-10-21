#!/usr/bin/env python3
"""Real pointer/keyboard hit regions of badge with SVG or Watchdog fallback."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
from support.current import VERSION
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main><section data-chatgpt-search-unit-key="test:user" data-chatgpt-search-message-ids="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"><div class="whitespace-pre-wrap">One completed chat message to give the badge its own ledger and a draggable metric.</div></section></main><button id="outside" style="position:fixed;left:0;top:0">Outside</button><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form></body></html>'''

STATE='''() => {const r=document.querySelector('[id$="-root"]'),chip=r.querySelector('.cw-chip'),logo=r.querySelector('.cw-logo-hit'),icon=r.querySelector('.cw-site-icon'),range=r.querySelector('.cw-range'),panel=r.querySelector('.cw-panel');
 const box=e=>{const x=e.getBoundingClientRect();return {x:x.left,y:x.top,right:x.right,bottom:x.bottom,width:x.width,height:x.height}};
 return {open:!panel.hidden,chip:box(chip),icon:box(icon),logo:box(logo),range:box(range),cursor:getComputedStyle(document.elementFromPoint(window.__mx,window.__my)).cursor,alpha:getComputedStyle(logo,'::before').backgroundColor,chipBg:getComputedStyle(chip).backgroundColor,iconSize:getComputedStyle(icon).width};}'''

def run(browser,variant,palette,shape):
 p=browser.new_page(viewport={'width':1200,'height':900})
 p.set_default_timeout(7000)
 errors=[];p.on('pageerror',lambda exc:errors.append(str(exc)))
 p.set_content(HTML)
 # UI-only synthetic about:blank pages have an opaque origin; emulate the
 # normal ChatGPT-origin storage so the unrelated storage-error hint is absent.
 p.evaluate("""() => {
  const data = new Map();
  Object.defineProperty(window, 'localStorage', {configurable: true, value: {
   getItem: k => data.get(String(k)) ?? null,
   setItem: (k,v) => data.set(String(k),String(v)),
   removeItem: k => data.delete(String(k)),
   key: i => [...data.keys()][i] ?? null,
   get length() {return data.size}
  }});
 }""")
 file=ROOT/'dist'/(f'chatgpt-context-watchdog-{VERSION}.dev.user.js' if variant=='Dev' else f'chatgpt-context-watchdog-{VERSION}.user.js')
 content=file.read_text().replace('(() => {',f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
 p.add_script_tag(content=content)
 p.locator('[id$="-root"]').evaluate('''(r,mode)=>{r.dataset.cwPalette=mode[0];r.dataset.cwStyle=mode[1];r.style.left='100px';r.style.top='80px';r.style.right='auto';r.style.bottom='auto'}''',[palette,shape])
 def point(x,y):
  p.mouse.move(x,y)
  p.evaluate('([x,y])=>{window.__mx=x;window.__my=y}',[x,y])
  p.wait_for_timeout(170)
  return p.evaluate(STATE)
 # Full metrics remain draggable but are NOT an opener.
 bounds=p.evaluate('''()=>{const e=document.querySelector('.cw-range').getBoundingClientRect();return [e.right-4,e.top+e.height/2]}''')
 off=point(*bounds)
 assert off['cursor']!='pointer' and not off['open'],off
 p.mouse.click(*bounds)
 assert not p.evaluate(STATE)['open'],('metric unexpectedly toggled',variant,palette,shape)
 # The badge logo remains clickable and stable when the panel opens; its nominal pixels are not a behavioral contract.
 logo=p.locator('.cw-site-icon').bounding_box()
 x,y=logo['x']+logo['width']/2,logo['y']+logo['height']/2
 on=point(x,y)
 assert on['cursor']=='pointer',on
 # Tooltip mirrors the currently shown badge mark (fallback on this fixture).
 if (variant,palette,shape)==('Stable','light','soft'):
  p.wait_for_timeout(560)
  tip=p.evaluate('''() => {
   const hint=document.querySelector('.cw-floating-tip');
   const mark=hint.querySelector('.cw-tip-logo');
   const icon=document.querySelector('.cw-site-icon');
   return {visible:!hint.hidden,text:hint.textContent,
     count:hint.querySelectorAll('.cw-tip-logo').length,
     sameState:!!mark && mark.classList.contains('cw-has-site-logo')===icon.classList.contains('cw-has-site-logo'),
     width:mark && getComputedStyle(mark).width,
     height:mark && getComputedStyle(mark).height,
     aria:document.querySelector('.cw-chip').getAttribute('aria-label')};
  }''')
  assert tip['visible'] and 'open or close the panel' in tip['text'],tip
  assert tip['count']==1 and tip['sameState'],tip
  assert tip['aria']=='Open Watchdog panel',tip
 p.mouse.click(x,y)
 opened=p.evaluate(STATE)
 assert opened['open'] and opened['chip']['width']<off['chip']['width'],opened
 assert abs(opened['icon']['x']-off['icon']['x'])<=5,(off,opened)
 assert abs(opened['icon']['y']-off['icon']['y'])<=5,(off,opened)
 p.locator('.cw-logo-hit').click()
 assert not p.evaluate(STATE)['open']
 # Native keyboard activation on the enclosing button remains possible.
 p.locator('.cw-chip').focus()
 p.keyboard.press('Enter')
 assert p.evaluate(STATE)['open'],('Enter missing',variant,palette,shape)
 p.keyboard.press('Space')
 assert not p.evaluate(STATE)['open'],('Space missing',variant,palette,shape)
 # Drag from a non-clickable metric; release suppresses accidental toggle.
 original=p.evaluate(STATE)
 bx,by=bounds
 p.mouse.move(bx,by)
 p.mouse.down()
 p.mouse.move(bx+90,by+55,steps=8)
 p.mouse.up()
 dragged=p.evaluate(STATE)
 assert not dragged['open'] and dragged['chip']['x']>original['chip']['x']+60,dragged
 p.locator('.cw-logo-hit').click()
 assert p.evaluate(STATE)['open']
 # Pin protects against automatic dismissal, not explicit badge toggling.
 p.locator('.cw-pin-panel').click()
 p.locator('.cw-logo-hit').click()
 assert not p.evaluate(STATE)['open']
 p.locator('.cw-logo-hit').click()
 assert p.evaluate(STATE)['open']
 assert p.locator('.cw-pin-panel').get_attribute('aria-pressed')=='true'
 p.keyboard.press('Escape')
 assert not p.evaluate(STATE)['open']
 assert not errors,errors
 print(f'PASS badge {variant} {palette}/{shape}: logo hover, metric no-op, icon click, keyboard, drag, pin',flush=True)
 p.close()

with sync_playwright() as q:
 browser=q.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for v in ('Stable','Dev'):
  for pal in ('light','dark'):
   for style in ('soft','sharp'):
    run(browser,v,pal,style)
 browser.close()
