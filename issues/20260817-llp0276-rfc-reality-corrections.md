# LLP 0276 RFC reality corrections from the Phase 0 path survey

**Status:** Open
**Systems:** Project, Build, Packaging, Verification, Docs
**Date:** 2026-08-17
**Source:** LLP 0276 Phase 0 path-migration survey and
`scripts/path-migration-manifest.v1.json`

## Gap

The completed Phase 0 path survey found material differences between the
repository and LLP 0276's measured inventory or migration assumptions. Amend
LLP 0276 before the frozen-main window so Phase 1 does not silently implement a
different plan. The checked manifest remains the execution artifact; this
ticket preserves the RFC corrections that need author review.

## Required corrections

1. **Make `default-members` an explicit Phase 1 blocker.** Bare `cargo run` is
   load-bearing in the LLP 0030 resolver ladder:
   `demos/_kit/server-process.mjs:727-731` launches it from the repository root,
   the acceptance harness pins that rung, and active Guide pages teach it. A
   virtual workspace root breaks those callers unless the root manifest sets
   `default-members = ["crates/snapback"]` and the façade keeps
   `default-run = "snapback"`.
2. **Decide the baseline worker's workspace status.**
   `tools/agent-safe-baseline-worker` is lock-isolated by design: it owns a
   `Cargo.lock`, opts out with `[workspace]`, and its exact file list and build
   command are receipt-pinned. The row “`tools/` → `crates/snapback-tools`” is
   not a bare `git mv`; choose workspace membership versus a root-workspace
   `exclude`, then regenerate the performance-baseline build recipe and the
   paired-bin pins under review.
3. **Correct the Cloudflare install-root claim.** `targets/cloudflare/` has no
   `package.json` and no lockfile. Miniflare, workerd, and Wrangler live in the
   root Bun workspace and resolve from root `node_modules`; Rust and the
   conformance twin reach `node_modules/.bin/workerd` through
   `CARGO_MANIFEST_DIR`. Either create a deliberate target-local install root
   or amend the RFC's “own deliberate lockfiles and install roots” sentence.
4. **Give capability maturity a path-epoch rule.**
   `scripts/capability-maturity.mjs:1057,1098` reads `crates/snapback/src/manifest.rs` from
   historical commits. A string replacement would break pre-flip history
   replay; commit-path lookup must select the old or new registry path by the
   commit's layout epoch.
5. **Correct local-proof counts.** The canonical shell contains 146 static
   `run` declarations, 64 with `--requires`, not 164 and 73. Record which unit
   the RFC intends to count if it meant expanded JSONL results rather than
   shell declarations.
6. **Correct Guide transclusion counts.** Authored pages contain three
   `source=targets/cloudflare/` transclusions and two `source=tests/*.rs`
   transclusions: five hand edits, not eleven. Including generated flat
   projections yields nine Cloudflare and six Rust-test occurrences, fifteen
   total. The RFC currently mixes authored and generated counting bases.
7. **Name all source-reading checkers.** Beyond the two in the RFC, six more
   open moved Rust or Cloudflare source paths:
   `scripts/guide-lib.mjs` also reads `crates/snapback/src/admin.rs`;
   `scripts/check-guide-shell-commands.mjs` reads `crates/snapback/src/cli.rs`;
   `scripts/generate-diagnostics-registry.mjs` reads
   `crates/snapback/src/server/api_error.rs` and `crates/snapback/src/server/tests.rs`;
   `scripts/check-module-ownership.mjs` globs `crates/snapback/src/**/*.rs`;
   `scripts/check-rustfmt.mjs` globs `crates/snapback/src/**` and `tests/**`; and
   `scripts/generate-control-catalog.mjs` reads
   `targets/cloudflare/src/gateway.js`. Capability maturity's historical read is an
   additional special case covered above.
8. **Record the two non-clean auxiliary-bin moves.**
   `snapback-telemetry-bench` brings the `telemetry-phase1-proof` feature,
   optional `tower` dependency, `crates/snapback-tools/src/telemetry_bench.rs` library module, a
   root-tests embed, and a two-bin build command that cannot span packages as
   written. `snapback-agent-safe-paired` pins literal `crates/snapback/src/` and `tools/` file
   sets mirrored by a frozen receipt. Their crate moves require coordinated
   semantic edits and receipt regeneration.
9. **Add `llp/reviews/` to the straggler exception contract.** The directory
   contains 531 immutable provenance artifacts that quote historical paths.
   It must be category-exempt beside tombstones, closed issues, and diaries;
   active numbered LLPs and open issues remain checked.
10. **Shift the repo-root emphasis to `CARGO_MANIFEST_DIR`.** Measured
    `SNAPBACK_REPO_ROOT` consumers resolve only unmoved `demos/` and `schemas/`
    paths. The risky family is the 64 Rust `CARGO_MANIFEST_DIR` uses, roughly
    40 of which escape the future crate root.
11. **Name unusual committed assets inside `crates/snapback/src/`.** Eight JSON publication
    records and two HTML assets move with the crate. The publication carriers
    are path-pinned independently by the checker, selection policy, and
    `build.rs` cycle list, so they deserve an explicit migration note even
    though “generated/frozen records” technically covers them.

## Done when

- LLP 0276 uses one consistent counting basis and reflects the measured
  repository mechanics above.
- Phase 1 explicitly requires the façade default member and a historical
  path-epoch rule for capability maturity.
- The baseline-worker membership/install-root decisions are author-ruled
  before their moves, with receipt-regeneration obligations named.
- The amendment keeps the checked manifest and straggler gate as the plan of
  record rather than duplicating their 185-row operational inventory in prose.
