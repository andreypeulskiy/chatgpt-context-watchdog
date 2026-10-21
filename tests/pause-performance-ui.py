#!/usr/bin/env python3
"""P5+10: paused work must not scan page/ledger under DOM pressure.
Offline Chromium, real Stable+Dev installers; timings are observations, not a
hard CPU guarantee on Edge. There is no production telemetry or polling.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from support.current import VERSION

ROOT = Path(__file__).resolve().parents[1]
A = '11111111-1111-4111-8111-111111111111'
MSG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
HTML = (f'<html><body><main><section data-chatgpt-search-unit-key="m:user" '
        f'data-chatgpt-search-message-ids="{MSG}">'
        '<div class="whitespace-pre-wrap">Completed recorded user message.</div>'
        '<div id="stream"></div></section>'
        '<form data-chatgpt-composer><div contenteditable="true" role="textbox"> </div>'
        '<button type="button" data-testid="send-button">Send</button></form>'
        '</main></body></html>')
INIT = f'''() => {{
  window.__wdRoute={{pathname:'/c/{A}',href:'https://chatgpt.com/c/{A}',origin:'https://chatgpt.com'}};
  const data=new Map();
  window.__store={{writes:0,
    getItem:k=>data.get(String(k))??null,
    setItem(k,v){{this.writes++;data.set(String(k),String(v));}},
    removeItem:k=>data.delete(String(k)),
    key:i=>[...data.keys()][i]??null,
    get length(){{return data.size;}} }};
  Object.defineProperty(window,'localStorage',{{configurable:true,value:window.__store}});
  const native=window.MutationObserver;
  window.__observerStats=[];
  window.MutationObserver=class extends native {{
    constructor(callback) {{
      const stats={{heavy:null,active:false,calls:0,records:0,callbackMs:0}};
      super((mutations,observer)=>{{const t=performance.now();stats.calls++;stats.records+=mutations.length;callback(mutations,observer);stats.callbackMs+=performance.now()-t;}});
      this.stats=stats;window.__observerStats.push(stats);
    }}
    observe(target,options) {{this.stats.heavy=!!options.characterData;this.stats.active=true;super.observe(target,options);}}
    disconnect() {{this.stats.active=false;super.disconnect();}}
  }};
}}'''

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
        args=['--no-sandbox','--disable-dev-shm-usage'])
    for suffix in ('', '.dev'):
        script=(ROOT/f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text()
        script=script.replace('(() => {','(() => {\nconst location=window.__wdRoute;',1)
        page=browser.new_page(viewport={'width':390,'height':840})
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.set_content(HTML)
        page.evaluate(INIT)
        page.add_script_tag(content=script)
        page.wait_for_function("() => document.querySelector('.cw-pause-toggle') && window.__observerStats.some(s=>s.heavy && s.active)")
        page.locator('.cw-logo-hit').click()
        page.locator('.cw-pause-toggle').click()
        page.wait_for_function("() => !window.__observerStats.some(s=>s.heavy && s.active)")
        # Instrument *after* pause activation so UI effects do not count.
        page.evaluate('''() => {
          window.__queryCosts={document:0,element:0};
          const doc=Document.prototype.querySelectorAll;
          const el=Element.prototype.querySelectorAll;
          Document.prototype.querySelectorAll=function(...args){window.__queryCosts.document++;return doc.apply(this,args);};
          Element.prototype.querySelectorAll=function(...args){window.__queryCosts.element++;return el.apply(this,args);};
        }''')
        before=page.evaluate('''() => ({writes:window.__store.writes,
          calls:window.__observerStats.map(s=>s.calls),records:window.__observerStats.map(s=>s.records),callbackMs:window.__observerStats.map(s=>s.callbackMs)})''')
        page.evaluate('''() => {
          const parent=document.querySelector('#stream');
          const start=performance.now();
          for(let i=0;i<1000;i++){
            const e=document.createElement('span');e.textContent='some streamed text';parent.appendChild(e);
          }
          window.__mutationCostMs=performance.now()-start;
        }''')
        page.wait_for_timeout(70)
        after=page.evaluate('''() => ({writes:window.__store.writes,
          costs:window.__queryCosts,
          creationMs:window.__mutationCostMs,
          observers:window.__observerStats.map(s=>({heavy:s.heavy,active:s.active,calls:s.calls,records:s.records,callbackMs:s.callbackMs}))})''')
        assert after['writes']==before['writes'],(before,after)
        assert after['costs']['document']==0,after
        assert after['costs']['element']<=2,after
        assert not any(s['heavy'] and s['active'] for s in after['observers']),after
        deltas=[{'heavy':s['heavy'],'calls':s['calls']-before['calls'][i],
                 'records':s['records']-before['records'][i],
                 'callbackMs':round(s['callbackMs']-before['callbackMs'][i],3)}
                for i,s in enumerate(after['observers'])]
        assert not any(s['calls'] for s in deltas if s['heavy']),deltas
        assert sum(s['calls'] for s in deltas if not s['heavy'])<=3,deltas
        # Relative reference on the identical live DOM after an explicit Resume.
        page.locator('.cw-pause-toggle').click()
        page.wait_for_function('() => window.__observerStats.some(s=>s.heavy && s.active)')
        page.wait_for_timeout(140)  # exclude initial Resume/backfill from the batch
        active_before=page.evaluate('''() => window.__observerStats.map(s=>({calls:s.calls,callbackMs:s.callbackMs}))''')
        page.evaluate('''() => {const parent=document.querySelector('#stream');
          for(let i=0;i<1000;i++){const e=document.createElement('span');
            e.textContent='more streamed text';parent.appendChild(e);}}''')
        page.wait_for_timeout(140)
        active_after=page.evaluate('''() => window.__observerStats.map(s=>({calls:s.calls,callbackMs:s.callbackMs,heavy:s.heavy}))''')
        active_heavy_ms=sum(after['callbackMs']-before['callbackMs']
                            for before,after in zip(active_before,active_after)
                            if after['heavy'])
        paused_light_ms=sum(s['callbackMs'] for s in deltas if not s['heavy'])
        assert active_heavy_ms>=0,(active_before,active_after)
        assert not errors,errors
        print('PASS',suffix or 'stable',json.dumps({
            'writesDelta':after['writes']-before['writes'],
            'documentQueries':after['costs']['document'],
            'elementQueries':after['costs']['element'],
            'observerDeltas':deltas,'pausedLightCallbackMs':round(paused_light_ms,3),
            'activeHeavyCallbackMs':round(active_heavy_ms,3)},ensure_ascii=False),flush=True)
        page.close()
    browser.close()
