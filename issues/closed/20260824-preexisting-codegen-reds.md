# Three pre-existing codegen reds observed on `origin/main` at 941e965ad

Status: closed
Filed: 2026-08-24
Area: packages/snapback-codegen

All three reproduce with the working tree reverted to `origin/main`'s
`packages/` content, so none belongs to
`seth/knockoff-shared-development-auth`.

## 1. `export { ... };` with no module specifier crashes the builder walk

`node --test packages/snapback-codegen/application-auth-bootstrap.test.mjs`
fails at "familiar defaults durable custody and refuses the weaker grade
before publication" with:

```
CODEGEN_MODULE_EVALUATION_FAILED: Cannot read properties of undefined (reading 'kind')
  at Object.isStringLiteral (typescript.js)
  at resolveExport (packages/snapback-codegen/index.mjs)
```

`resolveExport` reads `ts.isStringLiteral(statement.moduleSpecifier)` for every
`ExportDeclaration`. A local re-export — `export { allow, defineSchema, v };`,
which `packages/snapback-codegen/familiar.mjs` itself uses — has no
`moduleSpecifier`, so the call receives `undefined` and throws inside
TypeScript rather than resolving the binding.

Next action: guard the specifier read (`statement.moduleSpecifier !== undefined
&& ts.isStringLiteral(...)`) and add a familiar-profile regression fixture whose
schema resolves a builder through a specifier-less re-export.

## 2. The embedded Rust schema-manifest fixture is stale

`node --test packages/snapback-codegen/authoring-validation.test.mjs` (~3 min)
fails with `actual codegen schema manifest drifted from the Rust embedded
fixture`.

Next action: identify which side moved — the JS manifest projection or the
embedded Rust fixture — and regenerate the stale one. Until then this file
cannot gate anything downstream of it.

## 3. `expo-dev-loop.test.mjs` defaulted to one developer's home directory

`packages/snapback-cli/expo-dev-loop.test.mjs` defaulted `runtimeBinary` to
`/Users/ccheever/projects/snapback-g0-land/target/debug/snapback`, so on every
other machine it hard-failed at its first assertion and never ran. Fixed on
`seth/knockoff-shared-development-auth` to default to this checkout's own
`target/debug/snapback`.

With the path fixed the file now reaches a second, independent pre-existing
red at line 917: a negative web-carrier case expects `did not write structured
readiness` and observes `Expo web carrier exited 1 before readiness`. This
reproduces with the branch's `expo-dev.mjs` change reverted, so it is not the
supervised shared-auth mount.

Next action: decide whether the carrier's exit-before-readiness path should
still report the structured-readiness diagnostic, or whether the assertion
should name the exit path it now takes.

## Resolution (2026-08-25)

The two codegen reds were already fixed on this lane's base as main continued
moving after the ticket captured them. This lane adds focused regression
coverage and fixes the separate Expo carrier diagnostic race.

- The graph binding resolver treated every `ExportDeclaration` as though it
  had a `moduleSpecifier`. Commit `9653d21d2` fixed that red on this lane's
  base by adding the missing guard and retaining the local `resolveLocal` walk.
  This lane adds a dedicated Familiar-profile regression whose function module
  imports `query` and resolves a `v` builder site through an authored
  specifier-less re-export. Temporarily restoring the unguarded call makes that
  regression fail with the original `Cannot read properties of undefined
  (reading 'kind')` stack.
- Git history shows that the JS codegen input closure moved during the LLP 0209
  G0 B2 rounds after the Rust-owned membership manifest fixture was last
  generated. The fixture side was stale. Commit `3523efec6` had already
  regenerated `crates/snapback-sync/fixtures/codegen-membership-schema-manifest.json`
  from codegen and updated both digest constants, fixing that red before this
  lane branched; the lane retains regression coverage confirming the parity
  test stays green.
- The Expo carrier's readiness poll raced the supervised child exit. The base
  reported only `Expo web carrier exited … before readiness`, omitting the
  missing-readiness detail. Round 1 combined child status with that detail when
  no file exists. Round 2 consumes and validates an existing descriptor first,
  then lets the dead supervisor fail at the later lifecycle check. Deterministic
  regressions cover both exit-before-publication and publish-then-exit.

Verification evidence:

- `application-auth-bootstrap.test.mjs`: 9 passed, 0 failed, including the new
  Familiar re-export fixture.
- `authoring-validation.test.mjs`: 1 passed, 0 failed; the generated manifest
  remains equal to the Rust-owned fixture digest.
- `familiar-dev-loop.test.mjs`: 1 passed, 0 failed with the qualified shared
  runtime selected by its real absolute path.
- `carrier-kit.test.mjs`: passed under the repository's Node 24.18.0 runtime,
  including both deterministic child-exit readiness races.
- `ref-check --verbose`: 311 LLP docs, 6,617 refs, 0 errors, 0 unchecked.

The full Expo loop proceeds through the fixed carrier-timeout cell, then remains
red on the separately owned temporary-fixture `@expo/snapback-client`
resolution failure recorded in
`issues/20260823-package-test-framework-drift-red.md`. The codegen package
command completes pretest, then remains red on the unrelated inherited graph
bundle-hash golden drift in `graph-query.test.mjs`.

The Rust counterpart remains for the supervisor to run because this lane is
JS-only:
`cargo test -p snapback-server codegen_emitted_membership_projection_parses_and_activates_in_sessions`.
