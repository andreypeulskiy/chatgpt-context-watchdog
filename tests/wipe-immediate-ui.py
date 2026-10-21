#!/usr/bin/env python3
"""Wipe removes durable & RAM data, then immediately saves only fresh defaults+badge."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from support.current import VERSION
from support.esbuild_hooks import instrument_bundle
import json

ROOT=Path(__file__).resolve().parents[1]
CHAT='11111111-1111-4111-8111-111111111111'
MSG='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
APP='cgpt-context-watchdog:'
HTML=f'''<!doctype html><html><body><main>
<section data-chatgpt-search-unit-key="unit1:user" data-chatgpt-search-message-ids="{MSG}">
<div class="whitespace-pre-wrap">Test document after index {'sample. '*40}</div></section></main>
<form data-chatgpt-composer><textarea id="prompt-textarea"></textarea>
<button type="button" data-testid="send-button">Send</button></form></body></html>'''
FAKE_STORAGE='''() => {
 const data=new Map([['other-app:keep','safe'],['cgpt-context-watchdog:old-owned-key','obsolete']]);
 const calls=[];const flags={failNextRemove:false,silentNextRemove:false,failNextSet:false};
 window.__wdStorage={data,calls,flags};
 Object.defineProperty(window,'localStorage',{configurable:true,value:{
  getItem:k=>data.get(String(k))??null,
  setItem:(k,v)=>{if(flags.failNextSet){flags.failNextSet=false;throw Error('set denied')}
     calls.push(['write',String(k),String(v),[...data.keys()]]);data.set(String(k),String(v))},
  removeItem:k=>{if(flags.failNextRemove){flags.failNextRemove=false;throw Error('remove denied')}
     if(flags.silentNextRemove){flags.silentNextRemove=false;return;}
     calls.push(['remove',String(k)]);data.delete(String(k))},
  key:i=>[...data.keys()][i]??null,
  get length(){return data.size}
 }});
}'''
GEOM='''() => {const root=document.querySelector('[id$="-root"]');
const p=root.querySelector('.cw-panel'),b=root.querySelector('.cw-chip');
const box=e=>{const x=e.getBoundingClientRect();return {left:x.left,top:x.top,bottom:x.bottom,right:x.right}};
return {panel:box(p),badge:box(b),panelStyle:[p.style.left,p.style.top],rootStyle:[root.style.left,root.style.top,root.style.right,root.style.bottom],
 settings:root.querySelector('.cw-settings-dialog').open,confirm:root.querySelector('.cw-confirm-dialog')?.open||false,
 mainTab:root.querySelector('.cw-tab-budget').getAttribute('aria-selected'),history:root.querySelector('[data-cw-budget="history"]').getAttribute('aria-selected')};}'''
STORAGE='''() => ({entries:[...window.__wdStorage.data.entries()],calls:[...window.__wdStorage.calls]})'''
# Access module bindings through temporary, test-only hooks; no product API.
TEST_HOOKS = """
  let oldDirtySet = null;
  window.__wdTestHooks = {
    prime() {
      setLastAudit({sensitive:'old audit data'});
      priorRepairCandidates.set('old',{secret:true});
      pendingFileResults.set('oldjob',{chatKey:'old-untracked-chat',epoch:0,secret:'old file data'});
      pendingTransientPromotions.set('old-untracked-chat',{draft:{message:'old'},epoch:0});
      pendingLocalFiles.push({filename:'old.txt'});
      revisionTargets.set('old-id',1);
      completedRevisions.set('old-id',1);
      setHistoryCache({old:true});
      setHistorySummaryCache({old:true});
      oldDirtySet=dirtyFileTurns;
      dirtyFileTurns.add(document.body);
      hydrationCandidates.set('old',{old:true});
    },
    memory() {
      return {
        pendingFileResults:pendingFileResults.size,
        pendingTransientPromotions:pendingTransientPromotions.size,
        localFiles:pendingLocalFiles.length,
        revisions:revisionTargets.size,
        completed:completedRevisions.size,
        lastAudit,
        repairCandidates:priorRepairCandidates.size,
        historyCache, historySummaryCache,
        dirtyWeakSetReplaced:dirtyFileTurns!==oldDirtySet,
        hydration:hydrationCandidates.size,
        oldJobInvalidated:resetEpoch('old-untracked-chat')!==0,
        normalBudget:settings.normalBudget, badge:settings.badgePosition,
        logoPreference:settings.logoPreference
      };
    }
  };"""
MEMORY = '() => window.__wdTestHooks.memory()'
PRIME = '() => window.__wdTestHooks.prime()'

def same_ui(a,b,label):
 for key in ('panel','badge'):
  for axis in ('left','top'):
   assert abs(a[key][axis]-b[key][axis])<=1,(label,key,axis,a,b)
 for key in ('panelStyle','rootStyle','mainTab','history'):
  assert a[key]==b[key],(label,key,a,b)

def run(browser, variant, width, height,drag):
 page=browser.new_page(viewport={'width':width,'height':height})
 page.set_default_timeout(8000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(HTML);page.evaluate(FAKE_STORAGE)
 name=f'chatgpt-context-watchdog-{VERSION}{".dev" if variant=="Dev" else ""}.user.js'
 source=(ROOT/'dist'/name).read_text()
 route=f"{{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}}"
 page.add_script_tag(content=instrument_bundle(source, TEST_HOOKS, route=route))
 page.wait_for_function("() => [...window.__wdStorage.data.keys()].some(k=>k.startsWith('cgpt-context-watchdog:state:v2:'))")
 xy=(70,480) if width>600 else (26,390)
 page.locator('[id$="-root"]').evaluate("(r,p)=>{r.style.left=p[0]+'px';r.style.top=p[1]+'px';r.style.right='auto';r.style.bottom='auto'}",list(xy))
 page.locator('.cw-logo-hit').click()
 page.locator('.cw-tab-budget').click()
 page.locator('[data-cw-budget="history"]').click()
 page.locator('.cw-settings-btn').click()
 settings=page.locator('.cw-settings-dialog')
 assert settings.evaluate('(e)=>e.open')
 # Change one persisted setting before Wipe, to prove it is never revived.
 settings.locator('[data-cw-view-style="sharp"]').click()
 assert page.locator('[id$="-root"]').get_attribute('data-cw-style')=='sharp'
 pre=page.evaluate(GEOM)
 settings.locator('.cw-clear-watchdog-data').click()
 confirm=page.locator('.cw-confirm-dialog')
 assert confirm.evaluate('(e)=>e.open')
 before=page.evaluate(STORAGE)
 confirm.locator('.cw-cancel-confirm').click()
 assert page.evaluate(STORAGE)==before,'Cancel mutated storage'
 same_ui(pre,page.evaluate(GEOM),'cancel')
 # A failed deletion must not claim Wipe success or reset RAM.
 page.evaluate('window.__wdStorage.flags.failNextRemove=true')
 settings.locator('.cw-clear-watchdog-data').click()
 confirm.locator('.cw-confirm-ok').click()
 assert 'Wipe incomplete · E' in page.locator('.cw-dialog-message').inner_text()
 assert page.locator('.cw-toast').get_attribute('data-cw-notice-level')=='error'
 assert page.evaluate(STORAGE)['entries']==before['entries'],'Failed delete mutated data'
 page.evaluate(PRIME)
 settings.locator('.cw-clear-watchdog-data').click()
 assert confirm.evaluate('(e)=>e.open')
 page.evaluate('window.__wdStorage.calls.length=0')
 confirm.locator('.cw-confirm-ok').click()
 geom=page.evaluate(GEOM)
 assert geom['settings'] and not geom['confirm'],geom
 same_ui(pre,geom,'wipe success')
 states=page.evaluate(STORAGE)
 assert len([k for k,v in states['entries'] if k.startswith(APP)])==1,states
 settings_rows=[(k,v) for k,v in states['entries'] if k.startswith(APP)]
 assert settings_rows[0][0]==APP+'settings:v1',settings_rows
 assert dict(states['entries'])['other-app:keep']=='safe'
 operations=states['calls']
 writes=[(i,x) for i,x in enumerate(operations) if x[0]=='write']
 # A same-origin cache miss may asynchronously save a *logo preference only*
 # after Wipe has already persisted fresh defaults. Treat that independent
 # fallback as such, never as an extra Wipe write or revived private data.
 assert 1<=len(writes)<=2,(variant,width,operations)
 idx,write=writes[0]
 assert all(c[0]=='remove' for c in operations[:idx]),operations
 assert not any(k.startswith(APP) for k in write[3]),('storage not cleared before save',write)
 assert write[1]==APP+'settings:v1',write
 initial_settings=json.loads(write[2])
 assert initial_settings['viewStyle']=='soft' and initial_settings['normalBudget']==120000,initial_settings
 if len(writes)==2:
  j,after_fallback=writes[1]
  assert j==len(operations)-1 and after_fallback[1]==APP+'settings:v1',operations
  result=json.loads(after_fallback[2]); expected={**initial_settings,'logoPreference':'watchdog'}
  assert initial_settings['logoPreference']=='openai' and result==expected,('Extra write was not solely cache-only logo fallback',result,expected)
 else:
  assert idx==len(operations)-1,operations
 saved=json.loads(settings_rows[0][1])
 assert saved['viewStyle']=='soft' and saved['viewTheme']=='chatgpt',saved
 assert saved['normalBudget']==120000,saved
 assert saved['badgePosition']=={'left':round(pre['badge']['left']),'top':round(pre['badge']['top'])},saved
 mem=page.evaluate(MEMORY)
 for key in ('pendingFileResults','pendingTransientPromotions','localFiles','revisions','completed','repairCandidates','hydration'):
  assert mem[key]==0,(key,mem)
 assert mem['lastAudit'] is None and mem['historyCache'] is None and mem['historySummaryCache'] is None,mem
 assert mem['dirtyWeakSetReplaced'] and mem['oldJobInvalidated'] and mem['normalBudget']==120000,mem
 assert page.locator('[id$="-root"]').get_attribute('data-cw-style')=='soft'
 assert 'Watchdog data cleared.' in page.locator('.cw-dialog-message').inner_text()
 assert page.locator('main [data-chatgpt-search-unit-key]').count()==1
 if drag:
  badge=page.locator('.cw-chip').bounding_box()
  page.mouse.move(badge['x']+12,badge['y']+12);page.mouse.down()
  page.mouse.move(badge['x']+68,badge['y']-35,steps=7);page.mouse.up()
  changed=page.evaluate(STORAGE)
  changed_writes=[x for x in changed['calls'] if x[0]=='write']
  assert len(changed_writes)==len(writes)+1,('Drag must persist one new position',changed)
  assert changed_writes[-1][1]==APP+'settings:v1',changed_writes[-1]
  before_drag=json.loads(changed_writes[-2][2]); after_drag=json.loads(changed_writes[-1][2])
  assert {**before_drag,'badgePosition':after_drag['badgePosition']}==after_drag,('Drag rewrote unrelated settings',changed)
  new=json.loads(dict(changed['entries'])[APP+'settings:v1'])
  newgeom=page.evaluate(GEOM)
  assert new['badgePosition']=={'left':round(newgeom['badge']['left']),'top':round(newgeom['badge']['top'])},(new,newgeom)
  assert new['normalBudget']==120000 and new['viewStyle']=='soft',new
 page.locator('.cw-close-settings').click()
 page.locator('.cw-logo-hit').click()
 assert page.locator('.cw-panel').evaluate('(e)=>e.hidden')
 last=page.evaluate(STORAGE)
 expected=len(writes)+(1 if drag else 0)
 assert len([x for x in last['calls'] if x[0]=='write'])==expected,('Closing panel caused an unexpected settings write',expected,last)
 page.locator('.cw-logo-hit').click()
 assert not page.locator('.cw-panel').evaluate('(e)=>e.hidden')
 assert not errors,errors
 print(f'PASS Wipe immediate {variant} {width}x{height} drag={drag}: full durable/RAM clear, new position write, UI stable',flush=True)
 page.close()


def failure_paths(browser):
    # Explicitly test silent removal failures as well as a failed new write.
    page=browser.new_page(viewport={'width':390,'height':800})
    page.set_default_timeout(8000)
    page.set_content(HTML);page.evaluate(FAKE_STORAGE)
    name=f'chatgpt-context-watchdog-{VERSION}.user.js'
    source=(ROOT/'dist'/name).read_text()
    route=f"{{pathname:'/c/{CHAT}',origin:'https://chatgpt.com',href:'https://chatgpt.com/c/{CHAT}'}}"
    page.add_script_tag(content=instrument_bundle(source, TEST_HOOKS, route=route))
    # Wait for the unrelated cache-only favicon fallback before injecting
    # failure flags; otherwise its preference write may consume failNextSet.
    page.wait_for_function('''() => {
      const value=window.__wdStorage.data.get('cgpt-context-watchdog:settings:v1');
      return value && JSON.parse(value).logoPreference === 'watchdog';
    }''')
    page.locator('.cw-logo-hit').click()
    page.locator('.cw-tab-budget').click()
    page.locator('[data-cw-budget="history"]').click()
    page.locator('.cw-settings-btn').click()
    settings=page.locator('.cw-settings-dialog');confirm=page.locator('.cw-confirm-dialog')
    before=page.evaluate(GEOM)
    page.evaluate('window.__wdStorage.flags.silentNextRemove=true;window.__wdStorage.calls.length=0')
    settings.locator('.cw-clear-watchdog-data').click()
    confirm.locator('.cw-confirm-ok').click()
    after=page.evaluate(GEOM)
    same_ui(before,after,'silent failed removal')
    assert after['settings'] and not after['confirm'],after
    assert 'Wipe incomplete · E' in page.locator('.cw-dialog-message').inner_text()
    assert page.locator('.cw-toast').get_attribute('data-cw-notice-level')=='error'
    assert all(x[0]!='write' for x in page.evaluate(STORAGE)['calls']),page.evaluate(STORAGE)
    # The next wipe truly removes every key, but saving fresh position fails.
    page.evaluate('window.__wdStorage.flags.failNextSet=true;window.__wdStorage.calls.length=0')
    settings.locator('.cw-clear-watchdog-data').click()
    confirm.locator('.cw-confirm-ok').click()
    # The post-Wipe favicon read finishes in a promise microtask. Wait for
    # the visual fallback before asserting: checking immediately after Wipe
    # would miss an unintended late settings write.
    page.wait_for_function("() => window.__wdTestHooks.memory().logoPreference === 'watchdog'")
    assert page.locator('.cw-chip .cw-watchdog-svg').count()==1, 'Fallback artwork was not shown'
    state=page.evaluate(STORAGE)
    owned_after_failure=[k for k,v in state['entries'] if k.startswith(APP)]
    assert not owned_after_failure, {
      'problem':'A later settings write recreated a Watchdog key after the post-Wipe position save failed',
      'owned':owned_after_failure,
      'writeCount':sum(call[0]=='write' for call in state['calls']),
      'notice':page.locator('.cw-dialog-message').inner_text()
    }
    assert dict(state['entries'])['other-app:keep']=='safe',state
    assert 'could not save the current badge position' in page.locator('.cw-dialog-message').inner_text()
    after=page.evaluate(GEOM);same_ui(before,after,'failed post-wipe position write')
    assert after['settings'] and not after['confirm'],after
    print('PASS Wipe failure paths: silent retained key rejected; post-Wipe settings write error not reported as success',flush=True)
    page.close()

with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for variant in ('Stable','Dev'):
  for width,height in ((320,800),(390,800),(1200,900)):
   for drag in (False,True):run(browser,variant,width,height,drag)
 failure_paths(browser)
 browser.close()
