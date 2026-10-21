#!/usr/bin/env python3
""" placement priority below, above, left; never right.

Check full-height vertical fit, left fallback when neither fits, and
vertical scroll fallback when none of the three directions fit.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
from support.current import VERSION
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main></main><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form></body></html>'''
GEO='''() => {
 const r=document.querySelector('[id$="-root"]'),chip=r.querySelector('.cw-chip'),icon=r.querySelector('.cw-site-icon'),panel=r.querySelector('.cw-panel');
 const bounds=e=>{const x=e.getBoundingClientRect();return {left:x.left,right:x.right,top:x.top,bottom:x.bottom,width:x.width,height:x.height}};
 return {root:bounds(r),chip:bounds(chip),icon:bounds(icon),panel:bounds(panel),opened:!panel.hidden,collapsed:r.dataset.cwPanelOpen==='true',maxHeight:getComputedStyle(panel).maxHeight,scrollHeight:panel.scrollHeight};
}'''

def run(browser,variant,width,height,where):
    page=browser.new_page(viewport={'width':width,'height':height})
    page.set_default_timeout(8000)
    errors=[];page.on('pageerror',lambda e: errors.append(str(e)))
    page.set_content(HTML)
    bundle=ROOT/(f'dist/chatgpt-context-watchdog-{VERSION}.dev.user.js' if variant=='Dev' else f'dist/chatgpt-context-watchdog-{VERSION}.user.js')
    script=bundle.read_text().replace('(() => {',f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
    page.add_script_tag(content=script)
    if where!='default':
        page.locator('[id$="-root"]').evaluate('''(r,where)=>{
         const chip=r.querySelector('.cw-chip'),w=window.innerWidth,h=window.innerHeight;
         const x=where.includes('right')?w-chip.getBoundingClientRect().width-9:18;
         const y=where.includes('bottom')?h-chip.getBoundingClientRect().height-9
                 :where.includes('middle')?Math.round(h/2)-chip.getBoundingClientRect().height/2:17;
         r.style.left=`${x}px`;r.style.top=`${y}px`;r.style.right='auto';r.style.bottom='auto';
        }''',where)
    before=page.evaluate(GEO)
    page.locator('.cw-logo-hit').click()
    opened=page.evaluate(GEO)
    assert opened['opened'] and opened['collapsed'],opened
    # Original icon does not move when the right side of the badge disappears.
    for axis in ('left','top'):
        assert abs(opened['icon'][axis]-before['icon'][axis])<=5,(where,axis,before,opened)
    # Place next to the badge, without pinning the gap to exactly 4 CSS px.
    def nearby(gap): return -1 <= gap <= min(24,opened['chip']['height'])
    vertical_overlap = (opened['panel']['top'] <= opened['chip']['bottom']+1 and
                        opened['panel']['bottom'] >= opened['chip']['top']-1)
    horizontal_overlap = (opened['panel']['left'] <= opened['chip']['right']+1 and
                          opened['panel']['right'] >= opened['chip']['left']-1)
    above=nearby(opened['chip']['top']-opened['panel']['bottom']) and horizontal_overlap
    below=nearby(opened['panel']['top']-opened['chip']['bottom']) and horizontal_overlap
    left=nearby(opened['chip']['left']-opened['panel']['right']) and vertical_overlap
    # Below beats above, and left is allowed only when both lack full height.
    if where=='right-middle' and width==1200 and height==500:
        assert left and not below and not above,(variant,width,height,where,opened)
        # Max-height is the space available from this panel's top coordinate.
        if opened['maxHeight'].endswith('px'):
            limit=float(opened['maxHeight'].removesuffix('px'))
            assert 0 < limit <= height-opened['panel']['top']+1,opened
    elif where=='left-middle' and height==500:
        assert (below or above) and not left,(variant,width,height,where,opened)
        assert opened['scrollHeight']>opened['panel']['height']-1,(variant,width,height,where,opened)
    else:
        assert above or below,(variant,width,height,where,opened)
        if where.endswith('top'): assert below,(variant,width,height,where,opened)
        if where.endswith('bottom'): assert above,(variant,width,height,where,opened)
        if where=='right-middle' and height>=1500: assert below,(variant,width,height,where,opened)
    # Align by left icon edge for vertical placements when room allows.
    if not left: assert opened['panel']['left']<=opened['chip']['left']+1,(where,opened)
    assert opened['panel']['left']>=-1,(where,opened)
    # Stable may deliberately be wider than very narrow viewports.
    if opened['panel']['width']<=width+1:
        assert opened['panel']['right']<=width+1,(where,opened)
    # The default bottom-right location must open ABOVE, not sideways.
    if where=='default' and height>=800:
        assert above,(variant,width,height,opened)
    # Icon position and expanded text must be preserved across multiple toggles.
    page.locator('.cw-logo-hit').click()
    closed=page.evaluate(GEO)
    assert not closed['opened'] and not closed['collapsed'] and closed['chip']['width']>opened['chip']['width'],closed
    if where!='right-bottom':
        assert abs(closed['icon']['left']-before['icon']['left'])<=5,(where,before,closed)
    page.locator('.cw-logo-hit').click()
    reopened=page.evaluate(GEO)
    assert reopened['opened'] and reopened['collapsed'],reopened
    assert not errors,errors
    print(f'PASS {variant} {width}x{height} {where}: {"left" if left else "above" if above else "below"}, x={opened["panel"]["left"]:.0f}',flush=True)
    page.close()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    for variant in ('Stable','Dev'):
        for width,height,where in ((1200,900,'default'),(390,900,'default'),
             (1200,900,'left-top'),(1200,900,'right-top'),
             (1200,900,'left-bottom'),(1200,900,'right-bottom'),
             (390,400,'left-bottom'), (1200,1800,'right-middle'),
             (1200,500,'right-middle'), (1200,500,'left-middle'), (390,500,'right-middle')):
            run(browser,variant,width,height,where)
    browser.close()
