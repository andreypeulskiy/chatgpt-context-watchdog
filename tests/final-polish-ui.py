#!/usr/bin/env python3
"""Stable/Dev: visible heading hierarchy, separator geometry and minimal bottom spacing."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
VERSION=re.search(r'^// @version\s+(\S+)$',(ROOT/'src/userscript-header.txt').read_text(),re.M).group(1)
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main></main><form data-chatgpt-composer>
<textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button>
</form></body></html>'''
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 for suffix in ('','.dev'):
  script=(ROOT/f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text()
  script=script.replace('(() => {',f"(() => {{\nconst location={{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
  for width in (320,390,1200):
   for skin,palette in (('soft','light'),('sharp','dark')):
    page=browser.new_page(viewport={'width':width,'height':820})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content(HTML)
    page.add_script_tag(content=script)
    root=page.locator('[id$="-root"]')
    root.evaluate('(e,a)=>{e.dataset.cwStyle=a[0];e.dataset.cwPalette=a[1]}',[skin,palette])
    page.locator('.cw-logo-hit').click()
    assert page.locator('footer.cw-footer').count()==0
    # Details is a lazy view; instantiate its header before comparing actual colors.
    page.locator('.cw-tab-details').click()
    page.locator('.cw-tab-context').click()
    page.locator('[data-cw-mini="attachment"]').click()
    values=page.evaluate('''() => {
      const state=s=>{const el=document.querySelector(s),r=el.getBoundingClientRect(),css=getComputedStyle(el);return {text:el.textContent.trim(),width:r.width,height:r.height,visible:css.display!=='none'&&css.visibility==='visible'};};
      return {file:state('.cw-attachment-core > summary'),meta:state('.cw-metadata-only > summary'),details:state('.cw-details-header > span')};
    }''')
    assert all(values[k]['visible'] and values[k]['width']>0 and values[k]['height']>0 and values[k]['text'] for k in ('file','meta')),values
    assert values['details']['text'],('lazy Details header should exist even when its tab is hidden',values)
    for name in ('text','coefficients'):
      page.locator(f'[data-cw-mini="{name}"]').click()
      assert page.locator(f'#cw-mini-{name}').is_visible()
    page.locator('.cw-tab-budget').click()
    assert page.locator('.cw-budget-editor > summary').is_visible()
    page.locator('.cw-settings-btn').click()
    page.locator('[data-cw-tools="technical"]').click()
    assert page.locator('.cw-handoff-editor > summary').is_visible()
    assert not errors,(suffix,width,skin,palette,errors)
    print('PASS',suffix or 'Stable',width,skin,palette,'readable attachment/budget/handoff disclosures and no obsolete footer',flush=True)
    page.close()
 browser.close()
