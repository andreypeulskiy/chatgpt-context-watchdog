'use strict';
// intentionally small fail-closed review of accidental exfiltration sinks.
// TypeScript AST (already used by build/source checks) avoids regex false matches
// in prose/base64. This is not a formal proof of data-flow noninterference.
const fs = require('node:fs');
const path = require('node:path');
let ts;
try { ts = require('typescript'); }
catch { throw Error('Security Gate requires the declared TypeScript dev dependency'); }
const root = path.resolve(__dirname, '..');
const { version } = require('../tests/support/current.cjs');
const {inspectCacheOnlyCalls}=require('./cache-only-policy.cjs');

function literal(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return literal(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literal(node.left), right = literal(node.right);
    return left === null || right === null ? null : left + right;
  }
  return null;
}
function member(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return member(node.expression) + '.' + node.name.text;
  if (ts.isElementAccessExpression(node)) {
    const key = literal(node.argumentExpression);
    return member(node.expression) + (key === null ? '[?]' : '.' + key);
  }
  return '?';
}
const forbidden = new Set([
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon',
  'GM_xmlhttpRequest', 'GM_download', 'eval', 'Function', 'Worker',
  'SharedWorker', 'RTCPeerConnection'
]);
const navigation = new Set(['window.open', 'window.location.assign', 'window.location.replace',
  'location.assign', 'location.replace', 'navigator.sendBeacon',
  'navigator.serviceWorker.register']);
