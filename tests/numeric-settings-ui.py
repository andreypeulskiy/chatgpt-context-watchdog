#!/usr/bin/env python3
from pathlib import Path
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
import re
VERSION=re.search(r'^// @version\s+(\S+)$',(R/'src/userscript-header.txt').read_text(),re.M).group(1)
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><body><main><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form></main></body></html>'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
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
          data.set('cgpt-context-watchdog:settings:v1',JSON.stringify({
             normalBudget:121347,conservativeBudget:80000,optimisticBudget:180000,
             metadataOnlyTypeFactorArchive:0.72
          }));
        }''', f'/c/{CHAT}')
        code=(R/f'dist/chatgpt-context-watchdog-{VERSION}{suffix}.user.js').read_text().replace('(() => {','(() => {\nconst location = window.__wdRoute;',1)
        page.add_script_tag(content=code)
        page.locator('.cw-logo-hit').click()
        page.locator('[data-cw-mini="text"]').click()
        cyr=page.locator('.cw-prose-cyrillic-ratio')
        assert cyr.get_attribute('step')=='0.01', (suffix,cyr.get_attribute('step'))
        assert cyr.get_attribute('min')=='0.25' and cyr.get_attribute('max')=='20'
        assert cyr.input_value()=='2.38'
        assert cyr.evaluate('(el)=>el.validity.stepMismatch') is False
        cyr.fill('2.386')
        assert cyr.input_value()=='2.386', 'normalization while typing prohibited'
        page.locator('.cw-prose-latin-ratio').click()
        assert cyr.input_value()=='2.39', ('blur',suffix,cyr.input_value())
        page.locator('.cw-save-text-estimation').click()
        stored=lambda: page.evaluate("()=>JSON.parse(window.__store.get('cgpt-context-watchdog:settings:v1'))")
        assert stored()['proseCyrillicCharsPerToken']==2.39
        page.locator('[data-cw-mini="attachment"]').click()
        image=page.locator('.cw-image-average')
        assert image.get_attribute('step')=='10'
        image.fill('2107')
        page.locator('.cw-save-attachments').click()
        assert stored()['averageImageTokens']==2110, stored()
        assert stored()['metadataOnlyTypeFactorArchive']==0.72, 'untouched old setting cannot normalize'
        metadata=page.locator('.cw-metadata-only')
        metadata.locator('summary').click()
        pdf=page.locator('.cw-metadata-pdf')
        assert pdf.get_attribute('step')=='0.01'
        pdf.fill('1.157')
        page.locator('.cw-save-attachments').click()
        assert stored()['metadataOnlyTypeFactorPdf']==1.16,stored()
        # Invalid input must not become default or partially commit.
        pdf.fill('')
        page.locator('.cw-image-average').fill('2450')
        page.locator('.cw-save-attachments').click()
        assert stored()['averageImageTokens']==2110
        assert stored()['metadataOnlyTypeFactorPdf']==1.16
        pdf.fill('1.16')
        page.locator('[data-cw-mini="text"]').click()
        # Stored off-grid budget must survive opening/saving without editing.
        page.locator('.cw-tab-budget').click()
        editor=page.locator('.cw-budget-editor')
        editor.locator('summary').click()
        budgetN=page.locator('.cw-budget-n')
        assert budgetN.input_value()=='121347',('stored calibration changed',suffix,budgetN.input_value())
        assert budgetN.get_attribute('step')=='1000'
        assert page.locator('.cw-budget-c').get_attribute('step')=='100'
        page.locator('.cw-save-budget').click()
        assert stored()['normalBudget']==121347, ('untouched budget must retain exact value', suffix,stored()['normalBudget'])
        budgetN.fill('121347')
        page.locator('.cw-budget-o').click()
        assert budgetN.input_value()=='121000'
        page.locator('.cw-save-budget').click()
        assert stored()['normalBudget']==121000, ('manual budget rounded to default-based grid',suffix,stored()['normalBudget'])
        page.locator('.cw-settings-btn').click()
        dialog=page.locator('.cw-settings-dialog:not(.cw-confirm-dialog):not(.cw-about-dialog):not(.cw-limit-dialog)')
        assert dialog.is_visible(),suffix
        dialog.locator('[data-cw-tools="technical"]').click()
        hidden=dialog.locator('.cw-hidden-optimistic')
        assert hidden.get_attribute('step')=='10', ('hidden context step',suffix,hidden.get_attribute('step'))
        hidden.fill('4358')
        dialog.locator('.cw-hidden-pessimistic').click()
        assert hidden.input_value()=='4360'
        dialog.locator('.cw-save-settings').click()
        assert stored()['hiddenOptimistic']==4360
        assert not errors,errors
        print('PASS', 'Dev' if suffix else 'Stable', 'auto-step, free input, blur/Save, storage unaffected')
        page.close()
    browser.close()
