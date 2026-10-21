// Contracts for the current estimator, DOM collector and hot-path behavior.
// Isolated Node fixtures, not browser performance measurements.
'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {performance} = require('node:perf_hooks');
const {source} = require('./support/module-source.cjs');
const estimatorCode = source('04-text-estimators.js');
const composerCode = source('09-dom-composer-state.js');
const collectorCodes = ['09-dom-collection.js', '09-dom-unit-identity.js',
  '09-dom-message-identity.js'].map(source);
const UUID = 'aabbccdd-1111-2222-3333-444455556666';
let passed = 0;
function sourceOf(text, name) {
  const found = new RegExp(`^  function ${name}\\(`, 'm').exec(text);
  assert.ok(found, `Missing current source function ${name}`);
  const endRe = /\n  }(?=\n)/g;
  endRe.lastIndex = found.index;
  const end = endRe.exec(text);
  assert.ok(end, `Unterminated current function ${name}`);
  return text.slice(found.index, end.index + 4);
}
function test(label, fn) {
  fn(); passed++;
  console.log(`PASS ${label}`);
}
function makeEstimator(cfg) {
  const ctx = {settings: cfg, Uint8Array};
  vm.createContext(ctx);
  const prefix = estimatorCode.slice(estimatorCode.indexOf('  const PROSE_ASCII_PUNCTUATION ='),
    estimatorCode.indexOf('  function estimateProseTokens('));
  vm.runInContext(`${prefix}\n${sourceOf(estimatorCode,'estimateProseTokens')}\nglobalThis.estimate=estimateProseTokens;`, ctx);
  return ctx.estimate;
}
// Independent, intentionally regex-based reference for the documented token buckets.
// In particular, /\S/g without the u flag counts surrogate halves separately.
const PUNCTUATION = `.,!?;:'"()[]{}<>@#$%^&*_=+~\`|\\/-–—`;
function referenceEstimate(text, cfg) {
  if (!text) return 0;
  let cyr=0, latin=0, digits=0, punctuation=0, other=0;
  for (const ch of text.match(/\S/g) || []) {
    if (/[\u0400-\u052f]/.test(ch)) cyr++;
    else if (/[A-Za-z]/.test(ch)) latin++;
    else if (/[0-9]/.test(ch)) digits++;
    else if (PUNCTUATION.includes(ch)) punctuation++;
    else other++;
  }
  const words=(text.match(/\S+/g)||[]).length;
  const byCharacters = cyr/cfg.proseCyrillicCharsPerToken +
    latin/cfg.proseLatinCharsPerToken + digits/cfg.proseDigitsCharsPerToken +
    punctuation/cfg.prosePunctuationCharsPerToken + other/cfg.proseOtherCharsPerToken;
  return Math.ceil(Math.max(byCharacters,words*cfg.proseMinTokensPerWord));
}
const defaults = {
  proseCyrillicCharsPerToken: 1.75, proseLatinCharsPerToken: 3.45,
  proseDigitsCharsPerToken: 2.6, prosePunctuationCharsPerToken: 2.2,
  proseOtherCharsPerToken: 1.7, proseMinTokensPerWord: 1.45
};
const estimate = makeEstimator(defaults);
const assertReference = (s, fn=estimate, cfg=defaults) =>
  assert.equal(fn(s), referenceEstimate(s,cfg), `Estimate for ${JSON.stringify(s.slice(0,80))}`);
