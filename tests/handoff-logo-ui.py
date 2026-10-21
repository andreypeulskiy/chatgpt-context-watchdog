#!/usr/bin/env python3
"""b16: logo is shown in panel only for Watchdog; HANDOFF label retains accessible name."""
from pathlib import Path
import importlib.util
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('logo_harness',ROOT/'tests/logo-tooltip-ui.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
OFFICIAL='''<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180" fill="none"><style>:root { fill: #000; } @media (prefers-color-scheme: dark) { :root { fill: #fff; } }</style><path d="M20 20 L160 20 L90 160 Z"/></svg>'''

def brand(p):
 return p.evaluate('''() => {const el=document.querySelector('.cw-title-info .cw-brand-mark');const r=el.getBoundingClientRect();return {hidden:el.hidden, display:getComputedStyle(el).display, width:r.width, svg:el.querySelectorAll('svg').length, paths:el.querySelectorAll('path').length, preference:(()=>{for(const key of Object.keys(localStorage)){try{const a=JSON.parse(localStorage.getItem(key));if(a.logoPreference)return a.logoPreference}catch{}}return 'openai' })()}}''')

def verify_header(p,expected):
 s=brand(p)
 assert s['hidden']==(expected=='hidden'),s
 if expected=='hidden':assert s['display']=='none' and s['width']==0,s
 else:
  assert s['display']!='none' and s['paths']==3,s
  # The parent panel may still be hidden before its first open.
  if p.locator('.cw-panel').is_visible():assert s['width']>0,s

def test_logo(browser,suffix,palette,mode):
 name='Dev' if suffix else 'Stable'
 p,errors,requests=h.start(browser,suffix,result='hit' if mode=='official' else mode,svg=OFFICIAL,width=500)
 p.evaluate('(v)=>document.querySelector("[id$=-root]").dataset.cwPalette=v',palette)
 if mode=='official':
  p.wait_for_function('document.querySelector(".cw-site-icon.cw-has-site-logo svg path")?.getAttribute("d")==="M20 20 L160 20 L90 160 Z"')
  verify_header(p,'hidden')
  assert p.locator('.cw-chip .cw-watchdog-svg').count()==0
 else:
  p.wait_for_function('document.querySelector(".cw-chip .cw-watchdog-svg")!==null')
  if mode=='miss':p.wait_for_function('''()=>Array.from({length:localStorage.length},(_,i)=>localStorage.getItem(localStorage.key(i))).some(s=>s?.includes('"logoPreference":"watchdog"'))''')
  verify_header(p,'visible' if mode=='miss' else 'hidden')
 p.locator('.cw-logo-hit').click()
 verify_header(p,'visible' if mode=='miss' else 'hidden')
 p.locator('.cw-settings-btn').click()
 p.locator('[data-cw-tools="view"]').click()
 p.locator('[data-cw-view-logo="watchdog"]').click()
 verify_header(p,'visible')
 assert p.locator('.cw-chip .cw-watchdog-svg > path').count()==3
 before=len(p.evaluate('window.__cacheCalls'))
 assert before==(1 if mode!='deferred' else 1)
 p.locator('[data-cw-view-logo="openai"]').click()
 # A cache miss settles in the same microtask queue as the click; the
 # selected Watchdog fallback can already be active when Playwright resumes.
 if mode!='miss':verify_header(p,'hidden')
 assert len(p.evaluate('window.__cacheCalls'))==2
 if mode=='official':
  p.wait_for_function('document.querySelector(".cw-site-icon.cw-has-site-logo svg path")!==null')
  verify_header(p,'hidden')
 elif mode=='miss':
  p.wait_for_function('''()=>Array.from({length:localStorage.length},(_,i)=>localStorage.getItem(localStorage.key(i))).some(s=>s?.includes('"logoPreference":"watchdog"'))''')
  verify_header(p,'visible')
 else:
  # First pending lookup and second lookup are still in flight; only choice controls header.
  verify_header(p,'hidden')
  p.evaluate('window.__pending.shift()(new Response("",{status:504}))')
  p.wait_for_timeout(30)
  verify_header(p,'hidden')
  p.evaluate('(s) => window.__pending.shift()(new Response(s,{status:200,headers:{"Content-Type":"image/svg+xml"}}))',OFFICIAL)
  p.wait_for_function('document.querySelector(".cw-site-icon.cw-has-site-logo svg")!==null')
  verify_header(p,'hidden')
 # Reset preference to Watchdog; the panel header must reappear immediately.
 p.locator('[data-cw-view-logo="watchdog"]').click();verify_header(p,'visible')
 assert not errors and not requests,(name,palette,mode,errors,requests)
 print(f'PASS LOGO {name} {palette} {mode}: preference, displayed header, fallback, cache-only, no real requests')
 p.close()

def test_handoff(browser,suffix,width):
 name='Dev' if suffix else 'Stable'
 p,errors,requests=h.start(browser,suffix,svg=OFFICIAL,width=width)
 p.locator('.cw-logo-hit').click();p.locator('.cw-settings-btn').click()
 p.locator('[data-cw-tools="technical"]').click()
 section=p.locator('.cw-handoff-editor'); section.locator('summary').click()
 assert section.locator('.cw-handoff-caption').count()==0
 assert section.locator('label').count()==0
 assert section.locator('summary').inner_text().strip()=='HANDOFF prompt'
 textarea=section.get_by_role('textbox',name='Global HANDOFF prompt')
 assert textarea.count()==1
 assert textarea.get_attribute('aria-label')=='Global HANDOFF prompt'
 assert textarea.get_attribute('maxlength')=='4000'
 original=textarea.input_value()
 assert len(original)>100
 textarea.fill('QA custom prompt')
 assert section.locator('.cw-handoff-unsaved').is_visible()
 assert '16 / 4000' in section.locator('.cw-handoff-counter').inner_text()
 section.locator('.cw-save-handoff').click()
 assert section.locator('.cw-handoff-unsaved').is_hidden()
 assert textarea.input_value()=='QA custom prompt'
 p.locator('[data-cw-tools="view"]').click();p.locator('[data-cw-tools="technical"]').click()
 assert textarea.input_value()=='QA custom prompt'
 section.locator('.cw-restore-handoff').click()
 confirm=p.locator('.cw-confirm-dialog');assert confirm.evaluate('(el)=>el.open')
 confirm.locator('.cw-confirm-ok').click()
 assert textarea.input_value()==original
 assert section.locator('.cw-handoff-unsaved').is_visible()
 assert not errors and not requests,(name,width,errors,requests)
 print(f'PASS HANDOFF {name} {width}: redundant caption removed, accessible textarea, edit/save/restore/nested confirm')
 p.close()

with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 try:
  for suffix in ('','.dev'):
   for palette in ('light','dark'):
    for mode in ('official','miss','deferred'):
     test_logo(browser,suffix,palette,mode)
   for width in (390,1200):test_handoff(browser,suffix,width)
 finally:browser.close()
