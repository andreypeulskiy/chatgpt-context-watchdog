# Release process

The project version is `1.0.0`. Keep `src/userscript-header.txt`, `package.json`, `package-lock.json`, output filenames, `RELEASE-MANIFEST.json` and `SHA256SUMS.txt` in sync.

## Build

Use Node.js 22 or newer and the locked dependencies:

```sh
npm ci
npm run build
npm run build:dev
npm run build:min
```

The output files are Stable, Dev and minified Stable. Stable and minified Stable have the same Tampermonkey identity; install only one. Dev is for responsive-layout testing and should not run alongside Stable.

## Verify

```sh
npm run check
npm run qa
npm run typecheck:contracts
npm run test:node
npm run test:release
sha256sum -c SHA256SUMS.txt
```

The full release gate needs the browser test prerequisites. Record any missing or manually unverified checks accurately. `tools/verify-build.cjs` checks canonical build reproducibility without replacing the checked-in Stable artifact.

Before publishing, review the final source, installers, manifest, hashes, privacy statements and actual Tampermonkey behavior. Browser automation does not replace manual acceptance.

No `LICENSE` file is currently included. Choose and add a license before granting public reuse or redistribution rights.
