'use strict';
const ts=(()=>{try{return require('typescript');}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');}})();
const mutableSetters = new Set(['historySummaryCache','historyCache','calibrationHistoryCorrupt',
  'settings','storageWarningShown','transientState','deferredConversationFrame',
  'currentChatKey','lastUiSignals','lastCommit','failedScanDraft','hydrationCheckTimer',
  'inspectedFileTurns','lastBackfillDeferred','lastScanReason','revisionGeneration',
  'lastAudit','priorRepairCandidates','activePanelView','ui',
  'panelDialogBaseline','panelPinned','outsidePanelHandlerBound',
  'mutationCheckQueued','observer','booted'].map(name => 'set' + name[0].toUpperCase() + name.slice(1)));
// Isolated-function VM tests use a controlled source snippet and injected globals.
// Strip ESM imports/exports and rewrite test-owned state setter imports to writes
// into the injected fixture state. This does NOT construct a bundled test runtime.
// Full-system tests use the unmodified ESM graph in isolated-esm.cjs.
function isolatedVmFragment(raw){
 const ast=ts.createSourceFile('current-source.js',raw,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
 const setters=new Set();
 for(const node of ast.statements)if(ts.isImportDeclaration(node)){
  const imp=node.importClause?.namedBindings;
  if(imp&&ts.isNamedImports(imp)) for(const e of imp.elements){if(mutableSetters.has(e.name.text))setters.add(e.name.text);}
 }
 function render(node){
  if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))return '';
  if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&setters.has(node.expression.text)&&node.arguments.length===1){
   const name=node.expression.text.slice(3);const target=name[0].toLowerCase()+name.slice(1);
   return `(${target} = ${render(node.arguments[0])})`;
  }
  const start=ts.isSourceFile(node)?0:node.getStart(ast),end=node.end;
  let out='',cursor=start;
  ts.forEachChild(node,child=>{
   const from=child.getStart(ast),to=child.end;if(from<cursor||to>end)return;
   out+=raw.slice(cursor,from)+render(child);cursor=to;
  });
  return out+raw.slice(cursor,end);
 }
 return render(ast);
}
module.exports={isolatedVmFragment};
