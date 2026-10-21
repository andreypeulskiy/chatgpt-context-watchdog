#!/usr/bin/env python3
"""UI forecast availability is identical in Context, Details and copied text."""
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
VERSION=re.search(r'^// @version\s+(\S+)$',(ROOT/'src/userscript-header.txt').read_text(),re.M).group(1)
CHAT='11111111-1111-4111-8111-111111111111'
MSG='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
STATE_KEY='cgpt-context-watchdog:state:v2:chat%3A'+CHAT
HTML='''<!doctype html><html><body><main><form data-chatgpt-composer>
<textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button>
</form></main></body></html>'''

def ledger(kind):
    state={'chatKey':f'chat:{CHAT}','messages':{},'repairHistory':[],
           'attachmentLedgerVersion':2,'files':{},'domImages':{},'updatedAt':0}
    if kind in ('file','unconfirmed'):
        attachment={'name':'sample.pdf','size':1048576,'status':'ready','tokens':0,
                    'method':'metadata-size','metadataOnly':True,'source':'dom-history'}
        if kind=='file':
            attachment['messageId']=MSG
        state['files']['dom-user-file:test']=attachment
    elif kind=='image':
        state['domImages']['dom-user-image-slot:test']={
            'messageId':MSG,'tokens':2000,'width':512,'height':512}
    return state

def run(browser,build,case,route):
    page=browser.new_page(viewport={'width':950,'height':800})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(HTML)
    page.evaluate('''v => {
      window.__wdRoute={pathname:v.path,origin:'https://chatgpt.com',href:'https://chatgpt.com'+v.path};
      const data=new Map(); if(v.state)data.set(v.key,JSON.stringify(v.state));
      const store={getItem:k=>data.get(String(k))??null,
        setItem:(k,s)=>data.set(String(k),String(s)),
        removeItem:k=>data.delete(String(k)),key:i=>[...data.keys()][i]??null,
        get length(){return data.size}};
      Object.defineProperty(window,'localStorage',{configurable:true,value:store});
      Object.defineProperty(navigator,'clipboard',{configurable:true,
        value:{writeText:async txt=>{window.__copiedDetails=txt;}}});
    }''',{'path':route,'state':ledger(case) if case else None,'key':STATE_KEY})
    code=build.read_text().replace('(() => {','(() => {\nconst location = window.__wdRoute;',1)
    page.add_script_tag(content=code)
    page.locator('.cw-logo-hit').click()
    confirmed=route.startswith('/c/') and case in ('file','image')
    context=page.locator('.cw-context-range').inner_text()
    assert (context.startswith('≈ ') if confirmed else context=='None'),(case,route,context)
    page.locator('.cw-tab-details').click()
    page.wait_for_function("document.querySelector('.cw-details-report')?.textContent.includes('Total context:')")
    groups=page.locator('.cw-detail-group')
    assert groups.count()==5
    forecast=groups.nth(3).inner_text()
    budgets=groups.nth(4).inner_text()
    assert 'Hidden context: 4,000–16,000 tokens' in forecast,forecast
    if confirmed:
        assert 'Total context: none' not in forecast,forecast
        assert 'No context estimate yet.' not in budgets,budgets
        assert 'Conservative: none' not in budgets,budgets
    else:
        assert 'Total context: none' in forecast,forecast
        assert all(x in budgets for x in ('Conservative: none','Normal: none','Generous: none')),budgets
        assert 'No context estimate yet.' in forecast and 'No context estimate yet.' in budgets
    page.locator('.cw-copy-details').click()
    page.wait_for_function('typeof window.__copiedDetails==="string"')
    copied=page.evaluate('window.__copiedDetails')
    assert ('Total context: none' in copied)==(not confirmed)
    assert ('Conservative: none' in copied)==(not confirmed)
    assert forecast.splitlines()[4] in copied
    # Explanatory legends stay visible but never enter the plain-text metrics report.
    assert 'No context estimate yet.' not in copied
    assert 'Ranges: optimistic–pessimistic.' not in copied
    assert 'Estimated usage / context budget.' not in copied
    assert not errors,errors
    print(f'PASS {build.name} {case or "empty"} {route} Details/Copy',flush=True)
    page.close()

with sync_playwright() as playwright:
    browser=playwright.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
        args=['--no-sandbox','--disable-dev-shm-usage'])
    for suffix in ('','.dev'):
        build=ROOT/f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js'
        for case,route in ((None,'/'),(None,f'/c/{CHAT}'),('unconfirmed',f'/c/{CHAT}'),
                ('file',f'/c/{CHAT}'),('image',f'/c/{CHAT}')):
            run(browser,build,case,route)
    browser.close()
