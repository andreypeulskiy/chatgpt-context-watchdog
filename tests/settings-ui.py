#!/usr/bin/env python3
"""Shared Stable/Dev attachment editor: disclosures, one Save/Restore, storage, zero MiB."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
VERSION=__import__('re').search(r'^// @version\s+(\S+)$', (ROOT/'src/userscript-header.txt').read_text(), __import__('re').M).group(1)
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main>
<form data-chatgpt-composer><textarea id="prompt-textarea"></textarea>
<button type="button" data-testid="send-button">Send</button></form>
</main></body></html>'''
with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
      args=['--no-sandbox','--disable-dev-shm-usage'])
  for suffix in ('','.dev'):
    page=browser.new_page(viewport={'width':900,'height':780})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(HTML)
    page.evaluate('''path=>{
      window.__wdRoute={pathname:path,origin:'https://chatgpt.com',href:'https://chatgpt.com'+path};
      const data=new Map();window.__store=data;
      window.__wdStorage={getItem:k=>data.get(String(k))??null,
        setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),
        key:i=>[...data.keys()][i]??null,get length(){return data.size}};
      Object.defineProperty(window,'localStorage',{configurable:true,value:window.__wdStorage});
    }''',f'/c/{CHAT}')
    code=(ROOT/f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text().replace('(() => {','(() => {\nconst location = window.__wdRoute;',1)
    page.add_script_tag(content=code)
    page.locator('.cw-logo-hit').click()
    page.locator('[data-cw-mini="attachment"]').click()
    basic=page.locator('.cw-attachment-core')
    metadata=page.locator('.cw-metadata-only')
    assert basic.count()==1 and basic.evaluate('(el)=>el.open'),suffix
    assert page.locator('.cw-historical-file-fallback').is_visible(),suffix
    assert page.locator('.cw-image-average').is_visible(),suffix
    assert page.locator('.cw-local-file-limit').is_visible(),suffix
    assert metadata.count()==1 and not metadata.evaluate('(el)=>el.open'),suffix
    assert page.locator('.cw-metadata-only input[type="number"]').count()==13,suffix
    assert metadata.locator('.cw-advanced-caption').all_text_contents()==['Formula','File types'],suffix
    assert page.locator('.cw-attachment-settings .cw-save-attachments').count()==1,suffix
    assert page.locator('.cw-attachment-settings .cw-reset-attachments').count()==1,suffix
    assert page.locator('.cw-attachment-settings .cw-save-metadata').count()==0,suffix
    assert page.locator('.cw-attachment-settings .cw-reset-metadata').count()==0,suffix
    # Edits in the primary section survive collapsing it; one Save handles both parts.
    page.locator('.cw-local-file-limit').fill('0')
    page.locator('.cw-image-average').fill('2100')
    page.locator('.cw-historical-file-fallback').fill('1250')
    basic.locator('summary').click()
    assert not basic.evaluate('(el)=>el.open'),suffix
    metadata.locator('summary').click()
    assert page.locator('.cw-metadata-opt-base').is_visible(),suffix
    captions=metadata.locator('.cw-field-caption')
    assert captions.count()==13,suffix
    assert all(captions.nth(i).get_attribute('data-cw-tip') for i in range(13)),suffix
    assert all(metadata.locator('input[type="number"]').nth(i).get_attribute('data-cw-tip') ==
               captions.nth(i).get_attribute('data-cw-tip') for i in range(13)),suffix
    assert all(metadata.locator('input[type="number"]').nth(i).get_attribute('title') is None
               for i in range(13)),suffix

    for field in ('.cw-metadata-opt-base','.cw-metadata-pess-max','.cw-metadata-pdf','.cw-metadata-other'):
      box=page.locator(field)
      box.hover()
      page.wait_for_timeout(600)
      assert page.locator('.cw-floating-tip').is_visible(),(suffix,field)
      assert 'Edit ' not in page.locator('.cw-floating-tip').inner_text(),(suffix,field)
    # Tooltips are also attached to the captions, consistent with the other numeric settings.
    captions.first.hover()
    page.wait_for_timeout(600)
    assert 'optimistic token allowance' in page.locator('.cw-floating-tip').inner_text(),suffix
    # Other numeric settings use the same floating-tip mechanism, not a parallel renderer.
    page.locator('[data-cw-mini="text"]').click()
    text_field=page.locator('.cw-prose-latin-ratio')
    text_field.hover()
    page.wait_for_timeout(600)
    assert page.locator('.cw-floating-tip').is_visible(),suffix
    assert text_field.get_attribute('data-cw-tip'),suffix
    assert 'Edit ' not in page.locator('.cw-floating-tip').inner_text(),suffix
    page.locator('[data-cw-mini="attachment"]').click()
    # Reopening an already mounted editor must preserve meaningful tooltip text.
    page.locator('.cw-metadata-pdf').hover()
    page.wait_for_timeout(600)
    assert 'PDF files' in page.locator('.cw-floating-tip').inner_text(),suffix
    page.locator('.cw-metadata-pdf').fill('1.5')
    page.locator('.cw-save-attachments').click()
    saved=page.evaluate("""()=>JSON.parse(window.__store.get('cgpt-context-watchdog:settings:v1'))""")
    assert (saved['localFileParsingLimitMiB'],saved['averageImageTokens'],
            saved['historicalFileFallbackTokens'],saved['metadataOnlyTypeFactorPdf'])==(0,2100,1250,1.5),(suffix,saved)
    # The single confirmation must restore all 16 attachment fields, not coefficients.
    page.locator('[data-cw-mini="coefficients"]').click()
    assert page.locator('.cw-file-opt').input_value()=='25'
    assert page.locator('.cw-file-pess').input_value()=='75'
    page.locator('.cw-file-opt').fill('40')
    page.locator('.cw-file-pess').fill('90')
    page.locator('.cw-save-attachment-coefficients').click()
    page.locator('[data-cw-mini="attachment"]').click()
    assert not basic.evaluate('(el)=>el.open'), 'disclosure state must survive mini-tab switch'
    assert metadata.evaluate('(el)=>el.open'), 'metadata disclosure state must survive mini-tab switch'
    page.locator('.cw-reset-attachments').click()
    confirmation=page.locator('.cw-confirm-dialog')
    assert confirmation.is_visible(),suffix
    assert 'Files & images' in confirmation.locator('.cw-confirm-description').inner_text(),suffix
    confirmation.locator('.cw-confirm-ok').click()
    restored=page.evaluate("""()=>JSON.parse(window.__store.get('cgpt-context-watchdog:settings:v1'))""")
    assert (restored['localFileParsingLimitMiB'],restored['averageImageTokens'],
            restored['historicalFileFallbackTokens'],restored['metadataOnlyTypeFactorPdf'])==(75,2000,1000,1.0),(suffix,restored)
    assert (restored['fileOptimisticPct'],restored['filePessimisticPct'])==(40,90),(suffix,restored)
    assert not page.locator('.cw-local-limit-label .cw-limit-warning').is_visible(),suffix
    # Invalid metadata calibration must not partially save basic settings.
    page.locator('.cw-metadata-opt-base').fill('3000')
    page.locator('.cw-metadata-pess-base').fill('200')
    page.locator('.cw-save-attachments').click()
    invalid=page.evaluate("""()=>JSON.parse(window.__store.get('cgpt-context-watchdog:settings:v1'))""")
    assert invalid['metadataOnlyOptimisticBase']==300 and invalid['metadataOnlyPessimisticBase']==2000,(suffix,invalid)
    assert not errors,errors
    print('PASS', 'Dev' if suffix else 'Stable','3 main + 13 metadata, shared Save/Restore, validation, console clean')
    page.close()
  browser.close()
