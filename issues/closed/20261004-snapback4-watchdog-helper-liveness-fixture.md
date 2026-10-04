# Snapback 4: watchdog SIGTERM fixture observes a live helper after its wait

**Status:** Open
**Date:** 2026-10-04
**Systems:** Snapback 4 worker test fixtures
**Related:** LLP 3000 §7, publication suite under contention

Lane SU's full eb1000 suite failed
`watchdog SIGTERM completes group cleanup without a live supervisor` at
`packages/snapback4/test/worker-regressions.test.mjs:440`:
`assert.equal(alive(first.helper), false)` observed `true`.
The preceding `await until(() => !alive(first.helper))` had returned.
The SIGINT and SIGHUP variants passed in that same run.

The fixture and all production sources are unchanged from base
`2154dc163d`; SU changes only Rust test modules and documentation.
An isolated rerun on the same tree passed in 2.30 seconds. Preserve the full
failure as evidence and investigate the inconsistent liveness observations
and cleanup ordering; no product-defect or root-cause conclusion is made.
Keep the descendant-death assertion and owned-process custody intact.

This is outside SU's fixed-short-client-timeout repair. No source fix was
made here and Lane FX's worktree was untouched.

Evidence: [SU report and full-suite log](../snapback4/reports/20261004-su-serve-upload-timeout/REPORT.md).
