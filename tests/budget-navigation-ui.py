#!/usr/bin/env python3
"""Shared keyboard contract for main tabs and Budget mini-tabs, Stable and Dev."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
VERSION = re.search(r'^// @version\s+(\S+)$', (ROOT/'src/userscript-header.txt').read_text(), re.M).group(1)
CHAT = '11111111-1111-4111-8111-111111111111'
HTML = '''<!doctype html><html><body><main></main>
<form data-chatgpt-composer><textarea id="prompt-textarea"></textarea>
<button type="button" data-testid="send-button">Send</button></form></body></html>'''

def status(page):
    return page.evaluate("""() => {
      const root=document.querySelector('[id$="-root"]');
      const nav=root.querySelector('.cw-budget-mini-nav');
      const tabs=[...nav.querySelectorAll('[role="tab"]')];
      const panes=[...root.querySelectorAll('#cw-budget-limits,#cw-budget-history')];
      return { tabs:tabs.map(el=>({key:el.dataset.cwBudget,selected:el.getAttribute('aria-selected'),
                       tabIndex:el.tabIndex,focused:document.activeElement===el})),
        panes:panes.map(el=>({hidden:el.hidden,mounted:el.dataset.mounted||null,
                           labelledBy:el.getAttribute('aria-labelledby')})),
        historyContent:!!root.querySelector('.cw-history'),
        navRole:nav.getAttribute('role') };
    }""")

def check(page, key, focus=True):
    x=status(page)
    assert x['navRole']=='tablist',x
    assert [(e['key'],e['selected'],e['tabIndex']) for e in x['tabs']]==[
        ('limits','true' if key=='limits' else 'false',0 if key=='limits' else -1),
        ('history','true' if key=='history' else 'false',0 if key=='history' else -1)],x
    assert [e['hidden'] for e in x['panes']]==[key!='limits',key!='history'],x
    assert [e['labelledBy'] for e in x['panes']]==['cw-budget-limits-tab','cw-budget-history-tab'],x
    if focus: assert next(e for e in x['tabs'] if e['key']==key)['focused'],x
    return x

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
                              args=['--no-sandbox','--disable-dev-shm-usage'])
    for suffix in ('','.dev'):
        page=browser.new_page(viewport={'width':390,'height':800})
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(HTML)
        js=(ROOT/f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text()
        js=js.replace('(() => {', f"(() => {{\nconst location={{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
        page.add_script_tag(content=js)
        page.locator('.cw-logo-hit').click()
        # Shared keyboard handler for main tabs.
        page.locator('.cw-tab-context').focus()
        page.keyboard.press('ArrowRight')
        assert page.locator('.cw-tab-budget').get_attribute('aria-selected')=='true'
        assert page.locator('.cw-tab-budget').evaluate('(e)=>document.activeElement===e')
        initial=check(page,'limits',False)
        assert not initial['historyContent'] and initial['panes'][1]['mounted'] is None
        history=page.locator('[data-cw-budget="history"]')
        limits=page.locator('[data-cw-budget="limits"]')
        limits.focus()
        page.keyboard.press('ArrowRight')
        selected=check(page,'history')
        assert selected['historyContent'] and selected['panes'][1]['mounted']=='true',selected
        page.keyboard.press('ArrowRight') # wrap
        check(page,'limits')
        page.keyboard.press('ArrowLeft')  # wrap backwards
        check(page,'history')
        page.keyboard.press('Home')
        check(page,'limits')
        page.keyboard.press('End')
        check(page,'history')
        history.click() # selecting active tab cannot close it
        check(page,'history',False)
        limits.click()
        check(page,'limits',False)
        history.click()
        reread=check(page,'history',False)
        assert reread['panes'][1]['mounted']=='true'
        assert page.locator('.cw-history').count()==1,'History may mount only once'
        # Changing main tabs leaves budget selection stable.
        page.locator('.cw-tab-context').click()
        page.locator('.cw-tab-budget').click()
        check(page,'history',False)
        # Existing Context mini-navigation still collapses the selected pane.
        page.locator('.cw-tab-context').click()
        text=page.locator('[data-cw-mini="text"]')
        text.click()
        assert page.locator('.cw-text-settings-details').is_visible()
        text.click()
        assert page.locator('.cw-text-settings-details').is_hidden()
        assert not errors,errors
        print('PASS Budget tablist, keyboard, lazy history, main/Context regression', 'Dev' if suffix else 'Stable',flush=True)
        page.close()
    browser.close()
