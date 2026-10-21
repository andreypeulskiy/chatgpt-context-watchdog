'use strict';
// Narrow review of the ONE cache-only icon read. This does not permit any other
// fetch or network API, and is run against both source and built userscripts.
let ts;
try { ts=require('typescript'); }
catch { ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); }

const expected = {
  mode:'same-origin', cache:'only-if-cached',
  credentials:'same-origin', redirect:'error'
};
function inspectCacheOnlyCalls(source, file = '<text>', {checkNamedUrlGuard = true} = {}) {
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
  const problems=[];
  const approved=new Set();
  let count=0;
  function visit(node) {
    if (ts.isIdentifier(node) && node.text==='fetch') {
      count++;
      const accessor=node.parent;
      const call=accessor?.parent;
      const options=call?.arguments?.[1];
      const direct=ts.isPropertyAccessExpression(accessor) && accessor.name===node &&
        ts.isIdentifier(accessor.expression) && accessor.expression.text==='window' &&
        ts.isCallExpression(call) && call.expression===accessor && call.arguments.length===2;
      const entries={};
      if (direct && ts.isObjectLiteralExpression(options)) {
        for (const prop of options.properties) {
          if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name) ||
              !ts.isStringLiteral(prop.initializer) || prop.name.text in entries) {
            problems.push(`${file}: unreviewed cache-only fetch options`); break;
          }
          entries[prop.name.text]=prop.initializer.text;
        }
      }
      if (!direct || !ts.isObjectLiteralExpression(options) ||
          JSON.stringify(Object.entries(entries).sort()) !== JSON.stringify(Object.entries(expected).sort())) {
        problems.push(`${file}: forbidden fetch invocation (cache-only favicon flag required)`);
      } else approved.add(node.getStart(ast));
    }
    ts.forEachChild(node,visit);
  }
  visit(ast);
  if (count>1) problems.push(`${file}: multiple fetch references (${count})`);
  if (count===1 && !source.includes("navigator.serviceWorker?.controller"))
    problems.push(`${file}: missing Service Worker guard`);
  // esbuild may rename local helpers in a minified bundle. The source guard
  // is checked before compilation; callers may skip only this name-based
  // bundle assertion while keeping the AST fetch/options and SW checks.
  if (checkNamedUrlGuard && count===1 && !source.includes('cachedFaviconUrl('))
    problems.push(`${file}: missing same-origin favicon URL guard`);
  return {count,problems:[...new Set(problems)],approved};
}
module.exports={inspectCacheOnlyCalls};
