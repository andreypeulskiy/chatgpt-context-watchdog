#!/usr/bin/env python3
"""About/Help semantics, copy accuracy, native keyboard control and viewport fit."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from support.current import VERSION

ROOT=Path(__file__).resolve().parents[1]
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main></main><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form></body></html>'''

def check(browser, suffix, width, height):
    page=browser.new_page(viewport={'width':width,'height':height})
    page.set_default_timeout(7000)
    errors=[]
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(HTML)
    page.evaluate('''() => {const data=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k),key:i=>[...data.keys()][i]??null,get length(){return data.size}}})}''')
    source=(ROOT/'dist'/f'chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text()
    route=f"{{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}}"
    page.add_script_tag(content=source.replace('(() => {',f'(() => {{\nconst location={route};',1))
    page.locator('.cw-logo-hit').click()
    page.locator('.cw-tab-details').click()
    page.locator('.cw-about-btn').click()
    about=page.locator('.cw-about-dialog')
    assert about.evaluate('e=>e.open')
    assert about.get_attribute('aria-labelledby')=='cw-about-heading'
    details=about.locator('details')
    assert details.count()==9,details.count()  # 3 top-level + 6 help sections
    assert all(details.evaluate_all('nodes=>nodes.map(n=>n.classList.contains("cw-disclosure"))'))
    privacy=about.locator('details.cw-about-section').first
    terms=about.locator('details.cw-about-terms')
    assert not privacy.evaluate('e=>e.open') and not terms.evaluate('e=>e.open')
    # Native summary keyboard behavior: Space and Enter, without custom JS listeners.
    psummary=privacy.locator(':scope > summary')
    psummary.focus();page.keyboard.press('Space')
    assert privacy.evaluate('e=>e.open')
    txt=privacy.inner_text()
    import re
    for semantic in (r'numeric estimates', r'Full message text.{0,100}not saved',
                     r'HANDOFF.{0,90}(stored|saved)',r'only-if-cached|cache-only',
                     r'not measurements|not a measured'):
        assert re.search(semantic,txt,re.I|re.S),(semantic,txt)
    tsummary=terms.locator(':scope > summary')
    tsummary.focus();page.keyboard.press('Enter')
    assert terms.evaluate('e=>e.open')
    main=terms.locator('.cw-about-section').first
    assert main.evaluate('e=>e.open')
    # All native Help disclosures remain readable when expanded and viewport-limited.
    for item in terms.locator('.cw-about-section').all():
        if not item.evaluate('e=>e.open'): item.locator(':scope > summary').click()
    content=terms.inner_text()
    for semantic in (r'badge.{0,110}(closed|open|panel)',
                     r'(Details|per-chat).{0,100}estimat',
                     r'without reloading|no page reload',
                     r'badge.{0,120}(stays in place|position)',
                     r'visible.{0,50}messages.{0,60}(collected again|recaptured)'):
        assert re.search(semantic,content,re.I|re.S),(semantic,content[-1200:])
    page.wait_for_timeout(100)
    geom=about.evaluate('''e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:e.scrollHeight,client:e.clientHeight}}''')
    assert geom['left']>=-0.5 and geom['right']<=width+0.5,(width,geom)
    assert geom['top']>=-0.5 and geom['bottom']<=height+0.5,(height,geom)
    assert geom['scroll']>geom['client'],geom
    # Credits can be scrolled into view and the close control remains reachable.
    credits=about.locator('.cw-about-credit-section')
    credits.scroll_into_view_if_needed()
    assert credits.is_visible()
    assert about.locator('.cw-close-about').is_visible()
    psummary.focus();page.keyboard.press('Space')
    assert not privacy.evaluate('e=>e.open')
    page.locator('.cw-close-about').click()
    assert not about.evaluate('e=>e.open')
    assert page.locator('.cw-about-btn').evaluate('e=>document.activeElement===e')
    page.locator('.cw-about-btn').click()
    assert terms.evaluate('e=>e.open') and not privacy.evaluate('e=>e.open')
    assert main.evaluate('e=>e.open')
    assert details.count()==9, 'Help duplicated across opens'
    page.keyboard.press('Escape')
    assert not about.evaluate('e=>e.open')
    assert not errors,errors
    print(f'PASS About/Help {"Stable" if not suffix else "Dev"} {width}x{height}: content, keyboard, scroll, state',flush=True)
    page.close()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    for suffix in ('','.dev'):
        for width,height in ((320,480),(390,620),(1200,900)):
            check(browser,suffix,width,height)
    browser.close()
