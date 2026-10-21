# Security and privacy

Watchdog is intended to be **local-only**. It reads accessible ChatGPT page content to estimate context; it must not initiate network requests to transmit conversation data, fetch remote scripts, or persist full chat messages or attachment contents in the ledger.

## Reviewed cache-only icon exception

When Appearance → Logo is set to **ChatGPT** (the default), Watchdog may issue one same-origin favicon read with `window.fetch` using `cache: "only-if-cached"`, `mode: "same-origin"`, `credentials: "same-origin"` and `redirect: "error"`. Only a single, validated SVG favicon is eligible. No chat content is used in the URL or request. Cache miss, SVG rejection and errors do not trigger a normal network retry. The lookup is skipped if a Service Worker controls the page; however, automated tests do not prove that all browser configurations avoid network activity. Missing or unsafe cached data automatically changes the saved Logo preference to **Watchdog**, without a notification. Manually choosing ChatGPT makes one new cache-only attempt. Selecting **Watchdog** does not request the favicon.

The narrowly scoped call is reviewed by `tools/cache-only-policy.cjs` and the Security Gate. All other fetch calls and network APIs remain forbidden. DevTools may show a cached request with HTTP status 200 and 0 transferred bytes.

## What is stored

The script uses the ChatGPT origin's `localStorage` for estimated per-conversation numeric data, message identifiers/fingerprints and UI settings. Some attachment metadata, calibration values and explicitly customized HANDOFF templates may be stored. This storage is **not encrypted or isolated from other code with access to the same origin**. Clearing Watchdog data is supported through its UI.

## Automated checks

- `npm run test:security` — source guards, syntax-tree-based network/resource checks and representative synthetic-chat Chromium test.
- `npm run qa` — ESLint/SonarJS, Stylelint and Security Gate (requires installed npm devDependencies).
- `npm run test:release` — comprehensive release checks; do not mark missing third-party tools as passed.

Static analysis cannot formally guarantee that there are no exfiltration paths. Browser tests are synthetic and cannot verify every third-party extension, Chrome permission or DOM update.

## Responsible reporting

If you discover a vulnerability or unintended disclosure, **do not publish real chats, tokens, exports, browser profiles or identifiable attachments in a public issue**. Report the issue privately to the repository maintainer, preferably through **GitHub's private vulnerability-reporting / Security Advisory feature if it is enabled**. Provide a sanitized reproduction and the affected version. If the private channel is unavailable, ask the maintainer to arrange one without disclosing the sensitive details publicly.

No external bounty or disclosure SLA is promised.