const remoteElements = new Set(['script', 'iframe', 'link', 'object', 'embed', 'form']);
const remoteProperties = new Set(['src', 'srcset', 'href', 'action', 'formAction']);
function inspectJavaScript(source, filename, checkDomSinks = true) {
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const problems = [];
  const isLogoSource = filename === 'src/ui/12-panel-site-icon.js';
  const isBundle = /^dist\/chatgpt-context-watchdog-.*\.user\.js$/.test(filename);
  const cacheReview = inspectCacheOnlyCalls(source, filename,
    {checkNamedUrlGuard: !filename.endsWith('.min.user.js')});
  if (isLogoSource || isBundle) problems.push(...cacheReview.problems);
  const approved = (isLogoSource || isBundle) && !cacheReview.problems.length
    ? cacheReview.approved : new Set();
  const issue = (node, message) => {
    const position = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
    problems.push(`${filename}:${position.line + 1}: ${message}`);
  };
  if (parsed.parseDiagnostics.length) issue(parsed, 'Invalid JavaScript');
  function visit(node) {
    // Prohibit references, not only direct calls: const sender = window.fetch
    // must not bypass the gate. Computed constant keys are resolved above.
    if (ts.isIdentifier(node) && forbidden.has(node.text) &&
        !(node.text === 'fetch' && approved.has(node.getStart(parsed)))) issue(node, `Forbidden API: ${node.text}`);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = member(node);
      if (forbidden.has(name.slice(name.lastIndexOf('.') + 1)) &&
          !(name === 'window.fetch' && approved.has(node.name?.getStart(parsed)))) issue(node, `Forbidden API: ${name}`);
      if (/^(window|globalThis|navigator)\.\[\?\]/.test(name)) issue(node, `Unreviewed dynamic global access: ${name}`);
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = member(node.expression);
      if (navigation.has(name)) issue(node, `Navigation/network sink: ${name}`);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        issue(node, 'Dynamic import is not allowed');
      if (checkDomSinks && name.endsWith('.createElement')) {
        const type = literal(node.arguments?.[0]);
        if (type === null || remoteElements.has(type.toLowerCase()))
          issue(node, 'Unreviewed DOM resource creation: ' + (type ?? 'dynamic'));
      }
      if (checkDomSinks && name.endsWith('.setAttribute')) {
        const key = literal(node.arguments?.[0]);
        if (key === null || remoteProperties.has(key.toLowerCase()))
          issue(node, 'Unreviewed URL attribute: ' + (key ?? 'dynamic'));
      }
    }
    if (checkDomSinks && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const property = member(node.left);
      const field = property.slice(property.lastIndexOf('.') + 1);
      if (remoteProperties.has(field)) {
        const value = literal(node.right);
        const localUrl = value !== null && /^(data:image\/(?:png|svg\+xml);base64,|blob:)/i.test(value);
        // Two existing local-only image assignments and the TSV blob export.
        const reviewed = (filename.endsWith('15-panel-settings-events.js') && property === 'ui.siteIcon.src' && member(node.right) === 'faviconData') ||
          (filename.endsWith('14-panel-components.js') && property === 'icon.src' && member(node.right) === 'ui.siteIcon.src') ||
          (filename.endsWith('15-panel-audit-actions.js') && property === 'link.href' && member(node.right) === 'url');
        if (!localUrl && !reviewed) issue(node, `Unreviewed resource URL assignment: ${property}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return [...new Set(problems)];
}
function inspectHeader(header, file) {
  const fields = [...header.matchAll(/^\/\/[ \t]*@([\w-]+)[ \t]*(.*)$/gm)].map(([, name, value]) => [name, value.trim()]);
  const problems = [];
  const values = key => fields.filter(([name]) => name === key).map(([, value]) => value);
  const allowedMatches = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
  if (JSON.stringify(values('match')) !== JSON.stringify(allowedMatches)) problems.push(`${file}: unexpected @match hosts`);
  if (JSON.stringify(values('grant')) !== JSON.stringify(['none'])) problems.push(`${file}: @grant must be none`);
  if (values('require').length || values('resource').length || values('connect').length || values('downloadURL').length || values('updateURL').length)
    problems.push(`${file}: external userscript resource/permission`);
  if (values('noframes').length !== 1 || values('run-at')[0] !== 'document-idle')
    problems.push(`${file}: missing @noframes or document-idle`);
  return problems;
}

function inspectCssResources(css, filename) {
  const problems = [];
  if (/\@import\b/i.test(css)) problems.push(`${filename}: CSS @import may load external data`);
  for (const match of css.matchAll(/\burl\(\s*['"]?([^\s)'"]+)/gi)) {
    const url = match[1];
    if (!/^(?:data:|blob:|#)/i.test(url))
      problems.push(`${filename}: unreviewed CSS resource URL: ${url.slice(0, 96)}`);
  }
  return problems;
}

function run() {
  const problems = [];
  const dir = path.join(root, 'src');
  const walk = base => {
    for (const item of fs.readdirSync(base, {withFileTypes: true})) {
      const file = path.join(base, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.name.endsWith('.js')) {
        const relative = path.relative(root, file).replaceAll(path.sep, '/');
        problems.push(...inspectJavaScript(fs.readFileSync(file, 'utf8'), relative));
      }
    }
  };
  walk(dir);
  const logoSource=fs.readFileSync(path.join(dir,'ui','12-panel-site-icon.js'),'utf8');
  const sourceCache=inspectCacheOnlyCalls(logoSource,'src/ui/12-panel-site-icon.js');
  if (sourceCache.count!==1) problems.push('Expected exactly one reviewed favicon cache-only fetch in source');
  const header = fs.readFileSync(path.join(dir, 'userscript-header.txt'), 'utf8');
  problems.push(...inspectHeader(header, 'src/userscript-header.txt'));
  for (const file of ['src/ui/13-panel-styles.js', 'src/ui/dev-responsive.css'])
    problems.push(...inspectCssResources(fs.readFileSync(path.join(root, file), 'utf8'), file));
  const suffixes=['', '.dev'];
  if(fs.existsSync(path.join(root,`dist/chatgpt-context-watchdog-${version}.min.user.js`)))
    suffixes.push('.min');
  for (const suffix of suffixes) {
    const file = `dist/chatgpt-context-watchdog-${version}${suffix}.user.js`;
    const full = fs.readFileSync(path.join(root, file), 'utf8');
    problems.push(...inspectHeader(full, file));
    // Built variants may rename locals. Check API references but leave URL
    // assignment whitelist anchored to audited source modules above.
    problems.push(...inspectJavaScript(full, file, false));
    if(inspectCacheOnlyCalls(full,file,
      {checkNamedUrlGuard: !file.endsWith('.min.user.js')}).count!==1)
      problems.push(file+': expected exactly one cache-only icon lookup');
  }
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else console.log(`PASS Security Gate: local-only API/DOM sinks, metadata, ${suffixes.map(suffix=>suffix==='.dev'?'Dev':suffix==='.min'?'Minified Stable':'Stable').join('/')}`);
}
if (require.main === module) run();
module.exports = {inspectJavaScript, inspectHeader, inspectCssResources};
