#!/usr/bin/env python3
"""Canonical b23 extension rules: Stable/Dev, draft, save, invalid input, reset."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
from support.browser_launch import chromium_launch_options
ROOT = Path(__file__).resolve().parents[1]
VERSION = re.search(r'^// @version\s+(\S+)$',(ROOT/'src/userscript-header.txt').read_text(),re.M).group(1)
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main><form data-chatgpt-composer>
<textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button>
</form></main></body></html>'''
with sync_playwright() as p:
    browser=p.chromium.launch(**chromium_launch_options(),headless=True,
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
        code=(ROOT/f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text().replace(
          '(() => {','(() => {\nconst location = window.__wdRoute;',1)
        page.add_script_tag(content=code)
        page.locator('.cw-logo-hit').click()
        page.locator('[data-cw-mini="attachment"]').click()
        assert page.locator('.cw-file-opt').input_value()=='25'
        assert page.locator('.cw-file-pess').input_value()=='75'
        assert page.locator('.cw-metadata-file-opt').input_value()=='100'
        assert page.locator('.cw-metadata-file-pess').input_value()=='100'
        ext=page.locator('.cw-file-rule-extension')
        ext.fill('.JSON')
        page.locator('.cw-file-rule-add').click()
        row=page.locator('.cw-file-rule-row[data-extension="json"]')
        assert row.count()==1
        for field,value in [('parsedMin','0.02'),('parsedMax','0.05'),('metadataMin','0.10'),('metadataMax','0.20')]:
            row.locator(f'[data-field="{field}"]').fill(value)
        page.locator('[data-cw-mini="coefficients"]').click()
        page.locator('[data-cw-mini="attachment"]').click()
        assert row.locator('[data-field="parsedMin"]').input_value()=='0.02','draft survived tab switch'
        page.locator('.cw-save-attachments').click()
        def stored():
            return page.evaluate("""()=>JSON.parse(window.__store.get('cgpt-context-watchdog:settings:v1'))""")
        settings=stored()
        assert settings['fileContributionByExt']=={
          'json':{'parsedMin':0.02,'parsedMax':0.05,'metadataMin':0.1,'metadataMax':0.2}}
        # An invalid row must reject the entire group, not partially modify settings.
        row.locator('[data-field="parsedMin"]').fill('0.08')
        page.locator('.cw-file-opt').fill('60')
        page.locator('.cw-save-attachments').click()
        assert stored()['fileOptimisticPct']==25
        assert stored()['fileContributionByExt']['json']['parsedMin']==0.02
        # Restore valid row; the new Other files percentages are independently editable.
        row.locator('[data-field="parsedMin"]').fill('0.02')
        page.locator('.cw-file-opt').fill('0.01')
        page.locator('.cw-file-pess').fill('0.02')
        page.locator('.cw-metadata-file-opt').fill('50')
        page.locator('.cw-metadata-file-pess').fill('50')
        page.locator('.cw-save-attachments').click()
        settings=stored()
        assert (settings['fileOptimisticPct'],settings['filePessimisticPct'])==(0.01,0.02)
        assert (settings['metadataFileOptimisticPct'],settings['metadataFilePessimisticPct'])==(50,50)
        # Remove only after Save; no implicit persistence on delete.
        row.locator('.cw-file-rule-remove').click()
        assert 'json' in stored()['fileContributionByExt']
        page.locator('.cw-save-attachments').click()
        assert stored()['fileContributionByExt']=={}
        # Restore complete file group; unrelated image weights are not touched.
        page.locator('.cw-reset-attachments').click()
        page.locator('.cw-confirm-dialog .cw-confirm-ok').click()
        settings=stored()
        assert (settings['fileOptimisticPct'],settings['filePessimisticPct'])==(25,75)
        assert (settings['metadataFileOptimisticPct'],settings['metadataFilePessimisticPct'])==(100,100)
        assert settings['fileContributionByExt']=={}
        assert not errors,errors
        print('PASS','Dev' if suffix else 'Stable','file rules Save/Reset, unsaved draft, invalid atomicity, old defaults')
        page.close()
    browser.close()
