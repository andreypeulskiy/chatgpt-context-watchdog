'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {isolatedModules,silentPanelRendering}=require('./support/isolated-esm.cjs');
const { auditLedger } = require('../tools/lib/ledger-audit.cjs');
(async()=>{
const realm=await isolatedModules({localStorage:{getItem:()=>null,setItem:()=>{}},
  location:{pathname:'/c/abc'}},{'ui/16-panel-rendering.js':silentPanelRendering()});
realm.module('runtime/01-runtime-capture-state.js').setSettings({averageImageTokens:2000});
const {effectiveImageStats}=realm.module('chatgpt/09-dom-image-accounting.js');
const {compareStoredMessageMetrics}=realm.module('app/10-audit-repair.js');

const uuid = s => `${s.repeat(8)}-${s.repeat(4)}-${s.repeat(4)}-${s.repeat(4)}-${s.repeat(12)}`;
const msg = s => `msg:${uuid(s)}`;
const chat = `chat:${uuid('a')}`;
const make = () => ({ chatKey: chat, attachmentLedgerVersion: 2, messages: {}, files: {}, domImages: {}, repairHistory: [], updatedAt: 10 });
const image = m => ({ messageId: m, width: 476, height: 52, tokens: 2000 });
const goodMessage = (role='user') => ({ role, tokens: 120, chars: 350, fingerprint: 'v3:hash' });
let passes=0;
const test = (name,fn) => { fn();passes++;console.log('PASS',name); };
const has = (report, code) => report.findings.some(item=>item.code===code);

test('Empty ledger is healthy and follows v2', () => {
  const report=auditLedger(make());
  assert.equal(report.findingCounts.critical,0);
  assert.equal(report.summary.effectiveImages,0);
  assert.equal(report.readOnly,true);
});
test('Never mutates input snapshot', () => {
  const state=make();state.messages[msg('1')] = goodMessage();state.domImages['dom-user-image-slot:stable'] = image(msg('1'));
  const before=JSON.stringify(state);
  auditLedger(state);
  assert.equal(JSON.stringify(state), before);
});
test('Unsupported image keys are diagnosed, not counted, and never rewritten', () => {
  const state=make();
  for(let i=0;i<9;i++) state.domImages[`unknown-format:${i}`] = image(msg('1'));
  const before=JSON.stringify(state);
  let report=auditLedger(state);
  assert.equal(report.summary.effectiveImages,0);
  assert.equal(report.summary.unsupportedImageKeys,9);
  assert.ok(has(report,'UNSUPPORTED_IMAGE_KEY'));
  state.domImages['dom-user-image-slot:slot-1'] = image(msg('1'));
  report=auditLedger(state);
  assert.equal(report.summary.effectiveImages,1);
  assert.equal(report.summary.stableImageSlots,1);
  assert.equal(report.summary.domImageRecords,10);
  assert.equal(JSON.stringify({...state,domImages:Object.fromEntries(Object.entries(state.domImages).slice(0,9))}),before);
});
test('Fingerprint comparison uses current strings and avoids false mismatches on missing hashes', () => {
 const observed={chars:150,tokens:75,fingerprint:'v3:new'};
 const same=compareStoredMessageMetrics({chars:150,tokens:75,fingerprint:'v3:new'},observed);
 assert.equal(same.fingerprintStatus,'same');
 assert.equal(same.different,false);
 const changed=compareStoredMessageMetrics({chars:150,tokens:75,fingerprint:'v3:other'},observed);
 assert.equal(changed.fingerprintStatus,'changed');
 assert.equal(changed.hashChanged,true);
 const absent=compareStoredMessageMetrics({chars:150,tokens:75},observed);
 assert.equal(absent.fingerprintStatus,'unavailable');
 assert.equal(absent.hashChanged,false);
 assert.equal(absent.different,false);
 const missingWithDifferentTokens=compareStoredMessageMetrics({chars:150,tokens:25},observed);
 assert.equal(missingWithDifferentTokens.tokensChanged,true);
 assert.equal(missingWithDifferentTokens.different,true);
});
test('Two distinct images in same message stay distinct',()=>{
 const state=make();state.domImages['dom-user-image-slot:one']={...image(msg('1'))};state.domImages['dom-user-image-slot:two']={...image(msg('1'))};
 assert.equal(auditLedger(state).summary.effectiveImages,2);
});
test('Captured image and DOM slot in same message count once',()=>{
 const state=make();state.files.f1={method:'image-average',messageId:msg('1'),size:6857};
 state.domImages['dom-user-image-slot:one']=image(msg('1'));
 assert.equal(auditLedger(state).summary.effectiveImages,1);
});
test('Unbound image files are each counted (never merged by missing UUID)',()=>{
 const state=make();state.files.a={method:'image-average'};state.files.b={method:'image-average'};
 assert.equal(auditLedger(state).summary.effectiveImages,2);
});
test('Reports invalid UUID and invalid negative/NaN-like numeric values',()=>{
 const state=make();state.messages['temp-id']={role:'user',tokens:-7,chars:'350',fingerprint:null};
 const report=auditLedger(state);
 for(const code of ['NON_UUID_MESSAGE_ID','INVALID_MESSAGE_TOKENS','INVALID_MESSAGE_CHARS','MISSING_FINGERPRINT']) {
  assert.ok(has(report,code),code);
 }
});
test('Flags conflicting chat key without repeating the private UUID',()=>{
 const state=make();const report=auditLedger(state,{expectedChatKey:`chat:${uuid('b')}`});
 assert.ok(has(report,'CHAT_KEY_MISMATCH'));
 assert.ok(!JSON.stringify(report).includes(uuid('a')));
 assert.ok(!JSON.stringify(report).includes(uuid('b')));
});
test('Checks stale reading files without modifying their status',()=>{
 const state=make();state.files.a={name:'work.csv',size:1000,status:'reading',lastSeenAt:1,tokens:0};
 const report=auditLedger(state,{now:20*60*1000});
 assert.ok(has(report,'STALE_READING_FILE'));
 assert.equal(state.files.a.status,'reading');
});
test('Reports duplicate file ID without treating same names as proof of duplicates',()=>{
 const state=make();state.files.a={name:'secret.txt',fileId:'f1',messageId:msg('1'),size:10};
 state.files.b={name:'secret.txt',fileId:'f1',messageId:msg('1'),size:10};
 const report=auditLedger(state);
 assert.ok(has(report,'DUPLICATE_FILE_ID'));
 assert.ok(has(report,'SAME_NAME_SIZE_FILES'));
 assert.ok(!JSON.stringify(report).includes('secret.txt'));
});
test('Incomplete/unknown size is counted without claiming corruption',()=>{
 const state=make();state.files.a={name:'old.zip',messageId:msg('1'),size:0,method:'metadata-size'};
 const report=auditLedger(state);
 assert.equal(report.summary.filesUnknownSize,1);
 assert.equal(report.findingCounts.critical,0);
 assert.ok(has(report,'FILE_MESSAGE_NOT_SAVED'));
});
test('Rejects bad top-level collections and reports attachment version ignored',()=>{
 const state=make();state.messages=[];state.files=[];state.attachmentLedgerVersion=1;
 const report=auditLedger(state);
 assert.ok(has(report,'INVALID_MESSAGES'));
 assert.ok(has(report,'INVALID_FILES'));
 assert.ok(has(report,'ATTACHMENT_VERSION'));
});
test('Malformed image messageId never crashes the audit',()=>{
 const state=make();state.domImages.a={messageId:123,width:-1,height:0};
 const report=auditLedger(state);
 assert.ok(has(report,'BAD_IMAGE_MESSAGE_ID'));
 assert.ok(has(report,'INVALID_IMAGE_WIDTH'));
});
test('Case-variant message IDs and repair snapshots are diagnosed safely',()=>{
 const state=make();
 state.messages[msg('a')] = goodMessage();
 state.messages[msg('a').toUpperCase().replace(/^MSG:/,'msg:')] = goodMessage('assistant');
 state.repairHistory = [{id:msg('a'), before: goodMessage(), after:goodMessage('assistant')}];
 const report=auditLedger(state);
 assert.ok(has(report,'CASE_VARIANT_MESSAGE_ID'));
 assert.ok(has(report,'UNDO_SNAPSHOT_NOT_CURRENT'));
});
test('Broken repair entries are noticed without modifying saved history',()=>{
 const state=make();state.repairHistory=[{before:{},after:{}}];
 const report=auditLedger(state);
 assert.ok(has(report,'INVALID_REPAIR_ENTRY'));
 assert.equal(state.repairHistory.length,1);
});
test('Extensive findings are bounded without dropping aggregate counts',()=>{
 const state=make();for(let i=0;i<30;i++) state.messages[`bad-${i}`]={role:'unknown',tokens:-1,chars:-1};
 const report=auditLedger(state,{maxFindings:4});
 assert.equal(report.findings.length,4);
 assert.ok(report.suppressedFindings>0);
 assert.equal(report.summary.textMessages,30);
});
test('Audit image count agrees with current native ESM estimator across mixed states',()=>{
 for(let n=0;n<50;n++){
  const state=make();
  // Deterministic mixtures: unsupported image keys, stable slots,
  // captured image files, unbound records and disjoint identities.
  for(let i=0;i<(n%9);i++) state.domImages[`unsupported-image:${i}`] = image(msg('1'));
  if(n%3===0) state.domImages['dom-user-image-slot:slot-A']=image(msg('1'));
  if(n%4===0) state.domImages['dom-user-image-slot:slot-B']=image(msg('2'));
  if(n%5===0) state.files.image1={method:'image-average',messageId:msg('1')};
  if(n%7===0) state.files.image2={method:'image-average',messageId:msg('3')};
  if(n%6===0) state.domImages['dom-user-image-slot:unbound']={width:20,height:15};
  const expected=effectiveImageStats(state).effective;
  assert.equal(auditLedger(state).summary.effectiveImages,expected,`case ${n}`);
 }
});
test('CLI reports read-only findings; refuses overwriting the snapshot',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cw-ledger-audit-'));
 try {
  const input=path.join(dir,'snapshot.json'), output=path.join(dir,'report.json');
  const state=make();state.messages[msg('1')]=goodMessage();
  const raw=JSON.stringify(state);
  fs.writeFileSync(input,raw);
  const cli=path.resolve(__dirname,'../tools/ledger-audit.cjs');
  const run=spawnSync(process.execPath,[cli,input,'--output',output],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(output,'utf8')).summary.textMessages,1);
  assert.equal(fs.readFileSync(input,'utf8'),raw);
  const reject=spawnSync(process.execPath,[cli,input,'--output',input],{encoding:'utf8'});
  assert.equal(reject.status,2);
 } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('CLI errors on malformed JSON; no report is created',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cw-ledger-audit-'));
 try {
  const input=path.join(dir,'invalid.json');fs.writeFileSync(input,'{');
  const cli=path.resolve(__dirname,'../tools/ledger-audit.cjs');
  const run=spawnSync(process.execPath,[cli,input],{encoding:'utf8'});
  assert.equal(run.status,2);
 } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
console.log(`\n${passes} current ledger audit checks passed`);
})().catch(err=>{console.error(err);process.exitCode=1;});
