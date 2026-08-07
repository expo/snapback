# Linux-x64 release runtime: fleet-host recipe lives only in prose

**Status:** Closed — resolved in the same landing (2026-08-07)
**Impact:** 3
**Urgency:** 2
**Ease:** 4
**Confidence:** 5
**Systems:** Packaging, Deployment
**Date:** 2026-08-06
**Related:** LLP 0041 (`llp/0041-packaged-dev-loop.rfc.md` ~1122-1130 — the
only record of the 0.1.8 recipe), `.eas/workflows/qualified-package-staging.yml`
(lines 47-82, the canonical committed twin),
`issues/20260803-linux-hermes-release-carrier-gap.md` (why the Hermes leg
is the dominant cost)

## Summary

Producing the `snapback-runtime-linux-x64` release inputs (`snapback` ELF,
`libhermesvm.so`, `snapback.runtime-artifact-attestation.v1`) on a fleet
host has no committed script — the recipe must be reconstructed each time
from the EAS workflow YAML plus LLP 0041 prose. The 0.1.9 promotion
(2026-08-06) reconstructed it again, by hand, via an agent.

## Ask

Commit a `scripts/build-linux-runtime-release` (or similar) wrapper that
runs the bootstrap → link-smoke → `SNAPBACK_BUILD_DISTRIBUTION=public-package
cargo build --release` → `prepare-runtime.mjs` → clean-tree check →
`build-identity` → attestation mint sequence and emits the three artifacts
plus their sha256s, so a fleet build is one command and the attestation
gates cannot be skipped by accident. `tests/ci_workflows_v0.mjs:394-397`
pins the four `SNAPBACK_RUNTIME_LINUX_X64_*` env-var names the consumer
side expects.

## Resolution (2026-08-07)

Committed `scripts/build-linux-runtime-release` — an executable Node ESM
script (no extension, follows the `scripts/demo-setup` convention: exported
testable helpers plus a `process.argv[1] === fileURLToPath(...)`-guarded
`main()`) that runs, in order:

1. Linux-x64 platform guard (`checkPlatform`) — refuses with a stable
   `SNAPBACK_IBEX_HOST_UNSUPPORTED` error before touching git or the
   filesystem. Verified live on this (darwin-arm64) machine: refuses with
   exit 1 and that exact code/message.
2. Early dirty-tree refusal (`assertCleanTree`, `git status --porcelain
   --untracked-files=all`) — runs immediately after the platform guard and
   BEFORE bootstrap/link-smoke/cargo build, with stable error text
   (`SNAPBACK_RUNTIME_RELEASE_DIRTY_TREE`). This is the ticket's core ask:
   the dirty-tree gate can no longer be discovered only after the expensive
   build, as happened in
   `issues/20260806-seal-linux-native-clean-release-production.md`.
3. `scripts/bootstrap-ibex-runtime` (defaults `SNAPBACK_BOOTSTRAP_CHECK=0`
   to match the EAS workflow, but an operator's explicit env override wins).
4. `node scripts/runtime-link-smoke.mjs --timeout-ms 900000 --target-dir
   "$PWD/target" --keep-target` (exact workflow args).
5. `SNAPBACK_BUILD_DISTRIBUTION=public-package cargo build --release --bin
   snapback`.
6. `node packages/snapback-runtime-linux-x64/prepare-runtime.mjs`, then
   verifies `lib/libhermesvm.so` exists (mirrors the workflow's `test -f`).
7. A second, final clean-tree check (mirrors the workflow's own closing
   `test -z "$(git status --porcelain ...)"` invariant — kept as defense in
   depth alongside the new early check).
8. `packages/snapback-runtime-linux-x64/bin/snapback build-identity`,
   captured to the output directory.
9. `node scripts/snapback-create-runtime-artifact-attestation.mjs` with the
   same `--binary/--hermes/--hermes-header/--identity/--source-revision/--out`
   flags the workflow uses (source revision captured via `git rev-parse
   HEAD` before any build step ran).

Outputs: the three release artifacts (`snapback`, `libhermesvm.so`,
`build-attestation.json`) plus the Hermes header, copied into
`--output-dir` (default `$HOME/snapback-staging/linux`), each with a sha256,
followed by ready-to-paste `export SNAPBACK_RUNTIME_LINUX_X64_*` lines for
all five vars pinned at `tests/ci_workflows_v0.mjs` (the ticket said "four"
but the test file actually pins five: `SOURCE_BINARY`, `HERMES_LIBRARY`,
`HERMES_HEADER`, `BUILD_ATTESTATION`, `SOURCE_REVISION` — this script covers
all five).

Tests: `scripts/build-linux-runtime-release.test.mjs` (`node --test`, 4/4
green) covers `--help`, the platform guard, the clean-tree check, and
`parseArgs` — all without invoking cargo, bootstrap, or any real build step.
`node scripts/check-inventories.mjs` and `./ref-check --verbose` both pass
on the new files.

Landed on `main`. The real fleet-host seal run using this script is tracked
separately by
`issues/20260806-seal-linux-native-clean-release-production.md` — this
ticket's ask (a committed one-command wrapper) is fully met, so closing.
