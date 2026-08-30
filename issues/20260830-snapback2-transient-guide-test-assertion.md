# snapback2: a guide test assertion failed once during integration and passed on rerun

**Status:** Open
**Systems:** snapback2, test
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-30
**Related:** rules/RULES.md ("nondeterminism blocks"), `snapback2/crates/snapback2/tests/guide.rs`, `snapback2/scripts/test.sh`

During lane C's integration run (2026-08-30, commit 25880dba8) the first `scripts/test.sh` attempt hit a guide initialization assertion in `crates/snapback2/tests/guide.rs`; the same test passed on rerun and in every later run. A blocking check that can fail nondeterministically is a defect regardless of frequency (rules/RULES.md).

Suspects: the guide tests and the owner/test-verb suites run in parallel and each starts owners on ephemeral ports and writes `.snapback/` build caches under temp dirs — a shared path (e.g. a package `dist/` read while `node build.mjs` from another test rewrites it, or `SNAPBACK2_GUIDE` resolution racing a template copy) would explain a one-off. Reproduce with `cargo test --workspace -- --test-threads=8` in a loop of 20; isolate the guide test's fixture setup; make it hermetic (own temp copy of the guide dir, no dependence on `dist/` timestamps).
