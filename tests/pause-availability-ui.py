#!/usr/bin/env python3
"""Point 5+10: Stable/Dev, real userscript, offline branch/SPA/pause/DOM-cost QA.

Fixtures reflect the live Edge investigation (hidden standard composer beside
visible branch composer). They are *not* a claim about all future ChatGPT DOMs.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
from support.current import VERSION

ROOT = Path(__file__).resolve().parents[1]
FILES = [ROOT / f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js'
         for suffix in ('', '.dev')]
A = '11111111-1111-4111-8111-111111111111'
B = '22222222-2222-4222-8222-222222222222'
C = '33333333-3333-4333-8333-333333333333'
MA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
MB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
MC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
STATE = 'cgpt-context-watchdog:state:v2:'
SETTINGS = 'cgpt-context-watchdog:settings:v1'


def composer(standard=True):
    attr = ' data-chatgpt-composer' if standard else ''
    return (f'<form{attr}><div contenteditable="true" role="textbox" '
            'style="min-height:30px;width:240px"> </div>'
            '<button type="button" data-testid="send-button">Send</button></form>')


def unit(id, suffix, content):
    return (f'<section data-chatgpt-search-unit-key="u-{suffix}:user" '
            f'data-chatgpt-search-message-ids="{id}">'
            f'<div class="whitespace-pre-wrap">{content}</div></section>')


def chat(msg, suffix, standard=True):
    return '<main>' + unit(msg, suffix, 'An existing finished user message. ' * 16) + composer(standard) + '</main>'


def branch():
    return ('<main style="display:none">' + unit(MA, 'hidden', 'Outgoing hidden message.')
            + composer() + '</main><main>' + unit(MC, 'branch',
            'A continued branch with several completed replies. ' * 12)
            + composer(False) + '</main>')


HTML = '<!doctype html><html><body><div id="host">' + chat(MA, 'a') + '</div></body></html>'
INIT = '''() => {
    window.__wdRoute = {pathname:'/c/11111111-1111-4111-8111-111111111111',
        origin:'https://chatgpt.com', href:'https://chatgpt.com/c/11111111-1111-4111-8111-111111111111'};
    const data=new Map();
    window.__wdStorage = {
      data, writes:0,
      getItem:k=>data.get(String(k))??null,
      setItem(k,v){this.writes++;data.set(String(k),String(v));},
      removeItem:k=>data.delete(String(k)),
      key:i=>[...data.keys()][i]??null,
      get length(){return data.size}
    };
    Object.defineProperty(window,'localStorage',{configurable:true,value:window.__wdStorage});
    history.pushState = function(state,title,path) {
      window.__wdRoute.pathname = String(path).split('?')[0];
      window.__wdRoute.href = 'https://chatgpt.com' + window.__wdRoute.pathname;
    };
    const NativeMutationObserver=window.MutationObserver;
    window.__wdObservers=[];
    window.MutationObserver=class extends NativeMutationObserver {
      constructor(fn) {
        const record={active:false,options:null,batches:0,records:0};
        super((mutations,observer)=>{record.batches++;record.records+=mutations.length;fn(mutations,observer);});
        this.record=record;window.__wdObservers.push(record);
      }
      observe(target,options){this.record.active=true;this.record.options=options;
        this.record.pageWide=(target===document.body||target===document.documentElement);
        return super.observe(target,options);}
      disconnect(){this.record.active=false;return super.disconnect();}
    };
    window.__wdObserverSummary=()=>window.__wdObservers.map(x=>({
      active:x.active,heavy:!!x.pageWide && !!x.options?.characterData,batches:x.batches,records:x.records
    }));
}'''

def assert_status(page, mode, disabled, manual=None):
    page.wait_for_function('''expected => {
      const button=document.querySelector('.cw-pause-toggle');
      const chip=document.querySelector('.cw-chip');
      return button && chip && chip.dataset.cwBadgeMode===expected.mode &&
        button.disabled===expected.disabled;
    }''', arg={'mode':mode,'disabled':disabled})
    result = page.evaluate('''() => ({
      badge:document.querySelector('.cw-chip').dataset.cwBadgeMode,
      disabled:document.querySelector('.cw-pause-toggle').disabled,
      playing:document.querySelector('.cw-pause-toggle').dataset.cwPlaying,
      manual:JSON.parse(localStorage.getItem('cgpt-context-watchdog:settings:v1')||'{}').watchdogPaused,
      observers:window.__wdObserverSummary()
    })''')
    assert result['badge']==mode and result['disabled']==disabled, result
    if manual is not None: assert result['manual']==manual,result
    heavy=sum(o['active'] and o['heavy'] for o in result['observers'])
    light=sum(o['active'] and not o['heavy'] for o in result['observers'])
    assert heavy==(mode!='paused'), result
    assert light>=1, result  # Other existing narrow UI observers may coexist
    return result


def navigate(page, route, html):
    page.evaluate('''v=>{history.pushState({},'',v.route);document.querySelector('#host').innerHTML=v.html;}''',
                  {'route':route,'html':html})


def run_case(browser, build, width):
    page=browser.new_page(viewport={'width':width,'height':840})
    page.set_default_timeout(6000)
    errors=[]
    page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(HTML)
    page.evaluate(INIT)
    code=build.read_text().replace('(() => {', '(() => {\nconst location = window.__wdRoute;', 1)
    page.add_script_tag(content=code)
    page.wait_for_timeout(500)
    assert_status(page,'normal',False)
    assert page.evaluate('''() => !!JSON.parse(localStorage.getItem(
      'cgpt-context-watchdog:state:v2:chat%3A11111111-1111-4111-8111-111111111111')||'null')?.messages?.[
      'msg:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']''')

    page.locator('.cw-logo-hit').click()
    page.locator('.cw-pause-toggle').click()
    assert_status(page,'paused',False,True)
    # Paused text is not an alternate opener/resume control: only the original logo opens.
    page.locator('.cw-logo-hit').click()
    assert page.locator('.cw-panel').is_hidden()
    page.locator('.cw-paused-label').click()
    assert page.locator('.cw-panel').is_hidden()
    page.locator('.cw-logo-hit').click()
    assert page.locator('.cw-panel').is_visible()
    # Read-only diagnostics are available; DOM Audit/Repair/Undo are disabled.
    page.locator('.cw-settings-btn').click()
    assert_status(page,'paused',False,True)
    page.locator('.cw-settings-dialog [data-cw-tools="diagnostics"]').click()
    assert_status(page,'paused',False,True)
    assert page.locator('.cw-rescan').is_disabled()
    assert page.locator('.cw-repair-short').is_disabled()
    assert page.locator('.cw-undo-repair').is_disabled()
    page.locator('.cw-close-settings').click()
    assert_status(page,'paused',False,True)
    before=page.evaluate('''() => ({writes:window.__wdStorage.writes,
      observers:window.__wdObserverSummary()})''')
    # Text streaming generates childList events; a paused Watchdog does not
    # enumerate chat elements, tokenize or modify its ledger.
    page.evaluate('''() => {const unit=document.querySelector('main section');
      for(let i=0;i<1000;i++){const e=document.createElement('span');
        e.textContent='streaming words';unit.appendChild(e);}}''')
    page.wait_for_timeout(100)
    after=page.evaluate('''() => ({writes:window.__wdStorage.writes,
      observers:window.__wdObserverSummary()})''')
    assert after['writes']==before['writes'],(before,after)
    assert_status(page,'paused',False,True)
    print(f'PASS {build.name} {width}px: user pause / 1000 streamed DOM insertions / no writes',flush=True)

    navigate(page,'/library','<main style="min-height:120px">Library</main>')
    assert_status(page,'paused',True,True)
    assert page.locator('.cw-pause-toggle').get_attribute('data-cw-tip')=='Available in chats only'
    assert page.locator('.cw-pause-toggle').get_attribute('title') is None
    navigate(page,f'/c/{B}',chat(MB,'b'))
    assert_status(page,'paused',False,True)
    page.locator('.cw-pause-toggle').click()
    assert_status(page,'normal',False,False)
    page.wait_for_timeout(250)
    # The resumed B ledger cannot receive the outgoing A message.
    bstate=page.evaluate('''() => JSON.parse(localStorage.getItem(
      'cgpt-context-watchdog:state:v2:chat%3A22222222-2222-4222-8222-222222222222')||'null')''')
    assert bstate and 'msg:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' not in bstate['messages'],bstate
    print(f'PASS {build.name} {width}px: manual preference survives library and route change',flush=True)

    navigate(page,'/library','<main style="min-height:120px">Library</main>')
    assert_status(page,'paused',True,False)
    navigate(page,'/','<main>' + composer() + '</main>')
    assert_status(page,'minimal',False,False)
    assert page.locator('.cw-average').is_hidden()
    assert page.locator('.cw-chip-status').is_hidden()
    print(f'PASS {build.name} {width}px: forced pause lifts to empty new chat, no numbers',flush=True)

    navigate(page,f'/c/{C}',branch())
    assert_status(page,'normal',False,False)
    page.wait_for_timeout(300)
    cstate=page.evaluate('''() => JSON.parse(localStorage.getItem(
      'cgpt-context-watchdog:state:v2:chat%3A33333333-3333-4333-8333-333333333333')||'null')''')
    assert cstate and 'msg:cccccccc-cccc-4ccc-8ccc-cccccccccccc' in cstate['messages'],cstate
    assert 'msg:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' not in cstate['messages'],cstate
    assert page.locator('.cw-pause-toggle').get_attribute('data-cw-tip')=='Pause Watchdog'
    assert page.locator('.cw-pause-toggle').get_attribute('title') is None
    print(f'PASS {build.name} {width}px: continued branch active; hidden main ignored',flush=True)

    # Paused root removal by React must not strand an invisible Watchdog.
    page.locator('.cw-pause-toggle').click()
    assert_status(page,'paused',False,True)
    page.evaluate("document.getElementById('cgpt-context-watchdog-root').remove()")
    page.wait_for_function('''() => document.querySelectorAll('#cgpt-context-watchdog-root').length===1''')
    assert_status(page,'paused',False,True)
    # A remote preference update is independent of forced pause.
    page.evaluate('''() => {
      const key='cgpt-context-watchdog:settings:v1';
      const s=JSON.parse(localStorage.getItem(key));s.watchdogPaused=false;
      localStorage.setItem(key,JSON.stringify(s));
      dispatchEvent(new StorageEvent('storage',{key,newValue:JSON.stringify(s)}));
    }''')
    assert_status(page,'normal',False,False)
    assert not errors, errors
    page.close()
    print(f'PASS {build.name} {width}px: paused remount + external preference sync',flush=True)

with sync_playwright() as playwright:
    browser=playwright.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
        args=['--no-sandbox','--disable-dev-shm-usage'])
    for build in FILES:
        for width in (320,390,1200):
            run_case(browser,build,width)
    browser.close()
