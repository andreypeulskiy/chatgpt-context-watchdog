'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const src=path.join(root,'src');
const paths=[];
function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
 const target=path.join(dir,entry.name);
 if(entry.isDirectory())visit(target);
 else if(entry.name.endsWith('.js'))paths.push(target);
}}
visit(src);
for(const file of paths){
 const text=fs.readFileSync(file,'utf8');
 assert.ok(text.endsWith('\n'),`${file}: final newline required`);
 assert.ok(!text.includes('\r'),`${file}: CRLF not permitted`);
 assert.doesNotMatch(text,/\n(?:[ \t]*\n){3,}/,`${file}: excess blank lines`);
}
const css=fs.readFileSync(path.join(src,'ui/13-panel-styles.js'),'utf8');
const others=paths.filter(f=>!f.endsWith('13-panel-styles.js')).map(f=>fs.readFileSync(f,'utf8')).join('\n');
const devCss=fs.readFileSync(path.join(src,'ui/dev-responsive.css'),'utf8');
const allCss=css+'\n'+devCss;
const classNames=[...new Set([...allCss.matchAll(/\.(cw[-_][A-Za-z0-9_-]+)/g)].map(m=>m[1]))];
const customProperties=[...new Set([...allCss.matchAll(/--cw[-_A-Za-z0-9]+/g)].map(m=>m[0]))];
const cssKebab=/^(?:cw-|--cw-)[a-z0-9]+(?:-[a-z0-9]+)*$/;
assert.deepEqual(classNames.filter(name=>!cssKebab.test(name)),[],
  'Watchdog CSS classes must use cw- + kebab-case');
assert.deepEqual(customProperties.filter(name=>!cssKebab.test(name)),[],
  'Watchdog CSS properties must use --cw- + kebab-case');
// Match complete class tokens: .cw-foo must not pass because .cw-foo-bar exists.
// Sources include lazy HTML templates and DOM-generated classList calls.
assert.deepEqual(classNames.filter(name=>!new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(others)),[],'Unused panel CSS classes');
console.log(`PASS source whitespace policy (${paths.length} ES modules), CSS class references (${classNames.length}), CSS properties (${customProperties.length}), kebab-case policy`);
