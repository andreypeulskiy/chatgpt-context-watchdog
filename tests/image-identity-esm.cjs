'use strict';
const assert = require('node:assert/strict');
const {isolatedModules,silentPanelRendering}=require('./support/isolated-esm.cjs');
(async()=>{
class FakeImage {
  constructor(src, alt='Приложение пользователя', w=476,h=52) {
    this.currentSrc = src;
    this._src=src;this._alt=alt;
    this.naturalWidth=w;this.naturalHeight=h;
    this.clientWidth=78;this.clientHeight=78;
  }
  getAttribute(name) {return name==='src'?this._src:name==='alt'?this._alt:null;}
  closest() {return null;}
}
const realm=await isolatedModules({
  HTMLImageElement:FakeImage,location:{href:'https://chatgpt.com/c/abc',pathname:'/c/abc'},
  localStorage:{getItem:()=>null,setItem:()=>{}}
},{'ui/16-panel-rendering.js':silentPanelRendering()});
realm.module('runtime/01-runtime-capture-state.js').setSettings({averageImageTokens:2100});
const ctx=realm.module('chatgpt/09-dom-image-accounting.js');
const mkState = () => ({ chatKey:'chat:A', files:{}, domImages:{} });
const entry = (id,images) => ({role:'user',id,el:{querySelectorAll:selector=>selector==='img'?images:[]}});
const stats = state => ctx.effectiveImageStats(state);
let passes=0;
function test(name, fn){fn();passes++;console.log('PASS',name)}
test('One PNG is recorded once, including image size 476x52',()=>{
 const s=mkState();
 const a=entry('msg:A',[new FakeImage('https://cdn.example/file123.png?sig=first')]);
 assert.equal(ctx.scanConversationImages([a],s),true);
 assert.equal(Object.keys(s.domImages).length,1);
 assert.equal(stats(s).effective,1);
 assert.equal(stats(s).tokens,2100);
});
test('Changing pathname and signed URL on eight reloads never creates a second image',()=>{
 const s=mkState();
 for(let n=0;n<9;n++) {
  const a=entry('msg:A',[new FakeImage(`https://cdn.example/dynamic-${n}.png?sig=${n}`)]);
  const changed=ctx.scanConversationImages([a],s);
  assert.equal(changed,n===0);
  assert.equal(stats(s).effective,1);
  assert.equal(stats(s).historical,1);
  assert.equal(Object.keys(s.domImages).length,1);
 }
});
test('Unknown image keys are excluded from counts without mutating their records',()=>{
 const s=mkState();
 for(let n=0;n<9;n++) s.domImages[`unsupported-image:${n}`]={
  messageId:'msg:A',width:476,height:52,tokens:2100
 };
 const original=JSON.stringify(s.domImages);
 assert.equal(stats(s).effective,0);
 assert.equal(stats(s).historical,0);
 assert.equal(JSON.stringify(s.domImages),original);
 assert.equal(ctx.scanConversationImages([entry('msg:A',[new FakeImage('/image.png')])],s),true);
 assert.equal(stats(s).effective,1);
 assert.equal(stats(s).tokens,2100);
 assert.equal(stats(s).historical,1);
 assert.equal(Object.keys(s.domImages).length,10);
 assert.equal(ctx.scanConversationImages([entry('msg:A',[new FakeImage('/image2.png')])],s),false);
});
test('Two images in the same message remain two even if URLs and dimensions match',()=>{
 const s=mkState();
 const a=entry('msg:A',[new FakeImage('/path/a.png'),new FakeImage('/path/a.png')]);
 ctx.scanConversationImages([a],s);
 assert.equal(stats(s).effective,2);
 ctx.scanConversationImages([entry('msg:A',[new FakeImage('/new/1.png'),new FakeImage('/new/2.png')])],s);
 assert.equal(stats(s).effective,2);
 assert.equal(Object.keys(s.domImages).length,2);
});
test('Distinct message UUIDs each retain own image slots',()=>{
 const s=mkState();
 ctx.scanConversationImages([entry('msg:A',[new FakeImage('/same.png')]),entry('msg:B',[new FakeImage('/same.png')])],s);
 assert.equal(stats(s).effective,2);
});
test('Local captured image and DOM slot with same UUID are not double counted',()=>{
 const s=mkState();
 s.files['capture-1']={messageId:'msg:A',method:'image-average'};
 ctx.scanConversationImages([entry('msg:A',[new FakeImage('/image1.png')])],s);
 assert.equal(stats(s).effective,1);
 assert.equal(stats(s).captured,1);
});
test('Stable image slots remain counted after virtualization unmounts their DOM',()=>{
 const s=mkState();
 ctx.scanConversationImages([entry('msg:OUT_OF_DOM',[new FakeImage('/gone.png')])],s);
 ctx.scanConversationImages([],s);
 assert.equal(stats(s).effective,1);
});
test('Assistant images cannot enter user image ledger',()=>{
 const s=mkState();
 ctx.scanConversationImages([{...entry('msg:B',[new FakeImage('/assistant.png')]),role:'assistant'}],s);
 assert.equal(stats(s).effective,0);
});
console.log(`\n${passes} current ESM image-identity regressions passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
