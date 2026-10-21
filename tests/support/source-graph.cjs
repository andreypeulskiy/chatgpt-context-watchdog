'use strict';
// Check the actual ES-module dependency graph, not the former concatenation order.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sourceRoot = path.resolve(__dirname, '../../src');
const modules = new Map();
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      const id = path.relative(sourceRoot, full).split(path.sep).join('/');
      modules.set(id, fs.readFileSync(full, 'utf8'));
    }
  }
}
walk(sourceRoot);
function source(id) {
  assert.ok(modules.has(id), `Missing source module: ${id}`);
  return modules.get(id);
}
function dependencies(id) {
  const text = source(id);
  // Current project imports are ordinary one-line static ESM imports.
  const pattern = /^import\b[^\n]*?\bfrom\s+['"]([^'"]+)['"]/gm;
  return [...text.matchAll(pattern)].map(([, spec]) => {
    assert.ok(spec.startsWith('.'), `Unexpected nonlocal import: ${id} -> ${spec}`);
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(id), spec));
    assert.ok(modules.has(target), `Unresolved import: ${id} -> ${target}`);
    return target;
  });
}
function reachableFrom(entry = 'main.js') {
  const visited = new Set(), pending = [entry];
  while (pending.length) {
    const next = pending.pop();
    if (visited.has(next)) continue;
    visited.add(next);
    pending.push(...dependencies(next));
  }
  return visited;
}
function assertImport(from, to) {
  assert.ok(dependencies(from).includes(to), `${from} must import ${to}`);
}
module.exports = { source, dependencies, reachableFrom, assertImport, modules };
