'use strict';
// Settings: reference values are literal golden outputs, not
// derived from production metadataFileContextEstimate.
const assert=require('node:assert/strict');
const {isolatedModules,silentPanelRendering}=require('./support/isolated-esm.cjs');
const memory=new Map();
const localStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,String(v))};
(async()=>{
 const realm=await isolatedModules({localStorage,location:{pathname:'/c/test'},document:{querySelectorAll:()=>[]}},
   {'ui/16-panel-rendering.js':silentPanelRendering()});
 const {DEFAULTS,METADATA_SETTING_SPECS,IS_DEV_BUILD}=realm.module('runtime/01-runtime-configuration.js');
 const {initializeCaptureState}=realm.module('runtime/01-runtime-capture-state.js');
 const {setChatAvailable}=realm.module('runtime/01-runtime-pause-state.js');
 const {metadataFileContextEstimate}=realm.module('attachments/05-attachment-helpers.js');
 const {loadSettings}=realm.module('storage/03-settings-store.js');
 const {setSettings}=realm.module('runtime/01-runtime-capture-state.js');
 const {fileForecast}=realm.module('app/07-forecast.js');
 const {estimateFileTokens}=realm.module('attachments/06-attachment-reading.js');
 const {metadataControlsMarkup,LAZY_ESTIMATION_MARKUP}=realm.module('ui/13-panel-markup.js');
 const {registerUiHints}=realm.module('ui/14-panel-components.js');
 let pass=0;
 function check(name,fn){fn();console.log('PASS '+name);pass++;}
 check('13 defaults and fields from one registry',()=>{
   assert.equal(METADATA_SETTING_SPECS.length,13);
   assert.equal(new Set(METADATA_SETTING_SPECS.map(x=>x.key)).size,13);
   for(const s of METADATA_SETTING_SPECS) assert.equal(DEFAULTS[s.key],s.default);
 });
 check('rc4 agreed text/file defaults are distinct from rc3',()=>{
   assert.equal(DEFAULTS.proseCyrillicCharsPerToken,2.38);
   assert.equal(DEFAULTS.prosePunctuationCharsPerToken,1.5);
   assert.equal(DEFAULTS.proseOtherCharsPerToken,1);
   assert.equal(DEFAULTS.codeCharsPerToken,2.3);
   assert.equal(DEFAULTS.messageOverhead,8);
   assert.equal(DEFAULTS.historicalFileFallbackTokens,1000);
   assert.equal(DEFAULTS.pastedCyrillicCharsPerToken,2.75);
   assert.deepEqual([DEFAULTS.fileOptimisticPct,DEFAULTS.filePessimisticPct],[25,75]);
 });
 check('numeric field tooltip is inherited from caption even after repeated registration',()=>{
   const tip='Test exact percentage of file contribution.';
   const cls=names=>Object.assign(new Set(names),{contains(name){return this.has(name);}});
   const caption={tagName:'SPAN',classList:cls(['cw-field-caption']),dataset:{},
     getAttribute(name){return name==='title'?this.title:null;},
     removeAttribute(name){if(name==='title')this.title=null;},title:tip};
   const label={textContent:'Some calibration coefficient',querySelector(sel){return sel==='.cw-field-caption'?caption:null;}};
   const field={tagName:'INPUT',classList:cls(['cw-test-calibration']),dataset:{},
     getAttribute(){return null;},removeAttribute(){},closest(sel){return sel==='label'?label:null;}};
   const section={querySelectorAll(){return [caption,field];}};
   registerUiHints(section);
   assert.equal(caption.dataset.cwTip,tip);
   assert.equal(field.dataset.cwTip,tip);
   registerUiHints(section);
   assert.equal(field.dataset.cwTip,tip, 'no generic Edit... hint after second registration');
 });
 check('golden metadata-only outputs stay unchanged on defaults',()=>{
   const mib=1048576;
   for(const [name,size,opt,pess] of [
     ['doc.pdf',mib,1500,11000],['table.xlsx',mib,1725,12650],
     ['note.docx',mib,1275,9350],['slides.pptx',mib,1200,8800],
     ['data.zip',mib,750,5500],['unknown.foobar',mib,975,7150],
     ['doc.pdf',0,0,0],['doc.pdf',1024*mib,10000,50000]]){
       const actual=metadataFileContextEstimate({name,size},DEFAULTS);
       assert.equal(actual.optimistic,opt,`${name} opt ${size}`);
       assert.equal(actual.pessimistic,pess,`${name} pess ${size}`);
     }
 });
 check('independent parameter adjustments, without modifying defaults',()=>{
   const b=1048576;
   const cases=[
     ['metadataOnlyOptimisticBase',350,1550,11000],
     ['metadataOnlyOptimisticSizeFactor',1250,1550,11000],
     ['metadataOnlyPessimisticBase',2100,1500,11100],
     ['metadataOnlyPessimisticSizeFactor',9100,1500,11100],
     ['metadataOnlyTypeFactorPdf',1.05,1575,11550]
   ];
   for (const [key,val,opt,pess] of cases){
     const actual=metadataFileContextEstimate({name:'p.pdf',size:b},{...DEFAULTS,[key]:val});
     assert.equal(actual.optimistic,opt,key+' opt');
     assert.equal(actual.pessimistic,pess,key+' pess');
   }
 });
 check('storage roundtrip 0 and 13 metadata values',()=>{
   const changes={...DEFAULTS,localFileParsingLimitMiB:0,
     metadataOnlyTypeFactorPdf:1.5,metadataOnlyOptimisticBase:350};
   memory.set('cgpt-context-watchdog:settings:v1',JSON.stringify(changes));
   const loaded=loadSettings();
   assert.equal(loaded.localFileParsingLimitMiB,0);
   assert.equal(loaded.metadataOnlyTypeFactorPdf,1.5);
   assert.equal(loaded.metadataOnlyOptimisticBase,350);
   assert.equal(loaded.fileOptimisticPct,25);
   assert.equal(loaded.filePessimisticPct,75);
 });
 check('file weights are user settings in all applicable forecast paths',()=>{
   function forecast(config,file) {
     setSettings(config);
     return fileForecast({file});
   }
   const parsed={name:'large.txt',method:'text',size:256,tokens:8000,metadataOnly:false};
   const historical={name:'historical.docx',source:'dom-history',size:0,tokens:0};
   const pasted={name:'Pasted text.txt',autoPaste:true,source:'dom-history',size:0,tokens:0};
   const metadata={name:'doc.pdf',size:1048576,metadataOnly:true,method:'metadata-size'};
   const baseline={...DEFAULTS};
   for(const lastSeenAt of [0,Date.now()-86400000*200]) {
     const v=forecast(baseline,{...parsed,lastSeenAt});
     assert.equal(v.fileOptimistic,2000);
     assert.equal(v.filePessimistic,6000);
   }
   assert.deepEqual([forecast(baseline,historical).fileOptimistic,
     forecast(baseline,historical).filePessimistic],[250,750]);
   assert.deepEqual([forecast(baseline,pasted).fileOptimistic,
     forecast(baseline,pasted).filePessimistic],[625,2728]);
   const custom={...DEFAULTS,fileOptimisticPct:40,filePessimisticPct:90};
   assert.deepEqual([forecast(custom,parsed).fileOptimistic,
     forecast(custom,parsed).filePessimistic],[3200,7200]);
   assert.deepEqual([forecast(custom,historical).fileOptimistic,
     forecast(custom,historical).filePessimistic],[400,900]);
   assert.deepEqual([forecast(custom,pasted).fileOptimistic,
     forecast(custom,pasted).filePessimistic],[1000,3274]);
   for(const weights of [baseline,custom]) {
     const result=forecast(weights,metadata);
     assert.deepEqual([result.fileOptimistic,result.filePessimistic],[1500,11000],
       'metadata-only estimation must not be multiplied by parsed-file weights');
   }
   setSettings(DEFAULTS);
 });
 check('file weights survive storage and inverted pairs are rejected',()=>{
   memory.set('cgpt-context-watchdog:settings:v1',JSON.stringify({
     fileOptimisticPct:40,filePessimisticPct:90,
     fileRecentOptimisticPct:0,fileOlderPessimisticPct:0,fileFreshMinutes:999
   }));
   let loaded=loadSettings();
   assert.equal(loaded.fileOptimisticPct,40);
   assert.equal(loaded.filePessimisticPct,90);
   assert.equal(Object.hasOwn(loaded,'fileFreshMinutes'),false);
   assert.equal(Object.hasOwn(loaded,'fileRecentOptimisticPct'),false);
   memory.set('cgpt-context-watchdog:settings:v1',JSON.stringify({
     fileOptimisticPct:95,filePessimisticPct:20
   }));
   loaded=loadSettings();
   assert.equal(loaded.fileOptimisticPct,25);
   assert.equal(loaded.filePessimisticPct,75);
 });
 check('invalid metadata bounds revert; off-grid saved values stay intact',()=>{
   memory.set('cgpt-context-watchdog:settings:v1',JSON.stringify({
     metadataOnlyOptimisticBase:333,metadataOnlyTypeFactorPdf:Infinity,
     metadataOnlyTypeFactorArchive:0.72,localFileParsingLimitMiB:-1}));
   const loaded=loadSettings();
   assert.equal(loaded.metadataOnlyOptimisticBase,333);
   assert.equal(loaded.metadataOnlyTypeFactorPdf,1);
   assert.equal(loaded.metadataOnlyTypeFactorArchive,.72);
   assert.equal(loaded.localFileParsingLimitMiB,75);
 });
 check('metadata-only fields are shared by Stable and Dev',()=>{
   assert.equal(IS_DEV_BUILD,false); // source build flag does not gate this editor
   const html=metadataControlsMarkup(METADATA_SETTING_SPECS);
   assert.equal((html.match(/type="number"/g)||[]).length,13);
   assert.equal((html.match(/class="cw-field-caption" title="/g)||[]).length,13,
     'Each metadata-only label needs a project-native tooltip');
   assert.equal((html.match(/type="number"[^>]*title=/g)||[]).length,0,
     'Metadata numeric inputs must derive hints from captions like existing fields');
   for(const spec of METADATA_SETTING_SPECS) {
     assert.ok(spec.hint && spec.hint.length > 20,`Missing meaningful hint: ${spec.key}`);
     assert.ok(html.includes(`title="${spec.hint}"`),`Hint not rendered: ${spec.key}`);
   }
   assert.match(html,/>Formula<\/div>/);
   assert.match(html,/>File types<\/div>/);
   assert.doesNotMatch(html,/6 parameters|7 coefficients/);
   assert.match(html,/<summary>Metadata-only estimation<\/summary>/);
   assert.doesNotMatch(html,/Metadata-only estimation · 13 settings/);
   assert.match(LAZY_ESTIMATION_MARKUP.attachment, /<summary>Main file &amp; image settings<\/summary>/);
   assert.doesNotMatch(LAZY_ESTIMATION_MARKUP.attachment,/Main file &amp; image settings · 3 settings/);
   assert.match(html,/File types/);
   assert.doesNotMatch(html,/cw-save-metadata|cw-reset-metadata/);
 });
 initializeCaptureState({...DEFAULTS,localFileParsingLimitMiB:0},'test');
 setChatAvailable(true);
 const file={name:'test.txt',size:1234,type:'text/plain',text:async()=>{throw Error('read prohibited');}};
 const zero=await estimateFileTokens(file);
 assert.equal(zero.metadataOnly,true);
 assert.equal(zero.method,'too-large');
 console.log('PASS parsing limit 0: no read even if file has known size');pass++;
 const empty={name:'empty.txt',size:0,type:'text/plain',text:async()=>{throw Error('read prohibited');}};
 const emptyResult=await estimateFileTokens(empty);
 assert.equal(emptyResult.metadataOnly,true);
 console.log('PASS parsing limit 0: no read even for empty text file');pass++;
 console.log(`${pass}/${pass} rc4 settings scenarios PASS`);
})().catch(err=>{console.error(err);process.exitCode=1;});
