#!/usr/bin/env python3
"""Compact header stays readable and free of collisions across viewport widths."""
from pathlib import Path
from support.current import VERSION
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CHAT = '11111111-1111-4111-8111-111111111111'
HTML = '''<!doctype html><html><body><main></main><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button data-testid="send-button" type="button">Send</button></form></body></html>'''

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    widths_by_variant={}
    for flavor, width in [('Stable',390),('Stable',1200),('Dev',320),('Dev',390)]:
        p=browser.new_page(viewport={'width':width,'height':750})
        script=(ROOT/'dist'/f'chatgpt-context-watchdog-{VERSION}{".dev" if flavor=="Dev" else ""}.user.js').read_text()
        script=script.replace('(() => {',f"(() => {{\nconst location={{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
        p.set_content(HTML);p.add_script_tag(content=script)
        p.locator('.cw-logo-hit').click()
        p.locator('.cw-handoff-details').click()
        assert p.locator('.cw-toast').is_visible()
        def rect(s): return p.locator(s).bounding_box()
        panel=rect('.cw-panel'); ti=rect('.cw-title-info strong'); tools=rect('.cw-toolbar');local=rect('.cw-local-row');notice=rect('.cw-notice-lane');tabs=rect('.cw-tabs');title=rect('.cw-title')
        # Relative alignment protects the header's meaningful two-row structure
        # without locking it to an incidental 7.5px gap or 2.5px offset.
        title_to_local = local['y'] - (ti['y'] + ti['height'])
        actions_delta = (tools['y'] + tools['height']/2) - (ti['y'] + ti['height']/2)
        assert 0<=title_to_local<=ti['height']/2,(flavor,width,'title-local gap',title_to_local)
        assert abs(actions_delta)<=ti['height']/3,(flavor,width,'action-title alignment',actions_delta)
        # Header title and five action buttons must not share pixels.
        assert ti['x']+ti['width'] <= tools['x']+1,(flavor,width,'title-tools collision',ti,tools)
        # Toast deliberately overlays LOCAL text; do not overlap Pause / Start.
        pause = rect('.cw-pause-toggle')
        toast = rect('.cw-toast')
        assert pause['x']+pause['width'] <= toast['x']+1, (flavor,width,'pause-toast collision',pause,toast)
        assert p.locator('.cw-pause-toggle').evaluate('(e) => {const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest(".cw-pause-toggle")===e;}'), (flavor,width,'pause blocked by toast')
        assert tools['y']+tools['height'] <= tabs['y']+1,(flavor,width,'buttons-tabs')
        assert notice['y']+notice['height'] <= tabs['y']+1,(flavor,width,'notice-tabs')
        assert panel['width']>0 and panel['x']>=-1 and panel['x']+panel['width']<=width+1,(flavor,width,panel)
        widths_by_variant[(flavor,width)]=panel['width']
        if flavor=='Stable' and width==1200:
            assert abs(panel['width']-widths_by_variant[('Stable',390)])<=5,'Stable panel must remain consistent as host widens'
        if flavor=='Dev' and width==320:
            assert panel['width']<widths_by_variant[('Stable',390)]-8,'Dev must adapt materially on narrow viewports'

        initial_height=title['height']
        # A short success notice fits on one line; there is no third reserved row.
        p.locator('.cw-toast').evaluate("e=>e.textContent='Files & images saved.'")
        short_height=rect('.cw-title')['height']
        assert short_height<=initial_height+5,(flavor,width,'short notice must not reserve a third row')
        brand=p.locator('.cw-title-info .cw-brand-mark')
        if brand.evaluate('e=>getComputedStyle(e).display!=="none"'):
            assert brand.bounding_box()['x']+brand.bounding_box()['width'] <= rect('.cw-pin-panel')['x']+1, (flavor,width,'brand mark and first button overlap',brand.bounding_box(),rect('.cw-pin-panel'))
        # The current UI contract keeps the header at two rows. This checks
        # vertical fit; horizontal clipping is audited separately (scrollWidth).
        p.locator('.cw-toast').evaluate("e=>e.textContent='Storage write failed. Back up raw data before resetting the saved Watchdog history.'")
        notice=rect('.cw-notice-lane');tabs=rect('.cw-tabs');title=rect('.cw-title')
        toast=p.locator('.cw-toast')
        assert toast.evaluate('e=>e.scrollHeight<=e.clientHeight+1'),(flavor,width,'vertical clipping')
        assert notice['y']+notice['height']<=tabs['y']+1,(flavor,width,'long-notice overlap')
        assert title['height']>=initial_height,(flavor,width)
        print('PASS',flavor,width,'header',round(initial_height,1),'short',round(short_height,1),'long',round(title['height'],1),'panel',round(panel['width'],1),flush=True)
        p.close()
    browser.close()
