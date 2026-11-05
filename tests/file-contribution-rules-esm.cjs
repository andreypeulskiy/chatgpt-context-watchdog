'use strict';
const assert = require('node:assert/strict');
const {isolatedModules,silentPanelRendering} = require('./support/isolated-esm.cjs');
(async () => {
  const data = new Map();
  const realm = await isolatedModules({localStorage:{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)}},
    {'ui/16-panel-rendering.js':silentPanelRendering()});
  const {DEFAULTS,SETTINGS_KEY} = realm.module('runtime/01-runtime-configuration.js');
  const {setSettings} = realm.module('runtime/01-runtime-capture-state.js');
  const {fileForecast} = realm.module('app/07-forecast.js');
  const {loadSettings} = realm.module('storage/03-settings-store.js');
  const {normalizedExtension,parseContributionPercent,normalizeContributionRules,contributionForFile} =
    realm.module('core/file-contribution-rules.js');
  let count=0;
  const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
  const parsed={name:'catalog.JSON',method:'text',tokens:2605185,size:8706298,metadataOnly:false};
  const meta={name:'catalog.json',method:'metadata-size',metadataOnly:true,size:1048576,tokens:0};
  const other={name:'file.md',method:'text',tokens:8000,size:30000,metadataOnly:false};
  const forecast=(files,settings)=>{setSettings(settings);return fileForecast(files);};
  check('old settings keep parsed and metadata-only forecast',()=>{
    const p=forecast({file:other},DEFAULTS);
    assert.equal(p.fileOptimistic,2000);assert.equal(p.filePessimistic,6000);
    const m=forecast({file:{...meta,name:'file.pdf'}},DEFAULTS);
    assert.equal(m.fileOptimistic,1500);assert.equal(m.filePessimistic,11000);
  });
  check('0.02 percent parsed JSON and 0.10 percent metadata JSON',()=>{
    const settings={...DEFAULTS,fileContributionByExt:{json:{parsedMin:0.02,parsedMax:0.05,metadataMin:0.10,metadataMax:0.20}}};
    const p=forecast({file:parsed},settings);
    assert.equal(p.fileOptimistic,Math.ceil(2605185*0.0002));
    assert.equal(p.filePessimistic,Math.ceil(2605185*0.0005));
    const m=forecast({file:meta},settings);
    assert.equal(m.fileOptimistic,2);
    assert.equal(m.filePessimistic,22);
    const otherForecast=forecast({file:other},settings);
    assert.equal(otherForecast.fileOptimistic,2000);
    assert.equal(otherForecast.filePessimistic,6000);
  });
  check('zero contribution and equal endpoints are legal',()=>{
    const rules=normalizeContributionRules({json:{parsedMin:0,parsedMax:0,metadataMin:0.2,metadataMax:0.2}});
    const values={...DEFAULTS,fileContributionByExt:rules};
    assert.equal(forecast({file:parsed},values).filePessimistic,0);
    assert.deepEqual(Array.from(contributionForFile(meta,values,'metadata')),[0.2,0.2]);
  });
  check('strict percentages: 0.02 allowed, fractional precision capped at 2',()=>{
    for(const [text,value] of [['0',0],['0.01',0.01],['0.02',0.02],['0.07',0.07],['100.00',100],['1.25',1.25]])
      assert.equal(parseContributionPercent(text),value,text);
    for(const text of ['','-1','0.001','100.01','1e2','NaN','Infinity','abc'])
      assert.equal(parseContributionPercent(text),null,text);
  });
  check('normalize rejects unsafe extensions, inverted ranges, duplicate aliases',()=>{
    const rule={parsedMin:0,parsedMax:10,metadataMin:0,metadataMax:100};
    for(const extension of ['../json','json?','somethinglongerthan16'])
      assert.equal(Object.keys(normalizeContributionRules({[extension]:rule})).length,0);
    assert.equal(Object.keys(normalizeContributionRules({json:{...rule,parsedMin:90,parsedMax:10}})).length,0);
    assert.equal(normalizedExtension('.JSON'),'json');
    assert.equal(Object.keys(normalizeContributionRules({'JSON':rule})).length,0);
  });
  check('migration: unconfigured old settings do not alter calculations',()=>{
    data.set(SETTINGS_KEY,JSON.stringify({fileOptimisticPct:5,filePessimisticPct:25}));
    const loaded=loadSettings();
    assert.equal(loaded.fileOptimisticPct,5);assert.equal(loaded.filePessimisticPct,25);
    assert.equal(loaded.metadataFileOptimisticPct,100);assert.equal(loaded.metadataFilePessimisticPct,100);
    assert.equal(Object.keys(loaded.fileContributionByExt).length,0);
    assert.equal(forecast({file:parsed},loaded).fileOptimistic,Math.ceil(2605185*.05));
  });
  check('persisted extension rows are validated and invalid sets ignored',()=>{
    data.set(SETTINGS_KEY,JSON.stringify({fileContributionByExt:{json:{parsedMin:0.01,parsedMax:0.03,metadataMin:0,metadataMax:100}}}));
    let s=loadSettings();
    assert.equal(s.fileContributionByExt.json.parsedMax,0.03);
    data.set(SETTINGS_KEY,JSON.stringify({fileContributionByExt:{json:{parsedMin:0.001,parsedMax:0.03,metadataMin:0,metadataMax:100}}}));
    s=loadSettings();assert.equal(Object.keys(s.fileContributionByExt).length,0);
  });
  check('auto-paste and historical fallback unchanged without custom rules',()=>{
    const old={name:'old.docx',method:'metadata-size',source:'dom-history',size:0,tokens:0};
    const out=forecast({file:old},DEFAULTS);
    assert.deepEqual([out.fileOptimistic,out.filePessimistic],[250,750]);
    const paste={name:'Pasted text.txt',source:'dom-history',size:0,tokens:0,autoPaste:true};
    const p=forecast({file:paste},DEFAULTS);
    assert.deepEqual([p.fileOptimistic,p.filePessimistic],[625,2728]);
  });
  setSettings(DEFAULTS);
  console.log(count+' file-contribution checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
