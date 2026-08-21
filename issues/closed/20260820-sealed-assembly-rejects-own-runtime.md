# Sealed runtime assembly rejects its own binary after the identity move

**Status:** Closed (2026-08-21)
**Filed:** 2026-08-20
**Severity:** High — blocks the canonical publication path
**Systems:** Packaging, Build, Distribution
**Related:** LLP 0283 F-3, LLP 0041, `0f4181ad2`

## Finding

`scripts/assemble-runtime-package` rejects the runtime it just built, so the canonical sealed
assembly path does not work by default.

Commit `0f4181ad2` moved `binary_identity()` unchanged into `snapback-types`
(`crates/snapback-types/src/identity.rs`), but the build stamps are still emitted by
`crates/snapback/build.rs`. **Cargo build-script environment is package-local**, so
`snapback-types` compiles with `gitCommit: "unknown"` and `gitDirty: true`, and the assembler
then refuses the binary as unstamped/dirty.

This was found while exercising the LLP 0283 F-3 npm closure witness, which had previously
stopped before producing any tarball.

## Why it matters

It is on the **canonical publication path**, and it fails by default rather than under an
unusual configuration. Publication is already blocked by F-1, so this is not currently
user-visible — but it must be fixed before the next qualified publication, and it would
otherwise be discovered at exactly the wrong moment.

## Same shape as a known trap

This is the identity-follows-the-package problem the F-5 burn-downs already hit: moving the
fork-promotion recorder would have "silently changed benchmark identity" because
`SNAPBACK_BUILD_GIT_COMMIT` / `SNAPBACK_BUILD_GIT_DIRTY` come from `crates/snapback/build.rs`.
That lane ported the build-identity contract into `snapback-tools/build.rs` rather than
relying on the stamps travelling with the code. The same fix shape likely applies here.

## Workaround used to get past it (NOT a fix)

```text
SNAPBACK_BUILD_GIT_COMMIT=<exact HEAD>
SNAPBACK_BUILD_GIT_DIRTY=false
SNAPBACK_BUILD_DISTRIBUTION=public-package
```

With those ambient overrides the rest of assembly succeeded: the sealed Darwin runtime
assembled, 12 of 13 packages packed and passed `npm publish --dry-run`, and a scratch install
resolved the CLI's complete Darwin closure, scaffolded and generated an app, launched the
sealed binary, and created the restricted Hermes handler VM.

## Acceptance

- `scripts/assemble-runtime-package` succeeds with no ambient identity overrides.
- Build identity is emitted by, or correctly propagated to, whichever package actually
  computes `binary_identity()` — not left package-local by accident.
- A regression proves the assembler rejects a genuinely unstamped binary while accepting a
  correctly stamped one, so the check keeps its teeth.

## Resolution

**Resolved:** 2026-08-21. **Landing SHA:** TBD.

`binary_identity()` remains in `snapback-types`, and that package now owns a
`build.rs` port of the complete build-identity contract: explicit
`SNAPBACK_BUILD_GIT_COMMIT` / `SNAPBACK_BUILD_GIT_DIRTY` /
`SNAPBACK_BUILD_DISTRIBUTION` stamps win; otherwise the commit and scoped dirty
fact are probed from Git with the same worktree/common-directory invalidation,
unknown cleanliness remains fail-closed, and distribution stays restricted to
`contributor-source` or `public-package`. The shared runtime-input definition
now names the new build script as both a consumer and an input.

Both platform assemblers now require a sealable clean release identity even on
`--source-test-staging`; that flag bypasses only the `public-package`
distribution requirement. The Darwin staged-assembly regression proves a
correctly stamped contributor binary is accepted and sealed, then substitutes
a genuinely unstamped (`gitCommit: "unknown"`, `gitDirty: true`) binary and
proves it is rejected without disturbing the previously valid assembly.

Verified with no ambient `SNAPBACK_BUILD_*` overrides:

- `node --test scripts/runtime-package-authority.test.mjs`
- `node packages/snapback-runtime-darwin-arm64/package.test.mjs`
- `node packages/snapback-runtime-linux-x64/package.test.mjs`
- `cargo test -p snapback-types`
- `./ref-check --verbose`

The required clean-checkout `scripts/assemble-runtime-package` verification was
attempted with no ambient `SNAPBACK_BUILD_*` overrides. Its built-in bootstrap
step stopped before the release build with
`SNAPBACK_IBEX_RUNTIME_LINK_TIMEOUT` after the exact current-checkout link
probe exceeded 900000 ms under host-wide concurrent Cargo load. Per the ticket
execution instruction, it was not retried or hand-repaired; end-to-end assembly
success remains unverified by this landing.
