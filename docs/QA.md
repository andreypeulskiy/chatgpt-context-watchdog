# QA

The active suite registry is `tests/groups.json` (115 suites: 56 Node and 59 browser).

## Run checks

```sh
npm ci
npm run check
npm run qa
npm run typecheck:contracts
npm run test:node
npm run test:release
npm run test:all
```

Browser suites require Python Playwright and a compatible browser. The test launcher selects installed Chrome on Windows and Chromium on Linux. `npm run test:release` reports missing prerequisites as `NOT RUN`; it does not treat them as passed. Manual browser and Tampermonkey checks are separate from synthetic-page tests.

## v1.1.0 automated verification

- Registry: 115 suites (56 Node and 59 browser).
- Full QA: 115/115 PASS; no failed or skipped stages (Windows Chrome).
- Canonical esbuild Stable, Dev and minified Stable builds: PASS.
- Source safety, architecture and build reproducibility: PASS.
- ESLint: 0 errors, 24 warnings. CSS quality: 0 errors, 0 warnings.
- TypeScript contracts: PASS.
- Stylelint not separately rerun for v1.1.0.
- Manual Tampermonkey testing: pending.

## Historical v1.0.0 verification record

- 55/55 Node suites passed against the source changes included in this release preparation.
- Source safety, the local-only security gate, architecture guards, ESM module contracts and basic style checks passed.
- Canonical Stable build was reproducible with esbuild 0.25.12. Stable, Dev and minified Stable passed syntax and security checks.
- ESLint completed with no errors and 24 warnings, mainly Cognitive Complexity and unused-import warnings.
- Stylelint passed on the extracted shared styles and Dev-only CSS with 0 errors and 0 warnings.
- Browser suites were not run for this 1.0.0 build because Python Playwright and Chromium are unavailable in the build environment.
- Manual Tampermonkey testing has not been run for this 1.0.0 build.

Do not use private conversations, attachments, tokens or localStorage exports in public bug reports. Use synthetic data and follow [responsible reporting](../SECURITY.md#responsible-reporting).
