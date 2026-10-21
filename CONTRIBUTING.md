# Contributing

Use synthetic ChatGPT page data when reproducing defects. Do not attach real conversation text, private files, authentication tokens, localStorage exports or unfiltered console output.

Before proposing a change:

1. Describe the observed behavior and the expected result.
2. Add a focused regression test for behavior changes.
3. Keep persisted data local to the ChatGPT origin and preserve the documented storage format unless a migration is part of the change.
4. Preserve the cache-only favicon policy, SVG sanitizer, Pause behavior and Stable/Dev separation.
5. Run the relevant tests, then `npm run check` and `npm run qa` before submitting.

Do not add remote runtime libraries or new Tampermonkey permissions without review. Avoid tests that assert incidental source formatting or exact decorative pixel values when a behavior-level assertion can protect the same contract.

No project license is included. Coordinate contributions with the maintainer until licensing terms are published.
