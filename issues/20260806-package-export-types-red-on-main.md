# package-export-types is red on main — expo-dev.d.mts uses NodeJS namespace without @types/node in the consumer fixture

**Status:** Open
**Opened:** 2026-08-06
**Related:** scripts/check-package-export-types.mjs;
packages/snapback-cli/expo-dev.d.mts (introduced 567a8e0fd, LLP 0181 E1 /
LLP 0176 G1)

`node scripts/check-package-export-types.mjs` fails on both the main
checkout (3a6da9133) and a fresh worktree at the same commit:
`expo-dev.d.mts(50,11)/(66,9): error TS2503: Cannot find namespace
'NodeJS'`. The consumer fixture compiles published surface types without
an ambient `@types/node`, so the `NodeJS.*` references in the supervised
dev-loop declarations (567a8e0fd) fail to compile. Pre-existing relative
to the sbsb2 series (which does not touch snapback-cli); the
`verify-local-proof` chain aborts at earlier legs on fresh checkouts (see
issues/20260806-client-bundle-metrology-red-on-main.md), which is how it
went unnoticed.

Fix candidates: replace `NodeJS.Timeout`/`NodeJS.ProcessEnv` style
references with self-contained types (e.g. `ReturnType<typeof
setTimeout>`), or add `@types/node` to the consumer-fixture compile for
packages that declare a node runtime requirement.

Filed by the sbsb2 implementation session, which hit it as a false
positive on an unrelated series.
