# Published `snapback2` package: builders look in `guide/`, files live in `dist/guide/`

**Status:** Resolved
**Priority:** P3
**Date:** 2026-09-11
**Resolved:** 2026-09-11
**Systems:** Snapback 2 npm package layout, `snapback2 guide`
**Related:** [LLP 1002 §8](../../llp/1002-dev-loop.spec.md#8-why-trace-guide),
[`snapback2` package manifest](../../snapback2/packages/snapback2/package.json),
Clique 0.0.25 lane on expo-build-1000

## Symptom

The 0.0.25 Clique builder’s first knowledge lookup used `node_modules/snapback2/guide` (absent) and only later found `node_modules/snapback2/dist/guide/`. The CLI `snapback2 guide` is the paved path; agents still open the folder. A missing top-level `guide/` costs a correction loop and looks like a missing install.

## Evidence

- 0.0.25 run-log epoch `1789166644`: “Initial guide path node_modules/snapback2/guide absent; corrected to dist/guide (agent-error).”
- Published package `snapback2@0.0.25` layout on that host.

## Resolution

The shim package now ships `guide/README.md`, pointing builders to
`npx snapback2 guide` and `dist/guide`. The package build copies that pointer
into publication snapshots while excluding it from the generated
`dist/guide` tree and the CLI guide-card set, so the package does not duplicate
the guide or expose a spurious `README` topic.

## Validation

- `/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node build.mjs` passed;
  the guide remained 32 cards and 97,825 of 98,304 allocated Markdown bytes.
- Built a publication snapshot with `SNAPBACK2_PACKAGE_BUILD_SNAPSHOT`, packed
  it with npm 11.16.0, and installed that tarball into a fresh production-style
  consumer with Node 24.18.0. The install contained
  `node_modules/snapback2/guide/README.md` and all 32 cards under
  `node_modules/snapback2/dist/guide`; `dist/guide/README.md` was absent.
- No Cargo, browser, broad suite, registry publish, or npm publication was run.
  Registry publication follows coordinator integration and release.
