#!/usr/bin/env python3
""" released userscript: compact Details layout and Technical first section."""
import json
from playwright.sync_api import sync_playwright
from support.current import SCRIPT

CHAT='11111111-1111-4111-8111-111111111111'
MSG='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
KEY='cgpt-context-watchdog:state:v2:chat%3A'+CHAT
LEDGER={
 'chatKey':'chat:'+CHAT, 'messages':{'msg:'+MSG:{'role':'user','tokens':56892,'chars':116264}},
 'files':{},'domImages':{},'attachmentLedgerVersion':2,'repairHistory':[],'updatedAt':0
}
HTML='''<!doctype html><html><body><main></main>
<form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button></form>
</body></html>'''
INJECTED=SCRIPT.replace('(() => {',
    f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
INIT='''initial => {
 const map=new Map(initial);
 Object.defineProperty(window,'localStorage',{configurable:true,value:{
  getItem:k=>map.get(String(k))??null,setItem:(k,v)=>map.set(String(k),String(v)),
  removeItem:k=>map.delete(String(k)),key:i=>[...map.keys()][i]??null,
  get length(){return map.size}
 }});
 window.__copy=null;
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async s=>{window.__copy=s}}});
}'''

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for width in (320,390,1200):
  page=browser.new_page(viewport={'width':width,'height':850})
  page.set_default_timeout(8000)
  errors=[]
  page.on('pageerror', lambda e: errors.append(str(e)))
  page.set_content(HTML)
  page.evaluate(INIT,[[KEY,json.dumps(LEDGER)]])
  page.add_script_tag(content=INJECTED)
  page.locator('.cw-logo-hit').click()
  page.locator('.cw-tab-details').click()
  report=page.locator('.cw-details-report')
  assert report.locator('.cw-detail-group').count()==5
  text=report.inner_text()
  assert 'Message text: ≈ 56,892 tokens' in text,text
  assert 'Conservative: 60,892–72,892 / 80,000 tokens' in text,text
  assert '%' not in text
  assert 'Range' in text
  styles=page.evaluate('''() => {
    const groups=[...document.querySelectorAll('.cw-detail-group')];
    const lines=groups.slice(3).flatMap(g=>[...g.children]);
    return {
      layouts:lines.map(e=>({text:e.textContent,rect:e.getBoundingClientRect().height,
        lineHeight:parseFloat(getComputedStyle(e).lineHeight),width:e.getBoundingClientRect().width,
        scrollWidth:e.scrollWidth,clientWidth:e.clientWidth})),
      colors:groups.slice(1).map(g=>({legend:getComputedStyle(g.lastElementChild).color,
        regular:getComputedStyle(g.firstElementChild).color})),
      titleReadable:document.querySelector('.cw-details-header > span').getBoundingClientRect().height>0
    };
  }''')
  assert styles['titleReadable'],styles
  assert all(t['legend'] != t['regular'] for t in styles['colors']),styles
  # No silent horizontal clipping. At 320px a very long budget may wrap;
  # on standard panel widths all lower metrics should fit on one line.
  assert all(r['scrollWidth']<=r['clientWidth']+1 for r in styles['layouts']),styles
  # Intentional wrapping is fine if the entire report stays readable and unclipped.
  page.locator('.cw-copy-details').click()
  page.wait_for_function('window.__copy !== null')
  assert page.evaluate('window.__copy')=='\n\n'.join('\n'.join(g.locator(':scope > div:not(.cw-detail-legend)').all_inner_texts()) for g in [report.locator('.cw-detail-group').nth(i) for i in range(5)])
  assert 'Ranges: optimistic–pessimistic.' not in page.evaluate('window.__copy')
  assert 'Estimated usage / context budget.' not in page.evaluate('window.__copy')
  page.locator('.cw-settings-btn').click()
  settings=page.locator('.cw-settings-dialog:not(.cw-confirm-dialog):not(.cw-about-dialog):not(.cw-limit-dialog)')
  settings.locator('[data-cw-tools="technical"]').click()
  technical=settings.locator('#cw-tools-technical')
  assert technical.locator(':scope > .cw-handoff-editor').count()==1
  assert technical.evaluate('e=>e.firstElementChild.classList.contains("cw-handoff-editor")'), 'HANDOFF must be first'
  assert not technical.locator('.cw-handoff-editor').evaluate('e=>e.open')
  assert technical.locator('.cw-hidden-optimistic').count()==1
  assert not errors,errors
  print(f'PASS release bundle at {width}px; readable Details rows without clipping',flush=True)
  page.close()
 browser.close()
