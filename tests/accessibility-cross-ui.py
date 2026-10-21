#!/usr/bin/env python3
"""Keyboard/focus/ARIA and remount behavior across the whole panel (Stable/Dev)."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
VERSION=re.search(r'^// @version\s+(\S+)$',(ROOT/'src/userscript-header.txt').read_text(),re.M).group(1)
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><button id="host" type="button">Host</button>
<main></main><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea>
<button type="button" data-testid="send-button">Send</button></form></body></html>'''

def assert_badge(page, expanded):
    badge=page.locator('.cw-chip')
    assert badge.get_attribute('aria-expanded')==str(expanded).lower(), 'badge aria-expanded'
    controls=badge.get_attribute('aria-controls')
    assert controls and page.locator(f'#{controls}').count()==1, 'badge aria-controls'
    assert page.locator(f'#{controls}').evaluate('(e)=>e.hidden') is (not expanded)
    assert badge.get_attribute('aria-label')==('Close Watchdog panel' if expanded else 'Open Watchdog panel')

def assert_focused(page, selector):
    assert page.locator(selector).evaluate('(e)=>document.activeElement===e'), selector

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
                              args=['--no-sandbox','--disable-dev-shm-usage'])
    for kind in ('stable','dev'):
      for width in (320,390,1200):
        page=browser.new_page(viewport={'width':width,'height':840})
        page.set_default_timeout(9000)
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(HTML)
        suffix='.dev' if kind=='dev' else ''
        script=(ROOT/f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text()
        script=script.replace('(() => {',f"(() => {{\nconst location={{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
        page.add_script_tag(content=script)
        assert_badge(page,False)
        # Keyboard-only opening works; tabs use a single roving tabindex.
        page.locator('.cw-chip').focus()
        page.keyboard.press('Enter')
        assert_badge(page,True)
        page.locator('.cw-tab-context').focus()
        page.keyboard.press('ArrowRight')
        assert_focused(page,'.cw-tab-budget')
        page.keyboard.press('End')
        assert_focused(page,'.cw-tab-details')
        page.keyboard.press('Home')
        assert_focused(page,'.cw-tab-context')
        assert page.locator('.cw-view-context').is_visible()
        assert page.locator('.cw-mini-nav[role="group"]').count()==1
        assert page.locator('.cw-mini-nav[role="group"]').get_attribute('aria-label')=='Context estimation settings'
        # Closing with Escape must restore focus to the visible badge.
        page.keyboard.press('Escape')
        assert_badge(page,False)
        assert_focused(page,'.cw-chip')
        page.keyboard.press('Enter')
        assert_badge(page,True)
        # Reopening dialogs keeps their own focus handling, independent of whole-panel Escape.
        page.locator('.cw-settings-btn').click()
        settings=page.locator('.cw-settings-dialog:not(.cw-about-dialog):not(.cw-limit-dialog):not(.cw-confirm-dialog)')
        assert settings.evaluate('(e)=>e.open')
        assert page.locator('.cw-panel-main').evaluate('(e)=>e.inert')
        assert_focused(page,'.cw-close-settings')
        page.keyboard.press('Shift+Tab')
        # Focus wraps to the last VISIBLE/TABBABLE control, which need not be Wipe.
        end = settings.locator('button:not([disabled]):not([tabindex="-1"]):visible, input:not([disabled]):not([tabindex="-1"]):visible, textarea:not([disabled]):not([tabindex="-1"]):visible').last
        assert end.evaluate('(e)=>document.activeElement===e')
        page.keyboard.press('Tab')
        assert_focused(page,'.cw-close-settings')
        # Still require all three maintenance controls in forward Tab order.
        for maintenance in ('.cw-reset-position','.cw-reset-chat','.cw-clear-watchdog-data'):
            page.keyboard.press('Tab')
            assert_focused(page, maintenance)
        page.locator('.cw-close-settings').focus()
        page.locator('[data-cw-tools="technical"]').click()
        assert page.locator('.cw-hidden-optimistic').is_visible()
        page.locator('[data-cw-tools="performance"]').click()
        assert page.locator('.cw-performance-toggle').is_visible()
        page.locator('[data-cw-tools="view"]').click()
        assert page.locator('.cw-view-preferences').is_visible()
        # Destructive confirmation traps focus and cancel has no storage side effect.
        page.locator('.cw-clear-watchdog-data').click()
        confirm=page.locator('.cw-confirm-dialog')
        assert confirm.evaluate('(e)=>e.open')
        assert settings.evaluate('(e)=>e.inert')
        assert_focused(page,'.cw-cancel-confirm')
        page.keyboard.press('Shift+Tab')
        assert_focused(page,'.cw-close-confirm')
        page.keyboard.press('Shift+Tab')
        assert_focused(page,'.cw-confirm-ok')
        page.keyboard.press('Escape')
        assert not confirm.evaluate('(e)=>e.open')
        assert settings.evaluate('(e)=>e.open&&!e.inert')
        assert_focused(page,'.cw-clear-watchdog-data')
        page.keyboard.press('Escape')
        assert not settings.evaluate('(e)=>e.open')
        assert_focused(page,'.cw-settings-btn')
        page.locator('.cw-about-btn').click()
        assert_focused(page,'.cw-close-about')
        page.keyboard.press('Escape')
        assert_focused(page,'.cw-about-btn')
        # Pin is RAM-only; when the host replaces Watchdog's root, UI must
        # rehydrate *from* the live value rather than reverting to HTML defaults.
        page.locator('.cw-pin-panel').click()
        assert page.locator('.cw-pin-panel').get_attribute('aria-pressed')=='true'
        assert page.locator('.cw-pin-panel').get_attribute('aria-label')=='Unpin panel'
        page.evaluate('''() => document.querySelector('[id$="-root"]').remove()''')
        page.wait_for_function('''() => document.querySelectorAll('[id$="-root"]').length === 1''')
        assert page.locator('.cw-pin-panel').get_attribute('aria-pressed')=='true'
        assert page.locator('.cw-pin-panel').get_attribute('aria-label')=='Unpin panel'
        assert 'Unpin panel' in page.locator('.cw-pin-panel .cw-tool-tip').inner_text()
        assert_badge(page,False)
        page.locator('.cw-logo-hit').click()
        assert_badge(page,True)
        page.locator('#host').click()
        assert_badge(page,True)  # still pinned
        page.locator('.cw-pin-panel').click()
        assert page.locator('.cw-pin-panel').get_attribute('aria-pressed')=='false'
        page.locator('#host').click()
        assert_badge(page,False)
        assert not errors, (kind,width,errors)
        print('PASS cross UX, ARIA, focus, confirm, remount, Pin',kind,width,flush=True)
        page.close()
    browser.close()
