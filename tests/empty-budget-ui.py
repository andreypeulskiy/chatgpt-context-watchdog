#!/usr/bin/env python3
"""No forecast before confirmed chat content; no stale estimates.
Tests Stable and Dev offline builds with real UI renderer in Chromium.
"""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
VERSION=__import__('re').search(r'^// @version\s+(\S+)$', (ROOT/'src/userscript-header.txt').read_text(), __import__('re').M).group(1)
CHAT='11111111-1111-4111-8111-111111111111'
MSG='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
KEY='cgpt-context-watchdog:state:v2:chat%3A'+CHAT
HTML='<!doctype html><html><body><main></main><form data-chatgpt-composer>\n<textarea id="prompt-textarea"></textarea><button data-testid="send-button" type="button">Send</button></form></body></html>'

def make_state(case):
    ledger={'chatKey':'chat:'+CHAT,'messages':{},'files':{},'domImages':{},
            'attachmentLedgerVersion':2,'repairHistory':[],'updatedAt':0}
    if case=='message':
        ledger['messages']['msg:'+MSG]={'role':'user','tokens':500,'chars':1000}
    elif case in ('file','unconfirmed'):
        ledger['files']['file:test']={'name':'a.pdf','size':1048576,
            'method':'metadata-size','metadataOnly':True,'status':'ready','tokens':0,
            **({'messageId': MSG} if case=='file' else {})}
    elif case=='image':
        ledger['domImages']['image:test']={'messageId': MSG,'tokens':2000}
    return ledger

def check(browser, suffix, route, case):
    page=browser.new_page(viewport={'width':390,'height':800})
    page.set_default_timeout(8000)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(HTML)
    page.evaluate("arg => {\n      window.__wdRoute = {pathname:arg.route,origin:'https://chatgpt.com',href:'https://chatgpt.com'+arg.route};\n      const data=new Map();\n      if(arg.state) data.set(arg.key, JSON.stringify(arg.state));\n      Object.defineProperty(window,'localStorage',{configurable:true,value:{\n        getItem:k=>data.get(String(k))??null,setItem:(k,v)=>data.set(String(k),String(v)),\n        removeItem:k=>data.delete(String(k)),key:i=>[...data.keys()][i]??null,\n        get length(){return data.size}\n      }});\n    }",{'route':route,'state':make_state(case) if case else None,'key':KEY})
    build=ROOT / f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js'
    js=build.read_text().replace('(() => {', '(() => {\nconst location = window.__wdRoute;', 1)
    page.add_script_tag(content=js)
    page.locator('.cw-logo-hit').click()
    page.locator('.cw-tab-budget').click()
    eligible=route.startswith('/c/') and case in ('message','file','image')
    observed=page.evaluate('() => {\n      const root=document.querySelector(\'[id$="-root"]\');\n      const hidden=selector=>{\n        const n=root.querySelector(selector);\n        return {hidden:n.hidden,display:getComputedStyle(n).display,text:n.innerText};\n      };\n      return {\n        notice:hidden(\'.cw-budget-unavailable\'),\n        heading:hidden(\'.cw-forecast-heading\'),\n        cards:hidden(\'.cw-forecast-cards\'),\n        groups:[...root.querySelectorAll(\'.cw-forecast-group\')].map(n=>({hidden:n.hidden,display:getComputedStyle(n).display})),\n        optimistic:root.querySelector(\'.cw-forecast-opt\').textContent,\n        pessimistic:root.querySelector(\'.cw-forecast-pess\').textContent,\n        tabLevel:root.querySelector(\'.cw-budget-tab-status\').dataset.level,\n        editorVisible:!!root.querySelector(\'.cw-budget-editor\')\n      };\n    }')
    assert observed['editorVisible'], observed
    assert len(observed['groups'])==2,observed
    if eligible:
        assert observed['notice']['hidden'] and observed['notice']['display']=='none',observed
        assert not observed['heading']['hidden'] and not observed['cards']['hidden'],observed
        assert all(not g['hidden'] and g['display']!='none' for g in observed['groups']),observed
        assert observed['optimistic'].startswith('≈ ') and observed['pessimistic'].startswith('≈ '),observed
        assert observed['tabLevel']!='pending',observed
    else:
        assert not observed['notice']['hidden'] and observed['notice']['display']!='none',observed
        assert 'No context estimate yet' in observed['notice']['text'],observed
        assert observed['heading']['hidden'] and observed['heading']['display']=='none',observed
        assert observed['cards']['hidden'] and observed['cards']['display']=='none',observed
        assert all(g['hidden'] and g['display']=='none' for g in observed['groups']),observed
        assert observed['tabLevel']=='pending',observed
    if route.startswith('/c/') and case is None:
        # A newly mounted first text message should switch the forecast on
        # through the existing observer, not through polling or a reload.
        page.evaluate("msg => {\n          const el=document.createElement('section');\n          el.setAttribute('data-chatgpt-search-unit-key','fallback-turn-0:0:user');\n          el.setAttribute('data-chatgpt-search-message-ids',msg);\n          const content=document.createElement('div');\n          content.className='whitespace-pre-wrap';\n          content.textContent='First message with enough words for a stable context estimate.';\n          el.appendChild(content);\n          document.querySelector('main').appendChild(el);\n        }",MSG)
        page.locator('.cw-budget-unavailable').wait_for(state='hidden', timeout=10000)
        assert page.locator('.cw-forecast-cards').is_visible()
        assert page.locator('.cw-forecast-opt').inner_text().startswith('≈ ')
        assert page.locator('.cw-budget-tab-status').get_attribute('data-level')!='pending'
    page.locator('.cw-budget-editor > summary').click()
    page.locator('.cw-budget-n').wait_for(state='visible')
    page.locator('[data-cw-budget="history"]').click()
    assert page.locator('.cw-history-details').is_visible(),observed
    assert not errors,errors
    print(f'PASS {suffix or "stable"} {route} {case or "empty"} confirmed={eligible}',flush=True)
    page.close()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
                              args=['--no-sandbox','--disable-dev-shm-usage'])
    for suffix in ('','.dev'):
        for route,case in [('/',None),('/c/'+CHAT,None),('/c/'+CHAT,'unconfirmed'),
                           ('/c/'+CHAT,'file'),('/c/'+CHAT,'image'),
                           ('/c/'+CHAT,'message'),('/','message')]:
            check(browser,suffix,route,case)
    browser.close()
