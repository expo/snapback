# Rehearsal capture test deterministically overflows the default test stack

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Auth rehearsal, Host operations, Rust test suite, Stack usage
**Date:** 2026-08-15
**Governing:** LLP 0213
**Related:** `issues/closed/20260811-server-auth-mint-projection-test-stack-overflow.md`,
`src/server/tests.rs:1332`
**Found while:** Whole-codebase correctness/performance review (2026-08-15)

## Problem

The full `cargo test --lib` run aborts at:

```text
server::tests::rehearsal_capture_releases_after_charge_and_exact_retry_is_free
thread ... has overflowed its stack
fatal runtime error: stack overflow, aborting
```

The failure reproduces in isolation on the default test stack. The same exact
test passes with `RUST_MIN_STACK=134217728`, which points to an oversized async
poll stack rather than recursion or a semantic assertion failure.

This regresses the same failure class closed on 2026-08-11 by heap-pinning the
large shared host-op futures. The new rehearsal capture path either bypasses
that heap boundary or has since grown another large parent future. Because the
failure is an abort, it kills the 2,696-test process and hides every later red.

## Desired outcome

Measure the future sizes on this route and heap-pin or split the large state at
the shared production path. Do not paper over it only by enlarging the test
thread: production runtimes have a larger configured stack, but the prior
incident demonstrated that this shape can become a real served-route abort.

## Acceptance

- The exact test passes with no `RUST_MIN_STACK` override.
- A full `cargo test --lib` reaches its ordinary summary instead of SIGABRT.
- Existing auth mint/rescue stack regressions remain green.
- The relevant parent futures have a regression guard or recorded size floor.

