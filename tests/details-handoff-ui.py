#!/usr/bin/env python3
""" installed offline userscript: Details metrics and global HANDOFF draft lifecycle."""
from playwright.sync_api import sync_playwright
from support.current import SCRIPT

CHAT='11111111-1111-4111-8111-111111111111'
MSG='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
HTML=f'''<!doctype html><html><body><main>
<section data-chatgpt-search-unit-key="unit1:user" data-chatgpt-search-message-ids="{MSG}">
<div class="whitespace-pre-wrap">Finished content with some useful context tokens. A second sentence.</div></section>
</main><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button></form></body></html>'''
INIT='''() => {
  const data = new Map();
  window.__failSettings = false;
  Object.defineProperty(window,'localStorage',{configurable:true,value:{
    getItem:k=>data.get(String(k))??null,
    setItem:(k,v)=>{ if(window.__failSettings && String(k).includes('settings:v1')) throw Error('storage unavailable'); data.set(String(k),String(v)) },
    removeItem:k=>data.delete(String(k)), key:i=>[...data.keys()][i]??null,
    get length(){return data.size}
  }});
  window.__copiedDetails = null;
  Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
    writeText: async text => {window.__copiedDetails = text;}
  }});
  window.confirm=()=>{throw Error('Native confirm must not be used')};
}'''
INJECTED=SCRIPT.replace('(() => {',
    f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
PREFIX='cgpt-context-watchdog:settings:v1'

with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  for width in (320,390,1200):
    page=browser.new_page(viewport={'width':width,'height':850})
    page.set_default_timeout(8000)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(HTML)
    page.evaluate(INIT)
    page.add_script_tag(content=INJECTED)
    page.locator('.cw-logo-hit').click()
    page.locator('.cw-tab-details').click()
    details=page.locator('.cw-details-report')
    assert details.locator('.cw-detail-group').count()==5
    lines=details.inner_text()
    assert 'Messages:' in lines and 'other' in lines
    assert 'Sampled:' in lines
    assert 'Effective images:' in lines
    assert 'Files:' in lines and 'Hidden context:' in lines
    assert 'Conservative:' in lines and 'Estimated usage / context budget.' in lines
    assert 'Status:' not in lines and 'healthy' not in lines.lower()
    assert 'none' in lines  # No file size available.
    page.locator('.cw-copy-details').click()
    page.wait_for_function('window.__copiedDetails !== null')
    copy=page.evaluate('window.__copiedDetails')
    assert copy=='\n\n'.join('\n'.join(g.locator(':scope > div:not(.cw-detail-legend)').all_inner_texts()) for g in [details.locator('.cw-detail-group').nth(i) for i in range(5)])
    assert 'Parsed file estimate is weighted' not in copy
    assert 'Estimated usage / context budget.' not in copy
    assert all(term in copy for term in ('Messages:', 'Parsed file estimate:', 'Effective images:', 'Total context:', 'Conservative:'))
    page.locator('.cw-settings-btn').click()
    settings=page.locator('.cw-settings-dialog:not(.cw-confirm-dialog):not(.cw-about-dialog):not(.cw-limit-dialog)')
    assert settings.locator('[data-cw-tools="view"]').inner_text()=='Appearance'
    settings.locator('[data-cw-tools="technical"]').click()
    details_editor=settings.locator('.cw-handoff-editor')
    field=details_editor.locator('.cw-handoff-prompt')
    assert not details_editor.evaluate('(e)=>e.open')
    assert not details_editor.locator('.cw-handoff-unsaved').is_visible()
    details_editor.locator('summary').click()
    original=field.input_value()
    assert original.strip() and len(original)<=4000
    assert details_editor.locator('.cw-handoff-counter').inner_text()==f'{len(original)} / 4000'
    new=' custom persistent prompt: preserve the exact technical state.'
    field.fill(new)
    assert details_editor.locator('.cw-handoff-unsaved').is_visible()
    # The textarea belongs to the dialog's focus trap. Tab should move to
    # the adjacent Save action, not jump back to the first dialog control.
    field.focus()
    page.keyboard.press('Tab')
    assert details_editor.locator('.cw-save-handoff').evaluate(
      '(node) => document.activeElement === node'), 'Tab from HANDOFF textarea must reach Save'
    field.focus()
    page.keyboard.press('Shift+Tab')
    assert details_editor.locator('summary').evaluate(
      '(node) => document.activeElement === node'), 'Shift+Tab from HANDOFF textarea must reach summary'
    details_editor.locator('summary').click()
    assert details_editor.locator('.cw-handoff-unsaved').is_visible(), 'Warning must survive collapse'
    details_editor.locator('summary').click()
    assert field.input_value()==new
    settings.locator('[data-cw-tools="view"]').click()
    settings.locator('[data-cw-tools="technical"]').click()
    assert field.input_value()==new
    settings.locator('.cw-close-settings').click()
    page.locator('.cw-handoff-details').click()
    assert page.locator('#prompt-textarea').input_value()==original, 'Unsaved text applied prematurely'
    page.locator('#prompt-textarea').fill('')
    page.locator('.cw-settings-btn').click()
    settings.locator('[data-cw-tools="technical"]').click()
    assert field.input_value()==new
    # A cache-only logo fallback can already have persisted an independent
    # preference. Failed HANDOFF Save must not change existing storage bytes.
    prior_settings=page.evaluate('localStorage.getItem("'+PREFIX+'")')
    page.evaluate('window.__failSettings=true')
    details_editor.locator('.cw-save-handoff').click()
    assert details_editor.locator('.cw-handoff-unsaved').is_visible()
    assert page.evaluate('localStorage.getItem("'+PREFIX+'")')==prior_settings,(
      'Rejected HANDOFF save must preserve the previous settings and prompt')
    page.evaluate('window.__failSettings=false')
    details_editor.locator('.cw-save-handoff').click()
    assert not details_editor.locator('.cw-handoff-unsaved').is_visible()
    assert page.evaluate('JSON.parse(localStorage.getItem("'+PREFIX+'")).handoffPrompt')==new
    settings.locator('.cw-close-settings').click()
    page.locator('.cw-handoff-details').click()
    assert page.locator('#prompt-textarea').input_value()==new
    page.locator('#prompt-textarea').fill('')
    page.locator('.cw-settings-btn').click()
    settings.locator('[data-cw-tools="technical"]').click()
    details_editor.locator('.cw-restore-handoff').click()
    confirmation=page.locator('.cw-confirm-dialog')
    assert confirmation.evaluate('(e)=>e.open')
    confirmation.locator('.cw-cancel-confirm').click()
    assert field.input_value()==new
    details_editor.locator('.cw-restore-handoff').click()
    confirmation.locator('.cw-confirm-ok').click()
    assert field.input_value()==original
    assert details_editor.locator('.cw-handoff-unsaved').is_visible()
    assert page.evaluate('JSON.parse(localStorage.getItem("'+PREFIX+'")).handoffPrompt')==new
    details_editor.locator('.cw-save-handoff').click()
    assert page.evaluate('JSON.parse(localStorage.getItem("'+PREFIX+'")).handoffPrompt')==original
    assert not details_editor.locator('.cw-handoff-unsaved').is_visible()
    field.fill('  ')
    details_editor.locator('.cw-save-handoff').click()
    assert details_editor.locator('.cw-handoff-unsaved').is_visible()
    assert page.evaluate('JSON.parse(localStorage.getItem("'+PREFIX+'")).handoffPrompt')==original
    # Numeric fields are less contrasted in both palettes, independently of Soft/Sharp.
    settings.locator('[data-cw-tools="view"]').click()
    settings.locator('[data-cw-view-theme="dark"]').click()
    settings.locator('[data-cw-tools="technical"]').click()
    dark=settings.locator('.cw-hidden-optimistic')
    assert dark.is_visible() and dark.bounding_box()['width']>0
    settings.locator('[data-cw-tools="view"]').click()
    settings.locator('[data-cw-view-theme="light"]').click()
    settings.locator('[data-cw-tools="technical"]').click()
    light=settings.locator('.cw-hidden-optimistic')
    assert light.is_visible() and light.bounding_box()['width']>0
    assert not errors,errors
    print(f'PASS installed bundle Details/HANDOFF at {width}px', flush=True)
    page.close()
  browser.close()
