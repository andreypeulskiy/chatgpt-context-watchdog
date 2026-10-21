#!/usr/bin/env python3
"""Both brands share one interactive accent; favicon security remains untouched."""
import importlib.util
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('harness', ROOT/'tests/logo-tooltip-ui.py')
h=importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
SVG='''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180" fill="none"><style>:root { fill: #000; } @media (prefers-color-scheme: dark) { :root { fill: #fff; } }</style><path d="M20 20 L160 20 L90 160 Z"/></svg>'''
READ='''() => {
 const root=document.querySelector('[id$="-root"]');
 const chip=root.querySelector('.cw-chip');
 const mark=chip.querySelector('.cw-brand-mark');
 const icon=mark.querySelector('svg');
 const paths=[...icon.querySelectorAll('path')];
 return {focus:chip.matches(':focus-visible'), hover:root.querySelector('.cw-logo-hit').matches(':hover'),
   fill:getComputedStyle(paths[0]).fill, stroke:getComputedStyle(paths[0]).stroke,
   accent:getComputedStyle(root).getPropertyValue('--cw-accent').trim(),
   sanitized:mark.classList.contains('cw-has-site-logo'),
   tooltip:!!root.querySelector('.cw-floating-tip')};
}'''
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 count=0
 try:
  for variant in ('','.dev'):
   for theme in ('light','dark'):
    for brand in ('watchdog','chatgpt'):
     page,errors,requests=h.start(browser,variant,svg=SVG if brand=='chatgpt' else h.SAFE,result='hit' if brand=='chatgpt' else 'miss',width=600)
     page.wait_for_function('document.querySelector(".cw-chip .cw-brand-mark svg path") !== null')
     page.evaluate('''theme=>{const root=document.querySelector('[id$="-root"]');root.dataset.cwPalette=theme;
       root.style.left='50px';root.style.top='45px';root.style.right='auto';root.style.bottom='auto';}''',theme)
     page.add_style_tag(content='.cw-site-icon, .cw-watchdog-svg path, .cw-brand-mark {transition:none!important;}')
     page.mouse.move(570,650);page.wait_for_timeout(40)
     n=page.evaluate(READ)
     assert n['sanitized']==(brand=='chatgpt'),(brand,n)
     accent=page.evaluate('''()=>{const el=document.createElement('i');el.style.color='var(--cw-accent)';document.querySelector('[id$="-root"]').append(el);const v=getComputedStyle(el).color;el.remove();return v}''')
     assert accent.startswith('rgb('),('accent unresolved',accent)
     page.locator('.cw-logo-hit').hover();page.wait_for_timeout(80)
     hvr=page.evaluate(READ)
     assert hvr['hover'] and hvr['fill']!=n['fill'],(brand,theme,'no visible icon hover feedback',n,hvr)
     page.mouse.move(570,650);page.locator('.cw-chip').focus();page.wait_for_timeout(80)
     f=page.evaluate(READ)
     assert f['focus'] and f['fill']!=n['fill'],(brand,theme,'focus has no icon feedback',n,f)
     if brand=='chatgpt':
      assert n['fill'] not in ('transparent','rgba(0, 0, 0, 0)'),n
     assert len(page.evaluate('window.__cacheCalls'))==1 and not errors and not requests,(errors,requests)
     print('PASS',variant or 'Stable',brand,theme,'normal/hover/focus',flush=True)
     count+=1
     page.close()
 finally: browser.close()
print(f'PASS {count}/8 brand/theme/variant cases')
