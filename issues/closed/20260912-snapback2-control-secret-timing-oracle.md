# snapback2 control secret compared with early-exit !=

**Status:** Resolved
**Priority:** P2 (sole cross-UID loopback secret)
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/snapback2/src/serve.rs:277-285`

## What was reported

The control secret — the sole cross-UID loopback credential — is compared
with plain `!=`, which short-circuits: a timing oracle over the loopback
interface.

## Suggested fix

- Constant-time comparison for the control secret.
- Small, testable change; assert the comparison helper is constant-time by
  construction (use the standard primitive, don't hand-roll).

## Acceptance

- Control admission uses a constant-time compare; existing control tests
  still pass.

## Resolution (2026-09-12)

Loopback control capability comparison uses subtle ConstantTimeEq over the secret bytes. Missing, short, same-length wrong, and correct secrets are covered; admission order still rejects remote requests first. Native control-secret and owner wire tests pass. This is a constant-time primitive check, not a claim of remotely measured constant latency.