test('All 65,536 UTF-16 code units agree with independent regex categories', () => {
  for(let i=0;i<=0xFFFF;i++) assertReference(String.fromCharCode(i));
});
test('Unicode whitespace, emoji, punctuation and word boundaries match the contract', () => {
  for (const s of [
    '', ' ', 'a\tb\n\u00A0в\u200Aг\u3000D\uFEFF',
    'привет мир! Hello, world 2026.', '🧠😀🤖🚀🔥',
    'a'.repeat(65536), 'русский english 123-456!'.repeat(3000),
    ' \n \t '.repeat(3000), '⚡'.repeat(10000),
    'a\u200bb', 'a\r\nb', '\ud800\udc00'
  ]) assertReference(s);
});
// Reproducible exploration of mixed Unicode inputs, without depending on old builds.
let seed = 0x12345678;
function random() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }
const chars = 'абвгдежзИЙЪЫѣтёлатинABCabcXYZ0123456789 \n\t\r\u00A0\u200B\u200A\u3000\uFEFF.,:;!?*\\/+-_–—@#%^&|()[]{}🧠🔥🎯⟪⟫';
test('5,000 deterministic mixed-Unicode texts satisfy the independent oracle', () => {
  for (let i=0;i<5000;i++) {
    const size = Math.floor(random()*400);
    let text='';
    for(let j=0;j<size;j++) text += chars[Math.floor(random()*chars.length)];
    assertReference(text);
  }
});
test('2,500 alternative settings and sample combinations preserve token buckets', () => {
  for (let i=0;i<50;i++) {
    const cfg = Object.fromEntries(Object.keys(defaults).map(k =>
      [k, k==='proseMinTokensPerWord' ? random()*5 : 0.25+random()*12]));
    const tokenCount=makeEstimator(cfg);
    for(let j=0;j<50;j++) assertReference(chars.repeat(Math.floor(random()*12)+1),tokenCount,cfg);
  }
});
const domNames = [
  'domDocumentOrder','hasMountedMessageLayout','searchUnitInfo',
  'searchUnitRealMessageId','inferRole','getStructuralMessageId','collectMessageNodes'
];
function makeCollector(document, Node) {
  const ctx={document, Node, DOM_SELECTORS:{
    searchUnit:'[data-chatgpt-search-unit-key]', searchMessageIds:'[data-chatgpt-search-message-ids]'
  }, UUID_ANYWHERE_RE:/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
     UUID_ONLY_RE:/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
     perfStart:()=>null, perfEnd:()=>{}};
  vm.createContext(ctx);
  vm.runInContext(domNames.map(name=>sourceOf(collectorCodes.find(s=>
    new RegExp(`^  function ${name}\\(`,'m').test(s)),name)).join('\n')+'\nglobalThis.collect=collectMessageNodes;',ctx);
  return ctx.collect;
}
let lookups=0;
class FakeNode {
  constructor(attrs={}, {layout=true,tag='div'}={}) {
    this.attrs=attrs;this.layout=layout;this.tag=tag;this.children=[];
    this.parent=null;this.isConnected=true;
  }
  add(node){ node.parent=this;this.children.push(node);return node; }
  hasAttribute(name){ return Object.hasOwn(this.attrs,name); }
  getAttribute(name){ return this.attrs[name]??null; }
  matches(sel) {
    if (sel==='main') return this.tag==='main';
    if (sel==='[data-chatgpt-search-unit-key]') return this.hasAttribute('data-chatgpt-search-unit-key');
    if (sel==='[data-chatgpt-search-message-ids]') return this.hasAttribute('data-chatgpt-search-message-ids');
    if (sel==='[data-message-author-role]') return this.hasAttribute('data-message-author-role');
    if (sel==='[data-message-role]') return this.hasAttribute('data-message-role');
    return false;
  }
  closest(sel){lookups++;if (sel==='[hidden], [inert], [aria-hidden="true"]')return null;
    for(let n=this;n;n=n.parent) if(n.matches(sel))return n;return null;}
  querySelectorAll(sel){
    const found=[];
    const selectors=sel.split(',').map(x=>x.trim());
    function visit(node){ for(const child of node.children){ if(selectors.some(p=> {
      if(p==='[data-chatgpt-search-message-ids]')return child.hasAttribute('data-chatgpt-search-message-ids');
      return p.includes('[data-message-id]')&&child.hasAttribute('data-message-id')&&
        (p.includes('data-message-author-role') ? child.hasAttribute('data-message-author-role') : child.hasAttribute('data-message-role'));
    })) found.push(child);visit(child); }}
    visit(this);return found;
  }
  getBoundingClientRect(){return {width:this.layout?300:0,height:this.layout?80:0};}
  contains(other){for(let n=other;n;n=n.parent)if(n===this)return true;return false;}
  compareDocumentPosition(b){return this.order<b.order?4:2;}
}
function fixture({n=20, fallback=false, duplicate=false, invalid=false, ghost=false}={}) {
  lookups=0;
  const main=new FakeNode({}, {tag:'main'});
  for(let i=0;i<n;i++){
    const uuid=`${(i+1).toString(16).padStart(8,'0')}-${UUID.slice(9)}`;
    const id=duplicate&&i===n-1?`${1 .toString(16).padStart(8,'0')}-${UUID.slice(9)}`:uuid;
    const role=i%2?'assistant':'user';
    const attrs=fallback? {'data-message-id':id,'data-message-author-role':role} :
      {'data-chatgpt-search-unit-key':`thread:${invalid&&i===n-1?'debug':role}`,
       'data-chatgpt-search-message-ids':id};
    main.add(new FakeNode(attrs,{layout:!(ghost&&i===n-2)}));
  }
  let order=0;function assign(root){root.order=order++;for(let item of root.children)assign(item);}assign(main);
  const document={querySelectorAll(selector){
    if(selector.startsWith('main [data-chatgpt-search-unit-key]'))
      return main.children.filter(n=>n.hasAttribute('data-chatgpt-search-unit-key'));
    return main.children.filter(n=>n.hasAttribute('data-message-id'));
  }};
  return {document};
}
function fingerprint(result) {
  return JSON.stringify({ name:result.name,rawCount:result.rawCount,
    noLayout:result.noLayout,collapsed:result.collapsed,
    ids:result.nodes.map(el=>result.identities.get(el)),ambiguous:[...result.ambiguousIds].sort()});
}

