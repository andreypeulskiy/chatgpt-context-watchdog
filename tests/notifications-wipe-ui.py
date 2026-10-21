#!/usr/bin/env python3
""" local Wipe + header notifications regression (real bundle, synthetic DOM)."""
from playwright.sync_api import sync_playwright
from support.current import SCRIPT

CHAT='11111111-1111-4111-8111-111111111111'
MSG='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
HTML=f'''<!doctype html><html><body><main>
<section data-chatgpt-search-unit-key="unit1:user" data-chatgpt-search-message-ids="{MSG}">
<div class="whitespace-pre-wrap">Completed user message for safe local wipe regression. {'Text. '*30}</div>
</section></main>
<form data-chatgpt-composer><button type="button" data-testid="send-button">Send</button></form>
</body></html>'''
INIT='''() => {
  const data = new Map([['other-app:keep', 'foreign-value']]);
  Object.defineProperty(window, 'localStorage', {configurable:true,value:{
    getItem:k=>data.get(String(k))??null,
    setItem:(k,v)=>data.set(String(k),String(v)),
    removeItem:k=>data.delete(String(k)),
    key:i=>[...data.keys()][i]??null,
    get length(){return data.size}
  }});
  window.__pageMarker = {original: true};
  window.confirm = () => {throw Error('Native confirm must not be called')};
}'''
INJECTED=SCRIPT.replace('(() => {',
    f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};",1)
