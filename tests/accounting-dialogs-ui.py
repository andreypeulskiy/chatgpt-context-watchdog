#!/usr/bin/env python3
""" Chromium regression: two-line accounting, text actions, inline confirmations.

Uses a synthetic ChatGPT DOM and a local-storage double. Does not replace
real Tampermonkey acceptance testing on ChatGPT.
"""
from playwright.sync_api import sync_playwright
from support.current import SCRIPT

CHAT = '11111111-1111-4111-8111-111111111111'
MSG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
HTML = f'''<!doctype html><html><body><main>
<section data-chatgpt-search-unit-key="unit1:user" data-chatgpt-search-message-ids="{MSG}">
<div class="whitespace-pre-wrap">A finished user message for  regression checking. {'Text. ' * 25}</div></section>
</main><form data-chatgpt-composer><button type="button" data-testid="send-button">Send</button></form>
<button id="outside" style="position:fixed;left:0;top:0">outside</button></body></html>'''
INIT = '''() => {
    const data = new Map();
    const storage = {
      getItem: k => data.get(String(k)) ?? null,
      setItem: (k, v) => data.set(String(k), String(v)),
      removeItem: k => data.delete(String(k)),
      key: i => [...data.keys()][i] ?? null,
      get length() { return data.size; }
    };
    Object.defineProperty(window, 'localStorage', {configurable:true, value:storage});
    window.__copied = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: {writeText: async (text) => {window.__copied = text;}}
    });
    window.confirm = () => { throw new Error('Browser confirm() must not be invoked'); };
}'''
INJECTED = SCRIPT.replace('(() => {',
    f"(() => {{\nconst location = {{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}};", 1)


