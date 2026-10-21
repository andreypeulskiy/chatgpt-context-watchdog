'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
let ts;try{ts=require('typescript');}catch{ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');}
const root=path.join(__dirname,'../src');const sources=[];
function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
 const p=path.join(dir,e.name);if(e.isDirectory())visit(p);else if(e.name.endsWith('.js'))sources.push(p);
}}
visit(root);
const exportsMap=new Map();const imported=[];
for(const file of sources){
 const text=fs.readFileSync(file,'utf8');
 const ast=ts.createSourceFile(file,text,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
 assert.equal(ast.parseDiagnostics.length,0,`Invalid ESM syntax: ${file}`);
 const exported=new Set();
 for(const stmt of ast.statements){
  if(ts.isExportDeclaration(stmt)&&stmt.exportClause&&ts.isNamedExports(stmt.exportClause))for(const el of stmt.exportClause.elements)exported.add(el.name.text);
  if(ts.isImportDeclaration(stmt)){
   const spec=stmt.moduleSpecifier.text;
   assert.ok(spec.startsWith('.'),`${file}: only local imports allowed`);
   const dep=path.resolve(path.dirname(file),spec);
   assert.ok(fs.existsSync(dep),`${file}: unknown import ${spec}`);
   const named=stmt.importClause?.namedBindings;
   if(file===path.join(root,'main.js') && !named)continue;
   assert.ok(named&&ts.isNamedImports(named),`${file}: explicit named imports required`);
   for(const e of named.elements)imported.push({file,dep,name:e.propertyName?.text||e.name.text});
  }
 }
 exportsMap.set(file,exported);
}
for(const {file,dep,name} of imported)assert.ok(exportsMap.get(dep)?.has(name),
  `${path.relative(root,file)}: ${name} is not exported by ${path.relative(root,dep)}`);
for(const source of ['core/context-estimate.js','core/11-message-completion-context.js']){
 const text=fs.readFileSync(path.join(root,source),'utf8');
 assert.doesNotMatch(text,/^import\s/m,`${source}: must remain independent`);
 assert.doesNotMatch(text,/\b(?:document|window|localStorage|MutationObserver)\b/,`${source}: no browser coupling`);
}
assert.ok(!fs.existsSync(path.join(root,'manifest.json')),'Production must not depend on concatenation manifest');
console.log(`PASS ${sources.length} ESM source modules and ${imported.length} explicit named import contracts`);
