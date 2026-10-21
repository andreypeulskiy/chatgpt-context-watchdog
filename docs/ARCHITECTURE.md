# Architecture

The userscript is authored as ES modules under `src/` and bundled into a self-contained browser IIFE. `src/main.js` is the entry point; `src/userscript-header.txt` is the single source of the Tampermonkey metadata and version.

| Directory | Responsibility |
|---|---|
| `src/core/` | Estimation, ledger validation and merge rules |
| `src/storage/` | Chat ledger, settings, calibration and persistence |
| `src/runtime/` | Session state, pause state and UI/runtime coordination |
| `src/chatgpt/` | Route detection, DOM collection, observation and visible-message capture |
| `src/attachments/` | Attachment accounting and bounded local reads |
| `src/app/` | Conversation, route and application coordinators |
| `src/ui/` | Badge, panel, dialogs, styles, settings and diagnostics |

## Runtime boundaries

- The main conversation observer handles message changes and accounting. A separate lightweight observer supports availability and Pause behavior; both are intentional.
- Stable uses the desktop-first panel layout. Dev inserts responsive CSS at build time; it does not load remote styles.
- The ledger stores estimates, IDs and limited attachment metadata. It does not store complete conversation text or file contents.
- Message and route identity checks prevent stale or outgoing DOM from being treated as the active conversation.
- Audit is read-only. Repair and Undo require explicit user action.

## Network and rendering constraints

The userscript has no remote script dependencies and does not transmit conversation data. The only reviewed request is the optional same-origin favicon lookup with `cache: "only-if-cached"`; a cache miss does not trigger a network retry and a controlling Service Worker blocks the lookup. SVG input is parsed and copied through an explicit whitelist before rendering.

Pause stops the main observation work while retaining the small observer needed to detect availability changes. Derived panel values are calculated on demand and are not cached across routes, settings changes or storage events.

See [Security and privacy](../SECURITY.md) and the [release checks](RELEASE.md).
