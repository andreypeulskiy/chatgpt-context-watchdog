'use strict';
// Minimal always-available source gate: checks ESM identifiers even if optional
// ESLint is not installed. Ignore only JSDoc contract types defined in .d.ts;
// all runtime identifiers (including imports) must be declared.
const fs = require('node:fs');
const path = require('node:path');
let ts;
try { ts = require('typescript'); }
catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); }
const root = path.resolve(__dirname, '..');
const sourceFiles = [];
function visit(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.isFile() && file.endsWith('.js')) sourceFiles.push(file);
  }
}
visit(path.join(root,'src'));
const program = ts.createProgram(sourceFiles, {
  allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true,
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts','lib.dom.d.ts']
});
const jsdocTypes = new Set(['WatchdogLedgerV2','WatchdogCollectedMessages']);
const unsafeCodes = new Set([2304, 2552, 2632, 2580]);
const errors = ts.getPreEmitDiagnostics(program).filter(d => {
  if (!unsafeCodes.has(d.code)) return false;
  const msg = ts.flattenDiagnosticMessageText(d.messageText,' ');
  if (d.code === 2304 && [...jsdocTypes].some(name => msg === `Cannot find name '${name}'.`)) {
    // Legacy pseudo-types are allowed ONLY inside /** ... */ comments.
    const before = d.file?.text.slice(0,d.start || 0) || '';
    if (before.lastIndexOf('/**') > before.lastIndexOf('*/')) return false;
  }
  return true;
});
for (const d of errors) {
  const pos = d.file?.getLineAndCharacterOfPosition(d.start || 0);
  console.error(`${d.file?.fileName || '<unknown>'}:${(pos?.line || 0)+1}: TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText,' ')}`);
}
if (errors.length) process.exit(1);

// Reuse the TypeScript AST already built for source safety; no extra naming
// parser or dependency. Check local declarations, not serialized ledger fields,
// object properties, external DOM attributes or imported APIs.
const camelName = /^[a-z][A-Za-z0-9]*$/;
const pascalName = /^[A-Z][A-Za-z0-9]*$/;
const badNames = [];
let checkedNames = 0;
for (const file of sourceFiles) {
  const source = program.getSourceFile(file);
  if (!source) throw Error(`Missing parsed source: ${file}`);
  function checkName(name, valid, convention) {
    if (!name || !ts.isIdentifier(name)) return;
    checkedNames++;
    if (valid.test(name.text)) return;
    const {line, character} = source.getLineAndCharacterOfPosition(name.getStart(source));
    badNames.push(`${path.relative(root, file)}:${line + 1}:${character + 1}: ${name.text}: expected ${convention}`);
  }
  function visit(node) {
    if (ts.isVariableDeclaration(node)) {
      const isConst = ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Const) !== 0;
      checkName(node.name, isConst ? /^(?:[a-z][A-Za-z0-9]*|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)$/ : camelName,
        isConst ? 'camelCase or UPPER_SNAKE_CASE' : 'camelCase');
    } else if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
      checkName(node.name, camelName, 'camelCase function');
    } else if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      checkName(node.name, pascalName, 'PascalCase class');
    } else if (ts.isParameter(node)) {
      checkName(node.name, camelName, 'camelCase parameter');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (badNames.length) {
  for (const problem of badNames) console.error(problem);
  console.error(`FAIL naming policy: ${badNames.length} invalid declarations`);
  process.exit(1);
}
console.log(`PASS source identifiers and import assignments: ${sourceFiles.length} ES modules`);
console.log(`PASS naming policy: ${checkedNames} JS declarations (camelCase, PascalCase, UPPER_SNAKE_CASE)`);
