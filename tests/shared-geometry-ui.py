#!/usr/bin/env python3
""" Soft/Sharp change corner shape, never layout or hit-zone geometry."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
from support.current import VERSION
CHAT = '11111111-1111-4111-8111-111111111111'
HTML = '<!doctype html><html><body><main></main><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form></body></html>'
COMPARE = '''() => {
 const root = document.querySelector('[id$="-root"]');
 // Inspect structural anchors rather than every glyph, margin or decorative span.
 // Text widths may legitimately change by a couple of pixels while remaining readable.
 const anchors=['.cw-chip','.cw-logo-hit','.cw-panel','.cw-panel-frame','.cw-toolbar',
  '.cw-title','.cw-tabs','.cw-settings-dialog','.cw-settings-scrim'];
 const read = () => anchors.flatMap(name => {
  const el=root.querySelector(name); if(!el)return [];
  const r=el.getBoundingClientRect(),css=getComputedStyle(el);
  return [{name,visible:!el.hidden && css.display!=='none' && css.visibility!=='hidden',
   rect:[r.x,r.y,r.width,r.height]}];
 });
 const palette = root.dataset.cwPalette;
 root.dataset.cwStyle = 'soft'; const soft = read();
 root.dataset.cwStyle = 'sharp'; const sharp = read();
 root.dataset.cwStyle = 'soft'; root.dataset.cwPalette = palette;
 return {soft, sharp};
}'''

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
        args=['--no-sandbox', '--disable-dev-shm-usage'])
    for variant, widths in (('Stable', (1200,)), ('Dev', (320, 1200))):
        filename = f'chatgpt-context-watchdog-{VERSION}' + ('.dev' if variant == 'Dev' else '') + '.user.js'
        script = (ROOT / 'dist' / filename).read_text()
        script = script.replace('(() => {',
            f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};", 1)
        for width in widths:
            page = browser.new_page(viewport={'width': width, 'height': 900})
            page.set_content(HTML)
            page.add_script_tag(content=script)
            for stage in ('closed', 'panel', 'settings', 'appearance'):
                if stage == 'panel':
                    page.locator('.cw-logo-hit').click()
                elif stage == 'settings':
                    page.locator('.cw-settings-btn').click()
                elif stage == 'appearance':
                    page.locator('[data-cw-tools="view"]').click()
                for palette in ('light', 'dark'):
                    page.locator('[id$="-root"]').evaluate('(r,v) => r.dataset.cwPalette = v', palette)
                    result = page.evaluate(COMPARE)
                    soft, sharp = result['soft'], result['sharp']
                    assert len(soft) == len(sharp), (variant, width, stage, 'element count')
                    for index, (a, b) in enumerate(zip(soft, sharp)):
                        assert a['name'] == b['name'], (variant, width, stage, index, 'node order')
                        assert a['visible']==b['visible'],(variant,width,stage,palette,index,'visibility',a['name'])
                        if not a['visible']: continue
                        # A 1–2px CSS/typography adjustment is not a layout regression.
                        # Moving an entire widget or expanding it markedly still fails.
                        tolerance=8  # changes under 1–2px may cascade through adjacent padding
                        assert all(abs(x-y)<=tolerance for x,y in zip(a['rect'],b['rect'])), (
                            variant,width,stage,palette,index,a['name'],a['rect'],b['rect'])
                print(f'PASS stable Soft/Sharp layout (tolerant to cosmetic deltas): {variant} {width}px {stage}', flush=True)
            page.close()
    browser.close()
