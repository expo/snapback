# Stale pre-rework reservation lock refuses startup with a bare stderr line

**Status:** Resolved
**Opened:** 2026-08-24
**Resolved:** 2026-08-25
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

## Resolution

Target reservation acquisition now tries the OS-exclusive lock before
classifying an existing pre-rework file. An unlocked, same-owner, single-link
regular 0644 reservation is recovered while its probed file descriptor still
holds the exclusive lock. Recovery re-stats the directory entry and requires
the same device/inode identity before unlinking it, syncs the parent directory,
then emits `SNAPBACK_TARGET_INSTANCE_RESERVATION_STALE`, names the exact lock
path, and asks the caller to retry the same command. It does not emit an
identity-blind `rm` instruction. If the pathname has disappeared or now names a
replacement reservation, recovery refuses and leaves the replacement intact.
A 0644 reservation whose lock is held by a live owner keeps the prior hard
"already reserved by another process" refusal and is never called stale.

The instance-lock lifecycle suite covers stale self-removal, a live legacy
owner, and pathname replacement by a new live owner. A CLI-level test carries
the typed stale failure through the real startup context and
`project_cli_failure`, proving the projected diagnostic is
`SNAPBACK_TARGET_INSTANCE_RESERVATION_STALE` rather than
`SNAPBACK_CLI_FAILED`. The generated diagnostic registry, Markdown projection,
typed client code vocabulary, symbol projections, and Guide aggregates include
the code.
