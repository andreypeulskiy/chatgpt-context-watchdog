'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const header = fs.readFileSync(path.join(root,'src/userscript-header.txt'),'utf8');
const version = header.match(/^\/\/ @version\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/m)?.[1];
if (!version) throw new Error('Cannot resolve the current userscript version');
const relative = `dist/chatgpt-context-watchdog-${version}.user.js`;
module.exports = { version, relative, bundlePath: path.join(root,relative), root };
