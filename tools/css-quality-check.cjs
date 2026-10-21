'use strict';
// lint the *existing* UI_CSS literal, without relocating CSS sources.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function extractCss(source) {
  const head = '  const UI_CSS = `';
  const start = source.indexOf(head);
  const end = source.lastIndexOf('    `;\n\nexport { UI_CSS };');
  if (start < 0 || end < start || source.indexOf(head, start + 1) !== -1)
    throw Error('Cannot locate the unique UI_CSS template');
  const css = source.slice(start + head.length, end);
  if (/\$\{(?!APP\})/.test(css)) throw Error('Unreviewed CSS template interpolation');
  return css.replaceAll('${APP}', 'cgpt-context-watchdog');
}
const config = {
  rules: {
    'property-no-unknown': true,
    'block-no-empty': true,
    'no-invalid-double-slash-comments': true,
    // Warnings rather than forced refactors for intentional cascading fallbacks.
    'declaration-block-no-duplicate-properties': [true, {severity: 'warning'}]
  }
};
async function main() {
  let stylelint;
  try { ({default: stylelint} = await import('stylelint')); }
  catch { throw Error('Stylelint is missing. Install pinned devDependencies before QA; do not skip the CSS audit.'); }
  const source = fs.readFileSync(path.join(root, 'src/ui/13-panel-styles.js'), 'utf8');
  const sources = [
    ['src/ui/13-panel-styles.css (extracted)', extractCss(source)],
    ['src/ui/dev-responsive.css', fs.readFileSync(path.join(root, 'src/ui/dev-responsive.css'), 'utf8')]
  ];
  let problems = 0, warnings = 0;
  for (const [file, code] of sources) {
    const result = await stylelint.lint({code, codeFilename: file.replace(' (extracted)', ''), config});
    for (const resultFile of result.results) {
      for (const warning of resultFile.warnings) {
        const label = `${file}:${warning.line}:${warning.column}: ${warning.severity} ${warning.rule}`;
        console.log(`${label}: ${warning.text}`);
        if (warning.severity === 'error') problems++;
        else warnings++;
      }
    }
    if (result.errored && !result.results.some(entry => entry.warnings.some(w => w.severity === 'error'))) {
      problems++;
      console.error(`${file}: CSS parsing/validation failed`, result.report);
    }
  }
  console.log(`CSS Quality: ${problems} errors, ${warnings} warnings`);
  if (problems) process.exitCode = 1;
}
if (require.main === module) main().catch(error => {console.error(error.message);process.exitCode=1;});
module.exports = {extractCss, config};
