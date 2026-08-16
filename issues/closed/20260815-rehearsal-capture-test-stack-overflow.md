# Rehearsal capture test deterministically overflows the default test stack

**Status:** Closed
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

- The exact rehearsal capture test passes with no `RUST_MIN_STACK` override.
- A full `cargo test --lib` reaches its ordinary summary instead of SIGABRT.
- Existing auth mint/rescue stack regressions remain green.
- The relevant parent futures have a regression guard or recorded size floor.

## Resolution (2026-08-15)

The pre-fix measurement found `execute_auth_host_operation` at 24,624 bytes,
with its already-boxed inner and outer parents at 25,408 and 8,224 bytes. The
shared auth dispatcher had newly inherited the large lifecycle/commit state of
`coordinated_mint_session` and `coordinated_exchange_session` through its async
branch union.

`src/server.rs` now `Box::pin`s those coordinator calls at the shared
production dispatch boundary. The dispatcher future falls to 21,032 bytes;
the parent futures remain 25,408 and 8,224 bytes and no longer overflow the
default test stack. `src/server/tests.rs` adds ceilings of 22,000, 26,000, and
9,000 bytes so the relevant future family cannot silently regrow past these
post-fix ceilings.

Focused proof, with no `RUST_MIN_STACK` or `DYLD_FRAMEWORK_PATH` override:

```text
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 2699 filtered out; finished in 0.29s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 2702 filtered out; finished in 0.26s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 2702 filtered out; finished in 0.10s
```

The first line covers all four `server::tests::rehearsal_` tests, including the
capture regression and future-size guard. The next two are the prior auth mint
and auth rescue stack regressions, respectively.

The full library suite now reaches its summary instead of aborting:

```text
test result: FAILED. 2696 passed; 5 failed; 2 ignored; 0 measured; 0 filtered out; finished in 61.89s
```

At exact merge-base `415d56071fe2d99162972e0f3ecb9b433b8f1b51`, the
same full run aborted at the rehearsal capture test with `has overflowed its
stack` and `SIGABRT`. Each of the five later failures reproduced individually
against that merge-base; they are unrelated inherited reds.
