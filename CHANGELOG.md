# Changelog

## 1.1.0

- Add one file-contribution settings table with Parsed and Metadata-only
  minimum/maximum percentages per extension and editable Other files defaults.
- Preserve old file estimates until the user changes percentages; do not alter
  file ledgers, file parsing, metadata heuristics, image handling or budgets.
- Preserve existing tests and add dedicated Node and Chromium regression coverage.
- Keep the 1.0.0 release manifest and original released artifacts unchanged.

## 1.0.0

- Initial stable release.
- Replace the default HANDOFF instructions with a shorter English template that captures the conversation state and next step.
- Preserve custom saved HANDOFF prompts; users can choose Restore default to use the new template.

- Estimate visible conversation text, user attachments and images locally.
- Show per-chat summaries and configurable context budgets.
- Include calibration, Audit/Repair, pause controls and an optional saved HANDOFF template.
- Provide Stable, minified Stable and responsive Dev builds.
- Keep page data on the ChatGPT origin; the single favicon exception is restricted to same-origin HTTP cache reads.
