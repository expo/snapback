# Orphan blobs after a partial reset wipe are never reclaimed, and a partial wipe is undetectable

Status: Open
Created: 2026-08-21
Related: issues/20260821-nonsql-durability-census.md (reset-wipe adjudication), LLP 0044

Found while adjudicating whether reset `AssetStore::wipe_all` is an authorization problem. It is
not — but the adjudication surfaced a real storage-reclamation and observability gap.

## The gap

Reset's `wipe_all` deletes objects sequentially and its result is discarded by the caller, so a
crash or partial failure mid-wipe leaves objects behind. Reconciliation afterwards is uneven:

- **Staging objects ARE reconciled.** Mandatory GC enumerates staging keys and compares them
  against durable live attempts, removing orphans
  (`crates/snapback-engine/src/local/engine.rs:14451`, swept by the autonomous loop at
  `crates/snapback-server/src/server.rs:20044`).
- **Blob objects are NOT.** `AssetStore` exposes `list_staging_keys` but no blob enumeration
  (`crates/snapback-kernel/src/assets_store.rs:93`), and blob GC only follows durable condemned
  rows (`crates/snapback-engine/src/local/engine.rs:14528`) — which the reset transaction just
  deleted. Orphan blobs therefore persist until another namespace wipe or operator inspection.

## The observability half, which is the worse half

The database records no wipe-completion marker and no partial-wipe state. **From the application's
perspective a partial wipe is indistinguishable from a successful one.** Only direct filesystem or
S3-prefix inspection reveals leftovers.

For S3 that means silently retained objects the operator is still paying for, and — depending on
what was in them — retained customer data after an operation the user was told completed. That is
a data-retention question as much as a cost one.

## Not an authorization defect

Recorded separately so it is not conflated with the fence program. `wipe_all` runs only on the
known-committed reset branch, so no admission fence belongs here. The remedy is reclamation and
reporting, not a guard.

## Possible fixes

1. Give `AssetStore` blob enumeration so post-reset GC can reconcile blobs the way it already
   reconciles staging.
2. Record a durable wipe-intent/completion marker so a partial wipe is detectable and resumable,
   rather than looking identical to success.
3. Stop discarding the `wipe_all` result at the call site; at minimum report partial failure.

Option 2 is the one that converts this from silent to visible, and is worth doing even if 1 is
deferred.

## Unconfirmed

Which completed local unlinks survive a power loss is INFERRED — no parent directory is fsynced.
Confirming needs a failpoint/SIGKILL test after the Nth unlink on each supported filesystem,
followed by restart inspection and a maintenance sweep.
