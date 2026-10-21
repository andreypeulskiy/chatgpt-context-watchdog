'use strict';
const assert=require('node:assert/strict');
const {isolatedModules,silentPanelRendering}=require('./support/isolated-esm.cjs');
(async()=>{
 const realm=await isolatedModules({localStorage:{getItem:()=>null,setItem(){}}},
    {'ui/16-panel-rendering.js':silentPanelRendering()});
 const {DEFAULTS}=realm.module('runtime/01-runtime-configuration.js');
 const {NUMERIC_SETTING_SPECS,numericStep,normalizeNumericSetting}=realm.module('runtime/01-numeric-settings.js');
 const {SETTING_GROUPS}=realm.module('ui/15-panel-settings-controls.js');
 const {LAZY_ESTIMATION_MARKUP,LAZY_VIEW_MARKUP}=realm.module('ui/13-panel-markup.js');
 let checks=0;
 function check(name,fn){fn();checks++;console.log('PASS '+name);}
 check('37 editable controls use the same numeric domain as storage',()=>{
   const keys=Object.values(SETTING_GROUPS).flatMap(g=>g.fields.map(([,key])=>key));
   assert.equal(keys.length,37);
   assert.equal(new Set(keys).size,37);
   for(const key of keys){
     const spec=NUMERIC_SETTING_SPECS[key];
     assert.ok(spec,'missing '+key);
     assert.ok(Object.hasOwn(DEFAULTS,key));
     assert.ok(DEFAULTS[key]>=spec.min && DEFAULTS[key]<=spec.max,key);
   }
 });
 check('steps depend exclusively on source DEFAULTS and numeric kind',()=>{
   for(const [key,expected] of [
     ['proseCyrillicCharsPerToken',.01],['metadataOnlyTypeFactorPdf',.01],
     ['fileOptimisticPct',1],['localFileParsingLimitMiB',1],
     ['metadataOnlyOptimisticBase',1],['metadataOnlyOptimisticSizeFactor',10],
     ['averageImageTokens',10],['metadataOnlyOptimisticMax',100],
     ['conservativeBudget',100],['normalBudget',1000],
     ['historyPriorStrength',1]
   ]) assert.equal(numericStep(key),expected,key);
 });
 check('manually edited values normalize to the DEFAULTS anchored grid',()=>{
   for(const [key,value,expected] of [
     ['proseCyrillicCharsPerToken',2.386,2.39],
     ['proseCyrillicCharsPerToken',2.385,2.39],
     ['metadataOnlyTypeFactorPdf',1.157,1.16],
     ['metadataOnlyOptimisticMax',10347,10300],
     ['normalBudget',121347,121000],
     ['averageImageTokens',2107,2110],
     ['hiddenOptimistic',4358,4360]
   ]) assert.equal(normalizeNumericSetting(key,value),expected,key);
 });
 check('invalid/out-of-range is never silently interpreted as default',()=>{
   for(const v of [-10,Infinity,NaN,1e10])
     assert.equal(normalizeNumericSetting('normalBudget',v),null);
 });
 check('newly bound inputs own min/max/step instead of HTML duplications',()=>{
   const markup=Object.values(LAZY_ESTIMATION_MARKUP).join('') +
     LAZY_VIEW_MARKUP.budgetForm+LAZY_VIEW_MARKUP.technicalForm;
   assert.doesNotMatch(markup,/type=\\?"number\\?"\s+(?:min|max|step)=/);
 });
 console.log(checks+' numeric settings checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
