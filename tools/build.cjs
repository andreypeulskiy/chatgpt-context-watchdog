'use strict';
// Build a single, self-contained userscript from actual ES modules.
// esbuild is the canonical release compiler. The checked-in offline fallback
// uses TypeScript's CommonJS emitter plus a tiny private module registry; it
// exists for restricted environments without npm registry access.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {inspectCacheOnlyCalls}=require('./cache-only-policy.cjs');
const root=path.resolve(__dirname,'..');
const sourceDir=path.join(root,'src');
const isDev=process.argv.includes('--dev');
const minified=process.argv.includes('--minify');
const headerBase=fs.readFileSync(path.join(sourceDir,'userscript-header.txt'),'utf8');
// Distinct identity prevents Dev from accidentally replacing a Stable Tampermonkey install.
// Do not enable both variants on the same page: their runtime/UI IDs intentionally match.
const header=isDev
 ? headerBase.replace('// @name         ChatGPT Context Watchdog (Local)',
     '// @name         ChatGPT Context Watchdog (Local Dev)')
     .replace('// @namespace    local.chatgpt.context.watchdog',
     '// @namespace    local.chatgpt.context.watchdog.dev')
 : headerBase;
const devCssPath=path.join(sourceDir,'ui/dev-responsive.css');
const panelStylesPath=path.join(sourceDir,'ui/13-panel-styles.js');
const devCss=isDev?fs.readFileSync(devCssPath,'utf8'):'';
function cssSource(file,source){
 if(!isDev || file!==panelStylesPath)return source;
 // The fragment is included in the source CSS template, not loaded at runtime.
 if(/[`\\]/.test(devCss) || devCss.includes('${'))
   throw Error('Dev CSS contains invalid template-literal characters');
 const close='    `;\n\nexport { UI_CSS };';
 if(source.split(close).length!==2)throw Error('Cannot find unique UI_CSS template end');
 return source.replace(close,devCss+'\n'+close);
}
const version=header.match(/^\/\/ @version\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/m)?.[1];
if(!version || !header.startsWith('// ==UserScript==\n') || !header.includes('// ==/UserScript=='))throw Error('Invalid metadata envelope');
const sourceFiles=[];
function walk(dir){ for(const ent of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const fp=path.join(dir,ent.name);if(ent.isDirectory()) walk(fp); else if(ent.isFile()&&ent.name.endsWith('.js'))sourceFiles.push(fp);}}
walk(sourceDir);
const out=path.join(root,'dist',`chatgpt-context-watchdog-${version}${isDev?'.dev':''}${minified?'.min':''}.user.js`);
fs.mkdirSync(path.dirname(out),{recursive:true});
let ts;try{ts=require('typescript');}catch{try{ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');}catch{}}
const esbuild=(()=>{try{return require('esbuild');}catch{return null;}})();
function embeddedOfflineBundle(){
 if(!ts)throw Error('Install devDependencies (typescript and esbuild) to build');
 const all=new Map();
 for(const file of sourceFiles){
  const id=path.relative(root,file).replaceAll(path.sep,'/');
  const js=cssSource(file,fs.readFileSync(file,'utf8'));
  const sf=ts.createSourceFile(file,js,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
  if(sf.parseDiagnostics.length) throw Error(`${id}: ${sf.parseDiagnostics[0].messageText}`);
  const imports=[];
  for(const statement of sf.statements)if(ts.isImportDeclaration(statement)&&ts.isStringLiteral(statement.moduleSpecifier))imports.push(statement.moduleSpecifier.text);
  const emitted=ts.transpileModule(js,{fileName:id,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,removeComments:false,sourceMap:false}});
  if(emitted.diagnostics?.length) throw Error(`${id}: ${emitted.diagnostics[0].messageText}`);
  let body=emitted.outputText;
  // Every import must resolve to a local module, never to runtime dependencies.
  body=body.replace(/require\("([^"\n]+)"\)/g,(_,spec)=>{
   const target=path.posix.normalize(path.posix.join(path.posix.dirname(id),spec));
   if(!sourceFiles.some(file=>path.relative(root,file).replaceAll(path.sep,'/')===target)) throw Error(`Missing module ${id}: ${spec}`);
   return `require(${JSON.stringify(target)})`;
  });
  all.set(id,body);
 }
 const chunks=[`(() => {\n  'use strict';\n  // Modules have private lexical scopes and live exports, not shared globals.\n  const factories = Object.create(null);\n  const cache = Object.create(null);\n  function loadModule(id) {\n    if (cache[id]) return cache[id].exports;\n    if (!Object.hasOwn(factories, id)) throw new Error('Unknown local module: ' + id);\n    const module = {exports: {}}; cache[id] = module;\n    factories[id](loadModule, module, module.exports);\n    return module.exports;\n  }\n`];
 for(const [id,body]of all){ chunks.push(`  factories[${JSON.stringify(id)}] = function (require, module, exports) {\n${body}\n  };\n`); }
 chunks.push(`  loadModule('src/main.js');\n})();\n`);
 return chunks.join('');
}
async function main(){
 let output,method;
 if(esbuild && !process.argv.includes('--offline')){
  const plugins=isDev?[{name:'watchdog-dev-css',setup(build){
    build.onLoad({filter:/13-panel-styles\.js$/},({path:file})=>({
      contents:cssSource(file,fs.readFileSync(file,'utf8')),loader:'js'
    }));
   }}]:[];
  const built=await esbuild.build({entryPoints:[path.join(sourceDir,'main.js')],bundle:true,write:false,platform:'browser',format:'iife',target:'es2022',minify:minified,legalComments:'inline',logLevel:'silent',plugins});
  output= built.outputFiles[0].text; method='esbuild';
 } else {
  if(minified)throw Error('--minify requires canonical esbuild; the offline fallback does not support minification');
  output=embeddedOfflineBundle();method='TypeScript CJS module-loader (offline fallback)';
 }
 const full=header+output.replaceAll('__WATCHDOG_VERSION__',version)
    .replaceAll('__WATCHDOG_DEV_BUILD__',String(isDev));
 new vm.Script(full,{filename:path.basename(out)});
 if((full.match(/^\/\/ ==UserScript==$/gm)||[]).length!==1 || /\b(?:XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(full))throw Error('Userscript invariant failed');
 const iconSource=fs.readFileSync(path.join(sourceDir,'ui/12-panel-site-icon.js'),'utf8');
 const sourceCacheReview=inspectCacheOnlyCalls(iconSource,'src/ui/12-panel-site-icon.js');
 if(sourceCacheReview.count!==1 || sourceCacheReview.problems.length)
  throw Error('Cache-only logo source policy failed: '+sourceCacheReview.problems.join('; '));
 const cacheReview=inspectCacheOnlyCalls(full,'bundle',{checkNamedUrlGuard:!minified});
 if(cacheReview.count!==1 || cacheReview.problems.length)throw Error('Cache-only logo policy failed: '+cacheReview.problems.join('; '));
 fs.writeFileSync(out,full);
 console.log(`Built ${path.relative(root,out)} [${isDev?'Dev':'Stable'}] (${Buffer.byteLength(full)} bytes, ${sourceFiles.length} ES modules, ${method})`);
 console.log('SHA256',crypto.createHash('sha256').update(full).digest('hex'));
}
main().catch(err=>{console.error(err);process.exitCode=1});
