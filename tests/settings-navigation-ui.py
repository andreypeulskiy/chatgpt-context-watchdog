#!/usr/bin/env python3
"""Settings categories use the shared tab contract without eager work or duplicated listeners."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
VERSION=re.search(r'^// @version\s+(\S+)$',(ROOT/'src/userscript-header.txt').read_text(),re.M).group(1)
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main></main>
<form data-chatgpt-composer><textarea id="prompt-textarea"></textarea>
<button type="button" data-testid="send-button">Send</button></form></body></html>'''
KEYS=('view','technical','diagnostics','performance')

def check(page,selected,focused=False):
    snapshot=page.locator('.cw-tools-nav').evaluate('''nav=>({
      role:nav.getAttribute('role'),
      tabs:[...nav.querySelectorAll('button')].map(b=>({key:b.dataset.cwTools,
        role:b.getAttribute('role'),selected:b.getAttribute('aria-selected'),
        index:b.tabIndex,focus:document.activeElement===b,
        expanded:b.getAttribute('aria-expanded'),controls:b.getAttribute('aria-controls')})),
      panes:[...nav.parentElement.querySelectorAll('[id^="cw-tools-"][role="tabpanel"]')].map(p=>({
        id:p.id,hidden:p.hidden,mounted:p.dataset.mounted||null,
        labelled:p.getAttribute('aria-labelledby')
      }))
    })''')
    assert snapshot['role']=='tablist',snapshot
    assert [t['key'] for t in snapshot['tabs']]==list(KEYS),snapshot
    assert [t['role'] for t in snapshot['tabs']]==['tab']*4,snapshot
    assert [t['selected'] for t in snapshot['tabs']]==['true' if k==selected else 'false' for k in KEYS],snapshot
    assert [t['index'] for t in snapshot['tabs']]==[0 if k==selected else -1 for k in KEYS],snapshot
    assert [p['hidden'] for p in snapshot['panes']]==[k!=selected for k in KEYS],snapshot
    for k,t,p in zip(KEYS,snapshot['tabs'],snapshot['panes']):
        assert t['expanded'] is None and t['controls']==p['id'],snapshot
        assert p['labelled']=='cw-tools-'+k+'-tab',snapshot
    if focused: assert snapshot['tabs'][KEYS.index(selected)]['focus'],snapshot
    return snapshot

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
              args=['--no-sandbox','--disable-dev-shm-usage'])
    for suffix in ('','.dev'):
      for width in (390,1200):
        page=browser.new_page(viewport={'width':width,'height':840})
        page.set_default_timeout(10000)
        errors=[]
        page.on('pageerror',lambda e: errors.append(str(e)))
        page.set_content(HTML)
        script=(ROOT/f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text()
        script=script.replace('(() => {',f"(() => {{\nconst location={{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
        page.add_script_tag(content=script)
        page.locator('.cw-logo-hit').click()
        assert page.locator('.cw-tools-nav').count()==0,'Settings should mount lazily'
        page.locator('.cw-settings-btn').click()
        dialog=page.locator('.cw-settings-dialog:not(.cw-about-dialog):not(.cw-limit-dialog):not(.cw-confirm-dialog)')
        first=check(page,'view')
        focusables='''()=>[...document.querySelector('.cw-settings-dialog:not(.cw-about-dialog):not(.cw-confirm-dialog):not(.cw-limit-dialog)').querySelectorAll('button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), summary, [tabindex]:not([tabindex="-1"])')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&!el.closest('[hidden]')&&getComputedStyle(el).visibility!=='hidden'})'''
        # Focus trap: explicit Tab/Shift+Tab wraps, it is not inferred from source strings.
        page.evaluate('('+focusables+')().at(-1).focus()')
        page.keyboard.press('Tab')
        assert page.evaluate('(()=>{const a=('+focusables+')();return document.activeElement===a[0]})()'),'Tab escaped Settings'
        page.keyboard.press('Shift+Tab')
        assert page.evaluate('(()=>{const a=('+focusables+')();return document.activeElement===a.at(-1)})()'),'Shift+Tab escaped Settings' 
        assert first['panes'][0]['mounted']=='true',first
        assert all(p['mounted'] is None for p in first['panes'][1:]),first
        view=dialog.locator('[data-cw-tools="view"]')
        view.focus()
        page.keyboard.press('ArrowRight')
        check(page,'technical',True)
        assert dialog.locator('.cw-hidden-optimistic').is_visible()
        # Arrow navigation follows the same cyclic contract as Budget.
        page.keyboard.press('End')
        check(page,'performance',True)
        assert dialog.locator('.cw-performance-toggle').is_visible()
        page.keyboard.press('ArrowRight')
        check(page,'view',True)
        page.keyboard.press('ArrowLeft')
        check(page,'performance',True)
        page.keyboard.press('Home')
        check(page,'view',True)
        # Inactive tabs are not reached by sequential Tab, even inside the dialog focus trap.
        view.focus()
        page.keyboard.press('Tab')
        assert not dialog.locator('[data-cw-tools="technical"]').evaluate('(e)=>document.activeElement===e'), 'Tab must skip inactive tabs'
        # Preserve selected category across close/reopen of same dialog.
        technical=dialog.locator('[data-cw-tools="technical"]')
        technical.click()
        check(page,'technical')
        dialog.locator('.cw-close-settings').click()
        page.locator('.cw-settings-btn').click()
        check(page,'technical')
        assert dialog.locator('.cw-hidden-optimistic').count()==1,'Technical must mount once'
        # Repeat selection does not collapse a true tab and does not remount the form.
        technical.click()
        check(page,'technical')
        assert dialog.locator('.cw-hidden-optimistic').count()==1
        dialog.locator('[data-cw-tools="diagnostics"]').click()
        snapshot=check(page,'diagnostics')
        assert snapshot['panes'][2]['mounted']=='true',snapshot
        dialog.locator('[data-cw-tools="performance"]').click()
        check(page,'performance')
        toggle=dialog.locator('.cw-performance-toggle')
        toggle.click()
        assert 'Profiling enabled' in page.locator('.cw-toast').inner_text()
        dialog.locator('.cw-close-settings').click()
        page.locator('.cw-settings-btn').click()
        check(page,'performance')
        toggle.click()
        assert 'Profiling paused' in page.locator('.cw-toast').inner_text(), 'No duplicate toggle handlers'
        # Host replaces the Watchdog root. A fresh instance must bind once,
        # reset only ephemeral navigation and leave no stale controls in DOM.
        for _ in range(2):
          page.evaluate('''() => document.querySelector('[id$="-root"]').remove()''')
          page.wait_for_function('''() => document.querySelectorAll('[id$="-root"]').length === 1''')
          page.locator('.cw-logo-hit').click()
          page.locator('.cw-settings-btn').click()
          check(page,'view')  # New dialog defaults to Appearance without storage writes.
          assert dialog.locator('.cw-performance-toggle').count()==0
          dialog.locator('[data-cw-tools="technical"]').click()
          check(page,'technical')
          assert dialog.locator('.cw-hidden-optimistic').count()==1
          dialog.locator('.cw-close-settings').click()
        assert not errors,errors
        print('PASS Settings tablist / lazy / keyboard / retained selection / single mount',
              'Dev' if suffix else 'Stable',width,flush=True)
        page.close()
    browser.close()
