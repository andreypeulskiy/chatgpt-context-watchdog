#!/usr/bin/env python3
""" UI-only regression in Chromium against a synthetic ChatGPT document."""
from playwright.sync_api import sync_playwright
from support.current import SCRIPT, BUNDLE_KIND

CHAT='11111111-1111-4111-8111-111111111111'
MSG='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
HTML=f'''<!doctype html><html><body><main>
<section data-chatgpt-search-unit-key="unit1:user" data-chatgpt-search-message-ids="{MSG}">
<div class="whitespace-pre-wrap"> finished user message. {'Text. '*25}</div></section>
</main><form data-chatgpt-composer><button type="button" data-testid="send-button">Send</button></form>
</body></html>'''
INIT='''() => {
  const data=new Map();
  Object.defineProperty(window,'localStorage',{configurable:true,value:{
    getItem:k=>data.get(String(k))??null,setItem:(k,v)=>data.set(String(k),String(v)),
    removeItem:k=>data.delete(String(k)),key:i=>[...data.keys()][i]??null,
    get length(){return data.size}
  }});
  window.confirm=()=>{throw Error('native confirm used')};
}'''
INJECTED=SCRIPT.replace('(() => {',
    f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)

def check(browser,width):
    page=browser.new_page(viewport={'width':width,'height':800})
    page.set_default_timeout(8000)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(HTML)
    page.evaluate(INIT)
    page.add_script_tag(content=INJECTED)
    if width==1200:
        page.locator('[id$="-root"]').evaluate('''e=>{
          e.style.left='40px';e.style.top='40px';e.style.right='auto';e.style.bottom='auto';
        }''')
    chip=page.locator('.cw-chip')
    chip.hover()
    page.wait_for_timeout(580)
    assert page.locator('.cw-floating-tip').is_visible(), 'Badge tooltip missing while closed'
    chip.locator('.cw-logo-hit').click()
    panel=page.locator('.cw-panel')
    assert panel.is_visible()
    assert not page.locator('.cw-floating-tip').is_visible(), 'Badge tip remained after opening'
    page.mouse.move(0,0)
    chip.hover()
    page.wait_for_timeout(580)
    assert not page.locator('.cw-floating-tip').is_visible(), 'Badge tip visible with panel open'
    if width==1200:
        assert page.evaluate('''()=>{
          const c=document.querySelector('.cw-chip').getBoundingClientRect();
          const p=document.querySelector('.cw-panel').getBoundingClientRect();
          return Math.abs(p.left-c.left)<=5 && p.top>=c.bottom-4 && p.top<=c.bottom+24;
        }'''), 'Panel must open below badge at desktop width'
    assert page.evaluate('''()=>{
      const p=document.querySelector('.cw-panel').getBoundingClientRect();
      return p.left>=0 && p.right<=innerWidth && p.top>=0 && p.bottom<=innerHeight+1;
    }'''), 'Panel outside viewport'

    # Both shapes: labels and interactive tabs must remain visible and inside the navigation.
    for skin in ('soft', 'sharp'):
        page.locator('[id$="-root"]').evaluate('(e, skin) => {e.dataset.cwStyle=skin}',skin)
        nav=page.locator('.cw-estimation-settings .cw-mini-nav').evaluate('''e=>{let a=[...e.querySelectorAll('button')],r=e.getBoundingClientRect();return a.length>=2&&a.every(b=>{let q=b.getBoundingClientRect(),s=getComputedStyle(b);return b.innerText.trim()&&q.width>0&&q.height>0&&q.left>=r.left-1&&q.right<=r.right+1&&parseFloat(s.fontSize)>=8;})}''')
        assert nav, f'{skin}: navigation is clipped or illegible'
    page.locator('[id$="-root"]').evaluate('(e) => {e.dataset.cwStyle="soft"}')

    accounting=page.locator('.cw-data-attachment')
    assert accounting.locator('.cw-data-quality').inner_text()=='0 parsed · 0 unparsed · 0 auto-paste'
    assert accounting.locator('.cw-data-quality-extra').inner_text()=='0 React metadata · 0 metadata-only'
    assert page.evaluate('''()=>{
      return [...document.querySelectorAll('.cw-file-accounting-row,.cw-file-accounting-continuation')]
        .every(el=>el.getBoundingClientRect().height>0 && el.scrollWidth<=el.clientWidth+1);
    }'''), 'File accounting clipped or wrapped'

    # Notifications share the upper header row with LOCAL status; no third lane.
    page.locator('.cw-handoff-details').click()
    toast=page.locator('.cw-toast')
    assert toast.is_visible()
    assert page.evaluate('''()=>{
      const p=document.querySelector('.cw-panel');
      const n=p.querySelector('.cw-notice-lane');
      const t=p.querySelector('.cw-toast');
      const r=n.getBoundingClientRect(),tabs=p.querySelector('.cw-tabs').getBoundingClientRect();
      const title=p.querySelector('.cw-title').getBoundingClientRect();
      const s=getComputedStyle(t);
      return n.parentElement.classList.contains('cw-title') &&
        r.top>=title.top && r.bottom<=tabs.top+1 &&
        r.right<=p.getBoundingClientRect().right+1 &&
        t.getBoundingClientRect().height>0 && s.visibility==='visible';
    }'''), 'Notification must share the header without overlap'
    page.locator('[data-cw-mini="text"]').click()
    assert toast.is_visible(), 'Notification should survive Context mini-navigation'

    # Reset uses an in-app confirmation dialog; cancel must preserve Settings.
    page.locator('.cw-settings-btn').click()
    settings=page.locator('.cw-settings-dialog:not(.cw-confirm-dialog):not(.cw-about-dialog):not(.cw-limit-dialog)')
    assert settings.evaluate('e=>e.open')
    page.locator('.cw-reset-chat').click()
    dialog=page.locator('.cw-confirm-dialog')
    assert dialog.evaluate('e=>e.open')
    cancel=dialog.locator('.cw-cancel-confirm')
    ok=dialog.locator('.cw-confirm-ok')
    assert cancel.is_visible() and ok.is_visible()
    cancel.click()
    assert not dialog.evaluate('e=>e.open') and settings.evaluate('e=>e.open')
    # The Technical field and actions remain legible and operable in either theme/shape.
    page.locator('[data-cw-tools="technical"]').click()
    inp=settings.locator('input[type="number"]').first
    for palette in ('light','dark'):
        for shape in ('soft','sharp'):
            page.locator('[id$="-root"]').evaluate('(e,v)=>{e.dataset.cwPalette=v[0];e.dataset.cwStyle=v[1]}',[palette,shape])
            result=inp.evaluate('''e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>=parseFloat(s.fontSize)*1.2&&parseFloat(s.fontSize)>=8&&s.visibility==='visible'&&e.value!=='';}''')
            assert result,(palette,shape,'Technical numeric field hidden or clipped')
            for action in ('.cw-save-settings','.cw-reset-settings'):
                btn=settings.locator(action)
                assert btn.is_visible() and btn.is_enabled(),(palette,shape,action)
    page.locator('[id$="-root"]').evaluate('e=>{e.dataset.cwPalette="light";e.dataset.cwStyle="soft";}')
    settings.locator('.cw-close-settings').click()
    page.locator('.cw-about-btn').click()
    assert page.locator('.cw-close-about').is_visible()
    page.locator('.cw-close-about').click()
    page.locator('.cw-end-chat').click()
    assert page.locator('.cw-close-limit').is_visible()
    page.locator('.cw-cancel-limit').click()
    assert page.locator('.cw-close-confirm').count()==1  # confirm lazily mounted for future interactions

    # Budget retains a visible health signal; current brand remains visible in both themes.
    page.locator('.cw-tab-budget').click()
    for palette in ('light','dark'):
        page.locator('[id$="-root"]').evaluate('(e,p)=>e.dataset.cwPalette=p',palette)
        assert page.locator('.cw-chip .cw-site-icon').evaluate('''e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility==='visible'}''')
        assert page.locator('.cw-progress-grid .cw-progress-fill').count()==6
    assert not errors,errors
    page.close()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
        args=['--no-sandbox','--disable-dev-shm-usage'])
    for width in (1200,390,320):
        # Stable intentionally has no Dev-only responsive panel-width rule at 320px.
        if width==320 and BUNDLE_KIND=='stable':
            continue
        check(browser,width)
        print(f'PASS visual and interaction changes at {width}px',flush=True)
    browser.close()
