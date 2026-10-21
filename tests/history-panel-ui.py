#!/usr/bin/env python3
"""History reports sample averages and missing-value semantics without unrelated metrics."""
import json
from playwright.sync_api import sync_playwright
from support.current import SCRIPT

CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main></main><form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form></body></html>'''
INJECTED=SCRIPT.replace('(() => {',f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
HISTORY='cgpt-context-watchdog:ended-history:v2'
SETTINGS='cgpt-context-watchdog:settings:v1'
SAMPLES=[
 {'chatKey':'chat:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','seen':20000,'optimistic':26000,'pessimistic':42000},
 {'chatKey':'chat:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','seen':30000,'optimistic':38000,'pessimistic':54000}
]

def run(browser,width,populated):
    page=browser.new_page(viewport={'width':width,'height':800})
    page.set_default_timeout(7000)
    errors=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.set_content(HTML)
    data={HISTORY:json.dumps(SAMPLES if populated else []),
          SETTINGS:json.dumps({'budgetCalibrationWeight':.33 if populated else 0})}
    page.evaluate('''items=>{
       const data=new Map(items);
       Object.defineProperty(window,'localStorage',{configurable:true,value:{
          getItem:k=>data.get(String(k))??null,
          setItem:(k,v)=>data.set(String(k),String(v)),
          removeItem:k=>data.delete(String(k)),
          key:i=>[...data.keys()][i]??null,get length(){return data.size}
       }});
    }''',list(data.items()))
    page.add_script_tag(content=INJECTED)
    page.locator('.cw-logo-hit').click()
    page.locator('.cw-tab-budget').click()
    page.locator('[data-cw-budget="history"]').click()
    observed=page.evaluate('''() => {
      const pane=document.querySelector('.cw-history-details');
      const history=pane.querySelector('.cw-history');
      const note=pane.querySelector('.cw-history-note');
      const root=document.querySelector('[id$="-root"]');
      return {visible:!pane.hidden,lines:history.innerText.trim().split('\\n'),
        note:note.textContent.trim(),noteVisible:note.getBoundingClientRect().height>0,
        noteFont:parseFloat(getComputedStyle(note).fontSize),
        extra:pane.querySelectorAll('.cw-messages-line,.cw-roles-line,.cw-effective-budgets').length,
        overflow:history.scrollWidth-history.clientWidth};
    }''')
    if populated:
        expected=['Recorded limit samples: 2','Average message text: 25,000 tokens',
                  'Average optimistic context: 32,000 tokens',
                  'Average pessimistic context: 48,000 tokens','Calibration weight: 0.33']
    else:
        expected=['Recorded limit samples: 0','Average message text: none',
                  'Average optimistic context: none','Average pessimistic context: none',
                  'Calibration weight: 0.00']
    assert observed['visible'] and observed['lines']==expected,(width,observed)
    assert 'sample' in observed['note'].lower() and observed['noteVisible'] and observed['noteFont']>=8,observed
    assert observed['extra']==0 and observed['overflow']<=1,observed
    assert not errors,errors
    print(f'PASS History {width}px populated={populated}: numeric averages, missing values and readable note',flush=True)
    page.close()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
                              args=['--no-sandbox','--disable-dev-shm-usage'])
    for width,populated in [(320,True),(390,True),(1200,True),(390,False)]:
        run(browser,width,populated)
    browser.close()
