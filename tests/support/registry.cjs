'use strict';
// Single inventory: categories remain useful for focused legacy commands,
// while lanes express independent functional / visual / release outcomes.
const fs = require('node:fs');
const path = require('node:path');
const groups = require('../groups.json');
const LANES = Object.freeze(['functional', 'visual', 'release']);
const CATEGORIES = Object.freeze(['css', 'ui', 'logic', 'security', 'build', 'integration']);

function validateRegistry(base = path.resolve(__dirname, '..'), input = groups) {
  const registered = new Set();
  const valid = /^(?!\.)(?!.*\.\.)[\w.-]+\.(?:cjs|py)$/;
  for (const [category, suites] of Object.entries(input)) {
    if (!CATEGORIES.includes(category)) throw Error(`Unknown test category: ${category}`);
    for (const kind of ['node', 'browser']) {
      if (!Array.isArray(suites[kind])) throw Error(`Invalid ${category}.${kind}`);
      for (const entry of suites[kind]) {
        if (!entry || typeof entry !== 'object' ||
            typeof entry.file !== 'string' || !LANES.includes(entry.lane) ||
            !valid.test(entry.file) || !entry.file.endsWith(kind === 'node' ? '.cjs' : '.py'))
          throw Error(`Invalid ${category}.${kind} test entry: ${JSON.stringify(entry)}`);
        if (registered.has(entry.file)) throw Error(`Duplicate registered test: ${entry.file}`);
        if (!fs.existsSync(path.join(base, entry.file))) throw Error(`Missing test: ${entry.file}`);
        registered.add(entry.file);
      }
    }
  }
  for (const category of CATEGORIES) {
    if (!Object.hasOwn(input, category)) throw Error(`Missing test category: ${category}`);
  }
  const excluded = new Set(['run.cjs', 'ui-run.py']);
  const actual = fs.readdirSync(base).filter(name => /\.(?:cjs|py)$/.test(name) && !excluded.has(name));
  const unregistered = actual.filter(name => !registered.has(name));
  if (unregistered.length) throw Error(`Unclassified tests: ${unregistered.join(', ')}`);
  return registered.size;
}
function select(selector, input = groups) {
  if (selector === 'all' || selector === 'release-gate')
    return Object.entries(input).flatMap(([category, kinds]) =>
      ['node', 'browser'].flatMap(kind => kinds[kind].map(entry => ({...entry, category, kind}))));
  if (!LANES.includes(selector) && !CATEGORIES.includes(selector))
    throw Error(`Unknown test selection: ${selector}`);
  return Object.entries(input).flatMap(([category, kinds]) =>
    ['node', 'browser'].flatMap(kind => kinds[kind]
      .filter(entry => entry.lane === selector || category === selector)
      .map(entry => ({...entry, category, kind}))));
}
module.exports = {groups, LANES, CATEGORIES, validateRegistry, select};
