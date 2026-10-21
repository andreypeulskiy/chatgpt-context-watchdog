'use strict';
const assert = require('node:assert/strict');
const {isolatedModules,silentPanelRendering}=require('./support/isolated-esm.cjs');
const memory=new Map();
const localStorage={
  getItem:k=>memory.get(k)??null,
  setItem:(k,v)=>memory.set(k,String(v)),
  removeItem:k=>memory.delete(k)
};
(async()=>{
const realm=await isolatedModules({localStorage,location:{pathname:'/c/abc'},
  document:{querySelectorAll:()=>[]}},
  {'ui/16-panel-rendering.js':silentPanelRendering()});
const capture=realm.module('runtime/01-runtime-capture-state.js');
capture.initializeCaptureState({
  ...realm.module('runtime/01-runtime-configuration.js').DEFAULTS,
  localFileParsingLimitMiB:75
},'A');
const meta=realm.module('attachments/05-react-metadata.js');
const helpers=realm.module('attachments/05-attachment-helpers.js');
const ctx={...meta,...helpers};
let passed=0;
const test=(title,callback)=>{callback();passed++;console.log('PASS '+title);};
function makeCard(name,attachment,options={}) {
  const turn={parentElement:null};
  const card={
    parentElement:turn, textContent:name,
    getAttribute:key=>key==='title'?null:null,
    closest:()=>null,
    querySelectorAll:()=>[leaf]
  };
  const leaf={parentElement:card, textContent:name,
    getAttribute:key=>key==='title'?name:null,
    querySelectorAll:()=>[]};
  if (attachment) {
    const upper={memoizedProps:{attachment},return:null};
    leaf['__reactFiber$abc']={memoizedProps:{children:name},return:upper};
  }
  turn.contains=node=>[turn,card,leaf].includes(node) && !options.detached;
  turn.querySelectorAll=()=>[card];
  return {turn,card,leaf};
}
const mp3={name:'Lady Electra (Maxi Version).mp3',sizeBytes:12661035,
  mimeType:'audio/mpeg',durationSeconds:399.07475,id:'file_00000000c8e8824698b047c63b8c51a2'};
test('MP3: exact server-reported bytes and duration available from local React props',()=>{
  const {turn,card}=makeCard(mp3.name,mp3);
  const result=ctx.fileMetadataFromElement(card,turn);
  assert.equal(result.size,12661035);
  assert.equal(result.type,'audio/mpeg');
  assert.equal(result.durationSeconds,399.07475);
  assert.equal(result.metadataSource,'react-props');
  assert.equal(result.fileId,mp3.id);
});
test('ZIP: React sizeBytes is read without archive or network access',()=>{
  const {turn,card}=makeCard('tekst_v_arkhive(1).zip',{
    name:'tekst_v_arkhive(1).zip',sizeBytes:831,mimeType:'application/x-zip-compressed'
  });
  assert.equal(ctx.fileMetadataFromElement(card,turn).size,831);
});
test('TXT: ordinary local content remains eligible for parsing',()=>{
  const {turn,card}=makeCard('pismo_iz_budushchego.txt',{name:'pismo_iz_budushchego.txt',sizeBytes:1436,mimeType:'text/plain'});
  assert.equal(ctx.fileMetadataFromElement(card,turn).size,1436);
});
test('Images: React attachment objects are never double-counted as files',()=>{
  const {turn,card}=makeCard('image.png',{name:'image.png',sizeBytes:6857,mimeType:'image/png',width:476,height:52});
  assert.equal(ctx.fileMetadataFromElement(card,turn),null);
});
test('Foreign turn: metadata adapter refuses nodes from a different message',()=>{
  const {turn,card}=makeCard(mp3.name,mp3,{detached:true});
  assert.equal(ctx.reactAttachmentMetadata(card,turn,''),null);
});
test('Unrelated attachment object is not accepted based on presence in common React ancestors',()=>{
  const {turn,card}=makeCard('other.mp3',mp3);
  assert.equal(ctx.fileMetadataFromElement(card,turn),null);
});
test('No React: DOM-only old document card remains detectable',()=>{
  const {turn,card}=makeCard('test.pdf',null);
  const value=ctx.fileMetadataFromElement(card,turn);
  assert.equal(value.name,'test.pdf');
  assert.equal(value.size,0);
});
test('React failure: inaccessible Fiber node falls back to ordinary DOM metadata',()=>{
  const {turn,card,leaf}=makeCard('test.pdf',null);
  Object.defineProperty(leaf,'__reactFiber$blocked',{enumerable:true,
    get(){throw new Error('Cross-origin access denied');}});
  assert.equal(ctx.fileMetadataFromElement(card,turn).name,'test.pdf');
});
test('Invalid size is discarded rather than poisoning the ledger',()=>{
  const {turn,card}=makeCard('bad.zip',{name:'bad.zip',sizeBytes:-99,mimeType:'application/zip'});
  assert.equal(ctx.fileMetadataFromElement(card,turn).size,0);
});

const scanCtx=realm.module('attachments/05-attachment-scan.js');
function scanCards(cards,files={}) {
  const turn={parentElement:null};
  turn.contains=()=>true;
  const elements=[];
  for(const [name,attachment] of cards) {
    const leaf={parentElement:null,textContent:name,getAttribute:k=>k==='title'?name:null};
    const card={parentElement:turn,textContent:name,
      getAttribute:()=>null,closest:()=>null,querySelectorAll:()=>[leaf]};
    leaf.parentElement=card;
    if(attachment) leaf['__reactFiber$1']={memoizedProps:{attachment},return:null};
    elements.push(card);
  }
  turn.querySelectorAll=()=>elements;
  const state={chatKey:'A',files};
  return {result:scanCtx.scanConversationFiles([{el:turn,role:'user',id:'msg:USER'}],state),state};
}
test('R2: same-name files with incompatible known sizes stay distinct without React file IDs',()=>{
  const attachments=[
    ['report.txt',{name:'report.txt',sizeBytes:10000,mimeType:'text/plain'}],
    ['report.txt',{name:'report.txt',sizeBytes:200000,mimeType:'text/plain'}]
  ];
  const files=scanCards(attachments).state.files;
  assert.equal(Object.keys(files).length,2);
  assert.equal(new Set(Object.values(files).map(file=>file.size)).size,2);
  const again=scanCards(attachments,files).state.files;
  assert.equal(Object.keys(again).length,2);
  const near=scanCards([
    ['report.txt',{name:'report.txt',sizeBytes:10000,mimeType:'text/plain'}],
    ['report.txt',{name:'report.txt',sizeBytes:10100,mimeType:'text/plain'}]
  ]).state.files;
  assert.equal(Object.keys(near).length,2, 'Exact React byte sizes must not be fuzzily merged');
});
test('Ledger: two attachments with equal names but distinct file IDs remain separate',()=>{
  const files=scanCards([
    ['same.zip',{name:'same.zip',sizeBytes:830,mimeType:'application/zip',fileId:'file_abcdefgh111'}],
    ['same.zip',{name:'same.zip',sizeBytes:830,mimeType:'application/zip',fileId:'file_abcdefgh222'}]
  ]).state.files;
  assert.equal(Object.keys(files).length,2);
  assert.equal(new Set(Object.values(files).map(f=>f.fileId)).size,2);
});
test('Ledger: react metadata enriches a legacy file without overwriting parsed tokens',()=>{
  const original={name:'test.txt',size:0,type:'',messageId:'msg:USER',
    tokens:123,method:'text',metadataOnly:false,status:'ready',source:'dom-history'};
  const files=scanCards([['test.txt',{
    name:'test.txt',sizeBytes:1436,mimeType:'text/plain'
  }]], {'legacy-key':original}).state.files;
  assert.equal(Object.keys(files).length,1);
  assert.equal(files['legacy-key'].size,1436);
  assert.equal(files['legacy-key'].tokens,123);
  assert.equal(files['legacy-key'].method,'text');
  assert.equal(files['legacy-key'].metadataSource,'react-props');
});
test('Ledger: repeated metadata discovery does not duplicate file records',()=>{
  const initial=scanCards([['test.zip',{name:'test.zip',sizeBytes:831,mimeType:'application/zip'}]]).state.files;
  const twice=scanCards([['test.zip',{name:'test.zip',sizeBytes:831,mimeType:'application/zip'}]],initial).state.files;
  assert.equal(Object.keys(twice).length,1);
});
test('Ledger: picture attachments stay in image subsystem',()=>{
  const file=scanCards([['test.png',{name:'test.png',sizeBytes:6857,mimeType:'image/png'}]]).state.files;
  assert.equal(Object.keys(file).length,0);
});
const mergeCtx=realm.module('attachments/06-attachment-reading.js');
const ledgerIO=realm.module('storage/03-ledger-repository.js');
const saveLedger=realm.module('storage/03-ledger-commit.js').saveState;
async function testPromotion() {
  memory.clear();
  const state=ledgerIO.loadState('A');
  state.files={
    'dom-user-file:old': {name:'sample.zip',size:831,messageId:'msg:USER',
      metadataOnly:true,method:'metadata-size',status:'ready',
      metadataSource:'react-props',fileId:'file_12345678'}
  };
  assert.equal(saveLedger(state),true);
  await mergeCtx.rememberSentFile({name:'sample.zip',size:831,lastModified:0,
    type:'application/zip'},'file-input','A','msg:USER');
  const values=Object.values(ledgerIO.loadState('A').files);
  assert.equal(values.length,1);
  assert.equal(values[0].fileId,'file_12345678');
  assert.equal(values[0].metadataSource,'react-props');
  assert.equal(values[0].method,'metadata-size');
  assert.equal(values[0].metadataOnly,true);
  console.log('PASS Local file promotion preserves previously enriched React metadata');passed++;
}

const textCtx=mergeCtx;
  await testPromotion();
  const file={name:'test.txt',type:'text/plain',size:14,text:async()=> 'hello world!'};
  const result=await textCtx.estimateFileTokens(file);
  assert.equal(result.method,'text');
  assert.equal(result.tokens,realm.module('chatgpt/04-text-estimators.js').estimateProseTokens('hello world!'));
  console.log('PASS Plain-text: local reading stays enabled');passed++;
  console.log(`\n${passed} native ESM attachment regressions passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
