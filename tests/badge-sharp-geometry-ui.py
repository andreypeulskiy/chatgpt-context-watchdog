#!/usr/bin/env python3
"""Stable/Dev decorative Sharp bevel, shared focus, Reset/resize full badge anchor."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
from support.current import VERSION
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main><section data-chatgpt-search-unit-key="u:user" data-chatgpt-search-message-ids="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"><div class="whitespace-pre-wrap">A completed user message to confirm the badge has a numeric range.</div></section></main><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form></body></html>'''
GEOMETRY='''() => {const root=document.querySelector('[id$="-root"]'),c=root.querySelector('.cw-chip'),i=root.querySelector('.cw-site-icon'),panel=root.querySelector('.cw-panel');const b=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};return {chip:b(c),icon:b(i),panel:b(panel),open:!panel.hidden,mode:c.dataset.cwBadgeMode,inline:root.getAttribute('style')}}'''

def run(browser, mode, width, palette, shape):
    page=browser.new_page(viewport={'width':width,'height':900})
    page.set_default_timeout(8500)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(HTML)
    page.evaluate('''() => {const data=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k),key:i=>[...data.keys()][i]??null,get length(){return data.size}}})}''')
    file=ROOT/'dist'/f'chatgpt-context-watchdog-{VERSION}{".dev" if mode=="Dev" else ""}.user.js'
    script=file.read_text().replace('(() => {',f"(() => {{\nconst location={{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
    page.add_script_tag(content=script)
    root=page.locator('[id$="-root"]')
    root.evaluate('''(r,values)=>{r.dataset.cwPalette=values[0];r.dataset.cwStyle=values[1];r.style.left='45px';r.style.top='38px';r.style.right='auto';r.style.bottom='auto'}''',[palette,shape])
    initial=page.evaluate(GEOMETRY)
    assert initial['mode']=='normal',initial
    # Changing shape should not jump the badge or hide its interactive control.
    initial_radius=page.locator('.cw-chip').evaluate('el=>parseFloat(getComputedStyle(el).borderTopLeftRadius)')
    root.evaluate('''r=>r.dataset.cwStyle=r.dataset.cwStyle==='sharp'?'soft':'sharp' ''')
    other=page.evaluate(GEOMETRY)
    other_radius=page.locator('.cw-chip').evaluate('el=>parseFloat(getComputedStyle(el).borderTopLeftRadius)')
    # Shape modes stay meaningfully distinguishable without fixing corner radii.
    assert (other_radius>initial_radius+4 if shape=='sharp' else initial_radius>other_radius+4),(mode,width,shape,initial_radius,other_radius)
    for key in ('width','height','left','top'):
        assert abs(initial['chip'][key]-other['chip'][key])<=6,(mode,width,shape,key,initial,other)
    root.evaluate('''(r,s)=>r.dataset.cwStyle=s''',shape)
    # Corners may be retuned by 1–2px; verify center remains hit-testable.
    hit=page.locator('.cw-chip').evaluate('''el=>{const r=el.getBoundingClientRect(),n=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return n===el||el.contains(n)}''')
    assert hit,(mode,width,palette,shape,'badge not hit-testable')
    chip=page.locator('.cw-chip')
    clipped=chip.evaluate('el=>getComputedStyle(el).clipPath')
    assert clipped=='none',(mode,shape,clipped)
    chip.focus()
    assert chip.evaluate('''el=>el.matches(':focus-visible')''')
    focus=chip.evaluate('''el=>({style:getComputedStyle(el).outlineStyle,width:getComputedStyle(el).outlineWidth,offset:getComputedStyle(el).outlineOffset,color:getComputedStyle(el).outlineColor})''')
    assert focus['style'] not in ('none','hidden') and float(focus['width'].removesuffix('px'))>0,(mode,width,palette,shape,focus)
    accent=root.evaluate('''r=>{const e=document.createElement('span');e.style.color='var(--cw-accent)';r.append(e);const c=getComputedStyle(e).color;e.remove();return c}''')
    assert focus['color'] not in ('transparent','rgba(0, 0, 0, 0)'),(mode,width,palette,shape,focus)
    # The selected emblem is visible without a fixed nominal pixel requirement.
    logo=page.locator('.cw-logo-hit')
    logo.click()
    opened=page.evaluate(GEOMETRY)
    assert opened['open'] and opened['icon']['width']>0 and abs(opened['icon']['width']-initial['icon']['width'])<=6,opened
    assert abs(opened['icon']['left']-initial['icon']['left'])<=6,opened
    page.locator('.cw-settings-btn').click()
    page.locator('.cw-reset-position').click()
    reset=page.evaluate(GEOMETRY)
    # Settings and the panel must be moved to the new badge anchor.
    assert reset['open'] and reset['icon']['left']>=-2 and reset['icon']['right']<=width+2,reset
    page.locator('.cw-close-settings').click()
    logo.click()
    closed=page.evaluate(GEOMETRY)
    assert not closed['open'],closed
    for coord in ('left','top'):
        assert abs(closed['icon'][coord]-reset['icon'][coord])<=6,(mode,width,palette,shape,coord,reset,closed)
    right_margin=width-closed['chip']['right']
    assert -1<=right_margin<=min(32,closed['chip']['width']),(mode,width,'reset badge must remain near right viewport edge',closed)
    # Default, not stored position: viewport resize should use the actual
    # stylesheet anchor even while the panel is open and icon-only.
    logo.click()
    assert page.evaluate(GEOMETRY)['open']
    page.set_viewport_size({'width':320,'height':600})
    page.wait_for_function('''() => {const icon=document.querySelector('.cw-site-icon').getBoundingClientRect();return icon.right<=innerWidth && icon.bottom<=innerHeight}''')
    after=page.evaluate(GEOMETRY)
    assert after['open'] and after['icon']['right']<=320 and after['icon']['left']>=0,after
    assert after['icon']['bottom']<=600 and after['icon']['top']>=0,after
    logo.click()
    resized_closed=page.evaluate(GEOMETRY)
    assert not resized_closed['open']
    assert abs(resized_closed['icon']['left']-after['icon']['left'])<=6,(mode,width,palette,shape,after,resized_closed)
    # Reverting to regular closed mode restores the responsive default.
    final_margin=320-resized_closed['chip']['right']
    assert -1<=final_margin<=min(32,resized_closed['chip']['width']),(mode,width,resized_closed)
    assert not errors,errors
    print(f'PASS badge geometry {mode} {width}px {palette}/{shape}: real hitbox, visible focus, reset, resize',flush=True)
    page.close()


def saved_near_edge(browser, mode, width, shape):
    page=browser.new_page(viewport={'width':width,'height':750})
    page.set_default_timeout(8000)
    page.set_content(HTML)
    page.evaluate('''(position,style) => {const data=new Map([["cgpt-context-watchdog:settings:v1",JSON.stringify({badgePosition:{left:position,top:110},viewStyle:style})]]);Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k),key:i=>[...data.keys()][i]??null,get length(){return data.size}}})}''',[width-30,shape])
    file=ROOT/'dist'/f'chatgpt-context-watchdog-{VERSION}{".dev" if mode=="Dev" else ""}.user.js'
    script=file.read_text().replace('(() => {',f"(() => {{\nconst location={{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
    page.add_script_tag(content=script)
    full=page.evaluate(GEOMETRY)
    assert full['chip']['right']<=width+.2 and full['chip']['left']>=0,(mode,width,shape,full)
    page.locator('.cw-logo-hit').click()
    assert page.evaluate(GEOMETRY)['open']
    page.locator('.cw-logo-hit').click()
    assert page.evaluate(GEOMETRY)['chip']['right']<=width+.2,(mode,width,shape,page.evaluate(GEOMETRY))
    # Real DOM remount without esbuild-specific injected hooks.
    page.evaluate('document.getElementById("cgpt-context-watchdog-root").remove()')
    page.wait_for_function('!!document.getElementById("cgpt-context-watchdog-root")')
    remounted=page.evaluate(GEOMETRY)
    assert remounted['chip']['right']<=width+.2 and remounted['chip']['left']>=0,(mode,width,shape,remounted)
    print(f'PASS saved edge {mode} {width}px {shape}: full badge stays within viewport',flush=True)
    page.close()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    for mode in ('Stable','Dev'):
        for width in (320,390,1200):
            for palette in ('light','dark'):
                for shape in ('soft','sharp'):
                    run(browser,mode,width,palette,shape)
            for shape in ('soft','sharp'):
                saved_near_edge(browser,mode,width,shape)
    browser.close()
