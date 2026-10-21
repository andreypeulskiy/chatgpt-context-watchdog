'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname,'..');
const file = path.join(root,'src/core/context-estimate.js');
const raw = fs.readFileSync(file,'utf8');
assert.doesNotMatch(raw,/^import\s/m,'Context formulas must be independent of DOM and storage');
assert.doesNotMatch(raw,/\b(?:localStorage|document|window|fetch|XMLHttpRequest)\b/);
const context={};
vm.createContext(context);
vm.runInContext(raw.replace(/^export\s+\{[^}]+\};\s*$/gm,'')+
  '\ncompute=calculateContextEstimate;',context);
const compute=(chat,files,images,settings)=>JSON.parse(JSON.stringify(
  context.compute({},chat,files,images,settings)));
const files={fileOptimistic:50,filePessimistic:90,knownTokens:20,
  fileCount:2,parsedFiles:1,metadataFiles:1,reactMetadataFiles:0,
  unparsedFiles:0,unknownSizeFiles:0,autoPasteMinimumFiles:0,
  autoPasteMinimumChars:0,totalBytes:4096,sampledTextFiles:1,
  fullyReadTextFiles:1};
const images={tokens:35,effective:1,captured:1,historical:0};
const settings={imageOptimisticPct:40,imagePessimisticPct:80,
  hiddenOptimistic:100,hiddenPessimistic:200};
const result=compute(120,files,images,settings);
assert.deepEqual({optimistic:result.optimistic,pessimistic:result.pessimistic,
  fileOptimistic:result.fileOptimistic,filePessimistic:result.filePessimistic,
  imageOptimistic:result.imageOptimistic,imagePessimistic:result.imagePessimistic,
  knownTokens:result.knownTokens,knownFiles:result.knownFiles},
  {optimistic:284,pessimistic:438,fileOptimistic:50,filePessimistic:90,
   imageOptimistic:14,imagePessimistic:28,knownTokens:55,knownFiles:3});
assert.equal(result.totalFileBytes,4096);
assert.equal(compute(100,files,images,{...settings,hiddenOptimistic:0,hiddenPessimistic:0}).optimistic,164);
const zero={...files,fileOptimistic:0,filePessimistic:0,knownTokens:0,
  fileCount:0,parsedFiles:0,metadataFiles:0,totalBytes:0};
assert.equal(compute(12,zero,{...images,tokens:0,effective:0},
  {...settings,hiddenOptimistic:0,hiddenPessimistic:0}).optimistic,12);
for(let seed=0;seed<250;seed++){
  const config={imageOptimisticPct:(seed*17)%101,imagePessimisticPct:(seed*31)%101,
    hiddenOptimistic:(seed*1003)%40000,hiddenPessimistic:(seed*2111)%50000};
  const imageStats={tokens:seed*139,effective:seed%4,captured:seed%3,historical:seed%2};
  const ff={...files,fileOptimistic:seed*107,filePessimistic:seed*257,knownTokens:seed*73,
    fileCount:seed%12,parsedFiles:seed%5,metadataFiles:seed%4,
    reactMetadataFiles:seed%2,unparsedFiles:seed%3,unknownSizeFiles:seed%6,
    autoPasteMinimumFiles:seed%2,autoPasteMinimumChars:seed*103,totalBytes:seed*5313};
  const chat=seed*397;
  const result=compute(chat,ff,imageStats,config);
  assert.equal(result.imageOptimistic,Math.ceil(imageStats.tokens*config.imageOptimisticPct/100));
  assert.equal(result.imagePessimistic,Math.ceil(imageStats.tokens*config.imagePessimisticPct/100));
  assert.equal(result.optimistic,chat+ff.fileOptimistic+result.imageOptimistic+config.hiddenOptimistic);
  assert.equal(result.pessimistic,chat+ff.filePessimistic+result.imagePessimistic+config.hiddenPessimistic);
  assert.equal(result.knownTokens,ff.knownTokens+imageStats.tokens);
  assert.equal(result.knownFiles,ff.fileCount+imageStats.effective);
  assert.equal(result.totalFileBytes,ff.totalBytes);
  assert.equal(result.capturedImages,imageStats.captured);
}
console.log('PASS pure current context formula: explicit examples and 250 deterministic invariants');
