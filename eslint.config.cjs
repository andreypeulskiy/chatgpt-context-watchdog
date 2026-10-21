'use strict';
// Source files are real ES modules. Enforce declared identifiers and immutable imports.
// The standalone userscript remains a classic browser script.
// Select only high-signal SonarJS warnings; do not load its noisy full preset.
const sonarjs = require('eslint-plugin-sonarjs');
module.exports = [
  {
    files: ['dist/*.user.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script'
    },
    rules: {
      'no-debugger': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-unsafe-finally': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error'
    }
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest', sourceType: 'module',
      globals: Object.fromEntries([
        'window','document','location','history','localStorage','performance','console',
        'Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLImageElement',
        'MutationObserver','File','Blob','TextDecoder','TextEncoder','Image','DOMParser',
        'navigator','requestAnimationFrame','cancelAnimationFrame','queueMicrotask',
        'setTimeout','clearTimeout','setInterval','clearInterval','URL','crypto',
        'AbortController','DOMException','getComputedStyle','CSS','Event',
        'KeyboardEvent','MouseEvent','InputEvent','CustomEvent','ResizeObserver'
      ].map(name => [name,'readonly']))
    },
    plugins: {sonarjs},
    rules: {
      'no-undef': 'error',
      'no-import-assign': 'error',
      'no-debugger': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-unreachable': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-unsafe-finally': 'error',
      'no-unused-vars': ['warn', {args: 'none', caughtErrors: 'none'}],
      'sonarjs/cognitive-complexity': ['warn', 20],
      'sonarjs/no-identical-expressions': 'warn',
      'sonarjs/no-duplicated-branches': 'warn',
      'sonarjs/no-identical-functions': ['warn', 5]
    }
  },
  { ignores: ['tests/fixtures/**'] }
];
