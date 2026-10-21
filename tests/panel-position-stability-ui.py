#!/usr/bin/env python3
"""Panel geometry is external; tab changes/long content must not move it."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from support.current import VERSION

ROOT=Path(__file__).resolve().parents[1]
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main></main><button id="outside">Outside</button>
<form data-chatgpt-composer><textarea id="prompt-textarea"></textarea>
<button type="button" data-testid="send-button">Send</button></form></body></html>'''
GEOM='''() => {
 const p=document.querySelector('.cw-panel'),c=document.querySelector('.cw-chip');
 const box=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,bottom:r.bottom,right:r.right,width:r.width,height:r.height}};
 return {panel:box(p),chip:box(c),scrollHeight:p.scrollHeight,clientHeight:p.clientHeight,
   top:p.style.top,left:p.style.left,maxHeight:p.style.maxHeight,hidden:p.hidden};
}'''
def snapshot(page):
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
    return page.evaluate(GEOM)
def stable(page,anchor,stage):
    state=snapshot(page)
    assert not state['hidden'],(stage,state)
    for axis in ('top','left'):
        assert abs(state['panel'][axis]-anchor['panel'][axis])<=1,(stage,axis,anchor,state)
    assert state['top']==anchor['top'] and state['left']==anchor['left'],(stage,anchor,state)
    return state

def run(browser,variant,width,height):
    page=browser.new_page(viewport={'width':width,'height':height})
    page.set_default_timeout(9000)
    errors=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.set_content(HTML)
    script=ROOT/'dist'/f'chatgpt-context-watchdog-{VERSION}{".dev" if variant=="Dev" else ""}.user.js'
    source=script.read_text()
    location=f"const location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};"
    page.add_script_tag(content=source.replace('(() => {','(() => {\n'+location,1))
    x,y=(60,500) if width>=1000 else (24,390)
    page.locator('[id$="-root"]').evaluate('''(r,xy)=>{r.style.left=xy[0]+'px';r.style.top=xy[1]+'px';r.style.right='auto';r.style.bottom='auto';}''',[x,y])
    page.locator('.cw-logo-hit').click()
    initial=snapshot(page)
    assert not initial['hidden']
    for name,selector in [('Budget','.cw-tab-budget'),('History','[data-cw-budget="history"]'),
        ('Details','.cw-tab-details'),('Context','.cw-tab-context'),('Text','[data-cw-mini="text"]'),
        ('Coefficients','[data-cw-mini="coefficients"]'),('Budget again','.cw-tab-budget'),
        ('Limits','[data-cw-budget="limits"]')]:
        page.locator(selector).first.click()
        stable(page,initial,name)
    page.locator('.cw-budget-editor > summary').click()
    stable(page,initial,'Budget editor open')
    page.locator('.cw-budget-editor > summary').click()
    stable(page,initial,'Budget editor close')
    page.locator('.cw-settings-btn').click()
    assert page.locator('.cw-settings-dialog').evaluate('(e)=>e.open')
    stable(page,initial,'Settings open')
    page.locator('.cw-close-settings').click()
    stable(page,initial,'Settings close')
    page.locator('.cw-about-btn').click()
    assert page.locator('.cw-about-dialog').evaluate('(e)=>e.open')
    stable(page,initial,'About open')
    page.locator('.cw-close-about').click()
    stable(page,initial,'About close')
    page.locator('.cw-budget-limits').evaluate('(e)=>{e.style.minHeight="1500px"}')
    page.locator('.cw-tab-budget').click()
    expanded=stable(page,initial,'Long content')
    assert expanded['scrollHeight']>expanded['clientHeight']+30,expanded
    # Identify an above-badge panel by its actual geometry; the cosmetic
    # gap is not necessarily four CSS pixels across future themes.
    above_gap=initial['chip']['top']-initial['panel']['bottom']
    above=-1<=above_gap<=min(24,initial['chip']['height'])
    if above:
        assert expanded['panel']['bottom']<=expanded['chip']['top']+1,expanded
    page.locator('.cw-budget-limits').evaluate('(e)=>{e.style.minHeight=""}')
    stable(page,initial,'Content shrinks')
    chip=page.locator('.cw-chip').bounding_box()
    page.mouse.move(chip['x']+12,chip['y']+12)
    page.mouse.down()
    page.mouse.move(chip['x']+80,chip['y']-45,steps=8)
    page.mouse.up()
    moved=snapshot(page)
    assert abs(moved['chip']['left']-initial['chip']['left'])>25,(initial,moved)
    stable(page,moved,'Badge drag')
    smaller=height-100
    page.set_viewport_size({'width':width,'height':smaller})
    resized=snapshot(page)
    assert resized['panel']['top']>=-1,resized
    assert resized['panel']['bottom']<=smaller+1,resized
    stable(page,resized,'Viewport resize')
    page.locator('.cw-logo-hit').click()
    assert page.locator('.cw-panel').evaluate('(e)=>e.hidden')
    page.locator('.cw-logo-hit').click()
    reopened=snapshot(page)
    stable(page,reopened,'Reopen')
    assert not errors,errors
    print(f'PASS Stable position {variant} {width}x{height}: tabs, dialogs, scroll, drag, resize, reopen',flush=True)
    page.close()

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
        args=['--no-sandbox','--disable-dev-shm-usage'])
    for variant in ('Stable','Dev'):
        for width,height in ((320,800),(390,800),(1200,900)):
            run(browser,variant,width,height)
    browser.close()
