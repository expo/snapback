# Sealed runtime assembly rejects its own binary after the identity move

**Status:** Closed (2026-08-21)
**Filed:** 2026-08-20
**Severity:** High — blocks the canonical publication path
**Systems:** Packaging, Build, Distribution
**Related:** LLP 0283 F-3, LLP 0041, `0f4181ad2`, `2fa5b1fc8`

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

**Resolved:** 2026-08-21. The original reviewed implementation was
`f18078621296c45763f61a827f1a529dcd213252`; its rebased consolidation commit
is `5e726666956e6b9e2259de596d5b40bf8dfa1d13`.

The concurrent minimal fix `2fa5b1fc8f7dd1179b2fd7f168896b63538f4e23`
landed on `main` first. It correctly added the package-local
`crates/snapback-types/build.rs`, tracked that input, and retained a Darwin
regression for commitless identity. This branch consolidates that landing into
the reviewed superset below rather than duplicating or discarding it.

`binary_identity()` remains in `snapback-types`. Its package-local `build.rs`
and the `snapback` and `snapback-tools` build scripts now `include!` one source
of truth at `crates/snapback-types/build_identity.rs`. The shared emitter keeps
the complete ENG-23365/ENG-23419 contract: runtime-input and Git-ref
invalidation, worktree/common-directory resolution, success-with-empty-output
clean detection, conservative unknown handling, and explicit deterministic
stamp precedence. `scripts/runtime-build-inputs.txt` covers the shared file.

`--source-test-staging` again admits known-commit debug/dirty contributor
binaries for local proof while every staging mode still rejects a missing or
`unknown` source revision. The manufacturing script adds the distinct
`--strict-clean-release` mode after building `--release` from a clean checkout;
default public-package preparation remains strict as well. The Darwin
staged-assembly regression proves a debug/dirty contributor binary stages in
source-test mode and is rejected by strict manufacturing without disturbing
the valid assembly. Its unstamped Node substitution remains assembler-teeth
coverage, and the Linux attestation tests now carry the equivalent unstamped
substitution.

The `snapback-types` identity test also refuses an unstamped in-worktree build:
when `git rev-parse --is-inside-work-tree` succeeds it requires both a known
`binary_identity().git_commit` and a present compile-time
`SNAPBACK_BUILD_GIT_COMMIT`. Deleting or emptying the package build script can
no longer leave the regression green.

The separately observed admin-console build blocker was environmental. This
worktree had been installed with Bun 1.3.14 despite root `package.json` pinning
1.3.12. After installing Bun 1.3.12, moving aside the prior dependency tree,
and running `bun install --frozen-lockfile --cwd admin-ui`, the unchanged
`bun run --cwd admin-ui build` completed and produced the static snapshot. No
Exact/Vite temp-lifecycle workaround was required.

## Pre-rebase acceptance evidence

The review fix was verified with:

- `cargo build -p snapback-types -p snapback -p snapback-tools`
- `cargo test -p snapback-types` — 223 passed, 0 failed, 1 ignored
- `node --test scripts/runtime-package-authority.test.mjs` — 10 passed
- `node packages/snapback-runtime-darwin-arm64/package.test.mjs`
- `node packages/snapback-runtime-linux-x64/package.test.mjs`
- `cargo fmt --all -- --check`
- `./ref-check --verbose` — 296 LLP docs, 6,029 refs, 0 errors, 0 unchecked

The required clean-checkout manufacturing acceptance then succeeded with no
ambient identity overrides:

```sh
env -u SNAPBACK_BUILD_GIT_COMMIT \
  -u SNAPBACK_BUILD_GIT_DIRTY \
  -u SNAPBACK_BUILD_DISTRIBUTION \
  scripts/assemble-runtime-package
```

Step 1 linked, launched, and restricted-VM-qualified the exact clean checkout;
step 2 completed the clean release build; step 3 used Bun 1.3.12 and built the
source-matched admin snapshot; and step 4 prepared and swapped
`packages/snapback-runtime-darwin-arm64`. The final seal binds source revision
`f18078621296c45763f61a827f1a529dcd213252`, `gitDirty: false`,
`buildProfile: "release"`, `buildDistribution: "contributor-source"`, and a
successful identity-matched restricted-VM qualification verdict.
