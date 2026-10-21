# QA

The active suite registry is `tests/groups.json`. It contains 113 suites: 55 Node suites and 58 browser suites.

## Run checks

```sh
npm ci
npm run check
npm run qa
npm run typecheck:contracts
npm run test:node
npm run test:release
```

Browser suites require Python Playwright and Chromium. `npm run test:release` reports missing prerequisites as `NOT RUN`; it does not treat them as passed. Manual browser and Tampermonkey checks are separate from synthetic-page tests.

## Current verification record

- 55/55 Node suites passed against the source changes included in this release preparation.
- Source safety, the local-only security gate, architecture guards, ESM module contracts and basic style checks passed.
- Canonical Stable build was reproducible with esbuild 0.25.12. Stable, Dev and minified Stable passed syntax and security checks.
- ESLint completed with no errors and 24 warnings, mainly Cognitive Complexity and unused-import warnings.
- A clean, complete browser candidate gate and a manual Tampermonkey session have not been run for this 1.0.0 package.

Do not use private conversations, attachments, tokens or localStorage exports in public bug reports. Use synthetic data and follow [responsible reporting](../SECURITY.md#responsible-reporting).
