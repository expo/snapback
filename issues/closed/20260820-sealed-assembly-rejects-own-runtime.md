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

**Resolved:** 2026-08-21. **Review-fix landing SHA:** TBD.

`binary_identity()` remains in `snapback-types`. Its package-local `build.rs`
and the `snapback` and `snapback-tools` build scripts now `include!` one source
of truth at `crates/snapback-types/build_identity.rs`. The shared emitter keeps
the complete ENG-23365/ENG-23419 contract: runtime-input and Git-ref
invalidation, worktree/common-directory resolution, success-with-empty-output
clean detection, conservative unknown handling, and explicit deterministic
stamp precedence. `scripts/runtime-build-inputs.txt` covers the shared file.

`--source-test-staging` again admits debug/dirty contributor binaries for the
Linux local proof. The manufacturing script adds the distinct
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

Verification and final clean-checkout assembly evidence follow in the landing
record after the review fix is committed.
