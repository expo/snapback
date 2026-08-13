# Data-patch apply token is consumed before the CAS commit

**Opened:** 2026-08-12 · **Severity:** P3 (correctness; lost apply on conflict) · **Area:** control plane / data patch

## What

`src/server.rs:22080-22102` consumes the process-local apply token **outside** the Local lock, then CAS-es `_version` inside `apply_direct_data_patch`. A concurrent write, authorization-write stale, or panic after consume burns the single-use token with no row change. Preview must be repeated; there is no replay.

Crash-before-apply is harmless (in-memory registry dies with the process). Commit failure after consume is a lost apply.

## Why it matters

Not a silent corruption (CAS still holds). It is a TOCTOU that turns a retryable conflict into a dead capability.

## Fix

Keep the token Available until the commit returns Ok; consume in the same Local turn as the CAS (or roll back to Available on `SNAPBACK_MUTATION_CONFLICT`).

## Confidence

High on the consume-then-CAS order.

## Resolution (2026-08-12)

Apply-token validation, row CAS, and success-only consumption now run in one
serialized process-local token turn inside the Local authorization-write turn.
The token remains `Available` on every returned commit error and on panic; it
becomes `Consumed` only after the commit returns `Ok`, preserving one-shot
success semantics.

A unit test injects a mutation conflict, retries successfully with the same
token, and then proves the successful apply consumed it. The data-patch HTTP
acceptance test performs a real same-row concurrent write and proves both the
first apply and its retry reach the stale-version CAS rather than burning the
token; the existing success journey continues to assert consumed-token reuse
is refused.
