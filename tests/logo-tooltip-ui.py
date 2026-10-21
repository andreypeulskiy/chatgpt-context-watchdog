#!/usr/bin/env python3
"""Cache-only icon preference, fallback behavior and tooltip stacking.

Synthetic ChatGPT DOM and mocked fetch only; never reads the real network/cache.
"""
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
VERSION = re.search(r'^// @version\s+(\S+)$', (ROOT/'src/userscript-header.txt').read_text(), re.M).group(1)
SAFE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M1 1 L19 1 L10 19 Z"/></svg>'
SAFE_B = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M2 2 L18 2 L10 18 Z"/></svg>'
HTML = '''<!doctype html><html><head></head><body>
<main></main><form data-chatgpt-composer><textarea></textarea><button type="button" data-testid="send-button">Send</button></form></body></html>'''
MOCK = r'''arg => {
  const store = new Map();
  Object.defineProperty(window, 'localStorage', {configurable:true, value:{
    getItem:k=>store.get(String(k))??null,
    setItem:(k,v)=>store.set(String(k),String(v)),
    removeItem:k=>store.delete(String(k)),
    key:i=>[...store.keys()][i]??null,
    get length(){return store.size}
  }});
  window.__cacheCalls=[];
  window.__result=arg.result;
  window.__shape=arg.svg;
  window.__requests=[];
  window.__pending=[];
  window.fetch=(url, options) => {
    window.__cacheCalls.push({url,options});
    if (window.__result==='deferred') return new Promise(resolve=>window.__pending.push(resolve));
    if (window.__result==='error') return Promise.reject(Error('cache error'));
    if (window.__result==='miss') return Promise.resolve(new Response('', {status:504}));
    return Promise.resolve(new Response(window.__shape, {status:200, headers:{'Content-Type':'image/svg+xml'}}));
  };
  if (arg.serviceWorker) Object.defineProperty(navigator, 'serviceWorker', {
    configurable:true, value:{controller:{state:'activated'}}
  });
  for (const candidate of (arg.icons ?? ['/cdn/assets/favicon.testabc123.svg'])) {
    const link = document.createElement('link');
    link.rel = typeof candidate === 'string' ? 'icon' : (candidate.rel || 'icon');
    link.type = typeof candidate === 'string' ? 'image/svg+xml' : (candidate.type || 'image/svg+xml');
    link.href = typeof candidate === 'string' ? candidate : candidate.href;
    document.head.appendChild(link);
  }
  if (arg.withDomLogo) {
    const btn = document.createElement('button');
    btn.setAttribute('data-app-shell-sidebar-trigger','true');
    btn.innerHTML='<svg viewBox="0 0 20 20"><path d="M0 0 L20 20"/></svg>';
    document.body.appendChild(btn);
  }
}'''
ROUTE = "{origin:'https://chatgpt.com',protocol:'https:',href:'https://chatgpt.com/c/11111111-1111-4111-8111-111111111111',pathname:'/c/11111111-1111-4111-8111-111111111111'}"


