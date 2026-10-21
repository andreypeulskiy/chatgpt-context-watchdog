# Test suites

`tests/groups.json` is the single registry for the active test suites. Each suite belongs to a functional, visual or release lane and can also be selected by category.

| Lane | What it protects |
|---|---|
| Functional | User-visible behavior, ledger integrity, storage, route changes, attachments, pause and security invariants |
| Visual | Layout, accessibility, responsive behavior, themes and interaction geometry |
| Release | Version metadata, module boundaries, build output, static analysis and release tooling |

Useful commands:

```sh
npm run test:node
npm run test:functional
npm run test:visual
npm run test:release-checks
npm run test:release
```

Browser suites use synthetic pages and require Python Playwright and Chromium. A full release-gate result reports missing prerequisites as `NOT RUN`, never as `PASS`. Static or synthetic checks do not replace manual Tampermonkey acceptance.

Keep test expectations independent of the implementation under test. Prefer observable behavior assertions over brittle source-string snapshots, except where a structural check protects an explicit security or module-boundary contract.
