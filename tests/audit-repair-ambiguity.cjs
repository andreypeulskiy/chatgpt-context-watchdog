'use strict';
// Native ESM behavior: two Audits authorize Repair, but the final DOM snapshot
// must still have an unambiguous UUID. Only DOM/storage boundaries are synthetic.
const assert = require('node:assert/strict');

async function run() {
  const chatUuid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const firstUuid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const secondUuid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const chatKey = 'chat:' + chatUuid;
  const firstId = 'msg:' + firstUuid;
  const secondId = 'msg:' + secondUuid;
  const bytes = new Map();
  const main = {};
  const send = {hidden:false, getAttribute:()=>null, getClientRects:()=>[{}]};
  let visible = [];
  globalThis.localStorage = {
    getItem:key=>bytes.get(key)??null,
    setItem:(key,value)=>bytes.set(key,String(value)),
    removeItem:key=>bytes.delete(key)
  };
  globalThis.location = {pathname:'/c/' + chatUuid};
  globalThis.Node = {DOCUMENT_POSITION_FOLLOWING:4,DOCUMENT_POSITION_PRECEDING:2};
  globalThis.document = {
    hidden:false,
    querySelectorAll(selector) {
      if (selector === 'main [data-chatgpt-search-unit-key]') return visible;
      if (selector.includes('button[data-testid="send-button"]')) return [send];
      return [];
    },
    querySelector:()=>null
  };
  const {DEFAULTS} = await import('../src/runtime/01-runtime-configuration.js');
  const {initializeCaptureState} = await import('../src/runtime/01-runtime-capture-state.js');
  const {loadState} = await import('../src/storage/03-ledger-repository.js');
  const {saveState} = await import('../src/storage/03-ledger-commit.js');
  const {stateKey} = await import('../src/storage/03-ledger-foundation.js');
  const {collectMessageNodes} = await import('../src/chatgpt/09-dom-collection.js');
  const {getCanonicalMessageMetrics} = await import('../src/chatgpt/04-text-estimators.js');
  const {auditVisibleMessages, prepareShortRecordRepair, applyConfirmedShortRecordRepair,
    clearAuditConfirmation} = await import('../src/app/10-audit-repair.js');

  function unit(uuid, text, order) {
    const root = {
      hidden:false, closest:()=>null,
      contains(other) {return other === this;},
      cloneNode() {
        return {hidden:false,textContent:text,querySelectorAll:()=>[],getAttribute:()=>null};
      }
    };
    return {
      order,isConnected:true,hidden:false,
      getAttribute(name) {
        return name === 'data-chatgpt-search-unit-key' ? 'unit:assistant' :
          name === 'data-chatgpt-search-message-ids' ? uuid : null;
      },
      hasAttribute(name) {return this.getAttribute(name) !== null;},
      closest(selector) {
        return selector === '[data-chatgpt-search-unit-key]' ? this :
          selector === 'main' ? main : null;
      },
      matches:()=>false,querySelector:()=>null,
      querySelectorAll(selector) {return selector === '[class*="MarkdownRoot-"]' ? [root] : [];},
      getBoundingClientRect:()=>({width:700,height:120}),
      contains(other) {return other === this;},
      compareDocumentPosition(other) {return this.order < other.order ? 4 : 2;}
    };
  }

  const initial = {role:'assistant',chars:20,tokens:5,fingerprint:'v3:old'};
  function prepare(ids) {
    bytes.clear();
    initializeCaptureState({...DEFAULTS},chatKey);
    clearAuditConfirmation();
    const state = loadState();
    visible = ids.map((uuid,index)=>{
      state.messages['msg:' + uuid] = {...initial};
      return unit(uuid,'This is a completed long answer for the repair fixture. '.repeat(6),index);
    });
    assert.equal(saveState(state),true);
    assert.equal(auditVisibleMessages().eligibleRepairs.length,0);
    assert.equal(auditVisibleMessages().eligibleRepairs.length,ids.length);
    const prepared = prepareShortRecordRepair();
    assert.equal(prepared.status,'ready');
    return prepared;
  }

  {
    const prepared = prepare([firstUuid]);
    const expected = getCanonicalMessageMetrics(visible[0],'assistant');
    assert.equal(applyConfirmedShortRecordRepair(prepared).status,'repaired');
    const saved = loadState();
    assert.equal(saved.messages[firstId].chars,expected.chars);
    assert.equal(saved.messages[firstId].tokens,expected.tokens);
    assert.equal(saved.messages[firstId].fingerprint,expected.fingerprint);
    assert.equal(saved.repairHistory.length,1);
    assert.deepEqual(saved.repairHistory[0].before,initial);
    console.log('PASS unchanged, unambiguous candidate is repaired and retains Undo history');
  }
  {
    const prepared = prepare([firstUuid]);
    const before = bytes.get(stateKey(chatKey));
    visible.push(unit(firstUuid,'Conflicting disjoint copy with the same UUID. '.repeat(7),1));
    const fresh = collectMessageNodes();
    assert.equal(fresh.rawCount,2);
    assert.equal(fresh.nodes.length,1);
    assert.equal(fresh.ambiguousIds.has(firstId),true);
    assert.equal(applyConfirmedShortRecordRepair(prepared).status,'changed');
    assert.equal(bytes.get(stateKey(chatKey)),before,'Ambiguous Repair must perform no ledger write');
    assert.equal(loadState().repairHistory.length,0);
    console.log('PASS ambiguity introduced after two Audits prevents Repair and any history write');
  }
  {
    const prepared = prepare([firstUuid,secondUuid]);
    visible.push(unit(firstUuid,'Conflicting disjoint copy with the same UUID. '.repeat(7),2));
    const result = applyConfirmedShortRecordRepair(prepared);
    assert.equal(result.status,'repaired');
    assert.equal(result.count,1);
    const saved = loadState();
    assert.deepEqual(saved.messages[firstId],initial);
    assert.ok(saved.messages[secondId].chars > initial.chars);
    assert.deepEqual(saved.repairHistory.map(item=>item.id),[secondId]);
    console.log('PASS mixed candidates preserve the ambiguous record and repair only the trusted UUID');
  }
}

run().catch(error=>{console.error(error);process.exitCode=1;});
