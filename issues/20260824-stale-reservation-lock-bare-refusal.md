# Stale pre-rework reservation lock refuses startup with a bare stderr line

**Status:** Open
**Opened:** 2026-08-24
**Systems:** Local server lifecycle, Diagnostics
**Related:** `crates/snapback-kernel/src/instance_lock.rs` (validate_target_reservation_file),
`benchmarks/runs/2026-08-24-packed-replay-200k/record.md` (environmental note)

## Problem

A reservation lock file minted before the owner-only rework (mode 0644)
makes the current binary refuse the instance with
`SNAPBACK_DEV_SERVER_START_FAILED` wrapping a bare
"target-instance reservation must be one owner-only regular-file link"
stderr line — correct fail-closed behavior, but with no coded recovery
hint (the remedy is simply removing/remaking the stale lock when no owner
process exists). Hit during the LLP 0307.000 200k qualification with a
lock left by a prior session's binary.

## Wanted

The refusal names a stable diagnostic with remediation: if no live owner
holds the lock, say the file is a stale pre-rework reservation and give
the exact removal step (or recover automatically, mirroring the
stale-descriptor tri-state pattern of the fixed-port probe).

## Acceptance

- A 0644 stale lock with no owner process yields a coded diagnostic with
  a working remediation (or auto-recovery); a lock held by a live owner
  still refuses hard.
- Covered by a lifecycle test.
