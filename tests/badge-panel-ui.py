#!/usr/bin/env python3
"""Badge/panel behavior, live budget rendering and semantic help in Stable/Dev."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
from support.current import VERSION
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main><section data-chatgpt-search-unit-key="u-badge:user" data-chatgpt-search-message-ids="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"><div class="whitespace-pre-wrap">A completed user message with enough visible text to confirm the badge has a committed metric.</div></section></main><button id="outside" type="button" style="position:fixed;left:0;bottom:0">Outside</button><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form></body></html>'''
SCRIPT_FILES=[ROOT/f'dist/chatgpt-context-watchdog-{VERSION}.user.js',ROOT/f'dist/chatgpt-context-watchdog-{VERSION}.dev.user.js']
GEOMETRY='''() => {
 const root=document.querySelector('[id$="-root"]');
 const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
 const chip=root.querySelector('.cw-chip'),panel=root.querySelector('.cw-panel');
 return {chip:rect(chip),mark:rect(root.querySelector('.cw-site-icon')),
   panel:rect(panel),collapsed:root.dataset.cwPanelOpen==='true',
   range:getComputedStyle(chip.querySelector('.cw-range')).display,
   visible:!panel.hidden};
}'''

def run(browser,mode,file,width):
 page=browser.new_page(viewport={'width':width,'height':900})
 page.set_default_timeout(8000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(HTML)
 # A normal ChatGPT origin has working localStorage; about:blank does not.
 page.evaluate("""() => {
  const data=new Map();
  Object.defineProperty(window,'localStorage',{configurable:true,value:{
    getItem:k=>data.get(String(k))??null,
    setItem:(k,v)=>data.set(String(k),String(v)),
    removeItem:k=>data.delete(String(k)),
    key:i=>[...data.keys()][i]??null,
    get length(){return data.size}
  }});
 }""")
 code=file.read_text().replace('(() => {',f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
 page.add_script_tag(content=code)
 # Explicit saved-like location for the screenshot scenario: near top-left.
 page.locator('[id$="-root"]').evaluate('r=>{r.style.left="18px";r.style.top="17px";r.style.right="auto";r.style.bottom="auto"}')
 before=page.evaluate(GEOMETRY)
 assert not before['collapsed'] and before['visible']==False and before['range']!='none',before
 for palette in ('light','dark'):
  for shape in ('soft','sharp'):
   page.locator('[id$="-root"]').evaluate('(r,v)=>{r.dataset.cwPalette=v[0];r.dataset.cwStyle=v[1]}',[palette,shape])
   before=page.evaluate(GEOMETRY)
   page.locator('.cw-logo-hit').click()
   opened=page.evaluate(GEOMETRY)
   assert opened['visible'] and opened['collapsed'],opened
   assert opened['range']=='none',('numeric metric must collapse with panel',opened)
   # A storage warning must be visually suppressed while the panel is open
   # even if its own hidden attribute is removed (real failure condition).
   if palette=='light' and shape=='soft':
    indicator=page.locator('.cw-storage-indicator')
    assert indicator.count()==1
    was_hidden=indicator.evaluate('e=>e.hidden')
    indicator.evaluate('e=>{e.hidden=false}')
    result=indicator.evaluate('e=>getComputedStyle(e).display')
    assert result=='none',('storage warning leaked onto open badge',result)
    indicator.evaluate('(e,hidden)=>{e.hidden=hidden}',was_hidden)
   assert opened['range']=='none' and abs(opened['mark']['width']-before['mark']['width'])<=5,opened
   assert abs(opened['mark']['left']-before['mark']['left'])<=5,(before,opened)
   assert abs(opened['mark']['top']-before['mark']['top'])<=5,(before,opened)
   assert abs(opened['panel']['left']-opened['chip']['left'])<=6,opened
   gap=opened['panel']['top']-opened['chip']['bottom']
   assert -1<=gap<=min(24,opened['chip']['height']),('panel must open adjacent to badge',opened)
   assert opened['chip']['width']>0 and opened['chip']['height']>0,opened
   # Details: visible report, readable caption, enabled Copy action, not a pixel font contract.
   page.locator('.cw-tab-details').click()
   detail=page.evaluate('''() => {
     const r=document.querySelector('[id$="-root"]'),h=r.querySelector('.cw-details-header > span'),
           report=r.querySelector('.cw-details-report'),copy=r.querySelector('.cw-copy-details');
     return {caption:h.textContent.trim(),headingHeight:h.getBoundingClientRect().height,
       reportWidth:report.getBoundingClientRect().width,reportHeight:report.getBoundingClientRect().height,
       reportOverflow:report.scrollWidth-report.clientWidth,copyVisible:copy.getBoundingClientRect().width>0,
       copyDisabled:copy.disabled};
   }''')
   assert detail['caption'] and detail['headingHeight']>0 and detail['reportWidth']>0,detail
   assert detail['reportHeight']>0 and detail['reportOverflow']<=1,detail
   assert detail['copyVisible'] and not detail['copyDisabled'],detail
   page.locator('.cw-tab-budget').click()
   bars=page.evaluate('''() => [...document.querySelectorAll('.cw-progress-track')].map(e=>{
     const p=e.querySelector('.cw-progress-percent'),f=e.querySelector('.cw-progress-fill');
     const pr=p.getBoundingClientRect(),tr=e.getBoundingClientRect(),fr=f.getBoundingClientRect();
     return {value:p.textContent.trim(),trackHeight:tr.height,trackWidth:tr.width,
       percentHeight:pr.height,percentLeft:pr.left,percentRight:pr.right,
       trackLeft:tr.left,trackRight:tr.right,fillWidth:fr.width,overflow:e.scrollWidth-e.clientWidth};
   })''')
   assert len(bars)==6,bars
   for bar in bars:
    assert re.fullmatch(r'\d+%',bar['value']),bar
    assert bar['trackHeight']>0 and bar['trackWidth']>0 and bar['percentHeight']>0,bar
    assert bar['trackLeft']-1<=bar['percentLeft'] and bar['percentRight']<=bar['trackRight']+1,bar
    assert 0<=bar['fillWidth']<=bar['trackWidth']+1 and bar['overflow']<=1,bar
   page.locator('.cw-about-btn').click()
   about=page.locator('.cw-about-dialog')
   assert about.evaluate('e=>e.open')
   page.locator('.cw-about-terms > summary').click() if page.locator('.cw-about-terms > summary').count() and not page.locator('.cw-about-terms').evaluate('e=>e.open') else None
   glossary=page.locator('.cw-about-glossary')
   assert glossary.count()==1 and glossary.is_visible()
   entries=glossary.evaluate('''e=>[...e.querySelectorAll('dt')].map(term=>({name:term.textContent.trim(),
     explanation:term.nextElementSibling?.textContent.trim()||''}))''')
   assert len(entries)>=20 and all(e['name'] and e['explanation'] for e in entries),entries
   sections={e['name']:e['explanation'] for e in entries}
   # These are user-facing facts, not literal old sentences from b16 About.
   assert 'Mini badge and open panel' in sections
   badge_help=sections['Mini badge and open panel'].lower()
   assert all(x in badge_help for x in ('drag','pin','below','above','left','never right','yellow','red')),badge_help
   assert 'Token budget & limits' in sections
   limits=sections['Token budget & limits'].lower()
   assert re.search(r'\bestimat(?:e|ed|es)\b',limits),limits
   assert '100%' in limits and 'budget' in limits,limits
   # Safety-critical distinction: reported ChatGPT limits must not be presented as measurements.
   assert re.search(r'\bnot\s+(?:actual\s+)?chatgpt[- ]reported\s+limits\b',limits),limits
   assert 'History & calibration' in sections
   calibration=sections['History & calibration'].lower()
   assert 'sample' in calibration and 'token' in calibration and 'calibration' in calibration,calibration
   assert 'Optimistic / Pessimistic' in sections
   optimistic=sections['Optimistic / Pessimistic'].lower()
   assert 'heuristic' in optimistic and 'not a measured' in optimistic,optimistic
   page.locator('.cw-close-about').click()
   # Unpinned badge click closes and restores complete metric at same mark x/y.
   page.locator('.cw-logo-hit').click()
   closed=page.evaluate(GEOMETRY)
   assert not closed['visible'] and not closed['collapsed'] and closed['range']!='none',closed
   assert abs(closed['mark']['left']-before['mark']['left'])<=5 and abs(closed['mark']['top']-before['mark']['top'])<=5,(before,closed)
 # Pin blocks outside clicks, but the badge is an explicit toggle.
 page.locator('.cw-logo-hit').click()
 page.locator('.cw-pin-panel').click()
 page.locator('#outside').click(force=True)
 assert page.evaluate(GEOMETRY)['collapsed']
 page.locator('.cw-logo-hit').click()
 assert not page.evaluate(GEOMETRY)['collapsed']
 page.locator('.cw-logo-hit').click()
 assert page.evaluate(GEOMETRY)['collapsed']
 assert page.locator('.cw-pin-panel').get_attribute('aria-pressed')=='true'
 # Explicit Escape also dismisses a pinned panel.
 page.keyboard.press('Escape')
 assert not page.evaluate(GEOMETRY)['collapsed']
 # Drag collapsed icon, then finish without triggering accidental click.
 page.locator('.cw-logo-hit').click()
 rect=page.evaluate(GEOMETRY)['chip']
 page.mouse.move(rect['left']+12,rect['top']+12)
 page.mouse.down()
 page.mouse.move(rect['left']+85,rect['top']+62,steps=6)
 page.mouse.up()
 moved=page.evaluate(GEOMETRY)
 assert moved['collapsed'] and moved['chip']['left']>rect['left']+50 and moved['chip']['top']>rect['top']+30,moved
 assert moved['panel']['right']<=width+2 and moved['panel']['left']>=-2,moved
 assert abs(moved['panel']['left']-min(moved['chip']['left'],width-moved['panel']['width']-8))<=8,moved
 page.locator('.cw-pin-panel').click()
 page.locator('#outside').click(force=True)
 assert not page.evaluate(GEOMETRY)['collapsed']
 assert not errors,errors
 print(f'PASS {mode} {width}px Light/Dark Soft/Sharp · badge behavior, meaningful Help, Details, budgets, Pin, drag',flush=True)
 page.close()

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for mode,file in [('Stable',SCRIPT_FILES[0]),('Dev',SCRIPT_FILES[1])]:
  for width in (390,1200):run(browser,mode,file,width)
 browser.close()
