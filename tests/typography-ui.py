#!/usr/bin/env python3
"""Verify readable navigation and numeric inputs without pinning font tokens."""
from playwright.sync_api import sync_playwright
from support.current import SCRIPT

CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main></main>
<form data-chatgpt-composer><textarea id="prompt-textarea"></textarea>
<button data-testid="send-button">Send</button></form></body></html>'''
INJECTED=SCRIPT.replace('(() => {',
    f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)

NAV_JS='''sel=>{
 const nav=document.querySelector(sel), buttons=[...nav.querySelectorAll('.cw-mini-tab')];
 const bounds=nav.getBoundingClientRect();
 return {count:buttons.length,
  inside:buttons.every(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=bounds.left-1&&r.right<=bounds.right+1;}),
  separate:buttons.every((b,i)=>i===0||buttons[i-1].getBoundingClientRect().right<=b.getBoundingClientRect().left+0.5),
  readable:buttons.every(b=>{const s=getComputedStyle(b);return b.textContent.trim()&&s.visibility==='visible'&&s.display!=='none'&&parseFloat(s.opacity)>0&&parseFloat(s.fontSize)>=8;}),
  oneRow:buttons.every(b=>Math.abs(b.getBoundingClientRect().top-buttons[0].getBoundingClientRect().top)<=5),
 };
}'''
FIELD_JS=r'''sel=>{
 const e=document.querySelector(sel),label=e.closest('label'),s=getComputedStyle(e),l=getComputedStyle(label);
 const r=e.getBoundingClientRect(),caption=label.querySelector('.cw-field-caption')||label.querySelector('span');
 const cs=caption?getComputedStyle(caption):l;
 const colorVisible=st=>{const c=st.color;return st.visibility==='visible'&&st.display!=='none'&&parseFloat(st.opacity)>0&&!/^rgba\([^)]*,\s*0\s*\)$/.test(c)&&c!=='transparent';};
 const fontPx=parseFloat(s.fontSize),labelPx=parseFloat(cs.fontSize);
 const pad=parseFloat(s.paddingLeft)+parseFloat(s.paddingRight);
 const c=document.createElement('canvas').getContext('2d');c.font=s.font;
 return {fontPx,labelPx,height:r.height,width:r.width,usableWidth:e.clientWidth-pad,
  requiredWidth:c.measureText('000000').width,readable:colorVisible(s)&&colorVisible(cs),
  labelText:label.textContent.trim(),visible:r.width>0&&r.height>0};
}'''

def check_nav(page, selector, kind):
    result=page.evaluate(NAV_JS, selector)
    assert result['count']>=2 and result['inside'] and result['separate'], (kind,result)
    assert result['oneRow'] and result['readable'], (kind,result)

def check_field(page, selector):
    field=page.evaluate(FIELD_JS,selector)
    assert field['visible'] and field['readable'] and field['labelText'], field
    # Layout contract: text has room in both axes; no exact font/height/padding values.
    assert field['fontPx']>=8 and field['labelPx']>=8, field
    assert field['height']>field['fontPx']*1.3, field
    assert field['usableWidth']>=field['requiredWidth'], field

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
    args=['--no-sandbox','--disable-dev-shm-usage'])
 for width in (320,350,390,1200):
  page=browser.new_page(viewport={'width':width,'height':850})
  page.set_default_timeout(8000)
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(HTML)
  page.add_script_tag(content=INJECTED)
  page.locator('.cw-logo-hit').click()
  for skin in ('soft','sharp'):
   page.locator('[id$="-root"]').evaluate('(e,skin)=>e.dataset.cwStyle=skin',skin)
   main=page.locator('.cw-tabs').evaluate('''e=>{const b=[...e.querySelectorAll('button')];const r=e.getBoundingClientRect();return {
     overflow:e.scrollWidth-e.clientWidth,
     readable:b.every(x=>{let s=getComputedStyle(x),q=x.getBoundingClientRect();return x.textContent.trim()&&s.visibility==='visible'&&parseFloat(s.fontSize)>=8&&q.width>0&&q.left>=r.left-1&&q.right<=r.right+1;}),
     oneRow:b.every(x=>Math.abs(x.getBoundingClientRect().top-b[0].getBoundingClientRect().top)<=5)};}''')
   assert main['readable'] and main['oneRow'] and main['overflow']<=1,(width,skin,main)
   check_nav(page,'.cw-estimation-settings .cw-mini-nav','Context navigation')
   if not page.locator('.cw-text-settings-details').is_visible():
    page.locator('[data-cw-mini="text"]').click()
   check_field(page,'.cw-estimation-settings .cw-config-form input[type="number"]')
   page.locator('.cw-tab-budget').click()
   check_nav(page,'.cw-budget-mini-nav','Budget navigation')
   page.locator('.cw-tab-context').click()
  # The Technical form must remain readable in both palettes and shapes.
  page.locator('.cw-settings-btn').click()
  page.locator('[data-cw-tools="technical"]').click()
  check_nav(page,'.cw-tools-nav','Settings navigation')
  for skin in ('soft','sharp'):
   for palette in ('light','dark'):
    page.locator('[id$="-root"]').evaluate('(e,p)=>{e.dataset.cwStyle=p[0];e.dataset.cwPalette=p[1]}',[skin,palette])
    check_field(page,'.cw-settings .cw-hidden-optimistic')
  page.locator('.cw-close-settings').click()
  page.locator('.cw-tab-details').click()
  # Visual roles: muted Details caption must retain >=3:1 contrast against
  # the painted panel background in both themes (no fixed RGB token names).
  for palette in ('light','dark'):
   page.locator('[id$="-root"]').evaluate('(e,v)=>e.dataset.cwPalette=v',palette)
   contrast=page.locator('.cw-details-header > span').evaluate(r'''el=>{const parse=s=>{const m=s.match(/rgba?\(([^)]+)\)/);return m?m[1].split(',').map(Number):null};
     const text=parse(getComputedStyle(el).color),panel=getComputedStyle(el.closest('.cw-panel'));
     const paper=parse(panel.backgroundColor),a=(paper[3]===undefined?1:paper[3]);
     // Chromium's transparent synthetic host document paints on white.
     const bg=paper.slice(0,3).map(v=>v*a+255*(1-a));
     const l=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
     const x=l(text),y=l(bg);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
   }''')
   assert contrast>=3.0,(palette,'Muted Details caption contrast',contrast)
  for selector in ('.cw-details-header > span','.cw-details-report','.cw-copy-details'):
   info=page.locator(selector).evaluate('''e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {
    visible:r.width>0&&r.height>0&&s.visibility==='visible'&&parseFloat(s.opacity)>0,
    font:parseFloat(s.fontSize),overflow:e.scrollWidth-e.clientWidth,text:e.textContent.trim()};}''')
   assert info['visible'] and info['font']>=8 and info['overflow']<=1,(width,selector,info)
  assert not errors,errors
  print(f'PASS typography {width}px: Soft/Sharp · Light/Dark · no nav clipping',flush=True)
  page.close()
 browser.close()
