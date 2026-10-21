'use strict';
// RC-1/RC-2/RC-3 against the real ES-module implementations, with live storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const bundle = fs.readFileSync(path.join(root,`dist/chatgpt-context-watchdog-${require('./support/current.cjs').version}.user.js`),'utf8');
// esbuild produces a flat IIFE; the test needs access to its module exports.
// When the release bundle is esbuild, instrument the SAME source ES modules
// in memory through the offline CommonJS test loader (never written to dist).
function testModuleBundle() {
  if (bundle.includes("  loadModule('src/main.js');") &&
      process.env.WATCHDOG_TEST_SOURCE_LOADER !== '1') return bundle;
  let ts;
  try { ts = require('typescript'); }
  catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); }
  const files = [];
  function walk(dir) {
    for (const d of fs.readdirSync(dir,{withFileTypes:true})) {
      const p=path.join(dir,d.name);
      if(d.isDirectory()) walk(p);
      else if(d.isFile() && p.endsWith('.js')) files.push(p);
    }
  }
  walk(path.join(root,'src'));
  const names = new Set(files.map(p=>path.relative(root,p).replaceAll(path.sep,'/')));
  const chunks=[`(() => {
    const factories = Object.create(null), cache = Object.create(null);
    function loadModule(id) {
      if(cache[id])return cache[id].exports;
      const module={exports:{}};cache[id]=module;
      factories[id](loadModule,module,module.exports);return module.exports;
    }
  `];
  for(const p of files) {
    const id=path.relative(root,p).replaceAll(path.sep,'/');
    let code=ts.transpileModule(fs.readFileSync(p,'utf8'),{
      fileName:id, compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
    }).outputText;
    code=code.replace(/require\("([^"\n]+)"\)/g,(_,spec)=>{
      const ref=path.posix.normalize(path.posix.join(path.posix.dirname(id),spec));
      assert.ok(names.has(ref),`missing source dependency ${id}: ${spec}`);
      return `require(${JSON.stringify(ref)})`;
    });
    chunks.push(`factories[${JSON.stringify(id)}] = function(require,module,exports) {${code}};`);
  }
  chunks.push(`  globalThis.__load=loadModule;
})();`);
  return chunks.join('\n');
}
const chatId = 'chat:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const key = 'cgpt-context-watchdog:state:v2:' + encodeURIComponent(chatId);
const msgId = 'msg:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function fixture() {
  const bytes = new Map(), microtasks = [];
  let rejectNext = false, currentEntries = [], measured = {tokens:10, chars:40, fingerprint:'v3:old'};
  const storage = {
    getItem:k => bytes.get(k) ?? null,
    setItem(k,v) {if (rejectNext) {rejectNext=false;throw Error('storage transient failure');}bytes.set(k,String(v));},
    removeItem:k=>bytes.delete(k), key:i=>[...bytes.keys()][i],get length(){return bytes.size;}
  };
  const window = {addEventListener:()=>{},innerWidth:1200};
  const document = {hidden:false,readyState:'loading',addEventListener:()=>{},
    getElementById:()=>null,documentElement:{},body:{},querySelector:()=>null,querySelectorAll:()=>[]};
  const ctx={console:{...console,warn:()=>{}},Map,Set,WeakMap,WeakSet,Date,Math,TextDecoder,URL,window,document,
    HTMLImageElement:class HTMLImageElement {},
    localStorage:storage,location:{pathname:'/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},
    performance:{now:()=>0},queueMicrotask:fn=>microtasks.push(fn),
    setTimeout,clearTimeout,setInterval,clearInterval};
  ctx.globalThis=ctx;
  const instrumented=testModuleBundle().replace("  loadModule('src/main.js');","  globalThis.__load = loadModule;");
  vm.runInNewContext(instrumented,ctx,{timeout:12000});
  const load=ctx.__load;
  // Stub only the environment-dependent edges; capture/scan/storage/file-read
  // functions and their ESM-generated imports run unmodified.
  const collector=load('src/chatgpt/09-dom-collection.js');
  const identity=load('src/chatgpt/09-dom-message-identity.js');
  const composer=load('src/chatgpt/09-dom-composer-state.js');
  const estimator=load('src/chatgpt/04-text-estimators.js');
  const meta=load('src/attachments/05-react-metadata.js');
  const hydration=load('src/chatgpt/11-message-hydration.js');
  const startup=load('src/app/17-spa-observer-startup.js');
  const route=load('src/app/11-route-inspection.js');
  const render=load('src/ui/16-panel-rendering.js');
  const summary=load('src/app/11-ledger-statistics.js');
  const forecast=load('src/storage/03-calibration-store.js');
  const collected=()=>({nodes:currentEntries.map(e=>e.el), entries:currentEntries,
    ambiguousIds:new Set(),identities:new WeakMap()});
  collector.collectMessageNodes=collected;
  identity.normalizeCollectedMessageEntries=arr=>arr.entries.map((e,i)=>({...e,index:i}));
  identity.trustedCollectedMessageId=id=>!!id;
  composer.getComposerMode=()=> 'ready';
  composer.rememberCollected=()=>{};
  estimator.getCanonicalMessageMetrics=()=>({...measured});
  hydration.mayBackfillMessage=()=>true;
  meta.fileMetadataFromElement=el=>({name:el.name,size:el.size,type:'text/plain',metadataSource:'react-props'});
  const navigation=load('src/app/11-route-navigation.js');
  navigation.synchronizeChatRoute=()=>false;
  navigation.routeVerifiedOrWait=()=>true;
  render.render=()=>{};
  render.showToast=()=>{};
  summary.stats=()=>({});
  forecast.effectiveBudgets=()=>({});
  const scan=load('src/app/11-message-scan.js').scanMessages;
  const state=load('src/storage/03-ledger-repository.js');
  const save=load('src/storage/03-ledger-commit.js').saveState;
  const capture=load('src/runtime/01-runtime-capture-state.js');
  // Runtime hydration is now an explicit startup step rather than an import side effect.
  capture.initializeCaptureState(load('src/runtime/01-runtime-configuration.js').DEFAULTS, chatId);
  load('src/runtime/01-runtime-pause-state.js').setChatAvailable(true);
  const uiState=load('src/runtime/01-runtime-ui-state.js');
  const fileReader=load('src/attachments/06-attachment-reading.js');
  const runtime=load('src/runtime/01-runtime-session-state.js');
  const ledger=load('src/runtime/01-runtime-ledger-state.js');
  return {bytes,microtasks,scan,state,save,capture,uiState,fileReader,runtime,ledger,
    get stored(){return JSON.parse(bytes.get(key));},
    reject(){rejectNext=true;},
    entries:items=>{currentEntries=items;},
    measured:next=>{measured=next;},
    flush(){while(microtasks.length)microtasks.shift()();}
  };
}
const record=(n=10,chars=40,fp='v3:old')=>({role:'assistant',tokens:n,chars,fingerprint:fp});
async function run(){
  for (const view of ['old','absent','empty']) {
    const f=fixture();
    const st=f.state.loadState(chatId);st.messages[msgId]=record();assert.equal(f.save(st),true);
    const turn={querySelectorAll:()=>[]};
    f.entries(view==='absent'?[]:[{el:turn,id:msgId,role:'assistant'}]);
    f.measured(view==='empty'?{tokens:0,chars:0,fingerprint:'v3:empty'}:
      {tokens:10,chars:40,fingerprint:'v3:old'});
    f.capture.revisionTargets.set(msgId,1);
    f.scan({commitCompleted:true,backfill:true});
    assert.equal(f.stored.messages[msgId].tokens,10,view);
    assert.equal(f.capture.completedRevisions.get(msgId),1,view);
    assert.equal(f.capture.revisionTargets.get(msgId),1,view);
    f.entries([{el:turn,id:msgId,role:'assistant'}]);
    f.measured({tokens:300,chars:750,fingerprint:'v3:late'});
    f.scan({backfill:true});
    assert.equal(f.stored.messages[msgId].tokens,300,view);
    assert.equal(f.capture.revisionTargets.size,0,view);
  }
  console.log('PASS RC-1 three late DOM hydration variants with actual module scan and ledger');

  {
    const f=fixture();
    const file={name:'example.txt',size:128,lastModified:1,type:'text/plain',text:async()=> 'a few words'};
    const card={name:'example.txt',size:128,closest:()=>null};
    const turn={querySelectorAll:()=>[card]};
    f.entries([{el:turn,id:msgId,role:'user'}]);
    f.measured({tokens:5,chars:20,fingerprint:'v3:user'});
    f.uiState.pendingLocalFiles.push({file,source:'file-input',chatKey:chatId,
      identity:'test-file',used:false,submittedAt:Date.now(),selectedAt:Date.now(),
      existingMessageIds:new Set(),boundMessageId:msgId,boundEpoch:0});
    f.reject();
    assert.equal(f.scan({backfill:true}).status,'failed');
    assert.equal(f.microtasks.length,0,'no async jobs before failed metadata commit');
    assert.equal(f.uiState.pendingLocalFiles[0].used,false);
    assert.equal(f.capture.failedScanDraft.fileJobs.length,1);
    f.scan({backfill:true});
    assert.ok(f.microtasks.length>=1);
    f.flush();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(Object.keys(f.stored.files).length,1,'one physical file after retry');
    const entry=Object.values(f.stored.files)[0];
    assert.equal(entry.messageId,msgId);
    assert.equal(entry.method,'text');
    assert.equal(entry.metadataOnly,false);
    assert.ok(entry.tokens>0);
    assert.equal(f.uiState.pendingLocalFiles.length,0);
  }
  console.log('PASS RC-2 rejected metadata commit cannot produce duplicate logical file');

  // a *second* failure, after metadata was committed but before
  // status:reading becomes durable, must not consume the actual File.
  {
    const f=fixture();
    let reads=0;
    const file={name:'retry.txt',size:128,lastModified:4,type:'text/plain',
      text:async()=>{reads++;return 'text from the same locally submitted file';}};
    const card={name:'retry.txt',size:128,closest:()=>null};
    const turn={querySelectorAll:()=>[card]};
    f.entries([{el:turn,id:msgId,role:'user'}]);
    f.measured({tokens:5,chars:20,fingerprint:'v3:user'});
    f.uiState.pendingLocalFiles.push({file,source:'file-input',chatKey:chatId,
      identity:'second-failure',used:false,submittedAt:Date.now(),selectedAt:Date.now(),
      existingMessageIds:new Set(),boundMessageId:msgId,boundEpoch:0});
    assert.equal(f.scan({backfill:true}).status,'persisted');
    assert.equal(f.microtasks.length,1,'metadata commit queues exactly one read');
    f.reject(); // only the initial `reading` write fails
    f.flush();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(reads,0,'file was not opened before the failed reading-state commit');
    assert.equal(f.uiState.pendingLocalFiles.length,1,'failed reading commit retains File');
    assert.equal(f.uiState.pendingLocalFiles[0].used,false);
    assert.equal(f.uiState.pendingLocalFiles[0].readingLaunchPending,false);
    assert.equal(Object.values(f.stored.files).length,1);
    assert.equal(Object.values(f.stored.files)[0].metadataOnly,true);
    assert.equal(f.scan({backfill:true}).status,'unchanged');
    assert.equal(f.microtasks.length,1,'a later scan requeues the same File');
    f.flush();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(reads,1,'exactly one successful local reading');
    assert.equal(f.uiState.pendingLocalFiles.length,0);
    assert.equal(Object.values(f.stored.files).length,1,'no duplicate logical file');
    assert.equal(Object.values(f.stored.files)[0].status,'ready');
    assert.equal(Object.values(f.stored.files)[0].metadataOnly,false);
  }
  console.log('PASS rejected initial reading state retains File for one safe retry');

  {
    const f=fixture();
    const st=f.state.loadState(chatId);
    st.files['dom-user-file:fixture']={name:'delayed.txt',size:123,type:'text/plain',
      messageId:msgId,source:'dom-history',metadataOnly:true,method:'metadata-size',
      status:'ready',tokens:0};
    assert.equal(f.save(st),true);
    let complete;
    const file={name:'delayed.txt',size:123,type:'text/plain',lastModified:3,
      text:()=>new Promise(resolve=>{complete=resolve;})};
    const task=f.fileReader.rememberSentFile(file,'file-input',chatId,msgId);
    assert.equal(typeof complete,'function','reading started after metadata persisted');
    f.reject();
    complete('valuable local file data with text');
    await task;
    const during=Object.values(f.stored.files);
    assert.equal(during.length,1);
    assert.equal(during[0].status,'reading');
    assert.equal(f.ledger.pendingFileResults.size,1);
    // Unrelated durable state does not acknowledge this failed file write.
    const extra=f.state.loadState(chatId);
    extra.messages['msg:other']=record(3);assert.equal(f.save(extra),true);
    assert.equal(f.ledger.pendingFileResults.size,1);
    assert.equal(f.ledger.storageFailures.has(chatId),true, 'unrelated write must not clear file error');
    f.fileReader.retryPendingFileResults(chatId);
    assert.equal(f.ledger.pendingFileResults.size,0);
    assert.equal(f.ledger.storageFailures.has(chatId),false);
    assert.equal(Object.values(f.stored.files).length,1);
    assert.equal(Object.values(f.stored.files)[0].status,'ready');
    assert.equal(Object.values(f.stored.files)[0].method,'text');
    assert.ok(Object.values(f.stored.files)[0].tokens>0);
  }
  console.log('PASS RC-3 completed local estimate survives failed final write and exact retry');

  // P5+10: Pause is not Wipe. A pending File read cannot commit during Pause;
  // Resume must finish the same logical file, and Wipe tombstones stale reads.
  {
    const f=fixture();
    let resolveRead, reads=0;
    const file={name:'pause.txt',size:123,type:'text/plain',lastModified:12,
      text:()=>{reads++;return new Promise(resolve=>{resolveRead=resolve;});}};
    const task=f.fileReader.rememberSentFile(file,'file-input',chatId,msgId);
    assert.equal(reads,1);
    assert.equal(Object.values(f.stored.files)[0].status,'reading');
    f.capture.settings.watchdogPaused=true;
    const before=JSON.stringify(f.stored.files);
    resolveRead('A completed local read must wait for user Resume.');
    await task;
    assert.equal(JSON.stringify(f.stored.files),before,
      'no file tokens or storage updates during user Pause');
    assert.equal(Object.values(f.stored.files)[0].status,'reading');
    f.capture.settings.watchdogPaused=false;
    f.fileReader.resumePausedFileJobs();
    assert.equal(reads,2,'paused data was not estimated; one re-read after Resume');
    resolveRead('A completed local read must wait for user Resume.');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(reads,2);
    assert.equal(Object.values(f.stored.files).length,1);
    assert.equal(Object.values(f.stored.files)[0].status,'ready');
    assert.equal(Object.values(f.stored.files)[0].method,'text');
  }
  console.log('PASS P5+10: paused local file read writes nothing; resumes one logical file');

  {
    const f=fixture();
    let resolveRead;
    const file={name:'wiped.txt',size:99,type:'text/plain',lastModified:13,
      text:()=>new Promise(resolve=>{resolveRead=resolve;})};
    const task=f.fileReader.rememberSentFile(file,'file-input',chatId,msgId);
    assert.equal(Object.values(f.stored.files)[0].status,'reading');
    f.capture.settings.watchdogPaused=true;
    f.ledger.invalidateLedgerJobs(chatId);
    f.fileReader.cancelPausedFileJobs();
    f.bytes.delete(key);
    resolveRead('This data must not resurrect a wiped ledger.');
    await task;
    f.capture.settings.watchdogPaused=false;
    f.fileReader.resumePausedFileJobs();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.bytes.has(key),false,'Wipe prevents pending async file resurrection');
    assert.equal(f.ledger.pendingFileResults.size,0);
  }
  console.log('PASS P5+10: Wipe epoch rejects in-flight paused File completion');

  {
    const f=fixture();
    let failRead, reads=0;
    const file={name:'failed.txt',size:80,type:'text/plain',lastModified:14,
      text:()=>{reads++;return new Promise((_,reject)=>{failRead=reject;});}};
    const task=f.fileReader.rememberSentFile(file,'file-input',chatId,msgId);
    f.capture.settings.watchdogPaused=true;
    failRead(new Error('simulated local file rejection during Pause'));
    await task;
    assert.equal(Object.values(f.stored.files)[0].status,'reading');
    f.capture.settings.watchdogPaused=false;
    f.fileReader.resumePausedFileJobs();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(reads,1,'a failed read is not retried without user action');
    assert.equal(Object.values(f.stored.files)[0].status,'error');
    assert.equal(Object.values(f.stored.files)[0].method,'error');
  }
  console.log('PASS P5+10: deferred read error restores error, never a false ready state');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
