#!/usr/bin/env python3
"""Budget progress semantics: six labeled bars, percent-to-fill, critical state and readable layout."""
import json
import re
from playwright.sync_api import sync_playwright
from support.current import SCRIPT

CHAT='11111111-1111-4111-8111-111111111111'
MSG='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
KEY='cgpt-context-watchdog:state:v2:chat%3A'+CHAT
HTML='''<!doctype html><html><body><main></main><form data-chatgpt-composer>
<textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button></form></body></html>'''
INJECTED=SCRIPT.replace('(() => {',
 f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
INIT='''items=>{
 const data=new Map(items);Object.defineProperty(window,'localStorage',{configurable:true,value:{
 getItem:k=>data.get(String(k))??null,setItem:(k,v)=>data.set(String(k),String(v)),
 removeItem:k=>data.delete(String(k)),key:i=>[...data.keys()][i]??null,get length(){return data.size}
 }});
}'''
JS='''() => {
 let root=document.querySelector('[id$="-root"]'), panel=root.querySelector('.cw-panel');
 let groups=[...panel.querySelectorAll('.cw-forecast-group')];
 let bars=[...panel.querySelectorAll('.cw-progress-grid > div')];
 return {
  heading:panel.querySelector('.cw-forecast-heading > strong').textContent,
  headings:groups.map(g=>g.querySelector('.cw-forecast-group-title').textContent),
  colors:groups.map(g=>getComputedStyle(g.querySelector('.cw-forecast-group-title')).color),
  bars:bars.map(b=>{
   let tr=b.querySelector('.cw-progress-track'),fill=tr.querySelector('.cw-progress-fill'),
       pct=tr.querySelector('.cw-progress-percent'),label=b.querySelector('.cw-context-note');
   let trackRect=tr.getBoundingClientRect(), textRect=pct.getBoundingClientRect();
   return {value:pct.textContent,name:label.textContent,
    aboveNamePercent:!!label.querySelector('strong'),
    onFill:pct.dataset.cwOnFill, fill:parseFloat(fill.style.width)||0,
    trackHeight:trackRect.height,trackWidth:trackRect.width, labelHeight:textRect.height,
    fillRendered: getComputedStyle(fill).display !== 'none' && (parseFloat(fill.style.width)===0 || (fill.getBoundingClientRect().width>0 && fill.getBoundingClientRect().height>0)),
    left:textRect.left-trackRect.left,right:trackRect.right-textRect.right,
    fillColor:getComputedStyle(fill).backgroundColor, fillOpacity:getComputedStyle(fill).opacity,
    accent:(()=>{const e=document.createElement('i');e.style.color='var(--cw-accent)';root.appendChild(e);const c=getComputedStyle(e).color;e.remove();return c})(),
    ink:getComputedStyle(pct).color,background:getComputedStyle(tr).backgroundColor,
    textFont:getComputedStyle(pct).fontSize,trackRadius:getComputedStyle(tr).borderRadius,
    overflow:tr.scrollWidth-tr.clientWidth};
  })
 };
}'''

def contrast(foreground, background):
    """Relative luminance of opaque computed colors, not a fixed palette token."""
    def luminance(css):
        values=[float(v) for v in re.findall(r'[\d.]+',css)[:3]]
        assert len(values)==3,(foreground,background)
        parts=[(v/255/12.92 if v/255<=.04045 else ((v/255+.055)/1.055)**2.4) for v in values]
        return sum(v*w for v,w in zip(parts,(.2126,.7152,.0722)))
    a,b=luminance(foreground),luminance(background)
    return (max(a,b)+.05)/(min(a,b)+.05)

def check(browser,width,tokens):
 page=browser.new_page(viewport={'width':width,'height':850})
 page.set_default_timeout(8000)
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 state={'chatKey':'chat:'+CHAT,'messages':{'msg:'+MSG:{'role':'user','tokens':tokens,'chars':tokens*2}},
   'files':{},'domImages':{},'attachmentLedgerVersion':2,'repairHistory':[],'updatedAt':0}
 page.set_content(HTML)
 page.evaluate(INIT,[[KEY,json.dumps(state)]])
 page.add_script_tag(content=INJECTED)
 page.locator('.cw-logo-hit').click()
 page.locator('.cw-tab-budget').click()
 for palette in ('light','dark'):
  for style in ('soft','sharp'):
   page.locator('[id$="-root"]').evaluate('(e,flags)=>{e.dataset.cwPalette=flags[0];e.dataset.cwStyle=flags[1]}',[palette,style])
   observed=page.evaluate(JS)
   assert observed['heading']=='Budget status',observed
   assert observed['headings']==['Optimistic use','Pessimistic use'],observed
   assert len(observed['bars'])==6,observed
   values=[]
   for b in observed['bars']:
    assert b['name'] in ('Conservative','Normal','Generous') and not b['aboveNamePercent'],b
    value=int(b['value'].removesuffix('%')); values.append(value)
    assert b['value']==f'{value}%' and 0<=b['fill']<=100,b
    assert abs(b['fill']-max(0,min(100,value)))<.01,b
    assert b['trackHeight']>0 and b['labelHeight']>0 and b['textFont']!='0px',b
    assert b['left']>=-1 and b['right']>=-1 and b['overflow']<=1,b
    assert b['trackWidth']>0 and b['fillRendered'],b
    assert b['onFill']==('true' if b['fill']>=35 else 'false'),b
    assert b['ink']!='transparent' and contrast(b['ink'], b['fillColor'] if b['onFill']=='true' else b['background'])>=2.4,b
    if value>100:
     assert b['fillColor']!=b['accent'],b
     rgb=tuple(int(v.strip()) for v in b['fillColor'].removeprefix('rgb(').removesuffix(')').split(','))
     assert rgb[0]>rgb[1] and rgb[0]>rgb[2],b  # critical fill reads as red
    else:
     assert b['fillColor']!='transparent' and b['fillColor']!=b['background'],b  # visible noncritical fill
    assert 0<float(b['fillOpacity'])<=1,b
   if tokens>=100000:
    assert any(v>100 for v in values),(width,tokens,values)
    assert any(v<100 for v in values),(width,tokens,values)
   if tokens<100:
    assert all(v<35 for v in values),(width,tokens,values)
  # Status remains a distinct colored signal. Labels do not inherit it.
  assert not errors,errors
 print(f'PASS budget at {width}px · {tokens} tokens · Light/Dark · Soft/Sharp',flush=True)
 page.close()

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
  args=['--no-sandbox','--disable-dev-shm-usage'])
 for width,tokens in ((320,110000),(390,110000),(1200,110000),(390,1)):
  check(browser,width,tokens)
 browser.close()
