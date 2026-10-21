'use strict';
// Current-source readers for isolated-function VM fixtures.
// Integrated tests instead execute the native ESM graph in isolated-esm.cjs.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const map=new Map();
function visit(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){
 const p=path.join(dir,item.name);
 if(item.isDirectory())visit(p);
 else if(item.isFile()&&p.endsWith('.js')){
  if(map.has(item.name))throw new Error('Duplicate source basename '+item.name);
  map.set(item.name,p);
 }
}}
visit(path.join(root,'src'));
function pathFor(name){const actual=name.endsWith('.js')?name:name+'.js';const resolved=map.get(path.basename(actual));if(!resolved)throw Error('Unknown current module: '+name);return resolved;}
function rawSource(name){if(name==='00-userscript-header.js') return fs.readFileSync(path.join(root,'src/userscript-header.txt'),'utf8');return fs.readFileSync(pathFor(name),'utf8');}
function source(name){ return require('./isolated-vm-fragment.cjs').isolatedVmFragment(rawSource(name)); }

module.exports={root,source,rawSource,pathFor,files:[...map.keys()]};