PREFIX='cgpt-context-watchdog:'

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
        args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':390,'height':800})
    page.set_default_timeout(8000)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(HTML)
    page.evaluate(INIT)
    page.add_script_tag(content=INJECTED)
    page.wait_for_function('''prefix => [...Array(localStorage.length)].some((_,i) =>
      localStorage.key(i).startsWith(prefix+'state:v2:'))''', arg=PREFIX)
    page.locator('.cw-logo-hit').click()
    page.locator('.cw-settings-btn').click()
    settings=page.locator('.cw-settings-dialog:not(.cw-confirm-dialog):not(.cw-about-dialog):not(.cw-limit-dialog)')
    assert settings.evaluate('(e)=>e.open')
    # View preferences have immediate visual effect and should NOT add a toast.
    settings.locator('[data-cw-view-style="sharp"]').click()
    assert page.locator('[id$="-root"]').get_attribute('data-cw-style')=='sharp'
    assert page.locator('.cw-dialog-message').is_hidden()

    settings.locator('[data-cw-tools="performance"]').click()
    performance=settings.locator('#cw-tools-performance')
    performance.locator('.cw-performance-toggle').click()
    header=settings.locator('.cw-dialog-message')
    assert header.is_visible() and header.inner_text()=='Profiling enabled.'
    performance.locator('.cw-performance-toggle').click()
    assert header.is_visible() and header.inner_text()=='Profiling paused.'
    performance.locator('.cw-performance-reset').click()
    assert header.is_visible() and header.inner_text()=='Counters reset.'
    assert 'Profiling: paused' in performance.locator('.cw-performance-line').inner_text()
    # The Settings header status now obeys the same expiry as other toasts.
    page.wait_for_timeout(4750)
    assert header.is_hidden() and header.get_attribute('title') is None
    print('PASS performance notifications / expiration; no View toasts',flush=True)

    before=page.evaluate('''() => Array.from({length:localStorage.length},(_,i) =>
      [localStorage.key(i),localStorage.getItem(localStorage.key(i))])''')
    settings.locator('.cw-clear-watchdog-data').click()
    dialog=page.locator('.cw-confirm-dialog')
    assert dialog.evaluate('(e)=>e.open')
    assert 'without reloading ChatGPT' in dialog.locator('.cw-confirm-description').inner_text()
    dialog.locator('.cw-cancel-confirm').click()
    assert page.evaluate('''() => Array.from({length:localStorage.length},(_,i) =>
      [localStorage.key(i),localStorage.getItem(localStorage.key(i))])''')==before
    assert header.is_hidden(), 'Cancel must not show a success notification'

    # Wipe removes all old Watchdog data; a fresh default settings record is
    # immediately written with only the live badge position carried over.
    settings.locator('.cw-clear-watchdog-data').click()
    assert dialog.evaluate('(e)=>e.open')
    dialog.locator('.cw-confirm-ok').click()
    assert not dialog.evaluate('(e)=>e.open')
    assert settings.evaluate('(e)=>e.open && !e.inert')
    assert header.is_visible() and header.inner_text()=='Watchdog data cleared.'
    assert page.evaluate('window.__pageMarker?.original===true')
    assert page.locator('main [data-chatgpt-search-unit-key]').count()==1
    assert page.evaluate('''prefix => {
      if (localStorage.getItem('other-app:keep')!=='foreign-value') return false;
      const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i));
      return keys.filter(k=>k.startsWith(prefix)).join(',')===prefix+'settings:v1';
    }''', PREFIX)
    assert page.locator('[id$="-root"]').get_attribute('data-cw-style')=='soft'
    assert not page.locator('.cw-storage-warning').is_visible()

    # The first Diagnostics visit has a meaningful empty state, not a blank
    # region. No dedicated copy control is added for the journal.
    settings.locator('[data-cw-tools="diagnostics"]').click()
    first_diagnostics=settings.locator('#cw-tools-diagnostics')
    first_history=first_diagnostics.locator('.cw-recent-errors')
    assert not first_history.evaluate('(e)=>e.open')
    first_history.locator('summary').click()
    assert first_history.locator('.cw-recent-errors-list').inner_text().strip() == 'No errors recorded. All good.'
    assert first_history.locator('button').count()==0
    first_history.locator('summary').click() # leave it collapsed for the later error case

    # Unexpected Watchdog-only Wipe failure: an error reference in the toast,
    # a closed-by-default Diagnostics disclosure and plain selectable text.
    # Raw thrown messages can contain user context and MUST NOT be logged.
    page.evaluate('''() => {
      const store=localStorage, original=store.removeItem.bind(store);
      store.removeItem=(key) => {
        store.removeItem=original;
        throw new DOMException('PRIVATE CHAT MESSAGE MUST NOT ENTER THE LOG', 'QuotaExceededError');
      };
    }''')
    settings.locator('.cw-clear-watchdog-data').click()
    dialog.locator('.cw-confirm-ok').click()
    alert_text=header.inner_text()
    assert alert_text=='Wipe incomplete · E01', alert_text
    assert page.locator('.cw-toast').get_attribute('data-cw-notice-level')=='error'
    settings.locator('[data-cw-tools="diagnostics"]').click()
    diagnostics=settings.locator('#cw-tools-diagnostics')
    history=diagnostics.locator('.cw-recent-errors')
    assert not history.evaluate('(e)=>e.open'), 'Recent errors must start collapsed'
    assert diagnostics.evaluate('(e)=>e.firstElementChild.classList.contains("cw-recent-errors")')
    history.locator('summary').click()
    lines=history.locator('.cw-recent-errors-list')
    assert 'E01 · Wipe · QuotaExceededError' in lines.inner_text()
    assert 'Watchdog data could not be fully cleared' in lines.inner_text()
    assert 'PRIVATE CHAT MESSAGE' not in lines.inner_text()
    assert history.locator('button').count()==0, 'No dedicated Copy errors button'
    assert lines.evaluate('''e => getComputedStyle(e).userSelect''')=='text'
    assert lines.evaluate('''e => {const selection=getSelection(),range=document.createRange();
      range.selectNodeContents(e);selection.removeAllRanges();selection.addRange(range);
      return selection.toString()===e.textContent;}'''), 'Error text must be selectable'
    assert not page.evaluate('''() => Array.from({length:localStorage.length},(_,i)=>
      localStorage.getItem(localStorage.key(i))).some(v=>v?.includes('PRIVATE CHAT MESSAGE'))''')
    # Download API throws an unexpected browser error. Keep only its vetted
    # name/context; never record its arbitrary message or provide Copy errors.
    page.evaluate('''() => {
      window.__createObjectURL=URL.createObjectURL;
      URL.createObjectURL=()=>{throw new DOMException('SENSITIVE EXPORT DATA', 'SecurityError')};
    }''')
    diagnostics.locator('.cw-export-ids').click()
    assert 'Operation failed · E02' in header.inner_text(), header.inner_text()
    assert 'E02 · Export IDs · SecurityError' in lines.inner_text()
    assert 'SENSITIVE EXPORT DATA' not in lines.inner_text()
    for _ in range(16):
      diagnostics.locator('.cw-export-ids').click()
    recorded=lines.locator('.cw-recent-error-entry')
    assert recorded.count()==15, 'In-memory error history is bounded to 15 entries'
    assert 'E18 · Export IDs · SecurityError' in recorded.first.inner_text()
    assert 'E04 · Export IDs · SecurityError' in recorded.last.inner_text()
    assert 'E03 ' not in lines.inner_text(), 'Oldest errors must be evicted'
    page.evaluate('''() => {URL.createObjectURL=window.__createObjectURL}''')
    # A successful Wipe clears the volatile journal without leaking its data
    # into localStorage; the same DOM dialog and page remain mounted.
    settings.locator('.cw-clear-watchdog-data').click()
    dialog.locator('.cw-confirm-ok').click()
    assert 'No errors recorded. All good.' in lines.inner_text()
    assert not errors,errors
    print('PASS unexpected Wipe: error toast/ref, collapsed/selectable/private diagnostics, no Copy button, cleared on Wipe',flush=True)
    print('PASS Wipe cancel / OK, cleared old data and RAM, fresh default position saved, foreign key retained',flush=True)
    page.close()
    browser.close()
