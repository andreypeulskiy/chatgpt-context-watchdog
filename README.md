# ChatGPT Context Watchdog

**Version 1.0.0** · Tampermonkey userscript for local estimates of visible ChatGPT conversation context.

Watchdog estimates text, user attachments and images that are available in the page. It provides per-chat summaries, configurable context budgets, calibration, Audit/Repair tools and an optional saved HANDOFF template. Estimates are heuristics; they are not model-reported token counts or remaining context capacity.

## Install

Choose one Stable build and install it in Tampermonkey:

- [Stable](dist/chatgpt-context-watchdog-1.0.0.user.js)
- [Stable, minified](dist/chatgpt-context-watchdog-1.0.0.min.user.js) — same behavior, smaller file

The minified and regular Stable files have the same Tampermonkey identity. Install only one. The [Dev build](dist/chatgpt-context-watchdog-1.0.0.dev.user.js) adds responsive CSS for narrow screens and is provided for testing; do not enable it alongside Stable.

## Build and verify

Requires Node.js 22 or newer and npm.

```sh
npm ci
npm run build          # Stable
npm run build:dev      # Dev
npm run build:min      # minified Stable
npm run check
npm run qa
npm run typecheck:contracts
```

`npm run test:node` runs all registered Node suites. Browser tests require Python Playwright and Chromium; `npm run test:release` runs the complete release gate.

The userscript header is the version source. `package.json`, `package-lock.json`, build filenames, `RELEASE-MANIFEST.json` and `SHA256SUMS.txt` should match it.

## Privacy

Watchdog runs on supported ChatGPT pages with `@grant none`. It stores estimates, message identifiers, limited attachment metadata, settings and optional user-saved HANDOFF text in the ChatGPT origin's `localStorage`. It does not send conversation data to a Watchdog server.

When the ChatGPT logo is selected, one same-origin HTTP-cache-only favicon lookup may occur. It uses `cache: "only-if-cached"`; it does not retry over the network on a miss. A controlling Service Worker blocks the lookup. See [Security and privacy](SECURITY.md).

## Limitations

The page does not expose hidden instructions, internal retrieval, compaction state or actual model context usage. Estimates may not represent every message branch and can differ from the model's internal accounting. Browser tests use synthetic pages and do not replace manual Tampermonkey testing.

## Project files

- `src/` — ES-module implementation and userscript metadata
- `dist/` — Stable, minified Stable and Dev installers
- `tests/` — active Node and browser regression suites
- `tools/` — build, security, architecture and QA checks
- `docs/` — architecture, QA and release instructions
