'use strict';
const assert = require('node:assert/strict');
const { isolatedModules, silentPanelRendering } = require('./support/isolated-esm.cjs');
(async () => {
  class ImageNode {
    constructor(src='/photo.jpg', width=500, height=400, alt='attachment') {
      this.currentSrc = src;
      this.naturalWidth = width;
      this.naturalHeight = height;
      this.clientWidth = width;
      this.clientHeight = height;
      this.attrs = {src, alt};
      this.listeners = new Map();
      this.turn = null;
    }
    getAttribute(name) { return this.attrs[name] || null; }
    closest(selector) { return selector.includes('[data-chatgpt-search-unit-key') ? this.turn : null; }
    addEventListener(type, callback) {
      const list = this.listeners.get(type) || [];
      list.push(callback);
      this.listeners.set(type, list);
    }
    emit(type) { for (const callback of this.listeners.get(type) || []) callback({currentTarget:this}); }
  }
  class Turn {
    constructor(images=[]) { this.queries = 0; this.set(images); }
    set(images) { this.images = images; for (const img of images) img.turn=this; }
    querySelectorAll(selector) {
      assert.equal(selector, 'img');
      this.queries++;
      return [...this.images];
    }
  }
  const realm = await isolatedModules({
    HTMLImageElement: ImageNode,
    location: {pathname:'/c/a',href:'https://chatgpt.com/c/a'},
    localStorage: {getItem:()=>null,setItem:()=>{}}
  }, {'ui/16-panel-rendering.js': silentPanelRendering()});
  const {scanConversationImages, effectiveImageStats} = realm.module('chatgpt/09-dom-image-accounting.js');
  const dom = realm.module('runtime/01-runtime-dom-state.js');
  const ledger = realm.module('runtime/01-runtime-ledger-state.js');
  const capture = realm.module('runtime/01-runtime-capture-state.js');
  capture.setSettings({averageImageTokens:2000});
  let scheduled=0;
  dom.setImageRescanRequester(()=>{scheduled++});
  function state(chatKey='chat-A') { return {chatKey,domImages:{},files:{}}; }
  function inspect(entries, s, saved=true) {
    const inspected=[];
    const changed=scanConversationImages(entries,s,inspected);
    if (saved) for (const item of inspected) {
      dom.inspectedImageTurns.set(item.turn,item);
      dom.dirtyImageTurns.delete(item.turn);
    }
    return {changed,inspected};
  }
  const entry=(turn,id='message-A',role='user')=>({el:turn,id,role});
  let cases=0;
  function test(name,fn) {fn();cases++;console.log('PASS',name);}

  test('unchanged committed image skips querySelectorAll and keeps token estimate',()=>{
    const img=new ImageNode(), t=new Turn([img]),s=state(),e=[entry(t)];
    assert.equal(inspect(e,s).changed,true);
    for(let i=0;i<30;i++) assert.equal(inspect(e,s).changed,false);
    assert.equal(t.queries,1);
    assert.equal(img.listeners.get('load').length,1);
    assert.equal(effectiveImageStats(s).tokens,2000);
  });
  test('unloaded excluded icon does not block caching a valid image',()=>{
    const icon=new ImageNode('/icon.svg',0,0,'UI icon');
    const photo=new ImageNode('/photo.jpg',640,480,'attachment');
    const t=new Turn([icon,photo]),s=state(),e=[entry(t)];
    assert.equal(inspect(e,s).changed,true);
    assert.equal(effectiveImageStats(s).effective,1);
    for(let i=0;i<12;i++) assert.equal(inspect(e,s).changed,false);
    assert.equal(t.queries,1,'excluded icon cannot prevent caching the user turn');
    // The excluded icon still has a load listener. Its later load must be
    // able to invalidate the turn if its classification changes.
    icon.naturalWidth=24;icon.naturalHeight=24;
    icon.emit('load');
    inspect(e,s);
    assert.equal(t.queries,2);
    assert.equal(effectiveImageStats(s).effective,1);
  });
  test('uncommitted inspection never becomes cached',()=>{
    const t=new Turn([new ImageNode()]),s=state(),e=[entry(t)];
    inspect(e,s,false);inspect(e,s,false);
    assert.equal(t.queries,2);
    inspect(e,s,true);inspect(e,s,true);
    assert.equal(t.queries,3);
  });
  test('attribute and inserted/removed images invalidate only the affected turn',()=>{
    const a=new ImageNode(), b=new ImageNode(),t=new Turn([a]),u=new Turn([b]);
    const s=state(), es=[entry(t,'A'),entry(u,'B')];
    inspect(es,s);
    const next=new ImageNode('/next.png');t.set([a,next]);
    dom.dirtyImageTurns.add(t);
    inspect(es,s);
    assert.equal(t.queries,2);assert.equal(u.queries,1);
    assert.equal(effectiveImageStats(s).effective,3);
    t.set([a]);dom.dirtyImageTurns.add(t);inspect(es,s);
    // Historical slots remain in the ledger after DOM virtualization/removal.
    assert.equal(effectiveImageStats(s).effective,3);
    a.attrs.alt='avatar icon';dom.dirtyImageTurns.add(t);inspect(es,s);
    assert.equal(t.queries,4);
  });
  test('late dimensions never cached at 0, load invalidates and refreshes metadata',()=>{
    const img=new ImageNode('/late.png',0,0), t=new Turn([img]), s=state(),e=[entry(t)];
    assert.equal(inspect(e,s).changed,true);
    assert.equal(inspect(e,s).changed,false);
    assert.equal(t.queries,2);
    img.naturalWidth=640;img.naturalHeight=480;
    const beforeLoad=scheduled;
    img.emit('load');
    assert.equal(scheduled,beforeLoad+1);
    assert.equal(inspect(e,s).changed,true);
    assert.equal(Object.values(s.domImages)[0].width,640);
    assert.equal(Object.values(s.domImages)[0].height,480);
    inspect(e,s);
    assert.equal(t.queries,3);
    assert.equal(img.listeners.get('load').length,1);
  });
  test('load after cache commit invalidates even if srcset changed without mutation',()=>{
    const img=new ImageNode(),t=new Turn([img]),s=state(),e=[entry(t)];
    inspect(e,s);inspect(e,s);assert.equal(t.queries,1);
    img.currentSrc='/different-size.jpg';img.naturalWidth=700;img.naturalHeight=350;
    const beforeLoad=scheduled;
    img.emit('load');
    assert.equal(scheduled,beforeLoad+1);
    inspect(e,s);assert.equal(t.queries,2);
    assert.equal(effectiveImageStats(s).effective,1);
  });
  test('remount and chat identity are independently inspected',()=>{
    const t=new Turn([new ImageNode()]),s=state(),e=[entry(t)];
    inspect(e,s);inspect(e,s);assert.equal(t.queries,1);
    inspect([entry(t,'different-id')],s);assert.equal(t.queries,2);
    const fresh=new Turn([new ImageNode()]);
    inspect([entry(fresh)],s);assert.equal(fresh.queries,1);
    const next=state('chat-B');inspect([entry(t)],next);assert.equal(t.queries,3);
  });
  test('reset epoch invalidates a turn; reset or storage clears can invalidate cache',()=>{
    const t=new Turn([new ImageNode()]),s=state(),e=[entry(t)];
    inspect(e,s);inspect(e,s);assert.equal(t.queries,1);
    ledger.invalidateLedgerJobs('chat-A');
    inspect(e,state());assert.equal(t.queries,2);
    dom.setInspectedImageTurns(new WeakMap());
    inspect(e,state());assert.equal(t.queries,3);
  });
  test('nonimage, assistant and shared captured image accounting unchanged',()=>{
    const t=new Turn([]),s=state(),e=[entry(t)];
    inspect(e,s);inspect(e,s);assert.equal(t.queries,1);
    const a=new ImageNode(), assistant=new Turn([a]);
    inspect([entry(assistant,'bot','assistant')],s);
    assert.equal(assistant.queries,0);
    const userTurn=new Turn([a]);
    s.files['one']={method:'image-average',messageId:'uploaded'};
    inspect([entry(userTurn,'uploaded')],s);
    assert.equal(effectiveImageStats(s).effective,1);
    assert.equal(effectiveImageStats(s).tokens,2000);
  });
  console.log(`${cases}/${cases} new image-cache scenarios passed`);
})().catch(err=>{console.error(err);process.exitCode=1;});