def start(browser, suffix='', result='hit', svg=SAFE, sw=False, dom=False, width=390, icons=None):
    p = browser.new_page(viewport={'width':width,'height':760})
    p.set_default_timeout(7000)
    errors=[]; requests=[]
    p.on('pageerror',lambda e:errors.append(str(e)))
    p.on('request',lambda r:requests.append(r.url))
    # Test fixtures must never load page-provided icons over the network;
    # the userscript's cache-only fetch remains explicitly mocked below.
    p.route('**/*', lambda route: route.abort())
    p.set_content(HTML)
    p.evaluate(MOCK, {'result':result, 'svg':svg, 'serviceWorker':sw, 'withDomLogo':dom, 'icons':icons})
    script=(ROOT/'dist'/f'chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text()
    p.add_script_tag(content=script.replace('(() => {',f'(() => {{\nconst location={ROUTE};',1))
    p.locator('.cw-site-icon').wait_for()
    return p,errors,requests


def get_saved(p):
    return p.evaluate('''() => {
      for(let i=0;i<localStorage.length;i++) {
        const x=localStorage.getItem(localStorage.key(i));
        try {const v=JSON.parse(x);if(v?.logoPreference)return v.logoPreference;}catch{}
      }
      return null;
    }''')


def options(p):
    p.locator('.cw-logo-hit').click()
    p.locator('.cw-settings-btn').click()
    p.locator('[data-cw-tools="view"]').click()
    return p.locator('.cw-view-preferences')


def verify(browser, suffix):
    name='Dev' if suffix else 'Stable'
    p,errors,requests=start(browser,suffix)
    p.wait_for_function('document.querySelector(".cw-site-icon svg path")?.getAttribute("d") === "M1 1 L19 1 L10 19 Z"')
    o=options(p)
    assert o.locator('[data-cw-view-logo="openai"]').inner_text()=='ChatGPT'
    assert o.locator('[data-cw-view-logo="openai"]').get_attribute('aria-pressed')=='true'
    assert get_saved(p) in (None,'openai'),get_saved(p)
    assert p.evaluate('window.__cacheCalls') == [{'url':'https://chatgpt.com/cdn/assets/favicon.testabc123.svg','options':{'mode':'same-origin','cache':'only-if-cached','credentials':'same-origin','redirect':'error'}}]
    o.locator('[data-cw-view-logo="watchdog"]').click()
    assert o.locator('[data-cw-view-logo="watchdog"]').get_attribute('aria-pressed')=='true'
    assert get_saved(p)=='watchdog'
    assert p.locator('.cw-chip .cw-watchdog-svg path').count()==3
    assert p.evaluate('window.__cacheCalls.length')==1
    o.locator('[data-cw-view-logo="openai"]').click()
    p.wait_for_function('document.querySelector(".cw-site-icon svg path") !== null')
    assert p.evaluate('window.__cacheCalls.length')==2, 'manual re-select must retry once'
    assert get_saved(p)=='openai'
    # Appearance tooltip text and About disclosure are consistent with cache-only behavior.
    assert 'cached favicon only' in o.locator('[data-cw-view-logo="openai"]').get_attribute('data-cw-tip')
    p.locator('.cw-close-settings').click()
    p.locator('.cw-about-btn').click()
    about=p.locator('.cw-about-dialog')
    about.locator('.cw-about-section').first.locator('summary').click()
    assert 'only-if-cached' in about.inner_text() and 'Service Worker' in about.inner_text()
    assert not p.evaluate('''() => Array.from({length:localStorage.length},(_,i)=>localStorage.getItem(localStorage.key(i))).some(s=>s.includes('M1 1 L19'))''')
    assert not errors and not requests,(errors,requests)
    p.close()
    print(f'PASS {name}: cache hit, new label, manual choices, retry once, persistence, About, no network',flush=True)

    for result,sw,dom,svg,fetches in [
      ('miss',False,False,SAFE,1),('error',False,False,SAFE,1),
      ('hit',True,False,SAFE,0),('miss',False,True,SAFE,1),
      ('hit',False,False,'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><script>alert(1)</script></svg>',1),
    ]:
      p,errors,requests=start(browser,suffix,result=result,svg=svg,sw=sw,dom=dom)
      p.wait_for_function('''() => Array.from({length:localStorage.length},(_,i)=>localStorage.getItem(localStorage.key(i)))
            .some(s=>s && s.includes('"logoPreference":"watchdog"'))''')
      assert get_saved(p)=='watchdog',(result,sw,dom)
      assert p.locator('.cw-chip .cw-watchdog-svg path').count()==3,(result,sw,dom)
      assert p.evaluate('window.__cacheCalls.length')==fetches,(result,sw,dom)
      o=options(p)
      assert o.locator('[data-cw-view-logo="watchdog"]').get_attribute('aria-pressed')=='true'
      assert not errors and not requests,(errors,requests)
      p.close()
    print(f'PASS {name}: confirmed miss/error/SW/hostile SVG switch; DOM ignored',flush=True)

    p,errors,requests=start(browser,suffix,result='deferred')
    assert p.evaluate('window.__cacheCalls.length')==1
    o=options(p)
    o.locator('[data-cw-view-logo="watchdog"]').click()
    o.locator('[data-cw-view-logo="openai"]').click()
    assert p.evaluate('window.__cacheCalls.length')==2
    # First, obsolete cache miss: must not overwrite the later manual preference.
    p.evaluate('window.__pending.shift()(new Response("",{status:504}))')
    p.wait_for_timeout(50)
    assert o.locator('[data-cw-view-logo="openai"]').get_attribute('aria-pressed')=='true'
    p.evaluate('(s) => window.__pending.shift()(new Response(s,{status:200,headers:{"Content-Type":"image/svg+xml"}}))',SAFE_B)
    p.wait_for_function('document.querySelector(".cw-site-icon svg path")?.getAttribute("d") === "M2 2 L18 2 L10 18 Z"')
    assert get_saved(p)=='openai'
    assert not errors and not requests,(errors,requests)
    p.close()
    print(f'PASS {name}: in-flight obsolete miss ignored after user selection',flush=True)

    p,errors,requests=start(browser,suffix)
    p.wait_for_function('document.querySelector(".cw-site-icon svg") !== null')
    p.locator('.cw-logo-hit').click()
    btn=p.locator('.cw-handoff-details')
    btn.hover()
    p.wait_for_timeout(720)
    tip=p.locator('#cw-tip-handoff');tabs=p.locator('.cw-tabs')
    assert tip.is_visible(), 'HANDOFF hover tooltip not visible'
    state=p.evaluate('''() => {
      const tool=document.querySelector('#cw-tip-handoff');
      const header=document.querySelector('.cw-title');
      const tabs=document.querySelector('.cw-tabs');
      const a=tool.getBoundingClientRect(),b=tabs.getBoundingClientRect();
      const x=Math.max(a.left,b.left)+Math.min(a.right,b.right)-Math.max(a.left,b.left); // see overlap below
      const left=Math.max(a.left,b.left),right=Math.min(a.right,b.right);
      const top=Math.max(a.top,b.top),bottom=Math.min(a.bottom,b.bottom);
      let topElement=null;
      if(right>left && bottom>top) {
        tool.style.pointerEvents='auto';
        topElement=document.elementFromPoint((left+right)/2,(top+bottom)/2);
      }
      return {headerPosition:getComputedStyle(header).position,headerZ:getComputedStyle(header).zIndex,
        overlap:Math.max(0,right-left)*Math.max(0,bottom-top),
        tooltipOnTop:topElement===tool || tool.contains(topElement),
        tooltipZ:getComputedStyle(tool).zIndex};
    }''')
    assert state['headerPosition']=='relative' and state['headerZ']=='2',state
    assert state['overlap']>0 and state['tooltipOnTop'],state
    assert not errors and not requests,(errors,requests)
    p.close()
    print(f'PASS {name}: HANDOFF tooltip paints above overlapping tab region',flush=True)


def verify_filename_independence(browser, suffix):
    # Exercise the real bundled resolver and negative controls on a synthetic page.
    name = 'Dev' if suffix else 'Stable'
    valid = [
        'favicon-light.2e21f504de.svg',
        'chatgpt-favicon-v3.abcdef.svg',
        'favicon-dark-new.svg',
        'favicon.svg',
        'arbitrary.asset-name_v7.svg',
    ]
    safe_options = {
        'mode': 'same-origin', 'cache': 'only-if-cached',
        'credentials': 'same-origin', 'redirect': 'error'
    }
    for filename in valid:
        href = f'/cdn/assets/{filename}'
        p, errors, requests = start(browser, suffix, icons=[href])
        p.wait_for_function('document.querySelector(".cw-site-icon svg path")?.getAttribute("d") === "M1 1 L19 1 L10 19 Z"')
        assert p.evaluate('window.__cacheCalls') == [{
            'url': f'https://chatgpt.com{href}', 'options': safe_options
        }], (filename, p.evaluate('window.__cacheCalls'))
        assert get_saved(p) in (None, 'openai'), filename
        assert not errors and not requests, (filename, errors, requests)
        p.close()
    print(f'PASS {name}: all 5 filename variants, including four requested, use only cache-only fetch', flush=True)

    denied = {
        'outside-directory': ['/other/favicon.svg'],
        'nested-directory': ['/cdn/assets/sub/favicon.svg'],
        'other-origin': ['https://evil.example/cdn/assets/favicon.svg'],
        'http-downgrade': ['http://chatgpt.com/cdn/assets/favicon.svg'],
        'non-svg-extension': ['/cdn/assets/favicon.png'],
        'query': ['/cdn/assets/favicon.svg?token=x'],
        'fragment': ['/cdn/assets/favicon.svg#hash'],
        'encoded-separator': ['/cdn/assets/favicon%2Fsecret.svg'],
        'encoded-dot': ['/cdn/assets/favicon%2Esvg'],
        'dot-segment': ['/cdn/assets/../assets/favicon.svg'],
        'self-segment': ['/cdn/assets/./favicon.svg'],
        'ambiguous-icons': ['/cdn/assets/favicon.svg', '/cdn/assets/favicon-dark.svg'],
        'not-rel-icon': [{'href':'/cdn/assets/favicon.svg', 'rel':'stylesheet'}],
        'no-links': [],
    }
    for case, links in denied.items():
        p, errors, requests = start(browser, suffix, icons=links)
        p.wait_for_function('''() => Array.from({length:localStorage.length}, (_,i)=>localStorage.getItem(localStorage.key(i)))
          .some(s => s && s.includes('"logoPreference":"watchdog"'))''')
        assert get_saved(p) == 'watchdog', (case, get_saved(p))
        assert p.evaluate('window.__cacheCalls') == [], (case, p.evaluate('window.__cacheCalls'))
        # Browsers may independently request a <link rel=icon> URL; those
        # browser-originated requests are blocked by the test route above.
        # The security property here is that Watchdog never called fetch.
        assert not errors, (case, errors)
        p.close()
    print(f'PASS {name}: all 14 invalid/ambiguous favicon URLs rejected by Watchdog without fetch', flush=True)

    p, errors, requests = start(browser, suffix, icons=['/cdn/assets/favicon.svg'] * 2)
    p.wait_for_function('document.querySelector(".cw-site-icon svg path")?.getAttribute("d") === "M1 1 L19 1 L10 19 Z"')
    assert len(p.evaluate('window.__cacheCalls')) == 1
    assert not errors and not requests, (errors, requests)
    p.close()
    print(f'PASS {name}: identical duplicate rel=icon entries deduplicated', flush=True)


if __name__=='__main__':
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        try:
            for suffix in ('','.dev'):
                verify(browser,suffix)
                verify_filename_independence(browser,suffix)
        finally:browser.close()
