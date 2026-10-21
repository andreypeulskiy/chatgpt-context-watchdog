#!/usr/bin/env python3
"""200 same-target attribute records must not rescan a 9000-node tree.

The negative case measures the missing-composer path. The positive case proves
that the one search still detects an ancestor becoming visible in the SAME
batch, and that a later mutation batch can re-detect a change (no stale cache).
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
from support.current import VERSION

ROOT = Path(__file__).resolve().parents[1]
INIT = '''() => {
 window.__wdRoute={pathname:'/library',origin:'https://chatgpt.com',href:'https://chatgpt.com/library'};
 const data=new Map();
 Object.defineProperty(window,'localStorage',{configurable:true,value:{
   getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),
   removeItem:k=>data.delete(k),key:i=>[...data.keys()][i]??null,
   get length(){return data.size}
 }});
 window.__searchCosts={ancestorScans:0};
 const query=Element.prototype.querySelector;
 Element.prototype.querySelector=function(selector){
   if(this.id==='large' && selector.includes('main, form')) window.__searchCosts.ancestorScans++;
   return query.call(this,selector);
 };
 const NativeObserver=window.MutationObserver;
 window.__observerTimes=[];
 window.MutationObserver=class extends NativeObserver{
   constructor(fn){
     const times={heavy:null,callbackMs:0,calls:0};
     super((mutations,obs)=>{
       const start=performance.now();times.calls++;fn(mutations,obs);
       times.callbackMs+=performance.now()-start;
     });
     this.stats=times;window.__observerTimes.push(times);
   }
   observe(root,options){this.stats.heavy=!!options.characterData;return super.observe(root,options);}
 };
}'''
COMPOSER = '''<main><form data-chatgpt-composer>
 <div contenteditable="true" role="textbox" style="min-height:30px;width:100px"></div>
 <button type="button" data-testid="send-button">Send</button>
</form></main>'''

with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
     args=['--no-sandbox','--disable-dev-shm-usage'])
 for suffix in ('','.dev'):
  source=(ROOT/f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text()
  source=source.replace('(() => {','(() => {\nconst location=window.__wdRoute;',1)
  for mode in ('missing','unhide'):
   page=browser.new_page(viewport={'width':390,'height':840})
   errors=[];page.on('pageerror',lambda exc:errors.append(str(exc)))
   inner=COMPOSER if mode=='unhide' else '<span>not a chat</span>'
   page.set_content('<!doctype html><html><body><div id="large"' +
       (' hidden' if mode=='unhide' else '') + '>'+inner+'</div></body></html>')
   page.evaluate("""() => {const p=document.getElementById('large');
       const frag=document.createDocumentFragment();
       for(let i=0;i<9000;i++){const el=document.createElement('span');frag.appendChild(el);}
       p.appendChild(frag);} """)
   page.evaluate(INIT)
   page.add_script_tag(content=source)
   page.wait_for_function("() => document.querySelector('.cw-pause-toggle')?.disabled===true")
   base=page.evaluate('''() => ({queries:window.__searchCosts.ancestorScans,
       times:window.__observerTimes.map(x=>x.callbackMs)})''')
   page.evaluate('''mode=>{const p=document.getElementById('large');
       for(let i=0;i<200;i++)p.className='transition-'+i;
       if(mode==='unhide')p.removeAttribute('hidden');}''',mode)
   page.wait_for_timeout(90)
   result=page.evaluate('''() => ({queries:window.__searchCosts.ancestorScans,
     disabled:document.querySelector('.cw-pause-toggle').disabled,
     times:window.__observerTimes.map(x=>({heavy:x.heavy,ms:x.callbackMs,calls:x.calls}))})''')
   delta=result['queries']-base['queries']
   assert delta<=1,(suffix,mode,delta,result)
   assert result['disabled']==(mode=='missing'),(suffix,mode,result)
   assert not errors,errors
   print(f'PASS {suffix or "stable"} {mode}: 200 attributes / 9000 descendants / '
         f'ancestor scans={delta}, measured callback times={result["times"]}',flush=True)
   if mode=='unhide':
    # Later separate batch must see the ancestor disappear (no cached result).
    page.evaluate("document.getElementById('large').setAttribute('hidden','')")
    page.wait_for_function("() => document.querySelector('.cw-pause-toggle').disabled")
    page.evaluate("document.getElementById('large').removeAttribute('hidden')")
    page.wait_for_function("() => !document.querySelector('.cw-pause-toggle').disabled")
    assert not errors,errors
    print(f'PASS {suffix or "stable"}: visibility flips across separate batches',flush=True)
   page.close()
 browser.close()
