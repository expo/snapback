# snapback2: a guide test assertion failed once during integration and passed on rerun

**Status:** Closed
**Systems:** snapback2, test
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-30
**Related:** rules/RULES.md ("nondeterminism blocks"), `snapback2/crates/snapback2/tests/guide.rs`, `snapback2/scripts/test.sh`

During lane C's integration run (2026-08-30, commit 25880dba8) the first `scripts/test.sh` attempt hit a guide initialization assertion in `crates/snapback2/tests/guide.rs`; the same test passed on rerun and in every later run. A blocking check that can fail nondeterministically is a defect regardless of frequency (rules/RULES.md).

Suspects: the guide tests and the owner/test-verb suites run in parallel and each starts owners on ephemeral ports and writes `.snapback/` build caches under temp dirs — a shared path (e.g. a package `dist/` read while `node build.mjs` from another test rewrites it, or `SNAPBACK2_GUIDE` resolution racing a template copy) would explain a one-off. Reproduce with `cargo test --workspace -- --test-threads=8` in a loop of 20; isolate the guide test's fixture setup; make it hermetic (own temp copy of the guide dir, no dependence on `dist/` timestamps).

## Resolution — 2026-08-30

Resolved the whole ticket.

The ordinary pre-fix reproduction loop completed 20/20 green, so the natural
occurrence rate in that sample was 0/20. A synchronized diagnostic then ran 20
ordinary `node build.mjs` package rebuilds while running the guide integration
target 20 times. It reproduced 11 guide failures (11/20): failures stopped as
soon as the builder finished. Direct `init --json` probes during the same
interleaving returned both `E_OWNER_TEMPLATE` (the templates tree was absent)
and `E_OP_INVALID` with "checker declarations are missing beside the compiler
bundle" (the compiler bundle existed before its declarations).

The mechanism was the shared `packages/snapback2/dist/` publication path.
`build.mjs` recursively removed that directory before rebuilding its leaves,
while guide, init, owner, and test-verb commands read guide pages, templates,
the compiler, declarations, and the journey runner directly from it. The
Rust-side build lock covered only builds initiated by the common test helper;
direct `build.mjs` callers did not participate, and readers held no stable
snapshot. Ports, per-project temp directories, `.snapback/` caches, guide
resolution, and process environment were otherwise isolated and were not the
cause.

The fix makes `build.mjs` participate in the existing package-build lock and
makes test consumers copy the complete built `dist/` tree under that lock into
their own canonical temporary package. Each command receives private
`SNAPBACK2_COMPILER`, `SNAPBACK2_GUIDE`, `SNAPBACK2_TEMPLATES`, and
`SNAPBACK2_TEST_RUNNER` paths; owner and effects tests use an isolated compiler
copy too. The snapshot preserves the package's `dist/` shape and resolves the
installed TypeScript dependency from its private package root, so compiler and
journey resolution are identical to the shipped package. There are no retries
or ordering assumptions.

Evidence after the fix:

- The synchronized rebuild-vs-guide diagnostic changed from 9/20 green to
  20/20 green.
- The required post-fix `cargo test --workspace -- --test-threads=8` loop was
  20/20 green (0 failures).
- `./scripts/test.sh` exited 0: Cargo green, evaluator 76/76, compiler 42/42.
- `node scripts/measure.mjs --check` exited 0 with every measured budget green.

Full local logs were retained as `/tmp/snapback2-guide-loop-pre.log`,
`/tmp/snapback2-guide-race-evidence.log`,
`/tmp/snapback2-guide-race-detail.log`,
`/tmp/snapback2-guide-race-post.log`, and
`/tmp/snapback2-guide-loop-post.log`.
