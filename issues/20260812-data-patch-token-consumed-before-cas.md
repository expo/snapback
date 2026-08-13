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
