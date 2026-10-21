#!/usr/bin/env python3
"""State-dependent buttons use the shared data-cw-tip mechanism, Stable and Dev."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
VERSION = re.search(r'^// @version\s+(\S+)$', (ROOT/'src/userscript-header.txt').read_text(), re.M).group(1)
CHAT = '11111111-1111-4111-8111-111111111111'
MSG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
HTML = (f'<!doctype html><html><body><main><section data-chatgpt-search-unit-key="a:user" '
        f'data-chatgpt-search-message-ids="{MSG}"><div class="whitespace-pre-wrap">'
        'An existing confirmed user message.</div></section>'
        '<form data-chatgpt-composer><div contenteditable="true" role="textbox"> </div>'
        '<button type="button" data-testid="send-button">Send</button></form></main></body></html>')


def values(page, selector):
    return page.locator(selector).evaluate('''el => ({
      text: el.textContent.trim(),
      label: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      tip: el.dataset.cwTip || null,
      disabled: el.disabled || false
    })''')

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                args=['--no-sandbox','--disable-dev-shm-usage'])
    for suffix in ('', '.dev'):
        page = browser.new_page(viewport={'width':390,'height':850})
        page.set_default_timeout(7000)
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(HTML)
        page.evaluate(f'''() => {{
          window.__wdRoute={{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};
          const db=new Map();
          Object.defineProperty(window,'localStorage',{{configurable:true,value:{{
            getItem:k=>db.get(String(k))??null,setItem:(k,v)=>db.set(String(k),String(v)),
            removeItem:k=>db.delete(String(k)),key:i=>[...db.keys()][i]??null,
            get length(){{return db.size;}}
          }}}});
          history.pushState=function(state,title,path){{
            window.__wdRoute.pathname=String(path).split('?')[0];
            window.__wdRoute.href='https://chatgpt.com'+window.__wdRoute.pathname;
          }};
        }}''')
        src=(ROOT/f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text()
        src=src.replace('(() => {','(() => {\nconst location=window.__wdRoute;',1)
        page.add_script_tag(content=src)
        page.locator('.cw-logo-hit').click()
        pause='.cw-pause-toggle'
        def check_pause(expected,disabled=False):
            button=values(page,pause)
            wrapper=values(page,'.cw-pause-control')
            assert button['tip']==expected and button['label']==expected,button
            assert wrapper['tip']==expected,(expected,wrapper)
            assert button['title'] is None and wrapper['title'] is None,(button,wrapper)
            assert button['disabled']==disabled,(expected,button)
        check_pause('Pause Watchdog')
        page.locator(pause).hover()
        page.wait_for_timeout(650)
        popup=page.locator('.cw-floating-tip')
        assert popup.is_visible() and popup.inner_text()=='Pause Watchdog',popup.inner_text()
        page.locator(pause).click()
        check_pause('Resume Watchdog')
        page.mouse.move(2, 2)
        page.locator(pause).hover()
        page.wait_for_timeout(650)
        assert popup.is_visible() and popup.inner_text()=='Resume Watchdog',popup.inner_text()
        page.locator(pause).click()
        check_pause('Pause Watchdog')
        # Re-registering hints must not replace the state-dependent hint.
        page.locator(pause).click()
        check_pause('Resume Watchdog')
        page.locator('.cw-settings-btn').click()
        page.locator('.cw-close-settings').click()
        check_pause('Resume Watchdog')
        page.locator(pause).click()
        check_pause('Pause Watchdog')
        page.locator('.cw-settings-btn').click()
        page.locator('[data-cw-tools="performance"]').click()
        perf='.cw-performance-toggle'
        enabled=values(page,perf)
        assert enabled['text']=='Enable profiling' and enabled['tip']=='Start in-memory performance measurements.' and enabled['title'] is None,enabled
        page.locator(perf).click()
        paused=values(page,perf)
        assert paused['text']=='Pause profiling' and paused['tip']=='Pause in-memory performance measurements.' and paused['title'] is None,paused
        page.locator(perf).click()
        again=values(page,perf)
        assert again['text']==enabled['text'] and again['tip']==enabled['tip'] and again['title'] is None,again
        # Local parsing limit's caption and input must expose the same
        # accessible hover explanation without native title duplication.
        page.locator('.cw-close-settings').click()
        page.locator('.cw-tab-context').click()
        page.locator('[data-cw-mini="attachment"]').click()
        caption=page.locator('.cw-local-limit-label .cw-field-caption')
        field=page.locator('.cw-local-file-limit')
        assert caption.count()==1 and field.count()==1
        label_tip=caption.get_attribute('data-cw-tip')
        assert label_tip and 'metadata only' in label_tip and 'MiB' in label_tip,label_tip
        assert field.get_attribute('data-cw-tip')==label_tip
        for trigger in (caption,field):
            assert trigger.get_attribute('title') is None
            trigger.hover()
            page.wait_for_timeout(650)
            assert popup.is_visible() and popup.inner_text()==label_tip
            assert popup.evaluate('''e=>{
              const r=e.getBoundingClientRect();
              return r.width>0 && r.height>0 && r.left>=-1 && r.right<=innerWidth+1
                && r.top>=-1 && r.bottom<=innerHeight+1 && e.scrollHeight<=e.clientHeight+1;
            }'''), 'Tooltip must be fully readable within the viewport'
        # Pin is a separate existing header tooltip and must keep its own style.
        assert page.locator('.cw-pin-panel .cw-tool-tip').count()==1
        assert not errors,errors
        print(f'PASS {"Dev" if suffix else "Stable"}: dynamic pause, focus/hover, profiling, remount, toolbar isolation',flush=True)
        page.close()
    browser.close()