def test(browser, width):
    page = browser.new_page(viewport={'width':width,'height':750})
    page.set_default_timeout(8000)
    errors = []
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.set_content(HTML)
    page.evaluate(INIT)
    page.add_script_tag(content=INJECTED)
    page.locator('.cw-logo-hit').click()
    assert page.locator('.cw-panel').is_visible()
    accounting = page.locator('.cw-data-attachment')
    assert accounting.locator('> .cw-data-row').count() == 4
    assert 'User attachments' not in accounting.inner_text()
    assert 'Files attached' in accounting.inner_text()
    assert 'File accounting' in accounting.inner_text()
    assert 'Images attached' in accounting.inner_text()
    assert 'none' in accounting.locator('.cw-data-images').inner_text()
    assert accounting.locator('.cw-data-quality').inner_text() == '0 parsed · 0 unparsed · 0 auto-paste'
    assert accounting.locator('.cw-data-quality-extra').inner_text() == '0 React metadata · 0 metadata-only'
    # Both accounting lines remain one line at mobile width, without clipping.
    assert page.evaluate('''() => {
      const root=document.querySelector('.cw-data-attachment');
      const a=root.querySelector('.cw-file-accounting-row');
      const b=root.querySelector('.cw-file-accounting-continuation');
      const vals=[a,b];
      return vals.every(el=>el.scrollWidth<=el.clientWidth+1 && el.getBoundingClientRect().height>0);
    }'''), f'accounting wraps/overflows at {width}px'

    page.locator('.cw-settings-btn').click()
    settings = page.locator('.cw-settings-dialog:not(.cw-confirm-dialog)')
    assert settings.evaluate('(e)=>e.open')
    assert settings.locator('.cw-reset-line').evaluate('''row => row.compareDocumentPosition(
      row.closest('.cw-dialog-content').querySelector('.cw-tools-nav')) & Node.DOCUMENT_POSITION_FOLLOWING'''), 'Reset must precede Settings category tabs'
    reset = settings.locator('.cw-reset-line button')
    assert reset.all_inner_texts() == ['Reset badge','Reset chat','Wipe Watchdog data']
    assert settings.locator('.cw-reset-label').count() == 0
    assert page.evaluate('''() => {
      const row=document.querySelector('.cw-reset-line');
      const els=[...row.querySelectorAll('button')];
      return row.scrollWidth<=row.clientWidth+1 &&
        els.every(el=>Math.abs(el.getBoundingClientRect().top-els[0].getBoundingClientRect().top)<=4);
    }'''), 'Reset actions must fit one line'

    # Cancel, X and Escape all mean no changes, with Settings restored to interactive state.
    def open_reset():
        settings.locator('.cw-reset-chat').click()
        dialog=page.locator('.cw-confirm-dialog')
        assert dialog.evaluate('(el)=>el.open')
        assert settings.evaluate('(el)=>el.inert')
        return dialog
    before = page.evaluate('''() => Array.from({length:localStorage.length},(_,i)=>
      [localStorage.key(i),localStorage.getItem(localStorage.key(i))])''')
    for kind in ('cancel','close','escape','scrim'):
        dialog = open_reset()
        if kind=='cancel': dialog.locator('.cw-cancel-confirm').click()
        elif kind=='close': dialog.locator('.cw-close-confirm').click()
        elif kind=='escape': dialog.locator('.cw-cancel-confirm').press('Escape')
        else: page.locator('.cw-settings-scrim').dispatch_event('click')
        assert not dialog.evaluate('(el)=>el.open'), kind
        assert settings.evaluate('(el)=>el.open && !el.inert'),kind
        assert page.evaluate('''() => Array.from({length:localStorage.length},(_,i)=>
          [localStorage.key(i),localStorage.getItem(localStorage.key(i))])''') == before,kind

    # Confirmed action must execute once and stay local to the intended chat.
    dialog=open_reset()
    dialog.locator('.cw-confirm-ok').click()
    assert not dialog.evaluate('(el)=>el.open')
    assert settings.evaluate('(el)=>el.open && !el.inert')

    # Technical numeric control is usable in both themes; borders, gradients
    # and exact font weights are editorial styling, not data correctness.
    settings.locator('[data-cw-tools="technical"]').click()
    number=settings.locator('.cw-settings input[type="number"]').first
    for palette in ('light','dark'):
        page.locator('[id$="-root"]').evaluate('(e,p)=>e.dataset.cwPalette=p',palette)
        field=number.evaluate(r'''e=>{
          const s=getComputedStyle(e),r=e.getBoundingClientRect(),label=e.closest('label');
          const pad=parseFloat(s.paddingLeft)+parseFloat(s.paddingRight);
          const canvas=document.createElement('canvas').getContext('2d');canvas.font=s.font;
          return {label:label?.textContent.trim(),height:r.height,width:r.width,
            font:parseFloat(s.fontSize),usable:e.clientWidth-pad,required:canvas.measureText('000000').width,
            visible:s.visibility==='visible'&&s.display!=='none',disabled:e.disabled};
        }''')
        assert field['visible'] and not field['disabled'] and field['label'],(palette,field)
        assert field['font']>=10 and field['height']>field['font']*1.3,(palette,field)
        assert field['usable']>=field['required'],(palette,field)
    # Group restore is inline and is not executed by Cancel.
    settings.locator('.cw-reset-settings').click()
    dialog=page.locator('.cw-confirm-dialog')
    assert 'Restore defaults' in dialog.locator('.cw-confirm-description').inner_text()
    dialog.locator('.cw-cancel-confirm').click()
    assert settings.evaluate('(el)=>el.open && !el.inert')

    # Copy is SECOND; it copies the exact visible Performance report.
    settings.locator('[data-cw-tools="performance"]').click()
    performance=page.locator('#cw-tools-performance')
    assert performance.locator('.cw-settings-actions button').all_inner_texts()==[
        'Enable profiling','Copy metrics','Reset counters']
    assert performance.locator('.cw-settings-actions').evaluate('''el => {
      const buttons=[...el.querySelectorAll('button')];
      return buttons.every(b=>Math.abs(b.getBoundingClientRect().top - buttons[0].getBoundingClientRect().top)<=4);
    }'''), 'Performance actions must stay on one line'
    performance.locator('.cw-performance-toggle').click()
    performance.locator('.cw-performance-copy').click()
    copied=page.evaluate('window.__copied')
    assert copied == performance.locator('.cw-performance-line').inner_text()
    assert 'Profiling: enabled' in copied and 'JSON saves (total):' in copied

    # Wipe request is cancellable; Cancel may not remove a storage key.
    before=page.evaluate('''() => Array.from({length:localStorage.length},(_,i)=>
      [localStorage.key(i),localStorage.getItem(localStorage.key(i))])''')
    settings.locator('.cw-clear-watchdog-data').click()
    dialog=page.locator('.cw-confirm-dialog')
    assert 'Permanently delete ALL' in dialog.locator('.cw-confirm-description').inner_text()
    dialog.locator('.cw-cancel-confirm').click()
    assert page.evaluate('''() => Array.from({length:localStorage.length},(_,i)=>
      [localStorage.key(i),localStorage.getItem(localStorage.key(i))])''')==before

    # Context and Budget Restore defaults must work WITHOUT Settings open.
    settings.locator('.cw-close-settings').click()
    assert not settings.evaluate('(el)=>el.open')
    page.locator('[data-cw-mini="text"]').click()
    page.locator('.cw-reset-text-estimation').click()
    dialog=page.locator('.cw-confirm-dialog')
    assert dialog.evaluate('(el)=>el.open')
    assert page.locator('.cw-panel-main').evaluate('(e)=>e.inert')
    dialog.locator('.cw-cancel-confirm').click()
    assert not page.locator('.cw-panel-main').evaluate('(e)=>e.inert')
    assert page.locator('.cw-panel').is_visible()
    page.locator('.cw-reset-text-estimation').click()
    dialog.locator('.cw-confirm-ok').click()
    assert not dialog.evaluate('(el)=>el.open')
    assert not page.locator('.cw-panel-main').evaluate('(e)=>e.inert')

    page.locator('.cw-tab-budget').click()
    page.locator('.cw-budget-editor').click()
    page.locator('.cw-reset-budget').click()
    assert dialog.evaluate('(el)=>el.open')
    dialog.locator('.cw-cancel-confirm').click()
    assert not dialog.evaluate('(el)=>el.open')
    assert page.locator('.cw-panel').is_visible()
    # Lazy standalone confirmation must not steal the Settings or Limit UI refs.
    page.locator('.cw-settings-btn').click()
    assert settings.evaluate('(el)=>el.open')
    settings.locator('.cw-close-settings').click()
    page.locator('.cw-end-chat').click()
    limit=page.locator('.cw-limit-dialog')
    assert limit.evaluate('(el)=>el.open')
    limit.locator('.cw-cancel-limit').click()
    assert not limit.evaluate('(el)=>el.open')
    if width == 1200:
        # Seed a known short ledger record against a long trusted DOM message.
        # Two identical read-only Audits are needed before Repair is offered.
        page.evaluate('''msg => {
          const key='cgpt-context-watchdog:state:v2:chat%3A11111111-1111-4111-8111-111111111111';
          const data=JSON.parse(localStorage.getItem(key));
          if(!data || !data.messages['msg:'+msg]) throw Error('Missing captured message for audit test');
          data.messages['msg:'+msg].chars=9;
          data.messages['msg:'+msg].tokens=2;
          localStorage.setItem(key,JSON.stringify(data));
        }''',MSG)
        page.locator('.cw-settings-btn').click()
        settings.locator('[data-cw-tools="diagnostics"]').click()
        for _ in range(2):
            settings.locator('.cw-rescan').click()
        repair=settings.locator('.cw-repair-short')
        assert not repair.is_hidden(), 'Two audits did not create a repair candidate'
        snapshot=page.evaluate('''msg => {
          const key='cgpt-context-watchdog:state:v2:chat%3A11111111-1111-4111-8111-111111111111';
          return JSON.parse(localStorage.getItem(key)).messages['msg:'+msg];
        }''',MSG)
        repair.click()
        assert dialog.evaluate('(el)=>el.open')
        assert 'Repair' in dialog.locator('.cw-confirm-description').inner_text()
        dialog.locator('.cw-cancel-confirm').click()
        saved=page.evaluate('''msg => JSON.parse(localStorage.getItem(
          'cgpt-context-watchdog:state:v2:chat%3A11111111-1111-4111-8111-111111111111'
          )).messages['msg:'+msg]''',MSG)
        assert saved == snapshot, 'Repair changed ledger on Cancel'
        repair.click()
        dialog.locator('.cw-confirm-ok').click()
        repaired=page.evaluate('''msg => JSON.parse(localStorage.getItem(
          'cgpt-context-watchdog:state:v2:chat%3A11111111-1111-4111-8111-111111111111'
          )).messages['msg:'+msg]''',MSG)
        assert repaired['chars']>snapshot['chars'], 'Confirmed repair did not update ledger'
        undo=settings.locator('.cw-undo-repair')
        assert not undo.is_hidden(), 'Undo action missing after confirmed repair'
        undo.click()
        assert dialog.evaluate('(el)=>el.open')
        dialog.locator('.cw-cancel-confirm').click()
        assert repaired == page.evaluate('''msg => JSON.parse(localStorage.getItem(
          'cgpt-context-watchdog:state:v2:chat%3A11111111-1111-4111-8111-111111111111'
          )).messages['msg:'+msg]''',MSG), 'Undo changed ledger on Cancel'
        undo.click()
        dialog.locator('.cw-confirm-ok').click()
        restored=page.evaluate('''msg => JSON.parse(localStorage.getItem(
          'cgpt-context-watchdog:state:v2:chat%3A11111111-1111-4111-8111-111111111111'
          )).messages['msg:'+msg]''',MSG)
        assert restored == snapshot, 'Confirmed Undo did not restore prior record'

    assert not errors,errors
    page.close()


with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
        args=['--no-sandbox','--disable-dev-shm-usage'])
    for width in (1200,390,320):
        test(browser,width)
        print(f'PASS accounting, inputs, reset confirmations, performance actions at {width}px',flush=True)
    browser.close()