function fingerprint(result) {
  return {
    name: result.name, rawCount: result.rawCount, noLayout: result.noLayout,
    collapsed: result.collapsed, identities: result.nodes.map(el => result.identities.get(el)),
    ambiguous: [...result.ambiguousIds].sort()
  };
}
const N = {DOCUMENT_POSITION_FOLLOWING:4,DOCUMENT_POSITION_PRECEDING:2};
test('Collector returns role-qualified unique IDs with stable order',()=>{
  const {document}=fixture({n:20});
  const result=fingerprint(makeCollector(document,N)());
  assert.equal(result.name,'search-units');
  assert.equal(result.rawCount,20);
  assert.equal(result.noLayout,0);
  assert.equal(result.collapsed,0);
  assert.equal(result.identities.length,20);
  assert.equal(result.ambiguous.length,0);
  for(let i=0;i<20;i++) {
    assert.equal(result.identities[i].role,i%2?'assistant':'user');
    assert.equal(result.identities[i].id,`msg:${(i+1).toString(16).padStart(8,'0')}-${UUID.slice(9)}`);
  }
});
test('Collector refuses invalid roles, hides zero-layout units and rejects duplicate UUIDs',()=>{
  const invalid=fingerprint(makeCollector(fixture({n:3,invalid:true}).document,N)());
  assert.equal(invalid.rawCount,2);
  assert.equal(invalid.identities.length,2);
  const ghost=fingerprint(makeCollector(fixture({n:8,ghost:true}).document,N)());
  assert.equal(ghost.noLayout,1);
  assert.equal(ghost.rawCount,7);
  assert.equal(ghost.identities.length,7);
  const duplicate=fingerprint(makeCollector(fixture({n:8,duplicate:true}).document,N)());
  assert.equal(duplicate.rawCount,8);
  assert.equal(duplicate.collapsed,1);
  assert.equal(duplicate.identities.length,7);
  assert.equal(duplicate.ambiguous.length,1);
});
test('Collector uses explicit role + real message ID only as fallback',()=>{
  const {document}=fixture({n:12,fallback:true});
  const result=fingerprint(makeCollector(document,N)());
  assert.equal(result.name,'message-id');
  assert.equal(result.rawCount,12);
  assert.equal(result.identities.length,12);
  assert.equal(result.identities[0].role,'user');
  assert.equal(result.identities[1].role,'assistant');
  assert.equal(result.ambiguous.length,0);
});
test('Collector avoids redundant closest lookups for 1,000 search units',()=>{
  const {document}=fixture({n:1000});
  const output=makeCollector(document,N)();
  assert.equal(output.nodes.length,1000);
  // No per-unit climb for "main" or repeated UUID identity lookups.
  assert.ok(lookups <= 3000,`Unexpected closest calls: ${lookups}`);
});
test('Visible-control detection accepts a visible control regardless of position',()=>{
  const code=sourceOf(composerCode,'anyVisibleControl');
  for(const found of [-1,0,9]) {
    const nodes=Array.from({length:10},(_,i)=>({visible:i===found}));
    const ctx={document:{querySelectorAll:()=>nodes},visibleControl:n=>n.visible};
    vm.createContext(ctx);
    vm.runInContext(code+'\nglobalThis.control=anyVisibleControl;',ctx);
    assert.equal(ctx.control('button'),found>=0);
  }
});
// Timings are informational Node/V8 figures, never browser latency or test thresholds.
const longText='Текст sample 2026: тест words __ + 🙂\n'.repeat(2500);
function avgTime(fn,input,n=15){for(let i=0;i<3;i++)fn(input);let start=performance.now();for(let i=0;i<n;i++)fn(input);return (performance.now()-start)/n;}
console.log(`BENCH estimator ~100k chars: ${avgTime(estimate,longText).toFixed(2)} ms per call (informational)`);
console.log(`\n${passed} estimator/collector behavior checks passed.`);
