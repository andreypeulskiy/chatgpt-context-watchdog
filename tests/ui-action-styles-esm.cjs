'use strict';
// Action appearance must not depend on tooltip registration.
const assert=require('node:assert/strict');
const {isolatedModules,silentPanelRendering}=require('./support/isolated-esm.cjs');
(async()=>{
 const realm=await isolatedModules({document:{querySelectorAll:()=>[]}},
   {'ui/16-panel-rendering.js':silentPanelRendering()});
 const {registerUiHints,registerActionStyles,prepareUiControls}=realm.module('ui/14-panel-components.js');
 function button(...names){
   const set=new Set(names);
   set.contains=x=>set.has(x);
   set.toggle=(name,flag)=>{if(flag)set.add(name);else set.delete(name);return flag;};
   return {tagName:'BUTTON',classList:set,dataset:{},
     getAttribute:()=>null,removeAttribute:()=>{}};
 }
 const danger=button('cw-reset-chat');
 const normal=button('cw-save-attachments');
 const undecorated=button('cw-close-settings');
 const scope={querySelectorAll(selector){return selector==='button'? [danger,normal,undecorated] : [danger,normal,undecorated];}};
 registerUiHints(scope);
 assert.equal(danger.dataset.cwTip?.includes('Reset'),true);
 assert.equal(normal.dataset.cwTip?.includes('Save'),true);
 assert.equal(danger.classList.has('cw-danger-action'),false,'tooltips never style buttons');
 assert.equal(normal.classList.has('cw-text-action'),false,'tooltips never style buttons');
 registerActionStyles(scope);
 assert.equal(danger.classList.has('cw-danger-action'),true);
 assert.equal(normal.classList.has('cw-text-action'),true);
 assert.equal(undecorated.classList.has('cw-text-action'),false);
 assert.equal(undecorated.classList.has('cw-danger-action'),false);
 prepareUiControls(scope);
 prepareUiControls(scope);
 assert.equal(danger.dataset.cwTip.includes('Reset'),true);
 assert.equal(danger.classList.has('cw-text-action'),false,'danger has precedence');
 assert.equal(normal.classList.has('cw-text-action'),true);
 // Even when a control has no hint, the style classification remains independent.
 delete normal.dataset.cwTip;
 registerActionStyles(scope);
 assert.equal(normal.classList.has('cw-text-action'),true);
 console.log('PASS action styles separate from tooltips; stable repeated preparation');
})().catch(e=>{console.error(e);process.exitCode=1});
