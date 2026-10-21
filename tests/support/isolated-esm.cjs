'use strict';
// Execute unmodified production ES modules in a separate browser-like realm.
// Link *real import/export bindings*, including cycles; no concatenation or extraction.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../src');
async function isolatedModules(globals = {}, stubs = {}) {
  assert.equal(typeof vm.SourceTextModule, 'function',
    'Run native module tests with node --experimental-vm-modules');
  const context = vm.createContext({
    console, setTimeout, clearTimeout, queueMicrotask,
    URL, TextDecoder, TextEncoder, Blob, AbortController,
    ...globals
  });
  const cache = new Map();
  function from(id) {
    const full = path.resolve(root, id);
    assert.ok(full.startsWith(root + path.sep),`Outside src: ${id}`);
    assert.ok(fs.statSync(full).isFile(), `Missing module: ${id}`);
    if (!cache.has(full)) {
      if (Object.hasOwn(stubs,id)) {
        const bindings=stubs[id];
        cache.set(full,new vm.SyntheticModule(Object.keys(bindings),function() {
          for (const [key,value] of Object.entries(bindings)) this.setExport(key,value);
        },{context,identifier:full}));
      } else cache.set(full,new vm.SourceTextModule(fs.readFileSync(full,'utf8'),{
        context,identifier:full
      }));
    }
    return cache.get(full);
  }
  const entry=from('app/17-spa-observer-startup.js');
  await entry.link((specifier, referencingModule) => {
    assert.ok(specifier.startsWith('./') || specifier.startsWith('../'),
      `Unexpected external import: ${referencingModule.identifier}: ${specifier}`);
    return from(path.relative(root,path.resolve(path.dirname(referencingModule.identifier),specifier)));
  });
  // Import startup dependencies, but do not invoke the production start() function.
  await entry.evaluate();
  return {
    context,
    module: id => { const mod=from(id); assert.equal(mod.status,'evaluated',`Not evaluated: ${id}`); return mod.namespace; },
    fileCount:()=>cache.size
  };
}
module.exports = { isolatedModules };
// Tests mock only rendering boundaries; storage, identity and attachment imports remain native.
function silentPanelRendering() {
  const filename=path.join(root,'ui/16-panel-rendering.js');
  const contents=fs.readFileSync(filename,'utf8');
  const match=/^export \{ ([^}]+) \};/m.exec(contents);
  assert.ok(match,'Missing actual UI exports');
  return Object.fromEntries(match[1].split(',').map(name=>name.trim()).map(name=>[name,()=>{}]));
}
module.exports.silentPanelRendering=silentPanelRendering;
